var ejs = require('ejs');
var fs = require('fs')
var schedule = require('node-schedule');

module.exports = function(app) {

	var Points = {};
	var pointSession = [];

	var pointsCollection = app.repository.collections.points;

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
		
		pointsCollection.findOne(findOneFilter, function(err, point) {
			if(sessionPointId == undefined || String(sessionPointId) != String(point._id)) {
				point.underInspection += 1;
			}

			pointsCollection.save(point, function() {				
				pointsCollection.count(totalFilter, function(err, total) {
					
					var result = {};
					result['point'] = point;
					result['total'] = total;
					result['current'] = point.index // current tras o numero de objetos que satisfazem, no caso, a condição findOneFilter;
					callback(result);
				});				
			});
		});

	};

	Points.getCurrentPoint = function(request, response) {		
		var user = request.session.user;

		findPoint(user.name, user.campaign, request.session.currentPointId, function(result) {

				request.session.currentPointId = result.point._id;


				//var bitmap = new Buffer(data, 'base64');

				response.send(result);
				response.end();
				
			})
					
	};

	Points.getCurrentPointImage = function(request, response) {
		
		var pointId = request.param('id');
		var pointPeriod = request.param('period');

		response.end('fim');
	}

	Points.updatePoint = function(request, response) {	
		
		var point = request.body.point;
		var user = request.session.user;

		pointsCollection.update(
			{ 
				 _id: app.repository.id(point._id)
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