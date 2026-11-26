'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function deferred() {
    let resolve, reject;
    const promise = new Promise((a, b) => { resolve = a; reject = b; });
    return { promise, resolve, reject };
}
function client() {
    const calls = [], timers = [];
    let service;
    const http = {};
    ['get', 'post'].forEach(method => {
        http[method] = (...args) => {
            const pending = deferred();
            calls.push({ method, args, pending });
            return pending.promise;
        };
    });
    function timeout(fn, delay) { const timer = { fn, delay }; timers.push(timer); return timer; }
    timeout.cancel = timer => { if (timer) timer.cancelled = true; };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../client/services/bdcImageryService.js'), 'utf8'), {
        angular: { module: () => ({ factory: (name, factory) => { service = factory(http, timeout, { defer: deferred }); } }) }
    });
    return { service, calls, timers };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
const options = { pointId: 'p1', year: 2020, period: 'DRY', revision: 1 };

test('cartões iguais compartilham solicitação e seleção pronta permanece reutilizável', async () => {
    const c = client();
    const first = [], second = [];
    c.service.observe(options, value => first.push(value));
    c.service.observe(options, value => second.push(value));
    assert.equal(c.calls.length, 1);
    c.calls[0].pending.resolve({ data: { id: 's1', state: 'ready', local: { itemId: 'image' } } });
    await tick();
    assert.equal(first.at(-1).id, 's1');
    assert.equal(second.at(-1).id, 's1');
    c.service.observe(options, () => {});
    assert.equal(c.calls.length, 1);
});

test('ausência de seleção corrente solicita trabalho e consulta estados até conclusão', async () => {
    const c = client();
    const states = [];
    c.service.observe(options, value => states.push(value.state));
    c.calls[0].pending.reject({ status: 404 });
    await tick();
    assert.equal(c.calls[1].method, 'post');
    assert.deepEqual(JSON.parse(JSON.stringify(c.calls[1].args[1])), { year: 2020, period: 'DRY' });
    c.calls[1].pending.resolve({ data: { id: 's1', state: 'running', retryAfterSeconds: 2 } });
    await tick();
    c.timers.find(timer => !timer.cancelled && timer.delay === 2000).fn();
    assert.equal(c.calls[2].method, 'get');
    c.calls[2].pending.resolve({ data: { id: 's1', state: 'no_image' } });
    await tick();
    assert.equal(states.at(-1), 'no_image');
});

test('referência histórica ausente nunca dispara seleção atual', async () => {
    const c = client();
    const states = [];
    c.service.observe({ ...options, selectionId: 'old-selection' }, value => states.push(value));
    assert.equal(c.calls[0].args[1].params.selectionId, 'old-selection');
    c.calls[0].pending.reject({ status: 404 });
    await tick();
    assert.equal(c.calls.length, 1);
    assert.equal(states.at(-1).state, 'failed');
    assert.equal(states.at(-1).retryable, false);
});

test('cancelamento da última assinatura descarta resposta tardia e libera a fila', async () => {
    const c = client();
    const first = [];
    const cancel = c.service.observe(options, value => first.push(value));
    c.service.observe({ ...options, pointId: 'p2' }, () => {});
    c.service.observe({ ...options, pointId: 'p3' }, () => {});
    assert.equal(c.calls.length, 2);
    cancel();
    c.calls[0].pending.resolve({ data: { id: 'stale', state: 'ready' } });
    await tick();
    assert.equal(first.some(value => value.id === 'stale'), false);
    assert.equal(c.calls.length, 3);
});

test('erro HTTP encerra carregamento sem retentativas cegas e distingue autorização', async () => {
    for (const status of [400, 401, 403, 409, 422, 503]) {
        const c = client();
        let current;
        c.service.observe(options, value => { current = value; });
        c.calls[0].pending.reject({ status });
        await tick();
        assert.equal(current.state, 'failed');
        assert.equal(current.retryable, status === 503);
        assert.equal(c.calls.length, 1);
    }
});

test('URL de composição preserva a aquisição e recusa origem externa', () => {
    const c = client();
    const selection = { local: { tiles: { rgb: '/service/bdc/tiles/image/rgb/{z}/{x}/{y}', bad: 'https://foreign.test/tile' } } };
    assert.equal(c.service.tileUrl(selection, 'rgb'), '/service/bdc/tiles/image/rgb/{z}/{x}/{y}');
    assert.equal(c.service.tileUrl(selection, 'bad'), null);
    assert.equal(c.calls.length, 0);
});

test('supervisão abre referências da inspeção, preserva anos históricos e separa revisão atual', () => {
    const c = client();
    const scope = { config: { initialYear: 2020, finalYear: 2021 }, period: 'DRY' };
    const grid = c.service.bindGrid(scope, true);
    grid.reset({ inspection: [{ userName: 'Ana', bdcSelections: [{ selectionId: 'old', year: 2019, period: 'DRY', revision: 1 }] }] });
    grid.configure({ imagerySource: 'bdc', bdcConfig: { selectionRevision: 2, defaultProfile: 'rgb', profiles: ['rgb'] } });
    assert.equal(scope.bdc.view, 'history');
    assert.equal(scope.bdcSelectionId(2019, 'DRY'), 'old');
    assert.deepEqual(JSON.parse(JSON.stringify(scope.buildBdcMaps().map(map => map.year))), [2019]);
    scope.bdc.view = 'current';
    assert.equal(scope.bdcSelectionId(2019, 'DRY'), null);
    assert.deepEqual(JSON.parse(JSON.stringify(scope.buildBdcMaps().map(map => map.year))), [2020, 2021]);
    assert.equal(c.calls.length, 0);
});

test('somente referências exibidas entram na inspeção e troca de ponto limpa evidências anteriores', () => {
    const c = client();
    const scope = { config: {} };
    const grid = c.service.bindGrid(scope, false);
    const reference = { selectionId: 's1', profile: 'rgb', year: 2020, period: 'DRY', revision: 1 };
    scope.bdcViewed(reference);
    scope.bdcViewed(reference);
    assert.equal(scope.bdc.references.length, 1);
    scope.bdcViewed({ ...reference, profile: 'ndvi' });
    assert.equal(scope.bdc.references.length, 1);
    assert.equal(scope.bdc.references[0].profile, 'ndvi');
    assert.deepEqual(Array.from(scope.bdc.references[0].profilesViewed), ['rgb', 'ndvi']);
    grid.reset({ inspection: [] });
    assert.equal(scope.bdc.references.length, 0);
});

test('tentativa manual envia retry explícito e nova consulta não inicia trabalhos automaticamente', async () => {
    const c = client();
    const subscription = c.service.observe(options, () => {});
    c.calls[0].pending.resolve({ data: { state: 'failed', retryable: true } });
    await tick();
    subscription.retry();
    assert.equal(c.calls[1].method, 'post');
    assert.equal(c.calls[1].args[1].retry, true);
});

test('supervisão identifica inspetor pelo vetor histórico e bloqueia intervalo de anos ilimitado', () => {
    const c = client();
    const scope = { config: { initialYear: 0, finalYear: Infinity } };
    const grid = c.service.bindGrid(scope, true);
    grid.reset({ inspection: [{ bdcSelections: [] }], userName: ['Maria'] });
    assert.equal(scope.bdc.inspectors[0].userName, 'Maria');
    assert.equal(scope.buildBdcMaps().length, 0);
});

function mapDirective(extra = {}) {
    let definition, observerCallback;
    const calls = [], layers = [], timers = [], events = {}, watches = [], viewed = [], maps = [];
    const scope = Object.assign({ point: { _id: 'p1', lat: -15, lon: -48 }, year: 2020, period: 'DRY',
        profile: 'rgb', config: { zoomLevel: 13, sampleMarker: {}, bdcConfig: { selectionRevision: 2 } },
        $watchGroup(names, fn) { watches.push(fn); }, $evalAsync(fn) { fn(); },
        $on(name, fn) { events[name] = fn; }, onViewed({ reference }) { viewed.push(reference); }
    }, extra.scope);
    const window = extra.lazy ? { IntersectionObserver: function (callback) {
        observerCallback = callback;
        this.observe = () => {};
        this.disconnect = () => { calls.push('disconnect'); };
    } } : {};
    function timeout(fn, delay) { const timer = { fn, delay }; timers.push(timer); return timer; }
    timeout.cancel = timer => { if (timer) timer.cancelled = true; };
    const imagery = { tileUrl: client().service.tileUrl, observe(options, callback) {
        const request = { options, callback, cancelled: false };
        calls.push(request);
        const cancel = () => { request.cancelled = true; };
        cancel.retry = () => { request.retried = true; };
        return cancel;
    } };
    const L = {
        map(element, options) {
            const map = { options, setView(center, zoom) { this.center = center; this.zoom = zoom; }, removeLayer() {}, invalidateSize() {}, remove() { this.removed = true; } };
            maps.push(map); return map;
        },
        tileLayer(url, options) {
            const layer = { url, options, events: {}, on(event, fn) { this.events[event] = fn; }, off() { this.detached = true; }, addTo() {} };
            layers.push(layer); return layer;
        }
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../client/directives/bdcMap.js'), 'utf8'), {
        angular: { module: () => ({ directive: (name, factory) => {
            definition = factory(window, timeout, imagery, { register() {}, unregister() { calls.push('unregister'); } },
                { createLayer: () => ({ addTo() { return this; } }) });
        } }) }, L
    });
    definition.link(scope, [{ querySelector: () => ({}) }]);
    watches[0]();
    return { scope, calls, layers, timers, events, watches, viewed, maps, visible(value) { observerCallback([{ isIntersecting: value }]); } };
}
function ready(extra = {}) {
    return { id: 'selection', state: 'ready', revision: 1, lon: -50, lat: -17, year: 2020, period: 'DRY',
        profiles: [{ id: 'rgb' }, { id: 'ndvi' }],
        local: { tiles: { rgb: '/service/bdc/tiles/rgb/{z}/{x}/{y}', ndvi: '/service/bdc/tiles/ndvi/{z}/{x}/{y}' } }, ...extra };
}

test('mapa consulta somente ao entrar na área visível e descarta resposta do ponto anterior', () => {
    const d = mapDirective({ lazy: true });
    assert.equal(d.calls.length, 0);
    d.visible(true);
    assert.equal(d.calls.length, 1);
    const first = d.calls[0];
    d.scope.point = { _id: 'p2', lat: -12, lon: -40 };
    d.watches[0]();
    assert.equal(first.cancelled, true);
    first.callback(ready());
    assert.equal(d.scope.resolved, null);
    assert.equal(d.layers.length, 0);
    d.events.$destroy();
    assert.ok(d.calls.includes('disconnect'));
    assert.equal(d.calls[1].cancelled, true);
});

test('mapa histórico usa coordenada original e composição muda somente tiles', () => {
    const d = mapDirective({ scope: { historical: true, selectionId: 'old' } });
    d.calls[0].callback(ready());
    assert.deepEqual(Array.from(d.maps[0].center), [-17, -50]);
    d.scope.profile = 'ndvi';
    d.watches[1]();
    d.timers.at(-1).fn();
    assert.equal(d.calls.filter(call => typeof call === 'object').length, 1);
    assert.equal(d.layers.at(-1).url, '/service/bdc/tiles/ndvi/{z}/{x}/{y}');
    assert.equal(d.layers[0].detached, true);
    d.events.$destroy();
    assert.equal(d.maps[0].removed, true);
    assert.ok(d.calls.includes('unregister'));
});

test('mapa limita o zoom inicial e a navegação ao intervalo aceito pelo Tiles BDC', () => {
    for (const [configured, expected] of [[1, 6], [13, 13], [20, 18]]) {
        const d = mapDirective({ scope: { config: { zoomLevel: configured, sampleMarker: {}, bdcConfig: { selectionRevision: 1 } } } });
        d.calls[0].callback(ready());
        assert.equal(d.maps[0].zoom, expected);
        assert.equal(d.maps[0].options.minZoom, 6);
        assert.equal(d.maps[0].options.maxZoom, 18);
        assert.equal(d.layers[0].options.minZoom, 6);
        assert.equal(d.layers[0].options.maxZoom, 18);
    }
});

test('ausência histórica de referência não consulta revisão atual', () => {
    const d = mapDirective({ scope: { historical: true } });
    assert.equal(d.calls.length, 0);
    assert.equal(d.scope.statusKey, 'BDC.NO_HISTORY');
});

test('referência só é registrada após carregamento integral, com falha visível e nova tentativa local', () => {
    const d = mapDirective();
    d.calls[0].callback(ready());
    const layer = d.layers[0];
    layer.events.tileload();
    layer.events.tileerror();
    layer.events.load();
    assert.equal(d.viewed.length, 0);
    assert.equal(d.scope.statusKey, 'BDC.IMAGE_ERROR');
    d.scope.retry();
    const retryLayer = d.layers[1];
    retryLayer.events.tileload();
    retryLayer.events.load();
    assert.equal(d.viewed[0].selectionId, 'selection');
    assert.equal(d.viewed[0].profile, 'rgb');
    assert.equal(d.calls.length, 1);
});

test('ausência comprovada registra a composição da campanha e não cria mapa', () => {
    const d = mapDirective();
    d.calls[0].callback({ id: 'empty', state: 'no_image', revision: 2 });
    assert.equal(d.viewed[0].profile, 'rgb');
    assert.equal(d.maps.length, 0);
});

test('novo lote não oculta tile inválido ainda presente no mapa', () => {
    const d = mapDirective();
    d.calls[0].callback(ready());
    const layer = d.layers[0], broken = {};
    layer.events.tileerror({ tile: broken });
    layer.events.load();
    layer.events.loading();
    layer.events.tileload({ tile: {} });
    layer.events.load();
    assert.equal(d.viewed.length, 0);
    assert.equal(d.scope.statusKey, 'BDC.IMAGE_ERROR');
    layer.events.tileunload({ tile: broken });
    layer.events.loading();
    layer.events.tileload({ tile: {} });
    layer.events.load();
    assert.equal(d.viewed.length, 1);
});
