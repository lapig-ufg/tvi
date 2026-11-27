'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const create = require('../services/campaignCacheSummary');

function summary(data) {
    return create({ services: { tilesApiService: { offlineCampaign: async () => data } },
        repository: { collections: { points: { count: async () => 30 } } } });
}

test('gráfico utiliza estados persistidos do cache, sem depender do indicador legado', async () => {
    const result = await summary({ status: 'running', summary_as_of: 100,
        point_counts: { complete: 3, partial: 7, pending: 18, no_data: 2 } })('campaign', {});
    assert.deepEqual(result, { pointsCached: 3, pointsPartial: 7, pointsNoCached: 18,
        pointsNoData: 2, updatedAt: 100, configurationChanged: false });
});

test('campanha sem execução não apresenta pontos como concluídos', async () => {
    const result = await summary({ status: 'not_started' })('campaign', {});
    assert.equal(result.pointsNoCached, 30);
    assert.equal(result.pointsCached, 0);
});

test('falha ou contrato incompleto não é convertido em ausência de cache', async () => {
    await assert.rejects(summary({ status: 'running' })('campaign', {}));
    await assert.rejects(summary({ point_counts: { complete: -1, partial: 0, pending: 0, no_data: 0 } })('campaign', {}));
});
