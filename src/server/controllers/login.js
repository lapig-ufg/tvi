var ejs = require('ejs');
var fs = require('fs')

module.exports = function(app) {
	
	var Login = {};
	
	var users = app.repository.collections.users;
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

				users.findOne({ _id: 'admin'}, function(err, adminUser) {
					
					if((senha == campaign.password) || (senha == adminUser.password)) {

						request.session.user = { 
							"name": name,
							"campaign": campaign._id,
							"type": "inspector"
						};

						if(name == 'admin' && senha == adminUser.password) {
							request.session.user.type = 'supervisor';
						}

						request.session.user.campaign = campaign
						result = request.session.user;
					}
					
					response.send(result);
					response.end();
				})
				

			} else {
				response.send(result);
				response.end();
			}

		});
	}

	Login.logoff = function(request, response) {
		
		var name = request.session.user.name;
		var user = request.session.user;
		var campaign = request.session.user.campaign;

		if(user.type == 'inspector') {

			statusLogin.update({"_id": name+"_"+campaign._id}, {$set:{"status":"Offline"}})
			points.update({'_id': request.session.currentPointId}, {'$inc':{'underInspection': -1}})

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
	})

	app.on('socket-disconnect', function(session) {

		if(session && session.user && session.user.type == 'inspector') {
			
			var name = session.user.name;
			var campaign = session.user.campaign;

			statusLogin.update({"_id": name+"_"+campaign._id}, {$set:{"status":"Offline"}})
			points.update({'_id': session.currentPointId}, {'$inc':{'underInspection': -1}})
		}
	})

	return Login;
}