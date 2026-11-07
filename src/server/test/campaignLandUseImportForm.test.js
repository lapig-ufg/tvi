/**
 * Importação das classes de outra campanha no cadastro
 * (CampaignFormModalController e campaign-form-modal.tpl.html): busca das
 * origens, prévia, substituição da lista com confirmação e descarte de
 * respostas de buscas antigas.
 *
 * O controller é executado em vm pelo auxiliar helpers/campaignFormModal.js.
 *
 * Execução:
 *   cd src/server && npm test
 *   ou
 *   node --test src/server/test/campaignLandUseImportForm.test.js
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { abrirModal, promessa } = require('./helpers/campaignFormModal');

const CLIENT_DIR = path.join(__dirname, '..', '..', 'client');
const BUSCA = '/api/campaigns/search';
const ORIGEM = { id: 'mapbiomas_indonesia_col2_cp1', initialYear: 1988, finalYear: 2026, imageType: 'landsat',
    label: 'x', landUse: ['Hutan alam', 'Mangrove', 'Sawit'] };

function read(relative) {
    return fs.readFileSync(path.join(CLIENT_DIR, relative), 'utf8');
}

function plain(value) {
    return JSON.parse(JSON.stringify(value));
}

function buscaCom(resultados) {
    return { [BUSCA]: { data: { success: true, results: resultados } } };
}

test('template: botão, busca com debounce, prévia e confirmação na seção de classes', () => {
    const template = read('views/campaign-form-modal.tpl.html');
    assert.match(template, /ng-click="toggleLandUseImport\(\)"[^>]*>\s*<i[^>]*><\/i>\s*Importar de outra campanha/);
    assert.match(template, /<input[^>]*ng-model="landUseImport\.query"[^>]*ng-model-options="\{ debounce: 300 \}"[^>]*ng-change="searchLandUseSources\(\)"/);
    assert.match(template, /ng-repeat="source in landUseImport\.results track by source\.id"/);
    assert.match(template, /ng-click="selectLandUseSource\(source\)"/);
    assert.match(template, /ng-repeat="lu in landUseImport\.selected\.landUse track by \$index"/);
    assert.match(template, /ng-click="confirmLandUseImport\(\)"/);
});

test('index.html carrega o núcleo da importação de classes', () => {
    assert.match(read('index.html'), /<script src="services\/land-use-import-core\.js"><\/script>/);
});

test('busca consulta a origem com classes, exclui a própria campanha e exige 2 caracteres', () => {
    const atual = Object.assign({}, ORIGEM, { id: 'atual' });
    const { $scope, requisicoes } = abrirModal({ _id: 'atual', landUse: [] }, false, buscaCom([ORIGEM, atual]));
    $scope.toggleLandUseImport();
    assert.equal($scope.landUseImport.open, true);

    $scope.landUseImport.query = 'i';
    $scope.searchLandUseSources();
    assert.equal(requisicoes.filter((r) => r.url === BUSCA).length, 0, 'menos de 2 caracteres não consulta');

    $scope.landUseImport.query = ' indonesia ';
    $scope.searchLandUseSources();
    const busca = requisicoes.find((r) => r.url === BUSCA);
    assert.deepEqual(plain(busca.config.params), { q: 'indonesia', limit: 20, withLandUse: true });
    assert.deepEqual(plain($scope.landUseImport.results), [{ id: ORIGEM.id, count: 3, landUse: ORIGEM.landUse }]);
    assert.equal($scope.landUseImport.loading, false);
});

test('resposta de uma busca antiga não sobrescreve a busca atual', () => {
    const pendentes = [];
    const respostas = { [BUSCA]: () => { const p = promessa(undefined, undefined, true); pendentes.push(p); return p; } };
    const { $scope } = abrirModal({ _id: 'c', landUse: [] }, true, respostas);
    $scope.toggleLandUseImport();
    $scope.landUseImport.query = 'indo';
    $scope.searchLandUseSources();
    $scope.landUseImport.query = 'brasil';
    $scope.searchLandUseSources();
    pendentes[1].resolver({ data: { results: [Object.assign({}, ORIGEM, { id: 'brasil_a' })] } });
    pendentes[0].resolver({ data: { results: [ORIGEM] } });
    assert.deepEqual($scope.landUseImport.results.map((s) => s.id), ['brasil_a']);
});

test('lista vazia: importa direto, sem confirmação, cópia exata da origem', () => {
    const { $scope, confirmacoes } = abrirModal({ _id: 'nova', landUse: [], defaultLandUse: '' }, true, buscaCom([ORIGEM]));
    $scope.toggleLandUseImport();
    $scope.landUseImport.query = 'indo';
    $scope.searchLandUseSources();
    $scope.selectLandUseSource($scope.landUseImport.results[0]);
    $scope.confirmLandUseImport();
    assert.equal(confirmacoes.length, 0);
    assert.deepEqual(plain($scope.campaign.landUse), ORIGEM.landUse);
    assert.notEqual($scope.campaign.landUse, $scope.landUseImport.results[0] && $scope.landUseImport.results[0].landUse);
    assert.equal($scope.landUseImport.open, false, 'painel fecha após importar');
});

test('lista preenchida: pede confirmação, substitui e trata a classe padrão; recusa mantém a lista', () => {
    const campanha = { _id: 'c', landUse: ['Pastagem', 'Mangrove'], defaultLandUse: 'Pastagem' };
    let aberto = abrirModal(Object.assign({}, campanha), true, buscaCom([ORIGEM]), true);
    aberto.$scope.toggleLandUseImport();
    aberto.$scope.landUseImport.query = 'indo';
    aberto.$scope.searchLandUseSources();
    aberto.$scope.selectLandUseSource(aberto.$scope.landUseImport.results[0]);
    aberto.$scope.confirmLandUseImport();
    assert.equal(aberto.confirmacoes.length, 1);
    assert.equal(aberto.confirmacoes[0].titulo, 'Importar classes');
    assert.match(aberto.confirmacoes[0].mensagem, /2 classes atuais serão substituídas pelas 3 classes de mapbiomas_indonesia_col2_cp1/);
    assert.doesNotMatch(aberto.confirmacoes[0].mensagem, /Inspeções/, 'campanha nova não tem inspeções');
    assert.deepEqual(plain(aberto.$scope.campaign.landUse), ORIGEM.landUse);
    assert.equal(aberto.$scope.campaign.defaultLandUse, '', 'classe padrão ausente na origem é limpa');

    aberto = abrirModal(Object.assign({}, campanha, { landUse: ['Pastagem', 'Mangrove'] }), false, buscaCom([ORIGEM]), false);
    aberto.$scope.toggleLandUseImport();
    aberto.$scope.landUseImport.query = 'indo';
    aberto.$scope.searchLandUseSources();
    aberto.$scope.selectLandUseSource(aberto.$scope.landUseImport.results[0]);
    aberto.$scope.confirmLandUseImport();
    assert.match(aberto.confirmacoes[0].mensagem, /Inspeções já registradas mantêm os nomes antigos das classes\./);
    assert.deepEqual(plain(aberto.$scope.campaign.landUse), ['Pastagem', 'Mangrove'], 'recusa mantém a lista');
    assert.equal(aberto.$scope.campaign.defaultLandUse, 'Pastagem');
});

test('mensagem no singular quando há uma classe de cada lado', () => {
    const origem = Object.assign({}, ORIGEM, { landUse: ['Sawit'] });
    const { $scope, confirmacoes } = abrirModal({ _id: 'c', landUse: ['Pastagem'] }, true, buscaCom([origem]));
    $scope.toggleLandUseImport();
    $scope.landUseImport.query = 'indo';
    $scope.searchLandUseSources();
    $scope.selectLandUseSource($scope.landUseImport.results[0]);
    $scope.confirmLandUseImport();
    assert.match(confirmacoes[0].mensagem, /^A classe atual será substituída pela classe de mapbiomas_indonesia_col2_cp1\.$/);
});
