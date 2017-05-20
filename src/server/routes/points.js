module.exports = function (app) {

	var login = app.controllers.login;
	var points = app.controllers.points;

	app.get('/service/points/next-point', points.getCurrentPoint);
	//app.get('/service/points/:id/:period/:type/image.png', login.autenticateUser, points.getCurrentPointImage);
	app.post('/service/points/next-point', points.updatePoint);

}//app.get('/service/points/next-point', login.autenticateUser, points.getCurrentPoint);
//app.post('/service/points/next-point', login.autenticateUser, points.updatePoint);