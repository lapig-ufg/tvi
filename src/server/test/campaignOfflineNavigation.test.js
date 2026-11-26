'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const client = path.join(__dirname, '../../client');

test('link antigo de cache direciona à seleção de campanhas', () => {
    const routes = {};
    const provider = { when(url, config) { routes[url] = config; return this; }, otherwise() { return this; } };
    const app = { config(fn) {
        if (fn.length === 3) fn(provider, {}, { defaults: {} });
        return this;
    }, run() { return this; } };
    vm.runInNewContext(fs.readFileSync(path.join(client, 'app.js'), 'utf8'), {
        angular: { module() { return app; } }
    });
    assert.equal(routes['/admin/cache-tiles'].redirectTo, '/admin/campaigns');
    assert.equal(routes['/admin/cache-tiles'].controller, undefined);
    assert.equal(routes['/admin/campaigns/manage/:id'].controller, 'CampaignManagementController');
});

test('gerenciamento da campanha é o ponto de entrada para o cache offline', () => {
    const home = fs.readFileSync(path.join(client, 'views/admin-home.tpl.html'), 'utf8');
    const index = fs.readFileSync(path.join(client, 'index.html'), 'utf8');
    const management = fs.readFileSync(path.join(client, 'views/campaign-management.tpl.html'), 'utf8');
    assert.doesNotMatch(home, /navigateTo\('\/admin\/cache-tiles'\)/);
    assert.doesNotMatch(index, /controllers\/cache-manager-tiles\.js/);
    assert.match(index, /others\/campaign-offline-cache\.js/);
    assert.match(management, /<campaign-offline-cache campaign-id="campaignId" campaign="details.campaign"/);
});
