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
		var keyObjCount = {};
		var tempArray = [];

		point.inspection.fillDate = new Date();

		for(var i=0; i<point.inspection.form.length; i++) {
			for(var j=point.inspection.form[i].initialYear; j<=point.inspection.form[i].finalYear; j++) {				
				tempArray.push(point.inspection.form[i].landUse)
			}
		}

		points.find({'campaign':user.campaign._id}).forEach(function(docs) {
			if(point._id == docs._id) {
				if(docs.underInspection == user.campaign.numInspec && docs.userName.length == docs.underInspection - 1) {

					docs.arrayLandUse.push(tempArray)

					for(var count=0; count<tempArray.length; count++) {
						var flagConsolid = false;

						for(var i=0; i<docs.arrayLandUse.length; i++) {

							var landUseConsolid = docs.arrayLandUse[i][count]
							if(!keyObjCount[landUseConsolid])
								keyObjCount[landUseConsolid] = 0

							keyObjCount[landUseConsolid]++
						}

						var objCount = Object.keys(keyObjCount).length;
						var countInt = 0;

						for(var key in keyObjCount) {
							countInt++;

							if(keyObjCount[key] >= user.campaign.numInspec/2) {
								points.update({_id: point._id}, {$push: {"classConsolidated": key}})

								flagConsolid = true;
							} else if(flagConsolid == false && objCount == countInt) {
								points.update({_id: point._id}, {$push: {"classConsolidated": "Não consolidado"}})

								flagConsolid = true;
							}
						}

						keyObjCount = {};
					}

					points.update({
						_id: point._id
					},
					{
						$push: {
							"inspection": point.inspection,
					  	"userName": user.name
					  }
					},
					function(err, item) {
						findPoint(user.campaign, user.name, function(result) {

							request.session.currentPointId = result.point._id;
							response.send(result);
							response.end();
						})			
					})
				} else {

					points.update({
						_id: point._id
					},
					{
						$push: {
							"inspection": point.inspection,
					  	"userName": user.name
					  }
					},
					function(err, item) {
						findPoint(user.campaign, user.name, function(result) {

							request.session.currentPointId = result.point._id;
							response.send(result);
							response.end();
						})			
					})
				}
			}
		})
	};

	return Points;
}