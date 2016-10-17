module.exports = function (app) {

	var kml = app.controllers.kml;
	app.get('/service/kml', kml.KmlGenerator);

}