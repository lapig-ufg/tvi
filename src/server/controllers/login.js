var ejs = require('ejs');
var fs = require('fs')

module.exports = function(app) {
	
	var Login = {};
	const logger = app.services.logger;
	
	var users = app.repository.collections.users;
	var points = app.repository.collections.points;
	var campaigns = app.repository.collections.campaign;
	var statusLogin = app.repository.collections.status;

	Login.autenticateUser = async function(request, response, next) {
		if(request.session.user && request.session.user.name) {
			next();
		} else {
			const logId = await logger.warn('Unauthorized access attempt', {
				module: 'login',
				function: 'autenticateUser',
				req: request
			});
			response.status(401).json({
				error: 'Unauthorized access',
				logId: logId
			});
		}
	}

	Login.getUser = function(request, response) {
		var user = request.session.user;
		response.send(user);
		response.end();
	}

	Login.enterTvi = async function(request, response) {
		var campaignId = request.body.campaign;
		var name = request.body.name;
		var senha = request.body.senha;

		await logger.info('Login attempt', {
			module: 'login',
			function: 'enterTvi',
			metadata: { campaignId, name },
			req: request
		});

		campaigns.findOne({"_id": campaignId}, async function(err, campaign) {

			if(err) {
				const logId = await logger.error('Database error during login', {
					module: 'login',
					function: 'enterTvi',
					metadata: { error: err.message, campaignId },
					req: request
				});
				return response.status(500).json({
					error: 'Database error',
					logId: logId
				});
			}

			var result = {
				campaign:"",
				name:"",
				type :false
			}

			if(campaign) {

				users.findOne({ _id: 'admin'}, async function(err, adminUser) {
					if(err) {
						const logId = await logger.error('Database error finding admin user', {
							module: 'login',
							function: 'enterTvi',
							metadata: { error: err.message },
							req: request
						});
						return response.status(500).json({
							error: 'Database error',
							logId: logId
						});
					}
					
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
						
						await logger.info('Successful login', {
							module: 'login',
							function: 'enterTvi',
							metadata: { name, campaignId, userType: result.type },
							req: request
						});
					} else {
						await logger.warn('Failed login attempt - invalid password', {
							module: 'login',
							function: 'enterTvi',
							metadata: { name, campaignId },
							req: request
						});
					}
					
					response.send(result);
					response.end();
				})
				

			} else {
				await logger.warn('Login attempt with invalid campaign', {
					module: 'login',
					function: 'enterTvi',
					metadata: { campaignId, name },
					req: request
				});
				response.send(result);
				response.end();
			}

		});
	}

	Login.logoff = async function(request, response) {
		
		var name = request.session.user.name;
		var user = request.session.user;
		var campaign = request.session.user.campaign;

		if(user.type == 'inspector') {

			statusLogin.update({"_id": name+"_"+campaign._id}, {$set:{"status":"Offline"}})
			points.update({'_id': request.session.currentPointId}, {'$inc':{'underInspection': -1}})

			await logger.info('Inspector logged off', {
				module: 'login',
				function: 'logoff',
				metadata: { name, campaignId: campaign._id, pointId: request.session.currentPointId },
				req: request
			});

			delete request.session.user;
			delete request.session.name;
			delete request.session.currentPointId;

			response.write("deslogado");
			response.end();

		} else {
			
			await logger.info('User logged off', {
				module: 'login',
				function: 'logoff',
				metadata: { name, userType: user.type },
				req: request
			});

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