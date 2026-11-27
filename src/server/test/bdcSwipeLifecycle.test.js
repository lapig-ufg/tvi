'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function swipe() {
    let definition;
    const timers = [], watches = {}, events = {}, listeners = new Map(), mapListeners = new Map();
    function node() {
        return { style: {}, children: [], events: {}, appendChild(child) { this.children.push(child); },
            remove() { this.removed = true; }, addEventListener(name, fn) { this.events[name] = fn; },
            removeEventListener(name) { delete this.events[name]; }, getBoundingClientRect: () => ({ left: 0, width: 500, height: 500 }) };
    }
    const container = node();
    const document = { createElement: node, addEventListener(name, fn) { listeners.set(name, fn); }, removeEventListener(name) { listeners.delete(name); } };
    const layers = new Set();
    const map = { getContainer: () => container, getCenter: () => ({ lat: 0, lng: 0 }), getZoom: () => 13,
        invalidateSize() {}, setView() {}, hasLayer: layer => layers.has(layer), removeLayer(layer) { layers.delete(layer); layer.removed = true; },
        on(name, fn) { if (!mapListeners.has(name)) mapListeners.set(name, new Set()); mapListeners.get(name).add(fn); },
        off(name, fn) { if (mapListeners.has(name)) mapListeners.get(name).delete(fn); } };
    function tile() { const element = node(); return { events: {}, on(name, fn) { this.events[name] = fn; },
        addTo() { layers.add(this); if (this.events.add) this.events.add(); }, getContainer: () => element,
        setOpacity() {}, bringToBack() {}, bringToFront() {} }; }
    const L = { map: () => map, tileLayer: tile, control: { scale: () => ({ addTo() {} }) } };
    function timeout(fn) { const task = { fn }; timers.push(task); return task; }
    timeout.cancel = task => { if (task) task.cancelled = true; };
    const scope = { lat: 0, lon: 0, zoom: 13, sampleMarker: {}, leftLayer: { collection: 'landsat' },
        rightLayer: { source: 'bdc', tileUrl: '/service/bdc/tiles/{z}/{x}/{y}.png' },
        $watch(name, fn) { watches[name] = fn; }, $on(name, fn) { events[name] = fn; }, $evalAsync(fn) { fn(); } };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../client/others/leaflet-swipe-map.js'), 'utf8'), {
        Application: { directive(name, factory) { definition = factory(timeout, { has: () => false },
            { createLayer: () => ({ addTo() { return this; }, setZIndexOffset() {} }) }, { create: tile }); } }, L, document, safeDestroyMap() {}
    });
    definition.link(scope, { find: () => [container] });
    function flush() { for (let i = 0; timers.length && i < 100; i++) { const task = timers.shift(); if (!task.cancelled) task.fn(); } }
    flush();
    return { scope, watches, events, listeners, mapListeners, container, flush, layers };
}
test('troca da imagem BDC remove listeners do divisor durante arraste', () => {
    const c = swipe();
    const divider = c.container.children.find(child => !child.removed && child.className === 'leaflet-swipe-divider');
    divider.events.mousedown({ preventDefault() {}, stopPropagation() {} });
    assert.equal(c.listeners.size, 2);
    const previous = c.scope.rightLayer;
    c.scope.rightLayer = null;
    c.watches.rightLayer(null, previous);
    c.flush();
    assert.equal(c.listeners.size, 0);
    assert.equal(c.mapListeners.get('resize').size, 0);
    assert.equal(c.layers.size, 1);
});
test('fechamento do diálogo remove listeners globais durante arraste', () => {
    const c = swipe();
    const divider = c.container.children.find(child => !child.removed && child.className === 'leaflet-swipe-divider');
    divider.events.touchstart({ preventDefault() {}, stopPropagation() {} });
    assert.equal(c.listeners.size, 2);
    c.events.$destroy();
    assert.equal(c.listeners.size, 0);
});
