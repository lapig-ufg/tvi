var ejs = require('ejs');
var fs = require('fs')

module.exports = function(app) {
	
	var Login = {};
	var pointsCollection = app.repository.collections.points;
	var usersCollection = app.repository.collections.users;

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

		pointsCollection.count({"campaign": campaign}, function(err, count) {
			
			var result = {
				login: (count > 0)
			}

			if(result.login) {
				request.session.user = { 
					"name": name, 
					"campaign": campaign
				};
			}

			response.send(result);
			response.end();
		});

	}

	Login.logoff = function(request, response){
		delete request.session.user;
		delete request.session.name;
		response.write("deslogado");
		response.end();
	}



	return Login;

}