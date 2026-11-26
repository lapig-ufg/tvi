'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function setup() {
    const watches = [], events = {}, requestedProfiles = [];
    let definition, focused = 0, callback;
    const scope = { point: { _id: 'point', lat: -15, lon: -48 }, year: 2020, period: 'DRY',
        historical: true, selectionId: 'original', profile: 'recorded', config: {},
        $watchGroup(names, fn) { watches.push(fn); }, $on(name, fn) { events[name] = fn; } };
    const timeout = () => {};
    timeout.cancel = () => {};
    const imagery = { observe(options, accept) { callback = accept; return () => {}; },
        tileUrl(data, profile) { requestedProfiles.push(profile); return profile === 'alternative' ? '/available' : null; } };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../client/directives/bdcMap.js'), 'utf8'), {
        angular: { module: () => ({ directive(name, factory) { definition = factory({}, timeout, imagery, {}, {}, {}); } }) }
    });
    definition.link(scope, [{ querySelector: () => ({ focus() { focused++; } }) }]);
    watches[0]();
    return { scope, watches, events, definition, requestedProfiles, focused: () => focused, accept: data => callback(data) };
}

test('informações fecham com Escape e devolvem foco ao botão', () => {
    const d = setup();
    d.scope.toggleInformation();
    assert.equal(d.scope.informationOpen, true);
    let prevented = false, stopped = false;
    d.scope.informationKeydown({ key: 'Escape', preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } });
    assert.equal(d.scope.informationOpen, false);
    assert.equal(d.focused(), 1);
    assert.ok(prevented && stopped);
});

test('troca de ponto e destruição encerram informações sem foco tardio', () => {
    const d = setup();
    d.scope.toggleInformation();
    d.scope.image = { datetime: '2020-01-01' };
    d.watches[0]();
    assert.equal(d.scope.informationOpen, false);
    assert.equal(d.scope.image, null);
    d.scope.toggleInformation();
    d.events.$destroy();
    assert.equal(d.scope.informationOpen, false);
    d.scope.closeInformation(true);
    assert.equal(d.focused(), 0);
});

test('perfil histórico indisponível nunca é substituído por composição alternativa', () => {
    const d = setup();
    d.accept({ id: 'original', state: 'ready', local: {}, profiles: [{ id: 'alternative' }] });
    assert.deepEqual(d.requestedProfiles, ['recorded']);
    assert.equal(d.scope.effectiveProfile, 'recorded');
    assert.equal(d.scope.statusKey, 'BDC.PROFILE_UNAVAILABLE');
    assert.equal(d.scope.retryable, false);
});

test('informações possuem controle acessível e imagem pronta não mantém status sobre o mapa', () => {
    const template = setup().definition.template;
    assert.match(template, /aria-expanded="{{informationOpen}}"/);
    assert.match(template, /aria-controls="bdc-information-{{\$id}}"/);
    assert.match(template, /ng-show="informationOpen" role="region"/);
    assert.match(template, /ng-if="statusKey !== 'BDC.READY'"/);
});
