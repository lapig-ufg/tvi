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
    const calls = [], timers = [], modals = [];
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
        angular: { module: () => ({ factory: (name, factory) => { service = factory(http, timeout, { defer: deferred }, { open(options) {
            const result = deferred();
            const modal = { options, result: result.promise, close: result.resolve, dismiss: result.reject };
            modals.push(modal); return modal;
        } }, { translate: key => ({ 'VIS_PARAMS.NATURAL_COLOR': 'Cor natural', 'VIS_PARAMS.FALSE_COLOR': 'Falsa cor', 'VIS_PARAMS.AGRICULTURE': 'Agricultura' }[key] || key) }); } }) }
    });
    return { service, calls, timers, modals };
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

test('supervisão preserva referências históricas mesmo diante de configuração de revisão atual', () => {
    const c = client();
    const scope = { config: { initialYear: 2020, finalYear: 2021 }, period: 'DRY' };
    const grid = c.service.bindGrid(scope, true);
    grid.reset({ inspection: [{ userName: 'Ana', bdcSelections: [{ selectionId: 'old', year: 2019, period: 'DRY', revision: 1 }] }] });
    grid.configure({ imagerySource: 'bdc', bdcConfig: { selectionRevision: 2, defaultProfile: 'rgb', profiles: ['rgb'] } });
    assert.equal(scope.bdc.view, 'history');
    assert.equal(scope.bdcSelectionId(2019, 'DRY'), 'old');
    assert.deepEqual(JSON.parse(JSON.stringify(scope.buildBdcMaps().map(map => map.year))), [2019, 2020, 2021]);
    scope.bdc.view = 'current';
    assert.equal(scope.bdcSelectionId(2019, 'DRY'), 'old');
    assert.deepEqual(JSON.parse(JSON.stringify(scope.buildBdcMaps().map(map => map.year))), [2019, 2020, 2021]);
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
    const calls = [], layers = [], timers = [], events = {}, watches = [], viewed = [], maps = [], tileRequests = [], revoked = [];
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
    window.document = { createElement: () => ({ setAttribute() {}, removeAttribute() {} }) };
    window.URL = { createObjectURL: () => 'blob:test', revokeObjectURL: url => revoked.push(url) };
    window.setTimeout = (fn, delay) => { const timer = { fn, delay }; timers.push(timer); return timer; };
    window.clearTimeout = timer => { timer.cancelled = true; };
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
    L.TileLayer = { extend: methods => function (url, options) {
        return Object.assign(L.tileLayer(url, options), methods, { getTileUrl: () => url });
    } };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../client/directives/bdcMap.js'), 'utf8'), {
        angular: { module: () => ({ directive: (name, factory) => {
            definition = factory(window, timeout, imagery, { request(url, callback) {
                const request = { url, callback }; tileRequests.push(request);
                return () => { request.cancelled = true; };
            } }, { register() {}, unregister() { calls.push('unregister'); } },
                { createLayer: () => ({ addTo() { return this; } }) });
        } }) }, L
    });
    definition.link(scope, [{ querySelector: () => ({}) }]);
    watches[0]();
    return { scope, calls, layers, timers, events, watches, viewed, maps, tileRequests, revoked, visible(value) { observerCallback([{ isIntersecting: value }]); } };
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


test('inspeção e supervisão apresentam mapas diretamente sem ação de comparação', () => {
    for (const name of ['temporal', 'supervisor']) {
        const template = fs.readFileSync(path.join(__dirname, '../../client/views/' + name + '.tpl.html'), 'utf8');
        assert.match(template, /<bdc-map /);
        assert.doesNotMatch(template, /on-compare=|<bdc-comparison/);
    }
});

 test('tiles aguardam fila sem prazo global e liberam download e blob ao trocar ponto', () => {
    const d = mapDirective();
    d.calls[0].callback(ready());
    const layer = d.layers[0], completed = [];
    const tile = layer.createTile({}, error => completed.push(error));
    assert.equal(d.timers.length, 0);
    d.tileRequests[0].callback(null, 'blob');
    assert.equal(tile.src, 'blob:test');
    d.scope.point = { _id: 'p2', lat: -12, lon: -40 };
    d.watches[0]();
    assert.equal(d.tileRequests[0].cancelled, true);
    assert.deepEqual(d.revoked, ['blob:test']);
    assert.equal(d.timers[0].cancelled, true);
    d.tileRequests[0].callback(null, 'late blob');
    assert.equal(completed.length, 0);
});

test('tileabort cancela download e decodificação sem callback tardio', () => {
    for (const decoding of [false, true]) {
        const d = mapDirective();
        d.calls[0].callback(ready());
        const layer = d.layers[0], completed = [];
        const tile = layer.createTile({}, error => completed.push(error));
        if (decoding) d.tileRequests[0].callback(null, 'blob');
        assert.equal(typeof layer.events.tileabort, 'function');
        layer.events.tileabort({ tile });
        assert.equal(d.tileRequests[0].cancelled, true);
        if (decoding) {
            assert.deepEqual(d.revoked, ['blob:test']);
            assert.equal(d.timers[0].cancelled, true);
            d.timers[0].fn();
        }
        d.tileRequests[0].callback(null, 'late blob');
        assert.equal(completed.length, 0);
        assert.equal(tile.onload, null);
        assert.equal(tile.onerror, null);
    }
});

test('primeira notificação dos parâmetros visuais não recria a camada recém-carregada', () => {
    const d = mapDirective();
    d.calls[0].callback(ready());
    const initial = ['rgb', 13, d.scope.config.sampleMarker];
    d.watches[1](initial, initial);
    assert.equal(d.timers.length, 0);
    assert.equal(d.layers.length, 1);
});

test('ajuda BDC abre um diálogo contextual e fecha ao destruir a tela sem alterar seleções', async () => {
    for (const supervision of [false, true]) {
        const c = client(), events = {};
        const scope = { config: {}, showTimeseries: true, $on(name, callback) { events[name] = callback; } };
        c.service.bindGrid(scope, supervision);
        scope.bdc.profile = 'natural';
        scope.openBdcHelp();
        scope.openBdcHelp();
        assert.equal(c.modals.length, 1);
        assert.equal(c.modals[0].options.templateUrl, 'views/bdc-help.tpl.html');
        const content = c.modals[0].options.resolve.help();
        assert.equal(content.supervision, supervision);
        assert.equal(content.showTimeseries, true);
        c.modals[0].close();
        await tick();
        scope.openBdcHelp();
        assert.equal(c.modals.length, 2);
        events.$destroy();
        await tick();
        assert.equal(scope.bdc.profile, 'natural');
        assert.equal(scope.bdc.view, supervision ? 'history' : 'current');
        assert.equal(c.calls.length, 0);
    }
});
test('composições têm rótulos legíveis mantendo os identificadores e referências históricas', () => {
    const c = client(), scope = { config: {} };
    const grid = c.service.bindGrid(scope, true);
    grid.reset({ inspection: [{ bdcSelections: [{ year: 2020, period: 'DRY', profile: 'false-color', selectionId: 'historic' }] }] });
    grid.configure({ imagerySource: 'bdc', bdcConfig: { defaultProfile: 'natural', profiles: ['natural', 'ndvi', 'agriculture'] } });
    assert.equal(scope.bdcProfileLabel('natural'), 'Cor natural');
    assert.equal(scope.bdcProfileLabel('false-color'), 'Falsa cor');
    assert.equal(scope.bdcProfileLabel('ndvi'), 'NDVI');
    assert.equal(scope.bdcProfileLabel('agriculture'), 'Agricultura');
    assert.equal(scope.bdcProfileLabel('landsat-tvi-true'), 'Cor natural');
    assert.equal(scope.bdcProfileLabel('landsat-tvi-false'), 'Falsa cor');
    assert.equal(scope.bdcProfileLabel('landsat-tvi-agri'), 'Agricultura');
    assert.equal(scope.bdcProfileLabel('landsat-tvi-ndvi'), 'NDVI');
    assert.equal(scope.bdcProfileLabel('tvi-rgb'), 'Cor natural');
    assert.equal(scope.bdcProfileLabel('tvi-ndvi'), 'NDVI');
    assert.equal(scope.bdcProfileLabel('custom-profile'), 'custom-profile');
    assert.deepEqual(Array.from(scope.bdc.profiles), ['natural', 'ndvi', 'agriculture', 'false-color']);
    assert.equal(scope.bdcSelectionId(2020, 'DRY'), 'historic');
    assert.equal(scope.bdcSelectionProfile(2020, 'DRY'), 'false-color');
});

test('supervisão sem referência usa prévia atual sem registrar referência histórica', () => {
    const c = client(), scope = { config: { initialYear: 2020, finalYear: 2022 } };
    const grid = c.service.bindGrid(scope, true);
    grid.reset({ inspection: [{ userName: 'Ana', bdcSelections: [] }] });
    grid.configure({ imagerySource: 'bdc', bdcConfig: { defaultProfile: 'natural', profiles: ['natural'] } });
    assert.equal(scope.isBdc, true);
    assert.deepEqual(Array.from(scope.buildBdcMaps(), map => map.year), [2020, 2021, 2022]);
    assert.equal(scope.bdcSelectionProfile(2020, 'DRY'), 'natural');
    assert.equal(scope.bdcIsPreview(2020, 'DRY'), true);
    assert.equal(scope.bdcUseHistorical(2020, 'DRY'), false);
    assert.equal(scope.bdcSelectionId(2020, 'DRY'), null);
    assert.equal(c.calls.length, 0);
});
test('troca de inspeção preserva aquisição e composição individuais sem aplicar substituição', () => {
    const c = client(), scope = { config: {} };
    const grid = c.service.bindGrid(scope, true);
    grid.reset({ inspection: [
        { bdcSelections: [{ year: 2020, period: 'DRY', selectionId: 'first', profile: 'natural' }] },
        { bdcSelections: [{ year: 2019, period: 'DRY', selectionId: 'second', profile: 'ndvi' }] }
    ] });
    scope.bdc.inspectionIndex = 1;
    scope.bdc.profile = 'agriculture';
    scope.bdc.profileOverride = true;
    scope.changeBdcView();
    assert.equal(scope.bdcSelectionId(2019, 'DRY'), 'second');
    assert.equal(scope.bdcSelectionProfile(2019, 'DRY'), 'ndvi');
    assert.deepEqual(Array.from(scope.maps, map => map.year), [2019]);
    assert.equal(scope.bdcSelectionProfile(2020, 'DRY'), null);
});

test('referência histórica inclusive ausência comprovada prevalece sobre prévia no mesmo período', () => {
    const c = client(), scope = { config: {} };
    const grid = c.service.bindGrid(scope, true);
    grid.reset({ inspection: [{ bdcSelections: [{ year: 2019, period: 'DRY', selectionId: 'no-image-selection', profile: 'ndvi' }] }] });
    grid.configure({ imagerySource: 'bdc', initialYear: 2020, finalYear: 2021,
        bdcConfig: { defaultProfile: 'natural', profiles: ['natural'] } });
    assert.equal(scope.bdcUseHistorical(2019, 'DRY'), true);
    assert.equal(scope.bdcIsPreview(2019, 'DRY'), false);
    assert.equal(scope.bdcSelectionProfile(2019, 'DRY'), 'ndvi');
    assert.equal(scope.bdcSelectionId(2019, 'DRY'), 'no-image-selection');
    assert.equal(scope.bdcIsPreview(2019, 'WET'), false);
    assert.equal(scope.bdcUseHistorical(2019, 'WET'), true);
    assert.equal(scope.bdcSelectionProfile(2019, 'WET'), null);
    assert.equal(scope.bdcIsPreview(2020, 'WET'), true);
    assert.equal(scope.bdcSelectionProfile(2020, 'WET'), 'natural');
    assert.equal(scope.bdcIsPreview(2022, 'WET'), false);
    assert.deepEqual(Array.from(scope.buildBdcMaps(), map => map.year), [2019, 2020, 2021]);
    assert.equal(scope.bdc.references.length, 0);
});
test('campanha legada sem BDC atual mantém ausência histórica sem consulta substituta', () => {
    const c = client(), scope = { config: {} };
    const grid = c.service.bindGrid(scope, true);
    grid.reset({ inspection: [{ bdcSelections: [{ year: 2019, period: 'DRY', selectionId: 'old', profile: 'ndvi' }] }] });
    grid.configure({ imagerySource: 'gee', initialYear: 2020, finalYear: 2021 });
    assert.equal(scope.bdcUseHistorical(2019, 'WET'), true);
    assert.equal(scope.bdcIsPreview(2019, 'WET'), false);
    assert.equal(scope.bdcSelectionProfile(2019, 'WET'), null);
    assert.deepEqual(Array.from(scope.buildBdcMaps(), map => map.year), [2019]);
});
test('prévia atual não registra evidência nem quando a imagem ou ausência é exibida', () => {
    const d = mapDirective({ scope: { preview: true } });
    d.calls[0].callback(ready());
    d.layers[0].events.tileload({ tile: {} });
    d.layers[0].events.load();
    assert.equal(d.viewed.length, 0);
    d.calls[0].callback({ id: 'empty', state: 'no_image', revision: 2 });
    assert.equal(d.viewed.length, 0);
});

test('composição explícita na supervisão preserva aquisição histórica e é limpa ao trocar inspeção ou ponto', () => {
    const c = client(), scope = { config: {} };
    const grid = c.service.bindGrid(scope, true);
    const point = { inspection: [
        { bdcSelections: [{ year: 2020, period: 'DRY', selectionId: 'original', profile: 'natural', profilesViewed: ['ndvi'] }] },
        { bdcSelections: [{ year: 2020, period: 'DRY', selectionId: 'other', profile: 'ndvi' }] }
    ] };
    grid.reset(point);
    grid.configure({ imagerySource: 'bdc', initialYear: 2020, finalYear: 2021,
        bdcConfig: { defaultProfile: 'agriculture', profiles: ['agriculture', 'false-color'] } });
    assert.equal(scope.bdcDisplayProfile(2020, 'DRY'), 'natural');
    assert.equal(scope.bdcDisplayProfile(2021, 'DRY'), 'agriculture');
    assert.deepEqual(Array.from(scope.bdc.profiles), ['agriculture', 'false-color', 'natural', 'ndvi']);
    scope.bdc.selectedProfile = 'false-color';
    scope.changeBdcProfile();
    assert.equal(scope.bdcDisplayProfile(2020, 'DRY'), 'false-color');
    assert.equal(scope.bdcSelectionId(2020, 'DRY'), 'original');
    assert.equal(scope.bdcSelectionProfile(2020, 'DRY'), 'natural');
    assert.equal(scope.bdc.references.length, 0);
    scope.bdc.inspectionIndex = 1;
    scope.changeBdcView();
    assert.equal(scope.bdc.selectedProfile, null);
    assert.equal(scope.bdcDisplayProfile(2020, 'DRY'), 'ndvi');
    scope.bdc.selectedProfile = 'natural';
    scope.changeBdcProfile();
    grid.reset(point);
    assert.equal(scope.bdc.selectedProfile, null);
    assert.equal(scope.bdcDisplayProfile(2020, 'DRY'), 'natural');
    assert.equal(point.inspection[0].bdcSelections[0].profile, 'natural');
    assert.equal(c.calls.length, 0);
});
test('perfil indisponível na aquisição histórica não consulta outra seleção nem substitui composição', () => {
    const d = mapDirective({ scope: { historical: true, selectionId: 'original' } });
    d.calls[0].callback(ready());
    const original = d.scope.resolved;
    d.scope.profile = 'unsupported';
    d.watches[1]();
    d.timers.at(-1).fn();
    assert.equal(d.scope.statusKey, 'BDC.PROFILE_UNAVAILABLE');
    assert.equal(d.scope.resolved, original);
    assert.equal(d.scope.effectiveProfile, 'unsupported');
    assert.equal(d.calls.filter(call => typeof call === 'object').length, 1);
    assert.equal(d.viewed.length, 0);
});

test('botão anual permite exploração BDC mesmo fora da cobertura das imagens auxiliares', () => {
    for (const name of ['temporal', 'supervisor']) {
        const template = fs.readFileSync(path.join(__dirname, '../../client/views/' + name + '.tpl.html'), 'utf8');
        const toolbar = template.match(/<span class="planet-button"[\s\S]*?<\/span>/)[0];
        const visible = toolbar.match(/ng-if="([^"]+)"/)[1];
        const click = toolbar.match(/ng-click="([^"]+)"/)[1];
        const opened = [];
        const context = { isBdc: true, map: { year: 2020 }, point: { _id: 'p' }, config: { imagerySource: 'bdc' },
            hasMosaicForYear: year => year === 2020,
            openMosaicDialog: (map, point, config) => opened.push({ map, point, config }) };
        assert.equal(vm.runInNewContext(visible, context), true);
        vm.runInNewContext(click, context);
        assert.equal(opened[0].map.year, 2020);
        assert.equal(opened[0].point._id, 'p');
        assert.equal(opened[0].config.imagerySource, 'bdc');
        context.map.year = 1970;
        assert.equal(vm.runInNewContext(visible, context), true);
        context.config.imagerySource = 'gee';
        assert.equal(vm.runInNewContext(visible, context), false);
    }
});
