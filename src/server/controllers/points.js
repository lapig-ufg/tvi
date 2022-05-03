var ejs = require('ejs');
var fs = require('fs')
var schedule = require('node-schedule');

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
		var findOneUpdate = {'$inc':{'underInspection': 1}}

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

		var updateStruct = {
			'$push': {
				"inspection": point.inspection,
		  	"userName": user.name
		  }
		};

		points.findOne({ '_id': point._id }, function(err, pointDb) {
			
			if(pointDb.userName.length == user.campaign.numInspec - 1) {
				updateStruct['$set'] = classConsolidate(point, pointDb, user);
			}

			points.update({ '_id': pointDb._id }, updateStruct, function(err, item) {
				//findPoint(user.campaign, user.name, function(result) {
				//	request.session.currentPointId = result.point._id;

				var result = { "success": (err == null), "err": err }

				response.send(result);
				response.end();
				//});
			});

		});
	};

	return Points;
}
