'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const factory = require('../services/bdcTilesClient');
test('catálogo utiliza caminho fixo e não exige credencial administrativa', async () => {
    const calls = [];
    const client = factory.create({ request: async c => { calls.push(c); return { data: { collections: [] } }; } });
    assert.deepEqual(await client.getCatalog(), { collections: [] });
    assert.equal(calls[0].url, '/api/bdc/collections');
    assert.equal(calls[0].maxRedirects, 0);
});
test('trabalho sem credencial de serviço falha antes de enviar requisição', async () => {
    let calls = 0;
    const client = factory.create({ request: async () => { calls++; } });
    await assert.rejects(client.createJob({}), { code: 'BDC_SERVICE_AUTH_UNAVAILABLE' });
    assert.equal(calls, 0);
});
test('identificador de trabalho não pode alterar o caminho remoto', async () => {
    const client = factory.create({ request: async () => { throw new Error('unexpected'); } }, async () => ({ username: 'service', password: 'test' }));
    await assert.rejects(client.getJob('../other'), { code: 'BDC_INVALID_JOB_ID' });
});

test('jobs utilizam Bearer dedicado e catálogo não recebe credencial', async () => {
    const calls = [];
    const token = 'test-service-token-with-sufficient-entropy';
    const client = factory.create({ request: async config => { calls.push(config); return { data: { id: 'job' } }; } }, async () => ({ token }));
    await client.createJob({ idempotency_key: 'request' });
    await client.getJob('job');
    await client.getCatalog();
    assert.equal(calls[0].headers.Authorization, 'Bearer ' + token);
    assert.equal(calls[1].headers.Authorization, 'Bearer ' + token);
    assert.equal(calls[0].auth, undefined);
    assert.equal(calls[2].headers, undefined);
});

test('falha de transporte não propaga configuração contendo credencial', async () => {
    const token = 'test-service-token-with-sufficient-entropy';
    let sent = false;
    const client = factory.create({ request: async config => {
        sent = true;
        const error = new Error('private ' + token);
        error.config = config;
        error.response = { status: 503, data: { detail: { code: 'bdc_service_auth_unconfigured' } } };
        throw error;
    } }, async () => ({ token }));
    await assert.rejects(client.createJob({}), error => {
        assert.equal(sent, true);
        assert.equal(error.code, 'BDC_SERVICE_AUTH_UNAVAILABLE');
        assert.equal(error.config, undefined);
        assert.equal(JSON.stringify(error).includes(token), false);
        assert.equal(error.message.includes(token), false);
        return true;
    });
});

test('tile usa somente caminho BDC validado, resposta binária limitada e nenhum token na URL', async () => {
    let sent;
    const client = factory.create({ request: async config => { sent = config; return { data: Buffer.from('image') }; } });
    assert.equal((await client.getTile('landsat-2', 'scene', 'landsat-tvi-false', 6, 1, 2)).toString(), 'image');
    assert.equal(sent.url, '/api/bdc/tiles/landsat-2/scene/6/1/2.png?profile=landsat-tvi-false');
    assert.equal(sent.responseType, 'arraybuffer');
    assert.equal(sent.maxContentLength, 8 * 1024 * 1024);
    await assert.rejects(client.getTile('landsat-2', '../evil', 'profile', 6, 1, 2));
});


test('capacidade temporariamente ocupada preserva Retry-After validado', async () => {
    for (const [value, expected] of [['2', 2], ['120', 120], ['-1', undefined], ['invalid', undefined], ['999999', undefined]]) {
        const client = factory.create({ request: async () => { throw { response: { status: 503, headers: { 'retry-after': value } } }; } });
        await assert.rejects(client.getTile('landsat-2', 'scene', 'natural', 6, 1, 2), error => {
            assert.equal(error.status, 503);
            assert.equal(error.retryAfterSeconds, expected);
            return true;
        });
    }
});

test('exploração consulta STAC por caminhos fixos sem credenciais nem URLs externas', async () => {
    const calls = [];
    const client = factory.create({ request: async config => { calls.push(config); return { data: { items: [] } }; } });
    await client.searchImages({ collection: 'landsat-2', bbox: [-49.001, -3.001, -48.999, -2.999], start: '2020-01-01', end: '2020-12-31', page: 2, limit: 24, maxCloud: 80 });
    await client.getItem('landsat-2', 'scene-1');
    assert.equal(calls[0].url, '/api/bdc/search');
    assert.deepEqual(calls[0].params, { collection: 'landsat-2', bbox: '-49.001,-3.001,-48.999,-2.999', start: '2020-01-01', end: '2020-12-31', page: 2, limit: 24, max_cloud: 80 });
    assert.equal(calls[1].url, '/api/bdc/items/landsat-2/scene-1');
    assert.equal(calls[0].headers, undefined);
    assert.equal(calls[1].maxRedirects, 0);
    await assert.rejects(client.getItem('landsat-2', '../segredo'), { status: 400 });
    await assert.rejects(client.getItem('outra', 'scene'), { status: 400 });
    assert.equal(calls.length, 2);
});
