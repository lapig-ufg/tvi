/**
 * Seção "Informações do ponto exibidas" do cadastro de campanha
 * (CampaignFormModalController em controllers/admin-modals.js e
 * views/campaign-form-modal.tpl.html): uma lista de colunas por idioma,
 * escolhidas entre as colunas da campanha, com ordem e rótulo opcional.
 *
 * O controller é executado em vm pelo auxiliar helpers/campaignFormModal.js.
 *
 * Execução:
 *   cd src/server && npm test
 *   ou
 *   node --test src/server/test/campaignPropertyDisplayForm.test.js
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const CLIENT_DIR = path.join(__dirname, '..', '..', 'client');
const PointPropertyDisplayCore = require(path.join(CLIENT_DIR, 'services', 'point-property-display-core'));
const { abrirModal } = require('./helpers/campaignFormModal');

function read(relative) {
    return fs.readFileSync(path.join(CLIENT_DIR, relative), 'utf8');
}

function plain(value) {
    return JSON.parse(JSON.stringify(value));
}

function campanha(extra) {
    return Object.assign({ _id: 'c', landUse: [], properties: ['Kel_Desa', 'Village', 'Satuan_BL'] }, extra);
}

test('template: uma lista por idioma com select de colunas, rótulo limitado a 60 e aviso sem colunas', () => {
    const template = read('views/campaign-form-modal.tpl.html');
    assert.match(template, /ng-repeat="list in propertyDisplayLists"/);
    assert.match(template, /ng-repeat="item in campaign\.propertyDisplay\[list\.id\] track by item\.key"/);
    assert.match(template, /<input[^>]*ng-model="item\.label"[^>]*maxlength="60"/);
    assert.match(template, /<select[^>]*ng-model="propertyDisplaySelection\[list\.id\]"[^>]*ng-options="key as key for key in availablePropertyKeys\(list\.id\)"/);
    assert.match(template, /ng-click="addPropertyDisplayItem\(list\.id\)"/);
    assert.match(template, /ng-click="movePropertyDisplayItem\(list\.id, \$index, -1\)"/);
    assert.match(template, /ng-click="movePropertyDisplayItem\(list\.id, \$index, 1\)"/);
    assert.match(template, /ng-click="removePropertyDisplayItem\(list\.id, \$index\)"/);
    assert.match(template, /As colunas ficam disponíveis após a importação dos pontos\./);
    assert.equal(PointPropertyDisplayCore.LIMITS.labelLength, 60);
});

test('controller: normaliza a configuração e expõe as listas na ordem padrão, pt-BR, en, id', () => {
    const { $scope } = abrirModal(campanha({ propertyDisplay: { id: [{ key: ' Kel_Desa ' }], es: [] } }), false);
    assert.deepEqual(plain($scope.campaign.propertyDisplay),
        { default: [], 'pt-BR': [], en: [], id: [{ key: 'Kel_Desa', label: '' }] });
    assert.deepEqual(plain($scope.propertyDisplayLists).map((l) => l.id), ['default', 'pt-BR', 'en', 'id']);
    assert.deepEqual(plain($scope.propertyKeys), ['Kel_Desa', 'Village', 'Satuan_BL']);
    assert.equal($scope.formatPropertyKey('Satuan_BL'), 'Satuan BL');
});

test('controller: adicionar não repete coluna, respeita o limite e oferece só colunas ainda não usadas', () => {
    const { $scope } = abrirModal(campanha(), false);
    $scope.propertyDisplaySelection.id = 'Kel_Desa';
    $scope.addPropertyDisplayItem('id');
    assert.deepEqual(plain($scope.campaign.propertyDisplay.id), [{ key: 'Kel_Desa', label: '' }]);
    assert.equal($scope.propertyDisplaySelection.id, '', 'seleção limpa após adicionar');
    assert.deepEqual(plain($scope.availablePropertyKeys('id')), ['Village', 'Satuan_BL']);
    assert.deepEqual(plain($scope.availablePropertyKeys('en')), ['Kel_Desa', 'Village', 'Satuan_BL'], 'listas independentes');

    $scope.propertyDisplaySelection.id = 'Kel_Desa';
    $scope.addPropertyDisplayItem('id');
    assert.equal($scope.campaign.propertyDisplay.id.length, 1, 'coluna repetida não entra');

    $scope.addPropertyDisplayItem('id');
    assert.equal($scope.campaign.propertyDisplay.id.length, 1, 'sem seleção nada entra');

    $scope.campaign.propertyDisplay.en = Array.from({ length: 30 }, (_, i) => ({ key: `c${i}`, label: '' }));
    $scope.propertyDisplaySelection.en = 'Village';
    $scope.addPropertyDisplayItem('en');
    assert.equal($scope.campaign.propertyDisplay.en.length, 30, 'o 31º item não entra');
});

test('controller: mover para cima e para baixo e remover', () => {
    const { $scope } = abrirModal(campanha({ propertyDisplay: { id: [{ key: 'A' }, { key: 'B' }, { key: 'C' }] } }), false);
    const chaves = () => $scope.campaign.propertyDisplay.id.map((item) => item.key);
    $scope.movePropertyDisplayItem('id', 2, -1);
    assert.deepEqual(chaves(), ['A', 'C', 'B']);
    $scope.movePropertyDisplayItem('id', 0, 1);
    assert.deepEqual(chaves(), ['C', 'A', 'B']);
    $scope.movePropertyDisplayItem('id', 0, -1);
    $scope.movePropertyDisplayItem('id', 2, 1);
    assert.deepEqual(chaves(), ['C', 'A', 'B'], 'movimento fora dos limites é ignorado');
    $scope.removePropertyDisplayItem('id', 1);
    assert.deepEqual(chaves(), ['C', 'B']);
});

test('controller: sem campaign.properties consulta /api/campaigns/:id/properties; campanha nova não consulta', () => {
    const url = '/api/campaigns/mapbiomas%20x/properties';
    const resposta = { data: { allProperties: [{ name: 'properties.Kel_Desa', isCustom: true }, { name: 'biome', isCustom: false }] } };
    let aberto = abrirModal(campanha({ _id: 'mapbiomas x', properties: [] }), false, { [url]: resposta });
    assert.deepEqual(plain(aberto.$scope.propertyKeys), ['Kel_Desa']);
    assert.ok(aberto.requisicoes.some((r) => r.url === url));

    aberto = abrirModal(campanha({ _id: 'mapbiomas x', properties: undefined }), false, { [url]: new Error('500') });
    assert.deepEqual(plain(aberto.$scope.propertyKeys), [], 'falha deixa a lista vazia');

    aberto = abrirModal({ landUse: [] }, true);
    assert.equal(aberto.requisicoes.filter((r) => /\/properties$/.test(r.url)).length, 0);
    assert.deepEqual(plain(aberto.$scope.propertyKeys), []);
});
