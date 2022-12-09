module.exports = function (app) {

	var points = app.controllers.supervisor;

	app.get('/service/points/csv', points.csv);
	app.post('/service/points/get-point', points.getPoint);
	app.get('/service/points/landUses/', points.landUseFilter);
	app.get('/service/points/users/', points.usersFilter);
	app.get('/service/points/biome/', points.biomeFilter);
	app.get('/service/points/uf/', points.ufFilter);
	app.post('/service/points/updatedClassConsolidated/', points.updatedClassConsolidated);
	app.get('/service/campaign/correct', points.correctCampaign);
	app.get('/service/campaign/csv-borda', points.getBorda);
}
