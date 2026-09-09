/**
 * Testes da legenda de índice no modal de comparação de imagens
 * (controllers/mosaic-dialog.js e views/mosaic-dialog.tpl.html).
 *
 * Contexto (2026-09): o serviço de tiles passou a publicar visparams de
 * índice (NDVI) com um objeto `legend` (rótulo, mínimo, máximo e paleta) em
 * `visparam_details`. Uma imagem de banda única com paleta não é
 * interpretável sem a barra de cores, então o modal desenha a legenda do
 * lado cujo visparam selecionado a possui.
 *
 * Cobertura:
 *   - `getLegend` devolve a legenda do visparam selecionado de cada lado e
 *     `null` quando o visparam não tem legenda ou os detalhes não chegaram.
 *   - `getLegendGradient` monta o gradiente CSS a partir da paleta.
 *   - Guarda estática do template: bloco de legenda nos dois lados, ligado
 *     às funções acima.
 *
 * Execução:
 *   cd src/server && npm test
 *   ou
 *   node --test src/server/test/mosaicDialogLegend.test.js
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const CLIENT_DIR = path.join(__dirname, '..', '..', 'client');
const CONTROLLER_PATH = path.join(CLIENT_DIR, 'controllers', 'mosaic-dialog.js');
const TEMPLATE_PATH = path.join(CLIENT_DIR, 'views', 'mosaic-dialog.tpl.html');

const NDVI_LEGEND = {
    label: 'NDVI',
    min: -0.2,
    max: 0.9,
    palette: ['#a52a2a', '#fff2a8', '#006837']
};

function carregarController() {
    const registro = {};
    const contexto = vm.createContext({
        Application: {
            controller: function (nome, fn) { registro[nome] = fn; }
        }
    });
    vm.runInContext(fs.readFileSync(CONTROLLER_PATH, 'utf8'), contexto, { filename: CONTROLLER_PATH });
    assert.ok(registro.MosaicDialogController, 'MosaicDialogController não registrado');
    return registro.MosaicDialogController;
}

function criarTimeoutFalso() {
    const pendentes = [];
    const $timeout = function (fn) {
        const tarefa = { fn: fn, cancelada: false };
        pendentes.push(tarefa);
        return tarefa;
    };
    $timeout.cancel = function (tarefa) {
        if (tarefa) tarefa.cancelada = true;
    };
    $timeout.flush = function () {
        const lote = pendentes.splice(0, pendentes.length);
        lote.forEach(function (t) { if (!t.cancelada) t.fn(); });
    };
    return $timeout;
}

function intervalo(inicio, fim) {
    const anos = [];
    for (let a = inicio; a <= fim; a++) anos.push(a);
    return anos;
}

function capabilities() {
    return [
        {
            name: 's2_harmonized',
            satellite: 'sentinel',
            visparam: ['tvi-red', 'tvi-ndvi'],
            visparam_details: [
                { name: 'tvi-red', display_name: 'TVI Red' },
                { name: 'tvi-ndvi', display_name: 'NDVI', legend: NDVI_LEGEND }
            ],
            year: intervalo(2017, 2026)
        },
        {
            name: 'landsat',
            satellite: 'landsat',
            visparam: ['landsat-tvi-true', 'landsat-tvi-ndvi'],
            visparam_details: [
                { name: 'landsat-tvi-true', display_name: 'True Color' },
                { name: 'landsat-tvi-ndvi', display_name: 'NDVI', legend: NDVI_LEGEND }
            ],
            year: intervalo(1985, 2026)
        }
    ];
}

function instanciar(caps) {
    const controller = carregarController();
    const $timeout = criarTimeoutFalso();
    const $scope = { $on: function () {} };
    controller(
        $scope,
        { dismiss: function () {} },
        [],
        { year: 2023, bounds: null },
        { lon: -49.2, lat: -16.6 },
        { zoomLevel: 13 },
        caps === undefined ? capabilities() : caps,
        'DRY',
        { has: function () { return false; } },
        $timeout
    );
    return { $scope: $scope, $timeout: $timeout };
}

test('visparam inicial sem legenda: getLegend devolve null nos dois lados', () => {
    const { $scope } = instanciar();
    assert.equal($scope.getLegend('sentinel'), null);
    assert.equal($scope.getLegend('landsat'), null);
});

test('selecionar o NDVI de cada lado expõe a legenda correspondente', () => {
    const { $scope, $timeout } = instanciar();

    $scope.selectSentinelVisparam('tvi-ndvi');
    $scope.selectLandsatVisparam('landsat-tvi-ndvi');
    $timeout.flush();

    assert.deepEqual($scope.getLegend('sentinel'), NDVI_LEGEND);
    assert.deepEqual($scope.getLegend('landsat'), NDVI_LEGEND);
    assert.equal($scope.rightMapConfig.visparam, 'tvi-ndvi');
    assert.equal($scope.leftMapConfig.visparam, 'landsat-tvi-ndvi');
});

test('voltar a um visparam de composição remove a legenda', () => {
    const { $scope, $timeout } = instanciar();
    $scope.selectSentinelVisparam('tvi-ndvi');
    $timeout.flush();
    assert.ok($scope.getLegend('sentinel'));

    $scope.selectSentinelVisparam('tvi-red');
    $timeout.flush();
    assert.equal($scope.getLegend('sentinel'), null);
});

test('sem capabilities, getLegend devolve null sem lançar', () => {
    const { $scope } = instanciar([]);
    assert.equal($scope.getLegend('sentinel'), null);
    assert.equal($scope.getLegend('landsat'), null);
});

test('legenda com paleta de uma cor é ignorada', () => {
    const caps = capabilities();
    caps[0].visparam_details[1].legend = { label: 'NDVI', min: 0, max: 1, palette: ['#000'] };
    const { $scope, $timeout } = instanciar(caps);
    $scope.selectSentinelVisparam('tvi-ndvi');
    $timeout.flush();
    assert.equal($scope.getLegend('sentinel'), null);
});

test('getLegendGradient monta o gradiente CSS a partir da paleta', () => {
    const { $scope } = instanciar();
    assert.equal(
        $scope.getLegendGradient(NDVI_LEGEND),
        'linear-gradient(to right, #a52a2a, #fff2a8, #006837)'
    );
    assert.equal($scope.getLegendGradient(null), '');
    assert.equal($scope.getLegendGradient({ palette: ['#000'] }), '');
});

test('template: bloco de legenda nos dois lados, ligado a getLegend e ao gradiente', () => {
    const html = fs.readFileSync(TEMPLATE_PATH, 'utf8');

    assert.match(html, /class="left-layer-info"[\s\S]*?ng-if="leftMapConfig && getLegend\('landsat'\)"/);
    assert.match(html, /class="right-layer-info"[\s\S]*?ng-if="rightMapConfig && getLegend\('sentinel'\)"/);
    assert.equal((html.match(/class="layer-legend"/g) || []).length, 2);
    assert.equal((html.match(/class="legend-bar" ng-style="\{'background': getLegendGradient\(getLegend\('(landsat|sentinel)'\)\)\}"/g) || []).length, 2);
    assert.match(html, /\.legend-bar\s*\{/);
});
