'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function layer() {
    let service;
    const calls = [], revoked = [], timers = [];
    const window = { document: { createElement: () => ({ setAttribute() {}, removeAttribute() {} }) },
        URL: { createObjectURL: () => 'blob:tile', revokeObjectURL: url => revoked.push(url) },
        setTimeout(fn) { const timer = { fn }; timers.push(timer); return timer; }, clearTimeout(timer) { timer.cancelled = true; } };
    const queue = { request(url, callback) { const call = { url, callback }; calls.push(call); return () => { call.cancelled = true; }; } };
    const L = { TileLayer: { extend: methods => function (url, options) {
        return Object.assign({ options, events: {}, on(event, callback) { this.events[event] = callback; }, getTileUrl: () => url }, methods);
    } } };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../client/services/bdcQueuedTileLayer.js'), 'utf8'), {
        angular: { module: () => ({ factory: (name, factory) => { service = factory(window, queue); } }) }, L
    });
    return { service, calls, revoked, timers };
}
test('camada de exploração cancela fila, decodificação e blob ao ser removida', () => {
    const c = layer(), completed = [];
    const mapLayer = c.service.create('/service/images/{z}/{x}/{y}.png', {});
    mapLayer.createTile({}, error => completed.push(error));
    c.calls[0].callback(null, 'image');
    mapLayer.events.remove();
    assert.equal(c.calls[0].cancelled, true);
    assert.equal(c.timers[0].cancelled, true);
    assert.deepEqual(c.revoked, ['blob:tile']);
    c.timers[0].fn();
    assert.equal(completed.length, 0);
});
test('tileabort cancela pedidos e falha definitiva é entregue ao mapa', () => {
    const c = layer(), completed = [];
    const mapLayer = c.service.create('/service/images/{z}/{x}/{y}.png', {});
    const tile = mapLayer.createTile({}, error => completed.push(error));
    mapLayer.events.tileabort({ tile });
    c.calls[0].callback(null, 'late');
    assert.equal(completed.length, 0);
    mapLayer.createTile({}, error => completed.push(error));
    const failure = new Error('HTTP 404');
    c.calls[1].callback(failure);
    assert.equal(completed[0], failure);
    assert.equal(c.service.create('https://outside/image', {}), null);
});
