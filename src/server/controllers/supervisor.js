var ejs = require('ejs');
var fs = require('fs')
var schedule = require('node-schedule');

module.exports = function(app) {

	var Points = {};
	var pointsCollection = app.repository.collections.points;


	Points.getPoint = function(request, response){
		var user = request.session.user;
		console.log('oi', user.campaign);
		pointsCollection.findOne({"campaign": user.campaign}, function(err, document){
			response.send(document)
			response.end();
		});

	}

	Points.getPointWithParam = function(request, response){
		
		var coord = request.params.lon+'_'+request.params.lat
		var campaign = request.session.user.campaign
	
		pointsCollection.findOne({ $and: [ { "coord": coord }, { "campaign": campaign } ] }, function(err, obj){			
			response.send(obj)
			response.end();
		});


	}

	return Points;

};