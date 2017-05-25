module.exports = function (app) {

	var tms = app.controllers.tms;
	
	app.get('/map*', tms.process);

}