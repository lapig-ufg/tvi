var ejs = require('ejs');
var fs = require('fs')
var schedule = require('node-schedule');

module.exports = function(app) {

	var Points = {};
	var points = app.repository.collections.points;
	var mosaics = app.repository.collections.mosaics;
	//var campaigns = app.repository.collections.campaign;

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

	var findPoint = function(campaign, username, callback) {

		var findOneFilter = {
			"$and": [
				{ "userName": { "$nin": [ username ] } },
				{ "$where":'this.userName.length<'+ campaign.numInspec },
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
				{ "userName": { $in: [ username ] } },
    		{"campaign": campaign._id}
    	]
   	};

		var totalFilter = { 
			"$and": [
				{"campaign": { "$eq":  campaign._id }}
			]
		};

		points.findOne(findOneFilter, { sort: [['index', 1]] }, function(err, point) {
			if(point) {
				point.underInspection += 1;
				points.save(point, function() {
					points.count(totalFilter, function(err, total) {
						points.count(countFilter, function (err, count) {
							getImageDates(point.path, point.row, function(dates) {
								point.dates = dates

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
				});
			} else {
				points.count(totalFilter, function(err, total) {
					points.count(countFilter, function (err, count) {

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

	Points.getCurrentPoint = function(request, response) {
		var user = request.session.user;

		findPoint(user.campaign, user.name, function(result) {
			request.session.currentPointId = result.point._id;

			response.send(result);
			response.end();
		})
	};

	Points.updatePoint = function(request, response) {
		var point = request.body.point;
		var user = request.session.user;

		point.inspection.fillDate = new Date();

		var numberOfInspection = user.campaign.numInspec;

		var updateOperation = {
			'$push': {
				"inspection": point.inspection,
		  	"userName": user.name
		  }
		};

		points.findOne({ '_id':point._id }, function(err, pointDb) {
			if(pointDb.userName.length == numberOfInspection - 1) {

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
					
					var landUseCount = {}

					for(var i=0; i < landUseInspections[year].length; i++) {
						var landUse = landUseInspections[year][i]
						if(!landUseCount[landUse])
							landUseCount[landUse]=0

						landUseCount[landUse]++
					}


					for(var landUse in landUseCount) {
						if(landUseCount[landUse] >= numberOfInspection/2) {
							classConsolidated.push(landUse)
						} else {
							classConsolidated.push("Não consolidado")
						}
					}

				}

				updateOperation['$set'] = { "classConsolidated": classConsolidated };

			}

			points.update({ '_id': point._id }, updateOperation, function(err, item) {
				findPoint(user.campaign, user.name, function(result) {

					request.session.currentPointId = result.point._id;
					response.send(result);
					response.end();
				});
			});

		});

	};

	return Points;
}