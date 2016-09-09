module.exports = function (app) {

	var tvi = app.controllers.tvi;

	app.get('/service/tvi', tvi.test);

}