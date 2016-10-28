module.exports = function (app) {

	var kml = app.controllers.kml;
	var login = app.controllers.login;
	
	app.get('/service/kml', login.autenticateUser, kml.KmlGenerator);

}