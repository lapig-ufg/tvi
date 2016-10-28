module.exports = function (app) {

	var login = app.controllers.login;
	var proxy = app.controllers.proxy;

	app.get('/service/spatial/query', login.autenticateUser, proxy.doRequest);

}