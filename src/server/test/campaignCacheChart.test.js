'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function screen() {
    let factory;
    const requests = [], timers = [], plots = [], events = {};
    const node = {};
    const scope = { $root: {}, $on(name, fn) { events[name] = fn; } };
    function timeout(fn, delay) { const t = { fn, delay }; timers.push(t); return t; }
    timeout.cancel = t => { t.cancelled = true; };
    const http = { get(url, config) {
        const r = { url, config, then(ok, fail) { this.ok = ok; this.fail = fail; return this; },
            finally(fn) { this.done = fn; return this; } };
        requests.push(r); return r;
    } };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../client/controllers/admin-campaign-monitoring.js'), 'utf8'), {
        Application: { controller(name, fn) { factory = fn; } },
        document: { querySelector: () => null },
        Plotly: { purge() {}, d3: { select: () => ({ node: () => node }) }, react(gd, data) { plots.push(data); } }
    });
    factory(scope, http, { id: 'campaign' }, timeout, {}, { addEventListener() {}, removeEventListener() {} }, {}, {});
    scope.loadAllCharts();
    return { requests, timers, plots, events };
}

test('gráfico exibe os quatro estados e atualiza sem loading global', () => {
    const s = screen();
    const r = s.requests.find(r => r.url.endsWith('/cached-points'));
    assert.equal(r.config.hideLoading, true);
    r.ok({ data: { pointsCached: 2, pointsPartial: 5, pointsNoCached: 20, pointsNoData: 3 } });
    r.done();
    assert.deepEqual(Array.from(s.plots[0][0].values), [2, 5, 20, 3]);
    const timer = s.timers.find(t => t.delay === 30000);
    assert.ok(timer);
    timer.fn();
    assert.equal(s.requests.filter(r => r.url.endsWith('/cached-points')).length, 2);
});

test('saída da tela cancela atualização e ignora resposta atrasada', () => {
    const s = screen();
    const r = s.requests.find(r => r.url.endsWith('/cached-points'));
    s.events.$destroy();
    r.ok({ data: { pointsCached: 30, pointsNoCached: 0 } });
    r.done();
    assert.equal(s.plots.length, 0);
    assert.equal(s.timers.filter(t => t.delay === 30000).length, 0);
});
