/**
 * campaignPropertyDisplay: colunas de `point.properties` exibidas no quadro
 * de localização das telas do intérprete e do supervisor, com uma lista por
 * idioma da interface e uma lista padrão. Cada item guarda a coluna e um
 * rótulo opcional cadastrado pelo admin; o conteúdo das colunas nunca é
 * traduzido.
 *
 * Listas e limites são replicados em
 * client/services/point-property-display-core.js; a paridade é garantida por
 * teste. Módulo puro, sem dependências do app.
 */
'use strict';

const LISTS = Object.freeze(['default', 'pt-BR', 'en', 'id']);

const LIMITS = Object.freeze({ items: 30, keyLength: 100, labelLength: 60 });

function isBlank(value) {
    return value === undefined || value === null || value === '';
}

function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function emptyPropertyDisplay() {
    const result = {};
    LISTS.forEach((list) => { result[list] = []; });
    return result;
}

function normalizeKey(value) {
    if (typeof value !== 'string') return null;
    const key = value.trim();
    return key.length > 0 && key.length <= LIMITS.keyLength ? key : null;
}

function normalizeLabel(value) {
    if (isBlank(value)) return '';
    if (typeof value !== 'string') return null;
    const label = value.trim();
    return label.length <= LIMITS.labelLength ? label : null;
}

function parseList(name, value) {
    if (isBlank(value)) return { value: [] };
    if (!Array.isArray(value)) return { error: `propertyDisplay.${name} must be an array` };
    if (value.length > LIMITS.items) {
        return { error: `propertyDisplay.${name} accepts at most ${LIMITS.items} columns` };
    }
    const items = [];
    const seen = new Set();
    for (const item of value) {
        const key = isPlainObject(item) ? normalizeKey(item.key) : null;
        if (key === null) return { error: `propertyDisplay.${name} has an invalid column` };
        const label = normalizeLabel(item.label);
        if (label === null) return { error: `propertyDisplay.${name} has an invalid label` };
        if (seen.has(key)) return { error: `propertyDisplay.${name} repeats column ${key}` };
        seen.add(key);
        items.push({ key, label });
    }
    return { value: items };
}

function parsePropertyDisplayInput(value) {
    if (isBlank(value)) return { value: emptyPropertyDisplay() };
    if (!isPlainObject(value)) return { error: 'propertyDisplay must be an object' };
    const unknown = Object.keys(value).find((name) => LISTS.indexOf(name) === -1);
    if (unknown !== undefined) return { error: `propertyDisplay.${unknown} is not a supported list` };
    const result = {};
    for (const name of LISTS) {
        const parsed = parseList(name, value[name]);
        if (parsed.error) return { error: parsed.error };
        result[name] = parsed.value;
    }
    return { value: result };
}

function resolveList(value) {
    if (!Array.isArray(value)) return [];
    const items = [];
    const seen = new Set();
    for (const item of value) {
        if (items.length === LIMITS.items) break;
        const key = isPlainObject(item) ? normalizeKey(item.key) : null;
        if (key === null || seen.has(key)) continue;
        seen.add(key);
        items.push({ key, label: normalizeLabel(item.label) || '' });
    }
    return items;
}

function resolvePropertyDisplay(campaign) {
    const source = campaign && isPlainObject(campaign.propertyDisplay) ? campaign.propertyDisplay : {};
    const result = {};
    LISTS.forEach((name) => { result[name] = resolveList(source[name]); });
    return result;
}

module.exports = {
    LISTS,
    LIMITS,
    emptyPropertyDisplay,
    parsePropertyDisplayInput,
    resolvePropertyDisplay
};
