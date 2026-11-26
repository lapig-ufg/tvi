'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

async function fixture(t, service, session = { admin: { superAdmin: { id: 'admin-id', username: 'ana' } } }) {
    const app = express();
    app.use(require('body-parser').json());
    app.use((req, res, next) => { req.session = session; next(); });
    app.services = { campaignPointOperations: service };
    require('../routes/campaignPointOperations')(app);
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const base = 'http://127.0.0.1:' + server.address().port + '/api/campaigns/campaign-a/point-operations';
    return async (suffix = '', body) => {
        const response = await fetch(base + suffix, body === undefined ? {} : {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
        });
        return { status: response.status, cache: response.headers.get('cache-control'), body: await response.json() };
    };
}

test('rotas usam administrador autenticado e campanha do endereço em todas as operações', async t => {
    const calls = [];
    const service = {};
    for (const method of ['list', 'preview', 'get', 'confirm', 'resume']) {
        service[method] = async (...args) => { calls.push({ method, args }); return { id: 'operation-a' }; };
    }
    const request = await fixture(t, service);
    const body = { actor: 'impostor', campaignId: 'campaign-b', confirmation: 'campaign-a', reason: 'Motivo da alteração' };
    const cases = [
        ['', undefined, 'list', ['campaign-a', 'ana'], 200],
        ['/preview', body, 'preview', ['campaign-a', 'ana', body], 200],
        ['/operation-a', undefined, 'get', ['campaign-a', 'ana', 'operation-a', {}], 200],
        ['/operation-a/confirm', body, 'confirm', ['campaign-a', 'ana', 'operation-a', body], 202],
        ['/operation-a/resume', body, 'resume', ['campaign-a', 'ana', 'operation-a', body], 202]
    ];
    for (const [suffix, payload, method, args, status] of cases) {
        const response = await request(suffix, payload);
        assert.equal(response.status, status);
        assert.equal(response.cache, 'no-store');
        assert.deepEqual(response.body, { id: 'operation-a' });
        assert.deepEqual(calls.pop(), { method, args });
    }
});

test('sessão ausente, inspetor e administrador sem identificação não acessam o serviço', async t => {
    for (const session of [undefined, {}, { user: { name: 'ana', type: 'inspector' } }, { admin: { username: 'ana' } }, { admin: { superAdmin: {} } }]) {
        const request = await fixture(t, { list: async () => assert.fail('Serviço não deve ser chamado') }, session === undefined ? null : session);
        const response = await request();
        assert.equal(response.status, 401);
        assert.equal(response.cache, 'no-store');
    }
});

test('erros de validação e conflito preservam o status e a mensagem pública', async t => {
    for (const status of [400, 403, 404, 409, 413, 422]) {
        const request = await fixture(t, { preview: async () => { throw Object.assign(new Error('Operação recusada.'), { statusCode: status }); } });
        const response = await request('/preview', {});
        assert.equal(response.status, status);
        assert.deepEqual(response.body, { error: 'Operação recusada.' });
    }
});

test('falhas internas não expõem detalhes do banco ou credenciais', async t => {
    const request = await fixture(t, { confirm: async () => {
        throw new Error('mongodb://usuario:senha-interna@host/collection');
    } });
    const response = await request('/operation-a/confirm', {});
    assert.equal(response.status, 500);
    assert.deepEqual(response.body, { error: 'Não foi possível processar a operação de pontos.' });
    assert.equal(response.cache, 'no-store');
});
