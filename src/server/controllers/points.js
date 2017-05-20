var ejs = require('ejs');
var fs = require('fs')
var schedule = require('node-schedule');

module.exports = function(app) {

	var Points = {};
	var pointSession = [];

	var points = app.repository.collections.points;
	var pointsImg = app.repository.collections.pointsImg;

	var findPoint = function(name, campaign, sessionPointId, callback){
		var findOneFilter = { 
			"$and": [
				{ "userName": { "$nin": [ name ] } },
				{ "$where":'this.landUse.length<3' },
				{ "campaign": { "$eq": campaign } },
				{ "underInspection": { $lt: 3 } }
			]
		};
		var currentFilter = { 
			"$and": [
				{ "userName": { "$nin": [ name ] } },
				{ "$where":'this.userName.length<3' },
				{ "campaign": { "$eq": campaign } }
			]
		};

		var totalFilter = { 
			"$and": [
				{"campaign": { "$eq": campaign }}
			]
		};
		
		points.findOne(findOneFilter, { sort: [['index', 1]] }, function(err, point) {

			if(String(sessionPointId) != String(point._id)) {
				point.underInspection += 1;
			}

			points.save(point, function() {				

				points.count(totalFilter, function(err, total) {

					points.count({$and: [
    														{ userName: { $in: [name] } },
    														{"campaign":campaign}]}, function (err, count) {						
						var pointId = sessionPointId+'_'+campaign;
						pointsImg.find({"pointId": pointId}).toArray(function(err, img){
							point.img = img
							console.log(err, img)
							//point.modis = img.modis;
							var result = {};
							result['point'] = point;
							result['total'] = total;
							result['current'] = point.index
							result['user'] = name;
							result['count'] = count;
							callback(result);
							
						})
					})
				});				
			});
		});

	};

	Points.getCurrentPoint = function(request, response) {		
		var user = request.session.user;

		// user.name = 'jose';
		//user.campaign = 'campanha_s'
		// request.session.currentPointId = 0
		findPoint('jose', 'campanha_s', 0, function(result) {
				request.session.currentPointId = result.point._id;
				response.send(result);
				response.end();				
			})					
	};

	Points.updatePoint = function(request, response) {	
		
		var point = request.body.point;
		var user = request.session.user;

		points.update(
			{ 
				 _id: point._id
			},
			{
				$push: {
					"landUse": point.landUse,
			 		"certaintyIndex": point.certaintyIndex,
			  	"userName": request.session.user.name,
			  	"counter": point.counter,
			  }
			}, 
			 function(err, item){
				findPoint(user.name, user.campaign, request.session.currentPointId, function(result){
					request.session.currentPointId = result.point._id
					response.send(result);
					response.end();
				})			
		});
	};

	return Points;

}