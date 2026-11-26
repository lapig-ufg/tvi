'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
function client() {
    const requests = [], timers = [];
    let service, now = 0;
    class Clock extends Date { static now() { return now; } }
    class XHR {
        open(method, url) { this.url = url; }
        send() { requests.push(this); }
        abort() { this.aborted = true; if (this.onabort) this.onabort(); }
        getResponseHeader() { return this.retryAfter; }
        finish(status, retryAfter) { this.status = status; this.retryAfter = retryAfter; this.response = 'blob'; this.onload(); }
    }
    const window = { XMLHttpRequest: XHR, setTimeout(fn, delay) { const t = { fn, delay }; timers.push(t); return t; }, clearTimeout(t) { t.cancelled = true; } };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../client/services/bdcTileQueue.js'), 'utf8'), {
        angular: { module: () => ({ factory: (name, factory) => { service = factory(window); } }) }, Date: Clock, Error
    });
    return { service, requests, timers, advance(ms) { now += ms; } };
}
test('38 anos compartilham dois downloads e cancelamento libera a fila sem callbacks antigos', async () => {
    const c = client(), results = [], cancels = [];
    for (let i = 0; i < 38; i++) cancels.push(c.service.request('/' + i, (error, blob) => results.push([error, blob])));
    assert.equal(c.requests.length, 2);
    cancels[0]();
    assert.equal(c.requests[0].aborted, true);
    await Promise.resolve();
    assert.equal(c.requests.length, 3);
    cancels.slice(1).forEach(cancel => cancel());
    assert.equal(results.length, 0);
    assert.ok(c.requests.every(r => r.aborted));
});
test('ocupação temporária permite recuperar após quatro respostas respeitando Retry-After', () => {
    const c = client(), results = [];
    c.service.request('/tile', (error, blob) => results.push({ error, blob }));
    for (let i = 0; i < 4; i++) {
        c.requests[i].finish(i % 2 ? 429 : 503, '2');
        assert.equal(results.length, 0);
        assert.equal(c.timers[i].delay, 2000);
        c.advance(2000);
        c.timers[i].fn();
    }
    c.requests[4].finish(200);
    assert.equal(results.length, 1);
    assert.equal(results[0].error, null);
    assert.equal(results[0].blob, 'blob');
});
test('orçamento de 120 segundos impede tentativa tardia e limita timeout restante', () => {
    const c = client(), results = [];
    c.service.request('/tile', error => results.push(error));
    c.advance(119000);
    c.requests[0].finish(503, '0');
    c.timers[0].fn();
    assert.equal(c.requests[1].timeout, 1000);
    c.requests[1].finish(503, '1');
    assert.equal(results.length, 1);
    assert.equal(c.requests.length, 2);
});
test('timer atrasado não inicia tentativa depois do orçamento', () => {
    const c = client(), results = [];
    c.service.request('/tile', error => results.push(error));
    c.requests[0].finish(503, '2');
    c.advance(120000);
    c.timers[0].fn();
    assert.equal(c.requests.length, 1);
    assert.equal(results.length, 1);
});
test('Retry-After zero tem limite de 60 tentativas', () => {
    const c = client(), results = [];
    c.service.request('/tile', error => results.push(error));
    for (let i = 0; i < 60; i++) {
        c.requests[i].finish(503, '0');
        if (i < 59) c.timers[i].fn();
    }
    assert.equal(c.requests.length, 60);
    assert.equal(results.length, 1);
    assert.equal(results[0].status, 503);
});
test('espera inicial na fila não consome orçamento', () => {
    const c = client();
    c.service.request('/first', () => {});
    c.service.request('/second', () => {});
    c.service.request('/queued', () => {});
    c.advance(240000);
    c.requests[0].finish(200);
    assert.equal(c.requests[2].url, '/queued');
    assert.equal(c.requests[2].timeout, 30000);
});
test('erros permanentes e timeout não recebem novas tentativas', () => {
    for (const status of [400, 401, 404, 500]) {
        const c = client(), results = [];
        c.service.request('/tile', error => results.push(error));
        assert.equal(c.requests[0].timeout, 30000);
        c.requests[0].finish(status);
        assert.equal(results[0].status, status);
        assert.equal(c.timers.length, 0);
    }
    const c = client(), results = [];
    c.service.request('/tile', error => results.push(error));
    c.requests[0].ontimeout();
    assert.equal(results.length, 1);
    assert.equal(c.requests.length, 1);
});
test('cancelamento durante Retry-After impede nova requisição', () => {
    const c = client();
    const cancel = c.service.request('/tile', () => assert.fail('callback após cancelamento'));
    c.requests[0].finish(503, '2');
    cancel();
    c.timers[0].fn();
    assert.equal(c.requests.length, 1);
});
test('503 sem Retry-After válido encerra sem repetição automática', () => {
    for (const header of [undefined, 'invalid', '121']) {
        const c = client(), results = [];
        c.service.request('/tile', error => results.push(error));
        c.requests[0].finish(503, header);
        assert.equal(results.length, 1);
        assert.equal(c.timers.length, 0);
    }
});
test('38 períodos terminam progressivamente mantendo no máximo dois pedidos ativos', () => {
    const c = client(), results = [];
    for (let i = 0; i < 38; i++) c.service.request('/' + i, (error, blob) => results.push({ error, blob }));
    for (let i = 0; i < 38; i++) {
        assert.ok(c.requests.length - i <= 2);
        c.requests[i].finish(200);
    }
    assert.equal(results.length, 38);
    assert.ok(results.every(result => result.error === null && result.blob === 'blob'));
});

test('cancelar todos os 38 períodos não inicia nenhum download enfileirado', async () => {
    const c = client(), cancels = [];
    for (let i = 0; i < 38; i++) cancels.push(c.service.request('/' + i, () => assert.fail('callback cancelado')));
    assert.equal(c.requests.length, 2);
    cancels.forEach(cancel => cancel());
    await Promise.resolve();
    assert.equal(c.requests.length, 2);
    assert.ok(c.requests.every(request => request.aborted));
});
