module.exports = function (app) {

	var points = app.controllers.points;
	app.get('/service/points/next-point', points.getCurrentPoint);
	app.post('/service/points/next-point', points.updatePoint);

}