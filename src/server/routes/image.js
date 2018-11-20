module.exports = function (app) {

	var image = app.controllers.image;
	
	app.get('/source/:id', image.gdalDefinition);
	app.get('/image/:layerId/:pointId', image.access);

}