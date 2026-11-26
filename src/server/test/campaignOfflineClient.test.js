'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function deferred() { let resolve; let reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
function panel() {
    let definition;
    const calls = [], timers = [], events = {};
    const scope = { campaignId: 'test', campaign: { useDynamicMaps: true, imageType: 'landsat' },
        $on(name, fn) { events[name] = fn; } };
    function timeout(fn) { const timer = { fn }; timers.push(timer); return timer; }
    timeout.cancel = timer => { timer.cancelled = true; };
    const http = {};
    for (const method of ['get', 'post']) http[method] = (...args) => { const d = deferred(); calls.push({ method, args, d }); return d.promise; };
    const q = { defer: deferred };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../client/others/campaign-offline-cache.js'), 'utf8'), {
        Application: { directive(name, factory) { definition = factory(); } }
    });
    definition.controller(scope, http, timeout, q, { confirm: () => Promise.resolve(true) });
    return { scope, calls, timers, events };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('consulta sequencial não sobrepõe requisições e interrompe ao destruir', async () => {
    const p = panel();
    assert.equal(p.calls.length, 1);
    p.scope.refreshOffline();
    assert.equal(p.calls.length, 1);
    p.calls[0].d.resolve({ data: { status: 'running', counts: {}, total: 2 } });
    await tick();
    assert.equal(p.timers.length, 1);
    p.events.$destroy();
    assert.equal(p.timers[0].cancelled, true);
    p.timers[0].fn();
    assert.equal(p.calls.length, 1);
});

test('resposta após destruição não altera a tela nem agenda consulta', async () => {
    const p = panel();
    p.events.$destroy();
    p.calls[0].d.resolve({ data: { status: 'running' } });
    await tick();
    assert.equal(p.scope.offline.status, null);
    assert.equal(p.timers.length, 0);
});

test('disparo transmite somente a campanha e cobertura escolhidas', async () => {
    const p = panel();
    p.calls[0].d.resolve({ data: { status: 'not_started' } });
    await tick();
    p.scope.startOffline('start');
    assert.equal(p.calls[1].method, 'post');
    assert.equal(p.calls[1].args[0], '/api/cache/campaign/test/offline');
    assert.deepEqual(JSON.parse(JSON.stringify(p.calls[1].args[1])), { mode: 'start', width: 512, height: 512 });
});
