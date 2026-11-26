'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const client = path.join(__dirname, '../../client');

function harness() {
    let Constructor;
    const registrations = { service(name, controller) { if (name === 'requester') Constructor = controller; return registrations; } };
    vm.runInNewContext(fs.readFileSync(path.join(client, 'others/services.js'), 'utf8'), { Application: registrations });
    const requests = [];
    const http = {};
    for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
        http[method] = function(url, body, config) {
            if (url === '/api/admin/check') return Promise.resolve({ data: { authenticated: true, user: { role: 'super-admin' } } });
            const request = { method, url, body, config };
            requests.push(request);
            return { success(callback) { request.success = callback; return this; }, error(callback) { request.error = callback; return this; } };
        };
    }
    return { requester: new Constructor(http), requests, http };
}

for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
    test(method + ': callback explícito recebe erro e não executa sucesso', () => {
        const { requester, requests } = harness();
        let received, successes = 0;
        requester['_' + method]('../api/vis-params/example', {}, () => { successes++; }, error => { received = error; });
        const failure = { error: 'HTTP 401' };
        requests[0].error(failure);
        assert.equal(received, failure);
        assert.equal(successes, 0);
        assert.equal(requests[0].url, 'service/../api/vis-params/example');
    });

    test(method + ': variante sem parâmetros preserva callback de erro', () => {
        const { requester, requests } = harness();
        let received;
        requester['_' + method]('example', () => {}, error => { received = error; });
        const failure = { error: 'HTTP 500' };
        requests[0].error(failure);
        assert.equal(received, failure);
    });

    test(method + ': consumidores legados mantêm callback.error e sucesso', () => {
        const { requester, requests } = harness();
        let received, success;
        const callback = value => { success = value; };
        callback.error = function(error) { assert.equal(this, callback); received = error; };
        requester['_' + method]('example', callback);
        const failure = { error: 'HTTP 500' };
        requests[0].error(failure);
        assert.equal(received, failure);
        const result = { success: true };
        requests[0].success(result);
        assert.equal(success, result);
        requester['_' + method]('example', () => {});
        assert.doesNotThrow(() => requests[1].error(failure));
    });
}

function instantiate(file, name, dependencies) {
    let controller;
    vm.runInNewContext(fs.readFileSync(path.join(client, 'controllers', file), 'utf8'), {
        Application: { controller(id, callback) { if (name === id) controller = callback; } },
        angular: { copy: value => JSON.parse(JSON.stringify(value)) }, console
    });
    const names = controller.toString().match(/^function\s*\(([^)]*)\)/)[1].split(',').map(value => value.trim());
    controller(...names.map(id => dependencies[id]));
}

function scope() { return { $watch() {}, $watchGroup() {}, $on() {}, paramForm: { $invalid: false } }; }

for (const failedCollection of ['landsat', 'sentinel']) {
    test('falha HTTP em ' + failedCollection + ' encerra o carregamento e mostra a mensagem', async () => {
        const context = harness();
        const view = scope(), notices = [];
        const location = { path: () => '/admin/visualization-params', search(value) { return value === undefined ? {} : this; }, replace() { return this; } };
        instantiate('admin-vis-params.js', 'AdminVisParamsController', {
            $scope: view, $http: context.http, $location: location, requester: context.requester,
            NotificationDialog: { show: (...args) => notices.push(args) }, AdminPages: {}
        });
        await Promise.resolve();
        view.setActiveTab('collections');
        let request = context.requests.find(item => item.url.endsWith('landsat-collections'));
        if (failedCollection === 'sentinel') {
            request.success([]);
            request = context.requests.find(item => item.url.endsWith('sentinel-collections'));
        }
        request.error({ error: 'HTTP 401' });
        assert.equal(view.loading.collections, false);
        assert.equal(notices.length, 1);
        assert.equal(notices[0][1], 'error');
    });
}

for (const controller of ['AdminVisParamModalV2Controller', 'AdminVisParamModalController', 'AdminLandsatCollectionsController', 'AdminSentinelCollectionsController', 'AdminVisParamImportController']) {
    test(controller + ': usa requester real e libera nova tentativa após falha HTTP', () => {
        const context = harness(), view = scope(), notices = [];
        instantiate(controller === 'AdminVisParamModalV2Controller' ? 'admin-vis-params-modal-v2.js' : 'admin-vis-params-modals.js', controller, {
            $scope: view, requester: context.requester, $uibModalInstance: { close() {}, dismiss() {} },
            NotificationDialog: { show: (...args) => notices.push(args) }, param: null,
            categories: ['landsat', 'sentinel2'], collections: []
        });
        if (view.param) { view.param.name = 'novo'; view.param.display_name = 'Novo'; }
        const action = view.importData ? view.import : view.save;
        if (view.importData) view.importData.content = { vis_params: [] };
        action();
        assert.ok(context.requests[0].url.startsWith('service/../api/vis-params'));
        context.requests[0].error({ message: 'HTTP 500' });
        assert.equal(view.loading, false);
        assert.equal(notices.length, 1);
        action();
        assert.equal(context.requests.length, 2);
    });
}
