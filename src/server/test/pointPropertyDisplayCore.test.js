/**
 * Núcleo puro das colunas do ponto por idioma
 * (client/services/point-property-display-core.js), executado em Node pelo
 * wrapper UMD: paridade com o serviço do servidor, escolha da lista pelo
 * idioma ativo, regra antiga para campanhas sem configuração e extração das
 * colunas da análise de propriedades.
 *
 * Execução:
 *   cd src/server && npm test
 *   ou
 *   node --test src/server/test/pointPropertyDisplayCore.test.js
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const core = require(path.join(__dirname, '..', '..', 'client', 'services', 'point-property-display-core'));
const server = require(path.join(__dirname, '..', 'services', 'campaignPropertyDisplay'));

// Ponto real da campanha mapbiomas_indonesia_col2_cp1.
const ponto = {
    fid: 10276, Kec_Dist: 'Kalumpang', Village: 'Karataun', Subdist: 'Kalumpang', Dist_City: 'Mamuju',
    Kel_Desa: 'Karataun', Kab_Kota: 'Mamuju', Satuan_BL: 'Denudasional', DEM: 742, Province: 'Sulawesi Barat',
    random: 0.06, Landform: 'Denudational', Region: 'Sulawesi', campaign: 1, Provinsi: 'Sulawesi Barat'
};
const indonesio = [{ key: 'Kel_Desa', label: '' }, { key: 'Kec_Dist', label: '' }, { key: 'Kab_Kota', label: '' },
    { key: 'Provinsi', label: '' }, { key: 'Satuan_BL', label: 'Bentuklahan' }];
const config = {
    default: indonesio, 'pt-BR': [], id: indonesio,
    en: ['Village', 'Subdist', 'Dist_City', 'Province', 'Landform'].map((key) => ({ key, label: '' }))
};

const rotulos = (linhas) => linhas.map((linha) => linha.label);
const valores = (linhas) => linhas.map((linha) => linha.value);
const chaves = (linhas) => linhas.map((linha) => linha.key);

test('paridade com o servidor: LISTS e LIMITS idênticos e congelados', () => {
    assert.deepEqual(core.LISTS, server.LISTS);
    assert.deepEqual(core.LIMITS, server.LIMITS);
    assert.ok(Object.isFrozen(core.LISTS));
    assert.ok(Object.isFrozen(core.LIMITS));
});

test('normalize e resolvePropertyDisplay concordam para a mesma tabela de entradas', () => {
    [
        undefined, null, '', 'x', [], {},
        config,
        { es: [{ key: 'A' }], en: 'x' },
        { id: [{ key: '' }, { key: ' A ', label: 9 }, { key: 'A' }, 5, { key: 'B', label: ' b ' }] },
        { en: Array.from({ length: 40 }, (_, i) => ({ key: `c${i}` })) },
        { default: [{ key: 'a'.repeat(101) }, { key: 'X', label: 'y'.repeat(61) }] }
    ].forEach((entrada) => {
        assert.deepEqual(core.normalize(entrada), server.resolvePropertyDisplay({ propertyDisplay: entrada }), JSON.stringify(entrada));
    });
});

test('id: rótulos indonésios na ordem configurada', () => {
    const linhas = core.rows(ponto, config, 'id');
    assert.deepEqual(rotulos(linhas), ['Kel Desa', 'Kec Dist', 'Kab Kota', 'Provinsi', 'Bentuklahan']);
    assert.deepEqual(valores(linhas), ['Karataun', 'Kalumpang', 'Mamuju', 'Sulawesi Barat', 'Denudasional']);
    assert.deepEqual(chaves(linhas), ['Kel_Desa', 'Kec_Dist', 'Kab_Kota', 'Provinsi', 'Satuan_BL']);
});

test('en: rótulos ingleses', () => {
    const linhas = core.rows(ponto, config, 'en');
    assert.deepEqual(rotulos(linhas), ['Village', 'Subdist', 'Dist City', 'Province', 'Landform']);
    assert.deepEqual(valores(linhas), ['Karataun', 'Kalumpang', 'Mamuju', 'Sulawesi Barat', 'Denudational']);
});

test('pt-BR sem lista própria e idioma desconhecido usam a lista padrão', () => {
    assert.deepEqual(rotulos(core.rows(ponto, config, 'pt-BR')), ['Kel Desa', 'Kec Dist', 'Kab Kota', 'Provinsi', 'Bentuklahan']);
    assert.deepEqual(rotulos(core.rows(ponto, config, 'es')), ['Kel Desa', 'Kec Dist', 'Kab Kota', 'Provinsi', 'Bentuklahan']);
    const semPadrao = Object.assign({}, config, { default: [] });
    assert.equal(core.rows(ponto, semPadrao, 'pt-BR').length, 15, 'sem lista do idioma nem padrão: regra antiga');
});

test('sem configuração reproduz a regra atual de exibição', () => {
    const linhas = core.rows(ponto, core.normalize(undefined), 'en');
    assert.deepEqual(chaves(linhas), Object.keys(ponto));
    assert.equal(linhas[0].label, 'Fid');
    assert.equal(linhas[1].label, 'Kec Dist');
    const brasil = { biome: 'x', Biome: 'y', UF: 'z', countyCode: 1, Municipio: 'w', lat: 1 };
    assert.deepEqual(chaves(core.rows(brasil, core.normalize(null), 'id')), ['countyCode', 'Municipio']);
    assert.deepEqual(chaves(core.rows(brasil, undefined, 'id')), ['countyCode', 'Municipio']);
});

test('coluna configurada ausente no ponto não gera linha; propriedades ausentes geram lista vazia', () => {
    const parcial = { Kel_Desa: 'Karataun', Provinsi: null };
    const linhas = core.rows(parcial, config, 'id');
    assert.deepEqual(chaves(linhas), ['Kel_Desa', 'Provinsi']);
    assert.equal(linhas[1].value, null);
    assert.deepEqual(core.rows(null, config, 'id'), []);
    assert.deepEqual(core.rows(undefined, config, 'id'), []);
    assert.deepEqual(core.rows('x', config, 'id'), []);
    assert.deepEqual(core.rows({ toString: 'x' }, { id: [{ key: 'hasOwnProperty', label: '' }] }, 'id'), [],
        'só colunas próprias do ponto');
});

test('formatKey mantém a formatação antiga dos nomes de coluna', () => {
    assert.equal(core.formatKey('Kel_Desa'), 'Kel Desa');
    assert.equal(core.formatKey('dist_city'), 'Dist city');
    assert.equal(core.formatKey('DEM'), 'DEM');
});

test('keysFromAnalysis extrai as colunas customizadas sem prefixo e sem repetição', () => {
    const resposta = {
        allProperties: [
            { name: 'properties.Kel_Desa', isCustom: true },
            { name: 'biome', isCustom: false },
            { name: 'properties.Village', isCustom: true },
            { name: 'properties.Kel_Desa', isCustom: true }
        ]
    };
    assert.deepEqual(core.keysFromAnalysis(resposta), ['Kel_Desa', 'Village']);
    assert.deepEqual(core.keysFromAnalysis(null), []);
    assert.deepEqual(core.keysFromAnalysis({}), []);
    assert.deepEqual(core.keysFromAnalysis({ allProperties: 'x' }), []);
});
