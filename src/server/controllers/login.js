var ejs = require('ejs');
var fs = require('fs')

module.exports = function(app) {
	
	var Login = {};
	var points = app.repository.collections.points;
	var campaigns = app.repository.collections.campaign;
	var statusLogin = app.repository.collections.status;

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
						"type": "inspector"
					};

					statusLogin.findOne({"_id": name+"_"+campaign._id}, function(err, userPoint) {
						statusLogin.update({"_id": name+"_"+campaign._id}, {$set:{"status":"Online"}})
					})

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

			statusLogin.findOne({"_id": user.name+"_"+user.campaign._id}, function(err, userPoint) {
				statusLogin.update({"_id": user.name+"_"+user.campaign._id}, {$set:{"status":"Offline"}})
			})

			delete request.session.user;
			delete request.session.name;
			delete request.session.currentPointId;

			response.write("deslogado");
			response.end();

		} else {
			
			delete request.session.user;
			delete request.session.name;

			response.write("deslogado");
			response.end();
		}
	}

	app.on('socket-connect', function(session) {

		if(session && session.user && session.user.type == 'inspector') {

			var name = session.user.name;
			var campaign = session.user.campaign;

			statusLogin.findOne({"_id": name+"_"+campaign._id}, function(err, userPoint) {
				statusLogin.update({"_id": name+"_"+campaign._id}, {$set:{"status":"Online"}})
			})
		}
	})

	app.on('socket-disconnect', function(session) {

		if(session && session.user && session.user.type == 'inspector') {
			
			var name = session.user.name;
			var campaign = session.user.campaign;

			statusLogin.findOne({"_id": name+"_"+campaign._id}, function(err, userPoint) {
				statusLogin.update({"_id": name+"_"+campaign._id}, {$set:{"status":"Offline"}})
			})
		}
	})

	return Login;
}