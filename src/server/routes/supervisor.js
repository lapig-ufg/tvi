module.exports = function (app) {

	var points = app.controllers.supervisor;
	app.get('/service/points/get-point/:index', points.getPoint);

}