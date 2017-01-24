module.exports = function (app) {

	var points = app.controllers.supervisor;
	app.get('/service/points/get-point/:index', points.getPoint);
	app.get('/service/points/total-points/', points.getTotal);
}