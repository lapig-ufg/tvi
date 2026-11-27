'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
function client() {
    let service;
    const calls = [], timers = [], changes = [];
    const http = { get(url, config) { const pending = deferred(); calls.push({ url, config, pending }); return pending.promise; } };
    const timeout = (fn, delay) => { const timer = { fn, delay }; timers.push(timer); return timer; };
    timeout.cancel = timer => { if (timer) timer.cancelled = true; };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../client/services/bdcImageBrowserService.js'), 'utf8'), {
        angular: { module: () => ({ factory: (name, factory) => { service = factory(http, { defer: deferred }, timeout); } }) }
    });
    const browser = service.create({ pointId: 'point', year: 2020 }, layer => changes.push(layer));
    return { service, browser, calls, timers, changes };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
test('busca anual BDC permanece somente leitura e carrega detalhe após escolha explícita', async () => {
    const c = client();
    c.browser.search(1);
    assert.equal(c.calls[0].url, '/service/points/point/bdc-images');
    assert.equal(c.calls[0].config.params.period, 'YEAR');
    c.calls[0].pending.resolve({ data: { items: [{ id: 'scene', datetime: '2020-05-01T00:00:00Z' }], nextPage: 2 } });
    await tick();
    assert.equal(c.browser.state.items.length, 1);
    assert.equal(c.calls.length, 1);
    c.browser.state.selectedId = 'scene';
    c.browser.select();
    c.calls[1].pending.resolve({ data: { id: 'scene', profiles: [{ id: 'rgb', label: 'Cor natural' }], tiles: { rgb: '/service/bdc-image/scene/{z}/{x}/{y}.png' } } });
    await tick();
    assert.equal(c.changes.at(-1).tileUrl, '/service/bdc-image/scene/{z}/{x}/{y}.png');
    assert.equal(c.browser.state.profile, 'rgb');
});
test('nova busca e fechamento cancelam consultas e descartam resultados antigos', async () => {
    const c = client();
    c.browser.search(1);
    let cancelled = false;
    c.calls[0].config.timeout.then(() => { cancelled = true; });
    c.browser.state.period = 'DRY';
    c.browser.search(1);
    await tick();
    assert.equal(cancelled, true);
    c.calls[0].pending.resolve({ data: { items: [{ id: 'stale' }] } });
    await tick();
    assert.equal(c.browser.state.items.length, 0);
    c.browser.dispose();
    c.calls[1].pending.resolve({ data: { items: [{ id: 'late' }] } });
    await tick();
    assert.equal(c.browser.state.items.length, 0);
});
test('falha de detalhe elimina camada anterior e perfil externo é recusado', async () => {
    const c = client();
    c.browser.state.items = [{ id: 'first' }, { id: 'second' }];
    c.browser.state.selectedId = 'first';
    c.browser.select();
    c.calls[0].pending.resolve({ data: { id: 'first', profiles: [{ id: 'rgb' }], tiles: { rgb: '/service/bdc-image/first/{z}/{x}/{y}.png' } } });
    await tick();
    assert.ok(c.changes.at(-1));
    c.browser.state.selectedId = 'second';
    c.browser.select();
    assert.equal(c.changes.at(-1), null);
    c.calls[1].pending.reject({ status: 503 });
    await tick();
    assert.equal(c.browser.state.error, 'BDC.ERROR');
    assert.equal(c.changes.at(-1), null);
    c.browser.select();
    c.calls[2].pending.resolve({ data: { id: 'second', profiles: [{ id: 'rgb' }], tiles: { rgb: 'https://external/tile' } } });
    await tick();
    assert.equal(c.changes.at(-1), null);
    assert.equal(c.browser.state.error, 'BDC.PROFILE_UNAVAILABLE');
});

function dialog(service) {
    let controller;
    const events = {}, scope = { $on(name, callback) { events[name] = callback; } };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../client/controllers/mosaic-dialog.js'), 'utf8'), {
        Application: { controller(name, value) { controller = value; } }
    });
    function timeout(fn) { return fn; }
    timeout.cancel = () => {};
    controller(scope, { dismiss() {} }, [], { year: 2020 }, { _id: 'point', lon: -49, lat: -16 },
        { imagerySource: 'bdc', bdcConfig: { collection: 'landsat-2' }, zoomLevel: 13 },
        [{ satellite: 'landsat', year: [2020], visparam: ['landsat-tvi-true'] },
         { satellite: 'sentinel', year: [2020], visparam: ['tvi-rgb'] }], 'DRY',
        { has: name => name === 'bdcImageBrowserService', get: () => service }, timeout, { translate: key => key });
    return { scope, events };
}
test('diálogo conserva Landsat e alterna Sentinel/BDC sem modificar campanha nem inspeção', async () => {
    const c = client(), d = dialog(c.service);
    assert.equal(d.scope.rightMapConfig.collection, 's2_harmonized');
    const left = d.scope.leftMapConfig;
    d.scope.imagerySource.right = 'bdc';
    d.scope.changeRightSource();
    assert.equal(d.scope.rightMapConfig, null);
    assert.equal(d.scope.leftMapConfig, left);
    c.calls[0].pending.resolve({ data: { items: [{ id: 'scene' }] } });
    await tick();
    d.scope.bdcBrowser.selectedId = 'scene';
    d.scope.selectBdcImage();
    c.calls[1].pending.resolve({ data: { id: 'scene', profiles: [{ id: 'rgb' }], tiles: { rgb: '/service/bdc-image/{z}/{x}/{y}.png' } } });
    await tick();
    assert.equal(d.scope.rightMapConfig.source, 'bdc');
    assert.equal(d.scope.leftMapConfig, left);
    d.scope.imagerySource.right = 'sentinel';
    d.scope.changeRightSource();
    assert.equal(d.scope.rightMapConfig.collection, 's2_harmonized');
    d.events.$destroy();
    assert.equal(d.scope.config.bdcConfig.collection, 'landsat-2');
});

test('intervalo personalizado envia datas locais e troca de composição não consulta nem troca aquisição', async () => {
    const c = client();
    c.browser.state.period = 'CUSTOM';
    c.browser.state.start = new Date(2020, 4, 1);
    c.browser.state.end = new Date(2020, 10, 30);
    c.browser.search(1);
    assert.equal(c.calls[0].config.params.start, '2020-05-01');
    assert.equal(c.calls[0].config.params.end, '2020-11-30');
    c.calls[0].pending.resolve({ data: { items: [{ id: 'scene' }] } });
    await tick();
    c.browser.state.selectedId = 'scene';
    c.browser.select();
    c.calls[1].pending.resolve({ data: { id: 'scene', profiles: [{ id: 'rgb' }, { id: 'ndvi' }],
        tiles: { rgb: '/service/images/rgb/{z}/{x}/{y}.png', ndvi: '/service/images/ndvi/{z}/{x}/{y}.png' } } });
    await tick();
    c.browser.state.profile = 'ndvi';
    c.browser.applyProfile();
    assert.equal(c.changes.at(-1).itemId, 'scene');
    assert.equal(c.changes.at(-1).profile, 'ndvi');
    assert.equal(c.calls.length, 2);
    c.browser.failTile();
    assert.equal(c.changes.at(-1), null);
    assert.equal(c.browser.state.error, 'BDC.IMAGE_ERROR');
});
