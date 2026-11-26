'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function pages() {
    let factory, current = '/admin/campaigns?page=2', params = {};
    const calls = [];
    const q = { when: value => Promise.resolve(value), reject: value => Promise.reject(value) };
    const location = { url(value) { if (value !== undefined) current = value; return current; },
        path(value) { current = value; return location; }, search(value) { params = value; return location; } };
    const http = { get(url) { calls.push(url); return Promise.resolve({ data: { authenticated: true } }); } };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../client/services/admin-pages.js'), 'utf8'), {
        Application: { factory(name, fn) { factory = fn; } }, angular: { copy: value => JSON.parse(JSON.stringify(value)) }
    });
    const service = factory(q, http, location);
    return { service, calls, location, query: () => params };
}

test('página recupera contexto por identificador em abertura direta', async () => {
    const p = pages();
    p.service.register('test', { title: 'Teste', templateUrl: 'views/test.tpl.html', controller: 'TestController',
        parent: () => '/admin/campaigns', load: params => Promise.resolve({ campaign: { _id: params.campaignId } }) });
    const page = await p.service.load({ pageId: 'test', campaignId: 'campaign' });
    assert.equal(page.locals.campaign._id, 'campaign');
    assert.equal(page.parent, '/admin/campaigns');
    assert.deepEqual(p.calls, ['/api/admin/check']);
});

test('navegação mantém retorno e transmite somente parâmetros escalares', () => {
    const p = pages();
    p.service.go('test', { campaignId: 'abc' });
    assert.equal(p.location.url(), '/admin/page/test');
    assert.equal(p.query().returnTo, '/admin/campaigns?page=2');
    assert.equal(p.query().campaignId, 'abc');
    assert.throws(() => p.service.go('test', { campaign: { password: 'invalid' } }));
    assert.throws(() => p.service.go('test', { password: 'invalid' }));
});

test('retornos externos e páginas desconhecidas não são executados', async () => {
    const p = pages();
    p.service.register('test', { parent: () => '/admin/home', load: () => ({}) });
    const page = await p.service.load({ pageId: 'test', returnTo: 'https://example.test' });
    assert.equal(page.returnTo, '/admin/home');
    const unknown = await p.service.load({ pageId: '../../controller' });
    assert.ok(unknown.error);
    assert.equal(unknown.definition, undefined);
});

test('falha na consulta preserva uma página com erro e retorno', async () => {
    const p = pages();
    p.service.register('test', { parent: () => '/admin/campaigns', load: () => Promise.reject({ status: 404 }) });
    const page = await p.service.load({ pageId: 'test' });
    assert.ok(page.error);
    assert.equal(page.returnTo, '/admin/campaigns');
});

function pageController(save) {
    let factory, context, current = '/admin/page/test';
    const events = {}, windowEvents = {};
    const page = { returnTo: '/admin/campaigns', locals: {}, params: {}, definition: {
        controller: 'Form', templateUrl: 'views/form.tpl.html', editable: true, save
    } };
    const scope = { $on(name, fn) { events[name] = fn; } };
    const location = { url(value) { if (value !== undefined) current = value; return current; } };
    let confirm;
    const notifications = { confirm() { return new Promise(resolve => { confirm = resolve; }); } };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../client/controllers/admin-page.js'), 'utf8'), {
        Application: { controller(name, fn) { factory = fn; } }, angular: { extend: Object.assign }
    });
    factory(scope, location,
        { when: value => Promise.resolve(value) }, page, notifications,
        { addEventListener(name, fn) { windowEvents[name] = fn; }, removeEventListener(name) { delete windowEvents[name]; } });
    return { page, scope, context: page.context, events, location, confirm: value => confirm(value), windowEvents };
}

test('salvamento da página impede duplicidade e conserva formulário em caso de erro', async () => {
    let calls = 0, fail;
    const c = pageController(() => { calls++; return new Promise((resolve, reject) => { fail = reject; }); });
    const pending = c.context.close({ value: 1 });
    c.context.close({ value: 2 });
    await Promise.resolve();
    assert.equal(calls, 1);
    fail(new Error('Falha na gravação'));
    await pending;
    assert.equal(c.page.error, 'Falha na gravação');
    assert.equal(c.location.url(), '/admin/page/test');
    assert.equal(c.page.busy, false);
});

test('resposta de gravação após destruir página não altera a rota atual', async () => {
    let resolve;
    const c = pageController(() => new Promise(done => { resolve = done; }));
    const pending = c.context.close({});
    await Promise.resolve();
    c.events.$destroy();
    c.location.url('/admin/logs');
    resolve();
    await pending;
    assert.equal(c.location.url(), '/admin/logs');
});

test('saída com alteração exige confirmação e cancelamento preserva página', async () => {
    const c = pageController();
    c.page.dirty = true;
    let prevented = false;
    c.events.$locationChangeStart({ preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
    c.confirm(false);
    await Promise.resolve();
    assert.equal(c.page.dirty, true);
    assert.equal(c.location.url(), '/admin/page/test');
    c.events.$destroy();
    assert.equal(Object.keys(c.windowEvents).length, 0);
});

test('aceite da saída retoma o destino e evita segunda confirmação', async () => {
    const c = pageController();
    c.page.dirty = true;
    c.location.url('/admin/logs?page=2');
    c.events.$locationChangeStart({ preventDefault() {} });
    c.location.url('/admin/page/test');
    c.confirm(true);
    await Promise.resolve();
    assert.equal(c.location.url(), '/admin/logs?page=2');
    let prevented = false;
    c.events.$locationChangeStart({ preventDefault() { prevented = true; } });
    assert.equal(prevented, false);
});

test('gravação pendente impede saída e recarga até terminar', async () => {
    let complete;
    const c = pageController(() => new Promise(resolve => { complete = resolve; }));
    const pending = c.context.close({});
    await Promise.resolve();
    let prevented = 0;
    c.events.$locationChangeStart({ preventDefault() { prevented++; } });
    const event = { preventDefault() { prevented++; } };
    c.windowEvents.beforeunload(event);
    assert.equal(prevented, 2);
    assert.equal(event.returnValue, '');
    complete();
    await pending;
    assert.equal(c.location.url(), '/admin/campaigns');
});

function contentDirective(withState) {
    let factory, resolveTemplate, controllerScope, compiledScope;
    const events = {}, listeners = {};
    const page = { locals: {}, definition: { editable: true, controller: 'Form', templateUrl: 'views/form.tpl.html' },
        context: { close() {}, dismiss() {} } };
    if (withState) {
        page.definition.editState = scope => ({ days: scope.cleanupDays });
        page.definition.pending = scope => scope.sending;
    }
    let watch;
    const scope = { page, $on(name, fn) { events[name] = fn; }, $evalAsync(fn) { fn(); },
        $watch(read, changed) { watch = () => changed(read()); } };
    const element = { on(name, fn) { listeners[name] = fn; }, off(name) { delete listeners[name]; }, html() {}, contents() { return []; } };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../client/directives/adminPageContent.js'), 'utf8'), {
        Application: { directive(name, fn) { factory = fn; } }, angular: {
            extend: Object.assign, copy: value => JSON.parse(JSON.stringify(value)),
            equals: (a, b) => JSON.stringify(a) === JSON.stringify(b)
        }
    });
    const directive = factory(() => new Promise(resolve => { resolveTemplate = resolve; }), (name, locals) => {
        controllerScope = locals.$scope;
        controllerScope.cleanupDays = '30';
        controllerScope.submit = () => controllerScope.cleanupDays;
    }, () => target => { compiledScope = target; });
    directive.link(scope, element);
    return { scope, page, events, listeners, resolveTemplate, digest: () => watch(), controllerScope: () => controllerScope,
        compiledScope: () => compiledScope };
}

test('campos e controlador compartilham escopo e enviam valores editados', async () => {
    const c = contentDirective();
    c.resolveTemplate('<input ng-model="cleanupDays">');
    await Promise.resolve();
    assert.equal(c.controllerScope(), c.compiledScope());
    c.compiledScope().cleanupDays = '7';
    assert.equal(c.controllerScope().submit(), '7');
    c.listeners['input change']();
    assert.equal(c.page.dirty, true);
    c.events.$destroy();
    assert.equal(Object.keys(c.listeners).length, 0);
});

test('template tardio não instancia controlador de página destruída', async () => {
    const c = contentDirective();
    c.events.$destroy();
    c.resolveTemplate('<input>');
    await Promise.resolve();
    assert.equal(c.controllerScope(), undefined);
    assert.equal(c.compiledScope(), undefined);
});


test('alteração por botão e restauração do modelo atualizam proteção de saída', async () => {
    const c = contentDirective(true);
    c.resolveTemplate('<form></form>');
    await Promise.resolve();
    c.digest();
    assert.equal(c.page.dirty, false);
    c.scope.cleanupDays = '7';
    c.digest();
    assert.equal(c.page.dirty, true);
    c.scope.cleanupDays = '30';
    c.digest();
    assert.equal(c.page.dirty, false);
    c.scope.sending = true;
    assert.equal(c.page.operationPending(), true);
    c.scope.sending = false;
    assert.equal(c.page.operationPending(), false);
});

test('operação direta do formulário também impede navegação', () => {
    const c = pageController();
    c.page.operationPending = () => true;
    let prevented = false;
    c.events.$locationChangeStart({ preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
    c.scope.backToOrigin();
    assert.equal(c.location.url(), '/admin/page/test');
});
