module.exports = function (app) {

	var login = app.controllers.login;
	var points = app.controllers.points;

	app.get('/service/points/next-point', points.getCurrentPoint);
	app.post('/service/points/update-point', points.updatePoint);
	
	// Rotas API para admin-temporal
	app.get('/api/points/:pointId', points.getPointById);
	app.post('/api/points/get-point', points.getPointByFilter);
	app.get('/api/points/landUses', points.getLandUses);
	app.get('/api/points/users', points.getUsers);
	app.get('/api/points/biome', points.getBiomes);
	app.get('/api/points/uf', points.getUfs);
	app.post('/service/points/next-point', points.getNextPoint);
	app.post('/service/points/get-point-by-id', points.getPointByIdService);
	app.post('/service/points/updatedClassConsolidated', points.updateClassConsolidated);

}