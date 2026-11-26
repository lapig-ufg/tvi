'use strict';

const csv = require('fast-csv');
const MAX_POINTS = 1000;
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_PROPERTY_BYTES = 32 * 1024;
const MAX_DEPTH = 20;

function fail(message) {
    const error = new Error(message);
    error.statusCode = 400;
    throw error;
}

function plain(value) {
    return value !== null && typeof value === 'object' &&
        (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function validateTree(value, depth = 0, ancestors = new Set()) {
    if (depth > MAX_DEPTH) fail('A profundidade das propriedades excede o limite permitido.');
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
    if (typeof value === 'number' && Number.isFinite(value)) return;
    if (typeof value !== 'object' || (!Array.isArray(value) && !plain(value)) || ancestors.has(value)) {
        fail('O conteúdo deve conter apenas valores JSON válidos.');
    }
    ancestors.add(value);
    for (const key of Object.keys(value)) {
        if (key.startsWith('$') || key.includes('.') || ['__proto__', 'constructor', 'prototype'].includes(key)) {
            fail('O conteúdo contém uma propriedade não permitida.');
        }
        validateTree(value[key], depth + 1, ancestors);
    }
    ancestors.delete(value);
}

function identifier(value) {
    if (typeof value !== 'string' || /[\u0000-\u001f\u007f-\u009f]/.test(value)) {
        fail('Cada identificador deve ser um texto sem caracteres de controle.');
    }
    const id = value.trim();
    if (!id.length || id.length > 200) fail('Cada identificador deve conter entre 1 e 200 caracteres.');
    return id;
}

function delimiter(content) {
    let quoted = false;
    let commas = 0;
    let semicolons = 0;
    for (let i = 0; i < content.length; i++) {
        const char = content[i];
        if (char === '"') {
            if (quoted && content[i + 1] === '"') i++;
            else quoted = !quoted;
        } else if (!quoted) {
            if (char === '\n' || char === '\r') break;
            if (char === ',') commas++;
            if (char === ';') semicolons++;
        }
    }
    return semicolons > commas ? ';' : ',';
}

function parseCsv(content) {
    if (typeof content !== 'string') fail('O conteúdo CSV deve ser texto.');
    return new Promise((resolve, reject) => {
        const entries = [];
        let idHeader;
        const stream = csv.parseString(content.replace(/^\uFEFF/, ''), { headers: true, delimiter: delimiter(content), ignoreEmpty: false });
        stream.on('error', () => {
            const error = new Error('O arquivo CSV é inválido ou contém identificadores inválidos.');
            error.statusCode = 400;
            reject(error);
        });
        stream.on('headers', headers => {
            const matches = headers.filter(header => ['_id', 'id', 'pointid'].includes(header.trim().toLowerCase()));
            if (matches.length !== 1) {
                stream.destroy(new Error('Cabeçalho inválido.'));
                return;
            }
            idHeader = matches[0];
        });
        stream.on('data', row => {
            try {
                entries.push({ id: identifier(row[idHeader]) });
                if (entries.length > MAX_POINTS) fail('A quantidade de pontos excede o limite permitido.');
            } catch (error) { stream.destroy(error); }
        });
        stream.on('end', () => resolve(entries));
    });
}

function parseGeojson(content, kind) {
    let collection = content;
    if (typeof content === 'string') {
        try { collection = JSON.parse(content); }
        catch (error) { fail('O conteúdo GeoJSON é inválido.'); }
    }
    validateTree(collection);
    if (!plain(collection) || collection.type !== 'FeatureCollection' || !Array.isArray(collection.features)) {
        fail('O GeoJSON deve ser uma FeatureCollection.');
    }
    if (collection.features.length > MAX_POINTS) fail('A quantidade de pontos excede o limite permitido.');
    return collection.features.map(feature => {
        if (!plain(feature) || feature.type !== 'Feature' || !plain(feature.geometry) || feature.geometry.type !== 'Point') {
            fail('Cada feição deve conter uma geometria Point.');
        }
        const coords = feature.geometry.coordinates;
        if (!Array.isArray(coords) || (coords.length !== 2 && coords.length !== 3) ||
            !coords.every(value => typeof value === 'number' && Number.isFinite(value)) ||
            Math.abs(coords[0]) > 180 || Math.abs(coords[1]) > 90) {
            fail('As coordenadas devem ser números finitos nos limites WGS84.');
        }
        const properties = feature.properties == null ? {} : feature.properties;
        if (!plain(properties) || Buffer.byteLength(JSON.stringify(properties), 'utf8') > MAX_PROPERTY_BYTES) {
            fail('As propriedades da feição são inválidas ou excedem 32 KiB.');
        }
        const entry = { lon: coords[0], lat: coords[1], properties: JSON.parse(JSON.stringify(properties)) };
        if (kind === 'add' && feature.id !== undefined) {
            entry.id = identifier(typeof feature.id === 'number' && Number.isFinite(feature.id) ? String(feature.id) : feature.id);
        }
        return entry;
    });
}

async function parseInput(body) {
    if (!plain(body) || !['add', 'delete'].includes(body.kind) || !['geojson', 'csv', 'ids'].includes(body.format)) {
        fail('A operação ou o formato informado é inválido.');
    }
    validateTree(body);
    if (Buffer.byteLength(JSON.stringify(body), 'utf8') > MAX_BYTES) fail('O conteúdo excede o limite de 5 MiB.');
    let entries;
    if (body.format === 'geojson') entries = parseGeojson(body.content, body.kind);
    else if (body.format === 'csv') entries = await parseCsv(body.content);
    else {
        const values = body.ids !== undefined ? body.ids : (Array.isArray(body.content) ? body.content : [body.content]);
        if (!Array.isArray(values)) fail('A lista de identificadores é inválida.');
        entries = values.map(value => ({ id: identifier(value) }));
    }
    if (!entries.length || entries.length > MAX_POINTS) fail('Informe entre 1 e 1000 pontos.');
    const ids = new Set();
    const coordinates = new Set();
    for (const entry of entries) {
        if (entry.id !== undefined && body.format !== 'geojson') {
            if (ids.has(entry.id)) fail('O conteúdo contém identificadores repetidos.');
            ids.add(entry.id);
        }
        if (entry.lon !== undefined) {
            const key = entry.lon + ',' + entry.lat;
            if (coordinates.has(key)) fail('O conteúdo contém coordenadas repetidas.');
            coordinates.add(key);
        }
    }
    return entries;
}

module.exports = { parseInput, MAX_POINTS, MAX_BYTES };
