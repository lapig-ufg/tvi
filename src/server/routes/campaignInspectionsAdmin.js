/**
 * Rotas de remoção de inspeções do gerenciador de campanhas (2026-08-18).
 *
 * A aba "Remover Inspeções" e os botões de remoção da tabela de pontos
 * (views/campaign-points-modal.tpl.html) chamavam três endpoints que nunca
 * existiram no servidor:
 *
 *   POST   /api/campaigns/:id/remove-inspections
 *   POST   /api/campaigns/:id/bulk-remove-inspections
 *   DELETE /api/campaigns/:id/points/:pointId/inspections
 *
 * Este arquivo os implementa sobre o `pointsService`, de modo que toda remoção
 * fique registrada em `points_audit` com snapshot antes/depois e possa ser
 * revertida por POST /api/admin/points/:pointId/restore.
 *
 * Decisões:
 *   - Usa `clearInspections`, não `softWipePoint`: a intenção é liberar o ponto
 *     para nova inspeção, não arquivá-lo (pontos arquivados são ignorados pelo
 *     job de sincronização Wayback).
 *   - `by_user` usa `removeInspectorByIndex`, preservando as demais inspeções.
 *   - `reason` é obrigatório (mínimo de 10 caracteres, exigência do
 *     pointsService) e fica gravado na auditoria.
 *   - Todo ponto é verificado contra a campanha da URL antes de ser alterado,
 *     impedindo que um identificador de outra campanha seja passado no corpo
 *     da requisição.
 */

'use strict';

const removalPlan = require('../util/inspectionRemovalPlan');

module.exports = function (app) {

    // Mesmo padrão de routes/campaignCrud.js, routes/pointsAdmin.js.
    const requireSuperAdmin = function (req, res, next) {
        if (req.session && req.session.admin && req.session.admin.superAdmin) {
            return next();
        }
        return res.status(401).json({ error: 'Super admin authentication required' });
    };

    const pointsService = app.services && app.services.pointsService;
    const logger = app.services && app.services.logger;

    if (!pointsService) {
        console.error('[campaignInspectionsAdmin routes] pointsService indisponível; rotas NÃO registradas.');
        return;
    }

    const pointsCollection = app.repository.collections.points;
    const campaignCollection = app.repository.collections.campaign;

    function buildCtx(req, reason) {
        const admin = req.session && req.session.admin;
        const username = (admin && admin.superAdmin && admin.superAdmin.username) || 'admin-unknown';
        return {
            actor: {
                username: username,
                role: 'superAdmin',
                sessionId: req.sessionID || null,
                ip: req.ip || null
            },
            reason: reason
        };
    }

    // O pointsService exige motivo com ao menos 10 caracteres. Validamos aqui
    // para devolver 400 (erro do cliente) em vez de 500 (erro do servidor).
    function validarReason(reason) {
        if (typeof reason !== 'string' || reason.trim().length < 10) {
            const e = new Error('O motivo da remoção é obrigatório e deve ter ao menos 10 caracteres.');
            e.status = 400;
            throw e;
        }
        return reason.trim();
    }

    async function carregarCampanha(campaignId) {
        const campaign = await campaignCollection.findOne({ _id: campaignId });
        if (!campaign) {
            const e = new Error('Campanha não encontrada: ' + campaignId);
            e.status = 404;
            throw e;
        }
        return campaign;
    }

    // Executa o plano ponto a ponto. Sequencial de propósito: cada ação grava
    // auditoria e o volume é limitado por LIMITE_PONTOS_POR_EXECUCAO; paralelizar
    // traria contenção no Mongo sem ganho relevante para o caso de uso (uso
    // administrativo, esporádico).
    async function executarPlano(plan, ctx) {
        let removedCount = 0;
        let pointsChanged = 0;
        const errors = [];

        for (const action of plan.actions) {
            try {
                if (action.operation === 'remove_inspector') {
                    await pointsService.removeInspectorByIndex(action.pointId, action.inspector, ctx);
                    removedCount += 1;
                } else {
                    await pointsService.clearInspections(action.pointId, ctx);
                    removedCount += action.inspectors.length;
                }
                pointsChanged += 1;
            } catch (err) {
                errors.push({ pointId: action.pointId, error: err.message });
            }
        }

        return { removedCount: removedCount, pointsChanged: pointsChanged, errors: errors };
    }

    function responderErro(res, err, contexto) {
        const status = err.status || 500;
        if (status >= 500 && logger) {
            logger.error('Erro em ' + contexto, {
                module: 'campaignInspectionsAdmin',
                function: contexto,
                metadata: { error: err.message, stack: err.stack }
            });
        }
        return res.status(status).json({ error: err.message });
    }

    /**
     * POST /api/campaigns/:id/remove-inspections
     * Body: { criteria: { type, user?, pointId? }, reason, dryRun }
     *
     * Com `dryRun: true` devolve a pré-visualização sem alterar nada. É o mesmo
     * caminho de código da execução, garantindo que o que foi previsto seja
     * exatamente o que será removido.
     */
    app.post('/api/campaigns/:id/remove-inspections', requireSuperAdmin, async function (req, res) {
        try {
            const campaignId = req.params.id;
            const dryRun = req.body && req.body.dryRun === true;
            const criteria = removalPlan.normalizeCriteria(req.body && req.body.criteria);
            const campaign = await carregarCampanha(campaignId);

            // `incomplete_only` compara a quantidade de inspeções com numInspec
            // dentro do banco; sem esse valor o $expr produziria erro no Mongo.
            if (criteria.type === 'incomplete_only' && typeof campaign.numInspec !== 'number') {
                return res.status(400).json({
                    error: 'A campanha não define numInspec; o critério "Pontos Incompletos" não pode ser aplicado.'
                });
            }

            const filtro = removalPlan.buildCandidateFilter(campaignId, criteria, campaign.numInspec);
            const candidatos = await pointsCollection
                .find(filtro, { fields: { _id: 1, userName: 1, userNameCount: 1 } })
                .toArray();

            const plan = removalPlan.buildRemovalPlan(candidatos, criteria, campaign.numInspec);

            if (dryRun) {
                return res.json({
                    success: true,
                    dryRun: true,
                    pointsAffected: plan.pointsAffected,
                    inspectionsAffected: plan.inspectionsAffected,
                    preview: removalPlan.buildPreviewRows(plan)
                });
            }

            const reason = validarReason(req.body && req.body.reason);

            if (plan.pointsAffected > removalPlan.LIMITE_PONTOS_POR_EXECUCAO) {
                return res.status(413).json({
                    error: 'O critério selecionado atinge ' + plan.pointsAffected + ' pontos, acima do limite de '
                        + removalPlan.LIMITE_PONTOS_POR_EXECUCAO + ' por execução. Restrinja o critério.'
                });
            }

            const resultado = await executarPlano(plan, buildCtx(req, reason));
            return res.json({
                success: true,
                removedCount: resultado.removedCount,
                pointsAffected: resultado.pointsChanged,
                errors: resultado.errors
            });
        } catch (err) {
            return responderErro(res, err, 'removeInspectionsByCriteria');
        }
    });

    /**
     * POST /api/campaigns/:id/bulk-remove-inspections
     * Body: { pointIds: [...], reason }
     */
    app.post('/api/campaigns/:id/bulk-remove-inspections', requireSuperAdmin, async function (req, res) {
        try {
            const campaignId = req.params.id;
            const pointIds = (req.body && req.body.pointIds) || [];
            if (!Array.isArray(pointIds) || pointIds.length === 0) {
                return res.status(400).json({ error: 'Informe ao menos um ponto em pointIds.' });
            }
            if (pointIds.length > removalPlan.LIMITE_PONTOS_POR_EXECUCAO) {
                return res.status(413).json({
                    error: 'Seleção de ' + pointIds.length + ' pontos acima do limite de '
                        + removalPlan.LIMITE_PONTOS_POR_EXECUCAO + ' por execução.'
                });
            }
            const reason = validarReason(req.body && req.body.reason);
            await carregarCampanha(campaignId);

            // Só são alterados os pontos que de fato pertencem à campanha da URL.
            const candidatos = await pointsCollection
                .find({ campaign: campaignId, _id: { $in: pointIds } }, { fields: { _id: 1, userName: 1 } })
                .toArray();

            const encontrados = candidatos.map(function (p) { return p._id; });
            const foraDaCampanha = pointIds.filter(function (id) { return encontrados.indexOf(id) === -1; });

            const plan = removalPlan.buildRemovalPlan(candidatos, { type: 'by_point' }, 0);
            const resultado = await executarPlano(plan, buildCtx(req, reason));

            const errors = resultado.errors.concat(foraDaCampanha.map(function (id) {
                return { pointId: id, error: 'Ponto não encontrado nesta campanha.' };
            }));

            return res.json({
                success: true,
                removedCount: resultado.removedCount,
                pointsAffected: resultado.pointsChanged,
                errors: errors
            });
        } catch (err) {
            return responderErro(res, err, 'bulkRemoveInspections');
        }
    });

    /**
     * DELETE /api/campaigns/:id/points/:pointId/inspections
     * Body: { reason }
     */
    app.delete('/api/campaigns/:id/points/:pointId/inspections', requireSuperAdmin, async function (req, res) {
        try {
            const campaignId = req.params.id;
            const pointId = req.params.pointId;
            // Aceita o motivo no corpo ou na query string: nem todo cliente HTTP
            // envia corpo em requisições DELETE de forma confiável.
            const reason = validarReason((req.body && req.body.reason) || (req.query && req.query.reason));

            const point = await pointsCollection.findOne({ _id: pointId }, { fields: { campaign: 1, userName: 1 } });
            if (!point) {
                return res.status(404).json({ error: 'Ponto não encontrado: ' + pointId });
            }
            if (String(point.campaign) !== String(campaignId)) {
                return res.status(403).json({ error: 'O ponto ' + pointId + ' não pertence à campanha ' + campaignId + '.' });
            }

            const removidas = Array.isArray(point.userName) ? point.userName.length : 0;
            await pointsService.clearInspections(pointId, buildCtx(req, reason));

            return res.json({ success: true, pointId: pointId, removedCount: removidas });
        } catch (err) {
            return responderErro(res, err, 'removePointInspections');
        }
    });
};
