module.exports = function (app) {

	var tms = app.controllers.tms;
	
	app.get('/map*', tms.process);
	app.get('/source/:id', tms.gdalDefinition);
	app.get('/image/:layerId/:pointId', tms.processSingle);

}