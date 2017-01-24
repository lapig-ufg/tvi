var ejs = require('ejs');
var fs = require('fs')
var schedule = require('node-schedule');

module.exports = function(app) {

	var Points = {};
	var pointsCollection = app.repository.collections.points;


	Points.getPoint = function(request, response){
		
		var campaign = request.session.user.campaign;
		var index = parseInt(request.params.index);
		console.log(campaign, index);
		pointsCollection.findOne({ $and: [ { "index": index }, { "campaign": campaign } ] }, function(err, document){
			response.send(document)
			response.end();
		});

	}

	return Points;

};