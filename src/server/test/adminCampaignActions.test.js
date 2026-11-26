'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const client = path.join(__dirname, '../../client');

function controller() {
    let factory;
    const timers = [], events = {}, nodes = {};
    const scope = { $root: {}, $on(name, fn) { events[name] = fn; } };
    const pending = { then() { return this; }, catch() { return this; } };
    function timeout(fn) { const timer = { fn }; timers.push(timer); return timer; }
    timeout.cancel = timer => { if (timer) timer.cancelled = true; };
    const window = { innerWidth: 360, innerHeight: 640, pageYOffset: 100, pageXOffset: 0,
        document: { getElementById: id => nodes[id] } };
    vm.runInNewContext(fs.readFileSync(path.join(client, 'controllers/admin-campaign.js'), 'utf8'), {
        Application: { controller(name, fn) { factory = fn; } }
    });
    factory(scope, { get: () => pending }, {}, window, { search: () => ({}) }, timeout, {}, { core: { defaults: () => ({}) } });
    return { scope, timers, events, nodes, window };
}

test('menu mantém todas as ações e as condições de disponibilidade da listagem', () => {
    const source = fs.readFileSync(path.join(client, 'views/admin-campaigns.tpl.html'), 'utf8');
    const conditions = { manageCampaign: '', monitorCampaign: 'ng-disabled="!campaign.totalPoints"',
        manageBlocks: 'ng-disabled="!campaign.totalPoints"', editCampaign: '', uploadGeoJSON: '',
        importClassifications: 'ng-disabled="!campaign.totalPoints"', viewPoints: 'ng-disabled="!campaign.totalPoints"',
        deletePoints: 'ng-disabled="!campaign.totalPoints"', manageExcessInspections: 'ng-show="campaign.numInspec > 0"',
        manageZombies: 'ng-show="campaign.numInspec > 0"', deleteCampaign: 'ng-disabled="campaign.totalPoints > 0"' };
    const buttons = source.match(/<button\b(?:[^>"']|"[^"]*"|'[^']*')*>[\s\S]*?<\/button>/g);
    for (const [handler, condition] of Object.entries(conditions)) {
        const matches = buttons.filter(button => button.includes('ng-click="' + handler + '(campaign)"'));
        assert.equal(matches.length, 1, handler);
        if (condition) assert.ok(matches[0].includes(condition), handler);
        assert.match(matches[0], /<span>[^<]+<\/span>/, handler + ' precisa de nome visível');
    }
    assert.match(source, /dropdown-append-to-body/);
    assert.match(source, /uib-dropdown-menu/);
    assert.match(source, /Mais ações/);
    assert.match(source, /Acompanhamento/);
    assert.match(source, /Dados/);
    assert.match(source, /Manutenção/);
});

test('setas e limites percorrem somente ações visíveis e habilitadas', () => {
    const c = controller();
    const focused = [];
    const button = (id, disabled = false, visible = true) => ({ disabled,
        getClientRects: () => visible ? [{}] : [], focus: () => focused.push(id) });
    const first = button('first'), disabled = button('disabled', true), hidden = button('hidden', false, false), last = button('last');
    const menu = { querySelectorAll: () => [first, disabled, hidden, last] };
    const event = key => ({ key, target: first, currentTarget: menu, preventDefault() {}, stopPropagation() {} });
    assert.equal(c.scope.campaignMenuKeydown(event('ArrowDown'), true), true);
    assert.equal(focused.at(-1), 'last');
    c.scope.campaignMenuKeydown(event('End'), true);
    assert.equal(focused.at(-1), 'last');
    c.scope.campaignMenuKeydown(event('Home'), true);
    assert.equal(focused.at(-1), 'first');
});

test('Escape fecha menu e devolve foco ao controle; abertura cabe na janela', () => {
    const c = controller();
    let focused = 0;
    c.nodes.toggle = { focus() { focused++; } };
    const menu = c.nodes.menu = { style: {}, getAttribute: () => 'toggle',
        getBoundingClientRect: () => ({ top: 600, bottom: 1080, height: 480, left: -15, right: 285, width: 300 }),
        querySelectorAll: () => [{ disabled: false, getClientRects: () => [{}], focus() { focused++; } }] };
    const event = { key: 'Escape', currentTarget: menu, preventDefault() {}, stopPropagation() {} };
    assert.equal(c.scope.campaignMenuKeydown(event, true), false);
    assert.equal(focused, 1);
    c.scope.campaignActionsToggled(true, 'menu');
    c.timers.at(-1).fn();
    assert.equal(menu.style.top, '248px');
    assert.equal(menu.style.left, '12px');
    assert.equal(focused, 2);
    c.scope.campaignActionsToggled(true, 'menu');
    c.events.$destroy();
    assert.equal(c.timers.at(-1).cancelled, true);
});
