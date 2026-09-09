/**
 * Testes da visualização mensal Sentinel no modal de comparação de imagens
 * (controllers/mosaic-dialog.js e views/mosaic-dialog.tpl.html).
 *
 * Contexto (2026-09): o toggle "Visualização Mensal Sentinel" passou a ficar
 * dentro de um `ng-if`, que cria escopo filho no AngularJS. Como o estado era
 * um booleano primitivo no escopo do controller, o `ng-model` gravava a
 * alteração no escopo filho e o controller continuava lendo `false`: o switch
 * acendia, mas o slider de meses não aparecia e os tiles seguiam no período
 * WET/DRY. O estado mensal agora vive em um objeto (`monthly`), cuja
 * referência é compartilhada com qualquer escopo filho.
 *
 * Cobertura:
 *   - Execução do controller com dependências simuladas: período MONTH e mês
 *     na camada direita quando o modo mensal está ativo; debounce da troca de
 *     mês preservando a camada esquerda.
 *   - Guarda estática do template: toda ligação `ng-model` usa caminho com
 *     ponto, o slider aciona o debounce e o toggle segue condicionado à
 *     cobertura Sentinel do ano.
 *
 * Execução:
 *   cd src/server && npm test
 *   ou
 *   node --test src/server/test/mosaicDialogMonthly.test.js
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
    $timeout.pendentes = pendentes;
    return $timeout;
}

function intervalo(inicio, fim) {
    const anos = [];
    for (let a = inicio; a <= fim; a++) anos.push(a);
    return anos;
}

function instanciar(opcoes) {
    const controller = carregarController();
    const $timeout = criarTimeoutFalso();
    const $scope = {
        $on: function () {}
    };
    const capabilities = [
        {
            name: 's2_harmonized',
            satellite: 'sentinel',
            visparam: ['tvi-red', 'tvi-green'],
            visparam_details: [
                { name: 'tvi-red', display_name: 'TVI Red' },
                { name: 'tvi-green', display_name: 'TVI Green' }
            ],
            year: intervalo(2017, 2026)
        },
        {
            name: 'landsat',
            satellite: 'landsat',
            visparam: ['landsat-tvi-true'],
            visparam_details: [{ name: 'landsat-tvi-true', display_name: 'Landsat TVI True' }],
            year: intervalo(1985, 2026)
        }
    ];

    controller(
        $scope,
        { dismiss: function () {} },
        [],
        { year: (opcoes && opcoes.year) || 2023, bounds: null },
        { lon: -49.2, lat: -16.6 },
        { zoomLevel: 13 },
        capabilities,
        (opcoes && opcoes.period) || 'DRY',
        { has: function () { return false; } },
        $timeout
    );

    return { $scope: $scope, $timeout: $timeout };
}

test('estado inicial: camada direita usa o período da campanha e não envia mês', () => {
    const { $scope } = instanciar({ period: 'DRY' });

    assert.equal($scope.monthly.enabled, false);
    assert.ok($scope.monthly.month >= 1 && $scope.monthly.month <= 12);
    assert.equal($scope.rightMapConfig.period, 'DRY');
    assert.equal($scope.rightMapConfig.month, null);
    assert.equal($scope.rightLayerLabel, 'Sentinel 2023 - DRY');
});

test('modo mensal ativo: camada direita passa a MONTH com o mês selecionado', () => {
    const { $scope } = instanciar({ period: 'DRY' });

    $scope.monthly.enabled = true;
    $scope.monthly.month = 7;
    $scope.updateMapLayers();

    assert.equal($scope.rightMapConfig.period, 'MONTH');
    assert.equal($scope.rightMapConfig.month, 7);
    assert.equal($scope.rightMapConfig.collection, 's2_harmonized');
    assert.equal($scope.rightLayerLabel, 'Sentinel 2023 - Julho');
    assert.equal($scope.leftMapConfig.period, 'DRY', 'camada Landsat não muda com o modo mensal');
});

test('troca de mês pelo slider é aplicada com debounce e preserva a camada esquerda', () => {
    const { $scope, $timeout } = instanciar({ period: 'WET' });

    $scope.monthly.enabled = true;
    $scope.monthly.month = 2;
    $scope.updateMapLayers();
    const esquerdaAntes = $scope.leftMapConfig;

    $scope.monthly.month = 3;
    $scope.updateMapLayers(true, true);
    assert.equal($scope.rightMapConfig.month, 2, 'atualização adiada até o timer disparar');

    $scope.monthly.month = 4;
    $scope.updateMapLayers(true, true);
    assert.equal($timeout.pendentes.filter(function (t) { return !t.cancelada; }).length, 1,
        'apenas o último timer permanece ativo');

    $timeout.flush();
    assert.equal($scope.rightMapConfig.month, 4);
    assert.equal($scope.rightLayerLabel, 'Sentinel 2023 - Abril');
    assert.equal($scope.leftMapConfig, esquerdaAntes, 'camada esquerda mantém a mesma referência');
});

test('desligar o modo mensal devolve a camada direita ao período da campanha', () => {
    const { $scope } = instanciar({ period: 'WET' });

    $scope.monthly.enabled = true;
    $scope.updateMapLayers();
    assert.equal($scope.rightMapConfig.period, 'MONTH');

    $scope.monthly.enabled = false;
    $scope.updateMapLayers();
    assert.equal($scope.rightMapConfig.period, 'WET');
    assert.equal($scope.rightMapConfig.month, null);
});

test('template: ligações ng-model usam caminho com ponto e o slider aciona o debounce', () => {
    const html = fs.readFileSync(TEMPLATE_PATH, 'utf8');

    const ligacoes = Array.from(html.matchAll(/ng-model="([^"]+)"/g)).map(function (m) { return m[1]; });
    assert.ok(ligacoes.length >= 2, 'esperadas ao menos duas ligações ng-model no template');
    ligacoes.forEach(function (expr) {
        assert.ok(expr.indexOf('.') !== -1,
            'ng-model="' + expr + '" precisa referenciar um objeto do controller (regra do ponto)');
    });

    assert.match(html, /ng-model="monthly\.enabled"/);
    assert.match(html, /ng-show="monthly\.enabled"/);
    assert.match(html, /ng-model="monthly\.month"[\s\S]*?ng-change="updateMapLayers\(true,\s*true\)"/);
    assert.match(html, /<div class="control-group" ng-if="hasSentinelImageForYear\(year\)">/);
    assert.ok(!/showMonthlyView|selectedMonth/.test(html), 'identificadores antigos não devem permanecer no template');
});
