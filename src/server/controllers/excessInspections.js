/**
 * Controller — gerenciamento de inspeções excedentes (Tier 2.10, 2026-05-14).
 *
 * Casos de origem: race conditions pré-Tier 2.5 e bugs históricos do
 * findPointFromBlock acumularam pontos com userName.length > numInspec.
 * Esta feature dá ao admin uma ferramenta para diagnosticar e remediar
 * esses casos com dry-run, regras configuráveis, audit individual e
 * confirmação destrutiva (token + reason).
 *
 * Substitui o uso histórico de Points.correctCampaignAdmin (em dry-run
 * desde 2026-05-09 — Tier 0 — porque aplicava slice() cego sobre os arrays).
 */

'use strict';

var crypto = require('crypto');

module.exports = function (app) {

    var Excess = {};

    var points = app.repository && app.repository.collections && app.repository.collections.points;
    var campaigns = app.repository && app.repository.collections && app.repository.collections.campaign;
    var pointsAudit = app.repository && app.repository.collections && app.repository.collections.points_audit;
    var pointsService = app.services && app.services.pointsService;
    var logger = app.services && app.services.logger;

    // ----------------------------------------------------------------------
    // Store de previews — coleção MongoDB `excess_inspection_previews`
    // ----------------------------------------------------------------------
    // Persiste o resultado do dry-run para que o apply use exatamente a mesma
    // lista de ações calculada no preview. Single-use, TTL de 5 min.
    //
    // Persistência (2026-05-24): migrado de Map em memória para Mongo pelo
    // mesmo motivo do destructive_tokens (middleware/destructiveConfirmation.js
    // §"Persistência (2026-05-23)"): o Map em memória não funciona em deploy
    // multi-instância — cluster Node (app-tvi-cluster.js, 2-10 workers) e
    // múltiplas réplicas Swarm/k8s podem rotear o /preview e o /apply para
    // processos distintos, resultando em "Preview expirado ou desconhecido"
    // no fluxo normal. O TTL index sobre `expiresAt` substitui o setInterval
    // reaper (ver repository.js, bloco excess_inspection_previews).

    var PREVIEW_TTL_MS = 5 * 60 * 1000;
    var DEFAULT_MAX_POINTS = 500;
    var HARD_CAP_MAX_POINTS = 2000;
    var COLLECTION_NAME = 'excess_inspection_previews';

    // Acesso lazy à coleção — necessário porque controllers são instanciados
    // antes de Repository.init() rodar (mesmo padrão usado em
    // middleware/destructiveConfirmation.js).
    function getPreviewCollection() {
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

    function generatePreviewId() {
        return crypto.randomBytes(16).toString('hex');
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

    function badRequest(res, msg) {
        return res.status(400).json({ error: msg });
    }

    // ----------------------------------------------------------------------
    // 1. listExcessInspections
    // ----------------------------------------------------------------------
    /**
     * GET /api/admin/campaigns/:id/excess-inspections
     * Query: page, limit, biome, uf, inspector, minExcess
     */
    Excess.listExcessInspections = async function (req, res) {
        try {
            var campaignId = req.params.id;
            var page = Math.max(1, parseInt(req.query.page, 10) || 1);
            var limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
            var minExcess = Math.max(1, parseInt(req.query.minExcess, 10) || 1);

            var campaign = await campaigns.findOne({ _id: campaignId });
            if (!campaign) return res.status(404).json({ error: 'Campanha não encontrada.' });
            var numInspec = campaign.numInspec || 1;

            // Threshold: userName.length >= numInspec + minExcess
            var threshold = numInspec + minExcess;
            var match = {
                campaign: campaignId,
                $expr: { $gte: [{ $size: { $ifNull: ['$userName', []] } }, threshold] }
            };
            if (req.query.biome) match.biome = req.query.biome;
            if (req.query.uf) match.uf = req.query.uf;
            if (req.query.inspector) match.userName = req.query.inspector;

            var total = await points.count(match);

            var items = await points.find(match, {
                fields: {
                    _id: 1, index: 1, biome: 1, uf: 1, municipio: 1,
                    lon: 1, lat: 1, userName: 1, inspection: 1,
                    underInspection: 1, classConsolidated: 1
                },
                sort: { index: 1 },
                skip: (page - 1) * limit,
                limit: limit
            }).toArray();

            // Sanitize: enviar apenas os campos relevantes de inspection (sem form completo)
            var slim = items.map(function (p) {
                var insps = Array.isArray(p.inspection) ? p.inspection : [];
                return {
                    _id: p._id,
                    index: p.index,
                    biome: p.biome,
                    uf: p.uf,
                    municipio: p.municipio,
                    lon: p.lon,
                    lat: p.lat,
                    userName: p.userName || [],
                    inspection: insps.map(function (ins, i) {
                        return {
                            inspectorName: (p.userName || [])[i],
                            fillDate: ins && ins.fillDate,
                            counter: ins && ins.counter
                        };
                    }),
                    underInspection: p.underInspection || 0,
                    excess: (p.userName || []).length - numInspec
                };
            });

            res.json({
                campaignId: campaignId,
                numInspec: numInspec,
                page: page,
                limit: limit,
                total: total,
                items: slim
            });
        } catch (err) {
            if (logger) {
                await logger.error('Erro em listExcessInspections', {
                    module: 'excessInspections', function: 'listExcessInspections',
                    metadata: { error: err.message, stack: err.stack }
                });
            }
            res.status(500).json({ error: err.message });
        }
    };

    // ----------------------------------------------------------------------
    // 2. previewRemoval (dry-run)
    // ----------------------------------------------------------------------
    /**
     * POST /api/admin/campaigns/:id/excess-inspections/preview
     * Body: { rule, keepInspectors?, filters?, maxPoints? }
     */
    Excess.previewRemoval = async function (req, res) {
        try {
            var campaignId = req.params.id;
            var body = req.body || {};
            var rule = body.rule;
            var keepInspectors = Array.isArray(body.keepInspectors) ? body.keepInspectors : [];
            var filters = body.filters || {};
            var maxPoints = parseInt(body.maxPoints, 10);
            if (!maxPoints || maxPoints < 1) maxPoints = DEFAULT_MAX_POINTS;
            if (maxPoints > HARD_CAP_MAX_POINTS) maxPoints = HARD_CAP_MAX_POINTS;

            if (['keepOldest', 'keepNewest', 'keepInspectors'].indexOf(rule) === -1) {
                return badRequest(res, "Campo rule deve ser 'keepOldest', 'keepNewest' ou 'keepInspectors'.");
            }
            if (rule === 'keepInspectors' && keepInspectors.length === 0) {
                return badRequest(res, "Para rule='keepInspectors', keepInspectors[] deve ter ao menos 1 username.");
            }

            var campaign = await campaigns.findOne({ _id: campaignId });
            if (!campaign) return res.status(404).json({ error: 'Campanha não encontrada.' });
            var numInspec = campaign.numInspec || 1;

            var match = {
                campaign: campaignId,
                $expr: { $gt: [{ $size: { $ifNull: ['$userName', []] } }, numInspec] }
            };
            if (filters.biome) match.biome = filters.biome;
            if (filters.uf) match.uf = filters.uf;
            if (filters.inspector) match.userName = filters.inspector;

            var docs = await points.find(match, {
                fields: { _id: 1, index: 1, userName: 1, inspection: 1, underInspection: 1 },
                sort: { index: 1 },
                limit: maxPoints
            }).toArray();

            var actions = [];
            var skipped = [];

            docs.forEach(function (p) {
                var names = Array.isArray(p.userName) ? p.userName.slice() : [];
                var insps = Array.isArray(p.inspection) ? p.inspection.slice() : [];
                if (names.length <= numInspec) return; // já consistente (concorrência)

                if ((p.underInspection || 0) > 0) {
                    skipped.push({ pointId: p._id, index: p.index, reason: 'in_progress' });
                    return;
                }

                // Constrói lista [{idx, inspectorName, fillDate}]
                var entries = names.map(function (n, i) {
                    return {
                        idx: i,
                        inspectorName: n,
                        fillDate: insps[i] && insps[i].fillDate ? new Date(insps[i].fillDate) : null
                    };
                });

                var toKeep;
                if (rule === 'keepInspectors') {
                    // Mantém apenas os listados; tiebreaker keepOldest se ainda exceder
                    var kept = entries.filter(function (e) { return keepInspectors.indexOf(e.inspectorName) !== -1; });
                    if (kept.length > numInspec) {
                        kept = kept.slice().sort(function (a, b) {
                            return (a.fillDate ? a.fillDate.getTime() : 0) - (b.fillDate ? b.fillDate.getTime() : 0);
                        }).slice(0, numInspec);
                    }
                    toKeep = kept;
                } else {
                    var sorted = entries.slice().sort(function (a, b) {
                        var av = a.fillDate ? a.fillDate.getTime() : 0;
                        var bv = b.fillDate ? b.fillDate.getTime() : 0;
                        return rule === 'keepOldest' ? (av - bv) : (bv - av);
                    });
                    toKeep = sorted.slice(0, numInspec);
                }

                // Inspetores que NÃO estão em toKeep serão removidos
                var keepIdxSet = {};
                toKeep.forEach(function (e) { keepIdxSet[e.idx] = true; });
                var toRemove = entries.filter(function (e) { return !keepIdxSet[e.idx]; });

                // Validação: precisa sobrar exatamente numInspec
                if (toKeep.length < numInspec) {
                    skipped.push({
                        pointId: p._id, index: p.index,
                        reason: 'rule_would_underfill',
                        detail: 'Após aplicar a regra, ficariam apenas ' + toKeep.length + ' inspetores (numInspec=' + numInspec + ').'
                    });
                    return;
                }

                actions.push({
                    pointId: p._id,
                    index: p.index,
                    currentInspectors: names,
                    toRemove: toRemove.map(function (e) {
                        return {
                            inspectorName: e.inspectorName,
                            fillDate: e.fillDate,
                            index: e.idx
                        };
                    }),
                    toKeep: toKeep.map(function (e) {
                        return { inspectorName: e.inspectorName, fillDate: e.fillDate, index: e.idx };
                    })
                });
            });

            var coll = getPreviewCollection();
            if (!coll) {
                if (logger) {
                    await logger.error('Store de previews indisponível em previewRemoval', {
                        module: 'excessInspections', function: 'previewRemoval',
                        metadata: { campaignId: campaignId }
                    });
                }
                return res.status(503).json({ error: 'Store de previews indisponível. Tente novamente em instantes.' });
            }

            var previewId = generatePreviewId();
            var now = new Date();
            var previewDoc = {
                _id: previewId,
                campaignId: campaignId,
                actions: actions,
                rule: rule,
                createdAt: now,
                expiresAt: new Date(now.getTime() + PREVIEW_TTL_MS),
                used: false,
                usedAt: null,
                createdBy: buildActor(req).username
            };

            await new Promise(function (resolve, reject) {
                coll.insertOne(previewDoc, function (err) {
                    if (err) return reject(err);
                    resolve();
                });
            });

            res.json({
                campaignId: campaignId,
                numInspec: numInspec,
                rule: rule,
                previewId: previewId,
                expiresIn: PREVIEW_TTL_MS / 1000,
                totalAffected: actions.length,
                totalRemovals: actions.reduce(function (s, a) { return s + a.toRemove.length; }, 0),
                skipped: skipped,
                actions: actions
            });
        } catch (err) {
            if (logger) {
                await logger.error('Erro em previewRemoval', {
                    module: 'excessInspections', function: 'previewRemoval',
                    metadata: { error: err.message, stack: err.stack }
                });
            }
            res.status(500).json({ error: err.message });
        }
    };

    // ----------------------------------------------------------------------
    // 3. applyRemoval (executa o que foi calculado no preview)
    // ----------------------------------------------------------------------
    /**
     * POST /api/admin/campaigns/:id/excess-inspections/apply
     * Pré: requireSuperAdmin + requireDestructiveConfirmation
     * Body: { previewId, expectedCount, confirmationToken, reason }
     */
    Excess.applyRemoval = async function (req, res) {
        try {
            if (!pointsService || typeof pointsService.removeInspectorByIndex !== 'function') {
                return res.status(500).json({ error: 'pointsService.removeInspectorByIndex indisponível.' });
            }

            var campaignId = req.params.id;
            var body = req.body || {};
            var previewId = body.previewId;
            var expectedCount = parseInt(body.expectedCount, 10);

            if (!previewId || typeof previewId !== 'string') {
                return badRequest(res, 'previewId é obrigatório.');
            }
            if (isNaN(expectedCount)) {
                return badRequest(res, 'expectedCount é obrigatório (numérico).');
            }

            var coll = getPreviewCollection();
            if (!coll) {
                return res.status(503).json({ error: 'Store de previews indisponível. Tente novamente em instantes.' });
            }

            // Claim atômico — única operação que decide o vencedor sob
            // concorrência entre workers/réplicas. Filtro garante:
            //   - preview existe (_id matched)
            //   - ainda não consumido (used: false)
            //   - dentro da janela de validade (expiresAt > now)
            // O ganhador da corrida recebe o doc; demais recebem null.
            var nowDate = new Date();
            var entry = await new Promise(function (resolve, reject) {
                coll.findAndModify(
                    { _id: previewId, used: false, expiresAt: { $gt: nowDate } },
                    [],
                    { $set: { used: true, usedAt: nowDate } },
                    { new: true },
                    function (err, result) {
                        if (err) return reject(err);
                        resolve(result && result.value);
                    }
                );
            });

            if (!entry) {
                // Claim falhou — fazer follow-up para discriminar a mensagem.
                // O custo extra (1 findOne) só ocorre no caminho de erro.
                var existing = await new Promise(function (resolve, reject) {
                    coll.findOne({ _id: previewId }, function (err, doc) {
                        if (err) return reject(err);
                        resolve(doc);
                    });
                });

                var failureReason;
                var msg;
                if (!existing) {
                    failureReason = 'not_found';
                    msg = 'Preview expirado ou desconhecido. Gere um novo.';
                } else if (existing.used) {
                    failureReason = 'already_used';
                    msg = 'Preview já consumido. Gere um novo.';
                } else {
                    failureReason = 'expired';
                    msg = 'Preview expirado. Gere um novo (TTL ' + (PREVIEW_TTL_MS / 1000) + 's).';
                }

                if (logger) {
                    await logger.warn('Validação de preview de excedentes falhou', {
                        module: 'excessInspections', function: 'applyRemoval',
                        metadata: {
                            reason: failureReason,
                            previewId: previewId,
                            campaignId: campaignId,
                            createdBy: existing && existing.createdBy,
                            actor: buildActor(req).username,
                            ip: req.ip
                        }
                    });
                }

                return res.status(410).json({ error: msg });
            }

            // Claim bem-sucedido — preview agora está consumido. Validações
            // adicionais (campaignId/expectedCount) abaixo: se falharem, o
            // preview já foi gasto (intencional — usuário precisa regerar
            // porque o estado do cliente está inconsistente com o servidor).
            if (entry.campaignId !== campaignId) {
                if (logger) {
                    await logger.warn('previewId não corresponde à campanha', {
                        module: 'excessInspections', function: 'applyRemoval',
                        metadata: {
                            previewId: previewId,
                            expectedCampaignId: campaignId,
                            previewCampaignId: entry.campaignId,
                            actor: buildActor(req).username
                        }
                    });
                }
                return res.status(400).json({ error: 'previewId não corresponde à campanha.' });
            }
            if (entry.actions.length !== expectedCount) {
                if (logger) {
                    await logger.warn('expectedCount divergente do preview', {
                        module: 'excessInspections', function: 'applyRemoval',
                        metadata: {
                            previewId: previewId,
                            previewActions: entry.actions.length,
                            expectedCount: expectedCount,
                            actor: buildActor(req).username
                        }
                    });
                }
                return res.status(409).json({
                    error: 'expectedCount divergente do preview.',
                    previewActions: entry.actions.length,
                    expectedCount: expectedCount
                });
            }

            var ctxBase = {
                actor: buildActor(req),
                reason: req.destructive.reason,
                confirmationToken: req.destructive.token,
                blockId: null
            };

            var applied = 0;
            var idempotent = 0;
            var failed = 0;
            var errors = [];

            for (var i = 0; i < entry.actions.length; i++) {
                var action = entry.actions[i];
                for (var j = 0; j < action.toRemove.length; j++) {
                    var target = action.toRemove[j];
                    try {
                        var before = await points.findOne({ _id: action.pointId }, { fields: { userName: 1 } });
                        var hadInspector = before && Array.isArray(before.userName) && before.userName.indexOf(target.inspectorName) !== -1;
                        await pointsService.removeInspectorByIndex(action.pointId, target.inspectorName, ctxBase);
                        if (hadInspector) {
                            applied++;
                        } else {
                            idempotent++;
                        }
                    } catch (re) {
                        failed++;
                        errors.push({
                            pointId: action.pointId,
                            inspectorName: target.inspectorName,
                            error: re.message
                        });
                    }
                }
            }

            if (logger) {
                await logger.info('Aplicação de remoção de inspeções excedentes', {
                    module: 'excessInspections', function: 'applyRemoval',
                    metadata: {
                        campaignId: campaignId, previewId: previewId,
                        applied: applied, idempotent: idempotent, failed: failed,
                        actor: ctxBase.actor.username
                    }
                });
            }

            res.json({
                success: true,
                campaignId: campaignId,
                applied: applied,
                idempotent: idempotent,
                failed: failed,
                errors: errors
            });
        } catch (err) {
            if (logger) {
                await logger.error('Erro em applyRemoval', {
                    module: 'excessInspections', function: 'applyRemoval',
                    metadata: { error: err.message, stack: err.stack }
                });
            }
            res.status(500).json({ error: err.message });
        }
    };

    // ----------------------------------------------------------------------
    // 4. getRemovalHistory
    // ----------------------------------------------------------------------
    /**
     * GET /api/admin/campaigns/:id/excess-inspections/history
     * Query: page, limit, from, to, actor
     */
    Excess.getRemovalHistory = async function (req, res) {
        try {
            if (!pointsAudit) return res.status(500).json({ error: 'points_audit indisponível.' });

            var campaignId = req.params.id;
            var page = Math.max(1, parseInt(req.query.page, 10) || 1);
            var limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));

            var match = {
                campaignId: campaignId,
                operation: 'remove_by_index'
            };
            if (req.query.from || req.query.to) {
                match.ts = {};
                if (req.query.from) match.ts.$gte = new Date(req.query.from);
                if (req.query.to) match.ts.$lte = new Date(req.query.to);
            }
            if (req.query.actor) {
                match['actor.username'] = req.query.actor;
            }

            var total = await pointsAudit.count(match);
            var rows = await pointsAudit.find(match, {
                fields: {
                    ts: 1, pointId: 1, actor: 1, reason: 1, metadata: 1,
                    'before.userName': 1, 'after.userName': 1
                },
                sort: { ts: -1 },
                skip: (page - 1) * limit,
                limit: limit
            }).toArray();

            res.json({
                campaignId: campaignId,
                page: page,
                limit: limit,
                total: total,
                items: rows
            });
        } catch (err) {
            if (logger) {
                await logger.error('Erro em getRemovalHistory', {
                    module: 'excessInspections', function: 'getRemovalHistory',
                    metadata: { error: err.message, stack: err.stack }
                });
            }
            res.status(500).json({ error: err.message });
        }
    };

    // Expostos para teste/monitoramento (não devem ser usados em produção).
    Excess._clearStore = function (callback) {
        var coll = getPreviewCollection();
        if (!coll) {
            if (typeof callback === 'function') callback();
            return;
        }
        coll.deleteMany({}, function () {
            if (typeof callback === 'function') callback();
        });
    };
    Excess._collectionName = COLLECTION_NAME;
    Excess.PREVIEW_TTL_MS = PREVIEW_TTL_MS;

    return Excess;
};
