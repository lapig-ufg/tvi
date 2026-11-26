const test = require('node:test');
const assert = require('node:assert/strict');
const { parseInput, MAX_POINTS, MAX_BYTES } = require('../services/pointMutationInput');

function geo(coordinates, properties = null) {
    return { kind: 'add', format: 'geojson', content: { type: 'FeatureCollection', features: [
        { type: 'Feature', geometry: { type: 'Point', coordinates }, properties }
    ] } };
}
async function invalid(body) {
    await assert.rejects(parseInput(body), error => error.statusCode === 400);
}

test('normaliza ponto WGS84 sem converter coordenadas e ignora altitude', async () => {
    assert.deepEqual(await parseInput(geo([-180, 90, 200])), [{ lon: -180, lat: 90, properties: {} }]);
    for (const coordinates of [['1', 2], [181, 0], [0, -91], [NaN, 0], [1, Infinity], [1], [1, 2, '3'], [1, 2, 3, 4]]) {
        await invalid(geo(coordinates));
    }
});

test('rejeita geometria ambígua, coleções inválidas e JSON malformado', async () => {
    const body = geo([1, 2]);
    body.content.features[0].geometry.type = 'MultiPoint';
    await invalid(body);
    await invalid({ kind: 'add', format: 'geojson', content: '{ segredo' });
    await invalid({ kind: 'add', format: 'xml', content: '' });
    await invalid({ kind: 'other', format: 'ids', ids: ['a'] });
    await invalid(geo([1, 2], []));
});

test('rejeita operadores Mongo e propriedades de protótipo em qualquer profundidade', async () => {
    for (const key of ['$where', 'a.b', '__proto__', 'constructor', 'prototype']) {
        await invalid(geo([1, 2], JSON.parse('{"nested":[{"' + key + '":1}]}')));
    }
    let properties = {};
    for (let i = 0; i < 40; i++) properties = { child: properties };
    await invalid(geo([1, 2], properties));
    await invalid(geo([1, 2], { text: 'a'.repeat(32769) }));
});

test('rejeita coordenadas repetidas nas duas operações', async () => {
    for (const kind of ['add', 'delete']) {
        const body = geo([1, 2]);
        body.kind = kind;
        body.content.features.push(body.content.features[0]);
        await invalid(body);
    }
});

test('interpreta CSV com BOM, separadores e identificadores entre aspas', async () => {
    assert.deepEqual(await parseInput({ kind: 'delete', format: 'csv', content: '\uFEFF_id;description\n" a,b ";"texto;extra"\n"c";x' }), [{ id: 'a,b' }, { id: 'c' }]);
    assert.deepEqual(await parseInput({ kind: 'delete', format: 'csv', content: 'PointID,description\n"a;z",x' }), [{ id: 'a;z' }]);
    for (const content of ['id,_id\na,b', 'name\na', 'id\na\na', 'id\n""', 'id\n"unterminated']) {
        await invalid({ kind: 'delete', format: 'csv', content });
    }
});

test('identificadores são strings literais limitadas e únicas', async () => {
    assert.deepEqual(await parseInput({ kind: 'delete', format: 'ids', ids: [' a '] }), [{ id: 'a' }]);
    assert.deepEqual(await parseInput({ kind: 'delete', format: 'ids', content: 'a' }), [{ id: 'a' }]);
    for (const ids of [[], ['a', ' a '], [1], [{ $ne: null }], ['a\n'], ['a'.repeat(201)], ['']]) {
        await invalid({ kind: 'delete', format: 'ids', ids });
    }
});

test('limita volume total e quantidade de pontos', async () => {
    await invalid({ kind: 'delete', format: 'ids', ids: Array.from({ length: MAX_POINTS + 1 }, (_, i) => String(i)) });
    await invalid({ kind: 'delete', format: 'csv', content: 'id\n' + 'a'.repeat(MAX_BYTES) });
});

test('preserva propriedades válidas em cópia independente e identificador explícito', async () => {
    const body = geo([0, -90], { label: 'Área de análise', values: [null, true, 2] });
    body.content.features[0].id = ' ponto-1 ';
    const entries = await parseInput(body);
    assert.deepEqual(entries, [{ id: 'ponto-1', lon: 0, lat: -90, properties: { label: 'Área de análise', values: [null, true, 2] } }]);
    entries[0].properties.values.push(3);
    assert.equal(body.content.features[0].properties.values.length, 3);
});

test('rejeita coleção vazia, CSV vazio e estruturas cíclicas', async () => {
    const body = geo([1, 2]);
    body.content.features = [];
    await invalid(body);
    for (const content of ['', 'id', 'id\n\n', 'id,id\na,b']) {
        await invalid({ kind: 'delete', format: 'csv', content });
    }
    const cycle = {};
    cycle.child = cycle;
    await invalid(geo([1, 2], cycle));
});

test('exclusão espacial ignora IDs de origem e inclusão aceita ID GeoJSON numérico', async () => {
    const body = geo([1, 2]);
    body.content.features[0].id = 10;
    assert.equal((await parseInput(body))[0].id, '10');
    body.kind = 'delete';
    body.content.features.push({ ...body.content.features[0], geometry: { type: 'Point', coordinates: [2, 3] } });
    const entries = await parseInput(body);
    assert.equal(entries.length, 2);
    assert.equal(entries[0].id, undefined);
    assert.equal(entries[1].id, undefined);
});
