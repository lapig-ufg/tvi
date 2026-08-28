/**
 * supervisorCsv — monta as linhas do export CSV do supervisor
 * (Points.csv em controllers/supervisor.js).
 *
 * Campanhas legadas mantêm o algoritmo original byte a byte (colunas
 * `ano_usuario`, `borda_ano`, `consolidated_ano`, incluindo as
 * peculiaridades de ordem e de preenchimento do código extraído).
 *
 * Campanhas Wayback gravam o form por célula da grade ({releaseNum,
 * captureDate, landUse, pixelBorder}); o laço por ano nunca preenchia nada e
 * o CSV saía sem classes. Como as datas de captura variam por ponto, as
 * colunas Wayback são uniformes por POSIÇÃO da célula: `imgNN_data` (data de
 * captura da célula NN do ponto), `imgNN_<usuario>` (classe marcada) e
 * `borda_imgNN` (mesma semântica do legado: última inspeção prevalece).
 * Sem colunas `consolidated_`: não existe consolidação em campanhas Wayback.
 * Módulo puro, sem dependências do app — como inspectionTable.
 */
'use strict';

function buildLegacyRows(points, initialYear, finalYear) {
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

function buildWaybackRows(points) {
    var maxCells = 0;
    var users = [];

    points.forEach(function (point) {
        (point.userName || []).forEach(function (userName, i) {
            var form = point.inspection && point.inspection[i] && point.inspection[i].form;
            if (!form || !form.length) return;
            if (form.length > maxCells) maxCells = form.length;
            if (users.indexOf(userName) === -1) users.push(userName);
        });
    });

    var padWidth = Math.max(2, String(maxCells).length);
    var cellLabel = function (k) {
        return 'img' + String(k).padStart(padWidth, '0');
    };

    return points.map(function (point) {
        var row = {
            'index': point.index,
            'lon': point.lon,
            'lat': point.lat
        };
        var k;
        for (k = 1; k <= maxCells; k++) row[cellLabel(k) + '_data'] = '-';
        users.forEach(function (userName) {
            for (k = 1; k <= maxCells; k++) row[cellLabel(k) + '_' + userName] = '-';
        });
        for (k = 1; k <= maxCells; k++) row['borda_' + cellLabel(k)] = '-';

        (point.userName || []).forEach(function (userName, i) {
            var form = point.inspection && point.inspection[i] && point.inspection[i].form;
            (form || []).forEach(function (inspec, idx) {
                var label = cellLabel(idx + 1);
                if (row[label + '_data'] === '-' && inspec.captureDate !== undefined) {
                    row[label + '_data'] = inspec.captureDate;
                }
                row[label + '_' + userName] = inspec.landUse;
                if (inspec.hasOwnProperty('pixelBorder')) {
                    row['borda_' + label] = inspec.pixelBorder;
                }
            });
        });

        row['pointEdited'] = point.pointEdited === true ? true : '-';
        return row;
    });
}

function buildCsvRows(points, campaign) {
    var list = Array.isArray(points) ? points : [];
    if (campaign && campaign.imageType === 'wayback') {
        return buildWaybackRows(list);
    }
    return buildLegacyRows(list, campaign && campaign.initialYear, campaign && campaign.finalYear);
}

module.exports = { buildCsvRows: buildCsvRows };
