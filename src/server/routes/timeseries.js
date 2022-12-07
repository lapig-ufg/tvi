module.exports = function (app) {
	const timeseries = app.controllers.timeseries;
	app.get('/service/timeseries/landsat/ndvi', timeseries.getLandsatNdviByLonLat);
	app.post('/service/timeseries/landsat/ndvi', timeseries.landsatNdviByGeometry);
}
