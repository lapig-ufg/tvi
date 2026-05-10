/**
 * destructiveConfirmation — middleware Express e endpoints auxiliares para
 * exigir token de confirmação descartável + reason em rotas que apagam dados
 * de inspeção.
 *
 * Introduzido no Tier 1.4 (2026-05-09) do plano de defesa contra perda de
 * inspeções (clever-dreaming-pudding.md §1.4).
 *
 * Fluxo:
 *   1. Admin (super-admin) faz POST /api/admin/destructive-token { intent: 'softWipePoint', context: {...} }
 *      → recebe { token, expiresIn: 60 }. O token é registrado em memória.
 *   2. Admin chama a rota destrutiva incluindo no body { confirmationToken, reason }.
 *   3. O middleware `requireDestructiveConfirmation` valida:
 *        - token existe, não expirou, não foi usado
 *        - reason é string com >= 10 caracteres
 *      Em caso de sucesso, marca o token como consumido e anexa
 *      `req.destructive = { token, intent, context, consumedAt }` para o handler.
 *
 * Limitações conhecidas:
 *   - Storage em memória — não persiste entre restarts e não funciona em
 *     deploy multi-instância. OK para uma instância (caso atual). Para multi,
 *     migrar para Redis/Mongo.
 *   - TTL de 60s não é configurável em runtime (constante DEFAULT_TTL_MS).
 *
 * Reuso: o middleware NÃO substitui requireSuperAdmin. Sempre encadear:
 *   app.post(rota, requireSuperAdmin, requireDestructiveConfirmation, handler)
 */

'use strict';

var crypto = require('crypto');

var DEFAULT_TTL_MS = 60 * 1000; // 60 segundos
var REAP_INTERVAL_MS = 30 * 1000; // limpeza periódica
var REASON_MIN_LENGTH = 10;

module.exports = function (app) {

    // Map<token, { intent, context, expiresAt, used, issuedBy, issuedAt }>
    var store = new Map();

    function getLogger() {
        return app.services && app.services.logger;
    }

    function generateToken() {
        // 16 bytes hex = 32 chars; suficiente entropia para 60s TTL single-use.
        return crypto.randomBytes(16).toString('hex');
    }

    function reap() {
        var now = Date.now();
        var removed = 0;
        store.forEach(function (entry, token) {
            if (entry.expiresAt < now) {
                store.delete(token);
                removed++;
            }
        });
        return removed;
    }

    // Limpeza periódica de tokens expirados.
    var reapTimer = setInterval(reap, REAP_INTERVAL_MS);
    if (typeof reapTimer.unref === 'function') {
        reapTimer.unref();
    }

    /**
     * Endpoint Express: emissão de token. Deve ser registrado APÓS
     * `requireSuperAdmin` na cadeia da rota.
     *
     * Body esperado:
     *   { intent: 'softWipePoint' | 'discardBlock' | 'removeInspectorByIndex' | 'correctCampaign' | string,
     *     context: { campaignId?, pointId?, blockIndex?, ... } }
     */
    function issueTokenHandler(req, res) {
        var body = req.body || {};
        var intent = body.intent;
        if (!intent || typeof intent !== 'string') {
            return res.status(400).json({ error: 'Campo intent (string) é obrigatório.' });
        }

        var token = generateToken();
        var now = Date.now();
        var entry = {
            intent: intent,
            context: body.context || {},
            expiresAt: now + DEFAULT_TTL_MS,
            used: false,
            issuedBy: (req.session && req.session.admin && req.session.admin.username) || (req.session && req.session.user && req.session.user.name) || null,
            issuedAt: new Date(now)
        };
        store.set(token, entry);

        var logger = getLogger();
        if (logger) {
            // fire-and-forget; não bloqueia a resposta
            Promise.resolve().then(function () {
                return logger.info('Token destrutivo emitido', {
                    module: 'destructiveConfirmation',
                    function: 'issueTokenHandler',
                    metadata: { intent: intent, issuedBy: entry.issuedBy, ip: req.ip, ttlMs: DEFAULT_TTL_MS }
                });
            }).catch(function () { /* swallow */ });
        }

        res.json({
            token: token,
            expiresIn: DEFAULT_TTL_MS / 1000,
            issuedAt: entry.issuedAt
        });
    }

    /**
     * Middleware Express. Lê confirmationToken + reason do body, valida e marca
     * o token como consumido. Em caso de sucesso, anexa `req.destructive`.
     */
    function requireDestructiveConfirmation(req, res, next) {
        var body = req.body || {};
        var token = body.confirmationToken;
        var reason = body.reason;

        if (!token || typeof token !== 'string') {
            return res.status(400).json({ error: 'confirmationToken (string) é obrigatório no body.' });
        }
        if (!reason || typeof reason !== 'string' || reason.trim().length < REASON_MIN_LENGTH) {
            return res.status(400).json({ error: 'reason (string com >= ' + REASON_MIN_LENGTH + ' caracteres) é obrigatório no body.' });
        }

        var entry = store.get(token);
        if (!entry) {
            return res.status(403).json({ error: 'Token desconhecido. Solicite um novo via POST /api/admin/destructive-token.' });
        }
        if (entry.used) {
            return res.status(403).json({ error: 'Token já consumido (single-use).' });
        }
        var now = Date.now();
        if (entry.expiresAt < now) {
            store.delete(token);
            return res.status(403).json({ error: 'Token expirado. Solicite um novo (TTL ' + (DEFAULT_TTL_MS / 1000) + 's).' });
        }

        // Marca como consumido. Mantém no store para auditoria curta antes da reap.
        entry.used = true;
        entry.consumedAt = new Date(now);

        req.destructive = {
            token: token,
            intent: entry.intent,
            context: entry.context,
            issuedBy: entry.issuedBy,
            issuedAt: entry.issuedAt,
            consumedAt: entry.consumedAt,
            reason: reason.trim()
        };

        next();
    }

    /**
     * Helper para teste: limpa o store. NÃO chamar em produção.
     */
    function _clearStore() {
        store.clear();
    }

    return {
        issueTokenHandler: issueTokenHandler,
        requireDestructiveConfirmation: requireDestructiveConfirmation,
        // expostos para teste/monitoramento
        _store: store,
        _reap: reap,
        _clearStore: _clearStore,
        DEFAULT_TTL_MS: DEFAULT_TTL_MS,
        REASON_MIN_LENGTH: REASON_MIN_LENGTH
    };
};
