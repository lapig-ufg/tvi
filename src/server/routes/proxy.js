module.exports = function (app) {

	var proxy = app.controllers.proxy;

	app.get('/service/spatial/query', proxy.doRequest);

}