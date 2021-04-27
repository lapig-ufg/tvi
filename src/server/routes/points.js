module.exports = function (app) {

	var login = app.controllers.login;
	var points = app.controllers.points;

	app.get('/service/points/next-point', points.getCurrentPoint);
	app.post('/service/points/update-point', points.updatePoint);

}