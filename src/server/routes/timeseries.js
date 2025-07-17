module.exports = function (app) {
	const timeseries = app.controllers.timeseries;
	app.get('/service/timeseries/landsat/ndvi', timeseries.getTimeSeriesLandsatNdviByLonLat);
	app.get('/service/timeseries/nddi', timeseries.getTimeSeriesLandsatNDDIByLonLat);
	app.post('/service/timeseries/landsat/ndvi', timeseries.landsatNdviByGeometry);
	
	// Rotas API para admin-temporal
	app.get('/api/timeseries/landsat/ndvi', timeseries.getTimeSeriesLandsatNdviByLonLat);
	app.get('/api/timeseries/nddi', timeseries.getTimeSeriesLandsatNDDIByLonLat);
}
