/**
 * Adaptador Leaflet do símbolo da amostra (client/services/sampleMarkerService.js)
 * executado fora do navegador, com Angular e Leaflet simulados e o
 * SampleMarkerCore real: a factory devolve marcador, quadrado ou círculo
 * conforme a configuração da campanha, e as camadas vetoriais respondem a
 * setLatLng e setZIndexOffset como o marcador, para que as diretivas de mapa
 * não precisem distinguir o símbolo.
 *
 * Execução:
 *   cd src/server && npm test
 *   ou
 *   node --test src/server/test/sampleMarkerService.test.js
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const CLIENT_DIR = path.join(__dirname, '..', '..', 'client');
const SERVICE_PATH = path.join(CLIENT_DIR, 'services', 'sampleMarkerService.js');
const core = require(path.join(CLIENT_DIR, 'services', 'sample-marker-core'));

// Literais criados dentro do contexto vm têm protótipos de outro realm; o
// round-trip JSON permite a comparação estrutural estrita do assert.
function plain(value) {
    return JSON.parse(JSON.stringify(value));
}

// Imita L.Class: o construtor chama initialize e extend cria subclasses
// cujos métodos sobrepõem os da base.
function classeLeaflet(prototipo) {
    function Base() { this.initialize.apply(this, arguments); }
    Object.assign(Base.prototype, prototipo);
    Base.extend = function (props) {
        function Sub() { this.initialize.apply(this, arguments); }
        Sub.prototype = Object.create(Base.prototype);
        Object.assign(Sub.prototype, props);
        return Sub;
    };
    return Base;
}

function criarLeafletFalso() {
    const chamadas = { marker: [] };
    const Polygon = classeLeaflet({
        initialize: function (latlngs, options) { this.latlngs = latlngs; this.options = options; this.frontCalls = 0; },
        setLatLngs: function (latlngs) { this.latlngs = latlngs; return this; },
        bringToFront: function () { this.frontCalls += 1; return this; }
    });
    const Circle = classeLeaflet({
        initialize: function (latlng, options) { this.latlng = latlng; this.options = options; this.frontCalls = 0; },
        setLatLng: function (latlng) { this.latlng = latlng; return this; },
        bringToFront: function () { this.frontCalls += 1; return this; }
    });
    const L = {
        Polygon: Polygon,
        Circle: Circle,
        latLng: function (value) { return Array.isArray(value) ? { lat: value[0], lng: value[1] } : value; },
        extend: Object.assign,
        marker: function (latlng, options) {
            const layer = { latlng: latlng, options: options };
            chamadas.marker.push(layer);
            return layer;
        },
        icon: function (options) { return { iconOptions: options }; }
    };
    return { L: L, chamadas: chamadas };
}

function carregarServico() {
    const { L, chamadas } = criarLeafletFalso();
    const registro = {};
    const contexto = vm.createContext({
        angular: { module: function () { return { factory: function (nome, fabrica) { registro[nome] = fabrica; } }; } },
        L: L,
        window: { SampleMarkerCore: core }
    });
    vm.runInContext(fs.readFileSync(SERVICE_PATH, 'utf8'), contexto, { filename: SERVICE_PATH });
    assert.ok(registro.sampleMarkerService, 'factory sampleMarkerService não registrada');
    return { service: registro.sampleMarkerService(), chamadas: chamadas };
}

test('marcador tradicional: L.marker com ícone 42 × 42 e zIndexOffset 1000, ícone configurável', () => {
    const { service, chamadas } = carregarServico();
    const layer = service.createLayer([-16.6, -49.2], { symbol: 'marker' });
    assert.equal(chamadas.marker.length, 1);
    assert.equal(layer, chamadas.marker[0]);
    assert.deepEqual(plain(layer.latlng), [-16.6, -49.2]);
    assert.equal(layer.options.zIndexOffset, 1000);
    assert.deepEqual(plain(layer.options.icon.iconOptions), { iconUrl: 'assets/marker2.png', iconSize: [42, 42] });

    const estatico = service.createLayer([-16.6, -49.2], undefined, { iconUrl: 'assets/marker.png' });
    assert.equal(estatico.options.icon.iconOptions.iconUrl, 'assets/marker.png');
});

test('configuração ausente ou inválida cai no marcador tradicional', () => {
    const { service, chamadas } = carregarServico();
    service.createLayer([0, 0], undefined);
    service.createLayer([0, 0], null);
    service.createLayer([0, 0], { symbol: 'hexagon' });
    assert.equal(chamadas.marker.length, 3);
});

test('quadrado: Polygon com anel de 2 × raio centrado no ponto, estilo da configuração e sem interação', () => {
    const { service, chamadas } = carregarServico();
    const config = { symbol: 'square', radiusMeters: 15, color: '#ff0000', weight: 3, fill: true, fillOpacity: 0.4 };
    const layer = service.createLayer([-16.6, -49.2], config);
    assert.equal(chamadas.marker.length, 0, 'marcador não deve ser criado');
    assert.deepEqual(plain(layer.latlngs), core.squareLatLngs(-16.6, -49.2, 15));
    assert.deepEqual(plain(layer.options), core.pathStyle(config));
    assert.equal(layer.options.interactive, false);
});

test('quadrado: setLatLng recalcula o anel no novo centro e setZIndexOffset traz ao topo', () => {
    const { service } = carregarServico();
    const layer = service.createLayer([-16.6, -49.2], { symbol: 'square', radiusMeters: 100 });
    layer.setLatLng([-10.9, -48.1]);
    assert.deepEqual(plain(layer.latlngs), core.squareLatLngs(-10.9, -48.1, 100));
    layer.setLatLng({ lat: -5, lng: -40 });
    assert.deepEqual(plain(layer.latlngs), core.squareLatLngs(-5, -40, 100));
    layer.setZIndexOffset(1000);
    assert.equal(layer.frontCalls, 0, 'fora do mapa não há elemento SVG: nada a trazer ao topo');
    layer._map = {};
    layer.setZIndexOffset(1000);
    assert.equal(layer.frontCalls, 1);
});

test('círculo: Circle com radius em metros e estilo da configuração; setLatLng e setZIndexOffset disponíveis', () => {
    const { service, chamadas } = carregarServico();
    const config = { symbol: 'circle', radiusMeters: 150, color: '#00ff00', weight: 1, fill: false, fillOpacity: 0.2 };
    const layer = service.createLayer([-16.6, -49.2], config);
    assert.equal(chamadas.marker.length, 0, 'marcador não deve ser criado');
    assert.deepEqual(plain(layer.latlng), [-16.6, -49.2]);
    assert.deepEqual(plain(layer.options), Object.assign({ radius: 150 }, core.pathStyle(config)));
    layer.setLatLng([-1, -2]);
    assert.deepEqual(plain(layer.latlng), [-1, -2]);
    layer.setZIndexOffset(1000);
    assert.equal(layer.frontCalls, 0, 'fora do mapa não há elemento SVG: nada a trazer ao topo');
    layer._map = {};
    layer.setZIndexOffset(1000);
    assert.equal(layer.frontCalls, 1);
});

test('expõe o núcleo puro para os controladores', () => {
    const { service } = carregarServico();
    assert.equal(service.core, core);
});
