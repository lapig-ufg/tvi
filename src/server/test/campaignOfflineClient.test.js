'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function deferred() { let resolve; let reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
function panel(options = {}) {
    let definition;
    const calls = [], timers = [], events = {};
    const navigation = [];
    const scope = { campaignId: 'test', campaign: { useDynamicMaps: true, imageType: 'landsat' }, details: options.details,
        $on(name, fn) { events[name] = fn; } };
    function timeout(fn) { const timer = { fn }; timers.push(timer); return timer; }
    timeout.cancel = timer => { timer.cancelled = true; };
    const http = {};
    for (const method of ['get', 'post']) http[method] = (...args) => {
        const d = deferred();
        calls.push({ method, args, d });
        if (!options.interceptor) return d.promise;
        const config = { ...args[args.length - 1], url: args[0] };
        options.interceptor.request(config);
        return d.promise.then(response => options.interceptor.response({ ...response, config }),
            error => options.interceptor.responseError({ ...error, config }));
    };
    const q = { defer: deferred };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../client/others/campaign-offline-cache.js'), 'utf8'), {
        Application: { directive(name, factory) { definition = factory(); } }
    });
    definition.controller(scope, http, timeout, q, { confirm: options.confirm || (() => Promise.resolve(true)) }, {
        go: (...args) => navigation.push(args)
    });
    return { scope, calls, timers, events, navigation };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

function globalLoading() {
    const broadcasts = [], timers = [];
    let interceptor;
    function timeout(fn) { const timer = { fn }; timers.push(timer); return timer; }
    timeout.cancel = timer => { timer.cancelled = true; };
    const app = {
        factory(name, factory) {
            if (name === 'loadingInterceptor') interceptor = factory({ reject: value => Promise.reject(value) },
                { $broadcast: event => broadcasts.push(event) }, timeout);
            return this;
        },
        directive() { return this; }
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../client/services/loading-interceptor.js'), 'utf8'), {
        angular: { module: () => app }
    });
    return { interceptor, broadcasts, timers };
}

test('consulta sequencial não sobrepõe requisições e interrompe ao destruir', async () => {
    const p = panel();
    assert.equal(p.calls.length, 1);
    p.scope.refreshOffline();
    assert.equal(p.calls.length, 1);
    p.calls[0].d.resolve({ data: { status: 'running', counts: {}, total: 2 } });
    await tick();
    assert.equal(p.timers.length, 1);
    p.events.$destroy();
    assert.equal(p.timers[0].cancelled, true);
    p.timers[0].fn();
    assert.equal(p.calls.length, 1);
});

test('resposta após destruição não altera a tela nem agenda consulta', async () => {
    const p = panel();
    p.events.$destroy();
    p.calls[0].d.resolve({ data: { status: 'running' } });
    await tick();
    assert.equal(p.scope.offline.status, null);
    assert.equal(p.timers.length, 0);
});

test('disparo transmite somente a campanha e cobertura escolhidas', async () => {
    const p = panel();
    p.calls[0].d.resolve({ data: { status: 'not_started' } });
    await tick();
    p.scope.startOffline('start');
    assert.equal(p.calls[1].method, 'post');
    assert.equal(p.calls[1].args[0], '/api/cache/campaign/test/offline');
    assert.deepEqual(JSON.parse(JSON.stringify(p.calls[1].args[1])), { mode: 'start', width: 512, height: 512 });
});

test('consulta automática é silenciosa e atualização manual mantém o carregamento explícito', async () => {
    const p = panel();
    assert.equal(p.calls[0].args[1].hideLoading, true);
    p.calls[0].d.resolve({ data: { status: 'running', counts: {}, total: 0 } });
    await tick();
    p.timers[0].fn();
    assert.equal(p.calls[1].args[1].hideLoading, true);
    assert.equal(p.scope.offline.loading, true);
    p.calls[1].d.resolve({ data: { status: 'running', counts: {}, total: 0 } });
    await tick();
    p.scope.refreshOffline();
    assert.equal(p.calls[2].args[1].hideLoading, false);
});

test('resumo distingue imagens válidas e ausência comprovada sem perder os estados pendentes', async () => {
    const p = panel();
    p.calls[0].d.resolve({ data: { status: 'running', total: 100, percent: 55,
        counts: { completed: 50, no_data: 5, processing: 10, pending: 20, retry_wait: 10, blocked: 5 } } });
    await tick();
    assert.equal(p.scope.offlineSummary.verified, 55);
    assert.equal(p.scope.offlineSummary.percent, 55);
    assert.deepEqual(JSON.parse(JSON.stringify(p.scope.offlineSummary.segments.map(segment => [segment.state, segment.count, segment.percent]))),
        [['completed', 50, 50], ['no_data', 5, 5], ['processing', 10, 10], ['pending', 20, 20], ['retry_wait', 10, 10], ['blocked', 5, 5]]);
});

test('campanha sem geração mantém resumo vazio sem valores inválidos', async () => {
    const p = panel();
    p.calls[0].d.resolve({ data: { status: 'not_started' } });
    await tick();
    assert.equal(p.scope.offlineSummary.total, 0);
    assert.equal(p.scope.offlineSummary.percent, 0);
    assert.ok(p.scope.offlineSummary.segments.every(segment => segment.count === 0 && segment.percent === 0));
});

test('ações do resumo preservam a cobertura registrada após retornar da página de detalhes', async () => {
    for (const mode of ['start', 'regenerate', 'retry_failed']) {
        const p = panel();
        p.calls[0].d.resolve({ data: { status: 'blocked', config: { width: 1024, height: 768 } } });
        await tick();
        p.scope.startOffline(mode);
        await tick();
        assert.deepEqual(JSON.parse(JSON.stringify(p.calls[1].args[1])), { mode, width: 1024, height: 768 });
    }
});

test('edição da cobertura nos detalhes não é sobrescrita pela atualização do progresso', async () => {
    const p = panel({ details: 'true' });
    p.calls[0].d.resolve({ data: { status: 'blocked', config: { width: 1024, height: 768 } } });
    await tick();
    assert.equal(p.scope.offline.width, 1024);
    p.scope.offline.width = 800;
    p.scope.refreshOffline();
    p.calls[1].d.resolve({ data: { status: 'blocked', config: { width: 1024, height: 768 } } });
    await tick();
    p.scope.startOffline('start');
    assert.equal(p.calls[2].args[1].width, 800);
    assert.equal(p.calls[2].args[1].height, 768);
});

test('detalhes navegam com identificador e retorno explícito para a gestão da campanha', () => {
    const p = panel();
    p.scope.campaignId = 'campanha/a';
    p.scope.viewOfflineDetails();
    assert.deepEqual(JSON.parse(JSON.stringify(p.navigation[0])),
        ['campaign-offline', { campaignId: 'campanha/a' }, '/admin/campaigns/manage/campanha%2Fa']);
});

test('saída durante consulta automática cancela a requisição e não reinicia polling na rejeição', async () => {
    const p = panel();
    let cancelled = false;
    p.calls[0].args[1].timeout.then(() => { cancelled = true; });
    p.events.$destroy();
    p.calls[0].d.reject({ status: -1 });
    await tick();
    assert.equal(cancelled, true);
    assert.equal(p.timers.length, 0);
    assert.equal(p.scope.offline.error, null);
});

test('polling silencioso não mostra nem encerra o carregamento global de outra operação', async () => {
    const loading = globalLoading();
    const p = panel({ interceptor: loading.interceptor });
    assert.deepEqual(loading.broadcasts, []);
    const config = loading.interceptor.request({ url: '/api/campaigns/test/details' });
    assert.deepEqual(loading.broadcasts, ['loading:show']);
    p.calls[0].d.resolve({ data: { status: 'running', total: 0, counts: {} } });
    await tick();
    p.timers[0].fn();
    p.calls[1].d.reject({ status: 503 });
    await tick();
    assert.deepEqual(loading.broadcasts, ['loading:show']);
    assert.equal(loading.timers.length, 0);
    assert.equal(p.timers.length, 2);
    loading.interceptor.response({ config });
    assert.equal(loading.timers.length, 1);
    loading.timers[0].fn();
    assert.deepEqual(loading.broadcasts, ['loading:show', 'loading:hide']);
});

test('atualização e geração solicitadas pelo usuário continuam acionando o carregamento global', async () => {
    const loading = globalLoading();
    const p = panel({ interceptor: loading.interceptor });
    p.calls[0].d.resolve({ data: { status: 'not_started' } });
    await tick();
    p.scope.refreshOffline();
    assert.deepEqual(loading.broadcasts, ['loading:show']);
    p.calls[1].d.resolve({ data: { status: 'not_started' } });
    await tick();
    loading.timers[0].fn();
    p.scope.startOffline('start');
    assert.deepEqual(loading.broadcasts, ['loading:show', 'loading:hide', 'loading:show']);
});

test('regeneração captura a cobertura confirmada e impede operações concorrentes durante a confirmação', async () => {
    const confirmation = deferred();
    let confirmations = 0;
    const p = panel({ details: 'true', confirm: () => { confirmations++; return confirmation.promise; } });
    p.calls[0].d.resolve({ data: { status: 'completed', config: { width: 1024, height: 768 } } });
    await tick();
    p.scope.startOffline('regenerate');
    p.scope.startOffline('regenerate');
    p.scope.startOffline('start');
    p.scope.refreshOffline();
    assert.equal(confirmations, 1);
    assert.equal(p.calls.length, 1);
    p.scope.offline.width = 800;
    confirmation.resolve(true);
    await tick();
    assert.equal(p.calls.length, 2);
    assert.equal(p.calls[1].args[1].width, 1024);
});

test('confirmação recebida após sair da página não dispara regeneração', async () => {
    const confirmation = deferred();
    const p = panel({ confirm: () => confirmation.promise });
    p.calls[0].d.resolve({ data: { status: 'completed' } });
    await tick();
    p.scope.startOffline('regenerate');
    p.events.$destroy();
    confirmation.resolve(true);
    await tick();
    assert.equal(p.calls.length, 1);
});

test('dimensões inválidas não são enviadas nem substituídas silenciosamente pelo padrão', async () => {
    for (const width of [undefined, null, 255, 2049, 512.5, NaN]) {
        const p = panel({ details: 'true' });
        p.calls[0].d.resolve({ data: { status: 'not_started' } });
        await tick();
        p.scope.offline.width = width;
        p.scope.startOffline('start');
        assert.equal(p.calls.length, 1);
        assert.ok(p.scope.offline.error);
    }
});

test('campanha BDC não permite iniciar geração offline GEE', async () => {
    const env = panel();
    env.calls[0].d.resolve({ data: { status: 'not_started' } });
    await tick();
    env.scope.campaign.imagerySource = 'bdc';
    assert.equal(env.scope.offlineSupported(), false);
    env.scope.startOffline('start');
    await tick();
    assert.equal(env.calls.filter(call => call.method === 'post').length, 0);
});
