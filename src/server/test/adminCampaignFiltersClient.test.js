'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function setup(query = {}) {
    let factory;
    const requests = [], events = {}, timers = [];
    const scope = { $root: {}, $on: (name, fn) => { events[name] = fn; } };
    const http = { get(url, config) {
        const request = { url, config, then(success, failure) { this.success = success; this.failure = failure; return this; } };
        requests.push(request); return request;
    } };
    function timeout(fn) { const timer = { fn }; timers.push(timer); return timer; }
    timeout.cancel = timer => { timer.cancelled = true; };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../client/controllers/admin-campaign.js'), 'utf8'), {
        Application: { controller(name, fn) { factory = fn; } }
    });
    factory(scope, http, {}, {}, { search: () => query }, timeout, { error() {} }, { core: { defaults: () => ({}) } });
    return { scope, requests, events, timers };
}
test('listagem inicia por criação, envia false e mantém filtros de configuração', () => {
    const c = setup();
    assert.equal(c.scope.filters.sortBy, 'createdAt');
    c.scope.filters.showTimeseries = false;
    c.scope.filters.bdcCollection = 'landsat-2';
    c.scope.filters.campaignId = 'a&b';
    c.scope.loadCampaigns();
    const r = c.requests.at(-1);
    assert.match(r.url, /sortBy=createdAt/);
    assert.match(r.url, /showTimeseries=false/);
    assert.match(r.url, /bdcCollection=landsat-2/);
    assert.match(r.url, /campaignId=a%26b/);
    assert.equal(r.config.hideLoading, true);
    assert.equal(c.scope.getActiveFiltersCount(), 3);
    c.scope.removeFilter('showTimeseries');
    assert.equal(c.scope.filters.showTimeseries, null);
    assert.doesNotMatch(c.requests.at(-1).url, /showTimeseries=/);
});
test('respostas antigas e respostas após saída não substituem a lista atual', () => {
    const c = setup();
    c.scope.loadCampaigns(); const old = c.requests.at(-1);
    c.scope.filters.imageType = 'landsat';
    c.scope.loadCampaigns(); const current = c.requests.at(-1);
    current.success({ data: { campaigns: ['current'], pagination: { limit: 10 } } });
    old.success({ data: { campaigns: ['old'], pagination: {} } });
    assert.equal(c.scope.campaigns[0], 'current');
    c.scope.loadCampaigns(); const pending = c.requests.at(-1);
    c.events.$destroy();
    pending.success({ data: { campaigns: ['destroyed'], pagination: {} } });
    assert.equal(c.scope.campaigns[0], 'current');
});
test('restaura triestado e converte ordenação antiga sem contar ordenação como filtro', () => {
    const c = setup({ f_sortBy: '_id', f_autoLoadTimeseries: 'false' });
    assert.equal(c.scope.filters.sortBy, 'createdAt');
    assert.equal(c.scope.filters.autoLoadTimeseries, false);
    assert.equal(c.scope.getActiveFiltersCount(), 1);
    c.scope.clearFilters();
    assert.equal(c.scope.hasActiveFilters(), false);
    assert.equal(c.scope.filters.sortBy, 'createdAt');
});
test('opções completas vêm da API e falha permite tentar novamente', () => {
    const c = setup();
    c.scope.loadFilterOptions();
    c.requests.at(-1).failure({ status: 503 });
    assert.equal(c.scope.filterOptionsError, true);
    c.scope.loadFilterOptions();
    c.requests.at(-1).success({ data: { success: true, data: { imagerySources: ['bdc', 'legacy'], bdcCollections: ['landsat-2'], initialYears: [2020], finalYears: [2026], numInspec: [7] } } });
    assert.equal(c.scope.filterOptionsError, false);
    assert.equal(c.scope.filterOptions.bdcCollections[0], 'landsat-2');
    assert.equal(c.scope.availableNumInspec[0], 7);
});

test('lista de filtros mantém identidade durante o ciclo AngularJS', () => {
    const c = setup();
    c.scope.filters.imageType = 'landsat';
    const filters = c.scope.activeFilters();
    assert.equal(c.scope.activeFilters(), filters);
    c.scope.filters.imageType = 'sentinel-2';
    assert.notEqual(c.scope.activeFilters(), filters);
});
