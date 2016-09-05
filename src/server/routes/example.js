module.exports = function (app) {

	var example = app.controllers.example;

	app.get('/service/example', example.test);

}