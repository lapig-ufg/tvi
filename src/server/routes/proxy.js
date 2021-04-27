module.exports = function (app) {

	var login = app.controllers.login;
	var proxy = app.controllers.proxy;

	app.get('/service/spatial/query', login.autenticateUser, proxy.doRequest);
	app.get('/service/time-series/:serie', login.autenticateUser, proxy.timeSeries);
	app.get('/service/spatial/precipitation', proxy.precipitationMaps);


}