var ejs = require('ejs');
var fs = require('fs')
var schedule = require('node-schedule');

module.exports = function(app) {

	var Points = {};
	var pointsCollection = app.repository.collections.points;
	var mosaics = app.repository.collections.mosaics;

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

	Points.getPoint = function(request, response){
		
		var campaign = request.session.user.campaign;
		var index = parseInt(request.params.index);

		pointsCollection.findOne({ $and: [ { "index": index }, { "campaign": campaign } ] }, function(err, point){
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

				response.send(result)
				response.end();
			});

		});

	}

	Points.getTotal = function(request, response){
		var campaign = request.session.user.campaign;
		
		pointsCollection.count({"campaign": campaign}, function(err, count){
			point = {}
			point.count = count;
			response.send(point);
			response.end();
		})
	}

	return Points;

};