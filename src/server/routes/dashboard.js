module.exports = function (app) {

	var dashboard = app.controllers.dashboard;

	app.get('/service/points/count/', dashboard.inspection);

}