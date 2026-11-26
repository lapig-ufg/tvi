'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function controller(file) {
    let factory;
    const requests = [], timers = [], broadcasts = [], events = {};
    const scope = { $root: {}, $on: (name, fn) => { events[name] = fn; },
        $broadcast: (...args) => broadcasts.push(args) };
    const http = { get(url) { return { then(fn) { requests.push({ url, fn }); return { catch() {} }; } }; } };
    const deps = {
        $scope: scope, $rootScope: scope.$root, $http: http,
        $location: { search: () => ({ campaignId: 'test', pointId: 'p' }) },
        $routeParams: { id: 'test' }, $interval() {},
        $timeout(fn) { timers.push(fn); },
        $window: { addEventListener() {}, removeEventListener() {} },
        requester: { _get() {}, _post() {} }, fakeRequester: {}, util: {}, AdminPages: { go() {} },
        i18nService: { translate: value => value }, NotificationDialog: {},
        $injector: { has: () => false }, sampleMarkerService: { core: { normalize: () => ({}) } }
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../client/controllers', file), 'utf8'), {
        Application: { controller(name, fn) { factory = fn; } },
        localStorage: { getItem() {}, setItem() {} }, console, location: { host: 'example.test' }
    });
    const names = factory.toString().match(/^function\s*\(([^)]*)\)/)[1].split(',').map(n => n.trim());
    factory(...names.map(name => {
        assert.ok(Object.hasOwn(deps, name), 'Dependência indisponível: ' + name);
        return deps[name];
    }));
    if (file === 'admin-temporal.js') {
        requests.find(r => r.url === '/api/campaigns/test').fn({ data: {
            _id: 'test', initialYear: 2020, finalYear: 2021, zoomLevel: 18,
            landUse: ['Floresta'], imageType: 'landsat', useDynamicMaps: true,
            showTimeseries: false, visParams: ['landsat-tvi-false']
        } });
    }
    return { scope, timers, broadcasts, events };
}

for (const file of ['admin-temporal.js', 'admin-campaign-monitoring.js']) {
    test(file + ': ativa mapas visíveis sem depender da fila removida', () => {
        const c = controller(file);
        c.scope.mapStates = { 0: { visible: false }, 1: { visible: false } };
        c.scope.onMapVisible(0);
        assert.equal(c.scope.mapStates[0].visible, true);
        assert.equal(c.scope.mapStates[1].visible, false);
        c.scope.onMapVisible(0);
        c.scope.mapStates = {};
        assert.doesNotThrow(() => c.scope.onMapVisible(0));
        assert.equal(c.timers.length, 0);
    });
}

test('temporal administrativo renova visibilidade ao trocar o período', () => {
    const c = controller('admin-temporal.js');
    c.scope.point = { _id: 'p', bounds: [], dates: {} };
    c.scope.changePeriod();
    assert.equal(c.scope.period, 'WET');
    assert.equal(c.scope.maps.length, 2);
    c.scope.onMapVisible(0);
    c.scope.changePeriod();
    assert.equal(c.scope.period, 'DRY');
    assert.equal(c.scope.mapStates[0].visible, false);
    assert.ok(c.broadcasts.some(args => args[0] === 'resetLazyMaps'));
    assert.equal(c.timers.length, 0);
});
