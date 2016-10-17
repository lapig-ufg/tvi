var ejs = require('ejs');
var fs = require('fs')

module.exports = function(app) {

	var Points = {};

	var pointsCollection = app.repository.collections.points;
	
	var findPoint = function(current, callback){
		pointsCollection.findOne({"Classe_uso": { $exists: false }}, {skip: current, limit: 1}, function(err, point) {
			pointsCollection.count(function(err, count) {
				pointsCollection.count({"Classe_uso": {$exists: true}}, function(err, current){
					var result = {};
					result['point'] = point;
					result['total'] = count;
					result['current'] = current + 1;				
					callback(result);									
				})
			});
		});
	}

	Points.getCurrentPoint = function(request, response) {		
		var current = 0;
		findPoint(current, function(result){
			response.send(result);
			response.end();			
		});
	};

	Points.updatePoint = function(request, response) {		
		var point = request.body.point;
		pointsCollection.update({ "_id" :  app.repository.id(point._id) },{$set: {"Classe_uso": point.classe_uso, "assurance": point.ass}}, {w: 1, multi:true}, function(err, item){
			var current = 0;
			findPoint(current, function(result){
				response.send(result);
				response.end();
			})			
		})
	};

	return Points;

}