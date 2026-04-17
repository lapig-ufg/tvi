/**
 * TKT-000009 — Rotas de leitura de progresso semanal.
 */

'use strict';

module.exports = function (app) {
	var controller = app.controllers.weeklyProgress;
	if (!controller) return;

	var requireSuperAdmin = function (req, res, next) {
		if (req.session && req.session.admin && req.session.admin.superAdmin) return next();
		return res.status(401).json({ error: 'Super admin authentication required' });
	};

	var requireInspector = function (req, res, next) {
		if (req.session && req.session.user && req.session.user.name && req.session.user.campaign) return next();
		return res.status(401).json({ error: 'Inspector session required' });
	};

	// Endpoint do intérprete (auto-sincroniza progresso e retorna semana atual).
	app.get('/service/me/weekly-progress', requireInspector, controller.me);

	// Endpoint admin — histórico.
	app.get('/api/admin/campaigns/:id/monitoring/weekly-progress', requireSuperAdmin, controller.history);
};
