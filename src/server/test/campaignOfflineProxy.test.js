'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

function routes(service, campaign = { _id: 'test' }) {
    const registered = {};
    const auth = function auth() {};
    const app = {
        services: { tilesApiService: service },
        repository: { collections: { campaign: { findOne: async () => campaign } } },
        middleware: { auth: { cacheApiAuth: { requireCacheApiAuth: auth } } },
        get(path, middleware, fn) { assert.equal(middleware, auth); registered.get = fn; },
        post(path, middleware, fn) { assert.equal(middleware, auth); registered.post = fn; }
    };
    require('../routes/campaignOffline')(app);
    return registered;
}
function response() { return { code: 200, status(code) { this.code = code; return this; }, json(data) { this.data = data; } }; }

test('operações offline exigem autenticação e encaminham apenas parâmetros permitidos', async () => {
    const calls = [];
    const handlers = routes({ offlineCampaign: async (...args) => { calls.push(args); return { status: 'preparing' }; } });
    const res = response();
    const req = { params: { campaignId: 'test' }, body: { mode: 'start', width: 512, password: 'ignore' } };
    await handlers.post(req, res);
    assert.deepEqual(calls[0].slice(0, 3), ['test', 'post', { mode: 'start', width: 512, height: 512 }]);
    assert.equal(res.data.status, 'preparing');
});

test('operações inválidas não chegam ao Tiles', async () => {
    const handlers = routes({ offlineCampaign: async () => assert.fail('não deve chamar') });
    const res = response();
    await handlers.post({ params: { campaignId: 'test' }, body: { mode: 'clear_all' } }, res);
    assert.equal(res.code, 400);
});

test('erros preservam código sem expor detalhes da conexão', async () => {
    const handlers = routes({ offlineCampaign: async () => { throw { response: { status: 503, data: { detail: 'secret' } } }; } });
    const res = response();
    await handlers.get({ params: { campaignId: 'test' }, query: {} }, res);
    assert.equal(res.code, 503);
    assert.doesNotMatch(JSON.stringify(res.data), /secret/);
});

test('campanha BDC consulta e inicia o cache pelo mesmo proxy autenticado', async () => {
    const calls = [];
    const handlers = routes({ offlineCampaign: async (...args) => {
        calls.push(args);
        return { status: 'preparing', config: { source: 'bdc' } };
    } }, { _id: 'test', imagerySource: 'bdc' });
    for (const method of ['get', 'post']) {
        const res = response();
        await handlers[method]({ params: { campaignId: 'test' }, query: {}, body: { source: 'gee' } }, res);
        assert.equal(res.code, 200);
        assert.equal(res.data.config.source, 'bdc');
        assert.equal(calls.at(-1)[1], method);
        assert.equal(calls.at(-1)[2].source, undefined);
    }
});

test('configuração BDC rejeitada no Tiles preserva erro sem fabricar sucesso', async () => {
    const handlers = routes({ offlineCampaign: async () => {
        throw { response: { status: 422, data: { detail: 'secret' } } };
    } }, { _id: 'test', imagerySource: 'bdc' });
    const res = response();
    await handlers.post({ params: { campaignId: 'test' }, body: {} }, res);
    assert.equal(res.code, 422);
    assert.doesNotMatch(JSON.stringify(res.data), /secret/);
});
