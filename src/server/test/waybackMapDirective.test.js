/**
 * Diretiva <wayback-map> (client/directives/waybackMap.js) executada fora do
 * navegador: Angular, Leaflet, $timeout, mapSyncService e sampleMarkerService
 * simulados.
 *
 * Cobertura:
 *   - a amostra é criada pelo sampleMarkerService com a configuração da
 *     campanha (marcador, quadrado ou círculo), nunca por L.marker/L.geoJSON;
 *   - zoom inicial, mínimo e máximo derivados do zoom da campanha, com teto
 *     23 e reamostragem acima do nível 19 nos tiles;
 *   - células recicladas pelo ng-repeat (track by map.index): o símbolo e a
 *     vista acompanham o novo ponto, os limites acompanham um novo zoom e a
 *     camada é recriada quando a configuração do símbolo muda;
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
const core = require(path.join(CLIENT_DIR, 'services', 'sample-marker-core'));

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
            hasLayer: function (l) { return mapa.layers.indexOf(l) !== -1; },
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
        geoJSON: function () { chamadas.geoJSON.push({}); return {}; },
        marker: function () { chamadas.marker.push({}); return {}; },
        icon: function (o) { return o; }
    };
    return { L: L, chamadas: chamadas };
}

function criarSampleMarkerFalso() {
    const camadas = [];
    const service = {
        core: core,
        createLayer: function (latlng, config, options) {
            const layer = {
                latlng: latlng, config: config, options: options, moves: [], front: 0,
                setLatLng: function (ll) { layer.latlng = ll; layer.moves.push(ll); return layer; },
                setZIndexOffset: function () { layer.front += 1; return layer; },
                addTo: function (m) { m.addLayer(layer); return layer; }
            };
            camadas.push(layer);
            return layer;
        }
    };
    return { service: service, camadas: camadas };
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
    const sampleMarker = criarSampleMarkerFalso();
    const fabrica = carregarDiretiva(L);
    const $timeout = function (fn) { fn(); };
    const mapSync = { registered: [], unregistered: [],
        register: function (m) { mapSync.registered.push(m); },
        unregister: function (m) { mapSync.unregistered.push(m); } };
    const watchers = [];
    const watches = [];
    const handlers = {};
    const $scope = Object.assign({
        $id: 7,
        $watchGroup: function (exprs, fn) { watchers.push({ exprs: exprs, fn: fn }); },
        $watch: function (expr, fn, deep) { watches.push({ expr: expr, fn: fn, deep: deep }); },
        $on: function (evt, fn) { handlers[evt] = fn; }
    }, valores);
    const $element = [{ querySelector: function (sel) { return sel === '#wayback-map-7' ? {} : null; } }];

    const ddo = fabrica($timeout, mapSync, sampleMarker.service);
    assert.equal(ddo.scope.sampleMarker, '=', 'diretiva deve receber sampleMarker por atributo');
    ddo.controller($scope, $element);

    function trocar(novos) {
        const antigos = WATCHED.map(function (k) { return $scope[k]; });
        Object.assign($scope, novos);
        const atuais = WATCHED.map(function (k) { return $scope[k]; });
        watchers.forEach(function (w) { w.fn(atuais, antigos); });
    }

    function trocarSimbolo(novo) {
        const antigo = $scope.sampleMarker;
        $scope.sampleMarker = novo;
        watches.filter(function (w) { return w.expr === 'sampleMarker'; })
            .forEach(function (w) { w.fn(novo, antigo); });
    }

    return { $scope: $scope, chamadas: chamadas, camadas: sampleMarker.camadas, mapSync: mapSync,
        watchers: watchers, watches: watches, handlers: handlers, trocar: trocar, trocarSimbolo: trocarSimbolo };
}

const SIMBOLO = { symbol: 'square', radiusMeters: 15, color: '#29e7e4', weight: 2, fill: false, fillOpacity: 0.2 };
const PONTO = { lon: -49.2, lat: -16.6, zoom: 13, tileUrl: 'https://w/tile/100/{z}/{y}/{x}', mapDate: '2018-06-06', sampleMarker: SIMBOLO };

test('célula cria a amostra pelo sampleMarkerService com a configuração da campanha, sem L.marker nem L.geoJSON', () => {
    const { chamadas, camadas } = instanciar(PONTO);
    assert.equal(chamadas.marker.length, 0, 'L.marker não deve ser chamado');
    assert.equal(chamadas.geoJSON.length, 0, 'L.geoJSON não deve ser chamado');
    assert.equal(camadas.length, 1);
    assert.deepEqual(plain(camadas[0].latlng), [-16.6, -49.2]);
    assert.equal(camadas[0].config, SIMBOLO);
    assert.ok(chamadas.map[0].layers.includes(camadas[0]), 'camada da amostra adicionada ao mapa');
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

test('troca de ponto na célula reciclada: símbolo, vista e tiles acompanham o novo ponto', () => {
    const { chamadas, camadas, trocar, watchers } = instanciar(PONTO);
    assert.equal(watchers.length, 1);
    assert.deepEqual(plain(watchers[0].exprs), WATCHED);

    trocar({ lon: -48.1, lat: -10.9, tileUrl: 'https://w/tile/200/{z}/{y}/{x}', mapDate: '2022-01-15' });

    const mapa = chamadas.map[0];
    assert.deepEqual(plain(mapa.view), { center: [-10.9, -48.1], zoom: 13 });
    assert.equal(camadas.length, 1, 'a camada é reposicionada, não recriada');
    assert.deepEqual(plain(camadas[0].moves), [[-10.9, -48.1]]);
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

test('configuração do símbolo alterada entre pontos recria a camada com a nova configuração', () => {
    const { chamadas, camadas, watches, trocar, trocarSimbolo } = instanciar(PONTO);
    const profundo = watches.find(function (w) { return w.expr === 'sampleMarker'; });
    assert.ok(profundo && profundo.deep === true, 'watch profundo de sampleMarker');

    const circulo = { symbol: 'circle', radiusMeters: 50, color: '#ff0000', weight: 3, fill: true, fillOpacity: 0.3 };
    trocarSimbolo(circulo);

    const mapa = chamadas.map[0];
    assert.equal(camadas.length, 2);
    assert.ok(!mapa.layers.includes(camadas[0]), 'camada anterior removida');
    assert.ok(mapa.layers.includes(camadas[1]), 'nova camada adicionada');
    assert.equal(camadas[1].config, circulo);
    assert.deepEqual(plain(camadas[1].latlng), [-16.6, -49.2]);

    trocar({ lon: -40, lat: -5 });
    assert.deepEqual(plain(camadas[1].moves), [[-5, -40]], 'a nova camada passa a acompanhar o ponto');
    assert.deepEqual(plain(camadas[0].moves), [], 'a camada antiga não é mais movida');
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

test('$destroy remove tiles e símbolo, desregistra do mapSyncService e destrói o mapa', () => {
    const { chamadas, handlers, mapSync } = instanciar(PONTO);
    const mapa = chamadas.map[0];
    handlers.$destroy();
    assert.deepEqual(mapa.layers, []);
    assert.deepEqual(mapSync.unregistered, [mapa]);
    assert.equal(mapa.removed, true);
});
