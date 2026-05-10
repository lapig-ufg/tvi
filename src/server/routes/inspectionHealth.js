/**
 * Rota do controller inspectionHealth (Tier 3.2 — 2026-05-09).
 * GET /api/admin/inspection-health[?campaignId=X]
 */

'use strict';

module.exports = function (app) {

    var requireSuperAdmin = function (req, res, next) {
        if (req.session && req.session.admin && req.session.admin.superAdmin) {
            return next();
        }
        return res.status(401).json({ error: 'Super admin authentication required' });
    };

    var controller = app.controllers && app.controllers.inspectionHealth;
    if (!controller || typeof controller.report !== 'function') {
        console.error('[inspectionHealth routes] controller indisponível; rota NÃO registrada.');
        return;
    }

    app.get('/api/admin/inspection-health', requireSuperAdmin, controller.report);
};
