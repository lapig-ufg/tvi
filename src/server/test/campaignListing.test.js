'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongodb = require('mongodb');

function response() {
    return { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}

const logger = { info: async () => {}, error: async () => {}, warn: async () => {}, debug: async () => {}, logError: async () => 'erro' };

test('listagem de campanhas filtra e ordena globalmente antes de paginar', async t => {
    const db = new mongodb.Db('tvi_campaign_listing_test_' + process.pid,
        new mongodb.Server('127.0.0.1', 27019, { auto_reconnect: false }), { safe: true });
    try { await db.open(); } catch (_) { t.skip('MongoDB local de testes indisponível.'); return; }
    t.after(async () => { await db.dropDatabase(); db.close(); });
    const campaign = db.collection('campaign');
    const points = db.collection('points');
    const app = { config: {}, repository: { db, collections: { campaign, points } }, services: { logger } };
    const controller = require('../controllers/campaign-crud')(app);
    const fixtures = [
        { _id: 'z-antiga', createdAt: new Date('2024-01-01'), numInspec: 2, landUse: ['Floresta'] },
        { _id: 'a-nova', createdAt: new Date('2026-01-01'), numInspec: 3, imageType: 'landsat', imagerySource: 'bdc', bdcConfig: { collection: 'landsat-2', selectionStrategy: 'local-quality', defaultProfile: 'natural', bufferRadiusM: 500 }, zoomLevel: 16, landUse: ['Pastagem'], autoLoadTimeseries: false, showPointInfo: false },
        { _id: 'b-nova', createdAt: new Date('2026-01-01'), numInspec: 1, useDynamicMaps: true },
        { _id: 'c-iniciada', createdAt: new Date('2025-01-01'), numInspec: 3 },
        { _id: 'd-aguardando', createdAt: new Date('2025-02-01'), numInspec: 2 },
        { _id: 'e.vazia[1]', createdAt: new Date('2025-03-01'), numInspec: 3 },
        { _id: 'aa-sem-data', numInspec: 2 },
        { _id: 'zz-data-nula', createdAt: null, numInspec: 2 }
    ];
    await campaign.insertMany(fixtures);
    const pointDocs = [];
    function add(id, counts) {
        counts.forEach((count, index) => pointDocs.push({ _id: id + index, campaign: id, userName: Array.from({ length: count }, (_, i) => 'u' + i) }));
    }
    add('z-antiga', [2, 2, 2, 2, 2]);
    add('a-nova', [3, 0]);
    add('b-nova', [1]);
    add('c-iniciada', [1, 0, 0]);
    add('d-aguardando', [0, 0, 0, 0]);
    await points.insertMany(pointDocs);
    async function list(query) {
        const res = response();
        await controller.list({ query: query || {} }, res);
        assert.equal(res.statusCode, 200, JSON.stringify(res.body));
        return res.body;
    }

    await t.test('mais recentes primeiro com desempate estável e datas ausentes ao final', async () => {
        assert.deepEqual((await list({ limit: '20' })).campaigns.map(x => x._id), ['a-nova', 'b-nova', 'e.vazia[1]', 'd-aguardando', 'c-iniciada', 'z-antiga', 'aa-sem-data', 'zz-data-nula']);
        assert.deepEqual((await list({ page: '2', limit: '2' })).campaigns.map(x => x._id), ['e.vazia[1]', 'd-aguardando']);
        assert.deepEqual((await list({ sortBy: 'createdAtAsc', limit: '20' })).campaigns.map(x => x._id), ['z-antiga', 'c-iniciada', 'd-aguardando', 'e.vazia[1]', 'a-nova', 'b-nova', 'aa-sem-data', 'zz-data-nula']);
    });

    await t.test('ordenação por total considera todas campanhas e não fatia duas vezes', async () => {
        const data = await list({ sortBy: 'totalPoints', page: '2', limit: '2' });
        assert.deepEqual(data.campaigns.map(x => x._id), ['c-iniciada', 'a-nova']);
        assert.equal(data.pagination.totalCampaigns, 8);
        assert.equal(data.pagination.totalPages, 4);
        assert.equal(data.campaigns[1].completedPoints, 1);
    });

    await t.test('filtro de conclusão contabiliza páginas além da primeira', async () => {
        const data = await list({ progressStatus: 'completed', sortBy: 'campaignId', page: '2', limit: '1' });
        assert.deepEqual(data.campaigns.map(x => x._id), ['z-antiga']);
        assert.equal(data.pagination.totalCampaigns, 2);
        assert.equal(data.pagination.hasNext, false);
    });

    await t.test('ID é busca literal, sem metacaracteres nem injeção', async () => {
        assert.deepEqual((await list({ campaignId: '.vazia[' })).campaigns.map(x => x._id), ['e.vazia[1]']);
        assert.equal((await list({ campaignId: '.*' })).pagination.totalCampaigns, 0);
        const res = response();
        await controller.list({ query: { campaignId: { $ne: null } } }, res);
        assert.equal(res.statusCode, 400);
    });

    await t.test('filtros BDC correspondem à configuração ativa e podem ser combinados', async () => {
        await campaign.updateOne({ _id: 'z-antiga' }, { $set: { bdcConfig: { collection: 'inativa', defaultProfile: 'antigo' } } });
        const data = await list({ imagerySource: 'bdc', bdcCollection: 'landsat-2', bdcSelectionStrategy: 'local-quality', bdcDefaultProfile: 'natural', bdcBufferRadiusM: '500', zoomLevel: '16', landUse: 'Pastagem' });
        assert.deepEqual(data.campaigns.map(x => x._id), ['a-nova']);
        assert.equal((await list({ imagerySource: 'legacy' })).pagination.totalCampaigns, 7);
        assert.equal((await list({ imagerySource: 'legacy', bdcCollection: 'landsat-2' })).pagination.totalCampaigns, 0);
        assert.equal((await list({ bdcCollection: 'inativa' })).pagination.totalCampaigns, 0);
        assert.deepEqual((await list({ landUse: 'Floresta' })).campaigns.map(x => x._id), ['z-antiga']);
    });

    await t.test('booleanos aceitam todos, sim e não respeitando os padrões legados', async () => {
        for (const field of ['showTimeseries', 'showPointInfo', 'autoLoadTimeseries', 'useDynamicMaps']) {
            assert.equal((await list({ [field]: '' })).pagination.totalCampaigns, 8);
        }
        assert.equal((await list({ autoLoadTimeseries: 'true' })).pagination.totalCampaigns, 7);
        assert.deepEqual((await list({ autoLoadTimeseries: 'false' })).campaigns.map(x => x._id), ['a-nova']);
        assert.equal((await list({ showTimeseries: 'false' })).pagination.totalCampaigns, 0);
        assert.equal((await list({ showPointInfo: 'false' })).pagination.totalCampaigns, 1);
        assert.deepEqual((await list({ useDynamicMaps: 'true' })).campaigns.map(x => x._id), ['b-nova']);
        assert.equal((await list({ useDynamicMaps: 'false' })).pagination.totalCampaigns, 7);
        assert.equal((await list({ zoomLevel: '13' })).pagination.totalCampaigns, 7);
    });

    await t.test('estados distinguem ausência de pontos, espera e inspeções parciais', async () => {
        assert.deepEqual((await list({ progressStatus: 'empty', sortBy: 'campaignId' })).campaigns.map(x => x._id), ['aa-sem-data', 'e.vazia[1]', 'zz-data-nula']);
        assert.deepEqual((await list({ progressStatus: 'notStarted' })).campaigns.map(x => x._id), ['d-aguardando']);
        assert.deepEqual((await list({ progressStatus: 'started' })).campaigns.map(x => x._id), ['a-nova', 'c-iniciada']);
        assert.deepEqual((await list({ sortBy: 'progress', limit: '3' })).campaigns.map(x => x._id), ['b-nova', 'z-antiga', 'a-nova']);
        const beyond = await list({ progressStatus: 'completed', page: '5', limit: '1' });
        assert.equal(beyond.campaigns.length, 0);
        assert.equal(beyond.pagination.totalCampaigns, 2);
    });

    await t.test('opções incluem configuração efetiva e ignoram BDC retido em campanha legada', async () => {
        const res = response();
        await controller.getFilterOptions({ query: {} }, res);
        assert.equal(res.statusCode, 200);
        assert.deepEqual(res.body.data.imagerySources, ['bdc', 'legacy']);
        assert.deepEqual(res.body.data.bdcCollections, ['landsat-2']);
        assert.deepEqual(res.body.data.bdcSelectionStrategies, ['local-quality']);
        assert.deepEqual(res.body.data.bdcDefaultProfiles, ['natural']);
        assert.deepEqual(res.body.data.bdcBufferRadii, [500]);
        assert.deepEqual(res.body.data.zoomLevels, [13, 16]);
        assert.deepEqual(res.body.data.landUses, ['Floresta', 'Pastagem']);
    });

    await t.test('estatísticas globais medem pontos e inspeções reais', async () => {
        const dashboard = require('../controllers/dashboard-controller')(app);
        const res = response();
        await dashboard.getCampaignStats({}, res);
        assert.equal(res.statusCode, 200);
        assert.deepEqual(res.body.data, { total: 8, active: 3, completed: 2, totalPoints: 15, totalInspections: 15 });
    });

    await t.test('parâmetros inválidos são recusados sem mudar o significado do filtro', async () => {
        for (const query of [{ showTimeseries: 'talvez' }, { limit: '-1' }, { page: '0' }, { zoomLevel: '99' }, { imagerySource: 'outra' }, { bdcCollection: { $ne: '' } }, { sortBy: 'password' }]) {
            const res = response();
            await controller.list({ query }, res);
            assert.equal(res.statusCode, 400, JSON.stringify(query));
        }
    });

});
