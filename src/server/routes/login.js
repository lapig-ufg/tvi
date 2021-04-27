module.exports = function (app) {

	var login = app.controllers.login;
	
	app.post('/service/login', login.enterTvi);
	app.get('/service/login/user', login.getUser);
	app.get('/service/login/logoff', login.logoff);

}
