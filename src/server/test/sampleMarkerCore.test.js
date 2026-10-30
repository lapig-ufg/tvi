/**
 * Núcleo puro do símbolo da amostra (client/services/sample-marker-core.js),
 * executado em Node pelo wrapper UMD: paridade de padrões e limites com o
 * serviço do servidor, normalização leniente, geometria do quadrado e
 * mapeamento de estilo para o Leaflet.
 *
 * Execução:
 *   cd src/server && npm test
 *   ou
 *   node --test src/server/test/sampleMarkerCore.test.js
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const CLIENT_DIR = path.join(__dirname, '..', '..', 'client');
const core = require(path.join(CLIENT_DIR, 'services', 'sample-marker-core'));
const server = require(path.join(__dirname, '..', 'services', 'campaignSampleMarker'));

const EARTH_RADIUS = 6378137;
const EQUATOR_CIRCUMFERENCE = 40075017;

function haversine(a, b) {
    const toRad = (degrees) => degrees * Math.PI / 180;
    const dLat = toRad(b[0] - a[0]);
    const dLon = toRad(b[1] - a[1]);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLon / 2) ** 2;
    return 2 * EARTH_RADIUS * Math.asin(Math.sqrt(h));
}

test('paridade com o servidor: SYMBOLS, padrões e LIMITS idênticos', () => {
    assert.deepEqual(core.SYMBOLS, server.SYMBOLS);
    assert.deepEqual(core.defaults(), server.DEFAULTS);
    assert.deepEqual(core.LIMITS, server.LIMITS);
});

test('defaults() devolve um objeto novo a cada chamada', () => {
    const first = core.defaults();
    const second = core.defaults();
    assert.notEqual(first, second);
    first.symbol = 'square';
    assert.equal(core.defaults().symbol, 'marker');
});

test('normalize: ausente, inválido ou parcial cai no padrão campo a campo, sem lançar', () => {
    assert.deepEqual(core.normalize(undefined), core.defaults());
    assert.deepEqual(core.normalize(null), core.defaults());
    assert.deepEqual(core.normalize('square'), core.defaults());
    assert.deepEqual(core.normalize([]), core.defaults());
    assert.deepEqual(
        core.normalize({ symbol: 'square', radiusMeters: '50', color: '#FFAA00', weight: '4', fill: true, fillOpacity: 0.6 }),
        { symbol: 'square', radiusMeters: 50, color: '#ffaa00', weight: 4, fill: true, fillOpacity: 0.6 });
    assert.deepEqual(
        core.normalize({ symbol: 'hexagon', radiusMeters: 0, color: 'blue', weight: 2.5, fill: 'no', fillOpacity: 9 }),
        core.defaults());
    assert.deepEqual(core.normalize({ symbol: 'circle', weight: 'bad' }), Object.assign(core.defaults(), { symbol: 'circle' }));
    const input = { symbol: 'circle' };
    assert.notEqual(core.normalize(input), input, 'devolve um objeto novo');
});

test('isVector: falso para o marcador (e para configuração ausente), verdadeiro para quadrado e círculo', () => {
    assert.equal(core.isVector(undefined), false);
    assert.equal(core.isVector({ symbol: 'marker' }), false);
    assert.equal(core.isVector({ symbol: 'square' }), true);
    assert.equal(core.isVector({ symbol: 'circle' }), true);
});

test('squareLatLngs: quatro vértices [lat, lon] (SW, SE, NE, NW) com lado 2 × raio e centro no ponto', () => {
    [[0, -60], [-7.7, -49.2], [-16.6, -49.3], [-33, -70]].forEach(([lat, lon]) => {
        const ring = core.squareLatLngs(lat, lon, 15);
        assert.equal(ring.length, 4, 'o Leaflet fecha o anel do Polygon');
        const [sw, se, ne, nw] = ring;
        assert.ok(sw[0] < ne[0] && sw[1] < ne[1], 'SW abaixo e à esquerda de NE');
        assert.deepEqual(se, [sw[0], ne[1]]);
        assert.deepEqual(nw, [ne[0], sw[1]]);
        assert.ok(Math.abs(haversine(sw, se) - 30) < 0.1, `lado sul em lat ${lat}: ${haversine(sw, se)}`);
        assert.ok(Math.abs(haversine(nw, ne) - 30) < 0.1, `lado norte em lat ${lat}: ${haversine(nw, ne)}`);
        assert.ok(Math.abs(haversine(sw, nw) - 30) < 0.1, `lado oeste em lat ${lat}: ${haversine(sw, nw)}`);
        assert.ok(Math.abs((sw[0] + ne[0]) / 2 - lat) < 1e-12, 'centro em latitude');
        assert.ok(Math.abs((sw[1] + ne[1]) / 2 - lon) < 1e-12, 'centro em longitude');
    });
});

test('squareBounds: valores idênticos à fórmula de LatLng.toBounds do Leaflet aplicada ao lado 2 × raio', () => {
    const halfLat = 180 * (2 * 100) / EQUATOR_CIRCUMFERENCE;
    const halfLon = halfLat / Math.cos(60 * Math.PI / 180);
    assert.deepEqual(core.squareBounds(60, 10, 100), {
        south: 60 - halfLat, west: 10 - halfLon, north: 60 + halfLat, east: 10 + halfLon
    });
});

test('pathStyle: contorno e preenchimento do Leaflet a partir da configuração, sempre não interativo', () => {
    assert.deepEqual(core.pathStyle(core.defaults()),
        { color: '#29e7e4', weight: 2, fill: false, fillColor: '#29e7e4', fillOpacity: 0.2, interactive: false });
    assert.deepEqual(core.pathStyle({ symbol: 'circle', radiusMeters: 10, color: '#ff0000', weight: 3, fill: true, fillOpacity: 0.5 }),
        { color: '#ff0000', weight: 3, fill: true, fillColor: '#ff0000', fillOpacity: 0.5, interactive: false });
    assert.deepEqual(core.pathStyle(undefined), core.pathStyle(core.defaults()), 'configuração ausente usa os padrões');
});
