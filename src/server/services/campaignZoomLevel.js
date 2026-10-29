/**
 * campaignZoomLevel: nível de zoom inicial dos mapas da grade, por campanha.
 *
 * O valor é também o zoom mínimo de cada célula da grade. O teto de 18 vem do
 * maxZoom fixo das tile layers Landsat, Sentinel e WMS do cliente: acima dele
 * a célula não renderiza tiles. Módulo puro, sem dependências do app.
 */
'use strict';

const DEFAULT_ZOOM_LEVEL = 13;
const MIN_ZOOM_LEVEL = 10;
const MAX_ZOOM_LEVEL = 18;

function normalizeZoomLevel(value) {
    let number;
    if (typeof value === 'number') {
        number = value;
    } else if (typeof value === 'string' && /^\s*\d+\s*$/.test(value)) {
        number = Number(value);
    } else {
        return null;
    }
    if (!Number.isInteger(number) || number < MIN_ZOOM_LEVEL || number > MAX_ZOOM_LEVEL) {
        return null;
    }
    return number;
}

function parseZoomLevelInput(value) {
    if (value === undefined || value === null || value === '') {
        return { value: DEFAULT_ZOOM_LEVEL };
    }
    const normalized = normalizeZoomLevel(value);
    if (normalized === null) {
        return { error: `zoomLevel must be an integer between ${MIN_ZOOM_LEVEL} and ${MAX_ZOOM_LEVEL}` };
    }
    return { value: normalized };
}

function resolveZoomLevel(campaign) {
    const normalized = campaign ? normalizeZoomLevel(campaign.zoomLevel) : null;
    return normalized === null ? DEFAULT_ZOOM_LEVEL : normalized;
}

module.exports = {
    DEFAULT_ZOOM_LEVEL,
    MIN_ZOOM_LEVEL,
    MAX_ZOOM_LEVEL,
    normalizeZoomLevel,
    parseZoomLevelInput,
    resolveZoomLevel
};
