/**
 * waybackInspectionGuard — validação do formato de inspeção por release.
 *
 * Campanha wayback grava inspection.form como [{releaseNum, captureDate,
 * landUse, pixelBorder}]; as demais campanhas gravam o formato histórico por
 * ano. Este guard impede o cruzamento dos dois formatos (defesa no endpoint
 * updatePoint). Módulo puro, sem dependências do app — como usernameMatcher.
 */
'use strict';

function validate(campaign, inspection) {
    const isWayback = !!(campaign && campaign.imageType === 'wayback');
    const form = (inspection && Array.isArray(inspection.form)) ? inspection.form : [];
    const hasReleaseEntries = form.some(function (f) {
        return f && f.releaseNum !== undefined;
    });

    if (!isWayback) {
        if (hasReleaseEntries) {
            return { ok: false, error: 'Payload de inspeção Wayback não é aceito nesta campanha.' };
        }
        // Formato por ano: validação de conteúdo permanece onde sempre esteve.
        return { ok: true };
    }

    if (!form.length) {
        return { ok: false, error: 'Inspeção Wayback requer ao menos uma entrada por release.' };
    }
    const invalid = form.some(function (f) {
        return !f
            || typeof f.releaseNum !== 'number'
            || typeof f.captureDate !== 'string' || f.captureDate === ''
            || typeof f.landUse !== 'string' || f.landUse === '';
    });
    if (invalid) {
        return { ok: false, error: 'Inspeção Wayback inválida: releaseNum, captureDate e landUse são obrigatórios em todas as entradas.' };
    }
    return { ok: true };
}

module.exports = { validate: validate };
