module.exports = function (app) {

	var points = app.controllers.supervisor;

	app.get('/service/points/get-point', points.getPoint);

	app.get('/service/:lon/:lat', points.getPointWithParam);

}