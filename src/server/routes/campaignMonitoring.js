module.exports = function(app) {
	var monitoring = app.controllers.campaignMonitoring;
	var logger = app.services.logger;

	if (logger) {
		logger.info('Carregando rotas de monitoramento de campanhas', {
			module: 'routes',
			function: 'campaignMonitoring'
		});
	}

	// Middleware de autenticação para super-admin (mesmo padrão de campaignCrud.js)
	var requireSuperAdmin = function(req, res, next) {
		if (req.session && req.session.admin && req.session.admin.superAdmin) {
			return next();
		}
		var authError = new Error('Super admin authentication required');
		authError.statusCode = 401;
		authError.code = 'AUTH_REQUIRED';
		return next(authError);
	};

	var base = '/api/admin/campaigns/:id/monitoring';

	app.get(base + '/donuts', requireSuperAdmin, monitoring.donuts);
	app.get(base + '/inspections-per-user', requireSuperAdmin, monitoring.inspectionsPerUser);
	app.get(base + '/land-use-distribution', requireSuperAdmin, monitoring.landUseDistribution);
	app.get(base + '/points-summary', requireSuperAdmin, monitoring.pointsSummary);
	app.get(base + '/mean-time', requireSuperAdmin, monitoring.meanTime);
	app.get(base + '/cached-points', requireSuperAdmin, monitoring.cachedPoints);
	app.get(base + '/agreement', requireSuperAdmin, monitoring.agreement);
	app.get(base + '/land-cover', requireSuperAdmin, monitoring.landCover);
	app.get(base + '/member-status', requireSuperAdmin, monitoring.memberStatus);
	app.get(base + '/inspector-cards', requireSuperAdmin, monitoring.inspectorCards);
	app.post(base + '/point', requireSuperAdmin, monitoring.getPoint);
};
