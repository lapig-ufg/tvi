/**
 * SampleMarkerCore: núcleo puro do símbolo da amostra (sem Angular/Leaflet).
 *
 * Padrões, limites e regras de normalização replicam
 * server/services/campaignSampleMarker.js (paridade garantida por teste em
 * src/server/test/sampleMarkerCore.test.js). Aqui a normalização é leniente:
 * campo ausente ou inválido cai no padrão, porque o cliente consome
 * configurações já validadas pelo servidor ou documentos antigos sem o campo.
 *
 * UMD mínimo como wayback-grid-core.js: no browser registra
 * window.SampleMarkerCore (consumido por sampleMarkerService e pelos
 * controllers); em Node exporta via module.exports. ES5 por compatibilidade
 * com o restante do client (AngularJS 1.5.8).
 */
(function (global) {
    'use strict';

    var SYMBOLS = ['marker', 'square', 'circle'];

    // Raio de 15 m: quadrado de 30 m de lado, o pixel Landsat/MapBiomas.
    var DEFAULTS = {
        symbol: 'marker',
        radiusMeters: 15,
        color: '#29e7e4',
        weight: 2,
        fill: false,
        fillOpacity: 0.2
    };

    var LIMITS = {
        radiusMeters: { min: 1, max: 10000 },
        weight: { min: 1, max: 10 },
        fillOpacity: { min: 0, max: 1 }
    };

    var COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

    // Circunferência equatorial WGS84, a mesma de LatLng.toBounds do Leaflet
    // (meio-lado em graus de latitude = 180 · lado / circunferência; em
    // longitude, dividido pelo cosseno da latitude). O quadrado de raio r mede
    // 2r de lado com erro inferior a 0,2 % em qualquer latitude e aparece como
    // quadrado na projeção Web Mercator.
    var EQUATOR_CIRCUMFERENCE = 40075017;

    function isBlank(value) {
        return value === undefined || value === null || value === '';
    }

    function toNumber(value) {
        if (typeof value === 'number') {
            return isFinite(value) ? value : null;
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
    var NORMALIZERS = {
        symbol: function (value) {
            return SYMBOLS.indexOf(value) !== -1 ? value : null;
        },
        radiusMeters: function (value) {
            var number = toNumber(value);
            return inRange(number, LIMITS.radiusMeters) ? number : null;
        },
        color: function (value) {
            return typeof value === 'string' && COLOR_PATTERN.test(value) ? value.toLowerCase() : null;
        },
        weight: function (value) {
            var number = toNumber(value);
            return inRange(number, LIMITS.weight) && number % 1 === 0 ? number : null;
        },
        fill: function (value) {
            return typeof value === 'boolean' ? value : null;
        },
        fillOpacity: function (value) {
            var number = toNumber(value);
            return inRange(number, LIMITS.fillOpacity) ? number : null;
        }
    };

    function isPlainObject(value) {
        return value !== null && typeof value === 'object' && !Array.isArray(value);
    }

    var SampleMarkerCore = {

        SYMBOLS: SYMBOLS.slice(),

        LIMITS: LIMITS,

        defaults: function () {
            var result = {};
            Object.keys(DEFAULTS).forEach(function (field) {
                result[field] = DEFAULTS[field];
            });
            return result;
        },

        normalize: function (value) {
            var source = isPlainObject(value) ? value : {};
            var result = {};
            Object.keys(DEFAULTS).forEach(function (field) {
                var normalized = isBlank(source[field]) ? null : NORMALIZERS[field](source[field]);
                result[field] = normalized === null ? DEFAULTS[field] : normalized;
            });
            return result;
        },

        isVector: function (config) {
            return SampleMarkerCore.normalize(config).symbol !== 'marker';
        },

        squareBounds: function (lat, lon, radiusMeters) {
            var halfLat = 180 * (2 * radiusMeters) / EQUATOR_CIRCUMFERENCE;
            var halfLon = halfLat / Math.cos((Math.PI / 180) * lat);
            return { south: lat - halfLat, west: lon - halfLon, north: lat + halfLat, east: lon + halfLon };
        },

        // Vértices SW, SE, NE, NW em [lat, lon]; o Polygon do Leaflet fecha o anel.
        squareLatLngs: function (lat, lon, radiusMeters) {
            var bounds = SampleMarkerCore.squareBounds(lat, lon, radiusMeters);
            return [
                [bounds.south, bounds.west],
                [bounds.south, bounds.east],
                [bounds.north, bounds.east],
                [bounds.north, bounds.west]
            ];
        },

        // Opções de L.Path. Não interativo para preservar arrastar e zoom da
        // célula; o preenchimento usa a cor do contorno.
        pathStyle: function (config) {
            var settings = SampleMarkerCore.normalize(config);
            return {
                color: settings.color,
                weight: settings.weight,
                fill: settings.fill,
                fillColor: settings.color,
                fillOpacity: settings.fillOpacity,
                interactive: false
            };
        }
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = SampleMarkerCore;
    }
    if (global) {
        global.SampleMarkerCore = SampleMarkerCore;
    }
})(typeof window !== 'undefined' ? window : null);
