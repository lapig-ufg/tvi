/**
 * TKT-000009 — Rotas CRUD de metas semanais por intérprete.
 */

'use strict';

module.exports = function (app) {
	var controller = app.controllers.weeklyGoals;
	if (!controller) return;

	var requireSuperAdmin = function (req, res, next) {
		if (req.session && req.session.admin && req.session.admin.superAdmin) return next();
		return res.status(401).json({ error: 'Super admin authentication required' });
	};

	var base = '/api/admin/campaigns/:campaignId/weekly-goals';
	app.get(base, requireSuperAdmin, controller.list);
	app.put(base + '/:userName', requireSuperAdmin, controller.upsert);
	app.delete(base + '/:userName', requireSuperAdmin, controller.remove);
};
