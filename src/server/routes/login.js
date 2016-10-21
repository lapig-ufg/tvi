module.exports = function (app) {

	var login = app.controllers.login;
	app.post('/service/login', login.campaignVali);

}
