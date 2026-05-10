const proj4 = require('proj4');

module.exports = function(app) {
	// Usar o logger do app
	const logger = app.services.logger;

	var Points = {};
	var points = app.repository.collections.points;
	var mosaics = app.repository.collections.mosaics;
	var status = app.repository.collections.status;
	var blocosCollection = app.repository.collections.tvi_blocos;

	// -------------------------------------------------------------------------
	// Fallback case-insensitive para filtros de bioma/UF (TKT-000010).
	// Replicado do supervisor.js para manter o controlador admin alinhado,
	// sem introduzir dependência cruzada entre os módulos.
	// -------------------------------------------------------------------------
	const BIOME_PROPERTY_KEYS = ['biome', 'Biome', 'BIOME', 'bioma', 'Bioma', 'BIOMA'];
	const UF_PROPERTY_KEYS = [
		'uf', 'UF', 'Uf',
		'estado', 'Estado', 'ESTADO',
		'sigla_uf', 'SIGLA_UF', 'sigla_estado', 'SIGLA_ESTADO',
		'unidade_federacao', 'UNIDADE_FEDERACAO',
		'unidade_federativa', 'UNIDADE_FEDERATIVA'
	];

	function buildResolvedFieldExpression(topLevelField, propertyKeys) {
		var expr = '$' + topLevelField;
		for (var i = 0; i < propertyKeys.length; i++) {
			expr = { $ifNull: [expr, '$properties.' + propertyKeys[i]] };
		}
		return expr;
	}

	function biomeOrClause(value) {
		return BIOME_PROPERTY_KEYS
			.map(function (k) { return { ['properties.' + k]: value }; })
			.concat([{ biome: value }]);
	}

	function ufOrClause(value) {
		return UF_PROPERTY_KEYS
			.map(function (k) { return { ['properties.' + k]: value }; })
			.concat([{ uf: value }]);
	}

	var getImageDates = function(path, row, callback) {
		var filterMosaic = {'dates.path': path, 'dates.row': row };
		var projMosaic = { dates: {$elemMatch: {path: path, row: row }}};

		// Timeout para evitar travamentos
		var timeoutId = setTimeout(async function() {
			await logger.warn(`getImageDates timeout for path: ${path}, row: ${row}`, {
				module: 'points',
				function: 'getImageDates',
				metadata: { path, row }
			});
			callback({}); // Retorna resultado vazio em caso de timeout
		}, 10000); // 10 segundos

		mosaics.find(filterMosaic,projMosaic).toArray(async function(err, docs) {
			clearTimeout(timeoutId);
			
			if (err) {
				await logger.error('Error in getImageDates', {
					module: 'points',
					function: 'getImageDates',
					metadata: { error: err.message, path, row }
				});
				return callback({});
			}

			var result = {}

			docs.forEach(function(doc) {
				if (doc.dates && doc.dates[0]) {
					result[doc._id] = doc.dates[0]['date']
				}
			})

			callback(result)
		})
	}

	getWindow = function(point) {
		var buffer = 4000
		var coordinates = proj4('EPSG:4326', 'EPSG:900913', [point.lon, point.lat])

		var ulx = coordinates[0] - buffer
		var uly = coordinates[1] + buffer
		var lrx = coordinates[0] + buffer
		var lry = coordinates[1] - buffer

		var ul = proj4('EPSG:900913', 'EPSG:4326', [ulx, uly])
		var lr = proj4('EPSG:900913', 'EPSG:4326', [lrx, lry])

		return [[ul[1], ul[0]], [lr[1], lr[0]]]
	}

	var findPoint = async function(campaign, username, callback) {
		await logger.info('Starting findPoint', {
			module: 'points',
			function: 'findPoint',
			metadata: { campaign: campaign._id, username, numInspec: campaign.numInspec }
		});

		// TKT-000015 — o cleanup pesado (updateMany em todos os pontos da campanha
		// com underInspection > 0) foi movido para o job `orphanPointsCleanup`
		// em `middleware/jobs.js`, que roda a cada 5 minutos. Aqui mantemos apenas
		// a garantia de que o ponto atual do usuário (se qualquer ficou em estado
		// inconsistente) é liberado — custo O(1).
		try {
			await status.updateOne(
				{ _id: username + '_' + campaign._id },
				{ $set: { lastSeen: new Date() } }
			);
		} catch (_) {
			// não bloqueia o fluxo; cleanup completo ocorrerá no job.
		}

		// TKT-000015 — `$where` removido por ser não-indexável (JavaScript server-side
		// avaliado linha a linha). Substituído pelo campo denormalizado `userNameCount`,
		// incrementado atomicamente em `updatePoint`. O índice composto
		// `campaign_inspection_index` (campaign, underInspection, userNameCount, index)
		// cobre essa consulta. Documentos legados sem `userNameCount` caem no ramo
		// de retrocompatibilidade (usando $size enumerado), até que o script
		// `scripts/backfill-userNameCount.js` popule o campo.
		var legacyBranches = [];
		for (var __s = 0; __s < campaign.numInspec; __s++) {
			legacyBranches.push({
				"userNameCount": { "$exists": false },
				"userName": { "$size": __s }
			});
		}

		var findOneFilter = {
			"$and": [
				{ "campaign": { "$eq": campaign._id } },
				{ "userName": { "$nin": [ username ] } },
				{ "underInspection": { $lt: campaign.numInspec } },
				{
					"$or": [
						{ "userNameCount": { "$exists": true, "$lt": campaign.numInspec } }
					].concat(legacyBranches)
				}
			]
		};

		// O filtro "currentFilter" era usado antigamente para busca por índice ordinal.
		// Mantido como simples filtro por campanha para não quebrar chamadores existentes.
		var currentFilter = {
			"$and": [
				{ "userName": { "$nin": [ username ] } },
				{ "campaign": { "$eq":  campaign._id } }
			]
		};

		var countFilter = {
			"$and": [
				{"userName": {$in: [username]}},
				{"campaign": campaign._id}
			]
		};

		var totalFilter = { 
			"$and": [
				{"campaign": { "$eq":  campaign._id }}
			]
		};

		var findOneSort = [['index', 1]]
		var findOneUpdate = {'$inc': {'underInspection': 1}}

		//points.findOne(findOneFilter, { sort: [['index', 1]] }, function(err, point) {
		await logger.info('[FINDPOINT] Executing findAndModify with filter', {
			module: 'points',
			function: 'findPoint',
			metadata: { filter: JSON.stringify(findOneFilter) }
		});
		points.findAndModify(findOneFilter, findOneSort, findOneUpdate, {}, async function(err, object) {
			await logger.info('[FINDPOINT] findAndModify completed', {
				module: 'points',
				function: 'findPoint',
				metadata: { err: !!err, hasObject: !!object, hasValue: !!(object && object.value) }
			});
			
			if (err) {
				const logId = await logger.error('[FINDPOINT] findAndModify error', {
					module: 'points',
					function: 'findPoint',
					metadata: { error: err.message, campaign: campaign._id, username }
				});
				return callback({ error: 'Database error in findAndModify', logId });
			}
			
			point = object.value
			if(point) {
				await logger.info('[FINDPOINT] Point found, getting counts', {
					module: 'points',
					function: 'findPoint',
					metadata: { pointId: point._id }
				});
				points.count(totalFilter, async function(err, total) {
					await logger.info('[FINDPOINT] Total count completed', {
						module: 'points',
						function: 'findPoint',
						metadata: { err: !!err, total }
					});
					if (err) {
						const logId = await logger.error('[FINDPOINT] Total count error', {
							module: 'points',
							function: 'findPoint',
							metadata: { error: err.message }
						});
						return callback({ error: 'Database error in total count', logId });
					}
					
					points.count(countFilter, async function (err, count) {
						await logger.info('User count completed', {
							module: 'points',
							function: 'findPoint',
							metadata: { err: !!err, count }
						});
						if (err) {
							await logger.error('User count error', {
								module: 'points',
								function: 'findPoint',
								metadata: { error: err.message }
							});
							return callback({ error: 'Database error in user count' });
						}
						
						await logger.info('Getting image dates', {
							module: 'points',
							function: 'findPoint',
							metadata: { path: point.path, row: point.row }
						});
						getImageDates(point.path, point.row, async function(dates) {
							await logger.info('Image dates completed, finalizing result', {
								module: 'points',
								function: 'findPoint'
							});
							point.dates = dates

							point.bounds = getWindow(point)

							var statusId = username+"_"+campaign._id
							status.updateOne({"_id": statusId}, {
								$set:{
											"campaign": campaign._id,
											"status": "Online",
											"name": username,
											"atualPoint": point._id,
											"dateLastPoint": new Date()
								}}, {
									upsert: true
							})

							var result = {};
							result['point'] = point;
							result['total'] = total;
							result['current'] = point.index;
							result['user'] = username;
							result['count'] = count;

							await logger.info('Sending result back to callback', {
								module: 'points',
								function: 'findPoint'
							});
							callback(result);
						})
					})
				});
			} else {
				await logger.info('No point found, getting counts for empty result', {
					module: 'points',
					function: 'findPoint'
				});
				points.count(totalFilter, async function(err, total) {
					await logger.info('Total count (no point) completed', {
						module: 'points',
						function: 'findPoint',
						metadata: { err: !!err, total }
					});
					if (err) {
						await logger.error('Total count (no point) error', {
							module: 'points',
							function: 'findPoint',
							metadata: { error: err.message }
						});
						return callback({ error: 'Database error in total count (no point)' });
					}
					
					points.count(countFilter, async function(err, count) {
						await logger.info('User count (no point) completed', {
							module: 'points',
							function: 'findPoint',
							metadata: { err: !!err, count }
						});
						if (err) {
							await logger.error('User count (no point) error', {
								module: 'points',
								function: 'findPoint',
								metadata: { error: err.message }
							});
							return callback({ error: 'Database error in user count (no point)' });
						}
						
						var result = {};
						result['point'] = {};
						result['total'] = total;
						result['current'] = total
						result['user'] = username;
						result['count'] = count;
						
						await logger.info('Sending empty result back to callback', {
							module: 'points',
							function: 'findPoint'
						});
						callback(result);
					})
				});
			}
		});
	};

	/**
	 * Busca o próximo ponto a partir do sistema de blocos.
	 * Atribui um bloco ao inspetor (ou reutiliza o ativo), retorna o ponto atual
	 * e avança o offset. Mantém o mesmo formato de resposta de findPoint().
	 */
	var findPointFromBlock = async function(campaign, username, callback) {
		try {
			await logger.info('findPointFromBlock: iniciando', {
				module: 'points',
				function: 'findPointFromBlock',
				metadata: { campaign: campaign._id, username: username }
			});

			var blocosController = app.controllers.blocos;
			var block = await blocosController.claimNextBlock(campaign._id, username);

			if (!block) {
				// Nenhum bloco disponível — inspeção completa
				var totalFilter = { campaign: campaign._id };
				var countFilter = { campaign: campaign._id, userName: { $in: [username] } };

				var total = await points.count(totalFilter);
				var count = await points.count(countFilter);

				return callback({
					point: {},
					total: total,
					current: total,
					user: username,
					count: count
				});
			}

			// Verificar se o bloco já foi completamente servido
			if (block.currentPointOffset >= block.size) {
				await blocosController.completeBlock(block._id);

				// Recursão: buscar próximo bloco
				return findPointFromBlock(campaign, username, callback);
			}

			// Buscar o ponto correspondente ao offset atual
			var pointId = block.pointIds[block.currentPointOffset];
			var point = await points.findOne({ _id: pointId });

			if (!point) {
				await logger.warn('findPointFromBlock: ponto não encontrado no bloco', {
					module: 'points',
					function: 'findPointFromBlock',
					metadata: { pointId: pointId, blockId: block._id }
				});

				// Avançar offset e tentar próximo ponto
				await blocosController.advanceBlockOffset(block._id);
				return findPointFromBlock(campaign, username, callback);
			}

			// Incrementar underInspection no ponto
			await points.updateOne(
				{ _id: point._id },
				{ $inc: { underInspection: 1 } }
			);
			point.underInspection = (point.underInspection || 0) + 1;

			// Tier 2.3 (2026-05-09) — comportamento ORIGINAL preservado.
			// O avanço do offset continua acontecendo aqui (no serve do ponto)
			// para não impactar o fluxo do inspetor que pode navegar entre
			// pontos sem salvar. updatePoint adicionalmente faz $max(slot+1)
			// após o save para garantir que o offset reflita pontos
			// efetivamente persistidos — operação idempotente, no-op quando
			// o offset já está no valor desejado.
			var updatedBlock = await blocosController.advanceBlockOffset(block._id);
			if (updatedBlock && updatedBlock.currentPointOffset >= updatedBlock.size) {
				await blocosController.completeBlock(block._id);
			}

			// Enriquecer ponto com dados de imagem e janela
			getImageDates(point.path, point.row, async function(dates) {
				point.dates = dates;
				point.bounds = getWindow(point);

				// Atualizar status do inspetor
				var statusId = username + '_' + campaign._id;
				status.updateOne({ _id: statusId }, {
					$set: {
						campaign: campaign._id,
						status: 'Online',
						name: username,
						atualPoint: point._id,
						dateLastPoint: new Date()
					}
				}, { upsert: true });

				// Contagens
				var totalFilter = { campaign: campaign._id };
				var countFilter = { campaign: campaign._id, userName: { $in: [username] } };

				var total = await points.count(totalFilter);
				var count = await points.count(countFilter);

				var result = {
					point: point,
					total: total,
					current: point.index,
					user: username,
					count: count,
					block: {
						blockIndex: block.blockIndex,
						inspectionRound: block.inspectionRound,
						progress: (block.currentPointOffset + 1) + '/' + block.size
					}
				};

				callback(result);
			});

		} catch (err) {
			await logger.error('Erro em findPointFromBlock', {
				module: 'points',
				function: 'findPointFromBlock',
				metadata: { error: err.message, stack: err.stack }
			});
			callback({ error: 'Erro interno no sistema de blocos' });
		}
	};

	var classConsolidate = function(point, pointDb, user) {
		var landUseInspections = {}
		var classConsolidated = []

		pointDb.inspection.push(point.inspection)

		for(var i in pointDb.inspection) {
			
			var inspection = pointDb.inspection[i]
			for(var j in inspection.form) {

				var form = inspection.form[j]
				for(var year=form.initialYear; year<= form.finalYear; year++) {

					if(!landUseInspections[year])
						landUseInspections[year] = [];

					landUseInspections[year].push(form.landUse)
				}

			}

		}

		for(var year=user.campaign.initialYear; year<= user.campaign.finalYear; year++) {
			var landUseCount = {};
			var flagConsolid = false;

			for(var i=0; i < landUseInspections[year].length; i++) {
				var landUse = landUseInspections[year][i]

				if(!landUseCount[landUse])
					landUseCount[landUse]=0

				landUseCount[landUse]++
			}

			var numElemObj = Object.keys(landUseCount).length;
			var countNumElem = 0;

			for(var landUse in landUseCount) {
				countNumElem++

				if(landUseCount[landUse] > user.campaign.numInspec/2 && flagConsolid == false) {
					flagConsolid = true;
					classConsolidated.push(landUse)

				} else if(numElemObj == countNumElem && flagConsolid == false) {
					flagConsolid = true;
					classConsolidated.push("Não consolidado")
				}
			}
		}

		return { "classConsolidated": classConsolidated }
	}

	Points.getCurrentPoint = async function(request, response) {
		try {
			// Verificar se a sessão existe antes de acessar
			if (!request.session) {
				await logger.error('No session middleware configured', {
					module: 'points',
					function: 'next',
					req: request
				});
				return response.status(500).json({ 
					error: 'Session middleware not configured'
				});
			}

			var user = request.session.user;

			if (!user || !user.campaign) {
				// Não passar o request completo para o logger para evitar referências circulares
				const errorCode = await logger.warn('Get current point attempted without valid user session', {
					module: 'points',
					function: 'getCurrentPoint',
					metadata: { 
						hasUser: !!user, 
						hasSession: !!request.session,
						sessionId: request.sessionID,
						url: request.url,
						method: request.method
					}
				});
				
				return response.status(401).json({ 
					error: 'Valid user session required',
					errorCode
				});
			}

			await logger.info('Getting current point for user', {
				module: 'points',
				function: 'getCurrentPoint',
				metadata: {
					username: user.name,
					campaignId: user.campaign._id,
					campaignName: user.campaign.name,
					sessionId: request.sessionID,
					url: request.url
				}
			});

			// Roteamento condicional: blocos vs. legado
			var hasBlocks = await blocosCollection.count({ campaignId: user.campaign._id });
			var findFn = hasBlocks > 0 ? findPointFromBlock : findPoint;

			findFn(user.campaign, user.name, async function(result) {
				try {
					request.session.currentPointId = result.point._id;
					// Incluir dados da campanha na resposta
					result.campaign = user.campaign;

					await logger.info('Current point retrieved successfully', {
						module: 'points',
						function: 'getCurrentPoint',
						metadata: {
							pointId: result.point._id,
							pointIndex: result.current,
							totalPoints: result.total,
							userCount: result.count,
							username: user.name,
							sessionId: request.sessionID
						}
					});

					response.send(result);
					response.end();
				} catch (error) {
					const errorCode = await logger.error('Error processing current point result', {
								module: 'points',
						function: 'getCurrentPoint',
						metadata: {
							error: error.message,
							stack: error.stack
						}
					});

					response.status(500).json({
						error: 'Error processing point data',
						errorCode
					});
				}
			})
		} catch (error) {
			const errorCode = await logger.error('Unexpected error in getCurrentPoint', {
				module: 'points',
				function: 'getCurrentPoint',
				metadata: {
					error: error.message,
					stack: error.stack
				}
			});

			response.status(500).json({
				error: 'Internal server error',
				errorCode
			});
		}
	};

	Points.updatePoint = async function(request, response) {
		// Tier 1.6 (2026-05-09) — migrado para pointsService.appendInspection.
		// Cada save de inspeção passa a registrar snapshot before/after em
		// points_audit, e a tentativa de duplicar o mesmo inspetor no ponto
		// agora retorna 409 (defesa em profundidade — Tier 2.2 ainda reforça
		// na camada do controller com ownership check do bloco).
		// A consolidação (classConsolidated) continua acontecendo quando
		// pointDb.userName.length === numInspec - 1 (mesma semântica do
		// código original), mas a escrita vai por pointsService.setClassConsolidated
		// para também ficar auditada.
		try {
			var point = request.body.point;
			var user = request.session.user;

			if (!user || !user.campaign) {
				const errorCode = await logger.warn('Update point attempted without valid user session', {
					module: 'points', function: 'updatePoint',
					metadata: { hasUser: !!user, hasCampaign: !!(user && user.campaign) }
				});
				return response.status(401).json({ error: 'Valid user session required', errorCode });
			}

			if (!point || !point._id) {
				const errorCode = await logger.warn('Update point attempted without valid point data', {
					module: 'points', function: 'updatePoint',
					metadata: { username: user.name, hasPoint: !!point, hasPointId: !!(point && point._id) }
				});
				return response.status(400).json({ error: 'Valid point data required', errorCode });
			}

			await logger.info('Starting point update', {
				module: 'points', function: 'updatePoint',
				metadata: {
					pointId: point._id, username: user.name,
					campaignId: user.campaign._id, hasInspection: !!(point.inspection)
				}
			});

			point.inspection.fillDate = new Date();

			const pointsService = app.services && app.services.pointsService;
			if (!pointsService) {
				return response.status(500).json({ error: 'pointsService indisponível' });
			}
			const blocosController = app.controllers && app.controllers.blocos;
			const blocosCol = app.repository && app.repository.collections && app.repository.collections.tvi_blocos;

			// Tier 2.1 (2026-05-09) — ownership check em MODO SOMBRA.
			// Apenas DETECTA e LOGA quando o save chega de um inspetor cujo
			// bloco já não está mais atribuído a ele (timeout + realocação).
			// NÃO REJEITA o save — preserva integralmente o fluxo existente
			// do inspetor para evitar travar trabalho legítimo durante a fase
			// de observação. Após uma sprint sem warnings indevidos em
			// produção, esta seção pode ser endurecida para retornar 409.
			// Procuramos ativamente blockOwning para reaproveitar no avanço
			// de offset (Tier 2.3 também em modo sombra abaixo).
			let blockOwning = null;
			if (blocosCol) {
				const hasBlocks = await blocosCol.count({ campaignId: user.campaign._id });
				if (hasBlocks > 0) {
					blockOwning = await blocosCol.findOne({
						campaignId: user.campaign._id,
						pointIds: point._id,
						assignedTo: user.name,
						status: 'assigned'
					});
					if (!blockOwning) {
						// Tenta achar QUALQUER bloco com este ponto para descrever
						// melhor o estado encontrado (apenas para o log).
						const anyBlock = await blocosCol.findOne({
							campaignId: user.campaign._id,
							pointIds: point._id,
							inspectionRound: 1
						}, { sort: { inspectionRound: 1 } });
						await logger.warn('Tier 2.1 shadow: save chega sem ownership do bloco', {
							module: 'points', function: 'updatePoint',
							metadata: {
								pointId: point._id,
								username: user.name,
								campaignId: user.campaign._id,
								observedBlockAssignedTo: anyBlock && anyBlock.assignedTo,
								observedBlockStatus: anyBlock && anyBlock.status
							}
						});
					}
				}
			}

			// Carrega o documento ANTES (igual ao código legado) para
			// (a) decidir consolidação com base em userName.length
			// (b) reaproveitar como pointDbBefore no service (evita findOne duplicado)
			const pointDb = await points.findOne({ _id: point._id });
			if (!pointDb) {
				const errorCode = await logger.warn('Point not found for update', {
					module: 'points', function: 'updatePoint',
					metadata: { pointId: point._id, username: user.name }
				});
				return response.status(404).json({ error: 'Point not found', errorCode });
			}

			// Mesma condição de consolidação do código pré-Tier 1: dispara quando o
			// próximo $push completar `numInspec` entradas em userName.
			let consolidatedValue = null;
			if (pointDb.userName && pointDb.userName.length === user.campaign.numInspec - 1) {
				consolidatedValue = classConsolidate(point, pointDb, user).classConsolidated;
				await logger.info('Point inspection complete - consolidating classification', {
					module: 'points', function: 'updatePoint',
					metadata: {
						pointId: point._id, username: user.name,
						inspectionCount: pointDb.userName.length + 1,
						requiredInspections: user.campaign.numInspec
					}
				});
			}

			const ctx = {
				actor: {
					username: user.name,
					role: user.role || 'inspector',
					sessionId: request.sessionID || null,
					ip: request.ip || null
				},
				// updatePoint é fluxo natural do inspetor — não exige token; reason
				// padrão para auditoria identificar a origem.
				reason: 'inspector save via /service/points/update-point'
			};

			try {
				await pointsService.appendInspection(point._id, user.name, point.inspection, ctx, {
					pointDbBefore: pointDb
				});
			} catch (perr) {
				if (perr.code === 'DUPLICATE_INSPECTOR') {
					await logger.warn('Save rejeitado: inspetor já registrado neste ponto', {
						module: 'points', function: 'updatePoint',
						metadata: { pointId: point._id, username: user.name }
					});
					return response.status(409).json({ error: 'Você já registrou inspeção para este ponto.' });
				}
				throw perr;
			}

			// Consolidação separada: também passa por audit para deixar rastro.
			if (consolidatedValue) {
				await pointsService.setClassConsolidated(point._id, consolidatedValue, ctx);
			}

			// Tier 2.3 (2026-05-09) — advance-on-save COMPLEMENTAR (idempotente).
			// findPointFromBlock continua avançando o offset no momento do
			// serve do ponto (comportamento original preservado). Aqui apenas
			// chamamos $max(slot+1) — se o offset já estava lá ou à frente,
			// é no-op. Garante que o offset reflita pontos efetivamente salvos
			// e dispara completeBlock quando o último ponto for salvo, mesmo
			// se o serve não tiver passado por aquele caminho.
			if (blockOwning && blocosController) {
				const slot = (blockOwning.pointIds || []).indexOf(point._id);
				if (slot >= 0) {
					try {
						const updated = await blocosController.advanceBlockOffsetToAtLeast(blockOwning._id, slot + 1);
						if (updated && updated.currentPointOffset >= updated.size) {
							await blocosController.completeBlock(blockOwning._id);
						}
					} catch (offsetErr) {
						await logger.error('updatePoint: falha em advanceBlockOffsetToAtLeast (não bloqueia)', {
							module: 'points', function: 'updatePoint',
							metadata: { pointId: point._id, blockId: String(blockOwning._id), error: offsetErr.message }
						});
					}
				}
			}

			await logger.info('Point updated successfully', {
				module: 'points', function: 'updatePoint',
				metadata: { pointId: point._id, username: user.name, consolidated: !!consolidatedValue, blockId: blockOwning && String(blockOwning._id) }
			});

			// Decrementar underInspection após inspeção salva com sucesso (mesmo do código original)
			await points.updateOne(
				{ _id: point._id, underInspection: { $gt: 0 } },
				{ $inc: { underInspection: -1 } }
			);

			// Emitir evento de atualização para monitoramento em tempo real (preservado)
			if (app.io) {
				app.io.to('campaign-monitoring-' + user.campaign._id).emit('inspection-update', {
					campaignId: user.campaign._id,
					pointId: point._id,
					userName: user.name,
					timestamp: new Date()
				});
			}

			response.send({ success: true });
			response.end();
		} catch (error) {
			const errorCode = await logger.error('Unexpected error in updatePoint', {
				module: 'points', function: 'updatePoint',
				metadata: { error: error.message, stack: error.stack }
			});
			response.status(500).json({ error: 'Internal server error', errorCode });
		}
	};

	Points.getPointById = async function(request, response) {
		const pointId = request.params.pointId;
		
		await logger.info('Getting point by ID', {
			module: 'points',
			function: 'getById',
			metadata: { pointId },
			req: request
		});

		points.findOne({ '_id': pointId }, async function(err, point) {
			if (err) {
				const logId = await logger.error('Database error finding point', {
					module: 'points',
					function: 'getById',
					metadata: { error: err.message, pointId },
					req: request
				});
				return response.status(500).json({ error: 'Database error', logId });
			}

			if (!point) {
				return response.status(404).json({ error: 'Point not found' });
			}

			getImageDates(point.path, point.row, function(dates) {
				point.dates = dates;
				point.bounds = getWindow(point);
				response.json(point);
			});
		});
	};

	Points.getPointByFilter = function(request, response) {
		const filter = request.body;
		
		points.findOne(filter, function(err, point) {
			if (err || !point) {
				return response.status(404).json({ error: 'Point not found' });
			}
			response.json(point);
		});
	};

	Points.getLandUses = function(request, response) {
		const filter = request.query;
		points.distinct('inspection.form.landUse', filter, function(err, landUses) {
			if (err) {
				return response.status(500).json({ error: 'Internal server error' });
			}
			response.json(landUses.filter(lu => lu != null));
		});
	};

	Points.getUsers = function(request, response) {
		const filter = request.query;
		points.distinct('userName', filter, function(err, users) {
			if (err) {
				return response.status(500).json({ error: 'Internal server error' });
			}
			response.json(users.filter(u => u != null));
		});
	};

	Points.getBiomes = function(request, response) {
		const filter = request.query;
		points.distinct('biome', filter, function(err, biomes) {
			if (err) {
				return response.status(500).json({ error: 'Internal server error' });
			}
			response.json(biomes.filter(b => b != null));
		});
	};

	Points.getUfs = function(request, response) {
		const filter = request.query;
		points.distinct('uf', filter, function(err, ufs) {
			if (err) {
				return response.status(500).json({ error: 'Internal server error' });
			}
			response.json(ufs.filter(u => u != null));
		});
	};

	Points.getNextPoint = async function(request, response) {
		const { point: formPoint } = request.body;
		const user = request.session.user;

		if (!user || !user.campaign) {
			return response.status(401).json({ error: 'Valid user session required' });
		}

		// Roteamento condicional: blocos vs. legado
		var hasBlocks = await blocosCollection.count({ campaignId: user.campaign._id });
		var findFn = hasBlocks > 0 ? findPointFromBlock : findPoint;

		findFn(user.campaign, user.name, function(result) {
			result.campaign = user.campaign;
			response.json(result);
		});
	};

	Points.getPointByIdService = function(request, response) {
		const { pointId } = request.body;
		
		points.findOne({ '_id': pointId }, function(err, point) {
			if (err || !point) {
				return response.status(404).json({ error: 'Point not found' });
			}

			getImageDates(point.path, point.row, function(dates) {
				point.dates = dates;
				point.bounds = getWindow(point);
				response.json(point);
			});
		});
	};

	Points.updateClassConsolidated = function(request, response) {
		const result = request.body;
		const { pointId, classConsolidated } = result;

		points.updateOne(
			{ '_id': pointId },
			{ '$set': { 'classConsolidated': classConsolidated } },
			function(err) {
				if (err) {
					return response.status(500).json({ error: 'Internal server error' });
				}
				response.json({ success: true });
			}
		);
	};

	// ===== MÉTODOS ADMIN (sem dependência de sessão de usuário regular) =====
	
	Points.getPointByIdAdmin = async function(request, response) {
		const pointId = request.params.pointId;
		
		await logger.info('Admin - Getting point by ID', {
			module: 'points',
			function: 'getPointByIdAdmin',
			metadata: { pointId },
			req: request
		});

		points.findOne({ '_id': pointId }, async function(err, point) {
			if (err) {
				const logId = await logger.error('Admin - Database error finding point', {
					module: 'points',
					function: 'getPointByIdAdmin',
					metadata: { error: err.message, pointId },
					req: request
				});
				return response.status(500).json({ error: 'Database error', logId });
			}

			if (!point) {
				return response.status(404).json({ error: 'Point not found' });
			}

			getImageDates(point.path, point.row, function(dates) {
				point.dates = dates;
				point.bounds = getWindow(point);
				response.json(point);
			});
		});
	};

	Points.getPointByFilterAdmin = async function(request, response) {
		// Método baseado em supervisor.js Points.getPoint mas para admin
		var campaignId = request.body.campaignId;
		var index = parseInt(request.body.index);
		var landUse = request.body.landUse;
		var userName = request.body.userName;
		var biome = request.body.biome;
		var uf = request.body.uf;
		var timePoint = request.body.timeInspection;
		var agreementPoint = request.body.agreementPoint;

		await logger.info('Admin - getPointByFilterAdmin called', {
			module: 'points',
			function: 'getPointByFilterAdmin',
			metadata: {
				campaignId,
				index,
				landUse,
				userName,
				biome,
				uf,
				timePoint,
				agreementPoint
			}
		});

		if (!campaignId) {
			return response.status(400).json({ error: 'Campaign ID required' });
		}

		// Buscar dados da campanha
		var campaigns = app.repository.collections.campaign;
		campaigns.findOne({ '_id': campaignId }, async function(err, campaign) {
			if (err || !campaign) {
				return response.status(404).json({ error: 'Campaign not found' });
			}

			var filter = {
				"campaign": campaign._id
			};

			if (userName) {
				filter["userName"] = userName;
			}

			if (landUse) {
				if (landUse === 'Não Consolidados') {
					filter["classConsolidated"] = "Não consolidado";
				} else {
					filter["inspection.form.landUse"] = landUse;
				}
			}

			// TKT-000010: usa $or sobre properties.* para aceitar pontos legados.
			var fallbackClauses = [];
			if (uf) {
				fallbackClauses.push({ $or: ufOrClause(uf) });
			}
			if (biome) {
				fallbackClauses.push({ $or: biomeOrClause(biome) });
			}
			if (fallbackClauses.length === 1) {
				filter.$or = fallbackClauses[0].$or;
			} else if (fallbackClauses.length > 1) {
				filter.$and = fallbackClauses;
			}

			// Se o index for fornecido, tentamos usar o campo index para filtrar
			// em vez de usar skip que pode causar timeout
			if (index && !timePoint && !agreementPoint) {
				filter["index"] = { "$gte": index };
			}

			var pipeline;

			if (timePoint) {
				pipeline = [
					{"$match": filter},
					{"$project": {mean: {"$avg": "$inspection.counter"}}},
					{"$sort": {mean: -1}},
					{"$skip": index - 1},
					{"$limit": 1}
				]
			}

			if (agreementPoint) {
				if (userName || !landUse) {
					pipeline = [
						{$match: filter},
						{
							$project: {
								consolidated: {
									$size: {
										$ifNull: [
											{
												$filter: {
													input: "$classConsolidated",
													as: "consolidated",
													cond: {
														$and: [
															{$eq: ['$$consolidated', 'Não consolidado']}
														]
													}
												}
											},
											[]
										]
									}
								}
							}
						},
						{$sort: {'consolidated': -1}},
						{$skip: index - 1}
					]
				} else {
					pipeline = [
						{$match: filter},
						{
							$project: {
								consolidated: {
									$size: {
										$ifNull: [
											{
												$filter: {
													input: "$classConsolidated",
													as: "consolidated",
													cond: {
														$and: [
															{$eq: ['$$consolidated', landUse]}
														]
													}
												}
											},
											[]
										]
									}
								}
							}
						},
						{$sort: {'consolidated': -1}},
						{$skip: index - 1}
					]
				}
			}

			if (pipeline == undefined) {
				// Se temos filtro por index, usar find otimizado
				if (filter["index"]) {
					await logger.info('Admin - Using optimized index filter', {
						module: 'points',
						function: 'getPointByFilterAdmin',
						metadata: { filter }
					});
					pipeline = [
						{"$match": filter},
						{"$project": {index: 1, mean: {"$avg": "$inspection.counter"}}},
						{"$sort": {index: 1}},
						{"$limit": 1}
					]
				} else {
					await logger.info('Admin - Using skip-based pagination', {
						module: 'points',
						function: 'getPointByFilterAdmin',
						metadata: { index }
					});
					pipeline = [
						{"$match": filter},
						{"$project": {index: 1, mean: {"$avg": "$inspection.counter"}}},
						{"$sort": {index: 1}},
						{"$skip": index - 1},
						{"$limit": 1}
					]
				}
			}

			points.aggregate(pipeline, function (err, aggregateElem) {
				if(aggregateElem.length === 0){
					response.send({totalPoints: 0})
					response.end()
					return;
				}

				aggregateElem = aggregateElem[0]

				points.findOne({'_id': aggregateElem._id}, function (err, newPoint) {
					if (!newPoint) {
						return response.status(404).json({ error: 'Point not found' });
					}

					var point = newPoint;
					var pointTimeList = [];
					var pointTimeTotal = 0;

					newPoint.inspection.forEach(function (timeInspectionUser) {
						pointTimeList.push(timeInspectionUser.counter)
						pointTimeTotal += timeInspectionUser.counter;
					})

					if (newPoint.userName.length > 0) {
						pointTimeTotal = pointTimeTotal / newPoint.userName.length;
					}

					point.bounds = getWindow(point)
					point.dataPointTime = [];

					for (var i = 0; i < newPoint.userName.length; i++) {
						point.dataPointTime.push({
							'name': newPoint.userName[i],
							'totalPointTime': pointTimeList[i] || 0,
							'meanPointTime': 0 // Será calculado depois se necessário
						})
					}

					point.dataPointTime.push({
						'name': 'Tempo médio',
						'totalPointTime': pointTimeTotal,
						'meanPointTime': 0
					})

					point.timePoints = point.timePoint;
					point.originalIndex = point.index;
					point.index = index;

					// Criar objeto de resposta
					getImageDates(point.path, point.row, function(dates) {
						point.dates = dates;
						
						var years = [];
						var yearlyInspections = [];

						if (point.userName && point.userName.length > 0) {
							for (var i = 0; i < point.userName.length; i++) {
								var userName = point.userName[i];
								var inspections = point.inspection[i];

								var yearlyInspection = {
									userName: userName,
									landUse: []
								}
								if (inspections && inspections.form) {
									inspections.form.forEach(function (i) {
										for (var year = i.initialYear; year <= i.finalYear; year++) {
											yearlyInspection.landUse.push(`${i.landUse} ${i.pixelBorder ? ' - BORDA' : ''}`);
										}
									});
								}

								yearlyInspections.push(yearlyInspection)
							}

							if (point.inspection[0] && point.inspection[0].form) {
								point.inspection[0].form.forEach(function (i) {
									for (var year = i.initialYear; year <= i.finalYear; year++) {
										years.push(year);
									}
								});
							}
						}

						point.inspection = yearlyInspections;
						point.years = years;

						points.count(filter, function (err, count) {
							response.send({
								point: point,
								totalPoints: count,
								campaign: campaign
							})
							response.end()
						})
					});
				})
			});
		});
	};

	Points.getLandUsesAdmin = async function(request, response) {
		const filter = {};
		// Copiar parâmetros de filtro
		for (let key in request.query) {
			if (key === 'campaignId') {
				filter.campaign = request.query[key];
			} else {
				filter[key] = request.query[key];
			}
		}
		await logger.info('Admin - Getting land uses', {
			module: 'points',
			function: 'getLandUses',
			metadata: { filter },
			req: request
		});
		points.distinct('inspection.form.landUse', filter, async function(err, landUses) {
			if (err) {
				const logId = await logger.error('Admin - Error getting land uses', {
					module: 'points',
					function: 'getLandUses',
					metadata: { error: err.message, filter },
					req: request
				});
				return response.status(500).json({ error: 'Internal server error', logId });
			}
			await logger.info('Admin - Land uses found', {
				module: 'points',
				function: 'getLandUses',
				metadata: { landUsesCount: landUses ? landUses.length : 0 }
			});
			response.json(landUses ? landUses.filter(lu => lu != null) : []);
		});
	};

	Points.getUsersAdmin = function(request, response) {
		const filter = {};
		// Copiar parâmetros de filtro
		for (let key in request.query) {
			if (key === 'campaignId') {
				filter.campaign = request.query[key];
			} else {
				filter[key] = request.query[key];
			}
		}
		points.distinct('userName', filter, function(err, users) {
			if (err) {
				return response.status(500).json({ error: 'Internal server error' });
			}
			response.json(users.filter(u => u != null));
		});
	};

	Points.getBiomesAdmin = function(request, response) {
		const filter = {};
		// Copiar parâmetros de filtro
		for (let key in request.query) {
			if (key === 'campaignId') {
				filter.campaign = request.query[key];
			} else {
				filter[key] = request.query[key];
			}
		}
		// TKT-000010: fallback para pontos legados com bioma apenas em properties.*
		const pipeline = [
			{ $match: filter },
			{ $project: { biomeResolved: buildResolvedFieldExpression('biome', BIOME_PROPERTY_KEYS) } },
			{ $match: { biomeResolved: { $ne: null } } },
			{ $group: { _id: '$biomeResolved' } }
		];
		points.aggregate(pipeline).toArray(function(err, docs) {
			if (err) {
				return response.status(500).json({ error: 'Internal server error' });
			}
			const result = (docs || [])
				.map(d => d._id)
				.filter(v => v != null && v !== '');
			response.json(result);
		});
	};

	Points.getUfsAdmin = function(request, response) {
		const filter = {};
		// Copiar parâmetros de filtro
		for (let key in request.query) {
			if (key === 'campaignId') {
				filter.campaign = request.query[key];
			} else {
				filter[key] = request.query[key];
			}
		}
		// TKT-000010: fallback para pontos legados com uf apenas em properties.*
		const pipeline = [
			{ $match: filter },
			{ $project: { ufResolved: buildResolvedFieldExpression('uf', UF_PROPERTY_KEYS) } },
			{ $match: { ufResolved: { $ne: null } } },
			{ $group: { _id: '$ufResolved' } }
		];
		points.aggregate(pipeline).toArray(function(err, docs) {
			if (err) {
				return response.status(500).json({ error: 'Internal server error' });
			}
			const result = (docs || [])
				.map(d => d._id)
				.filter(v => v != null && v !== '');
			response.json(result);
		});
	};

	Points.getNextPointAdmin = function(request, response) {
		const { point: formPoint, campaignId } = request.body;
		
		// Para admin, buscar campanha diretamente do banco
		var campaigns = app.repository.collections.campaigns;
		
		campaigns.findOne({ '_id': campaignId }, function(err, campaign) {
			if (err || !campaign) {
				return response.status(404).json({ error: 'Campaign not found' });
			}
			
			// Usar findPoint mas sem username específico (admin pode ver todos)
			findPoint(campaign, 'admin', function(result) {
				result.campaign = campaign;
				response.json(result);
			});
		});
	};

	Points.getPointByIdServiceAdmin = function(request, response) {
		const { pointId } = request.body;
		
		points.findOne({ '_id': pointId }, function(err, point) {
			if (err || !point) {
				return response.status(404).json({ error: 'Point not found' });
			}

			// Buscar dados da campanha
			var campaigns = app.repository.collections.campaign;
			campaigns.findOne({ '_id': point.campaign }, function(err, campaign) {
				if (err || !campaign) {
					return response.status(404).json({ error: 'Campaign not found' });
				}

				var pointTimeList = [];
				var pointTimeTotal = 0;

				if (point.inspection && point.inspection.length > 0) {
					point.inspection.forEach(function (timeInspectionUser) {
						pointTimeList.push(timeInspectionUser.counter || 0)
						pointTimeTotal += timeInspectionUser.counter || 0;
					})

					if (point.userName && point.userName.length > 0) {
						pointTimeTotal = pointTimeTotal / point.userName.length;
					}
				}

				point.bounds = getWindow(point)
				point.dataPointTime = [];

				if (point.userName && point.userName.length > 0) {
					for (var i = 0; i < point.userName.length; i++) {
						point.dataPointTime.push({
							'name': point.userName[i],
							'totalPointTime': pointTimeList[i] || 0,
							'meanPointTime': 0
						})
					}
				}

				point.dataPointTime.push({
					'name': 'Tempo médio',
					'totalPointTime': pointTimeTotal,
					'meanPointTime': 0
				})

				point.timePoints = point.timePoint;
				point.originalIndex = point.index;

				// Criar objeto de resposta
				getImageDates(point.path, point.row, function(dates) {
					point.dates = dates;
					
					var years = [];
					var yearlyInspections = [];

					if (point.userName && point.userName.length > 0) {
						for (var i = 0; i < point.userName.length; i++) {
							var userName = point.userName[i];
							var inspections = point.inspection[i];

							var yearlyInspection = {
								userName: userName,
								landUse: []
							}
							if (inspections && inspections.form) {
								inspections.form.forEach(function (j) {
									for (var year = j.initialYear; year <= j.finalYear; year++) {
										yearlyInspection.landUse.push(`${j.landUse} ${j.pixelBorder ? ' - BORDA' : ''}`);
										if (i === 0) {
											years.push(year);
										}
									}
								});
							}

							yearlyInspections.push(yearlyInspection)
						}
					}

					point.inspection = yearlyInspections;
					point.years = years;

					// Contar total de pontos da campanha
					points.count({ campaign: point.campaign }, function (err, count) {
						response.send({
							point: point,
							totalPoints: count,
							campaign: campaign
						})
						response.end()
					})
				});
			});
		});
	};

	// Tier 1.6 (2026-05-09) — migrada para pointsService.setClassConsolidated.
	// pointEdited continua como flag denormalizada (usada por outras queries),
	// definida em update separado para não fugir do contrato do service.
	Points.updateClassConsolidatedAdmin = async function(request, response) {
		const result = request.body || {};
		const pointId = result._id;
		const classConsolidated = result.class;

		if (!pointId || !classConsolidated) {
			return response.status(400).json({ error: 'Missing required fields' });
		}

		const pointsService = app.services && app.services.pointsService;
		if (!pointsService) {
			return response.status(500).json({ error: 'pointsService indisponível' });
		}

		try {
			const admin = request.session && request.session.admin;
			const ctx = {
				actor: {
					username: (admin && admin.username) || 'admin-unknown',
					role: (admin && admin.superAdmin) ? 'superAdmin' : 'admin',
					sessionId: (request.session && request.sessionID) || null,
					ip: request.ip || null
				},
				reason: 'updateClassConsolidatedAdmin via /service/admin/points/updatedClassConsolidated'
			};
			await pointsService.setClassConsolidated(pointId, classConsolidated, ctx);
			// Atualiza pointEdited fora do service — é flag de UX, não inspeção.
			await points.updateOne({ _id: pointId }, { $set: { pointEdited: true } });
			return response.json({ success: true });
		} catch (err) {
			await logger.error('Erro em updateClassConsolidatedAdmin', {
				module: 'points',
				function: 'updateClassConsolidatedAdmin',
				metadata: { error: err.message, pointId }
			});
			return response.status(500).json({ error: err.message });
		}
	};

	return Points;
}
