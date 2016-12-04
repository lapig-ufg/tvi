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
				{ "$where":'this.landUse.length<5' },
				{ "campaign": { "$eq": campaign } },
				{ "underInspection": { $lt: 5 } }
			]
		};

		var currentFilter = { 
			"$and": [
				{ "userName": { "$nin": [ name ] } },
				{ "$where":'this.userName.length<5' },
				{ "campaign": { "$eq": campaign } }
			]
		};

		var totalFilter = { 
			"$and": [
				{"campaign": { "$eq": campaign }}
			]
		};
		
		pointsCollection.findOne(findOneFilter, { sort: [['index', 1]] }, function(err, point) {
			if(String(sessionPointId) != String(point._id)) {
				point.underInspection += 1;
			}

			pointsCollection.save(point, function() {				
				pointsCollection.count(totalFilter, function(err, total) {

					/*for (var i in point.images) {
						point.images[i].imageBase = 'service/points/'+point._id+'/'+point.images[i].period+'/nopoint/image.png';
						point.images[i].imageBaseRef = 'service/points/'+point._id+'/'+point.images[i].period+'/wpoint/image.png';
					}*/
					pointsCollection.count({$and: [
    														{ userName: { $in: [name] } },
    														{"campaign":campaign}]}, function (err, count) {						
						
						var result = {};
						result['point'] = point;
						result['total'] = total;
						result['current'] = point.index
						result['user'] = name;
						result['count'] = count;
						callback(result);
					})
				});				
			});
		});

	};

	Points.getCurrentPoint = function(request, response) {		
		var user = request.session.user;

		findPoint(user.name, user.campaign, request.session.currentPointId, function(result) {

				request.session.currentPointId = result.point._id;
				response.send(result);
				response.end();
				
			})
					
	};

	/*Points.getCurrentPointImage = function(request, response) {
		
		var pointId = request.param('id');
		var pointPeriod = request.param('period');
		var pointType = request.param('type');

		pointsCollection.findOne({ _id: app.repository.id(pointId) }, function(err, point) {
			
			var result = '';

			for (i in point.images) {
				if(point.images[i].period == pointPeriod) {
					var imgBase = (pointType == 'wpoint') ? point.images[i].imageBaseRef : point.images[i].imageBase
					if(imgBase != undefined) {
						result = new Buffer(imgBase, 'base64');
						break;
					}
				}
			}

			response.setHeader('content-type', 'image/png');
			response.write(result);
			response.end();
		})

	}*/

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