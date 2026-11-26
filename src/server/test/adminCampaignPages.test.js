'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const client = path.resolve(__dirname, '../../client');

function registry(http) {
    const pages = {};
    vm.runInNewContext(fs.readFileSync(path.join(client, 'services/admin-campaign-pages.js'), 'utf8'), {
        Application: { run: function(register) {
            register({ register: (id, page) => { pages[id] = page; } }, http,
                { core: { defaults: () => ({ enabled: true }) } });
        } },
        angular: { copy: value => structuredClone(value) }
    });
    return pages;
}

test('criação de campanha oferece valores independentes e persiste pelo endpoint existente', async () => {
    const requests = [];
    const pages = registry({ post: async (url, body) => {
        requests.push({ url, body });
        return { data: { success: true } };
    } });
    const page = pages['campaign-create'];
    const first = await page.load({});
    first.campaign.landUse.push('Floresta');
    assert.deepEqual(Array.from((await page.load({})).campaign.landUse), []);
    assert.equal(first.isNew, true);
    assert.equal(first.campaign.autoLoadTimeseries, true);
    await page.save(first.campaign, first, {});
    assert.equal(requests[0].url, '/api/campaigns');
    assert.equal(requests[0].body, first.campaign);
});

test('edição recarrega campanha pelo identificador e salva no mesmo recurso', async () => {
    const requests = [];
    const campaign = { _id: 'campanha/a', password: 'restrita', landUse: [] };
    const pages = registry({
        get: async url => { requests.push(url); return { data: campaign }; },
        put: async (url, body) => { requests.push({ url, body }); return { data: { success: true } }; }
    });
    const page = pages['campaign-edit'];
    const locals = await page.load({ campaignId: campaign._id });
    assert.equal(requests[0], '/api/campaigns/campanha%2Fa');
    assert.equal(locals.campaign, campaign);
    assert.equal(locals.isNew, false);
    await page.save(campaign, locals, { campaignId: campaign._id });
    assert.equal(requests[1].url, '/api/campaigns/campanha%2Fa');
});

test('falha de negócio e falha HTTP na gravação não encerram a página como sucesso', async () => {
    const page = registry({ post: async () => ({ data: { success: false, error: 'Campanha duplicada' } }) })['campaign-create'];
    await assert.rejects(page.save({}), /Campanha duplicada/);
    const error = new Error('Falha de conexão');
    const failed = registry({ post: async () => { throw error; } })['campaign-create'];
    await assert.rejects(failed.save({}), error);
});

test('detalhes, inspeções e dúvidas recarregam o ponto exato sem ampliar a busca', async () => {
    for (const id of ['point-details', 'point-inspections', 'point-doubt']) {
        const calls = [];
        const point = { _id: 'p.1[2]', campaign: 'c', inspection: [{ form: [] }] };
        const page = registry({ get: async (url, options) => {
            calls.push({ url, options });
            return { data: options ? { points: [point] } : { _id: 'c' } };
        } })[id];
        const locals = await page.load({ campaignId: 'c', pointId: point._id });
        assert.equal(locals.point, point);
        assert.equal(locals.mode, 'admin');
        assert.equal(calls[1].options.params.pointId, '^p\\.1\\[2\\]$');
        assert.equal(calls[1].options.params.includeInspections, true);
        assert.match(page.parent({ campaignId: 'c' }), /campaign-points.*campaignId=c/);
    }
});

test('ponto ausente ou de outra campanha impede a abertura', async () => {
    for (const points of [[], [{ _id: 'p', campaign: 'outra' }], [{ _id: 'prefixop', campaign: 'c' }]]) {
        const page = registry({ get: async (url, options) => ({ data: options ? { points } : { _id: 'c' } }) })['point-details'];
        await assert.rejects(page.load({ campaignId: 'c', pointId: 'p' }), /Ponto não encontrado/);
    }
});

test('operações de campanha carregam contexto ao abrir diretamente pela URL', async () => {
    const campaign = { _id: 'c' };
    const pages = registry({ get: async () => ({ data: campaign }) });
    for (const id of ['campaign-upload', 'campaign-import', 'campaign-points', 'campaign-excess', 'campaign-zombies']) {
        const locals = await pages[id].load({ campaignId: 'c' });
        assert.equal(locals.campaign, campaign);
        assert.equal(locals.campaignId, 'c');
        assert.equal(pages[id].parent({ campaignId: 'c' }), '/admin/campaigns');
    }
});

function controller(file, name, extra, globals) {
    const controllers = {};
    const calls = [];
    const scope = { $root: {}, $on: () => {}, $watch: () => {} };
    const pending = { then: () => pending, catch: () => pending, finally: () => pending };
    let query = {};
    const locals = Object.assign({
        $scope: scope,
        $http: { get: () => pending },
        $routeParams: { id: 'c' },
        $location: { path: () => '/admin/campaigns', search: (key, value) => {
            if (key === undefined) return query;
            if (typeof key === 'object') query = key;
            else query[key] = value;
        } },
        $interval: Object.assign(() => {}, { cancel: () => {} }),
        $timeout: Object.assign(() => {}, { cancel: () => {} }),
        $window: {}, NotificationDialog: {},
        AdminPages: { go: (id, params) => calls.push({ id, params }) },
        $uibModal: { open: () => { throw new Error('Overlay inesperado'); } },
        sampleMarkerService: { core: { defaults: () => ({}) } },
        campaign: { _id: 'c', numInspec: 3 },
        $uibModalInstance: {}
    }, extra);
    vm.runInNewContext(fs.readFileSync(path.join(client, file), 'utf8'), {
        Application: { controller: (id, fn) => { controllers[id] = fn; } },
        angular: { equals: (a, b) => JSON.stringify(a) === JSON.stringify(b), copy: value => structuredClone(value), forEach: (value, fn) => Object.keys(value).forEach(key => fn(value[key], key)) },
        console, window: {}, document: {},
        setTimeout: () => {}, clearTimeout: () => {}, clearInterval: () => {}, ...globals
    });
    const fn = controllers[name];
    const names = fn.toString().match(/^function\s*\(([^)]*)\)/)[1].split(',').map(x => x.trim());
    fn(...names.map(key => locals[key]));
    return { scope: locals.$scope, calls, query: () => query };
}

test('ações da listagem navegam por identificador e preservam filtros e página', () => {
    const { scope, calls, query } = controller('controllers/admin-campaign.js', 'AdminCampaignController');
    scope.filters.campaignId = 'Campanha teste';
    scope.pagination.currentPage = 4;
    const campaign = { _id: 'c', password: 'segredo' };
    for (const action of ['createCampaign', 'editCampaign', 'uploadGeoJSON', 'importClassifications', 'viewPoints', 'manageExcessInspections', 'manageZombies']) {
        scope[action](campaign);
    }
    assert.deepEqual(calls.map(call => call.id), ['campaign-create', 'campaign-edit', 'campaign-upload', 'campaign-import', 'campaign-points', 'campaign-excess', 'campaign-zombies']);
    assert.equal(JSON.stringify(calls).includes('segredo'), false);
    assert.equal(query().f_campaignId, 'Campanha teste');
    assert.equal(query().page, 4);
});

test('ações de pontos navegam sem transportar inspeções e preservam contexto da lista', () => {
    const { scope, calls, query } = controller('controllers/admin-modals.js', 'AdminCampaignPointsModalController');
    scope.filters.user = 'Analista';
    scope.currentPage = 3;
    const point = { _id: 'p', doubt: {}, inspection: [{ private: true }] };
    for (const action of ['viewPointDetails', 'editPointInspections', 'viewPoint', 'editPoint', 'openDoubtResolveModal']) scope[action](point);
    assert.deepEqual(calls.map(call => call.id), ['point-details', 'point-inspections', 'point-details', 'point-inspections', 'point-doubt']);
    for (const call of calls) assert.deepEqual(JSON.parse(JSON.stringify(call.params)), { campaignId: 'c', pointId: 'p' });
    assert.equal(query().f_user, 'Analista');
    assert.equal(query().page, 3);
});

test('gestão individual abre edição, classes, pontos e upload em páginas', () => {
    const { scope, calls } = controller('controllers/campaign-management.js', 'CampaignManagementController');
    scope.details = { campaign: { _id: 'c' } };
    for (const action of ['editCampaign', 'manageLandUse', 'viewPoints', 'uploadMorePoints']) scope[action]();
    assert.deepEqual(calls.map(call => call.id), ['campaign-edit', 'campaign-edit', 'campaign-points', 'campaign-upload']);
});

test('retorno restaura filtros, paginação e aba sem consumir parâmetros arbitrários', () => {
    const extra = { $location: { search: () => ({ f_user: 'Analista', f_minInspections: '2', page: '3', pageSize: '200', search: 'p-10', tab: 'inspectors', f_password: 'ignorar' }) } };
    const { scope } = controller('controllers/admin-modals.js', 'AdminCampaignPointsModalController', extra);
    assert.equal(scope.filters.user, 'Analista');
    assert.equal(scope.filters.minInspections, 2);
    assert.equal(scope.filters.password, undefined);
    assert.equal(scope.currentPage, 3);
    assert.equal(scope.pageSize, '200');
    assert.equal(scope.searchId, 'p-10');
    assert.equal(scope.activeTab, 'inspectors');
});

test('saída durante upload libera timer e ignora resposta tardia sem interromper envio', () => {
    let destroy, reader, rejected;
    const timers = new Set();
    let sent = 0;
    const { scope } = controller('controllers/admin-modals.js', 'AdminGeoJSONUploadModalController', {
        $scope: { $on: (event, fn) => { destroy = fn; }, $apply: fn => fn() },
        $http: { post: () => { sent++; return { then: (resolve, reject) => { rejected = reject; } }; } },
        $location: { path: () => { throw new Error('Redirecionamento de página destruída'); } }
    }, {
        FileReader: function() { reader = this; this.readAsText = () => {}; },
        setInterval: fn => { timers.add(fn); return fn; },
        clearInterval: fn => timers.delete(fn)
    });
    scope.file = { name: 'pontos.geojson' };
    scope.upload();
    reader.onload({ target: { result: '{}' } });
    assert.equal(sent, 1);
    assert.equal(timers.size, 1);
    destroy();
    assert.equal(timers.size, 0);
    rejected({ status: 401 });
    assert.equal(sent, 1);
});

test('saída antes da leitura do arquivo impede envio tardio e leitura pendente', () => {
    let destroy, reader, sent = 0, aborted = false;
    const { scope } = controller('controllers/admin-modals.js', 'AdminGeoJSONUploadModalController', {
        $scope: { $on: (event, fn) => { destroy = fn; }, $apply: fn => fn() },
        $http: { post: () => { sent++; } }
    }, {
        FileReader: function() {
            reader = this;
            this.readyState = 1;
            this.readAsText = () => {};
            this.abort = () => { aborted = true; };
        }
    });
    scope.file = { name: 'pontos.geojson' };
    scope.upload();
    destroy();
    if (reader.onload) reader.onload({ target: { result: '{}' } });
    assert.equal(aborted, true);
    assert.equal(sent, 0);
});

test('recuperação de pontos exige confirmação e impede envio duplicado', async () => {
    let answer;
    const sent = [];
    const { scope } = controller('controllers/admin-zombies-modal.js', 'AdminZombiesModalController', {
        NotificationDialog: { confirm: () => new Promise(resolve => { answer = resolve; }), error: () => {} },
        $http: { get: () => Promise.resolve({ data: { total: 3 } }), post: async url => { sent.push(url); return { data: {} }; } }
    });
    scope.report = { total: 3 };
    const first = scope.recoverZombies();
    scope.recoverZombies();
    answer(false);
    await first;
    assert.equal(sent.length, 0);
    const second = scope.recoverZombies();
    answer(true);
    await second;
    assert.deepEqual(sent, ['/api/admin/campaigns/c/recover-zombies']);
});

test('remoção de excesso só solicita token e aplica após confirmação explícita', async () => {
    let answer;
    const sent = [];
    const { scope } = controller('controllers/admin-excess-inspections-modal.js', 'AdminExcessInspectionsModalController', {
        NotificationDialog: { confirm: () => new Promise(resolve => { answer = resolve; }), error: () => {} },
        $http: { get: () => Promise.resolve({ data: { items: [], total: 0 } }), post: async (url, data) => {
            sent.push({ url, data }); return { data: { token: 'restrito' } };
        } }
    });
    scope.preview = { previewId: 'p1', totalRemovals: 3, totalAffected: 2 };
    scope.applyReason = 'Justificativa válida';
    const first = scope.applyChanges();
    answer(false);
    await first;
    assert.equal(sent.length, 0);
    const second = scope.applyChanges();
    scope.preview = { previewId: 'outro', totalAffected: 200 };
    answer(true);
    await second;
    assert.equal(sent[0].url, '/api/admin/destructive-token');
    assert.equal(sent[0].data.context.previewId, 'p1');
    assert.equal(sent[1].data.previewId, 'p1');
    assert.equal(sent[1].data.expectedCount, 2);
    assert.equal(sent[1].data.confirmationToken, 'restrito');
});

test('remoção por critério aplica somente a prévia confirmada e bloqueia confirmação duplicada', async () => {
    let answer;
    const calls = [];
    let confirmations = 0;
    const { scope } = controller('controllers/admin-modals.js', 'AdminCampaignPointsModalController', {
        NotificationDialog: { confirm: () => { confirmations++; return new Promise(resolve => { answer = resolve; }); }, success: () => {}, warning: () => {}, error: () => {} },
        $http: { get: () => new Promise(() => {}), post: async (url, body) => {
            calls.push(structuredClone(body));
            return { data: body.dryRun ? { pointsAffected: 1, inspectionsAffected: 2 } : { removedCount: 2, pointsAffected: 1 } };
        } }
    });
    scope.removalCriteria = { type: 'by_user', user: 'Ana' };
    await scope.previewRemoval();
    scope.removalReason = 'Motivo confirmado';
    const pending = scope.confirmRemoval();
    scope.confirmRemoval();
    scope.removalCriteria.user = 'Bruno';
    scope.removalReason = 'Outro motivo';
    answer(true);
    await pending;
    assert.equal(confirmations, 1);
    assert.deepEqual(calls[1], { criteria: { type: 'by_user', user: 'Ana' }, reason: 'Motivo confirmado' });
});

test('remoção em lote preserva seleção aprovada e não envia após destruir página', async () => {
    for (const leave of [false, true]) {
        const destroyed = [];
        let answer, reason;
        const sent = [];
        const { scope } = controller('controllers/admin-modals.js', 'AdminCampaignPointsModalController', {
            $scope: { $on: (event, fn) => destroyed.push(fn) },
            NotificationDialog: { confirm: () => new Promise(resolve => { answer = resolve; }), prompt: () => new Promise(resolve => { reason = resolve; }), success: () => {}, warning: () => {}, error: () => {} },
            $http: { get: () => new Promise(() => {}), post: async (url, body) => { sent.push(structuredClone(body)); return { data: { success: true } }; } }
        });
        scope.selectedPoints = [{ _id: 'p1' }];
        const pending = scope.bulkRemoveInspections();
        scope.selectedPoints = [{ _id: 'p2' }];
        answer(true);
        await Promise.resolve();
        if (leave) destroyed.forEach(fn => fn());
        reason('Motivo confirmado');
        await pending;
        assert.deepEqual(sent, leave ? [] : [{ pointIds: ['p1'], reason: 'Motivo confirmado' }]);
    }
});

function campaignForm(extra) {
    return controller('controllers/admin-modals.js', 'CampaignFormModalController', Object.assign({
        isNew: false,
        campaign: { _id: 'c', landUse: [] },
        sampleMarkerService: { core: require('../../client/services/sample-marker-core') }
    }, extra), {
        PointPropertyDisplayCore: require('../../client/services/point-property-display-core'),
        LandUseImportCore: require('../../client/services/land-use-import-core')
    });
}

test('adicionar classe usa prompt da página e ignora confirmação após saída', async () => {
    let answer, destroy;
    let opened = 0;
    const { scope } = campaignForm({
        $scope: { $on: (event, fn) => { destroy = fn; } },
        NotificationDialog: { prompt: () => { opened++; return new Promise(resolve => { answer = resolve; }); } }
    });
    const pending = scope.addLandUse();
    scope.addLandUse();
    answer(' Floresta ');
    await pending;
    assert.deepEqual(Array.from(scope.campaign.landUse), ['Floresta']);
    assert.equal(opened, 1);
    const leaving = scope.addLandUse();
    destroy();
    answer('Pastagem');
    await leaving;
    assert.deepEqual(Array.from(scope.campaign.landUse), ['Floresta']);
});

test('importação de classes aplica a origem capturada antes da confirmação', async () => {
    let answer;
    const { scope } = campaignForm({
        campaign: { _id: 'c', landUse: ['Atual'] },
        NotificationDialog: { confirm: () => new Promise(resolve => { answer = resolve; }) }
    });
    scope.landUseImport.selected = { id: 'origem', count: 1, landUse: ['Floresta'] };
    const pending = scope.confirmLandUseImport();
    scope.landUseImport.selected.landUse[0] = 'Pastagem';
    answer(true);
    await pending;
    assert.deepEqual(Array.from(scope.campaign.landUse), ['Floresta']);
});

test('exclusão de campanha captura identificador, bloqueia duplicidade e não envia depois de sair', async () => {
    for (const leave of [false, true]) {
        let answer;
        const handlers = [];
        const sent = [];
        let confirmations = 0;
        const { scope } = controller('controllers/admin-campaign.js', 'AdminCampaignController', {
            $scope: { $root: {}, $on: (event, fn) => handlers.push(fn) },
            NotificationDialog: { confirm: () => { confirmations++; return new Promise(resolve => { answer = resolve; }); }, success: () => {} },
            $http: { get: () => new Promise(() => {}), delete: async url => { sent.push(url); return { data: { success: true } }; } }
        });
        const campaign = { _id: 'original' };
        const pending = scope.deleteCampaign(campaign);
        scope.deleteCampaign(campaign);
        campaign._id = 'outra';
        if (leave) handlers.forEach(fn => fn());
        answer(true);
        await pending;
        assert.equal(confirmations, 1);
        assert.deepEqual(sent, leave ? [] : ['/api/campaigns/original']);
    }
});

test('remoção local mantém a inspeção confirmada mesmo quando a posição muda', async () => {
    let answer;
    const { scope } = controller('controllers/admin-modals.js', 'PointInspectionsEditModalController', {
        point: { inspection: [], userName: [] },
        NotificationDialog: { confirm: () => new Promise(resolve => { answer = resolve; }) }
    });
    const first = { user: 'Ana' }, second = { user: 'Bruno' }, third = { user: 'Carlos' };
    scope.inspections = [first, second, third];
    const pending = scope.removeInspection(1);
    scope.inspections.shift();
    answer(true);
    await pending;
    assert.deepEqual(scope.inspections, [third]);
});

test('critério alterado desde a prévia exige nova prévia antes de remover', async () => {
    let confirmations = 0;
    const sent = [];
    const { scope } = controller('controllers/admin-modals.js', 'AdminCampaignPointsModalController', {
        NotificationDialog: { confirm: () => { confirmations++; }, warning: () => {} },
        $http: { get: () => new Promise(() => {}), post: async (url, body) => {
            sent.push(body); return { data: { pointsAffected: 1, inspectionsAffected: 1 } };
        } }
    });
    scope.removalCriteria = { type: 'by_user', user: 'Ana' };
    await scope.previewRemoval();
    scope.removalReason = 'Motivo confirmado';
    scope.removalCriteria.user = 'Bruno';
    scope.confirmRemoval();
    assert.equal(confirmations, 0);
    assert.equal(sent.length, 1);
});

test('ressincronização forçada bloqueia confirmações duplicadas e ignora aceite após saída', async () => {
    let answer;
    const handlers = [];
    let confirmations = 0;
    let sent = 0;
    const { scope } = controller('controllers/campaign-management.js', 'CampaignManagementController', {
        $scope: { $on: (event, fn) => handlers.push(fn) },
        NotificationDialog: { confirm: () => { confirmations++; return new Promise(resolve => { answer = resolve; }); } },
        $http: { get: () => new Promise(() => {}), post: async () => { sent++; return { data: {} }; } }
    });
    const pending = scope.startWaybackSync(true);
    scope.startWaybackSync(true);
    handlers.forEach(fn => fn());
    answer(true);
    await pending;
    assert.equal(confirmations, 1);
    assert.equal(sent, 0);
});

test('estado editável acompanha alterações por botão sem considerar dados auxiliares carregados', () => {
    const pages = registry({});
    const scope = { campaign: { landUse: ['Floresta'], wmsConfig: { layers: [] } }, loading: true };
    const before = structuredClone(pages['campaign-edit'].editState(scope));
    scope.loading = false;
    scope.propertyKeys = ['campo'];
    assert.deepEqual(pages['campaign-edit'].editState(scope), before);
    scope.campaign.landUse.push('Pastagem');
    assert.notDeepEqual(pages['campaign-edit'].editState(scope), before);
    const doubt = { newComment: { text: '' }, transition: { reason: '' }, doubt: { status: 'ABERTA' } };
    const original = structuredClone(pages['point-doubt'].editState(doubt));
    doubt.doubt.status = 'RESOLVIDA';
    assert.deepEqual(structuredClone(pages['point-doubt'].editState(doubt)), original);
    doubt.newComment.text = 'Comentário';
    assert.notDeepEqual(structuredClone(pages['point-doubt'].editState(doubt)), original);
});

test('operações diretas expõem estado pendente para impedir saída e edição concorrente', () => {
    const pages = registry({});
    for (const [id, scope] of [
        ['campaign-upload', { uploadProgress: { isUploading: true } }],
        ['campaign-import', { isProcessing: true }],
        ['campaign-points', { removalLoading: true }],
        ['campaign-excess', { applying: true }],
        ['campaign-zombies', { recovering: true }],
        ['point-doubt', { submitting: true }]
    ]) {
        assert.equal(pages[id].pending(scope), true, id);
        assert.equal(pages[id].pending({}), false, id);
    }
});
