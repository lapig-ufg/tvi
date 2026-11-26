'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isDeepStrictEqual } = require('node:util');

const catalog = { collections: [{ id: 'landsat-2', profiles: [
    { id: 'landsat-tvi-true' }, { id: 'landsat-tvi-ndvi' }
] }] };

function bdc() {
    return { _id: 'bdc-test', imagerySource: 'bdc', imageType: 'landsat', useDynamicMaps: true,
        initialYear: 2020, finalYear: 2021, landUse: ['Pastagem'],
        bdcConfig: { schemaVersion: 1, collection: 'landsat-2', selectionStrategy: 'local_cloud',
            bufferRadiusM: 1000, periodPolicy: 'tvi-seasonal-v1', profiles: ['landsat-tvi-true'],
            defaultProfile: 'landsat-tvi-true', selectionRevision: 888 } };
}

function setup() {
    const documents = new Map();
    const state = { catalogCalls: 0, conflict: false };
    const clone = value => value === undefined ? undefined : structuredClone(value);
    const collection = {
        findOne(query, callback) {
            const value = clone(documents.get(query._id) || null);
            if (callback) return callback(null, value);
            return Promise.resolve(value);
        },
        async insertOne(value) { documents.set(value._id, clone(value)); },
        async updateOne(query, update) {
            const value = documents.get(query._id);
            const matches = value && Object.keys(query).every(key => {
                const expected = query[key];
                if (expected && Object.prototype.hasOwnProperty.call(expected, '$exists')) {
                    return Object.prototype.hasOwnProperty.call(value, key) === expected.$exists;
                }
                return isDeepStrictEqual(value[key], expected);
            });
            if (!matches || state.conflict) return { matchedCount: 0, modifiedCount: 0 };
            Object.assign(value, clone(update.$set));
            for (const key of Object.keys(update.$unset || {})) delete value[key];
            return { matchedCount: 1, modifiedCount: 1 };
        }
    };
    const app = { config: {}, repository: { collections: { campaign: collection, points: {}, mosaics: {} } },
        services: { logger: { info: async () => {}, warn: async () => {}, error: async () => {}, logError: async () => {} },
            bdcTilesClient: { async getCatalog() {
                state.catalogCalls += 1;
                if (state.catalogError) throw state.catalogError;
                return catalog;
            } } } };
    const crud = require('../controllers/campaign-crud')(app);
    const supervisor = require('../controllers/supervisor')(app);
    async function request(method, body) {
        const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(data) { this.body = data; return this; } };
        await crud[method]({ body: clone(body), params: { id: 'bdc-test' }, session: {} }, res);
        return res;
    }
    return { state, documents, request, supervisor };
}

test('criação BDC persiste configuração validada com revisão controlada', async () => {
    const env = setup();
    const res = await env.request('create', bdc());
    assert.equal(res.statusCode, 200);
    assert.equal(env.documents.get('bdc-test').imagerySource, 'bdc');
    assert.equal(env.documents.get('bdc-test').bdcConfig.selectionRevision, 1);
});

test('atualização parcial conserva BDC e troca de perfil não incrementa revisão', async () => {
    const env = setup();
    await env.request('create', bdc());
    assert.equal((await env.request('update', { showTimeseries: false })).statusCode, 200);
    const config = env.documents.get('bdc-test').bdcConfig;
    assert.ok(config);
    assert.equal((await env.request('update', { bdcConfig: Object.assign({}, config,
        { profiles: ['landsat-tvi-true', 'landsat-tvi-ndvi'], defaultProfile: 'landsat-tvi-ndvi' }) })).statusCode, 200);
    assert.equal(env.documents.get('bdc-test').bdcConfig.selectionRevision, 1);
});

test('raio muda revisão e configuração da sessão antiga é substituída pela persistida', async () => {
    const env = setup();
    await env.request('create', bdc());
    const config = env.documents.get('bdc-test').bdcConfig;
    assert.equal((await env.request('update', { bdcConfig: Object.assign({}, config, { bufferRadiusM: 1500 }) })).statusCode, 200);
    const response = await new Promise(resolve => {
        env.supervisor.getCampaignConfig({ session: { user: { campaign: { _id: 'bdc-test', bdcConfig: { selectionRevision: 1 } } } } },
            { json: resolve, status() { return this; } });
    });
    assert.equal(response.imagerySource, 'bdc');
    assert.equal(response.bdcConfig.selectionRevision, 2);
    assert.equal(response.bdcConfig.bufferRadiusM, 1500);
    assert.equal(response.initialYear, 2020);
    assert.equal(response.finalYear, 2021);
});

test('erro de configuração não grava e edição concorrente retorna conflito', async () => {
    const env = setup();
    const invalid = bdc();
    invalid.bdcConfig.defaultProfile = 'unknown';
    assert.equal((await env.request('create', invalid)).statusCode, 400);
    assert.equal(env.documents.size, 0);
    await env.request('create', bdc());
    env.state.conflict = true;
    assert.equal((await env.request('update', { bdcConfig: Object.assign({}, bdc().bdcConfig, { bufferRadiusM: 1200 }) })).statusCode, 409);
});

test('campanha legada é criada e editada sem depender do catálogo BDC', async () => {
    const env = setup();
    assert.equal((await env.request('create', { _id: 'bdc-test', imageType: 'landsat' })).statusCode, 200);
    assert.equal((await env.request('update', { showTimeseries: false })).statusCode, 200);
    assert.equal(env.state.catalogCalls, 0);
    assert.equal(env.documents.get('bdc-test').imagerySource, undefined);
    assert.equal(env.documents.get('bdc-test').bdcConfig, undefined);
});

test('indisponibilidade do catálogo retorna 503 e não cria nem modifica campanha', async () => {
    const env = setup();
    env.state.catalogError = new Error('Tiles unavailable');
    assert.equal((await env.request('create', bdc())).statusCode, 503);
    assert.equal(env.documents.size, 0);
    env.state.catalogError = null;
    await env.request('create', bdc());
    const before = structuredClone(env.documents.get('bdc-test'));
    env.state.catalogError = new Error('Tiles unavailable');
    assert.equal((await env.request('update', { showTimeseries: false })).statusCode, 503);
    assert.deepEqual(env.documents.get('bdc-test'), before);
});

test('campos pontuados não contornam validação e revisão da configuração BDC', async () => {
    const env = setup();
    await env.request('create', bdc());
    for (const field of ['bdcConfig.selectionRevision', 'bdcConfig.profiles.0', 'wmsConfig.enabled', 'imagerySource.bdc']) {
        const before = structuredClone(env.documents.get('bdc-test'));
        assert.equal((await env.request('update', { [field]: true })).statusCode, 400, field);
        assert.deepEqual(env.documents.get('bdc-test'), before);
    }
});
