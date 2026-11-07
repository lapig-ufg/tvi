/**
 * PointPropertyDisplayCore: núcleo puro das colunas de `point.properties`
 * exibidas no quadro de localização (sem Angular).
 *
 * Listas, limites e regras de normalização replicam
 * server/services/campaignPropertyDisplay.js (paridade garantida por teste
 * em src/server/test/pointPropertyDisplayCore.test.js). Aqui a normalização
 * é leniente, como a resolução do servidor, porque o cliente consome
 * configurações já validadas ou documentos antigos sem o campo.
 *
 * UMD mínimo como sample-marker-core.js: no browser registra
 * window.PointPropertyDisplayCore; em Node exporta via module.exports. ES5
 * por compatibilidade com o restante do client (AngularJS 1.5.8).
 */
(function (global) {
    'use strict';

    var LISTS = ['default', 'pt-BR', 'en', 'id'];

    var LIMITS = Object.freeze({ items: 30, keyLength: 100, labelLength: 60 });

    // Campos fixos do ponto que o quadro já mostra com rótulo próprio. A
    // comparação usa a chave em minúsculas contra esta lista, exatamente como
    // as telas faziam antes da configuração por idioma.
    var DEFAULT_HIDDEN_KEYS = ['biome', 'uf', 'county', 'countyCode', 'lat', 'lon', 'longitude', 'latitude'];

    var PROPERTIES_PREFIX = 'properties.';

    function isBlank(value) {
        return value === undefined || value === null || value === '';
    }

    function isPlainObject(value) {
        return value !== null && typeof value === 'object' && !Array.isArray(value);
    }

    function hasOwn(object, key) {
        return Object.prototype.hasOwnProperty.call(object, key);
    }

    function normalizeKey(value) {
        if (typeof value !== 'string') {
            return null;
        }
        var key = value.trim();
        return key.length > 0 && key.length <= LIMITS.keyLength ? key : null;
    }

    function normalizeLabel(value) {
        if (isBlank(value) || typeof value !== 'string') {
            return '';
        }
        var label = value.trim();
        return label.length <= LIMITS.labelLength ? label : '';
    }

    function normalizeList(value) {
        if (!Array.isArray(value)) {
            return [];
        }
        var items = [];
        var seen = {};
        for (var i = 0; i < value.length && items.length < LIMITS.items; i++) {
            var key = isPlainObject(value[i]) ? normalizeKey(value[i].key) : null;
            if (key === null || hasOwn(seen, key)) {
                continue;
            }
            seen[key] = true;
            items.push({ key: key, label: normalizeLabel(value[i].label) });
        }
        return items;
    }

    var PointPropertyDisplayCore = {

        LISTS: Object.freeze(LISTS.slice()),

        LIMITS: LIMITS,

        DEFAULT_HIDDEN_KEYS: Object.freeze(DEFAULT_HIDDEN_KEYS.slice()),

        normalize: function (value) {
            var source = isPlainObject(value) ? value : {};
            var result = {};
            LISTS.forEach(function (name) {
                result[name] = normalizeList(source[name]);
            });
            return result;
        },

        formatKey: function (key) {
            return key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' ');
        },

        // Linhas do quadro: a lista do idioma ativo, senão a padrão, senão
        // todas as colunas fora dos campos fixos, na ordem do ponto.
        rows: function (properties, config, language) {
            if (!isPlainObject(properties)) {
                return [];
            }
            var settings = PointPropertyDisplayCore.normalize(config);
            var list = hasOwn(settings, language) && settings[language].length ? settings[language] : settings['default'];
            if (list.length) {
                return list.filter(function (item) {
                    return hasOwn(properties, item.key);
                }).map(function (item) {
                    return {
                        key: item.key,
                        label: item.label || PointPropertyDisplayCore.formatKey(item.key),
                        value: properties[item.key]
                    };
                });
            }
            return Object.keys(properties).filter(function (key) {
                return DEFAULT_HIDDEN_KEYS.indexOf(key.toLowerCase()) === -1;
            }).map(function (key) {
                return { key: key, label: PointPropertyDisplayCore.formatKey(key), value: properties[key] };
            });
        },

        // Colunas customizadas da resposta de GET /api/campaigns/:id/properties
        // (PropertyAnalyzer), que nomeia as chaves do ponto como "properties.X".
        keysFromAnalysis: function (response) {
            if (!isPlainObject(response) || !Array.isArray(response.allProperties)) {
                return [];
            }
            var keys = [];
            response.allProperties.forEach(function (property) {
                if (!property || property.isCustom !== true || typeof property.name !== 'string') {
                    return;
                }
                var key = property.name.indexOf(PROPERTIES_PREFIX) === 0
                    ? property.name.slice(PROPERTIES_PREFIX.length)
                    : property.name;
                if (key && keys.indexOf(key) === -1) {
                    keys.push(key);
                }
            });
            return keys;
        }
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = PointPropertyDisplayCore;
    }
    if (global) {
        global.PointPropertyDisplayCore = PointPropertyDisplayCore;
    }
})(typeof window !== 'undefined' ? window : null);
