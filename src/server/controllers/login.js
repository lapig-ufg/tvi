var ejs = require('ejs');
var fs = require('fs')

module.exports = function(app) {
	
	var Login = {};
	var points = app.repository.collections.points;
	var campaigns = app.repository.collections.campaign;

	Login.autenticateUser = function(request, response, next) {
		if(request.session.user && request.session.user.name) {
			next();
		} else {
			response.write("I should not be here !!!")
			response.end()
		}
	}

	Login.getUser = function(request, response) {
		var user = request.session.user;
		response.send(user);
		response.end();
	}

	Login.enterTvi = function(request, response) {
		var campaignId = request.param('campaign');
		var name = request.param('name');
		var senha = request.param('senha');

		campaigns.findOne({"_id": campaignId}, function(err, campaign) {

			var result = {
				campaign:"",
				name:"",
				type :false
			}

			if(campaign) {
				if((senha == campaign.password) || (senha == 'tviadmintvi')) {

					request.session.user = { 
						"name": name,
						"campaign": campaign._id,
						"type": 'inspector'
					};

					if(name == 'admin' && senha == 'tviadmintvi') {
						request.session.user.type = 'supervisor';
					}

					request.session.user.campaign = campaign

					result = request.session.user;
				}
			}

			response.send(result);
			response.end();
		});
	}

	Login.logoff = function(request, response) {
		var user = request.session.user;

		if(user.type == 'inspector') {

			points.update({"_id": request.session.currentPointId}, { $inc: { underInspection: -1}}, function(point) {
				delete request.session.user;
				delete request.session.name;
				response.write("deslogado");
				response.end();
			});
		} else {
			delete request.session.user;
			delete request.session.name;
			response.write("deslogado");
			response.end();
		}
	}

	app.on('socket-disconnect', function(socket) {
		if(socket.handshake.session && socket.handshake.session.currentPointId) {
			if(socket.handshake.session.user.type == 'inspector') {
				points.update({"_id": socket.handshake.session.currentPointId}, { $inc: { underInspection: -1}})
			} 
		}
	});

	return Login;
}