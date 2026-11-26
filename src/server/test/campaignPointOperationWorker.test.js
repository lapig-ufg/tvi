'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { start } = require('../services/campaignPointOperationWorker');

test('worker não sobrepõe lotes e para ao encerrar o processo', async () => {
    let tick;
    let finish;
    let calls = 0;
    let cleared = false;
    const stop = start({ processNext() {
        calls++;
        return new Promise(resolve => { finish = resolve; });
    } }, () => assert.fail('Erro inesperado'), {
        setInterval(callback, delay) { tick = callback; assert.equal(delay, 5000); return 1; },
        clearInterval(id) { assert.equal(id, 1); cleared = true; }
    });
    await tick();
    assert.equal(calls, 1);
    finish();
    await new Promise(resolve => setImmediate(resolve));
    stop();
    await tick();
    assert.equal(calls, 1);
    assert.equal(cleared, true);
});

test('falha de consulta não interrompe consultas posteriores', async () => {
    let tick;
    let failures = 0;
    let calls = 0;
    const stop = start({ async processNext() { if (++calls === 1) throw new Error('database unavailable'); } },
        () => { failures++; }, { setInterval(fn) { tick = fn; return 1; }, clearInterval() {} });
    await new Promise(resolve => setImmediate(resolve));
    await tick();
    assert.equal(failures, 1);
    assert.equal(calls, 2);
    stop();
});
