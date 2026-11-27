'use strict';

module.exports = function (app) {
    return async function (campaignId, req) {
        const data = await app.services.tilesApiService.offlineCampaign(campaignId, 'get', { limit: 1 }, req);
        let counts = data.point_counts;
        if (data.status === 'not_started') {
            counts = { complete: 0, partial: 0, no_data: 0,
                pending: await app.repository.collections.points.count({ campaign: campaignId }) };
        }
        if (!counts || !['complete', 'partial', 'pending', 'no_data'].every(key =>
            Number.isSafeInteger(counts[key]) && counts[key] >= 0)) {
            throw new Error('Resumo do cache por ponto indisponível.');
        }
        return { pointsCached: counts.complete, pointsPartial: counts.partial,
            pointsNoCached: counts.pending, pointsNoData: counts.no_data,
            updatedAt: data.summary_as_of || null, configurationChanged: data.configuration_changed === true };
    };
};
