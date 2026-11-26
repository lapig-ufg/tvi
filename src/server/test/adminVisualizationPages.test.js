'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const client = path.join(__dirname, '../../client');
const plain = value => JSON.parse(JSON.stringify(value));

function loadPages(http) {
    const pages = {};
    const file = path.join(client, 'services/admin-visualization-pages.js');
    if (fs.existsSync(file)) {
        vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
            Application: { run: fn => fn({ register: (id, page) => { pages[id] = page; } }, http) }
        });
    }
    return pages;
}

function loadList(confirmed = false, initialQuery = {}) {
    let controller;
    const lifecycle = {};
    const watchers = [];
    let query = plain(initialQuery);
    let currentPath = '/admin/visualization-params';
    const scope = { $watch: (name, callback) => watchers.push({ names: [name], callback }), $watchGroup: (names, callback) => watchers.push({ names, callback }), $on: (event, callback) => { lifecycle[event] = callback; } };
    const navigations = [];
    const writes = [];
    const reads = [];
    const notifications = [];
    vm.runInNewContext(fs.readFileSync(path.join(client, 'controllers/admin-vis-params.js'), 'utf8'), {
        Application: { controller: (name, fn) => { controller = fn; } },
        console
    });
    const dependencies = {
        $scope: scope,
        $http: { get: () => Promise.resolve({ data: { authenticated: true, user: { role: 'super-admin' } } }) },
        $location: { path(value) { if (value === undefined) return currentPath; currentPath = value; return this; }, search(value) { if (value !== undefined) query = plain(value); return value === undefined ? query : this; }, replace() { return this; } },
        requester: { _get: (...args) => reads.push(args), _delete: (...args) => writes.push(args), _post: (...args) => writes.push(args) },
        NotificationDialog: { show: (...args) => notifications.push(args), confirm: () => Promise.resolve(confirmed) },
        AdminPages: { go: (...args) => navigations.push(plain(args)) },
        $uibModal: { open: () => ({ result: Promise.resolve({ message: 'Importação' }) }) }
    };
    const names = controller.toString().match(/^function\s*\(([^)]*)\)/)[1].split(',').map(value => value.trim());
    controller(...names.map(name => dependencies[name]));
    return { scope, navigations, writes, reads, notifications,
        query: () => query,
        navigate: (target, params) => { currentPath = target; query = plain(params); },
        routeUpdate: value => { query = plain(value); lifecycle.$routeUpdate(); },
        digest: () => watchers.forEach(watcher => watcher.callback(watcher.names.map(name => scope[name]), [])),
        destroy: () => lifecycle.$destroy && lifecycle.$destroy() };
}

test('ações da listagem navegam com identificadores sem transportar o objeto do parâmetro', () => {
    const { scope, navigations } = loadList();
    const param = { name: 'vegetacao', display_name: 'Vegetação', private: 'contexto local' };
    scope.createParam();
    scope.editParam(param);
    scope.viewDetails(param);
    scope.cloneParam(param);
    scope.testParam(param);
    scope.importParams();
    scope.editLandsatCollections();
    scope.editSentinelCollections();
    scope.viewCollectionBands('COPERNICUS/S2');
    assert.deepEqual(navigations, [
        ['vis-param-create'], ['vis-param-edit', { name: 'vegetacao' }],
        ['vis-param-details', { name: 'vegetacao' }], ['vis-param-clone', { name: 'vegetacao' }],
        ['vis-param-test', { name: 'vegetacao' }], ['vis-param-import'],
        ['landsat-collections'], ['sentinel-collections'], ['collection-bands', { collectionName: 'COPERNICUS/S2' }]
    ]);
});

test('cancelar confirmação não exclui parâmetros nem inicializa coleções', async () => {
    const { scope, writes } = loadList(false);
    scope.deleteParam({ name: 'vegetacao', display_name: 'Vegetação' });
    scope.initializeSentinelCollections();
    await Promise.resolve();
    assert.equal(writes.length, 0);
});

test('confirmar exclusão e inicialização preserva as APIs', async () => {
    const { scope, writes } = loadList(true);
    scope.deleteParam({ name: 'teste/a', display_name: 'Teste' });
    scope.initializeSentinelCollections();
    await Promise.resolve();
    assert.deepEqual(writes.map(args => args[0]), [
        '../api/vis-params/teste%2Fa', '../api/vis-params/sentinel-collections/initialize'
    ]);
});

test('edição, detalhes e teste recuperam o parâmetro pelo nome em acesso direto', async () => {
    const requests = [];
    const pages = loadPages({ get: url => { requests.push(url); return Promise.resolve({ data: { name: 'teste/a', category: 'landsat' } }); } });
    for (const id of ['vis-param-edit', 'vis-param-details', 'vis-param-test']) {
        assert.ok(pages[id], 'Página registrada: ' + id);
        const locals = await pages[id].load({ name: 'teste/a' });
        assert.equal(locals.param.name, 'teste/a');
        assert.equal(pages[id].parent(), '/admin/visualization-params');
    }
    assert.deepEqual(requests, Array(3).fill('../api/vis-params/teste%2Fa'));
});

test('clonagem persiste depois de recarregar a página e propaga falhas', async () => {
    const writes = [];
    const pages = loadPages({
        get: () => Promise.resolve({ data: { data: { name: 'original/a' } } }),
        post: (...args) => { writes.push(plain(args)); return Promise.reject(new Error('Indisponível')); }
    });
    assert.ok(pages['vis-param-clone']);
    const page = pages['vis-param-clone'];
    const locals = await page.load({ name: 'original/a' });
    assert.equal(locals.originalParam.name, 'original/a');
    await assert.rejects(page.save('copia', locals, { name: 'original/a' }), /Indisponível/);
    assert.deepEqual(writes, [['../api/vis-params/clone/original%2Fa?new_name=copia', {}]]);
});

test('coleções e bandas respeitam o documento retornado pelo Tiles em acesso direto', async () => {
    const requests = [];
    const mapping = { satellite: 'Landsat 5', start_year: 1985, end_year: 2011, collection: 'LANDSAT/LT05/C02/T1_L2' };
    const bands = { B4: { name: 'Red', resolution: '10m' } };
    const sentinel = { collections: [{ name: 'COPERNICUS/S2', bands }] };
    const pages = loadPages({ get: url => {
        requests.push(url);
        return Promise.resolve({ data: { data: url.endsWith('/landsat-collections') ? { _id: 'landsat_collections', mappings: [mapping] } : sentinel } });
    } });
    const locals = await pages['landsat-collections'].load({});
    assert.deepEqual(plain(locals), { collections: [mapping] });
    const form = loadForm('AdminLandsatCollectionsController', locals);
    form.scope.save();
    assert.deepEqual(plain(form.requests[0][1]), [mapping]);
    assert.deepEqual(plain(await pages['sentinel-collections'].load({})), { collections: sentinel });
    assert.deepEqual(plain(await pages['collection-bands'].load({ collectionName: 'COPERNICUS/S2' })), { collectionName: 'COPERNICUS/S2', bands });
    assert.deepEqual(requests, ['../api/vis-params/landsat-collections', '../api/vis-params/sentinel-collections', '../api/vis-params/sentinel-collections']);
    await assert.rejects(pages['collection-bands'].load({ collectionName: 'inexistente' }), /Coleção não encontrada/);
});

test('listagem extrai os mapeamentos Landsat e conta bandas sem globais no template', () => {
    const { scope, reads } = loadList();
    scope.loadCollections();
    const mapping = { satellite: 'Landsat 8', start_year: 2013, end_year: 2026, collection: 'LANDSAT/LC08/C02/T1_L2' };
    reads.find(args => args[0].endsWith('/landsat-collections'))[2]({ data: { _id: 'landsat_collections', mappings: [mapping] } });
    assert.deepEqual(plain(scope.landsatCollections), [mapping]);
    assert.equal(scope.bandCount({ B1: {}, B2: {} }), 2);
    assert.equal(scope.bandCount(null), 0);
    const form = loadForm('AdminCollectionBandsController', { collectionName: 'COPERNICUS/S2', bands: { B4: {} } });
    assert.equal(form.scope.bandCount, 1);
});

test('rotas específicas de coleções precedem os parâmetros dinâmicos e mantêm autenticação', () => {
    const routes = [];
    const handlers = new Proxy({}, { get: (_, name) => name });
    const auth = () => {};
    const app = { controllers: { visParams: handlers }, middleware: { auth: { cacheApiAuth: { requireCacheApiAuth: auth } } } };
    for (const method of ['get', 'post', 'put', 'delete', 'patch']) app[method] = (route, guard, handler) => routes.push({ method, route, guard, handler });
    require('../routes/visParamsApi')(app);
    for (const method of ['get', 'put']) {
        for (const collection of ['landsat-collections', 'sentinel-collections']) {
            const specific = routes.findIndex(route => route.method === method && route.route === '/api/vis-params/' + collection);
            const dynamic = routes.findIndex(route => route.method === method && route.route === '/api/vis-params/:name');
            assert.ok(specific < dynamic, method + ' ' + collection + ' não pode ser capturada como nome');
            assert.equal(routes[specific].guard, auth);
        }
    }
});

function loadForm(name, locals = {}, globals = {}) {
    const controllers = {};
    const lifecycle = {};
    const scope = { $watch() {}, $on: (event, callback) => { lifecycle[event] = callback; }, $apply() {} };
    const requests = [];
    const closes = [];
    const notifications = [];
    const context = {
        Application: { controller: (id, fn) => { controllers[id] = fn; } },
        angular: { copy: plain },
        ...globals
    };
    for (const file of ['admin-vis-params-modals.js', 'admin-vis-params-modal-v2.js']) {
        vm.runInNewContext(fs.readFileSync(path.join(client, 'controllers', file), 'utf8'), context);
    }
    const dependencies = {
        $scope: scope,
        $uibModalInstance: { close: value => closes.push(value), dismiss: value => closes.push(value) },
        requester: { _put: (...args) => requests.push(args), _post: (...args) => requests.push(args) },
        NotificationDialog: { show: (...args) => notifications.push(args) },
        param: null, categories: ['landsat', 'sentinel2'], collections: [],
        ...locals
    };
    const controller = controllers[name];
    const names = controller.toString().match(/^function\s*\(([^)]*)\)/)[1].split(',').map(value => value.trim());
    controller(...names.map(id => dependencies[id]));
    return { scope, requests, closes, notifications, destroy: () => lifecycle.$destroy && lifecycle.$destroy() };
}

test('formulários de visualização não enviam gravações concorrentes', () => {
    for (const name of ['AdminVisParamModalV2Controller', 'AdminLandsatCollectionsController', 'AdminSentinelCollectionsController']) {
        const { scope, requests } = loadForm(name);
        if (scope.canProceed) {
            scope.param.name = 'vegetacao';
            scope.param.display_name = 'Vegetação';
        }
        scope.save();
        scope.save();
        assert.equal(requests.length, 1, name);
        requests[0][3]({ message: 'Falha' });
        scope.save();
        assert.equal(requests.length, 2, 'Falha permite nova tentativa: ' + name);
    }
});

test('importação descarta conteúdo anterior e interrompe leitura ao sair da página', () => {
    const readers = [];
    class FileReader {
        constructor() { this.readyState = 1; readers.push(this); }
        readAsText() {}
        abort() { this.aborted = true; }
    }
    const { scope, requests, destroy } = loadForm('AdminVisParamImportController', {}, { FileReader });
    scope.onFileSelect([{ name: 'primeiro.json' }]);
    readers[0].onload({ target: { result: '{"parameters":[]}' } });
    assert.ok(scope.importData.content);
    scope.onFileSelect([{ name: 'segundo.json' }]);
    scope.import();
    assert.equal(requests.length, 0, 'Não importa o conteúdo anterior durante outra leitura');
    destroy();
    assert.equal(readers[1].aborted, true);
});

test('respostas recebidas após sair do formulário não notificam nem retornam à listagem', () => {
    for (const name of ['AdminVisParamModalV2Controller', 'AdminLandsatCollectionsController', 'AdminSentinelCollectionsController', 'AdminVisParamImportController']) {
        const { scope, requests, closes, notifications, destroy } = loadForm(name);
        if (scope.canProceed) {
            scope.param.name = 'vegetacao';
            scope.param.display_name = 'Vegetação';
        }
        if (scope.importData) {
            scope.importData.content = { parameters: [] };
            scope.import();
        } else scope.save();
        destroy();
        requests[0][2]({});
        requests[0][3]({ message: 'Falha' });
        assert.equal(closes.length, 0, name);
        assert.equal(notifications.length, 0, name);
    }
});

test('acesso direto a páginas que exigem identificador não consulta um recurso indefinido', () => {
    const requests = [];
    const pages = loadPages({ get: url => { requests.push(url); return Promise.resolve({ data: {} }); } });
    for (const id of ['vis-param-edit', 'vis-param-details', 'vis-param-clone', 'vis-param-test', 'collection-bands']) {
        assert.throws(() => pages[id].load({}), /Identificador obrigatório/);
        assert.throws(() => pages[id].load({ name: ['a', 'b'], collectionName: ['a', 'b'] }), /Identificador obrigatório/);
    }
    assert.deepEqual(requests, []);
});

test('formulário aberto diretamente preserva criação, edição e cancelamento', async () => {
    const pages = loadPages({ get: () => Promise.resolve({ data: { name: 'existente', display_name: 'Existente', category: 'landsat', vis_params: { bands: [], min: [], max: [], gamma: [] }, tags: [] } }) });
    for (const id of ['vis-param-create', 'vis-param-edit']) {
        assert.ok(pages[id]);
        const locals = await pages[id].load({ name: 'existente' });
        const { scope, requests, closes } = loadForm(pages[id].controller, locals);
        scope.param.name = id === 'vis-param-create' ? 'novo' : 'existente';
        scope.param.display_name = 'Visualização';
        scope.save();
        assert.equal(requests[0][0], id === 'vis-param-create' ? '../api/vis-params' : '../api/vis-params/existente');
        assert.equal(requests[0][1].name, scope.param.name);
        requests[0][2]({ saved: true });
        assert.deepEqual(plain(closes), [{ saved: true }]);
        const cancelled = loadForm(pages[id].controller, locals);
        cancelled.scope.cancel();
        assert.deepEqual(cancelled.closes, ['cancel']);
        assert.equal(cancelled.requests.length, 0);
    }
});


test('saída da listagem impede consultas e notificações tardias', async () => {
    const authentication = loadList();
    authentication.destroy();
    await Promise.resolve();
    assert.equal(authentication.reads.length, 0);

    const list = loadList();
    await Promise.resolve();
    assert.equal(list.reads.length, 1);
    list.destroy();
    list.reads[0][3]({ message: 'Falha tardia' });
    assert.equal(list.notifications.length, 0);
});


test('recarregar a listagem restaura aba, filtros e página sem aceitar parâmetros desconhecidos', async () => {
    const list = loadList(false, { tab: 'collections', category: 'sentinel2', search: 'Vegetação', active: 'true', page: '2', token: 'descartar', record: { private: true } });
    assert.equal(list.scope.activeTab, 'collections');
    assert.equal(list.scope.selectedCategory, 'sentinel2');
    assert.equal(list.scope.searchText, 'Vegetação');
    assert.equal(list.scope.showOnlyActive, true);
    assert.equal(list.scope.currentPage, 2);
    assert.deepEqual(list.query(), { tab: 'collections', category: 'sentinel2', search: 'Vegetação', active: 'true', page: '2' });
    await Promise.resolve();
    assert.ok(list.reads.some(args => args[0] === '../api/vis-params/landsat-collections'));
    const request = list.reads.find(args => args[0] === '../api/vis-params');
    assert.deepEqual(plain(request[1]), { category: 'sentinel2', active: true });
    request[2](Array.from({ length: 21 }, (_, index) => ({ name: 'p' + index, display_name: 'Vegetação ' + index })));
    assert.equal(list.scope.paginatedParams[0].name, 'p10');
});

test('trocar filtros reinicia paginação e atualiza somente campos permitidos na URL', async () => {
    const list = loadList(false, { page: '3' });
    await Promise.resolve();
    list.scope.selectedCategory = 'landsat';
    list.scope.searchText = 'verde';
    list.scope.showOnlyActive = true;
    list.digest();
    assert.equal(list.scope.currentPage, 1);
    assert.deepEqual(list.query(), { category: 'landsat', search: 'verde', active: 'true' });
    list.scope.setActiveTab('collections');
    assert.equal(list.query().tab, 'collections');
});

test('Voltar do navegador restaura filtros e página sem nova redefinição na digestão', async () => {
    const list = loadList();
    await Promise.resolve();
    list.routeUpdate({ category: 'sentinel2', search: 'vegetacao', page: '2' });
    list.digest();
    assert.equal(list.scope.currentPage, 2);
    assert.equal(list.scope.selectedCategory, 'sentinel2');
    assert.equal(list.scope.searchText, 'vegetacao');
    assert.equal(list.query().page, '2');
});

test('query inválida recebe valores padrão e uma página fora do resultado é limitada', async () => {
    const invalid = loadList(false, { tab: ['collections'], category: 'outro', search: ['a'], active: 'yes', page: '2.5' });
    assert.deepEqual(invalid.query(), {});
    assert.equal(invalid.scope.currentPage, 1);
    const list = loadList(false, { page: '999' });
    await Promise.resolve();
    list.reads[0][2]([{ name: 'unico', display_name: 'Único' }]);
    assert.equal(list.scope.currentPage, 1);
    assert.equal(list.scope.paginatedParams[0].name, 'unico');
    assert.deepEqual(list.query(), {});
});

test('evento da própria atualização da URL não limita a página usando resultado de filtro anterior', async () => {
    const list = loadList();
    await Promise.resolve();
    list.reads[0][2]([{ name: 'unico', display_name: 'Único' }]);
    list.routeUpdate({ category: 'sentinel2', page: '2' });
    list.routeUpdate({ category: 'sentinel2', page: '2' });
    assert.equal(list.scope.currentPage, 2);
    assert.equal(list.reads.length, 2);
});

test('link da listagem preserva o retorno de visualizações sem apontar para outra seção', () => {
    const pages = loadPages({});
    assert.equal(pages['landsat-collections'].parent({ returnTo: '/admin/visualization-params?tab=collections&page=2' }), '/admin/visualization-params?tab=collections&page=2');
    assert.equal(pages['landsat-collections'].parent({ returnTo: '/admin/page/other' }), '/admin/visualization-params');
});

test('resposta de um filtro anterior não sobrescreve a consulta atual', async () => {
    const list = loadList();
    await Promise.resolve();
    list.scope.selectedCategory = 'sentinel2';
    list.digest();
    list.reads[1][2]([{ name: 'sentinel', display_name: 'Sentinel' }]);
    list.reads[0][2]([{ name: 'landsat', display_name: 'Landsat' }]);
    assert.equal(list.scope.visParams[0].name, 'sentinel');
});


test('resposta durante resolve da página seguinte não sobrescreve seus identificadores na URL', async () => {
    const list = loadList();
    await Promise.resolve();
    list.navigate('/admin/page/vis-param-edit', { name: 'vegetacao', returnTo: '/admin/visualization-params' });
    list.reads[0][2]([{ name: 'vegetacao', display_name: 'Vegetação' }]);
    list.reads[0][3]({ message: 'Falha tardia' });
    assert.deepEqual(list.query(), { name: 'vegetacao', returnTo: '/admin/visualization-params' });
    assert.equal(list.notifications.length, 0);
});

test('contratos editáveis detectam alterações por botões e ignoram navegação do assistente', () => {
    const pages = loadPages({});
    const page = pages['vis-param-create'];
    assert.equal(typeof page.editState, 'function');
    const form = loadForm(page.controller);
    const original = plain(page.editState(form.scope));
    form.scope.currentStep = 2;
    form.scope.selectedSatellite = 'LT05';
    assert.deepEqual(plain(page.editState(form.scope)), original);
    form.scope.addSuggestedTag('vegetation');
    assert.notDeepEqual(plain(page.editState(form.scope)), original);
    const collections = pages['landsat-collections'];
    const collectionForm = loadForm(collections.controller, { collections: [{ collection: 'LANDSAT/LT05' }] });
    assert.equal(typeof collections.editState, 'function');
    const before = plain(collections.editState(collectionForm.scope));
    collectionForm.scope.removeCollection(0);
    assert.notDeepEqual(plain(collections.editState(collectionForm.scope)), before);
});

test('contratos das páginas expõem persistência pendente antes do callback de conclusão', () => {
    const pages = loadPages({});
    for (const id of ['vis-param-create', 'vis-param-edit', 'vis-param-import', 'landsat-collections', 'sentinel-collections']) {
        const page = pages[id];
        assert.equal(typeof page.pending, 'function', id);
        assert.equal(typeof page.editState, 'function', id);
        const form = loadForm(page.controller);
        if (form.scope.param) {
            form.scope.param.name = 'vegetacao';
            form.scope.param.display_name = 'Vegetação';
        }
        assert.equal(page.pending(form.scope), false);
        if (form.scope.importData) {
            form.scope.importData.content = { parameters: [] };
            form.scope.import();
        } else form.scope.save();
        assert.equal(page.pending(form.scope), true, id);
        form.requests[0][3]({ message: 'Falha' });
        assert.equal(page.pending(form.scope), false, id);
    }
});

test('clonagem, importação e Sentinel expõem somente modelos persistidos', () => {
    const pages = loadPages({});
    for (const id of ['vis-param-clone', 'vis-param-import', 'sentinel-collections']) assert.equal(typeof pages[id].editState, 'function', id);
    assert.deepEqual(plain(pages['vis-param-clone'].editState({ newName: 'copia', loading: true })), 'copia');
    assert.deepEqual(plain(pages['vis-param-import'].editState({ importData: { content: { parameters: [] }, overwrite: true, file: 'arquivo local' } })), { content: { parameters: [] }, overwrite: true });
    assert.deepEqual(plain(pages['sentinel-collections'].editState({ data: { default_collection: 'S2' }, loading: true })), { default_collection: 'S2' });
});
