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

	return CampaignMonitoring;
};
