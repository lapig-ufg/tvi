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
 *      → recebe { token, expiresIn: 60 }. O token é persistido na coleção
 *      Mongo `destructive_tokens`.
 *   2. Admin chama a rota destrutiva incluindo no body { confirmationToken, reason }.
 *   3. O middleware `requireDestructiveConfirmation` claima o token via
 *      findAndModify atômico ({ used: false, expiresAt: > now } → { used: true }).
 *      Em caso de sucesso, anexa `req.destructive = { token, intent, context,
 *      consumedAt, ... }` para o handler.
 *
 * Persistência (2026-05-23): store migrado de Map em memória para a coleção
 * `destructive_tokens` com TTL index sobre `expiresAt` (cria/purga em ~60s
 * após expiração). Motivação: o Map em memória não funciona em deploy
 * multi-instância — cluster Node (app-tvi-cluster.js, 2-10 workers) e
 * multi-pod (Kubernetes) podem rotear o emit e o apply para processos
 * distintos, resultando em "Token desconhecido" mesmo no fluxo normal.
 * MongoDB já é o substrato compartilhado usado pelo socket.io-adapter-mongo
 * (app.js:19,67), então não introduz nova dependência.
 *
 * Reuso: o middleware NÃO substitui requireSuperAdmin. Sempre encadear:
 *   app.post(rota, requireSuperAdmin, requireDestructiveConfirmation, handler)
 */

'use strict';

var crypto = require('crypto');

var DEFAULT_TTL_MS = 60 * 1000; // 60 segundos
var REASON_MIN_LENGTH = 10;
var COLLECTION_NAME = 'destructive_tokens';

module.exports = function (app) {

    function getLogger() {
        return app.services && app.services.logger;
    }

    // Acesso lazy à coleção — necessário porque express-load instancia este
    // middleware ANTES de Repository.init() rodar (ver auth/cacheApiAuth.js:7
    // para o precedente canônico do padrão).
    function getCollection() {
        var repo = app.repository;
        if (!repo) return null;
        if (repo.collections && repo.collections[COLLECTION_NAME]) {
            return repo.collections[COLLECTION_NAME];
        }
        if (repo.db && typeof repo.db.collection === 'function') {
            return repo.db.collection(COLLECTION_NAME);
        }
        return null;
    }

    function generateToken() {
        // 16 bytes hex = 32 chars; suficiente entropia para 60s TTL single-use.
        return crypto.randomBytes(16).toString('hex');
    }

    /**
     * Endpoint Express: emissão de token. Deve ser registrado APÓS
     * `requireSuperAdmin` na cadeia da rota.
     *
     * Body esperado:
     *   { intent: 'softWipePoint' | 'discardBlock' | 'removeInspectorByIndex' | 'correctCampaign' | 'removeExcessInspections' | string,
     *     context: { campaignId?, pointId?, blockIndex?, ... } }
     */
    function issueTokenHandler(req, res) {
        var body = req.body || {};
        var intent = body.intent;
        if (!intent || typeof intent !== 'string') {
            return res.status(400).json({ error: 'Campo intent (string) é obrigatório.' });
        }

        var coll = getCollection();
        if (!coll) {
            var logger = getLogger();
            if (logger) {
                Promise.resolve().then(function () {
                    return logger.error('Token store indisponível na emissão', {
                        module: 'destructiveConfirmation',
                        function: 'issueTokenHandler',
                        metadata: { intent: intent }
                    });
                }).catch(function () { /* swallow */ });
            }
            return res.status(503).json({ error: 'Token store indisponível. Tente novamente em instantes.' });
        }

        var token = generateToken();
        var now = new Date();
        var doc = {
            _id: token,
            intent: intent,
            context: body.context || {},
            expiresAt: new Date(now.getTime() + DEFAULT_TTL_MS),
            used: false,
            usedAt: null,
            issuedBy: (req.session && req.session.admin && req.session.admin.username) || (req.session && req.session.user && req.session.user.name) || null,
            issuedAt: now
        };

        coll.insertOne(doc, function (err) {
            var logger = getLogger();
            if (err) {
                if (logger) {
                    Promise.resolve().then(function () {
                        return logger.error('Falha ao persistir token destrutivo', {
                            module: 'destructiveConfirmation',
                            function: 'issueTokenHandler',
                            metadata: { intent: intent, err: err && err.message }
                        });
                    }).catch(function () { /* swallow */ });
                }
                return res.status(503).json({ error: 'Não foi possível emitir token agora. Tente novamente.' });
            }

            if (logger) {
                Promise.resolve().then(function () {
                    return logger.info('Token destrutivo emitido', {
                        module: 'destructiveConfirmation',
                        function: 'issueTokenHandler',
                        metadata: { intent: intent, issuedBy: doc.issuedBy, ip: req.ip, ttlMs: DEFAULT_TTL_MS }
                    });
                }).catch(function () { /* swallow */ });
            }

            res.json({
                token: token,
                expiresIn: DEFAULT_TTL_MS / 1000,
                issuedAt: doc.issuedAt
            });
        });
    }

    /**
     * Middleware Express. Lê confirmationToken + reason do body, valida e marca
     * o token como consumido via findAndModify atômico. Em caso de sucesso,
     * anexa `req.destructive`.
     *
     * O claim é uma operação atômica única; isso é o que garante a semântica
     * single-use sob concorrência entre workers/pods.
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

        var coll = getCollection();
        if (!coll) {
            return res.status(503).json({ error: 'Token store indisponível. Tente novamente em instantes.' });
        }

        var now = new Date();
        var trimmedReason = reason.trim();

        // findAndModify atômico — claim do token. Filtro garante:
        //   - token existe (_id matched)
        //   - ainda não consumido (used: false)
        //   - dentro da janela de validade (expiresAt > now)
        // Apenas o ganhador da corrida vê result.value !== null; demais veem null.
        coll.findAndModify(
            { _id: token, used: false, expiresAt: { $gt: now } },
            [],
            { $set: { used: true, usedAt: now } },
            { new: true },
            function (err, result) {
                var logger = getLogger();
                if (err) {
                    if (logger) {
                        Promise.resolve().then(function () {
                            return logger.error('Erro ao validar token destrutivo', {
                                module: 'destructiveConfirmation',
                                function: 'requireDestructiveConfirmation',
                                metadata: { err: err && err.message, ip: req.ip }
                            });
                        }).catch(function () { /* swallow */ });
                    }
                    return res.status(500).json({ error: 'Erro ao validar token. Tente novamente.' });
                }

                var entry = result && result.value;
                if (entry) {
                    req.destructive = {
                        token: token,
                        intent: entry.intent,
                        context: entry.context || {},
                        issuedBy: entry.issuedBy,
                        issuedAt: entry.issuedAt,
                        consumedAt: entry.usedAt,
                        reason: trimmedReason
                    };
                    return next();
                }

                // Claim falhou — fazer follow-up para discriminar a mensagem.
                // O custo extra (1 findOne) só ocorre no caminho de erro.
                coll.findOne({ _id: token }, function (err2, existing) {
                    var failureReason;
                    var msg;
                    if (err2) {
                        // findOne falhou; trate como genérico mas log.
                        if (logger) {
                            Promise.resolve().then(function () {
                                return logger.error('Erro no follow-up findOne de token destrutivo', {
                                    module: 'destructiveConfirmation',
                                    function: 'requireDestructiveConfirmation',
                                    metadata: { err: err2 && err2.message }
                                });
                            }).catch(function () { /* swallow */ });
                        }
                        return res.status(403).json({ error: 'Token desconhecido. Solicite um novo via POST /api/admin/destructive-token.' });
                    }
                    if (!existing) {
                        failureReason = 'not_found';
                        msg = 'Token desconhecido. Solicite um novo via POST /api/admin/destructive-token.';
                    } else if (existing.used) {
                        failureReason = 'already_used';
                        msg = 'Token já consumido (single-use).';
                    } else {
                        // Restante: expirado (a única outra causa do filtro falhar).
                        failureReason = 'expired';
                        msg = 'Token expirado. Solicite um novo (TTL ' + (DEFAULT_TTL_MS / 1000) + 's).';
                    }

                    if (logger) {
                        Promise.resolve().then(function () {
                            return logger.warn('Validação de token destrutivo falhou', {
                                module: 'destructiveConfirmation',
                                function: 'requireDestructiveConfirmation',
                                metadata: {
                                    reason: failureReason,
                                    intent: existing && existing.intent,
                                    issuedBy: existing && existing.issuedBy,
                                    ip: req.ip
                                }
                            });
                        }).catch(function () { /* swallow */ });
                    }

                    return res.status(403).json({ error: msg });
                });
            }
        );
    }

    /**
     * Helper para teste: remove todos os tokens do store. NÃO chamar em produção.
     */
    function _clearStore(callback) {
        var coll = getCollection();
        if (!coll) {
            if (typeof callback === 'function') callback();
            return;
        }
        coll.deleteMany({}, function () {
            if (typeof callback === 'function') callback();
        });
    }

    return {
        issueTokenHandler: issueTokenHandler,
        requireDestructiveConfirmation: requireDestructiveConfirmation,
        // expostos para teste/monitoramento
        _clearStore: _clearStore,
        _collectionName: COLLECTION_NAME,
        DEFAULT_TTL_MS: DEFAULT_TTL_MS,
        REASON_MIN_LENGTH: REASON_MIN_LENGTH
    };
};
