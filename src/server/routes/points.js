module.exports = function (app) {

	var login = app.controllers.login;
	var points = app.controllers.points;

	app.get('/service/points/next-point', login.autenticateUser, points.getCurrentPoint);
	app.post('/service/points/next-point', login.autenticateUser, points.updatePoint);

}