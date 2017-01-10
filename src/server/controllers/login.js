var ejs = require('ejs');
var fs = require('fs')

module.exports = function(app) {
	
	var Login = {};
	var pointsCollection = app.repository.collections.points;
	var usersCollection = app.repository.collections.users;
	

	var updateUnderInspection = function() {

	}

	Login.autenticateUser = function(request, response, next) {
		if(request.session.user && request.session.user.name) {
			next();
		} else {
			response.write("I should not be here !!!")
			response.end()
		}
	}

	Login.getUser = function(request, response) {
		response.send(request.session.user);
		response.end();
	}

	Login.enterTvi = function(request, response){
		var campaign = request.param('campaign');
		var name = request.param('name');
		var senha = request.param('senha');

		console.log({"campaign": campaign});
		pointsCollection.count({"campaign": campaign}, function(err, count) {

			var result = {
				login: (count > 0)
			}

			if(result.login) {
				request.session.user = { 
					"name": name, 
					"campaign": campaign,
					"type": 'inspector'
				};

				if(name == 'admin' && senha == 'lapigSergio') {
					request.session.user.type = 'supervisor';
					result.type = 'supervisor';
				}

			}

			response.send(result);
			response.end();
		});

	}

	Login.logoff = function(request, response){
		var id = app.repository.id(request.session.currentPointId)
		pointsCollection.update({"_id": id}, { $inc: { underInspection: -1}}, function(point) {
			delete request.session.user;
			delete request.session.name;
			response.write("deslogado");
			response.end();
			
		});
	}

	app.on('socket-disconnect', function(socket) {
		var id = app.repository.id(socket.request.session.currentPointId);

		pointsCollection.update({"_id": id}, { $inc: { underInspection: -1}}, function(point) {
			console.log("disconneect");
		});
	});

	return Login;

}