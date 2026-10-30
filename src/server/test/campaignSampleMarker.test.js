/**
 * Símbolo da amostra por campanha (services/campaignSampleMarker.js):
 * validação do objeto recebido no cadastro e resolução, com padrões, para
 * documentos antigos, parciais ou inválidos.
 *
 * Execução:
 *   cd src/server && npm test
 *   ou
 *   node --test src/server/test/campaignSampleMarker.test.js
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const sampleMarker = require(path.join(__dirname, '..', 'services', 'campaignSampleMarker'));

const DEFAULTS = { symbol: 'marker', radiusMeters: 15, color: '#29e7e4', weight: 2, fill: false, fillOpacity: 0.2 };

test('constantes: símbolos, padrões congelados e limites', () => {
    assert.deepEqual(sampleMarker.SYMBOLS, ['marker', 'square', 'circle']);
    assert.deepEqual(sampleMarker.DEFAULTS, DEFAULTS);
    assert.ok(Object.isFrozen(sampleMarker.DEFAULTS));
    assert.deepEqual(sampleMarker.LIMITS, {
        radiusMeters: { min: 1, max: 10000 },
        weight: { min: 1, max: 10 },
        fillOpacity: { min: 0, max: 1 }
    });
});

test('parseSampleMarkerInput: ausente, nulo, vazio ou objeto vazio viram os padrões', () => {
    [undefined, null, '', {}].forEach((value) => {
        assert.deepEqual(sampleMarker.parseSampleMarkerInput(value), { value: DEFAULTS }, String(value));
    });
});

test('parseSampleMarkerInput: objeto parcial completa os campos ausentes com os padrões', () => {
    assert.deepEqual(sampleMarker.parseSampleMarkerInput({ symbol: 'square' }),
        { value: Object.assign({}, DEFAULTS, { symbol: 'square' }) });
    assert.deepEqual(sampleMarker.parseSampleMarkerInput({ symbol: null, radiusMeters: '', color: undefined }),
        { value: DEFAULTS });
});

test('parseSampleMarkerInput: aceita strings numéricas e grava a cor em minúsculas', () => {
    const input = { symbol: 'circle', radiusMeters: '150', color: '#FF8800', weight: '3', fill: true, fillOpacity: '0.5' };
    assert.deepEqual(sampleMarker.parseSampleMarkerInput(input),
        { value: { symbol: 'circle', radiusMeters: 150, color: '#ff8800', weight: 3, fill: true, fillOpacity: 0.5 } });
    assert.deepEqual(sampleMarker.parseSampleMarkerInput({ radiusMeters: 2.5 }).value.radiusMeters, 2.5);
});

test('parseSampleMarkerInput: campo presente e inválido devolve erro específico', () => {
    const symbolError = 'sampleMarker.symbol must be one of marker, square, circle';
    const radiusError = 'sampleMarker.radiusMeters must be a number between 1 and 10000';
    const colorError = 'sampleMarker.color must be a hexadecimal color like #29e7e4';
    const weightError = 'sampleMarker.weight must be an integer between 1 and 10';
    const fillError = 'sampleMarker.fill must be a boolean';
    const opacityError = 'sampleMarker.fillOpacity must be a number between 0 and 1';
    [
        [{ symbol: 'star' }, symbolError],
        [{ symbol: 'Square' }, symbolError],
        [{ radiusMeters: 0 }, radiusError],
        [{ radiusMeters: 10001 }, radiusError],
        [{ radiusMeters: 'abc' }, radiusError],
        [{ radiusMeters: NaN }, radiusError],
        [{ color: '#fff' }, colorError],
        [{ color: 'red' }, colorError],
        [{ color: '29e7e4' }, colorError],
        [{ weight: 0 }, weightError],
        [{ weight: 2.5 }, weightError],
        [{ weight: 11 }, weightError],
        [{ fill: 'yes' }, fillError],
        [{ fill: 1 }, fillError],
        [{ fillOpacity: 1.5 }, opacityError],
        [{ fillOpacity: -0.1 }, opacityError]
    ].forEach(([input, error]) => {
        assert.deepEqual(sampleMarker.parseSampleMarkerInput(input), { error }, JSON.stringify(input));
    });
    assert.deepEqual(sampleMarker.parseSampleMarkerInput('square'), { error: 'sampleMarker must be an object' });
    assert.deepEqual(sampleMarker.parseSampleMarkerInput([1]), { error: 'sampleMarker must be an object' });
});

test('resolveSampleMarker: documento sem campo, parcial ou inválido resolve campo a campo com os padrões', () => {
    assert.deepEqual(sampleMarker.resolveSampleMarker({}), DEFAULTS);
    assert.deepEqual(sampleMarker.resolveSampleMarker(null), DEFAULTS);
    assert.deepEqual(sampleMarker.resolveSampleMarker(undefined), DEFAULTS);
    assert.deepEqual(sampleMarker.resolveSampleMarker({ sampleMarker: 'x' }), DEFAULTS);
    assert.deepEqual(sampleMarker.resolveSampleMarker({ sampleMarker: { symbol: 'square', radiusMeters: 50 } }),
        Object.assign({}, DEFAULTS, { symbol: 'square', radiusMeters: 50 }));
    assert.deepEqual(sampleMarker.resolveSampleMarker({ sampleMarker: { symbol: 'hexagon', radiusMeters: -5, color: 'blue', weight: 99, fill: 'no', fillOpacity: 7 } }),
        DEFAULTS);
    assert.deepEqual(sampleMarker.resolveSampleMarker({ sampleMarker: { symbol: 'circle', weight: 'bad' } }),
        Object.assign({}, DEFAULTS, { symbol: 'circle' }));
});

test('resultados são objetos novos, sem compartilhar DEFAULTS', () => {
    const resolved = sampleMarker.resolveSampleMarker({});
    const parsed = sampleMarker.parseSampleMarkerInput(undefined).value;
    assert.notEqual(resolved, sampleMarker.DEFAULTS);
    assert.notEqual(parsed, sampleMarker.DEFAULTS);
    assert.notEqual(resolved, parsed);
    resolved.symbol = 'square';
    assert.equal(sampleMarker.DEFAULTS.symbol, 'marker');
});
