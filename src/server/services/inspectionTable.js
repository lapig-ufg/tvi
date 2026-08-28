/**
 * inspectionTable — monta a tabela de classes por intérprete exibida nas
 * telas do supervisor e do admin (colunas em point.years, linhas em
 * point.inspection[].landUse).
 *
 * Substitui a transformação por ano que existia triplicada em
 * controllers/supervisor.js (creatPoint) e controllers/points.js
 * (getPointByFilterAdmin e getPointByIdServiceAdmin). O formato legado é
 * preservado byte a byte (inclusive o espaço após a classe no template
 * `${landUse} ${pixelBorder ? ' - BORDA' : ''}`); o formato Wayback
 * ({releaseNum, captureDate, landUse, pixelBorder}, sem initialYear) não
 * tinha coluna alguma — o laço por ano nunca executava — e passa a gerar
 * uma coluna por célula da grade, numerada como na tela de inspeção.
 * Módulo puro, sem dependências do app — como waybackInspectionGuard.
 */
'use strict';

const waybackGridCore = require('../../client/services/wayback-grid-core');

function formatCell(entry) {
    return `${entry.landUse} ${entry.pixelBorder ? ' - BORDA' : ''}`;
}

// Rótulo da coluna Wayback: mesma numeração sequencial exibida nas células
// da grade e no seletor de datas (a ordem do form segue a ordem da grade).
function waybackColumnLabel(entry, index) {
    const dateBR = waybackGridCore.formatDateBR(entry.captureDate);
    return (index + 1) + '. ' + (dateBR || entry.captureDate || '');
}

function forEachColumn(form, visit) {
    (form || []).forEach(function (entry, index) {
        if (!entry) return;
        if (entry.initialYear !== undefined) {
            for (let year = entry.initialYear; year <= entry.finalYear; year++) {
                visit(formatCell(entry), year);
            }
        } else if (entry.captureDate !== undefined) {
            visit(formatCell(entry), waybackColumnLabel(entry, index));
        }
    });
}

function buildInspectionTable(point) {
    const years = [];
    const inspections = [];
    if (!point || !Array.isArray(point.userName)) {
        return { years: years, inspections: inspections };
    }

    const inspectionList = Array.isArray(point.inspection) ? point.inspection : [];

    point.userName.forEach(function (userName, i) {
        const row = { userName: userName, landUse: [] };
        const form = inspectionList[i] && inspectionList[i].form;
        forEachColumn(form, function (cell) {
            row.landUse.push(cell);
        });
        inspections.push(row);
    });

    // Cabeçalho das colunas: primeira inspeção, como no código original.
    const firstForm = inspectionList[0] && inspectionList[0].form;
    forEachColumn(firstForm, function (cell, column) {
        years.push(column);
    });

    return { years: years, inspections: inspections };
}

module.exports = { buildInspectionTable: buildInspectionTable };
