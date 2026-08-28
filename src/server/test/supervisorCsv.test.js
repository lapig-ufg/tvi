'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const supervisorCsv = require('../services/supervisorCsv');

// Cópia literal do algoritmo legado de Points.csv (controllers/supervisor.js
// antes da extração), usada como oráculo de não-regressão.
function legacyOracle(points, initialYear, finalYear) {
    var csvResult = [];
    var objColNames = {};

    points.forEach(function (point) {
        for (var i = 0; i < point.userName.length; i++) {
            point.inspection[i].form.forEach(function (inspec) {
                for (var year = initialYear; year <= finalYear; year++) {
                    var colName = year + "_" + point.userName[i];
                    if (!objColNames[colName])
                        objColNames[colName] = ''
                }
            })
        }
    });

    points.forEach(function (point) {
        var csvLines = {
            'index': point.index,
            'lon': point.lon,
            'lat': point.lat
        }
        for (var colNames in objColNames) {
            csvLines[colNames] = '-';
        }
        var count = 0;
        for (var i = 0; i < point.userName.length; i++) {
            point.inspection[i].form.forEach(function (inspec) {
                for (var year = inspec.initialYear; year <= inspec.finalYear; year++) {
                    for (var col in csvLines) {
                        if (col == year + "_" + point.userName[i]) {
                            csvLines[col] = inspec.landUse
                            if (inspec.hasOwnProperty('pixelBorder')) {
                                csvLines['borda_' + year] = inspec.pixelBorder
                            }
                            if (!csvLines['consolidated_' + year]) {
                                if (point.classConsolidated) {
                                    csvLines['consolidated_' + year] = point.classConsolidated[count]
                                } else {
                                    csvLines['consolidated_' + year] = '-'
                                }
                                count++;
                            }
                        }
                    }
                }
            })
        }
        if (point.pointEdited === true) {
            csvLines['pointEdited'] = true
        } else {
            csvLines['pointEdited'] = '-'
        }
        csvResult.push(csvLines)
    })
    return csvResult;
}

const LEGACY_POINTS = [
    {
        index: 1, lon: -50.1, lat: -16.2,
        userName: ['ana', 'beto'],
        classConsolidated: ['Pastagem', 'Pastagem', 'Agricultura'],
        pointEdited: true,
        inspection: [
            { form: [
                { initialYear: 2020, finalYear: 2021, landUse: 'Pastagem', pixelBorder: false },
                { initialYear: 2022, finalYear: 2022, landUse: 'Agricultura', pixelBorder: true }
            ] },
            { form: [
                { initialYear: 2020, finalYear: 2022, landUse: 'Vegetação Nativa', pixelBorder: false }
            ] }
        ]
    },
    {
        index: 2, lon: -50.3, lat: -16.4,
        userName: ['ana'],
        inspection: [
            { form: [
                { initialYear: 2020, finalYear: 2022, landUse: 'Pastagem', pixelBorder: false }
            ] }
        ]
    }
];

const WAYBACK_CAMPAIGN = { _id: 'c_wayback', imageType: 'wayback', initialYear: 2000, finalYear: 2025 };
const LEGACY_CAMPAIGN = { _id: 'c_legacy', initialYear: 2020, finalYear: 2022 };

const WAYBACK_POINTS = [
    {
        index: 1, lon: -58.1, lat: -35.1,
        userName: ['felipe', 'pamela'],
        pointEdited: false,
        inspection: [
            { form: [
                { releaseNum: 30195, captureDate: '2010-04-20', landUse: 'Grassland', pixelBorder: false },
                { releaseNum: 29387, captureDate: '2012-06-07', landUse: 'Cropland', pixelBorder: true }
            ] },
            { form: [
                { releaseNum: 30195, captureDate: '2010-04-20', landUse: 'Forest', pixelBorder: false },
                { releaseNum: 29387, captureDate: '2012-06-07', landUse: 'Forest', pixelBorder: false }
            ] }
        ]
    },
    {
        // Ponto com grade maior: garante colunas uniformes pelo máximo.
        index: 2, lon: -58.2, lat: -35.2,
        userName: ['felipe'],
        inspection: [
            { form: [
                { releaseNum: 1, captureDate: '2011-01-05', landUse: 'Forest', pixelBorder: false },
                { releaseNum: 2, captureDate: '2013-02-06', landUse: 'Forest', pixelBorder: false },
                { releaseNum: 3, captureDate: '2015-03-07', landUse: 'Bare Ground', pixelBorder: true }
            ] }
        ]
    }
];

test('legado: linhas idênticas byte a byte ao algoritmo original (oráculo)', () => {
    const rows = supervisorCsv.buildCsvRows(LEGACY_POINTS, LEGACY_CAMPAIGN);
    assert.deepEqual(rows, legacyOracle(LEGACY_POINTS, 2020, 2022));
});

test('wayback: colunas por posição de célula com data, classe por intérprete e borda', () => {
    const rows = supervisorCsv.buildCsvRows(WAYBACK_POINTS, WAYBACK_CAMPAIGN);
    assert.equal(rows.length, 2);

    const r1 = rows[0];
    assert.equal(r1.index, 1);
    assert.equal(r1['img01_data'], '2010-04-20');
    assert.equal(r1['img02_data'], '2012-06-07');
    assert.equal(r1['img03_data'], '-');
    assert.equal(r1['img01_felipe'], 'Grassland');
    assert.equal(r1['img02_felipe'], 'Cropland');
    assert.equal(r1['img01_pamela'], 'Forest');
    assert.equal(r1['img02_pamela'], 'Forest');
    assert.equal(r1['img03_felipe'], '-');
    // Borda com a mesma semântica do legado (última inspeção prevalece).
    assert.equal(r1['borda_img01'], false);
    assert.equal(r1['borda_img02'], false);
    assert.equal(r1['pointEdited'], '-');

    const r2 = rows[1];
    assert.equal(r2['img03_data'], '2015-03-07');
    assert.equal(r2['img03_felipe'], 'Bare Ground');
    assert.equal(r2['borda_img03'], true);
    assert.equal(r2['img01_pamela'], '-');
});

test('wayback: sem colunas de consolidado (não existe consolidação Wayback)', () => {
    const rows = supervisorCsv.buildCsvRows(WAYBACK_POINTS, WAYBACK_CAMPAIGN);
    rows.forEach(function (row) {
        Object.keys(row).forEach(function (key) {
            assert.ok(!key.startsWith('consolidated_'), 'coluna inesperada: ' + key);
        });
    });
});

test('wayback: todas as linhas têm o mesmo conjunto de colunas (CSV uniforme)', () => {
    const rows = supervisorCsv.buildCsvRows(WAYBACK_POINTS, WAYBACK_CAMPAIGN);
    assert.deepEqual(Object.keys(rows[0]).sort(), Object.keys(rows[1]).sort());
});

test('lista vazia de pontos retorna lista vazia', () => {
    assert.deepEqual(supervisorCsv.buildCsvRows([], LEGACY_CAMPAIGN), []);
    assert.deepEqual(supervisorCsv.buildCsvRows([], WAYBACK_CAMPAIGN), []);
});
