'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const inspectionTable = require('../services/inspectionTable');

const LEGACY_POINT = {
    userName: ['ana', 'beto'],
    inspection: [
        {
            form: [
                { initialYear: 2020, finalYear: 2021, landUse: 'Pastagem', pixelBorder: false },
                { initialYear: 2022, finalYear: 2022, landUse: 'Agricultura', pixelBorder: true }
            ]
        },
        {
            form: [
                { initialYear: 2020, finalYear: 2022, landUse: 'Vegetação Nativa', pixelBorder: false }
            ]
        }
    ]
};

const WAYBACK_POINT = {
    userName: ['felipe', 'pamela'],
    inspection: [
        {
            form: [
                { releaseNum: 30195, captureDate: '2010-04-20', landUse: 'Grassland', pixelBorder: false },
                { releaseNum: 10, captureDate: '2010-04-20', landUse: 'Grassland', pixelBorder: false },
                { releaseNum: 29387, captureDate: '2012-06-07', landUse: 'Cropland', pixelBorder: true }
            ]
        },
        {
            form: [
                { releaseNum: 30195, captureDate: '2010-04-20', landUse: 'Forest', pixelBorder: false },
                { releaseNum: 10, captureDate: '2010-04-20', landUse: 'Forest', pixelBorder: false },
                { releaseNum: 29387, captureDate: '2012-06-07', landUse: 'Forest', pixelBorder: false }
            ]
        }
    ]
};

test('legado: expande por ano com as MESMAS strings do código atual (sufixo BORDA incluído)', () => {
    const table = inspectionTable.buildInspectionTable(LEGACY_POINT);
    assert.deepEqual(table.years, [2020, 2021, 2022]);
    assert.deepEqual(table.inspections, [
        // Template literal atual: `${landUse} ${pixelBorder ? ' - BORDA' : ''}`
        // (espaço após a classe preservado byte a byte para não haver regressão).
        { userName: 'ana', landUse: ['Pastagem ', 'Pastagem ', 'Agricultura  - BORDA'] },
        { userName: 'beto', landUse: ['Vegetação Nativa ', 'Vegetação Nativa ', 'Vegetação Nativa '] }
    ]);
});

test('wayback: uma coluna por célula da grade, numerada como na tela, com classes por intérprete', () => {
    const table = inspectionTable.buildInspectionTable(WAYBACK_POINT);
    assert.deepEqual(table.years, ['1. 20/04/2010', '2. 20/04/2010', '3. 07/06/2012']);
    assert.deepEqual(table.inspections, [
        { userName: 'felipe', landUse: ['Grassland ', 'Grassland ', 'Cropland  - BORDA'] },
        { userName: 'pamela', landUse: ['Forest ', 'Forest ', 'Forest '] }
    ]);
});

test('inspeção ausente ou sem form gera linha vazia sem lançar erro', () => {
    const table = inspectionTable.buildInspectionTable({
        userName: ['ana', 'beto'],
        inspection: [null, { form: [{ initialYear: 2020, finalYear: 2020, landUse: 'Pastagem', pixelBorder: false }] }]
    });
    assert.deepEqual(table.inspections, [
        { userName: 'ana', landUse: [] },
        { userName: 'beto', landUse: ['Pastagem '] }
    ]);
    // Colunas vêm da primeira inspeção; ausente, ficam vazias (comportamento atual).
    assert.deepEqual(table.years, []);
});

test('ponto sem inspeções (ou nulo) retorna tabela vazia', () => {
    assert.deepEqual(inspectionTable.buildInspectionTable({ userName: [], inspection: [] }),
        { years: [], inspections: [] });
    assert.deepEqual(inspectionTable.buildInspectionTable(null),
        { years: [], inspections: [] });
    assert.deepEqual(inspectionTable.buildInspectionTable({}),
        { years: [], inspections: [] });
});
