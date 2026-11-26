'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function controller(file) {
    let factory;
    const events = {}, reads = [], writes = [], questions = [], notices = [];
    const scope = { $root: {}, $on(name, fn) { events[name] = fn; }, $watch() {}, $watchGroup() {}, $broadcast() {} };
    const http = {
        get(url) { return { then(fn) { reads.push({ url, fn }); return { catch() {} }; } }; },
        post(url, data) { return new Promise((resolve, reject) => { writes.push({ url, data, resolve, reject }); }); },
        delete(url, data) { return http.post(url, data); }
    };
    const requester = {
        _get(url, success) { if (url.includes('removeInspections')) writes.push({ url, resolve: success }); },
        _delete(url, success, error) { writes.push({ url, resolve: success, reject: error }); },
        _post(url, data, success, error) { writes.push({ url, data, resolve: success, reject: error }); }
    };
    const location = { path: () => '/admin/visualization-params', search(value) { return value ? location : { campaignId: 'campanha', pointId: 'A' }; }, replace() { return location; } };
    const deps = {
        $scope: scope, $rootScope: scope.$root, $http: http, requester,
        $routeParams: { id: 'campanha' }, $location: location, $uibModal: {},
        NotificationDialog: {
            confirm(message) { return new Promise(resolve => questions.push({ message, resolve })); },
            success(message) { notices.push(message); }, error(message) { notices.push(message); }, show(message) { notices.push(message); }
        },
        $interval() {}, $timeout() {}, $window: { addEventListener() {}, removeEventListener() {} },
        fakeRequester: {}, util: {}, AdminPages: {},
        i18nService: { translate: (key, values) => key + JSON.stringify(values) },
        $injector: { has: () => false }, sampleMarkerService: { core: { normalize: () => ({}) } }
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../client/controllers', file), 'utf8'), {
        Application: { controller(name, fn) { factory = fn; } }, angular: { copy: value => structuredClone(value) },
        localStorage: { getItem() {}, setItem() {} }, console, location: { host: 'example.test' }
    });
    const names = factory.toString().match(/^function\s*\(([^)]*)\)/)[1].split(',').map(name => name.trim());
    factory(...names.map(name => deps[name]));
    if (file === 'admin-temporal.js') reads.find(read => read.url === '/api/campaigns/campanha').fn({ data: {
        _id: 'campanha', initialYear: 2020, finalYear: 2021, landUse: ['Floresta'], imageType: 'landsat', visParams: []
    } });
    writes.length = 0;
    return { scope, writes, questions, notices, reads, destroy() { if (events.$destroy) events.$destroy(); } };
}

const tick = () => new Promise(resolve => setImmediate(resolve));

test('geração usa os valores apresentados e não duplica pergunta nem operação', async () => {
    const c = controller('admin-blocks.js');
    c.scope.generateBlocks();
    c.scope.generateBlocks();
    assert.equal(c.questions.length, 1);
    assert.match(c.questions[0].message, /tamanho 5/);
    c.scope.generateForm.blockSize = 100;
    c.scope.generateForm.timeoutMinutes = 10;
    c.questions[0].resolve(true);
    await tick();
    assert.equal(c.writes.length, 1);
    assert.equal(c.writes[0].data.blockSize, 5);
    assert.equal(c.writes[0].data.timeoutMinutes, 480);
    c.scope.generateBlocks();
    assert.equal(c.questions.length, 1);
    c.writes[0].reject({ data: { error: 'Indisponível' } });
    await tick();
    c.scope.generateBlocks();
    assert.equal(c.questions.length, 2);
});

test('descarte preserva bloco e rodada confirmados', async () => {
    const c = controller('admin-blocks.js');
    const block = { blockIndex: 3, inspectionRound: 2, assignedTo: 'ana' };
    c.scope.discardBlock(block);
    block.blockIndex = 99;
    block.inspectionRound = 4;
    c.questions[0].resolve(true);
    await tick();
    assert.equal(c.writes[0].url, '/api/campaigns/campanha/blocks/3/discard');
    assert.equal(c.writes[0].data.inspectionRound, 2);
});

for (const operation of ['generateBlocks', 'releaseExpired', 'deleteAllBlocks']) {
    test(operation + ' não grava depois de cancelar ou destruir a página', async () => {
        const c = controller('admin-blocks.js');
        c.scope[operation]();
        c.questions[0].resolve(false);
        await tick();
        assert.equal(c.writes.length, 0);
        c.scope[operation]();
        c.destroy();
        c.questions[1].resolve(true);
        await tick();
        assert.equal(c.writes.length, 0);
    });
}

test('resposta tardia de blocos não notifica nem recarrega a página anterior', async () => {
    const c = controller('admin-blocks.js');
    c.scope.releaseExpired();
    c.questions[0].resolve(true);
    await tick();
    const count = c.reads.length;
    c.destroy();
    c.writes[0].resolve({ data: { releasedCount: 2 } });
    await tick();
    assert.equal(c.notices.length, 0);
    assert.equal(c.reads.length, count);
});

test('remoção temporal mantém o ponto confirmado após navegar para outro ponto', async () => {
    const c = controller('admin-temporal.js');
    c.scope.point = { _id: 'A/1', index: 1 };
    let navigations = 0;
    c.scope.submit = () => { navigations++; };
    c.scope.removeInspections();
    c.scope.removeInspections();
    assert.equal(c.questions.length, 1);
    c.scope.point = { _id: 'B', index: 2 };
    c.questions[0].resolve(true);
    await tick();
    assert.equal(c.writes[0].url, 'admin/campaign/removeInspections?pointId=A%2F1');
    c.writes[0].resolve(true);
    assert.equal(navigations, 0);
});

test('remoção temporal não grava nem notifica após destruir a página', async () => {
    const c = controller('admin-temporal.js');
    c.scope.point = { _id: 'A', index: 1 };
    c.scope.removeInspections();
    c.destroy();
    c.questions[0].resolve(true);
    await tick();
    assert.equal(c.writes.length, 0);
    assert.equal(c.notices.length, 0);
});

test('exclusão de parâmetro preserva nome aprovado e bloqueia confirmação duplicada', async () => {
    const c = controller('admin-vis-params.js');
    const param = { name: 'original', display_name: 'Original' };
    c.scope.deleteParam(param);
    c.scope.deleteParam(param);
    assert.equal(c.questions.length, 1);
    param.name = 'outro';
    c.questions[0].resolve(true);
    await tick();
    assert.equal(c.writes[0].url, '../api/vis-params/original');
});

test('inicialização de coleções bloqueia repetição e permite nova tentativa após cancelar', async () => {
    const c = controller('admin-vis-params.js');
    c.scope.initializeSentinelCollections();
    c.scope.initializeSentinelCollections();
    assert.equal(c.questions.length, 1);
    c.questions[0].resolve(false);
    await tick();
    c.scope.initializeSentinelCollections();
    assert.equal(c.questions.length, 2);
});

test('consulta de blocos concluída após saída não modifica a listagem descartada', () => {
    const c = controller('admin-blocks.js');
    c.scope.loadBlocks();
    const request = c.reads[c.reads.length - 1];
    c.destroy();
    request.fn({ data: { blocks: [{ blockIndex: 9 }], pagination: { totalBlocks: 1 } } });
    assert.equal(c.scope.blocks.length, 0);
});
