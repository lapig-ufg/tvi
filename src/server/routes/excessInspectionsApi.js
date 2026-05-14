/**
 * Rotas admin — gerenciamento de inspeções excedentes (Tier 2.10, 2026-05-14).
 *
 * Substitui o uso histórico do correctCampaignAdmin (em dry-run desde Tier 0).
 * Veja src/server/controllers/excessInspections.js para detalhes.
 */

'use strict';

module.exports = function (app) {

    var controller = app.controllers && app.controllers.excessInspections;
    var errorHandler = app.middleware && app.middleware.errorHandler;
    var dc = app.middleware && app.middleware.destructiveConfirmation;

    if (!controller || !errorHandler) {
        console.error('[excessInspectionsApi] dependência indisponível; rotas NÃO registradas.');
        return;
    }

    var requireSuperAdmin = function (req, res, next) {
        if (req.session && req.session.admin && req.session.admin.superAdmin) {
            return next();
        }
        var err = new Error('Super admin authentication required');
        err.statusCode = 401;
        err.code = 'AUTH_REQUIRED';
        return next(err);
    };

    // Listagem (read-only)
    app.get('/api/admin/campaigns/:id/excess-inspections',
        requireSuperAdmin,
        errorHandler.asyncHandler(controller.listExcessInspections)
    );

    // Dry-run (read-only do banco; cacheia plano em memória)
    app.post('/api/admin/campaigns/:id/excess-inspections/preview',
        requireSuperAdmin,
        errorHandler.asyncHandler(controller.previewRemoval)
    );

    // Aplicação efetiva — exige token destrutivo + reason
    if (dc && typeof dc.requireDestructiveConfirmation === 'function') {
        app.post('/api/admin/campaigns/:id/excess-inspections/apply',
            requireSuperAdmin,
            dc.requireDestructiveConfirmation,
            errorHandler.asyncHandler(controller.applyRemoval)
        );
    } else {
        console.error('[excessInspectionsApi] destructiveConfirmation indisponível; rota apply NÃO registrada.');
    }

    // Histórico de remoções (lê points_audit)
    app.get('/api/admin/campaigns/:id/excess-inspections/history',
        requireSuperAdmin,
        errorHandler.asyncHandler(controller.getRemovalHistory)
    );
};
