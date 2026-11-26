'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const client = path.join(__dirname, '../../client');
const tick = () => new Promise(resolve => setImmediate(resolve));
const campaign = { _id: 'test', initialYear: 2020, finalYear: 2021, zoomLevel: 18,
    landUse: ['Floresta'], imageType: 'landsat', useDynamicMaps: true,
    showTimeseries: false, showPointInfo: true, visParams: ['landsat-tvi-false'] };

test('campanha BDC administrativa não consulta capabilities nem monta imagens GEE', async () => {
    const c = temporal();
    const selected = { ...campaign, imagerySource: 'bdc' };
    await c.respond('/api/campaigns/test', selected);
    c.point(selected);
    assert.equal(c.scope.isBdc, true);
    assert.equal(c.serviceCalls.some(call => call.url === 'admin/capabilities'), false);
    assert.equal(c.scope.maps.length, 0);
});

function temporal(query = { campaignId: 'test', pointId: 'p' }, storedCampaign) {
    let factory;
    const httpCalls = [], serviceCalls = [], events = {}, notices = [], cancelled = [];
    const scope = { $on: (name, fn) => { events[name] = fn; }, $broadcast() {}, $evalAsync: fn => fn() };
    const requester = {
        _get(url, params, success) {
            if (typeof params === 'function') { success = params; params = {}; }
            serviceCalls.push({ method: 'get', url, params, success });
        },
        _post(url, params, success, error) { serviceCalls.push({ method: 'post', url, params, success, error }); }
    };
    function interval(fn) { return { fn }; }
    interval.cancel = timer => cancelled.push(timer);
    const deps = {
        $scope: scope, $rootScope: {}, requester, fakeRequester: {}, util: {}, AdminPages: {},
        $http: { get(url) { return new Promise((resolve, reject) => httpCalls.push({ url, resolve, reject })); } },
        $location: { search: () => query }, $interval: interval, $timeout() {},
        $window: {}, i18nService: { translate: key => key }, $routeParams: {},
        NotificationDialog: { error: text => notices.push(text), warning: text => notices.push(text) },
        $injector: { has: () => false }, sampleMarkerService: { core: { normalize: value => value || {} } }
    };
    vm.runInNewContext(fs.readFileSync(path.join(client, 'controllers/admin-temporal.js'), 'utf8'), {
        Application: { controller(name, fn) { factory = fn; } },
        localStorage: { getItem: key => key === 'currentCampaignId' ? storedCampaign : null, setItem() {} },
        console: { log() {}, warn() {}, error() {} }, location: { host: 'example.test' }, Plotly: { purge() {} }
    });
    const names = factory.toString().match(/^function\s*\(([^)]*)\)/)[1].split(',').map(name => name.trim());
    factory(...names.map(name => deps[name]));
    return {
        scope, httpCalls, serviceCalls, notices, cancelled, destroy: () => events.$destroy(),
        async respond(url, data) { httpCalls.find(call => call.url === url).resolve({ data }); await tick(); },
        point(campaignData = campaign) {
            serviceCalls.find(call => call.url === 'admin/points/get-point-by-id').success({
                campaign: campaignData, totalPoints: 1,
                point: { _id: 'p', campaign: campaignData._id, dates: {}, bounds: [], userName: [],
                    classConsolidated: [], dataPointTime: [{ totalPointTime: 0 }] }
            });
            const config = serviceCalls.find(call => call.url === 'admin/campaign/config');
            if (config) config.success({ _id: campaignData._id, initialYear: 2020, finalYear: 2021 });
        },
        capabilities(satellite = 'landsat') {
            serviceCalls.find(call => call.url === 'admin/capabilities').success([
                { name: satellite === 'landsat' ? 'landsat' : 's2_harmonized', satellite,
                    year: [1985, 2019, 2020, 2021, 2022], period: ['DRY', 'WET'], visparam: ['default'] }
            ]);
        }
    };
}

test('link direto do ponto resolve a campanha do próprio ponto antes da seleção antiga do navegador', async () => {
    const c = temporal({ pointId: 'p/a' }, 'outra');
    assert.equal(c.httpCalls[0].url, '/service/admin/points/p%2Fa');
    await c.respond('/service/admin/points/p%2Fa', { _id: 'p/a', campaign: 'test' });
    assert.equal(c.httpCalls[1].url, '/api/campaigns/test');
    await c.respond('/api/campaigns/test', campaign);
    assert.equal(c.scope.config.initialYear, 2020);
    assert.equal(c.scope.config.finalYear, 2021);
});

for (const imageType of ['landsat', 'sentinel-2']) {
    test(imageType + ': capabilities respeitam o período da campanha e preservam opções de visualização', async () => {
        const c = temporal();
        const selected = { ...campaign, imageType };
        await c.respond('/api/campaigns/test', selected);
        c.capabilities(imageType === 'landsat' ? 'landsat' : 'sentinel');
        c.point(selected);
        assert.deepEqual(Array.from(c.scope.maps, map => map.year), [2020, 2021]);
        assert.equal(c.scope.useDynamicMaps, true);
        assert.equal(c.scope.showTimeseries, false);
        assert.equal(c.scope.showPointInfo, true);
        assert.equal(c.serviceCalls.some(call => call.url.startsWith('admin/timeseries/')), false);
        assert.ok(c.scope.maps.every(map => map.url.includes('year=' + map.year)));
    });
}

test('capabilities recebidas depois do ponto atualizam os mapas sem ampliar o período', async () => {
    const c = temporal();
    await c.respond('/api/campaigns/test', campaign);
    c.point();
    c.capabilities();
    assert.deepEqual(Array.from(c.scope.maps, map => map.year), [2020, 2021]);
    assert.ok(c.scope.maps.every(map => map.url.includes('/api/layers/')));
});

test('mudança de período Sentinel mantém somente anos da campanha', async () => {
    const selected = { ...campaign, imageType: 'sentinel-2' };
    const c = temporal();
    await c.respond('/api/campaigns/test', selected);
    c.capabilities('sentinel');
    c.point(selected);
    c.scope.sentinelPeriod = 'WET';
    c.scope.updateSentinelPeriod();
    assert.deepEqual(Array.from(c.scope.maps, map => map.year), [2020, 2021]);
    assert.ok(c.scope.maps.every(map => map.period === 'WET'));
});

test('ponto de outra campanha não é renderizado com configuração incompatível', async () => {
    const c = temporal();
    await c.respond('/api/campaigns/test', campaign);
    c.point({ ...campaign, _id: 'outra' });
    assert.equal(c.scope.pointLoaded, undefined);
    assert.equal(c.scope.maps, undefined);
    assert.equal(c.notices.length, 1);
});

test('saída interrompe contador e ignora capabilities e ponto recebidos tardiamente', async () => {
    const c = temporal();
    await c.respond('/api/campaigns/test', campaign);
    c.destroy();
    c.point();
    c.capabilities();
    assert.equal(c.cancelled.length, 1);
    assert.equal(c.scope.pointLoaded, undefined);
    assert.equal(c.scope.maps, undefined);
    assert.equal(c.scope.tilesCapabilities.length, 0);
});

test('saída antes da resposta da campanha não inicia consultas auxiliares', async () => {
    const c = temporal();
    c.destroy();
    await c.respond('/api/campaigns/test', campaign);
    assert.equal(c.serviceCalls.length, 0);
});

test('serviços do Temporal exigem sessão de superadministrador', () => {
    const routes = [];
    const noop = () => {};
    const controller = new Proxy({}, { get: () => noop });
    require('../routes/adminTemporal')({
        controllers: { points: controller, timeseries: controller, dashboard: controller,
            supervisor: controller, image: controller, capabilities: controller },
        get: (url, ...handlers) => routes.push({ url, handlers }),
        post: (url, ...handlers) => routes.push({ url, handlers })
    });
    for (const route of routes) {
        for (const session of [undefined, {}, { admin: {} }, { user: { campaign: 'test' } }]) {
            let allowed = false, status;
            const res = { status(value) { status = value; return this; }, json() {} };
            route.handlers[0]({ session }, res, () => { allowed = true; });
            assert.equal(allowed, false, route.url);
            assert.equal(status, 401, route.url);
        }
        let allowed = false;
        route.handlers[0]({ session: { admin: { superAdmin: true } } }, {}, () => { allowed = true; });
        assert.equal(allowed, true, route.url);
    }
});

test('controles Landsat chamam a geração pública e atualizam período e visualização', async () => {
    const c = temporal();
    await c.respond('/api/campaigns/test', campaign);
    c.capabilities();
    c.point();
    assert.equal(typeof c.scope.generateMaps, 'function');
    c.scope.period = 'WET';
    c.scope.landsatVisparam = 'landsat-tvi-true';
    c.scope.generateMaps();
    assert.deepEqual(Array.from(c.scope.maps, map => map.year), [2020, 2021]);
    assert.ok(c.scope.maps.every(map => map.period === 'WET' && map.visparam === 'landsat-tvi-true'));
    assert.equal(c.scope.periodo, 'PERIODS.WET');
    const maps = c.scope.maps;
    c.destroy();
    c.scope.generateMaps();
    assert.equal(c.scope.maps, maps);
});

test('grade de mapas fica fora dos controles de visualização e os contêineres estão balanceados', () => {
    const template = fs.readFileSync(path.join(client, 'views/admin-temporal.tpl.html'), 'utf8');
    const stack = [];
    const controls = [];
    let grid;
    for (const match of template.matchAll(/<\/?div\b(?:"[^"]*"|'[^']*'|[^'">])*>/g)) {
        const tag = match[0];
        if (tag.startsWith('</')) {
            assert.ok(stack.length, 'fechamento de div sem abertura');
            stack.pop();
            continue;
        }
        const className = (tag.match(/\bclass="([^"]*)"/) || [])[1] || '';
        const node = { classes: className.split(/\s+/), parent: stack[stack.length - 1] };
        if (node.classes.includes('visparam-controls')) controls.push(node);
        if (node.classes.includes('maps-grid')) {
            grid = node;
            assert.equal(stack.some(ancestor => ancestor.classes.includes('visparam-controls')), false,
                'grade herdaria display flex ou ng-show dos controles Landsat');
        }
        stack.push(node);
    }
    assert.equal(stack.length, 0, 'div aberta sem fechamento');
    assert.ok(grid);
    assert.equal(controls.length, 3);
    assert.ok(controls.every(control => control.parent === grid.parent));
});

test('mapas possuem superfície definida e limitada à cobertura offline padrão', () => {
    const template = fs.readFileSync(path.join(client, 'views/admin-temporal.tpl.html'), 'utf8');
    assert.match(template, /\.admin-temporal \.map-viewport,\s*\.admin-temporal \.map-placeholder\s*\{[^}]*height:\s*512px;[^}]*max-width:\s*512px;/);
    assert.match(template, /\.admin-temporal \.map-viewport > landsat-map,\s*\.admin-temporal \.map-viewport > inspection-map\s*\{[^}]*display:\s*block;[^}]*height:\s*100%;/);
    const viewport = template.match(/<div class="map-viewport">([\s\S]*?)<\/div>/);
    assert.ok(viewport);
    assert.match(viewport[1], /<landsat-map\b/);
    assert.match(viewport[1], /<inspection-map\b/);
});

test('opções anteriores às capabilities mantêm identidade entre ciclos do AngularJS', async () => {
    const c = temporal();
    await c.respond('/api/campaigns/test', campaign);
    const first = c.scope.getAvailableVisParams();
    assert.equal(c.scope.getAvailableVisParams(), first);
    assert.equal(first[0].name, 'landsat-tvi-false');
    c.scope.campaignVisParams = ['landsat-tvi-true'];
    const changed = c.scope.getAvailableVisParams();
    assert.notEqual(changed, first);
    assert.equal(changed[0].name, 'landsat-tvi-true');
    assert.equal(c.scope.getAvailableVisParams(), changed);
});
