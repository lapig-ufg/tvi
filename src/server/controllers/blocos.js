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
			status: 'available',
			// Tier 2.8 (2026-05-10) — não reatribuir blocos que o inspetor já
			// pulou por ownership (todos os pontIds do bloco já têm ele em
			// userName). releaseBlockToSkipPool adiciona o username em _skippedBy
			// quando isso acontece. Filtro idempotente: se o campo não existir,
			// $ne passa naturalmente.
			_skippedBy: { $ne: username }
		};

		// Se o inspetor já completou blocos, excluir para evitar que o mesmo inspetor
		// inspecione o mesmo bloco em rodadas diferentes consecutivamente.
		// Em vez disso, ele deve pegar blocos de outros blockIndexes primeiro.
		if (completedBlockIndexes.length > 0) {
			filter.blockIndex = { $nin: completedBlockIndexes };
		}

		// Tier 2.4 (2026-05-09) — claim NÃO reseta mais currentPointOffset.
		// Antes, o claim setava currentPointOffset=0 sempre, anulando a
		// preservação que releaseExpiredBlocksInternal faz ao liberar um bloco
		// expirado. Agora, blocos novos (vindos de generateBlocks com
		// currentPointOffset:0) começam em 0 naturalmente; blocos liberados
		// retomam do offset onde o inspetor anterior parou.
		var result = await blocos.findOneAndUpdate(
			filter,
			{
				$set: {
					status: 'assigned',
					assignedTo: username,
					assignedAt: new Date()
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

		// Tier 0 (2026-05-09) — fallback removido.
		// O bloco anterior aqui executava um segundo findOneAndUpdate SEM o filtro
		// `blockIndex: $nin: completedBlockIndexes`, o que permitia entregar ao
		// usuário um bloco round-2 cujo round-1 ele mesmo havia feito. Isso quebrava
		// a função de revisão dupla (mesmo inspetor virando 1º e 2º) e gerava a
		// percepção dos inspetores de que "blocos antigos voltaram para a fila".
		// Comportamento correto: quando não há mais blocos novos para este usuário,
		// retornar null e deixar o frontend exibir mensagem clara de fila concluída.
		// Ver /tmp/tvi-investigation/DIAGNOSTICO.md §4.2 e clever-dreaming-pudding.md §0.5.
		return null; // Nenhum bloco disponível para este inspetor
	};

	/**
	 * Avança o offset do ponto atual no bloco atomicamente (incremento +1).
	 * Mantida para compatibilidade com qualquer caller restante; o caminho
	 * principal de Tier 2.3 usa advanceBlockOffsetToAtLeast.
	 *
	 * Tier 2.6 (2026-05-10) — cap em size.
	 * O filtro $expr {$lt: ['$currentPointOffset', '$size']} impede que o
	 * offset ultrapasse o tamanho do bloco em races concorrentes. Quando
	 * já está em currentPointOffset == size, o incremento é no-op e o
	 * documento atual é retornado (lookup explícito porque findOneAndUpdate
	 * com filtro que não bate retorna null). Descoberto em validação real
	 * contra mapbiomas_pastagem_col11: 2 blocos completed com offset=6 e
	 * size=5 após advance concorrente entre $inc (findPointFromBlock) e
	 * $max (Tier 2.3 advance-on-save).
	 */
	Blocos.advanceBlockOffset = async function(blockId) {
		var result = await blocos.findOneAndUpdate(
			{ _id: blockId, $expr: { $lt: ['$currentPointOffset', '$size'] } },
			{ $inc: { currentPointOffset: 1 } },
			{ returnOriginal: false, returnDocument: 'after' }
		);
		// Compat driver 2.x devolve { value: doc }; driver 6.x devolve doc direto.
		if (result) {
			return (result.value !== undefined) ? result.value : result;
		}
		// Filtro não bateu: já está em offset == size. Devolve estado atual
		// para o caller decidir (ex: chamar completeBlock).
		return await blocos.findOne({ _id: blockId });
	};

	/**
	 * Avança o offset para PELO MENOS o valor `target`, usando `$max`.
	 * Tier 2.3 (2026-05-09): chamado por updatePoint após o save bem-sucedido,
	 * informando `slot + 1` (onde slot é o índice do ponto em block.pointIds).
	 *
	 * Razões de usar $max em vez de $inc:
	 *  - O save acontece após o serve, e a UI pode permitir o usuário navegar
	 *    para frente e para trás dentro do mesmo bloco antes de salvar. $max
	 *    garante que o offset seja monotônico crescente (jamais regride) e
	 *    que saves repetidos do mesmo ponto sejam idempotentes em offset.
	 *  - $inc múltiplas vezes para o mesmo ponto causaria avanço incorreto.
	 *
	 * Retorna o bloco atualizado.
	 */
	Blocos.advanceBlockOffsetToAtLeast = async function(blockId, target) {
		if (typeof target !== 'number' || target < 0) {
			throw new Error('advanceBlockOffsetToAtLeast: target deve ser número >= 0');
		}
		// Tier 2.6 (2026-05-10) — cap em size via pipeline aggregation.
		// $max(currentPointOffset, target) e depois $min(resultado, size) evita
		// que offset ultrapasse o tamanho do bloco mesmo se target for indevido
		// (ex: pointIds duplicados levariam slot+1 a > size). Pipeline updates
		// são suportados a partir do Mongo 4.2; o projeto usa 4.4 em prod.
		var result = await blocos.findOneAndUpdate(
			{ _id: blockId },
			[
				{
					$set: {
						currentPointOffset: {
							$min: [
								{ $max: ['$currentPointOffset', target] },
								'$size'
							]
						}
					}
				}
			],
			{ returnOriginal: false, returnDocument: 'after' }
		);
		// Compat driver 2.x (legado prod) devolve { value: doc };
		// driver 6.x (uso em testes locais com Mongo 8) devolve doc direto.
		if (!result) return null;
		return (result.value !== undefined) ? result.value : result;
	};

	/**
	 * Tier 2.8 (2026-05-10) — release-on-ownership-skip.
	 *
	 * Libera o bloco de volta para o pool de disponíveis quando o inspetor
	 * atual não pode salvar nenhum dos pontos restantes (porque já consta
	 * em userName de cada um — cenário típico: ele fez round 1 e o bloco
	 * round 2 foi reentregue a ele indevidamente, ou o bloco foi liberado
	 * por timeout e voltou ao mesmo inspetor).
	 *
	 * Em vez de chamar completeBlock e perder os pontos para sempre, o bloco
	 * é devolvido com status='available' + currentPointOffset PRESERVADO + o
	 * username adicionado em _skippedBy (set, não duplica). claimNextBlock
	 * filtra _skippedBy:{$ne:username} e jamais reentrega o mesmo bloco ao
	 * usuário que já o pulou. Após Tier 2.8, blocos só viram completed
	 * quando algum save real preenche todos os pontos do bloco.
	 */
	Blocos.releaseBlockToSkipPool = async function(blockId, username) {
		var result = await blocos.findOneAndUpdate(
			{ _id: blockId },
			{
				$set: { status: 'available', assignedTo: null, assignedAt: null },
				$addToSet: { _skippedBy: username }
				// currentPointOffset PRESERVADO (mesma semântica de Tier 2.4)
			},
			{ returnOriginal: false, returnDocument: 'after' }
		);
		if (!result) return null;
		return (result.value !== undefined) ? result.value : result;
	};

	/**
	 * Marca um bloco como completado.
	 *
	 * Tier 2.6 (2026-05-10) — cap defensivo: força currentPointOffset = $size
	 * via pipeline update. Garante invariante visual mesmo se algum caller
	 * legado tiver bypassed advanceBlockOffset/advanceBlockOffsetToAtLeast.
	 */
	Blocos.completeBlock = async function(blockId) {
		await blocos.updateOne(
			{ _id: blockId },
			[
				{
					$set: {
						status: 'completed',
						completedAt: new Date(),
						currentPointOffset: { $min: ['$currentPointOffset', '$size'] }
					}
				}
			]
		);
	};

	/**
	 * Libera blocos expirados (timeout) de uma campanha.
	 *
	 * Tier 2.4 (2026-05-09): antes de liberar, grava snapshot dos blocos
	 * em tvi_blocos_release_log (previousAssignedTo, previousOffset, expiredAt)
	 * para permitir reconstrução do histórico de quem trabalhou em cada bloco
	 * antes do timeout. Adicionalmente, **CONSERVA** currentPointOffset em
	 * vez de zerá-lo: o próximo inspetor que pegar o bloco retoma do mesmo
	 * ponto onde o anterior parou (sem ter que refazer pontos já salvos
	 * individualmente em points). Isso evita o ciclo perverso documentado
	 * no DIAGNOSTICO §4.5 (release → reset → re-push → F10/correctCampaign
	 * trim → perda de inspeção).
	 */
	Blocos.releaseExpiredBlocksInternal = async function(campaignId) {
		var now = new Date();

		var expiredBlocks = await blocos.find({
			campaignId: campaignId,
			status: 'assigned',
			assignedAt: { $ne: null }
		}).toArray();

		var expiredOnes = expiredBlocks.filter(function(block) {
			var expirationTime = new Date(block.assignedAt.getTime() + (block.timeoutMinutes * 60 * 1000));
			return now > expirationTime;
		});

		if (expiredOnes.length === 0) {
			return 0;
		}

		var releaseLog = app.repository && app.repository.collections && app.repository.collections.tvi_blocos_release_log;
		if (releaseLog) {
			var snapshotDocs = expiredOnes.map(function(block) {
				return {
					blockId: block._id,
					campaignId: block.campaignId,
					blockIndex: block.blockIndex,
					inspectionRound: block.inspectionRound,
					previousAssignedTo: block.assignedTo,
					previousAssignedAt: block.assignedAt,
					previousOffset: block.currentPointOffset,
					blockSize: block.size,
					timeoutMinutes: block.timeoutMinutes,
					expiredAt: now,
					releaseReason: 'timeout'
				};
			});
			// Tier 2.7 (2026-05-10) — dedupe via bulkWrite ordered:false +
			// índice único parcial em (blockId, previousAssignedAt). Sob
			// concorrência (50 inspetores chamando claimNextBlock simultâneo),
			// releaseExpiredBlocksInternal é executado N vezes em paralelo
			// e cada chamada VÊ os mesmos blocos como expired antes do
			// updateMany do passo seguinte mudá-los para 'available'. Sem
			// dedupe, o release_log inflava com N snapshots para uma única
			// expiração real. Aqui aceitamos erros 11000 (duplicate key) como
			// no-op silenciosos; outros erros continuam a ser logados.
			// O índice é criado em middleware/repository.js no bootstrap.
			try {
				var bulkOps = snapshotDocs.map(function (d) { return { insertOne: { document: d } }; });
				await releaseLog.bulkWrite(bulkOps, { ordered: false });
			} catch (err) {
				var writeErrors = (err.writeErrors || (err.result && err.result.writeErrors) || []);
				var allDuplicates = writeErrors.length > 0 && writeErrors.every(function (e) {
					var code = e.code || (e.err && e.err.code);
					return code === 11000;
				});
				if (allDuplicates) {
					// Dedupe esperado em concorrência; logar como info para auditoria.
					await logger.info('release_log dedupe: snapshots duplicados ignorados', {
						module: 'blocos',
						function: 'releaseExpiredBlocksInternal',
						metadata: { campaignId: campaignId, attempted: snapshotDocs.length, duplicatesIgnored: writeErrors.length }
					});
				} else {
					// Erro real (não duplicate key) — registrar mas não impedir liberação.
					await logger.error('Falha ao gravar tvi_blocos_release_log', {
						module: 'blocos',
						function: 'releaseExpiredBlocksInternal',
						metadata: { campaignId: campaignId, count: snapshotDocs.length, error: err.message, writeErrorsCount: writeErrors.length }
					});
				}
			}
		} else {
			await logger.warn('tvi_blocos_release_log indisponível; liberação prosseguirá sem snapshot', {
				module: 'blocos', function: 'releaseExpiredBlocksInternal',
				metadata: { campaignId: campaignId }
			});
		}

		var expiredIds = expiredOnes.map(function(b) { return b._id; });

		await blocos.updateMany(
			{ _id: { $in: expiredIds } },
			{
				$set: {
					status: 'available',
					assignedTo: null,
					assignedAt: null
					// currentPointOffset CONSERVADO (Tier 2.4) — não zera mais.
					// Próximo inspetor retoma do offset onde o anterior parou.
				}
			}
		);

		await logger.info('Blocos expirados liberados', {
			module: 'blocos',
			function: 'releaseExpiredBlocksInternal',
			metadata: { campaignId: campaignId, count: expiredIds.length, snapshotted: !!releaseLog }
		});

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

			// Tier 1.6 (2026-05-09) — remoção do inspetor migrada para
			// pointsService.removeInspectorByIndex: cada operação grava snapshot
			// before/after em points_audit, permitindo restore via
			// /api/admin/points/:pointId/restore se o discard foi por engano.
			if (inspectorName) {
				var pointsService = app.services && app.services.pointsService;
				if (!pointsService) {
					await logger.error('discardBlock: pointsService indisponível', {
						module: 'blocos', function: 'discardBlock',
						metadata: { campaignId, blockIndex }
					});
					return response.status(500).json({ error: 'pointsService indisponível' });
				}

				var ctx = {
					actor: {
						username: discardedBy,
						role: 'admin',
						sessionId: (request.session && request.sessionID) || null,
						ip: request.ip || null
					},
					reason: reason && reason.trim().length >= 10 ? reason.trim() : 'discardBlock blockIndex=' + blockIndex + ' round=' + inspectionRound,
					blockId: block._id
				};

				for (var i = 0; i < block.pointIds.length; i++) {
					var pointId = block.pointIds[i];
					try {
						await pointsService.removeInspectorByIndex(pointId, inspectorName, ctx);
					} catch (perr) {
						// Log e segue — um erro em um ponto não deve abortar o discard inteiro,
						// pois o bloco já foi marcado como discarded acima e o estado parcial
						// é detectável via points_audit.
						await logger.error('discardBlock: falha ao remover inspetor de um ponto', {
							module: 'blocos', function: 'discardBlock',
							metadata: { pointId, inspectorName, error: perr.message }
						});
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

	/**
	 * Tier 2.10 (2026-05-14) — detecção de "pontos zumbi".
	 *
	 * Ponto zumbi: ponto cuja posição em TODOS os blocos da campanha
	 * (em todos os rounds) já foi ultrapassada — currentPointOffset > pos
	 * OU bloco status='completed'/'discarded' — E cujo userName.length
	 * ainda é menor que numInspec. Resultado: o ponto não tem mais caminho
	 * de inspeção dentro da estrutura atual de blocos.
	 *
	 * Causa raiz (antes do Tier 2.10): o avanço-no-serve em findPointFromBlock
	 * permitia que pontos servidos mas não salvos ficassem pulados. Após
	 * o Tier 2.10 isso não ocorre mais, mas zumbis pré-existentes precisam
	 * de recuperação via generateRecoveryBlocks.
	 */
	Blocos.findZombiePointIds = async function(campaignId) {
		var campaign = await campaigns.findOne({ _id: campaignId });
		if (!campaign) return [];
		var numInspec = campaign.numInspec || 1;

		var rows = await blocos.aggregate([
			{ $match: { campaignId: campaignId } },
			{ $project: { _id: 0, inspectionRound: 1, status: 1, currentPointOffset: 1, pointIds: 1 } },
			{ $unwind: { path: '$pointIds', includeArrayIndex: 'pos' } },
			{ $project: {
				pointId: '$pointIds',
				round: '$inspectionRound',
				servedPast: { $cond: [{ $or: [
					{ $eq: ['$status', 'completed'] },
					{ $eq: ['$status', 'discarded'] },
					{ $gt: ['$currentPointOffset', '$pos'] }
				]}, 1, 0] }
			}},
			{ $group: {
				_id: { pointId: '$pointId', round: '$round' },
				roundServedPast: { $min: '$servedPast' }
			}},
			{ $group: {
				_id: '$_id.pointId',
				roundsAllPast: { $sum: '$roundServedPast' },
				roundsTotal: { $sum: 1 }
			}},
			{ $match: { $expr: { $and: [
				{ $eq: ['$roundsAllPast', '$roundsTotal'] },
				{ $eq: ['$roundsTotal', numInspec] }
			]}}},
			{ $lookup: { from: 'points', localField: '_id', foreignField: '_id', as: 'pt' } },
			{ $unwind: '$pt' },
			{ $match: { $expr: { $lt: [ { $size: { $ifNull: ['$pt.userName', []] } }, numInspec ] } } },
			{ $project: {
				_id: 1,
				userNameLen: { $size: { $ifNull: ['$pt.userName', []] } },
				index: '$pt.index'
			}},
			{ $sort: { userNameLen: 1, index: 1 } }
		], { allowDiskUse: true }).toArray();

		return rows;
	};

	/**
	 * Tier 2.10 (2026-05-14) — relatório de zumbis para endpoint admin.
	 *
	 * Retorna { total, byUserNameLength: {<len>: count}, sample: [...] }.
	 * Amostra limitada a `sampleSize` pontos (default 50).
	 */
	Blocos.getZombiesReport = async function(request, response) {
		try {
			var campaignId = request.params.id;
			var sampleSize = parseInt((request.query && request.query.sampleSize) || '50', 10);
			if (isNaN(sampleSize) || sampleSize < 1) sampleSize = 50;
			if (sampleSize > 500) sampleSize = 500;

			var zombies = await Blocos.findZombiePointIds(campaignId);

			var byLen = {};
			zombies.forEach(function(z) {
				var k = String(z.userNameLen);
				byLen[k] = (byLen[k] || 0) + 1;
			});

			response.json({
				campaignId: campaignId,
				total: zombies.length,
				byUserNameLength: byLen,
				sample: zombies.slice(0, sampleSize).map(function(z) {
					return { _id: z._id, index: z.index, userNameLen: z.userNameLen };
				})
			});
		} catch (err) {
			await logger.error('Erro ao gerar relatório de zumbis', {
				module: 'blocos', function: 'getZombiesReport',
				metadata: { error: err.message }
			});
			response.status(500).json({ error: 'Erro interno ao gerar relatório de zumbis' });
		}
	};

	/**
	 * Tier 2.10 (2026-05-14) — gera blocos de recovery para pontos zumbi.
	 *
	 * Para cada valor de userName.length L < numInspec entre os zumbis,
	 * cria blocos novos com inspectionRound = L (guard Tier 2.9 exige
	 * length == round para servir). Os blocos têm blockIndex maior que o
	 * máximo atual e flag isRecovery=true para auditoria.
	 *
	 * Guard de idempotência: descarta pointIds já presentes em algum bloco
	 * available/assigned antes de criar.
	 */
	Blocos.generateRecoveryBlocks = async function(request, response) {
		try {
			var campaignId = request.params.id;
			var blockSize = parseInt((request.body && request.body.blockSize) || '5', 10);
			if (blockSize < 1 || blockSize > 1000) blockSize = 5;

			var zombies = await Blocos.findZombiePointIds(campaignId);
			if (zombies.length === 0) {
				return response.json({ success: true, created: 0, message: 'Nenhum zumbi encontrado.' });
			}

			// Idempotência: excluir pointIds que já estão em bloco available/assigned
			var zombieIds = zombies.map(function(z) { return z._id; });
			var stillActive = await blocos.find({
				campaignId: campaignId,
				status: { $in: ['available', 'assigned'] },
				pointIds: { $in: zombieIds }
			}, { pointIds: 1 }).toArray();
			var activeIds = {};
			stillActive.forEach(function(b) {
				(b.pointIds || []).forEach(function(pid) { activeIds[pid] = true; });
			});
			var eligible = zombies.filter(function(z) { return !activeIds[z._id]; });
			if (eligible.length === 0) {
				return response.json({
					success: true, created: 0,
					message: 'Todos os zumbis já constam em blocos available/assigned.'
				});
			}

			// Próximo blockIndex (continua a sequência existente)
			var maxBlockAgg = await blocos.aggregate([
				{ $match: { campaignId: campaignId } },
				{ $group: { _id: null, maxIdx: { $max: '$blockIndex' } } }
			]).toArray();
			var nextBlockIndex = (maxBlockAgg[0] && maxBlockAgg[0].maxIdx ? maxBlockAgg[0].maxIdx : 0) + 1;

			// Herdar timeoutMinutes do bloco mais recente
			var latestBlock = await blocos.findOne(
				{ campaignId: campaignId },
				{ sort: { createdAt: -1 } }
			);
			var timeoutMinutes = (latestBlock && latestBlock.timeoutMinutes) || 480;

			// Agrupar zumbis por userNameLen → inspectionRound
			var byLen = {};
			eligible.forEach(function(z) {
				var L = z.userNameLen;
				if (!byLen[L]) byLen[L] = [];
				byLen[L].push(z._id);
			});

			var now = new Date();
			var blocksToInsert = [];

			Object.keys(byLen).forEach(function(LStr) {
				var inspectionRound = parseInt(LStr, 10); // Tier 2.9: length == round
				var ids = byLen[LStr];
				for (var i = 0; i < ids.length; i += blockSize) {
					var chunk = ids.slice(i, i + blockSize);
					blocksToInsert.push({
						campaignId: campaignId,
						blockIndex: nextBlockIndex++,
						inspectionRound: inspectionRound,
						pointIndexStart: null,
						pointIndexEnd: null,
						pointIds: chunk,
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
						_skippedBy: [],
						isRecovery: true,
						recoveryCreatedAt: now,
						createdAt: now
					});
				}
			});

			if (blocksToInsert.length === 0) {
				return response.json({ success: true, created: 0, message: 'Nada a criar.' });
			}

			await blocos.insertMany(blocksToInsert);

			await logger.info('Blocos de recovery criados', {
				module: 'blocos', function: 'generateRecoveryBlocks',
				metadata: {
					campaignId: campaignId,
					blocksCreated: blocksToInsert.length,
					pointsRecovered: eligible.length,
					blockSize: blockSize
				}
			});

			response.json({
				success: true,
				created: blocksToInsert.length,
				pointsRecovered: eligible.length,
				blockSize: blockSize,
				blockIndexRange: {
					from: blocksToInsert[0].blockIndex,
					to: blocksToInsert[blocksToInsert.length - 1].blockIndex
				}
			});
		} catch (err) {
			await logger.error('Erro ao gerar blocos de recovery', {
				module: 'blocos', function: 'generateRecoveryBlocks',
				metadata: { error: err.message, stack: err.stack }
			});
			response.status(500).json({ error: 'Erro interno ao gerar blocos de recovery' });
		}
	};

	return Blocos;
};
