var weeklyBucket = require('../services/weeklyBucket');

module.exports = function(app) {
	var CampaignMonitoring = {};
	const logger = app.services.logger;

	var points = app.repository.collections.points;
	var campaigns = app.repository.collections.campaign;
	var statusCollection = app.repository.collections.status;

	/**
	 * Helper: busca campanha por ID e executa callback com o documento.
	 */
	var withCampaign = function(campaignId, req, res, callback) {
		campaigns.findOne({ _id: campaignId }, async function(err, campaign) {
			if (err) {
				const logId = await logger.error('Erro ao buscar campanha', {
					module: 'campaign-monitoring',
					metadata: { error: err.message, campaignId },
					req: req
				});
				return res.status(500).json({ error: 'Erro de banco de dados', logId });
			}
			if (!campaign) {
				return res.status(404).json({ error: 'Campanha não encontrada' });
			}
			callback(campaign);
		});
	};

	/**
	 * GET /donuts — Inspecionados vs. não inspecionados
	 */
	CampaignMonitoring.donuts = function(req, res) {
		var campaignId = req.params.id;

		withCampaign(campaignId, req, res, function() {
			points.count({ landUse: { $eq: [] }, campaign: campaignId }, async function(err1, notInspect) {
				if (err1) {
					const logId = await logger.error('Erro ao contar pontos não inspecionados', {
						module: 'campaign-monitoring', function: 'donuts',
						metadata: { error: err1.message, campaignId }, req: req
					});
					return res.status(500).json({ error: 'Erro de banco de dados', logId });
				}
				points.count({ landUse: { $gt: [] }, campaign: campaignId }, async function(err2, inspect) {
					if (err2) {
						const logId = await logger.error('Erro ao contar pontos inspecionados', {
							module: 'campaign-monitoring', function: 'donuts',
							metadata: { error: err2.message, campaignId }, req: req
						});
						return res.status(500).json({ error: 'Erro de banco de dados', logId });
					}
					res.json({ inspect: inspect, not_inspect: notInspect });
				});
			});
		});
	};

	/**
	 * GET /inspections-per-user — Inspeções por inspetor (mapReduce)
	 */
	CampaignMonitoring.inspectionsPerUser = function(req, res) {
		var campaignId = req.params.id;

		var mapFunction = function() {
			for (var un = 0; un < this.userName.length; un++) {
				emit(this.userName[un], 1);
			}
		};

		var reduceFunction = function(key, values) {
			return Array.sum(values);
		};

		points.mapReduce(mapFunction, reduceFunction,
			{ out: { inline: 1 }, query: { campaign: campaignId } },
			function(err, collection) {
				if (err) {
					return res.status(500).json({ error: 'Erro no mapReduce' });
				}
				var coordx = [];
				var coordy = [];

				for (var key in collection) {
					coordx.push(collection[key].value);
					coordy.push(collection[key]._id);
				}

				res.json({ coordx: coordx, coordy: coordy });
			}
		);
	};

	/**
	 * GET /land-use-distribution — Distribuição de uso do solo (mapReduce)
	 */
	CampaignMonitoring.landUseDistribution = function(req, res) {
		var campaignId = req.params.id;

		var mapFunction = function() {
			var majority = {};
			for (var i = 0; i < this.landUse.length; i++) {
				var l = this.landUse[i];
				if (majority[l] === undefined) {
					majority[l] = 0;
				}
				majority[l] += 1;
			}
			for (var key in majority) {
				if (majority[key] > 1) {
					emit(key, 1);
					break;
				}
			}
		};

		var reduceFunction = function(key, values) {
			return Array.sum(values);
		};

		points.mapReduce(mapFunction, reduceFunction,
			{ out: { inline: 1 }, query: { campaign: campaignId } },
			function(err, collection) {
				if (err) {
					return res.status(500).json({ error: 'Erro no mapReduce' });
				}
				var result = { labels: [], values: [] };
				collection.forEach(function(c) {
					result.labels.push(c._id);
					result.values.push(c.value);
				});
				res.json(result);
			}
		);
	};

	/**
	 * GET /points-summary — Completo / em andamento / não inspecionado
	 */
	CampaignMonitoring.pointsSummary = function(req, res) {
		var campaignId = req.params.id;

		withCampaign(campaignId, req, res, function(campaign) {
			points.count({ campaign: campaign._id, userName: { $size: campaign.numInspec } }, function(err, pointsComplet) {
				if (err) return res.status(500).json({ error: 'Erro de banco de dados' });
				points.count({ campaign: campaign._id, userName: { $size: 0 } }, function(err, pointsNoComplet) {
					if (err) return res.status(500).json({ error: 'Erro de banco de dados' });
					points.count({ campaign: campaign._id }, function(err, total) {
						if (err) return res.status(500).json({ error: 'Erro de banco de dados' });
						res.json({
							pointsComplet: pointsComplet,
							pointsNoComplet: pointsNoComplet,
							pointsInspection: total - (pointsComplet + pointsNoComplet)
						});
					});
				});
			});
		});
	};

	/**
	 * GET /mean-time — Tempo médio de inspeção por inspetor
	 */
	CampaignMonitoring.meanTime = function(req, res) {
		var campaignId = req.params.id;
		var cursor = points.find({ campaign: campaignId });

		cursor.toArray(function(error, docs) {
			if (error) return res.status(500).json({ error: 'Erro de banco de dados' });

			var listInsp = {};
			docs.forEach(function(doc) {
				for (var i = 0; i < doc.userName.length; i++) {
					// Guard: inspection[i] pode não existir em pontos parcialmente inspecionados
					if (!doc.inspection || !doc.inspection[i]) continue;

					if (!listInsp[doc.userName[i]]) {
						listInsp[doc.userName[i]] = { sum: 0, count: 0 };
					}
					listInsp[doc.userName[i]].sum += doc.inspection[i].counter || 0;
					listInsp[doc.userName[i]].count += 1;
				}
			});

			for (var key in listInsp) {
				listInsp[key].avg = (listInsp[key].sum / listInsp[key].count).toFixed(0);
			}

			res.json(listInsp);
		});
	};

	/**
	 * GET /cached-points — Pontos com/sem cache
	 */
	CampaignMonitoring.cachedPoints = function(req, res) {
		var campaignId = req.params.id;
		var cursor = points.find({ campaign: campaignId });
		var result = { pointsCached: 0, pointsNoCached: 0 };

		cursor.toArray(function(error, docs) {
			if (error) return res.status(500).json({ error: 'Erro de banco de dados' });

			docs.forEach(function(doc) {
				if (doc.cached === false) {
					result.pointsNoCached++;
				} else {
					result.pointsCached++;
				}
			});
			res.json(result);
		});
	};

	/**
	 * GET /agreement — Concordância entre inspetores por ano
	 */
	CampaignMonitoring.agreement = function(req, res) {
		var campaignId = req.params.id;

		withCampaign(campaignId, req, res, function(campaign) {
			var cursor = points.find({ campaign: campaign._id });
			var result = {};
			var initialYear = campaign.initialYear;

			cursor.toArray(function(err, docs) {
				if (err) return res.status(500).json({ error: 'Erro de banco de dados' });

				docs.forEach(function(doc) {
					if (doc.userName.length === campaign.numInspec) {
						for (var i = 0; i < doc.classConsolidated.length; i++) {
							if (!result[initialYear + i + '_pontosConc'])
								result[initialYear + i + '_pontosConc'] = 0;
							if (!result[initialYear + i + '_pontosConcAdm'])
								result[initialYear + i + '_pontosConcAdm'] = 0;
							if (!result[initialYear + i + '_pontosNaoConc'])
								result[initialYear + i + '_pontosNaoConc'] = 0;

							if (doc.pointEdited === true) {
								result[initialYear + i + '_pontosConcAdm']++;
							} else if (doc.classConsolidated[i] === 'Não consolidado') {
								result[initialYear + i + '_pontosNaoConc']++;
							} else {
								result[initialYear + i + '_pontosConc']++;
							}
						}
					}
				});

				res.json(result);
			});
		});
	};

	/**
	 * GET /land-cover — Média de votos por cobertura do solo
	 */
	CampaignMonitoring.landCover = function(req, res) {
		var campaignId = req.params.id;

		withCampaign(campaignId, req, res, function(campaign) {
			var cursor = points.find({ campaign: campaign._id });

			cursor.toArray(function(err, docs) {
				if (err) return res.status(500).json({ error: 'Erro de banco de dados' });

				var csvResult = [];

				docs.forEach(function(doc) {
					if (doc.userName.length === campaign.numInspec) {
						var csvLines = { index: doc.index, lon: doc.lon, lat: doc.lat };
						var landUses = {};

						for (var i = 0; i < doc.userName.length; i++) {
							var form = doc.inspection[i].form;
							form.forEach(function(f) {
								for (var year = f.initialYear; year <= f.finalYear; year++) {
									if (!landUses[year]) landUses[year] = [];
									landUses[year].push(f.landUse);
								}
							});
						}

						for (var landUse in landUses) {
							var votes = {};
							for (var j in landUses[landUse]) {
								if (!votes[landUses[landUse][j]]) votes[landUses[landUse][j]] = 0;
								votes[landUses[landUse][j]] += 1;
							}
							for (var k in votes) {
								if (votes[k] >= Math.ceil(campaign.numInspec / 2)) {
									csvLines[landUse] = k;
									csvLines[landUse + '_votes'] = votes[k];
									break;
								}
							}
						}

						csvResult.push(csvLines);
					}
				});

				var landCover = {};
				var meanCover = {};

				csvResult.forEach(function(data) {
					for (var i = campaign.initialYear; i <= campaign.finalYear; i++) {
						if (data[i] !== undefined) {
							if (!landCover[data[i]]) landCover[data[i]] = 0;
							if (!landCover['count_' + data[i]]) landCover['count_' + data[i]] = 0;
						}
					}
				});

				csvResult.forEach(function(data) {
					for (var i = campaign.initialYear; i <= campaign.finalYear; i++) {
						if (data[i] !== undefined) {
							landCover[data[i]] = landCover[data[i]] + data[i + '_votes'];
							landCover['count_' + data[i]]++;
							meanCover[data[i]] = (landCover[data[i]] / landCover['count_' + data[i]]).toFixed(2);
						}
					}
				});

				res.json(meanCover);
			});
		});
	};

	/**
	 * GET /member-status — Status online/offline dos inspetores
	 */
	CampaignMonitoring.memberStatus = function(req, res) {
		var campaignId = req.params.id;
		var cursor = statusCollection.find({ campaign: campaignId });

		cursor.toArray(async function(error, docs) {
			if (error) {
				const logId = await logger.error('Erro ao buscar status dos membros', {
					module: 'campaign-monitoring', function: 'memberStatus',
					metadata: { error: error.message, campaignId }, req: req
				});
				return res.status(500).json({ error: 'Erro ao buscar status', logId });
			}

			var result = {};
			docs.forEach(function(doc, index) {
				result[index + 1] = doc;
			});
			res.json(result);
		});
	};

	/**
	 * GET /inspector-cards — Dados agregados por inspetor (progresso, status, contagem)
	 */
	CampaignMonitoring.inspectorCards = function(req, res) {
		var campaignId = req.params.id;

		withCampaign(campaignId, req, res, function(campaign) {
			// Buscar status dos inspetores
			statusCollection.find({ campaign: campaignId }).toArray(function(err, statusDocs) {
				if (err) return res.status(500).json({ error: 'Erro de banco de dados' });

				// Buscar total de pontos da campanha
				points.count({ campaign: campaignId }, function(err, totalPoints) {
					if (err) return res.status(500).json({ error: 'Erro de banco de dados' });

					// Contar inspeções por usuário
					var cursor = points.find({ campaign: campaignId, userName: { $gt: [] } });
					cursor.toArray(function(err, docs) {
						if (err) return res.status(500).json({ error: 'Erro de banco de dados' });

						var inspectionCount = {};
						docs.forEach(function(doc) {
							doc.userName.forEach(function(name) {
								if (!inspectionCount[name]) inspectionCount[name] = 0;
								inspectionCount[name]++;
							});
						});

						// Montar cartões
						var cards = statusDocs.map(function(s) {
							return {
								name: s.name,
								status: s.status || 'Offline',
								currentPoint: s.atualPoint || null,
								lastActivity: s.dateLastPoint || null,
								inspectionCount: inspectionCount[s.name] || 0,
								totalPoints: totalPoints,
								numInspec: campaign.numInspec
							};
						});

						// Ordenar: online primeiro, depois por nome
						cards.sort(function(a, b) {
							if (a.status === 'Online' && b.status !== 'Online') return -1;
							if (a.status !== 'Online' && b.status === 'Online') return 1;
							return a.name.localeCompare(b.name);
						});

						res.json(cards);
					});
				});
			});
		});
	};

	/**
	 * POST /point — Buscar ponto específico para visualizar mapas e inspeções
	 */
	CampaignMonitoring.getPoint = function(req, res) {
		var campaignId = req.params.id;
		var pointId = req.body.pointId;

		if (!pointId) {
			return res.status(400).json({ error: 'pointId é obrigatório' });
		}

		withCampaign(campaignId, req, res, function(campaign) {
			var query = { campaign: campaignId, _id: pointId };

			points.findOne(query, function(err, point) {
				if (err) return res.status(500).json({ error: 'Erro de banco de dados' });
				if (!point) return res.status(404).json({ error: 'Ponto não encontrado' });

				// Montar dados de inspeção no formato esperado pelo frontend
				var years = [];
				for (var y = campaign.initialYear; y <= campaign.finalYear; y++) {
					years.push(y);
				}
				point.years = years;

				// Montar dataPointTime (tempo por inspetor)
				var dataPointTime = [];
				if (point.inspection && point.inspection.length > 0) {
					point.inspection.forEach(function(insp, idx) {
						dataPointTime.push({
							name: point.userName[idx] || 'Inspetor ' + (idx + 1),
							totalPointTime: insp.counter || 0,
							meanPointTime: insp.counter || 0
						});
					});

					// Linha de total/média
					var totalTime = 0;
					dataPointTime.forEach(function(d) { totalTime += d.totalPointTime; });
					var meanTime = dataPointTime.length > 0 ? totalTime / dataPointTime.length : 0;
					dataPointTime.push({
						name: 'Total/Média',
						totalPointTime: totalTime,
						meanPointTime: meanTime
					});
				}
				point.dataPointTime = dataPointTime;

				// Montar landUse por inspetor (array de arrays por ano)
				if (point.inspection) {
					point.inspection.forEach(function(insp, idx) {
						var landUseByYear = [];
						if (insp.form) {
							years.forEach(function(year) {
								var found = false;
								insp.form.forEach(function(f) {
									if (year >= f.initialYear && year <= f.finalYear) {
										landUseByYear.push(f.landUse);
										found = true;
									}
								});
								if (!found) landUseByYear.push('-');
							});
						}
						insp.landUse = landUseByYear;
						insp.userName = point.userName[idx];
					});
				}

				// Contar total de pontos
				points.count({ campaign: campaignId }, function(err, totalPoints) {
					res.json({
						point: point,
						campaign: campaign,
						totalPoints: totalPoints || 0
					});
				});
			});
		});
	};

	// ============================================================
	// TKT-000013 — Avaliação supervisor × intérprete
	// ============================================================

	/**
	 * Helper: para cada intérprete em `point.userName`, reconstrói o array
	 * landUse por ano a partir de `inspection[i].form[].landUse`.
	 */
	var buildYearLandUseByInspector = function(point, initialYear, finalYear) {
		var result = {}; // userName → [landUse por ano]
		if (!Array.isArray(point.userName) || !Array.isArray(point.inspection)) return result;
		for (var i = 0; i < point.userName.length; i++) {
			var name = point.userName[i];
			var insp = point.inspection[i];
			if (!insp || !Array.isArray(insp.form)) continue;
			var arr = new Array(finalYear - initialYear + 1);
			for (var j = 0; j < insp.form.length; j++) {
				var f = insp.form[j];
				if (typeof f.initialYear !== 'number' || typeof f.finalYear !== 'number') continue;
				for (var y = Math.max(f.initialYear, initialYear); y <= Math.min(f.finalYear, finalYear); y++) {
					arr[y - initialYear] = f.landUse;
				}
			}
			result[name] = arr;
		}
		return result;
	};

	/**
	 * GET /confusion-matrix — Matriz de confusão intérprete × supervisor.
	 * Considera apenas pontos editados (`pointEdited: true`) e, quando possível,
	 * compara `inspection[].form[].landUse` com `classConsolidated` (valor pós-edição).
	 */
	CampaignMonitoring.confusionMatrix = function(req, res) {
		var campaignId = req.params.id;
		var filterUser = req.query.userName || null;
		var filterYear = req.query.year ? parseInt(req.query.year, 10) : null;

		withCampaign(campaignId, req, res, function(campaign) {
			var mongoFilter = { campaign: campaignId, pointEdited: true };
			if (filterUser) mongoFilter.userName = filterUser;

			points.find(mongoFilter, { _id: 1, userName: 1, inspection: 1, classConsolidated: 1 }).toArray(function(err, docs) {
				if (err) return res.status(500).json({ error: 'Erro de banco de dados' });

				var classSet = {};
				var counts = {}; // "interpreter|supervisor" → count

				docs.forEach(function(doc) {
					var byInspector = buildYearLandUseByInspector(doc, campaign.initialYear, campaign.finalYear);
					var targets = filterUser ? [filterUser] : Object.keys(byInspector);
					for (var t = 0; t < targets.length; t++) {
						var name = targets[t];
						var arr = byInspector[name];
						if (!arr) continue;
						var yStart = filterYear || campaign.initialYear;
						var yEnd = filterYear || campaign.finalYear;
						for (var y = yStart; y <= yEnd; y++) {
							var idx = y - campaign.initialYear;
							var inter = arr[idx];
							var sup = Array.isArray(doc.classConsolidated) ? doc.classConsolidated[idx] : null;
							if (!inter || !sup) continue;
							classSet[inter] = true;
							classSet[sup] = true;
							var key = inter + '|' + sup;
							counts[key] = (counts[key] || 0) + 1;
						}
					}
				});

				var classes = Object.keys(classSet).sort();
				var matrix = classes.map(function() {
					return classes.map(function() { return 0; });
				});
				var total = 0;
				var diagonal = 0;
				for (var k in counts) {
					var parts = k.split('|');
					var r = classes.indexOf(parts[0]);
					var c = classes.indexOf(parts[1]);
					if (r >= 0 && c >= 0) {
						matrix[r][c] = counts[k];
						total += counts[k];
						if (r === c) diagonal += counts[k];
					}
				}

				res.json({
					userName: filterUser,
					year: filterYear,
					classes: classes,
					matrix: matrix,
					totalPoints: total,
					agreementRate: total > 0 ? (diagonal / total) : 0
				});
			});
		});
	};

	/**
	 * GET /agreement-by-inspector — Taxa de concordância por intérprete.
	 * "Concordou" = o ponto está completo e NÃO foi editado pelo supervisor.
	 * "Editado" = `pointEdited: true`. "Não concordante" (minoria isolada) é
	 * derivável comparando `landUse` do intérprete com `classConsolidated`.
	 */
	CampaignMonitoring.agreementByInspector = function(req, res) {
		var campaignId = req.params.id;

		withCampaign(campaignId, req, res, function(campaign) {
			var cursor = points.find(
				{ campaign: campaignId, userName: { $gt: [] } },
				{ _id: 1, userName: 1, pointEdited: 1 }
			);
			cursor.toArray(function(err, docs) {
				if (err) return res.status(500).json({ error: 'Erro de banco de dados' });
				var byUser = {};
				docs.forEach(function(doc) {
					if (!Array.isArray(doc.userName)) return;
					var wasEdited = doc.pointEdited === true;
					doc.userName.forEach(function(name) {
						if (!byUser[name]) byUser[name] = { total: 0, edited: 0, agreed: 0 };
						byUser[name].total++;
						if (wasEdited) byUser[name].edited++;
						else byUser[name].agreed++;
					});
				});

				var arr = Object.keys(byUser).map(function(name) {
					var row = byUser[name];
					return {
						userName: name,
						total: row.total,
						agreed: row.agreed,
						edited: row.edited,
						rate: row.total > 0 ? (row.agreed / row.total) : 0
					};
				});
				arr.sort(function(a, b) { return b.rate - a.rate; });
				res.json({ inspectors: arr });
			});
		});
	};

	/**
	 * GET /agreement-timeline — Evolução semanal da concordância.
	 * Usa `editedAt` quando o ponto foi editado; senão, `fillDate` da última inspeção.
	 */
	CampaignMonitoring.agreementTimeline = function(req, res) {
		var campaignId = req.params.id;
		var filterUser = req.query.userName || null;
		var weeks = req.query.weeks ? parseInt(req.query.weeks, 10) : 8;

		withCampaign(campaignId, req, res, function(campaign) {
			var buckets = weeklyBucket.getLastNWeeks(new Date(), weeks, campaign.weeklyGoalConfig);

			var projection = { _id: 1, userName: 1, inspection: 1, pointEdited: 1, editedAt: 1 };
			var mongoFilter = { campaign: campaignId, userName: { $gt: [] } };
			if (filterUser) mongoFilter.userName = filterUser;

			points.find(mongoFilter, projection).toArray(function(err, docs) {
				if (err) return res.status(500).json({ error: 'Erro de banco de dados' });

				var totals = buckets.map(function() { return 0; });
				var edited = buckets.map(function() { return 0; });

				docs.forEach(function(doc) {
					var refDate = null;
					if (doc.editedAt) {
						refDate = doc.editedAt;
					} else if (Array.isArray(doc.inspection) && doc.inspection.length > 0) {
						var last = doc.inspection[doc.inspection.length - 1];
						if (last && last.fillDate) refDate = last.fillDate;
					}
					if (!refDate) return;
					var idx = weeklyBucket.bucketize(refDate, buckets);
					if (idx < 0) return;
					totals[idx]++;
					if (doc.pointEdited === true) edited[idx]++;
				});

				res.json({
					weeklyGoalConfig: weeklyBucket.normalizeConfig(campaign.weeklyGoalConfig),
					userName: filterUser,
					buckets: buckets.map(function(b, i) {
						var rate = totals[i] > 0 ? ((totals[i] - edited[i]) / totals[i]) : 0;
						return {
							start: b.start.toISOString(),
							end: b.end.toISOString(),
							label: weeklyBucket.formatWeekLabel(b, (campaign.weeklyGoalConfig || {}).timezone),
							inspected: totals[i],
							edited: edited[i],
							rate: rate
						};
					})
				});
			});
		});
	};

	/**
	 * GET /most-corrected-classes — Top N transições intérprete → supervisor.
	 */
	CampaignMonitoring.mostCorrectedClasses = function(req, res) {
		var campaignId = req.params.id;
		var filterUser = req.query.userName || null;
		var topN = Math.max(1, Math.min(50, parseInt(req.query.topN || '20', 10)));

		withCampaign(campaignId, req, res, function(campaign) {
			var mongoFilter = { campaign: campaignId, pointEdited: true };
			if (filterUser) mongoFilter.userName = filterUser;

			points.find(mongoFilter, { userName: 1, inspection: 1, classConsolidated: 1 }).toArray(function(err, docs) {
				if (err) return res.status(500).json({ error: 'Erro de banco de dados' });
				var counts = {};
				docs.forEach(function(doc) {
					var byInspector = buildYearLandUseByInspector(doc, campaign.initialYear, campaign.finalYear);
					var names = filterUser ? [filterUser] : Object.keys(byInspector);
					names.forEach(function(name) {
						var arr = byInspector[name];
						if (!arr) return;
						for (var y = campaign.initialYear; y <= campaign.finalYear; y++) {
							var idx = y - campaign.initialYear;
							var inter = arr[idx];
							var sup = Array.isArray(doc.classConsolidated) ? doc.classConsolidated[idx] : null;
							if (!inter || !sup || inter === sup) continue;
							var key = inter + '→' + sup;
							counts[key] = (counts[key] || 0) + 1;
						}
					});
				});
				var ranked = Object.keys(counts).map(function(k) {
					var parts = k.split('→');
					return { from: parts[0], to: parts[1], count: counts[k] };
				}).sort(function(a, b) { return b.count - a.count; }).slice(0, topN);
				res.json({ userName: filterUser, topN: topN, transitions: ranked });
			});
		});
	};

	// ============================================================
	// TKT-000008 — Inspeções por intérprete, agregado por semana.
	// ============================================================
	CampaignMonitoring.inspectionsPerUserWeekly = function(req, res) {
		var campaignId = req.params.id;
		var weeks = req.query.weeks ? Math.max(1, Math.min(52, parseInt(req.query.weeks, 10))) : 8;

		withCampaign(campaignId, req, res, function(campaign) {
			var cfg = weeklyBucket.normalizeConfig(campaign.weeklyGoalConfig);
			var buckets = weeklyBucket.getLastNWeeks(new Date(), weeks, cfg);
			var firstStart = buckets[0].start;

			// Limita a leitura a pontos cuja fillDate da primeira inspeção
			// esteja dentro ou depois do início da janela. Campanhas antigas
			// com fillDate ausente não entram no agrupamento (esperado).
			var mongoFilter = {
				campaign: campaignId,
				userName: { $gt: [] },
				'inspection.fillDate': { $gte: firstStart }
			};

			points.find(mongoFilter, { userName: 1, inspection: 1 }).toArray(function(err, docs) {
				if (err) return res.status(500).json({ error: 'Erro de banco de dados' });

				var perUser = {}; // userName → Array(numWeeks)
				docs.forEach(function(doc) {
					if (!Array.isArray(doc.userName) || !Array.isArray(doc.inspection)) return;
					var len = Math.min(doc.userName.length, doc.inspection.length);
					for (var i = 0; i < len; i++) {
						var name = doc.userName[i];
						var insp = doc.inspection[i];
						if (!insp || !insp.fillDate) continue;
						var idx = weeklyBucket.bucketize(insp.fillDate, buckets);
						if (idx < 0) continue;
						if (!perUser[name]) perUser[name] = buckets.map(function() { return 0; });
						perUser[name][idx]++;
					}
				});

				var inspectors = Object.keys(perUser).sort().map(function(name) {
					return { userName: name, perWeek: perUser[name] };
				});

				var currentWeekIdx = buckets.length - 1;
				res.json({
					weeklyGoalConfig: cfg,
					currentWeekStart: buckets[currentWeekIdx].start.toISOString(),
					weeks: buckets.map(function(b, i) {
						return {
							weekStart: b.start.toISOString(),
							weekEnd: b.end.toISOString(),
							label: (i === currentWeekIdx) ? 'Semana atual' : weeklyBucket.formatWeekLabel(b, cfg.timezone),
							isCurrent: i === currentWeekIdx
						};
					}),
					inspectors: inspectors
				});
			});
		});
	};

	return CampaignMonitoring;
};
