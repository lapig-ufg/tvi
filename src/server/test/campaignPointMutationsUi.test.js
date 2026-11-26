'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.resolve(__dirname, '../../client/controllers/campaign-point-mutations.js'), 'utf8');
function setup(http) {
    const handlers = {};
    const scope = { $on: (name, fn) => { handlers[name] = fn; }, $applyAsync: fn => fn() };
    const timers = new Set();
    const interval = fn => { timers.add(fn); return fn; };
    interval.cancel = fn => timers.delete(fn);
    vm.runInNewContext(source, { Application: { controller: (name, factory) => factory(scope, http, interval, { Blob }, {}, 'campaign', 'delete', '') } });
    return { scope, timers, destroy: () => handlers.$destroy() };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
function preview() { return { id: 'op', canApply: true, expiresAt: new Date(Date.now() + 60000).toISOString(), total: 1 }; }
test('prévia atrasada não restaura conteúdo invalidado', async () => {
    const pending = deferred();
    const { scope } = setup({ get: async () => ({ data: { operations: [] } }), post: () => pending.promise });
    scope.input.content = '{}';
    const request = scope.requestPreview();
    scope.invalidatePreview();
    pending.resolve({ data: preview() });
    await request;
    assert.equal(scope.preview, null);
    assert.equal(scope.previewLoading, false);
});
test('confirmação exige campanha exata, justificativa e validade, sem duplicação', async () => {
    const pending = deferred();
    const requests = [];
    const { scope } = setup({ get: async () => ({ data: { operations: [] } }), post: (url, body) => { requests.push({ url, body }); return pending.promise; } });
    await tick();
    scope.preview = preview();
    scope.approval = { confirmation: 'campaign ', reason: 'Justificativa válida' };
    assert.equal(scope.canConfirm(), false);
    scope.approval.confirmation = 'campaign';
    assert.equal(scope.canConfirm(), true);
    scope.preview.expiresAt = '2000-01-01';
    assert.equal(scope.canConfirm(), false);
    scope.preview = preview();
    const request = scope.confirmOperation();
    scope.confirmOperation();
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, '/api/campaigns/campaign/point-operations/op/confirm');
    pending.resolve({ data: { id: 'op', status: 'completed', total: 1, processed: 1 } });
    await request;
    assert.equal(scope.preview, null);
    assert.equal(scope.input.content, '');
});
test('polling silencioso acompanha somente operações ativas e termina ao destruir', async () => {
    let operations = [{ id: 'op', status: 'running' }];
    const { scope, timers, destroy } = setup({ get: async (url, config) => {
        assert.equal(config.hideLoading, true);
        return { data: { operations } };
    } });
    await tick();
    assert.equal(timers.size, 1);
    operations = [{ id: 'op', status: 'completed' }];
    await scope.refreshOperations();
    assert.equal(timers.size, 0);
    operations = [{ id: 'op', status: 'queued' }];
    await scope.refreshOperations();
    assert.equal(timers.size, 1);
    destroy();
    assert.equal(timers.size, 0);
});
test('arquivo acima de 5 MB limpa prévia e não inicia leitura', () => {
    const { scope } = setup({ get: async () => ({ data: { operations: [] } }) });
    scope.preview = preview();
    scope.readFile({ files: [{ name: 'pontos.json', size: 5242881 }], value: 'pontos.json' });
    assert.equal(scope.preview, null);
    assert.equal(scope.input.content, '');
    assert.match(scope.error, /5 MB/);
});
test('retomada exige nova confirmação e utiliza endpoint específico', async () => {
    const requests = [];
    const { scope } = setup({ get: async () => ({ data: { operations: [] } }), post: async (url, body) => {
        requests.push({ url, body }); return { data: { id: 'failed', status: 'queued' } };
    } });
    await tick();
    scope.prepareResume({ id: 'failed', status: 'failed' });
    assert.equal(scope.canConfirm(), false);
    scope.approval = { confirmation: 'campaign', reason: 'Retomada após análise' };
    await scope.confirmOperation();
    assert.match(requests[0].url, /\/failed\/resume$/);
});
test('resultados distinguem pontos aplicados e ignorados sem tornar o trabalho assíncrono pendente', async () => {
    const { scope } = setup({ get: async () => ({ data: { operations: [] } }), post: async () => ({ data: { id: 'op', status: 'queued' } }) });
    await tick();
    assert.equal(scope.affectedCount({ processed: 5, skipped: 2 }), 3);
    assert.equal(scope.affectedCount({ processed: 5, skipped: 2, affected: 1 }), 1);
    assert.equal(scope.outcomeLabel('skipped'), 'Não aplicado');
    scope.input.content = 'point';
    scope.invalidatePreview();
    assert.equal(scope.unsentChanges, true);
    scope.preview = preview();
    scope.approval = { confirmation: 'campaign', reason: 'Inclusão complementar' };
    await scope.confirmOperation();
    assert.equal(scope.unsentChanges, false);
    assert.equal(scope.applying, false);
    assert.equal(scope.operations[0].status, 'queued');
});
test('exclusão individual mantém contexto da lista e envia somente identificadores', () => {
    const controllerSource = fs.readFileSync(path.resolve(__dirname, '../../client/controllers/admin-modals.js'), 'utf8');
    const body = controllerSource.match(/\$scope\.deleteCampaignPoint = function\(point\) \{([\s\S]*?)\n    \};/)[1];
    const calls = [];
    vm.runInNewContext('(function(point) {' + body + '})({_id: "ponto/1"})', {
        rememberPoints: () => calls.push('remember'), campaign: { _id: 'campaign' },
        AdminPages: { go: (page, params) => calls.push({ page, params }) }
    });
    assert.equal(calls[0], 'remember');
    assert.equal(calls[1].page, 'campaign-point-mutations');
    assert.equal(calls[1].params.pointId, 'ponto/1');
    assert.equal(calls[1].params.action, 'delete');
});
test('falha HTTP na confirmação consulta operação recuperável e acompanha confirming', async () => {
    let reads = 0;
    const { scope, timers } = setup({
        get: async () => ({ data: { operations: ++reads > 1 ? [{ id: 'op', status: 'confirming' }] : [] } }),
        post: async () => { throw { data: { error: 'Conexão interrompida' } }; }
    });
    await tick();
    scope.preview = preview();
    scope.approval = { confirmation: 'campaign', reason: 'Inclusão complementar' };
    await scope.confirmOperation();
    assert.equal(reads, 2);
    assert.equal(scope.applying, false);
    assert.equal(scope.operations[0].status, 'confirming');
    assert.equal(scope.statusLabel('confirming'), 'Confirmando');
    assert.equal(timers.size, 1);
    assert.equal(scope.error, 'Conexão interrompida');
});
