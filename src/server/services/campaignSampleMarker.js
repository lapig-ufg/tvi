/**
 * campaignSampleMarker: representação da amostra nas células da grade, por
 * campanha: símbolo (marcador tradicional, quadrado ou círculo), raio em
 * metros a partir do centro e estilo do contorno e do preenchimento.
 *
 * Padrões e limites são replicados em client/services/sample-marker-core.js;
 * a paridade entre os dois é garantida por teste. Módulo puro, sem
 * dependências do app.
 */
'use strict';

const SYMBOLS = Object.freeze(['marker', 'square', 'circle']);

// Raio de 15 m: quadrado de 30 m de lado, o pixel Landsat/MapBiomas.
const DEFAULTS = Object.freeze({
    symbol: 'marker',
    radiusMeters: 15,
    color: '#29e7e4',
    weight: 2,
    fill: false,
    fillOpacity: 0.2
});

const LIMITS = Object.freeze({
    radiusMeters: Object.freeze({ min: 1, max: 10000 }),
    weight: Object.freeze({ min: 1, max: 10 }),
    fillOpacity: Object.freeze({ min: 0, max: 1 })
});

const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

function isBlank(value) {
    return value === undefined || value === null || value === '';
}

function toNumber(value) {
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : null;
    }
    if (typeof value === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(value)) {
        return Number(value);
    }
    return null;
}

function inRange(number, limits) {
    return number !== null && number >= limits.min && number <= limits.max;
}

// Cada normalizador devolve o valor válido ou null.
const NORMALIZERS = {
    symbol: (value) => (SYMBOLS.indexOf(value) !== -1 ? value : null),
    radiusMeters: (value) => {
        const number = toNumber(value);
        return inRange(number, LIMITS.radiusMeters) ? number : null;
    },
    color: (value) => (typeof value === 'string' && COLOR_PATTERN.test(value) ? value.toLowerCase() : null),
    weight: (value) => {
        const number = toNumber(value);
        return inRange(number, LIMITS.weight) && Number.isInteger(number) ? number : null;
    },
    fill: (value) => (typeof value === 'boolean' ? value : null),
    fillOpacity: (value) => {
        const number = toNumber(value);
        return inRange(number, LIMITS.fillOpacity) ? number : null;
    }
};

const ERRORS = {
    symbol: `sampleMarker.symbol must be one of ${SYMBOLS.join(', ')}`,
    radiusMeters: `sampleMarker.radiusMeters must be a number between ${LIMITS.radiusMeters.min} and ${LIMITS.radiusMeters.max}`,
    color: 'sampleMarker.color must be a hexadecimal color like #29e7e4',
    weight: `sampleMarker.weight must be an integer between ${LIMITS.weight.min} and ${LIMITS.weight.max}`,
    fill: 'sampleMarker.fill must be a boolean',
    fillOpacity: `sampleMarker.fillOpacity must be a number between ${LIMITS.fillOpacity.min} and ${LIMITS.fillOpacity.max}`
};

function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseSampleMarkerInput(value) {
    if (isBlank(value)) {
        return { value: Object.assign({}, DEFAULTS) };
    }
    if (!isPlainObject(value)) {
        return { error: 'sampleMarker must be an object' };
    }
    const result = {};
    for (const field of Object.keys(DEFAULTS)) {
        if (isBlank(value[field])) {
            result[field] = DEFAULTS[field];
            continue;
        }
        const normalized = NORMALIZERS[field](value[field]);
        if (normalized === null) {
            return { error: ERRORS[field] };
        }
        result[field] = normalized;
    }
    return { value: result };
}

function resolveSampleMarker(campaign) {
    const source = campaign && isPlainObject(campaign.sampleMarker) ? campaign.sampleMarker : {};
    const result = {};
    for (const field of Object.keys(DEFAULTS)) {
        const normalized = isBlank(source[field]) ? null : NORMALIZERS[field](source[field]);
        result[field] = normalized === null ? DEFAULTS[field] : normalized;
    }
    return result;
}

module.exports = {
    SYMBOLS,
    DEFAULTS,
    LIMITS,
    COLOR_PATTERN,
    parseSampleMarkerInput,
    resolveSampleMarker
};
