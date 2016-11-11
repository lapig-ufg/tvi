var ejs = require('ejs');
var fs = require('fs')

module.exports = function(app) {

	var Points = {};

	var pointsCollection = app.repository.collections.points;
	
	var findPoint = function(name, campaign, callback){
		var findOneFilter = { 
			"$and": [
				{ "name": { "$nin": [ name ] } },
				{"Classe_uso" : {$exists:true}, $where:'this.Classe_uso.length<3'},//{$where: "this.Classe_uso.length < 3"},
				{ "campaign": { "$eq": campaign } },
				{ "inspection": { $lt: 3 } }
			]
		};

		var countCurrentFilter = { 
			"$and": [
				{ "name": { "$nin": [ name ] } },
				{"Classe_uso" : {$exists:true}, $where:'this.Classe_uso.length<3'},//{$where: "this.Classe_uso.length < 3"},
				{ "campaign": { "$eq": campaign } }
			]			
		};

		var countFilter = { 
			"$and": [
				{"campaign": { "$eq": campaign }},
				{"Classe_uso" : {$exists:true}, $where:'this.Classe_uso.length<3'}
			]
		};
		
		pointsCollection.findOne(findOneFilter, function(err, point) {
			pointsCollection.count(countCurrentFilter, function(err, current) {
				pointsCollection.count(countFilter, function(err, count) {
					var result = {};
					result['point'] = point;
					result['total'] = count;
					result['current'] = (1+count)-(current);
					callback(result);
				});
			});
		});

	}

	Points.getCurrentPoint = function(request, response) {		
		var user = request.session.user;
		findPoint(user.name, user.campaign, function(result){
			response.send(result);
			response.end();			
		});
	};

	/*
	setInterval(function(){
		console.log('oi')
	}, 1000);
	*/

	//{$set: {"Classe_uso": { $push: {point.classe_uso} }, "assurance": [point.ass], "name":[request.session.user.name]}}
	Points.updatePoint = function(request, response) {		
		var point = request.body.point;
		var user = request.session.user;
		pointsCollection.update({ "_id":app.repository.id(point._id) },{$push: {"Classe_uso": point.classe_uso, "ass": point.ass, "name": request.session.user.name}}, {w: 1, multi:true}, function(err, item){
			var current = 0;
			findPoint(user.name, user.campaign, function(result){
				response.send(result);
				response.end();
			})			
		})
	};

	return Points;

}