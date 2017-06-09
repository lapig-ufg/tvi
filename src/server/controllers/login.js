var ejs = require('ejs');
var fs = require('fs')

module.exports = function(app) {
	
	var Login = {};
	var points = app.repository.collections.points;
	var usersCollection = app.repository.collections.users;
	
	var user;

	Login.autenticateUser = function(request, response, next) {
		
		if(request.session.user && request.session.user.name) {
			next();
		} else {
			response.write("I should not be here !!!")
			response.end()
		}
	}

	Login.getUser = function(request, response) {
		user = request.session.user;
		response.send(user);
		response.end();
	}

	Login.enterTvi = function(request, response){
		var campaign = request.param('campaign');
		var name = request.param('name');
		var senha = request.param('senha');

		points.count({"campaign": campaign}, function(err, count) {

			var result = {
				campaign:"",
				name:"",
				type :false
			}

			if(count > 0) {
				request.session.user = { 
					"name": name, 
					"campaign": campaign,
					"type": 'inspector'
				};

				if(name == 'admin' && senha == 'lapigSergio') {
					request.session.user.type = 'supervisor';
				}

				result = request.session.user;

			}

			response.send(result);
			response.end();
		});

	}

	Login.logoff = function(request, response){

		points.update({"_id": request.session.currentPointId}, { $inc: { underInspection: -1}}, function(point) {
			delete request.session.user;
			delete request.session.name;
			response.write("deslogado");
			response.end();
			
		});
	}

	app.on('socket-disconnect', function(socket) {

		points.update({"_id": socket.request.session.currentPointId}, { $inc: { underInspection: -1}}, function(point) {
			
		});
	});

	return Login;

}