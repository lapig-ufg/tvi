var ejs = require('ejs');
var fs = require('fs')

module.exports = function(app) {
	
	var pointsCollection = app.repository.collections.points;
	var Login = {};

	Login.campaignVali = function(request, response){
		var campaign = request.body.campaign;

		pointsCollection.find({"campaign": campaign}).each(function(err, point) {

			console.log(point)

		});

	}

	return Login;

}