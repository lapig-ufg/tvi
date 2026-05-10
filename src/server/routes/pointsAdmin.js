/**
 * Rotas administrativas para operações sobre `points` (Tier 1 — 2026-05-09).
 *
 * Disponibiliza endpoints que dependem do `pointsService` (audit + soft-delete)
 * e do middleware `requireDestructiveConfirmation` (token + reason).
 *
 *   POST /api/admin/points/:pointId/restore
 *     Restaura o ponto a partir do último snapshot em points_audit.
 *     Requer super-admin + token destrutivo + reason.
 *
 *   POST /api/admin/points/:pointId/soft-wipe
 *     Substitui o uso de GET /service/admin/campaign/removeInspections
 *     com auditoria, soft-delete e exigência de token + reason. A rota
 *     legada continua viva no Tier 0.4 mas será desencorajada / migrada
 *     para apontar aqui em sprint futuro.
 *
 * Ver clever-dreaming-pudding.md §1.5/§1.6.
 */

'use strict';

module.exports = function (app) {

    var requireSuperAdmin = function (req, res, next) {
        if (req.session && req.session.admin && req.session.admin.superAdmin) {
            return next();
        }
        return res.status(401).json({ error: 'Super admin authentication required' });
    };

    var dc = app.middleware.destructiveConfirmation;
    var pointsService = app.services && app.services.pointsService;
    var logger = app.services && app.services.logger;

    if (!dc || !pointsService) {
        console.error('[pointsAdmin routes] middleware/service indisponível; rotas NÃO registradas.');
        return;
    }

    function buildActor(req) {
        var admin = req.session && req.session.admin;
        var user = req.session && req.session.user;
        return {
            username: (admin && admin.username) || (user && user.name) || 'unknown',
            role: (admin && admin.superAdmin) ? 'superAdmin' : (user && user.role) || null,
            sessionId: req.sessionID || null,
            ip: req.ip || null
        };
    }

    /**
     * POST /api/admin/points/:pointId/restore
     * Body: { confirmationToken, reason }
     */
    app.post('/api/admin/points/:pointId/restore',
        requireSuperAdmin,
        dc.requireDestructiveConfirmation,
        async function (req, res) {
            try {
                var pointId = req.params.pointId;
                var ctx = {
                    actor: buildActor(req),
                    reason: req.destructive.reason,
                    confirmationToken: req.destructive.token
                };
                var result = await pointsService.restore(pointId, ctx);
                if (!result) {
                    return res.status(404).json({ error: 'Nenhum snapshot disponível em points_audit para o ponto ' + pointId });
                }
                return res.json({ success: true, pointId: pointId, restored: true });
            } catch (err) {
                if (logger) {
                    await logger.error('Erro em /api/admin/points/:pointId/restore', {
                        module: 'pointsAdmin',
                        function: 'restore',
                        metadata: { error: err.message, stack: err.stack }
                    });
                }
                return res.status(500).json({ error: err.message });
            }
        }
    );

    /**
     * POST /api/admin/points/:pointId/soft-wipe
     * Body: { confirmationToken, reason }
     */
    app.post('/api/admin/points/:pointId/soft-wipe',
        requireSuperAdmin,
        dc.requireDestructiveConfirmation,
        async function (req, res) {
            try {
                var pointId = req.params.pointId;
                var ctx = {
                    actor: buildActor(req),
                    reason: req.destructive.reason,
                    confirmationToken: req.destructive.token
                };
                var result = await pointsService.softWipePoint(pointId, ctx);
                return res.json({ success: true, pointId: pointId, archivedAt: result.archivedAt });
            } catch (err) {
                if (logger) {
                    await logger.error('Erro em /api/admin/points/:pointId/soft-wipe', {
                        module: 'pointsAdmin',
                        function: 'softWipe',
                        metadata: { error: err.message, stack: err.stack }
                    });
                }
                return res.status(500).json({ error: err.message });
            }
        }
    );
};
