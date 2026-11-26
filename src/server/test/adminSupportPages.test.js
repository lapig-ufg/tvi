'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const client = path.join(__dirname, '../../client');

function invoke(definition, locals) {
    const fn = Array.isArray(definition) ? definition[definition.length - 1] : definition;
    const names = Array.isArray(definition) ? definition.slice(0, -1) : fn.toString().match(/function\s*\(([^)]*)\)/)[1].split(',').map(s => s.trim());
    return fn(...names.map(name => locals[name]));
}

function pages(http) {
    const registered = {};
    const file = path.join(client, 'services/admin-support-pages.js');
    if (fs.existsSync(file)) vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
        Application: { run(definition) { invoke(definition, {
            AdminPages: { register(id, options) { registered[id] = options; } },
            $http: http,
            NotificationDialog: { success() {} }
        }); } }
    });
    return registered;
}

function controller(name, locals) {
    const definitions = {};
    ['admin-logs.js', 'admin-tickets.js'].forEach(file => vm.runInNewContext(fs.readFileSync(path.join(client, 'controllers', file), 'utf8'), {
        Application: { controller(id, definition) { definitions[id] = definition; } },
        angular: { copy: value => structuredClone(value) }, console
    }));
    invoke(definitions[name], locals);
}

test('detalhe de log recupera o registro pelo identificador da URL', async () => {
    const defs = pages({ get(url) {
        assert.equal(url, '/service/logs/log%2F42');
        return Promise.resolve({ data: { success: true, log: { logId: 'log/42', message: 'Registro completo' } } });
    } });
    assert.ok(defs['log-details']);
    const locals = await defs['log-details'].load({ logId: 'log/42' });
    assert.equal(locals.logData.message, 'Registro completo');
    assert.equal(defs['log-details'].parent({}), '/admin/logs');
});

test('detalhe de log propaga falha de carga e rejeita resposta incompleta', async () => {
    const failure = new Error('indisponível');
    let defs = pages({ get() { return Promise.reject(failure); } });
    assert.ok(defs['log-details']);
    await assert.rejects(defs['log-details'].load({ logId: '42' }), failure);
    defs = pages({ get() { return Promise.resolve({ data: { success: true } }); } });
    await assert.rejects(defs['log-details'].load({ logId: '42' }), /log/i);
});

test('limpeza persiste sem depender da listagem e propaga a rejeição', async () => {
    const defs = pages({ delete(url, options) {
        assert.equal(url, '/service/logs/cleanup');
        assert.equal(options.params.daysToKeep, 15);
        assert.equal(options.params.keepErrors, true);
        return Promise.resolve({ data: { success: false, error: 'Limpeza indisponível' } });
    } });
    assert.ok(defs['logs-cleanup']);
    await assert.rejects(defs['logs-cleanup'].save({ cleanupDays: '15', keepErrors: true }), /Limpeza indisponível/);
});

test('limpeza rejeita retenção inválida antes de enviar a operação', async () => {
    const defs = pages({ delete() { assert.fail('não deve remover logs'); } });
    assert.ok(defs['logs-cleanup']);
    await assert.rejects(Promise.resolve().then(() => defs['logs-cleanup'].save({ cleanupDays: 0, keepErrors: true })), /período/i);
});

test('configuração do job recupera e salva dados sem parentScope', async () => {
    const defs = pages({
        get() { return Promise.resolve({ data: { success: true, jobStatus: { isEnabled: true, configuration: { daysToKeep: 30 } } } }); },
        put(url, data) {
            assert.equal(url, '/service/logs/job-config');
            assert.equal(data.daysToKeep, 60);
            return Promise.resolve({ data: { success: true } });
        }
    });
    assert.ok(defs['logs-job-config']);
    const locals = await defs['logs-job-config'].load({});
    assert.equal(locals.jobStatusData.configuration.daysToKeep, 30);
    assert.equal(locals.parentScope, undefined);
    await defs['logs-job-config'].save({ daysToKeep: 60 });
});

test('status recupera chamado atualizado pelo ID e dúvida recupera campanha do servidor', async () => {
    const defs = pages({ get(url) {
        if (url === '/service/tickets/abc') return Promise.resolve({ data: { _id: 'abc', status: 'EM_ANALISE' } });
        assert.equal(url, '/service/points/p%2F1/doubt');
        return Promise.resolve({ data: { pointId: 'p/1', campaign: 'campanha', doubt: { status: 'ABERTA' } } });
    } });
    assert.ok(defs['ticket-status']);
    const status = await defs['ticket-status'].load({ ticketId: 'abc' });
    assert.equal(status.ticket.status, 'EM_ANALISE');
    const doubt = await defs['ticket-doubt'].load({ pointId: 'p/1' });
    assert.equal(doubt.point._id, 'p/1');
    assert.equal(doubt.campaign._id, 'campanha');
    assert.equal(doubt.mode, 'admin');
    assert.equal(defs['ticket-doubt'].parent({}), '/admin/tickets');
});

test('status mantém formulário utilizável após erro HTTP e impede gravação duplicada', async () => {
    const scope = {};
    let reject;
    let requests = 0;
    controller('TicketStatusModalController', {
        $scope: scope, ticket: { _id: 'abc', status: 'ABERTO' },
        i18nService: { translate: key => key },
        $uibModalInstance: { close() { assert.fail('não deve retornar após erro'); } },
        requester: { _patch() { requests++; } },
        $http: { patch() { requests++; return new Promise((resolve, failure) => { reject = failure; }); } }
    });
    scope.form = { status: 'EM_ANALISE', reason: 'Avaliação técnica' };
    const pending = scope.submit();
    scope.submit();
    assert.equal(requests, 1);
    reject({ data: { error: 'Serviço indisponível' } });
    await pending;
    assert.equal(scope.submitting, false);
    assert.equal(scope.errorMessage, 'Serviço indisponível');
});

test('execução manual do job atualiza estado imediatamente após a conclusão', async () => {
    const scope = {};
    let calls = 0;
    controller('AdminLogsJobConfigModalController', {
        $scope: scope, $uibModalInstance: {},
        jobStatusData: { isEnabled: true, configuration: { daysToKeep: 30 } },
        NotificationDialog: { success() {}, error() {}, info() {} },
        $timeout() {},
        $http: {
            post() {
                calls++;
                const response = Promise.resolve({ data: { success: true } });
                response.success = function(callback) { callback({ success: true }); return response; };
                response.error = function() { return response; };
                return response;
            },
            get() { return Promise.resolve({ data: { success: true, jobStatus: { lastExecution: 'concluída' } } }); }
        }
    });
    const pending = scope.triggerJob();
    scope.triggerJob();
    await pending;
    assert.equal(calls, 1);
    assert.equal(scope.jobStatus.lastExecution, 'concluída');
    assert.equal(scope.triggering, false);
});

test('ações administrativas navegam por identificadores sem capturar o escopo da listagem', () => {
    const navigation = [];
    const logScope = { $on() {} };
    const response = { success() { return response; }, error() { return response; }, finally() { return response; } };
    controller('AdminLogsController', {
        $scope: logScope, $location: { search() { return {}; } },
        $http: { get() { return response; } },
        $interval() {},
        AdminPages: { go(id, params) { navigation.push([id, params]); } }
    });
    logScope.viewLogDetails({ logId: '42', metadata: { private: 'payload' } });
    logScope.showCleanupModal();
    logScope.showJobConfigModal();
    assert.equal(navigation[0][0], 'log-details');
    assert.equal(JSON.stringify(navigation[0][1]), '{"logId":"42"}');
    assert.equal(navigation[1][0], 'logs-cleanup');
    assert.equal(navigation[2][0], 'logs-job-config');

    const ticketScope = { $on() {}, $apply() {} };
    controller('AdminTicketsController', {
        $scope: ticketScope, $location: { search() { return {}; } },
        $rootScope: { $on() {} },
        requester: { _get() {} },
        i18nService: { translate: key => key, ensureLoaded: () => Promise.resolve() },
        AdminPages: { go(id, params) { navigation.push([id, params]); } }
    });
    ticketScope.openStatusModal({ _id: 'abc' });
    ticketScope.viewTicket({ _isDoubt: true, _pointId: 'point' });
    assert.equal(navigation[3][0], 'ticket-status');
    assert.equal(JSON.stringify(navigation[3][1]), '{"ticketId":"abc"}');
    assert.equal(navigation[4][0], 'ticket-doubt');
    assert.equal(JSON.stringify(navigation[4][1]), '{"pointId":"point"}');
});

test('status retorna somente depois de persistir e cancelamento não grava', async () => {
    const scope = {};
    let complete;
    let closed = false;
    let dismissed = false;
    let writes = 0;
    controller('TicketStatusModalController', {
        $scope: scope, ticket: { _id: 'abc', status: 'ABERTO' },
        i18nService: { translate: key => key },
        $uibModalInstance: { close() { closed = true; }, dismiss() { dismissed = true; } },
        $http: { patch(url, data) {
            writes++;
            assert.equal(url, '/service/tickets/abc/status');
            assert.equal(data.reason, 'Avaliação');
            return new Promise(resolve => { complete = resolve; });
        } }
    });
    scope.cancel();
    assert.equal(dismissed, true);
    assert.equal(writes, 0);
    scope.form = { status: 'EM_ANALISE', reason: ' Avaliação ' };
    const pending = scope.submit();
    assert.equal(closed, false);
    complete({ data: { _id: 'abc', status: 'EM_ANALISE' } });
    await pending;
    assert.equal(closed, true);
    assert.equal(scope.submitting, false);
});

test('listagens restauram filtros da URL e gravam o contexto antes de abrir uma página', () => {
    function location(query) {
        return { search(value) { if (value) query = value; return query; } };
    }
    const logLocation = location({ level: 'error', module: 'jobs', search: 'falha', page: '2', limit: '100', period: '30' });
    const logScope = { $on() {} };
    const response = { success() { return response; }, error() { return response; }, finally() { return response; } };
    controller('AdminLogsController', {
        $scope: logScope, $location: logLocation,
        $http: { get() { return response; } }, $interval() {},
        AdminPages: { go() { assert.equal(logLocation.search().search, 'retentativa'); } }
    });
    assert.equal(logScope.filters.level, 'error');
    assert.equal(logScope.selectedPeriod, 30);
    assert.equal(logScope.filters.page, 2);
    logScope.filters.search = 'retentativa';
    logScope.showCleanupModal();

    const ticketLocation = location({ status: 'EM_ANALISE', type: 'DUVIDA', page: '3', limit: '25' });
    const ticketScope = { $on() {}, $apply() {} };
    controller('AdminTicketsController', {
        $scope: ticketScope, $location: ticketLocation,
        requester: { _get() {} },
        i18nService: { translate: key => key, ensureLoaded: () => Promise.resolve() },
        AdminPages: { go() { assert.equal(ticketLocation.search().page, 4); } }
    });
    assert.equal(ticketScope.filters.status, 'EM_ANALISE');
    assert.equal(ticketScope.pagination.page, 3);
    ticketScope.pagination.page = 4;
    ticketScope.openStatusModal({ _id: 'abc' });
});

test('estatísticas recebidas depois da saída não recriam o gráfico da listagem', () => {
    const scope = {};
    let destroy;
    let receiveStats;
    let chartUpdates = 0;
    scope.$on = function(event, callback) { if (event === '$destroy') destroy = callback; };
    const response = { success(fn) { receiveStats = receiveStats || fn; return response; }, error() { return response; }, finally() { return response; } };
    const interval = function() { return 1; };
    interval.cancel = function() {};
    controller('AdminLogsController', {
        $scope: scope, $location: { search() { return {}; } },
        $http: { get() { return response; } }, $interval: interval,
        $timeout: { cancel() {} }
    });
    scope.updateChart = function() { chartUpdates++; };
    destroy();
    receiveStats({ success: true, statistics: { byLevel: [], byModule: [], byDay: [], totals: { totalLogs: 1 } } });
    assert.equal(chartUpdates, 0);
});

test('estado editável de suporte acompanha campos alterados e ignora dados de consulta', () => {
    const defs = pages({});
    const cases = [
        ['logs-cleanup', { cleanupDays: '30', keepErrors: true }, scope => { scope.keepErrors = false; }],
        ['logs-job-config', { jobConfig: { daysToKeep: 30 }, jobStatus: { lastExecution: 'ontem' } }, scope => { scope.jobConfig.daysToKeep = 7; }],
        ['ticket-status', { form: { status: '', reason: '' }, ticket: { status: 'ABERTO' } }, scope => { scope.form.reason = 'Avaliação'; }],
        ['ticket-doubt', { newComment: { text: '' }, transition: { reason: '' }, doubt: { status: 'ABERTA' } }, scope => { scope.newComment.text = 'Comentário'; }]
    ];
    for (const [id, scope, change] of cases) {
        assert.equal(typeof defs[id].editState, 'function', id);
        const initial = JSON.stringify(defs[id].editState(scope));
        scope.errorMessage = 'Falha transitória';
        scope.loading = true;
        scope.jobStatus = { lastExecution: 'hoje' };
        scope.doubt = { status: 'RESOLVIDA' };
        assert.equal(JSON.stringify(defs[id].editState(scope)), initial, id + ' não trata resposta do servidor como edição');
        change(scope);
        assert.notEqual(JSON.stringify(defs[id].editState(scope)), initial, id + ' detecta edição');
    }
});

test('guarda de suporte detecta imediatamente operações diretas e libera após conclusão', () => {
    const defs = pages({});
    for (const [id, flag] of [['logs-job-config', 'triggering'], ['ticket-status', 'submitting'], ['ticket-doubt', 'submitting']]) {
        const scope = { [flag]: false };
        assert.equal(typeof defs[id].pending, 'function', id);
        assert.equal(defs[id].pending(scope), false);
        scope[flag] = true;
        assert.equal(defs[id].pending(scope), true);
        scope[flag] = false;
        assert.equal(defs[id].pending(scope), false);
    }
    assert.equal(defs['log-details'].editable, undefined);
});

test('páginas de logs carregadas diretamente declaram o mesmo escopo visual isolado', async () => {
    const defs = pages({ get(url) {
        return Promise.resolve({ data: url.endsWith('job-status')
            ? { success: true, jobStatus: { configuration: { daysToKeep: 30 } } }
            : { success: true, log: { logId: 'log-1' } } });
    } });
    for (const id of ['log-details', 'logs-cleanup', 'logs-job-config']) {
        await defs[id].load({ logId: 'log-1' });
        assert.equal(defs[id].className, 'admin-log-page');
    }
    assert.equal(defs['ticket-status'].className, undefined);
});

test('estilos de logs ficam disponíveis sem carregar a listagem e não atingem outras páginas', () => {
    const file = path.join(client, 'css/admin-log-pages.css');
    assert.ok(fs.existsSync(file), 'Folha compartilhada de estilos deve existir');
    const css = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const rules = Array.from(css.matchAll(/([^{}]+)\{([^{}]*)\}/g));
    assert.ok(rules.length > 0);
    for (const rule of rules) {
        for (const selector of rule[1].trim().split(/,\s*/)) {
            assert.ok(selector.trim().startsWith('.admin-log-page '), selector);
        }
    }
    const selectors = rules.flatMap(rule => rule[1].trim().split(/,\s*/).map(selector => selector.trim()));
    for (const selector of ['.detail-grid', '.log-level', '.cleanup-options select', '.warning-message', '.config-form', '.logs-output', '.confirm-btn', '.trigger-btn']) {
        assert.ok(selectors.includes('.admin-log-page ' + selector), selector + ' disponível na abertura direta');
    }
    assert.ok(!selectors.some(selector => /\.logs-table|\.logs-header|\.logs-filters|\.pagination/.test(selector)));
    assert.equal((css.match(/\{/g) || []).length, (css.match(/\}/g) || []).length);
});
