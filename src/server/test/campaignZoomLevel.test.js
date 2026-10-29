/**
 * Nível de zoom inicial dos mapas da grade, configurado por campanha
 * (services/campaignZoomLevel.js): normalização do valor recebido no cadastro
 * e resolução com padrão para documentos antigos.
 *
 * Execução:
 *   cd src/server && npm test
 *   ou
 *   node --test src/server/test/campaignZoomLevel.test.js
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const zoom = require(path.join(__dirname, '..', 'services', 'campaignZoomLevel'));

test('constantes: padrão 13 dentro da faixa 10 a 18', () => {
    assert.equal(zoom.DEFAULT_ZOOM_LEVEL, 13);
    assert.equal(zoom.MIN_ZOOM_LEVEL, 10);
    assert.equal(zoom.MAX_ZOOM_LEVEL, 18);
});

test('normalizeZoomLevel: aceita inteiro e string numérica inteira dentro da faixa', () => {
    assert.equal(zoom.normalizeZoomLevel(13), 13);
    assert.equal(zoom.normalizeZoomLevel('15'), 15);
    assert.equal(zoom.normalizeZoomLevel(' 17 '), 17);
    assert.equal(zoom.normalizeZoomLevel(10), 10);
    assert.equal(zoom.normalizeZoomLevel(18), 18);
});

test('normalizeZoomLevel: rejeita valores fora da faixa', () => {
    assert.equal(zoom.normalizeZoomLevel(9), null);
    assert.equal(zoom.normalizeZoomLevel(19), null);
    assert.equal(zoom.normalizeZoomLevel('25'), null);
    assert.equal(zoom.normalizeZoomLevel(-13), null);
});

test('normalizeZoomLevel: rejeita não inteiros, vazios e tipos não numéricos', () => {
    assert.equal(zoom.normalizeZoomLevel(13.5), null);
    assert.equal(zoom.normalizeZoomLevel('13.5'), null);
    assert.equal(zoom.normalizeZoomLevel('abc'), null);
    assert.equal(zoom.normalizeZoomLevel(''), null);
    assert.equal(zoom.normalizeZoomLevel('   '), null);
    assert.equal(zoom.normalizeZoomLevel(null), null);
    assert.equal(zoom.normalizeZoomLevel(undefined), null);
    assert.equal(zoom.normalizeZoomLevel(true), null);
    assert.equal(zoom.normalizeZoomLevel({}), null);
    assert.equal(zoom.normalizeZoomLevel([13]), null);
    assert.equal(zoom.normalizeZoomLevel(NaN), null);
});

test('resolveZoomLevel: valor válido do documento, padrão quando ausente ou inválido', () => {
    assert.equal(zoom.resolveZoomLevel({ zoomLevel: 17 }), 17);
    assert.equal(zoom.resolveZoomLevel({ zoomLevel: '12' }), 12);
    assert.equal(zoom.resolveZoomLevel({}), 13);
    assert.equal(zoom.resolveZoomLevel(null), 13);
    assert.equal(zoom.resolveZoomLevel(undefined), 13);
    assert.equal(zoom.resolveZoomLevel({ zoomLevel: 'x' }), 13);
    assert.equal(zoom.resolveZoomLevel({ zoomLevel: 25 }), 13);
});

test('parseZoomLevelInput: ausente ou vazio vira o padrão, válido é normalizado, inválido devolve erro', () => {
    assert.deepEqual(zoom.parseZoomLevelInput(undefined), { value: 13 });
    assert.deepEqual(zoom.parseZoomLevelInput(null), { value: 13 });
    assert.deepEqual(zoom.parseZoomLevelInput(''), { value: 13 });
    assert.deepEqual(zoom.parseZoomLevelInput('15'), { value: 15 });
    assert.deepEqual(zoom.parseZoomLevelInput(18), { value: 18 });
    assert.deepEqual(zoom.parseZoomLevelInput(25), { error: 'zoomLevel must be an integer between 10 and 18' });
    assert.deepEqual(zoom.parseZoomLevelInput('abc'), { error: 'zoomLevel must be an integer between 10 and 18' });
    assert.deepEqual(zoom.parseZoomLevelInput(9.5), { error: 'zoomLevel must be an integer between 10 and 18' });
});
