var ejs = require('ejs');
var fs = require('fs');
var csvWriter = require('csv-write-stream');
var schedule = require('node-schedule');
var iconv = require('iconv');
var proj4 = require('proj4');

module.exports = function(app) {

	var Points = {};
	var pointsCollection = app.repository.collections.points;
	var mosaics = app.repository.collections.mosaics;
	var infoCampaign = app.repository.collections.campaign;

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

	Points.csv = function(request, response) {
		var campaign = request.session.user.campaign;

		infoCampaign.find({'_id':campaign._id}).forEach(function(data) {
			var initialYear = data.initialYear;
			var finalYear = data.finalYear;

			pointsCollection.find({ "campaign": campaign._id }).sort({ 'index': 1}).toArray(function(err, points) {
				var csvResult = [];
				var objColNames = {};

				points.forEach(function(point) {
					for(var i=0; i<point.userName.length; i++) {
						point.inspection[i].form.forEach(function(inspec) {
							for(var year=initialYear; year<=finalYear; year++) {
								var colName = year+"_"+point.userName[i];

								if(!objColNames[colName])
									objColNames[colName] = ''
							}
						})
					}
				});

				points.forEach(function (point) {
					var csvLines = {
						'index': point.index,
						'lon': point.lon,
						'lat': point.lat
					}

					for(var colNames in objColNames) {
						csvLines[colNames] = '-';
					}

					var count = 0;
					for(var i=0; i<point.userName.length; i++) {
						point.inspection[i].form.forEach(function(inspec) {
							for(var year=inspec.initialYear; year<=inspec.finalYear; year++) {
								for(var col in csvLines) {
									if(col == year+"_"+point.userName[i]) {
										csvLines[col] = inspec.landUse

										if(!csvLines['consolidated_'+year]) {
											if(point.classConsolidated) {
												csvLines['consolidated_'+year] = point.classConsolidated[count]
											} else {
												csvLines['consolidated_'+year] = '-'
											}
											count++;
										}
									}
								}
							}
						})
					}

					if(point.pointEdited == true) {
						csvLines['pointEdited'] = true
					} else {
						csvLines['pointEdited'] = '-'
					}

					csvResult.push(csvLines)
				})
				
				response.set('Content-Type', 'text/csv');
				response.set('Content-Disposition', 'attachment;filename='+campaign._id+'.csv');

				var writer = csvWriter({
					separator: ';',
					newline: '\n',

					sendHeaders: true
				});

				var encoder = new iconv.Iconv('utf-8', 'latin1');

				writer.pipe(encoder, { end: false });
				encoder.pipe(response, { end: false });

				for(i in csvResult) {
					writer.write(csvResult[i])
				}

				writer.on('end', function() {
					encoder.end();
					response.end();
				})

				writer.end();
				
			})
		});
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

	creatPoint = function(point, callback) {
		var years = [];
		var yearlyInspections = [];

		if(point) {
			for(var i=0; i < point.userName.length; i++) {
				var userName = point.userName[i];
				var inspections = point.inspection[i];
				
				var yearlyInspection = {
					userName: userName,
					landUse: []
				}

				inspections.form.forEach(function(i) {
					for( var year = i.initialYear; year <= i.finalYear; year++) {
						yearlyInspection.landUse.push(i.landUse);
					}
				});

				yearlyInspections.push(yearlyInspection)				
			}
			
			if(point.inspection[0]) {
				point.inspection[0].form.forEach(function(i) {
					for( var year = i.initialYear; year <= i.finalYear; year++) {
						years.push(year);
					}
				});
			}
		} else {
			point = {};
		}

		point.inspection = yearlyInspections;
		point.years = years;

		getImageDates(point.path, point.row, function(dates) {
			point.dates = dates

			var result = {
				"point": point
			}

			return callback(result);
		});
	}

	Points.getPoint = function(request, response) {
		var campaign = request.session.user.campaign;
		var index = parseInt(request.param("index"));
		var landUse = request.param("landUse");
		var userName = request.param("userName");
		var biome = request.param("biome");
		var uf = request.param("uf");
		var timePoint = request.param("timeInspection");
		var agreementPoint = request.param("agreementPoint");

		var filter = {
			"campaign": campaign._id
		};

		if(userName) {
			filter["userName"] = userName;
		}

		if(landUse) {			
			filter["inspection.form.landUse"] = landUse;
		}

		if(uf) {
			filter["uf"] = uf;
		}

		if(biome) {
			filter["biome"] = biome;
		}

		if(timePoint) {
			var pipeline = [
					{"$match": filter},
					{"$project": {mean: {"$avg": "$inspection.counter"}}},
				 	{"$sort": {mean: - 1}},
					{"$skip": index - 1},
					{"$limit": 1}
			]
		}

		if(agreementPoint) {
			if(userName || !landUse) {
				var pipeline = [
					{$match: filter},
			    {$project: {
			      consolidated: {
			        $size: {
			          $ifNull: [
			            {
			              $filter: {
			                input: "$classConsolidated",
			                as: "consolidated",
			                cond: { $and: [
		                    { $eq: ['$$consolidated', 'Não consolidado']}
			                ]}                
			              }
			            },
			            []
			          ]
			        }
			      }
			    }},
			    {$sort: {'consolidated': -1}},
			    {$skip: index - 1}
				]
			} else {
				var pipeline = [
					{$match: filter},
			    {$project: {
			      consolidated: {
			        $size: {
			          $ifNull: [
			            {
			              $filter: {
			                input: "$classConsolidated",
			                as: "consolidated",
			                cond: { $and: [
		                    { $eq: ['$$consolidated', landUse]}
			                ]}                
			              }
			            },
			            []
			          ]
			        }
			      }
			    }},
			    {$sort: {'consolidated': -1}},
			    {$skip: index - 1}
				]
			}
		}

		if(pipeline == undefined) {
			var pipeline = [
					{"$match": filter},
					{"$project": { index:1, mean: {"$avg": "$inspection.counter"}}},
				 	{"$sort": { index: 1}},
					{"$skip": index - 1},
					{"$limit": 1}
			]
		}

		var objPoints = {};
		
		pointsCollection.aggregate(pipeline, function(err, aggregateElem) {
			aggregateElem = aggregateElem[0]

			pointsCollection.findOne({'_id':aggregateElem._id}, function(err, newPoint) {
				point = newPoint;
				var pointTimeList = [];
				var pointTimeTotal = 0;

				newPoint.inspection.forEach(function(timeInspectionUser) {
					pointTimeList.push(timeInspectionUser.counter)
					pointTimeTotal += timeInspectionUser.counter;
				})

				pointTimeTotal = pointTimeTotal/newPoint.userName.length;
				
				var map = function() {
			    for(var i=0; i<this.userName.length; i++) {
				    emit(this.userName[i], this.inspection[i].counter)
			    }
				}

				var reduce = function(keyName, values) {
					return Array.sum(values) / values.length;
				}

				pointsCollection.mapReduce(map, reduce, {
				    out: {inline: 1},
				    query: {'campaign': filter.campaign}
				}, function(err, mapReducePoint) {
					var nameList = [];
					var meanPointList = [];
					var meanPointTotal = 0;

					newPoint.userName.forEach(function(nameUser) {
						mapReducePoint.forEach(function(user) {
							if(nameUser == user._id) {
								nameList.push(user._id)
								meanPointList.push(user.value)
								meanPointTotal += user.value;
							}
						})					
					})

					point.bounds = getWindow(point)

					point.dataPointTime = [];

					for(var i=0; i<newPoint.userName.length; i++) {
						point.dataPointTime.push({
							'name': nameList[i],
							'totalPointTime': pointTimeList[i],
							'meanPointTime': meanPointList[i]
						})
					}
					
					point.dataPointTime.push({
						'name': 'Tempo médio',
						'totalPointTime': pointTimeTotal,
						'meanPointTime': meanPointTotal
					})

					point.timePoints = point.timePoint;
					point.originalIndex = point.index;
					point.index = index;

					creatPoint(point, function(result) {
						pointsCollection.count(filter, function(err, count) {

							result.totalPoints = count
							response.send(result)
							response.end()
						})
					})
				})
			})
		});
	}

	Points.updatedClassConsolidated = function(request, response) {		
		var classArray = request.param("class");
		var pointId = request.param("_id")

		pointsCollection.update({'_id': pointId}, {$set:{'classConsolidated': classArray, 'pointEdited': true}})

		response.end()
	}

	Points.landUseFilter = function(request, response) {
		var campaign = request.session.user.campaign;
		//var landUse = request.param("landUse");
		var userName = request.param("userName");
		var biome = request.param("biome");
		var uf = request.param("uf");
		
		var filter = {
			"campaign": campaign._id
		}

		/*if(landUse) {
			filter["inspection.form.landUse"] = landUse;
		}*/

		if(userName) {
			filter["userName"] = userName;
		}

		if(biome) {
			filter["biome"] = biome;
		}

		if(uf) {
			filter["uf"] = uf;
		}

		pointsCollection.distinct('inspection.form.landUse', filter, function(err, docs) {

			response.send(docs);
			response.end();
		});
	}

	Points.usersFilter = function(request, response) {		
		var campaign = request.session.user.campaign;
		var landUse = request.param("landUse");
		//var userName = request.param("userName");
		var biome = request.param("biome");
		var uf = request.param("uf");
		
		var filter = {
			"campaign": campaign._id
		}

		if(landUse) {
			filter["inspection.form.landUse"] = landUse;
		}

		/*if(userName) {
			filter["userName"] = userName;
		}*/

		if(biome) {
			filter["biome"] = biome;
		}

		if(uf) {
			filter["uf"] = uf;
		}

		pointsCollection.distinct('userName', filter, function(err, docs) {
			response.send(docs);
			response.end();
		});
	}
	
	Points.biomeFilter = function(request, response) {
		var result = [];	
		var campaign = request.session.user.campaign;
		var landUse = request.param("landUse");
		var userName = request.param("userName");
		//var biome = request.param("biome");
		var uf = request.param("uf");
		
		var filter = {
			"campaign": campaign._id
		}

		if(landUse) {
			filter["inspection.form.landUse"] = landUse;
		}

		if(userName) {
			filter["userName"] = userName;
		}

		/*if(biome) {
			filter["biome"] = biome;
		}*/

		if(uf) {
			filter["uf"] = uf;
		}

		pointsCollection.distinct('biome', filter, function(err, docs) {
			
			result = docs.filter(function(element) {
				return element != null;
			})

			response.send(result);
			response.end();
		});
	}

	Points.ufFilter = function(request, response) {
		var campaign = request.session.user.campaign;
		var landUse = request.param("landUse");
		var userName = request.param("userName");
		var biome = request.param("biome");
		//var uf = request.param("uf");
				
		var filter = {
			"campaign": campaign._id
		};

		if(landUse) {
			filter["inspection.form.landUse"] = landUse;
		}

		if(userName) {
			filter["userName"] = userName;
		}

		if(biome) {
			filter["biome"] = biome;
		}

		/*if(uf) {
			filter["uf"] = uf;
		}*/

		pointsCollection.distinct('uf', filter, function(err, docs) {
			
			result = docs.filter(function(element) {
				return element != null;
			})

			response.send(result);
			response.end();
		});
	}

	return Points;
};