module.exports = function(app) {

	var Blocos = {};
	var blocos = app.repository.collections.tvi_blocos;
	var points = app.repository.collections.points;
	var campaigns = app.repository.collections.campaign;
	var logger = app.services.logger;

	/**
	 * Gera blocos de inspeção para uma campanha.
	 * Particiona os pontos pendentes em blocos de tamanho fixo,
	 * criando um conjunto de blocos para cada rodada de inspeção (1 a numInspec).
	 */
	Blocos.generateBlocks = async function(request, response) {
		try {
			var campaignId = request.params.id;
			var blockSize = parseInt(request.body.blockSize) || 5;
			var timeoutMinutes = parseInt(request.body.timeoutMinutes) || 480;

			if (blockSize < 1 || blockSize > 1000) {
				return response.status(400).json({ error: 'blockSize deve estar entre 1 e 1000' });
			}

			var campaign = await campaigns.findOne({ _id: campaignId });
			if (!campaign) {
				return response.status(404).json({ error: 'Campanha não encontrada' });
			}

			var numInspec = campaign.numInspec || 1;

			// Verificar se já existem blocos para esta campanha
			var existingCount = await blocos.count({ campaignId: campaignId });
			if (existingCount > 0) {
				return response.status(409).json({
					error: 'Esta campanha já possui blocos gerados. Remova os blocos existentes antes de gerar novos.'
				});
			}

			// Buscar pontos pendentes (ainda não completamente inspecionados), ordenados por index
			// TODO [TKT-000015 — fase follow-up]: substituir $where por
			//   `userNameCount: { $lt: numInspec }` (campo introduzido em TKT-000015).
			//   Operação segura apenas após rodar scripts/backfill-userNameCount.js.
			//   Mantido temporariamente para não quebrar pipelines de blocos legados.
			var allPoints = await points.find(
				{
					campaign: campaignId,
					$where: 'this.userName.length < ' + numInspec
				},
				{ _id: 1, index: 1 }
			).sort({ index: 1 }).toArray();

			if (allPoints.length === 0) {
				return response.status(400).json({ error: 'Nenhum ponto pendente encontrado para esta campanha' });
			}

			// Particionar pontos em blocos
			var blocksToInsert = [];
			var blockIndex = 1;

			for (var i = 0; i < allPoints.length; i += blockSize) {
				var chunk = allPoints.slice(i, i + blockSize);
				var pointIds = chunk.map(function(p) { return p._id; });
				var pointIndexStart = chunk[0].index;
				var pointIndexEnd = chunk[chunk.length - 1].index;

				// Criar um bloco para cada rodada de inspeção
				for (var round = 1; round <= numInspec; round++) {
					blocksToInsert.push({
						campaignId: campaignId,
						blockIndex: blockIndex,
						inspectionRound: round,
						pointIndexStart: pointIndexStart,
						pointIndexEnd: pointIndexEnd,
						pointIds: pointIds,
						size: chunk.length,
						status: 'available',
						assignedTo: null,
						assignedAt: null,
						completedAt: null,
						currentPointOffset: 0,
						timeoutMinutes: timeoutMinutes,
						discardedBy: null,
						discardedAt: null,
						discardReason: null,
						createdAt: new Date()
					});
				}

				blockIndex++;
			}

			// Inserção em lote
			await blocos.insertMany(blocksToInsert);

			await logger.info('Blocos gerados com sucesso', {
				module: 'blocos',
				function: 'generateBlocks',
				metadata: {
					campaignId: campaignId,
					totalBlocks: blocksToInsert.length,
					blockSize: blockSize,
					numInspec: numInspec,
					totalPoints: allPoints.length
				}
			});

			response.json({
				success: true,
				totalBlocks: blocksToInsert.length,
				blocksPerRound: blockIndex - 1,
				rounds: numInspec,
				blockSize: blockSize,
				totalPoints: allPoints.length
			});

		} catch (err) {
			await logger.error('Erro ao gerar blocos', {
				module: 'blocos',
				function: 'generateBlocks',
				metadata: { error: err.message, stack: err.stack }
			});
			response.status(500).json({ error: 'Erro interno ao gerar blocos' });
		}
	};

	/**
	 * Atribui atomicamente o próximo bloco disponível ao inspetor,
	 * ou retorna o bloco já atribuído a ele.
	 * Também libera blocos expirados antes da atribuição.
	 */
	Blocos.claimNextBlock = async function(campaignId, username) {
		// 1. Liberar blocos expirados
		await Blocos.releaseExpiredBlocksInternal(campaignId);

		// 2. Verificar se o inspetor já tem um bloco ativo
		var activeBlock = await blocos.findOne({
			campaignId: campaignId,
			assignedTo: username,
			status: 'assigned'
		});

		if (activeBlock) {
			return activeBlock;
		}

		// 3. Buscar blocos já completados pelo mesmo inspetor (para evitar re-atribuição na mesma rodada)
		var completedByUser = await blocos.find({
			campaignId: campaignId,
			assignedTo: username,
			status: 'completed'
		}, { blockIndex: 1, inspectionRound: 1 }).toArray();

		var completedBlockIndexes = completedByUser.map(function(b) { return b.blockIndex; });

		// 4. Atribuir novo bloco atomicamente
		// Prioriza: rodada menor primeiro, depois blockIndex menor
		// Exclui blocos cujo blockIndex o inspetor já completou na mesma rodada
		var filter = {
			campaignId: campaignId,
			status: 'available'
		};

		// Se o inspetor já completou blocos, excluir para evitar que o mesmo inspetor
		// inspecione o mesmo bloco em rodadas diferentes consecutivamente.
		// Em vez disso, ele deve pegar blocos de outros blockIndexes primeiro.
		if (completedBlockIndexes.length > 0) {
			filter.blockIndex = { $nin: completedBlockIndexes };
		}

		var result = await blocos.findOneAndUpdate(
			filter,
			{
				$set: {
					status: 'assigned',
					assignedTo: username,
					assignedAt: new Date(),
					currentPointOffset: 0
				}
			},
			{
				sort: { inspectionRound: 1, blockIndex: 1 },
				returnOriginal: false
			}
		);

		if (result && result.value) {
			return result.value;
		}

		// 5. Se não encontrou excluindo os já completados, tentar sem exclusão
		// (pode ser que todos os blocos de outros blockIndexes já foram pegos)
		if (completedBlockIndexes.length > 0) {
			result = await blocos.findOneAndUpdate(
				{
					campaignId: campaignId,
					status: 'available'
				},
				{
					$set: {
						status: 'assigned',
						assignedTo: username,
						assignedAt: new Date(),
						currentPointOffset: 0
					}
				},
				{
					sort: { inspectionRound: 1, blockIndex: 1 },
					returnOriginal: false
				}
			);

			if (result && result.value) {
				return result.value;
			}
		}

		return null; // Nenhum bloco disponível
	};

	/**
	 * Avança o offset do ponto atual no bloco atomicamente.
	 * Retorna o documento atualizado.
	 */
	Blocos.advanceBlockOffset = async function(blockId) {
		var result = await blocos.findOneAndUpdate(
			{ _id: blockId },
			{ $inc: { currentPointOffset: 1 } },
			{ returnOriginal: false }
		);
		return result ? result.value : null;
	};

	/**
	 * Marca um bloco como completado.
	 */
	Blocos.completeBlock = async function(blockId) {
		await blocos.updateOne(
			{ _id: blockId },
			{ $set: { status: 'completed', completedAt: new Date() } }
		);
	};

	/**
	 * Libera blocos expirados (timeout) de uma campanha.
	 * Reseta o status para 'available', liberando para outro inspetor.
	 */
	Blocos.releaseExpiredBlocksInternal = async function(campaignId) {
		// Buscar blocos assigned com timeout expirado
		var now = new Date();

		// Usar aggregation para calcular expiração por bloco (cada bloco tem seu timeoutMinutes)
		var expiredBlocks = await blocos.find({
			campaignId: campaignId,
			status: 'assigned',
			assignedAt: { $ne: null }
		}).toArray();

		var expiredIds = [];
		expiredBlocks.forEach(function(block) {
			var expirationTime = new Date(block.assignedAt.getTime() + (block.timeoutMinutes * 60 * 1000));
			if (now > expirationTime) {
				expiredIds.push(block._id);
			}
		});

		if (expiredIds.length > 0) {
			await blocos.updateMany(
				{ _id: { $in: expiredIds } },
				{
					$set: {
						status: 'available',
						assignedTo: null,
						assignedAt: null,
						currentPointOffset: 0
					}
				}
			);

			await logger.info('Blocos expirados liberados', {
				module: 'blocos',
				function: 'releaseExpiredBlocksInternal',
				metadata: { campaignId: campaignId, count: expiredIds.length }
			});
		}

		return expiredIds.length;
	};

	/**
	 * Endpoint para listar blocos de uma campanha com filtros e paginação.
	 */
	Blocos.listBlocks = async function(request, response) {
		try {
			var campaignId = request.params.id;
			var page = parseInt(request.query.page) || 1;
			var limit = parseInt(request.query.limit) || 20;
			var skip = (page - 1) * limit;

			var filter = { campaignId: campaignId };

			if (request.query.status) {
				filter.status = request.query.status;
			}
			if (request.query.assignedTo) {
				filter.assignedTo = request.query.assignedTo;
			}
			if (request.query.inspectionRound) {
				filter.inspectionRound = parseInt(request.query.inspectionRound);
			}

			var total = await blocos.count(filter);
			var blocksList = await blocos.find(filter)
				.sort({ inspectionRound: 1, blockIndex: 1 })
				.skip(skip)
				.limit(limit)
				.toArray();

			response.json({
				blocks: blocksList,
				pagination: {
					currentPage: page,
					totalPages: Math.ceil(total / limit) || 1,
					totalBlocks: total,
					limit: limit,
					hasNext: page < Math.ceil(total / limit),
					hasPrev: page > 1
				}
			});
		} catch (err) {
			await logger.error('Erro ao listar blocos', {
				module: 'blocos',
				function: 'listBlocks',
				metadata: { error: err.message }
			});
			response.status(500).json({ error: 'Erro interno ao listar blocos' });
		}
	};

	/**
	 * Retorna resumo de blocos por status e por inspetor.
	 */
	Blocos.getBlocksSummary = async function(request, response) {
		try {
			var campaignId = request.params.id;

			var statusCounts = await blocos.aggregate([
				{ $match: { campaignId: campaignId } },
				{ $group: { _id: '$status', count: { $sum: 1 } } }
			]).toArray();

			var inspectorCounts = await blocos.aggregate([
				{ $match: { campaignId: campaignId, assignedTo: { $ne: null } } },
				{
					$group: {
						_id: { assignedTo: '$assignedTo', status: '$status' },
						count: { $sum: 1 }
					}
				}
			]).toArray();

			var total = await blocos.count({ campaignId: campaignId });

			// Montar resumo por status
			var byStatus = {};
			statusCounts.forEach(function(s) {
				byStatus[s._id] = s.count;
			});

			// Montar resumo por inspetor
			var byInspector = {};
			inspectorCounts.forEach(function(s) {
				var inspector = s._id.assignedTo;
				if (!byInspector[inspector]) {
					byInspector[inspector] = {};
				}
				byInspector[inspector][s._id.status] = s.count;
			});

			response.json({
				total: total,
				byStatus: byStatus,
				byInspector: byInspector
			});
		} catch (err) {
			await logger.error('Erro ao obter resumo de blocos', {
				module: 'blocos',
				function: 'getBlocksSummary',
				metadata: { error: err.message }
			});
			response.status(500).json({ error: 'Erro interno ao obter resumo' });
		}
	};

	/**
	 * Descarta um bloco específico.
	 * Remove as inspeções correspondentes dos pontos e cria um novo bloco disponível.
	 */
	Blocos.discardBlock = async function(request, response) {
		try {
			var campaignId = request.params.id;
			var blockIndex = parseInt(request.params.blockIndex);
			var inspectionRound = parseInt(request.body.inspectionRound);
			var reason = request.body.reason || '';
			var discardedBy = request.body.discardedBy || 'admin';

			if (!inspectionRound) {
				return response.status(400).json({ error: 'inspectionRound é obrigatório' });
			}

			// Buscar o bloco
			var block = await blocos.findOne({
				campaignId: campaignId,
				blockIndex: blockIndex,
				inspectionRound: inspectionRound,
				status: { $in: ['assigned', 'completed'] }
			});

			if (!block) {
				return response.status(404).json({ error: 'Bloco não encontrado ou não pode ser descartado' });
			}

			var inspectorName = block.assignedTo;

			// Marcar bloco como descartado
			await blocos.updateOne(
				{ _id: block._id },
				{
					$set: {
						status: 'discarded',
						discardedBy: discardedBy,
						discardedAt: new Date(),
						discardReason: reason
					}
				}
			);

			// Remover inspeção do inspetor nos pontos do bloco
			if (inspectorName) {
				for (var i = 0; i < block.pointIds.length; i++) {
					var pointId = block.pointIds[i];
					var point = await points.findOne({ _id: pointId });

					if (point && point.userName) {
						var userIndex = point.userName.indexOf(inspectorName);
						if (userIndex !== -1) {
							// Remover userName e inspection correspondente
							var newUserName = point.userName.filter(function(u, idx) { return idx !== userIndex; });
							var newInspection = point.inspection.filter(function(insp, idx) { return idx !== userIndex; });

							// Recalcular classConsolidated se necessário
							var updateSet = {
								userName: newUserName,
								inspection: newInspection
							};

							// Se tinha classConsolidated, remover (será recalculado na próxima inspeção completa)
							if (point.classConsolidated) {
								updateSet.classConsolidated = [];
							}

							await points.updateOne(
								{ _id: pointId },
								{ $set: updateSet }
							);
						}
					}
				}
			}

			// Criar novo bloco disponível para reinspeção
			await blocos.insertOne({
				campaignId: campaignId,
				blockIndex: blockIndex,
				inspectionRound: inspectionRound,
				pointIndexStart: block.pointIndexStart,
				pointIndexEnd: block.pointIndexEnd,
				pointIds: block.pointIds,
				size: block.size,
				status: 'available',
				assignedTo: null,
				assignedAt: null,
				completedAt: null,
				currentPointOffset: 0,
				timeoutMinutes: block.timeoutMinutes,
				discardedBy: null,
				discardedAt: null,
				discardReason: null,
				createdAt: new Date()
			});

			await logger.info('Bloco descartado e recriado', {
				module: 'blocos',
				function: 'discardBlock',
				metadata: {
					campaignId: campaignId,
					blockIndex: blockIndex,
					inspectionRound: inspectionRound,
					inspector: inspectorName,
					reason: reason
				}
			});

			response.json({ success: true, message: 'Bloco descartado e recriado para reinspeção' });

		} catch (err) {
			await logger.error('Erro ao descartar bloco', {
				module: 'blocos',
				function: 'discardBlock',
				metadata: { error: err.message, stack: err.stack }
			});
			response.status(500).json({ error: 'Erro interno ao descartar bloco' });
		}
	};

	/**
	 * Endpoint para liberar blocos expirados manualmente.
	 */
	Blocos.releaseExpiredBlocks = async function(request, response) {
		try {
			var campaignId = request.params.id;
			var count = await Blocos.releaseExpiredBlocksInternal(campaignId);

			response.json({
				success: true,
				releasedCount: count
			});
		} catch (err) {
			await logger.error('Erro ao liberar blocos expirados', {
				module: 'blocos',
				function: 'releaseExpiredBlocks',
				metadata: { error: err.message }
			});
			response.status(500).json({ error: 'Erro interno ao liberar blocos expirados' });
		}
	};

	/**
	 * Remove todos os blocos de uma campanha (reset).
	 */
	Blocos.deleteAllBlocks = async function(request, response) {
		try {
			var campaignId = request.params.id;

			// Verificar se há blocos em inspeção ativa
			var activeCount = await blocos.count({
				campaignId: campaignId,
				status: 'assigned'
			});

			if (activeCount > 0 && !request.body.force) {
				return response.status(409).json({
					error: 'Existem ' + activeCount + ' blocos em inspeção ativa. Use force=true para forçar a remoção.',
					activeCount: activeCount
				});
			}

			var result = await blocos.deleteMany({ campaignId: campaignId });

			await logger.info('Todos os blocos removidos', {
				module: 'blocos',
				function: 'deleteAllBlocks',
				metadata: { campaignId: campaignId, deletedCount: result.deletedCount }
			});

			response.json({
				success: true,
				deletedCount: result.deletedCount
			});
		} catch (err) {
			await logger.error('Erro ao remover blocos', {
				module: 'blocos',
				function: 'deleteAllBlocks',
				metadata: { error: err.message }
			});
			response.status(500).json({ error: 'Erro interno ao remover blocos' });
		}
	};

	/**
	 * Verifica se uma campanha possui blocos configurados.
	 */
	Blocos.hasBlocks = async function(campaignId) {
		var count = await blocos.count({ campaignId: campaignId });
		return count > 0;
	};

	return Blocos;
};
