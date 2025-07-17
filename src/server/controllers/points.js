const logger = require('../services/logger');
const proj4 = require('proj4');

module.exports = function(app) {

	var Points = {};
	var points = app.repository.collections.points;
	var mosaics = app.repository.collections.mosaics;
	var status = app.repository.collections.status;

	var getImageDates = function(path, row, callback) {
		var filterMosaic = {'dates.path': path, 'dates.row': row };
		var projMosaic = { dates: {$elemMatch: {path: path, row: row }}};

		mosaics.find(filterMosaic,projMosaic).toArray(function(err, docs) {
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

	var findPoint = function(campaign, username, callback) {

		var findOneFilter = {
			"$and": [
				{ "userName": { "$nin": [ username ] } },
				{ "$where": 'this.userName.length < '+ campaign.numInspec },
				{ "campaign": { "$eq":  campaign._id } },
				{ "underInspection": { $lt:  campaign.numInspec } }
			]
		};

		var currentFilter = { 
			"$and": [
				{ "userName": { "$nin": [ username ] } },
				{ "$where":'this.userName.length<'+ campaign.numInspec },
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
		points.findAndModify(findOneFilter, findOneSort, findOneUpdate, {}, function(err, object) {
			point = object.value
			if(point) {
				points.count(totalFilter, function(err, total) {
					points.count(countFilter, function (err, count) {
						getImageDates(point.path, point.row, function(dates) {
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

							callback(result);
						})
					})
				});
			} else {
				points.count(totalFilter, function(err, total) {
					points.count(countFilter, function(err, count) {
						var result = {};
						result['point'] = {};
						result['total'] = total;
						result['current'] = total
						result['user'] = username;
						result['count'] = count;
						callback(result);
					})
				});
			}
		});
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
			var user = request.session.user;

			if (!user || !user.campaign) {
				const errorCode = await logger.warn('Get current point attempted without valid user session', {
					req: request,
					module: 'points',
					function: 'getCurrentPoint',
					metadata: { hasUser: !!user, hasCampaign: !!(user && user.campaign) }
				});
				
				return response.status(401).json({ 
					error: 'Valid user session required',
					errorCode
				});
			}

			await logger.info('Getting current point for user', {
				req: request,
				module: 'points',
				function: 'getCurrentPoint',
				metadata: {
					username: user.name,
					campaignId: user.campaign._id,
					campaignName: user.campaign.name
				}
			});

			findPoint(user.campaign, user.name, async function(result) {
				try {
					request.session.currentPointId = result.point._id;
					// Incluir dados da campanha na resposta
					result.campaign = user.campaign;

					await logger.info('Current point retrieved successfully', {
						req: request,
						module: 'points',
						function: 'getCurrentPoint',
						metadata: {
							pointId: result.point._id,
							pointIndex: result.current,
							totalPoints: result.total,
							userCount: result.count,
							username: user.name
						}
					});

					response.send(result);
					response.end();
				} catch (error) {
					const errorCode = await logger.error('Error processing current point result', {
						req: request,
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
				req: request,
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
		try {
			var point = request.body.point;
			var user = request.session.user;

			if (!user || !user.campaign) {
				const errorCode = await logger.warn('Update point attempted without valid user session', {
					req: request,
					module: 'points',
					function: 'updatePoint',
					metadata: { hasUser: !!user, hasCampaign: !!(user && user.campaign) }
				});
				
				return response.status(401).json({ 
					error: 'Valid user session required',
					errorCode
				});
			}

			if (!point || !point._id) {
				const errorCode = await logger.warn('Update point attempted without valid point data', {
					req: request,
					module: 'points',
					function: 'updatePoint',
					metadata: {
						username: user.name,
						hasPoint: !!point,
						hasPointId: !!(point && point._id)
					}
				});
				
				return response.status(400).json({ 
					error: 'Valid point data required',
					errorCode
				});
			}

			await logger.info('Starting point update', {
				req: request,
				module: 'points',
				function: 'updatePoint',
				metadata: {
					pointId: point._id,
					username: user.name,
					campaignId: user.campaign._id,
					hasInspection: !!(point.inspection)
				}
			});

			point.inspection.fillDate = new Date();

			var updateStruct = {
				'$push': {
					"inspection": point.inspection,
			  	"userName": user.name
			  }
			};

			points.findOne({ '_id': point._id }, async function(err, pointDb) {
				try {
					if (err) {
						const errorCode = await logger.error('Database error finding point for update', {
							req: request,
							module: 'points',
							function: 'updatePoint',
							metadata: {
								pointId: point._id,
								error: err.message,
								username: user.name
							}
						});

						return response.status(500).json({
							error: 'Database error finding point',
							errorCode
						});
					}

					if (!pointDb) {
						const errorCode = await logger.warn('Point not found for update', {
							req: request,
							module: 'points',
							function: 'updatePoint',
							metadata: {
								pointId: point._id,
								username: user.name
							}
						});

						return response.status(404).json({
							error: 'Point not found',
							errorCode
						});
					}
			
					if(pointDb.userName.length === user.campaign.numInspec - 1) {
						updateStruct['$set'] = classConsolidate(point, pointDb, user);
						
						await logger.info('Point inspection complete - consolidating classification', {
							req: request,
							module: 'points',
							function: 'updatePoint',
							metadata: {
								pointId: point._id,
								username: user.name,
								inspectionCount: pointDb.userName.length + 1,
								requiredInspections: user.campaign.numInspec
							}
						});
					}

					points.update({ '_id': pointDb._id }, updateStruct, async function(err, item) {
						try {
							if (err) {
								const errorCode = await logger.error('Database error updating point', {
									req: request,
									module: 'points',
									function: 'updatePoint',
									metadata: {
										pointId: point._id,
										error: err.message,
										username: user.name
									}
								});

								return response.status(500).json({
									error: 'Database error updating point',
									errorCode
								});
							}

							await logger.info('Point updated successfully', {
								req: request,
								module: 'points',
								function: 'updatePoint',
								metadata: {
									pointId: point._id,
									username: user.name,
									updateResult: item
								}
							});

							var result = { "success": true }

							response.send(result);
							response.end();
						} catch (error) {
							const errorCode = await logger.error('Error processing point update result', {
								req: request,
								module: 'points',
								function: 'updatePoint',
								metadata: {
									pointId: point._id,
									error: error.message,
									stack: error.stack
								}
							});

							response.status(500).json({
								error: 'Error processing update result',
								errorCode
							});
						}
					});
				} catch (error) {
					const errorCode = await logger.error('Error in point update database operation', {
						req: request,
						module: 'points',
						function: 'updatePoint',
						metadata: {
							pointId: point._id,
							error: error.message,
							stack: error.stack
						}
					});

					response.status(500).json({
						error: 'Database operation error',
						errorCode
					});
				}
			});
		} catch (error) {
			const errorCode = await logger.error('Unexpected error in updatePoint', {
				req: request,
				module: 'points',
				function: 'updatePoint',
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

	Points.getPointById = function(request, response) {
		const pointId = request.params.pointId;
		
		console.log('Getting point by ID:', pointId);

		points.findOne({ '_id': pointId }, function(err, point) {
			if (err) {
				console.error('Database error finding point:', err);
				return response.status(500).json({ error: 'Database error' });
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

	Points.getNextPoint = function(request, response) {
		const { point: formPoint } = request.body;
		const user = request.session.user;

		if (!user || !user.campaign) {
			return response.status(401).json({ error: 'Valid user session required' });
		}

		// Lógica similar ao getCurrentPoint mas com filtros do formPoint
		findPoint(user.campaign, user.name, function(result) {
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
	
	Points.getPointByIdAdmin = function(request, response) {
		const pointId = request.params.pointId;
		
		console.log('Admin - Getting point by ID:', pointId);

		points.findOne({ '_id': pointId }, function(err, point) {
			if (err) {
				console.error('Admin - Database error finding point:', err);
				return response.status(500).json({ error: 'Database error' });
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

	Points.getPointByFilterAdmin = function(request, response) {
		// Método baseado em supervisor.js Points.getPoint mas para admin
		var campaignId = request.body.campaignId;
		var index = parseInt(request.body.index);
		var landUse = request.body.landUse;
		var userName = request.body.userName;
		var biome = request.body.biome;
		var uf = request.body.uf;
		var timePoint = request.body.timeInspection;
		var agreementPoint = request.body.agreementPoint;

		console.log('Admin - getPointByFilterAdmin called with:', {
			campaignId,
			index,
			landUse,
			userName,
			biome,
			uf,
			timePoint,
			agreementPoint
		});

		if (!campaignId) {
			return response.status(400).json({ error: 'Campaign ID required' });
		}

		// Buscar dados da campanha
		var campaigns = app.repository.collections.campaign;
		campaigns.findOne({ '_id': campaignId }, function(err, campaign) {
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

			if (uf) {
				filter["uf"] = uf;
			}

			if (biome) {
				filter["biome"] = biome;
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
					console.log('Admin - Using optimized index filter:', filter);
					pipeline = [
						{"$match": filter},
						{"$project": {index: 1, mean: {"$avg": "$inspection.counter"}}},
						{"$sort": {index: 1}},
						{"$limit": 1}
					]
				} else {
					console.log('Admin - Using skip-based pagination with index:', index);
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

	Points.getLandUsesAdmin = function(request, response) {
		const filter = {};
		// Copiar parâmetros de filtro
		for (let key in request.query) {
			if (key === 'campaignId') {
				filter.campaign = request.query[key];
			} else {
				filter[key] = request.query[key];
			}
		}
		console.log('Admin - Getting land uses with filter:', filter);
		points.distinct('inspection.form.landUse', filter, function(err, landUses) {
			if (err) {
				console.error('Admin - Error getting land uses:', err);
				return response.status(500).json({ error: 'Internal server error' });
			}
			console.log('Admin - Land uses found:', landUses);
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
		points.distinct('biome', filter, function(err, biomes) {
			if (err) {
				return response.status(500).json({ error: 'Internal server error' });
			}
			response.json(biomes.filter(b => b != null));
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
		points.distinct('uf', filter, function(err, ufs) {
			if (err) {
				return response.status(500).json({ error: 'Internal server error' });
			}
			response.json(ufs.filter(u => u != null));
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

	Points.updateClassConsolidatedAdmin = function(request, response) {
		const result = request.body;
		const pointId = result._id;
		const classConsolidated = result.class;

		if (!pointId || !classConsolidated) {
			return response.status(400).json({ error: 'Missing required fields' });
		}

		points.updateOne(
			{ '_id': pointId },
			{ '$set': { 'classConsolidated': classConsolidated, 'pointEdited': true } },
			function(err) {
				if (err) {
					return response.status(500).json({ error: 'Internal server error' });
				}
				response.json({ success: true });
			}
		);
	};

	return Points;
}
