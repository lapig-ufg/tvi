/**
 * Núcleo puro da importação de classes entre campanhas
 * (client/services/land-use-import-core.js): cópia exata da lista de origem,
 * tratamento da classe padrão da primeira caixa e filtragem das campanhas
 * de origem devolvidas pela busca.
 *
 * Execução:
 *   cd src/server && npm test
 *   ou
 *   node --test src/server/test/landUseImportCore.test.js
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const core = require(path.join(__dirname, '..', '..', 'client', 'services', 'land-use-import-core'));

test('importLandUse copia a lista exata e não compartilha referência', () => {
    const origem = ['Hutan alam', 'Semak dan Pertanian Lainnya', ' Sawit', 'Infastruktur dan bangunan'];
    const resultado = core.importLandUse(origem, '');
    assert.deepEqual(resultado.landUse, ['Hutan alam', 'Semak dan Pertanian Lainnya', ' Sawit', 'Infastruktur dan bangunan']);
    assert.notEqual(resultado.landUse, origem);
    origem.push('Tambang');
    origem[0] = 'alterada';
    assert.deepEqual(resultado.landUse, ['Hutan alam', 'Semak dan Pertanian Lainnya', ' Sawit', 'Infastruktur dan bangunan']);
});

test('importLandUse mantém a classe padrão presente na nova lista e limpa a ausente', () => {
    assert.equal(core.importLandUse(['Pastagem', 'Não Pastagem'], 'Não Pastagem').defaultLandUse, 'Não Pastagem');
    assert.equal(core.importLandUse(['Pastagem'], 'Não Pastagem').defaultLandUse, '');
    assert.equal(core.importLandUse(['Pastagem'], undefined).defaultLandUse, '');
    assert.deepEqual(core.importLandUse(null, 'x'), { landUse: [], defaultLandUse: '' });
});

test('sources descarta a campanha atual e campanhas sem classes e conta as classes', () => {
    const resultados = [
        { id: 'mapbiomas_indonesia_col2_cp1', landUse: ['A', 'B', 'C'] },
        { id: 'atual', landUse: ['A'] },
        { id: 'vazia', landUse: [] },
        { id: 'sem_campo' },
        { id: 'invalida', landUse: 'A' }
    ];
    assert.deepEqual(core.sources(resultados, 'atual'), [
        { id: 'mapbiomas_indonesia_col2_cp1', count: 3, landUse: ['A', 'B', 'C'] }
    ]);
    assert.deepEqual(core.sources(resultados, undefined).map((s) => s.id), ['mapbiomas_indonesia_col2_cp1', 'atual']);
    assert.deepEqual(core.sources(null, 'x'), []);
});
