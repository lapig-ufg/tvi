/**
 * Diretiva <wayback-map> (client/directives/waybackMap.js) executada fora do
 * navegador: Angular, Leaflet, $timeout, mapSyncService e waybackGridService
 * simulados, com o WaybackGridCore real.
 *
 * Cobertura:
 *   - a amostra é desenhada como quadrado de 30 m (GeoJSON Polygon, sem
 *     interação) no lugar do marcador;
 *   - zoom inicial, mínimo e máximo derivados do zoom da campanha, com teto
 *     23 e reamostragem acima do nível 19 nos tiles;
 *   - células recicladas pelo ng-repeat (track by map.index): o quadrado e a
 *     vista acompanham o novo ponto e os limites acompanham um novo zoom;
 *   - cleanup no $destroy.
 *
 * Execução:
 *   cd src/server && npm test
 *   ou
 *   node --test src/server/test/waybackMapDirective.test.js
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const CLIENT_DIR = path.join(__dirname, '..', '..', 'client');
const DIRECTIVE_PATH = path.join(CLIENT_DIR, 'directives', 'waybackMap.js');
const core = require(path.join(CLIENT_DIR, 'services', 'wayback-grid-core'));

const WATCHED = ['lon', 'lat', 'tileUrl', 'mapDate', 'zoom'];

// Literais criados dentro do contexto vm têm protótipos de outro realm; o
// round-trip JSON permite a comparação estrutural estrita do assert.
function plain(value) {
    return JSON.parse(JSON.stringify(value));
}

function criarLeafletFalso() {
    const chamadas = { map: [], tileLayer: [], geoJSON: [], marker: [] };

    function criarMapa(opcoes) {
        const mapa = {
            opcoes: opcoes,
            layers: [],
            view: null,
            minZoom: opcoes.minZoom,
            maxZoom: opcoes.maxZoom,
            removed: false,
            setView: function (center, zoom) { mapa.view = { center: center, zoom: zoom }; },
            setMinZoom: function (z) { mapa.minZoom = z; },
            setMaxZoom: function (z) { mapa.maxZoom = z; },
            addLayer: function (l) { mapa.layers.push(l); },
            removeLayer: function (l) { mapa.layers = mapa.layers.filter(function (x) { return x !== l; }); },
            remove: function () { mapa.removed = true; }
        };
        return mapa;
    }

    const L = {
        map: function (el, opcoes) { const m = criarMapa(opcoes); chamadas.map.push(m); return m; },
        tileLayer: function (url, opcoes) {
            const layer = {
                url: url, opcoes: opcoes, handlers: {},
                on: function (evt, fn) { layer.handlers[evt] = fn; },
                off: function () {},
                addTo: function (m) { m.addLayer(layer); return layer; }
            };
            chamadas.tileLayer.push(layer);
            return layer;
        },
        geoJSON: function (data, opcoes) {
            const layer = {
                data: data ? [data] : [], opcoes: opcoes,
                clearLayers: function () { layer.data = []; },
                addData: function (d) { layer.data.push(d); },
                addTo: function (m) { m.addLayer(layer); return layer; }
            };
            chamadas.geoJSON.push(layer);
            return layer;
        },
        marker: function () {
            const layer = {
                setLatLng: function () {}, setZIndexOffset: function () {},
                addTo: function (m) { m.addLayer(layer); return layer; }
            };
            chamadas.marker.push(layer);
            return layer;
        },
        icon: function (o) { return o; }
    };
    return { L: L, chamadas: chamadas };
}

function carregarDiretiva(L) {
    const registro = {};
    const contexto = vm.createContext({
        angular: { module: function () { return { directive: function (nome, fabrica) { registro[nome] = fabrica; } }; } },
        L: L,
        window: {}
    });
    vm.runInContext(fs.readFileSync(DIRECTIVE_PATH, 'utf8'), contexto, { filename: DIRECTIVE_PATH });
    assert.ok(registro.waybackMap, 'diretiva waybackMap não registrada');
    return registro.waybackMap;
}

function instanciar(valores) {
    const { L, chamadas } = criarLeafletFalso();
    const fabrica = carregarDiretiva(L);
    const $timeout = function (fn) { fn(); };
    const mapSync = { registered: [], unregistered: [],
        register: function (m) { mapSync.registered.push(m); },
        unregister: function (m) { mapSync.unregistered.push(m); } };
    const watchers = [];
    const handlers = {};
    const $scope = Object.assign({
        $id: 7,
        $watchGroup: function (exprs, fn) { watchers.push({ exprs: exprs, fn: fn }); },
        $on: function (evt, fn) { handlers[evt] = fn; }
    }, valores);
    const $element = [{ querySelector: function (sel) { return sel === '#wayback-map-7' ? {} : null; } }];

    const ddo = fabrica($timeout, mapSync, { core: core });
    ddo.controller($scope, $element);

    function trocar(novos) {
        const antigos = WATCHED.map(function (k) { return $scope[k]; });
        Object.assign($scope, novos);
        const atuais = WATCHED.map(function (k) { return $scope[k]; });
        watchers.forEach(function (w) { w.fn(atuais, antigos); });
    }

    return { $scope: $scope, chamadas: chamadas, mapSync: mapSync, watchers: watchers, handlers: handlers, trocar: trocar };
}

const PONTO = { lon: -49.2, lat: -16.6, zoom: 13, tileUrl: 'https://w/tile/100/{z}/{y}/{x}', mapDate: '2018-06-06' };

test('célula desenha o quadrado de 30 m (GeoJSON Polygon, não interativo) no lugar do marcador', () => {
    const { chamadas } = instanciar(PONTO);
    assert.equal(chamadas.marker.length, 0, 'marcador não deve ser criado');
    assert.equal(chamadas.geoJSON.length, 1);
    const quadrado = chamadas.geoJSON[0];
    assert.deepEqual(plain(quadrado.data), [core.sampleSquareFeature(-49.2, -16.6)]);
    assert.equal(quadrado.opcoes.interactive, false);
    assert.deepEqual(plain(quadrado.opcoes.style), { color: '#29e7e4', weight: 2, fill: false });
    assert.ok(chamadas.map[0].layers.includes(quadrado), 'quadrado adicionado ao mapa');
});

test('zoom inicial e mínimo iguais ao da campanha; máximo zoom + 6 com teto 23; tiles reamostrados acima de 19', () => {
    const base = instanciar(PONTO);
    assert.equal(base.chamadas.map[0].opcoes.zoom, 13);
    assert.equal(base.chamadas.map[0].opcoes.minZoom, 13);
    assert.equal(base.chamadas.map[0].opcoes.maxZoom, 19);
    assert.equal(base.chamadas.tileLayer[0].opcoes.maxZoom, 19);
    assert.equal(base.chamadas.tileLayer[0].opcoes.maxNativeZoom, 19);

    const alto = instanciar(Object.assign({}, PONTO, { zoom: 18 }));
    assert.equal(alto.chamadas.map[0].opcoes.minZoom, 18);
    assert.equal(alto.chamadas.map[0].opcoes.maxZoom, 23);
    assert.equal(alto.chamadas.tileLayer[0].opcoes.maxZoom, 23);
});

test('troca de ponto na célula reciclada: quadrado, vista e tiles acompanham o novo ponto', () => {
    const { chamadas, trocar, watchers } = instanciar(PONTO);
    assert.equal(watchers.length, 1);
    assert.deepEqual(plain(watchers[0].exprs), WATCHED);

    trocar({ lon: -48.1, lat: -10.9, tileUrl: 'https://w/tile/200/{z}/{y}/{x}', mapDate: '2022-01-15' });

    const mapa = chamadas.map[0];
    assert.deepEqual(plain(mapa.view), { center: [-10.9, -48.1], zoom: 13 });
    assert.deepEqual(plain(chamadas.geoJSON[0].data), [core.sampleSquareFeature(-48.1, -10.9)]);
    assert.equal(chamadas.tileLayer.length, 2, 'tile layer recriada para a nova release');
    assert.equal(chamadas.tileLayer[1].url, 'https://w/tile/200/{z}/{y}/{x}');
    assert.ok(!mapa.layers.includes(chamadas.tileLayer[0]), 'tile layer anterior removida');
});

test('zoom reconfigurado entre pontos atualiza os limites do mapa e da tile layer', () => {
    const { chamadas, trocar } = instanciar(PONTO);
    trocar({ zoom: 17 });
    const mapa = chamadas.map[0];
    assert.equal(mapa.minZoom, 17);
    assert.equal(mapa.maxZoom, 23);
    assert.deepEqual(plain(mapa.view), { center: [-16.6, -49.2], zoom: 17 });
    assert.equal(chamadas.tileLayer[chamadas.tileLayer.length - 1].opcoes.maxZoom, 23);
});

test('aviso de tile liga no tileerror e desliga quando a camada inicia um novo carregamento', () => {
    const { $scope, chamadas } = instanciar(PONTO);
    const tiles = chamadas.tileLayer[0];
    assert.equal($scope.tileError, false);
    tiles.handlers.tileerror();
    assert.equal($scope.tileError, true, 'tile ausente marca o aviso');
    assert.equal(typeof tiles.handlers.loading, 'function', 'camada deve observar o evento loading');
    tiles.handlers.loading();
    assert.equal($scope.tileError, false, 'novo lote de tiles (outro zoom) limpa o aviso');
});

test('$destroy remove tiles e quadrado, desregistra do mapSyncService e destrói o mapa', () => {
    const { chamadas, handlers, mapSync } = instanciar(PONTO);
    const mapa = chamadas.map[0];
    handlers.$destroy();
    assert.deepEqual(mapa.layers, []);
    assert.deepEqual(mapSync.unregistered, [mapa]);
    assert.equal(mapa.removed, true);
});
