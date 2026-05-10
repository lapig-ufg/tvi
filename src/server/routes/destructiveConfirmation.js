/**
 * Rotas auxiliares de confirmação destrutiva (Tier 1.4 — 2026-05-09).
 *
 * Disponibiliza:
 *   POST /api/admin/destructive-token
 *
 * que admite super-admin emitir um token descartável de 60s para autorizar
 * a próxima chamada a uma rota destrutiva (softWipePoint, removeInspections,
 * discardBlock, etc.) que use `requireDestructiveConfirmation` no pipeline.
 *
 * Body de exemplo:
 *   { "intent": "softWipePoint", "context": { "pointId": "9395_..." } }
 *
 * Resposta:
 *   { "token": "abc123...", "expiresIn": 60, "issuedAt": "2026-05-09T..." }
 *
 * Ver clever-dreaming-pudding.md §1.4 e middleware/destructiveConfirmation.js.
 */

'use strict';

module.exports = function (app) {

    // Mesmo padrão usado em routes/blocosApi.js, weeklyGoals.js, doubts.js.
    var requireSuperAdmin = function (req, res, next) {
        if (req.session && req.session.admin && req.session.admin.superAdmin) {
            return next();
        }
        return res.status(401).json({ error: 'Super admin authentication required' });
    };

    var dc = app.middleware.destructiveConfirmation;
    if (!dc || typeof dc.issueTokenHandler !== 'function') {
        // Falha rápida e visível: a rota não é registrada se o middleware não
        // estiver disponível. Evita 500 silencioso em runtime.
        console.error('[destructiveConfirmation routes] Middleware indisponível; rota /api/admin/destructive-token NÃO registrada.');
        return;
    }

    app.post('/api/admin/destructive-token', requireSuperAdmin, dc.issueTokenHandler);
};
