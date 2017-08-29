var ejs = require('ejs');
var fs = require('fs');
var csvWriter = require('csv-write-stream');
var schedule = require('node-schedule');
var iconv = require('iconv');

module.exports = function(app) {

	var Points = {};
	var pointsCollection = app.repository.collections.points;
	var mosaics = app.repository.collections.mosaics;
	var campaign;

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
		campaign = request.session.user.campaign;

		pointsCollection.find({ "campaign": campaign._id }).sort({ 'index': 1}).toArray(function(err, points) {
			var csvResult = [];

			points.forEach(function(point) {

				var csvLines = {
					'index': point.index,
					'lon': point.lon,
					'lat': point.lat,
				};
				
				var landUses = {};
				
				for(var i=0; i < point.userName.length; i++) {
					
					var userName = point.userName[i];
					var form = point.inspection[i].form;

					form.forEach(function(f) {
						
						for( var year = f.initialYear; year <= f.finalYear; year++) {
							csvLines[year+"_"+userName] = f.landUse
							
							if(!landUses[year])
								landUses[year] = [];

							landUses[year].push(f.landUse);
						}
					});

				}

				for(var landUse in landUses) {
					
					var votes = {};

					for (var i in landUses[landUse]) {
						if(!votes[landUses[landUse][i]])
							votes[landUses[landUse][i]]=0

						votes[landUses[landUse][i]] += 1;
					}

					for(var i in votes) {
						
						if (votes[i] >= Math.ceil(landUses[landUse].length / 2)) {
							csvLines[landUse+"_majority"] = i;
							csvLines[landUse+"_majority_votes"] = votes[i];
							break;
						}

					}
				}

				csvResult.push(csvLines)
			});

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
			
		});
	}

	Points.getPoint = function(request, response){
		campaign = request.session.user.campaign;
		var index = parseInt(request.param("index"));
		var landUse = request.param("landUse");

		var filter = {
			"campaign": campaign._id
		};

		if (landUse)
			filter["inspection.form.landUse"] = landUse;

		pointsCollection.find(filter).sort({ "index": 1 }).skip(index - 1).nextObject(function(err, point){
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

			point.originalIndex = point.index;
			point.index = index;

			point.inspection = yearlyInspections;
			point.years = years;

			getImageDates(point.path, point.row, function(dates) {
				point.dates = dates
				
				var result = {
					"point": point
				}

				var numInsp = result.point.inspection.length;
				
				var points = [];
				var consolid = [];

				for(var i=0; i < result.point.years.length; i++) {
					
					pointAux = {};
					for(var j=0; j< result.point.inspection.length; j++) {
						var key = result.point.inspection[j].landUse[i];
						if(!pointAux[key])
							pointAux[key] = 0;
						
						pointAux[key]++;
					}

					isConsolidate = false;
					for(var key in pointAux) {
						if(pointAux[key] >= numInsp/2) {
							isConsolidate = true;
							break;
						}
					}

					if(isConsolidate) {
						consolid.push(key);
					} else {
						consolid.push("Não consolidado");
					}
				}

				var objConsolid = {
					type: "Classe Consolidada",
					landUse: consolid
				}
				
				pointsCollection.count(filter, function(err, count) {
					
					result.point.classConsolid = objConsolid
					result.totalPoint = count

					response.send(result)
					response.end();
				})

			});
		});
	}

	Points.landUseFilter = function(request, response) {
		var landUses = [];
		
		landUses = request.session.user.campaign.landUse
		response.send(landUses);
		response.end();
	}

	Points.usersFilter = function(request, response) {
		var users = request.session.user.campaign;

		response.send(users);
		response.end();
	}

	return Points;
};