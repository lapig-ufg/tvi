/**
 * inspectionHealth — controller de saúde da inspeção (Tier 3.2 — 2026-05-09).
 *
 * Endpoint diagnóstico que permite à equipe LAPIG acompanhar, por
 * campanha, indicadores que sinalizam bug de fluxo, perda de
 * inspeção ou uso de funções destrutivas. Alimenta um dashboard
 * (Grafana ou planilha) e serve como ponto único de verdade para
 * a sentinela operacional descrita em clever-dreaming-pudding.md §3.2.
 *
 * Não muta nada. Aceita query opcional `campaignId` para escopo.
 */

'use strict';

module.exports = function (app) {

    var Health = {};

    function getColl(name) {
        return app.repository && app.repository.collections && app.repository.collections[name];
    }

    function getLogger() {
        return app.services && app.services.logger;
    }

    /**
     * GET /api/admin/inspection-health[?campaignId=X]
     */
    Health.report = async function (request, response) {
        try {
            var campaignId = request.query && request.query.campaignId ? String(request.query.campaignId) : null;
            var pointsCol = getColl('points');
            var blocosCol = getColl('tvi_blocos');
            var auditCol = getColl('points_audit');
            var releaseLogCol = getColl('tvi_blocos_release_log');

            var generatedAt = new Date();
            var since24h = new Date(generatedAt.getTime() - 24 * 60 * 60 * 1000);

            var report = {
                generatedAt: generatedAt,
                campaignId: campaignId,
                metrics: {
                    points: { total: 0, byUserNameLength: {}, archived: 0 },
                    blocks: { total: 0, byRoundStatus: {}, availableRound2WithPartialPoints: 0 },
                    audit: { last24h: { total: 0, byOperation: {} } },
                    releaseLog: { last24h: { total: 0, distinctInspectors: 0 } }
                }
            };

            var pointsMatch = campaignId ? { campaign: campaignId } : {};
            var blocksMatch = campaignId ? { campaignId: campaignId } : {};

            // --- POINTS ---
            if (pointsCol) {
                report.metrics.points.total = await pointsCol.count(pointsMatch);

                var byLen = await pointsCol.aggregate([
                    { $match: pointsMatch },
                    { $project: { len: { $size: { $ifNull: ['$userName', []] } } } },
                    { $group: { _id: '$len', n: { $sum: 1 } } },
                    { $sort: { _id: 1 } }
                ]).toArray();
                byLen.forEach(function (r) {
                    report.metrics.points.byUserNameLength[String(r._id)] = r.n;
                });

                var archivedMatch = Object.assign({ archivedAt: { $ne: null } }, pointsMatch);
                report.metrics.points.archived = await pointsCol.count(archivedMatch);
            }

            // --- BLOCOS ---
            if (blocosCol) {
                report.metrics.blocks.total = await blocosCol.count(blocksMatch);

                var byRoundStatus = await blocosCol.aggregate([
                    { $match: blocksMatch },
                    { $group: { _id: { round: '$inspectionRound', status: '$status' }, n: { $sum: 1 } } },
                    { $sort: { '_id.round': 1, '_id.status': 1 } }
                ]).toArray();
                byRoundStatus.forEach(function (r) {
                    var key = String(r._id.round) + '.' + r._id.status;
                    report.metrics.blocks.byRoundStatus[key] = r.n;
                });

                // Blocos round-2 'available' cujos pontos já têm >= 1 inspetor humano
                // (userName.length >= 2 = auto + ao menos 1 humano). Indica blocos
                // aguardando 2º inspetor que aparecem como "Disponível" no temporal.
                if (pointsCol) {
                    var availPartial = await blocosCol.aggregate([
                        { $match: Object.assign({ inspectionRound: 2, status: 'available' }, blocksMatch) },
                        { $lookup: { from: 'points', localField: 'pointIds', foreignField: '_id', as: 'pts' } },
                        { $project: {
                            anyPartial: {
                                $anyElementTrue: {
                                    $map: {
                                        input: '$pts', as: 'p',
                                        in: { $gte: [{ $size: { $ifNull: ['$$p.userName', []] } }, 2] }
                                    }
                                }
                            }
                        }},
                        { $match: { anyPartial: true } },
                        { $count: 'n' }
                    ]).toArray();
                    report.metrics.blocks.availableRound2WithPartialPoints = (availPartial[0] && availPartial[0].n) || 0;
                }
            }

            // --- AUDIT (últimas 24h) ---
            if (auditCol) {
                var auditMatch = { ts: { $gte: since24h } };
                if (campaignId) auditMatch.campaignId = campaignId;
                report.metrics.audit.last24h.total = await auditCol.count(auditMatch);

                var byOp = await auditCol.aggregate([
                    { $match: auditMatch },
                    { $group: { _id: '$operation', n: { $sum: 1 } } },
                    { $sort: { n: -1 } }
                ]).toArray();
                byOp.forEach(function (r) {
                    report.metrics.audit.last24h.byOperation[r._id || 'unknown'] = r.n;
                });
            }

            // --- RELEASE LOG (últimas 24h) ---
            if (releaseLogCol) {
                var rlMatch = { expiredAt: { $gte: since24h } };
                if (campaignId) rlMatch.campaignId = campaignId;
                report.metrics.releaseLog.last24h.total = await releaseLogCol.count(rlMatch);

                var distinctInspectors = await releaseLogCol.distinct('previousAssignedTo', rlMatch);
                report.metrics.releaseLog.last24h.distinctInspectors = (distinctInspectors || []).filter(function (v) { return !!v; }).length;
            }

            return response.json(report);
        } catch (err) {
            var logger = getLogger();
            if (logger) {
                await logger.error('Erro em inspection-health', {
                    module: 'inspectionHealth', function: 'report',
                    metadata: { error: err.message, stack: err.stack }
                });
            }
            return response.status(500).json({ error: err.message });
        }
    };

    return Health;
};
