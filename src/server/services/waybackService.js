/**
 * waybackService — integração com o Esri Wayback (histórico do World Imagery).
 *
 * Concentra TODA a superfície de contato com os serviços públicos da Esri:
 *   - Catálogo de releases (waybackconfig.json, S3) — cache em memória, TTL 24 h.
 *   - Tilemap por release — dedupe de releases com imagem distinta num tile.
 *   - Metadados por release — data real de captura (captureDate) no ponto.
 *
 * O algoritmo de getLocalChanges replica o de @esri/wayback-core: varre as
 * releases da mais recente para a mais antiga; a resposta do tilemap indica em
 * `select[0]` qual release realmente provê o tile (sem mudança desde ela), o
 * que permite pular blocos inteiros de releases idênticas.
 */
const axios = require('axios');

const WAYBACK_CONFIG_URL = 'https://s3-us-west-2.amazonaws.com/config.maptiles.arcgis.com/waybackconfig.json';
const TILEMAP_BASE_URL = 'https://wayback.maptiles.arcgis.com/arcgis/rest/services/world_imagery/mapserver/tilemap';
const DEDUPE_ZOOM = 14;
const CONFIG_TTL_MS = 24 * 60 * 60 * 1000;
const HTTP_TIMEOUT_MS = 15000;
const MAX_RETRIES = 3;

// A camada de metadados de cada release é um MapServer com 14 sub-layers
// (id 0-13), cada um cobrindo uma faixa de resolução distinta (0 = 1.9cm,
// 13 = 150m) — confirmado no contrato real (MapServer/{id}/query; a raiz do
// MapServer não aceita query de features). O id é derivado do zoom via
// `MAX_ZOOM - zoom`, igual à implementação de referência (@esri/wayback-core,
// src/metadata/index.ts). O grid de inspeção do TVI renderiza os tiles até
// `zoomLevel + 6 = 19` (waybackMap.js), o maior zoom que o cliente de fato
// exibe — usamos esse valor para selecionar a camada mais detalhada
// compatível com a imagem mostrada ao inspetor.
const METADATA_MAX_ZOOM = 23;
const METADATA_MIN_ZOOM = 10;
// Cascata de zooms para a consulta de metadados: cada sub-layer do MapServer
// de metadados cobre uma faixa de resolução da imagem-fonte, e a faixa certa
// varia por região (áreas urbanas têm cobertura na camada mais detalhada;
// áreas rurais/Amazônia só a partir de camadas mais grossas — verificado
// empiricamente em 2026-08-01: ponto em -60.24,-7.69 sem features na layer 4
// e com WV03/1.2m na layer 6). Consulta da mais detalhada para a mais grossa
// e para na primeira com resultado; camadas 12-13 (TerraColor, mosaico global
// de 15 m sem data de captura) ficam de fora por não agregarem informação.
const METADATA_QUERY_ZOOMS = [19, 17, 15, 13];

function lonLatToTile(lon, lat, zoom) {
    const n = Math.pow(2, zoom);
    const x = Math.floor(((lon + 180) / 360) * n);
    const latRad = lat * Math.PI / 180;
    const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);
    return { x, y, z: zoom };
}

function parseReleaseDate(itemTitle) {
    const m = /(\d{4}-\d{2}-\d{2})/.exec(itemTitle || '');
    return m ? m[1] : null;
}

// Réplica de getLayerId em @esri/wayback-core: mapeia zoom -> id do sub-layer
// de metadados (0 = mais detalhado, 13 = menos detalhado), com clamp no piso.
function getMetadataLayerId(zoom) {
    const layerId = METADATA_MAX_ZOOM - zoom;
    const layerIdForMinZoom = METADATA_MAX_ZOOM - METADATA_MIN_ZOOM;
    return layerId > layerIdForMinZoom ? layerIdForMinZoom : layerId;
}

// fetchJson padrão: axios + retry com backoff exponencial simples.
function defaultFetchJson(logger) {
    return async function fetchJson(url) {
        let lastErr;
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                const res = await axios.get(url, { timeout: HTTP_TIMEOUT_MS });
                return res.data;
            } catch (err) {
                lastErr = err;
                if (attempt < MAX_RETRIES) {
                    await new Promise(r => setTimeout(r, 500 * Math.pow(2, attempt - 1)));
                }
            }
        }
        await logger.warn('Wayback: falha HTTP após retries', {
            module: 'waybackService', function: 'fetchJson',
            metadata: { url, error: lastErr && lastErr.message }
        });
        throw lastErr;
    };
}

function createWaybackService(deps) {
    const logger = deps.logger;
    const fetchJson = deps.fetchJson || defaultFetchJson(logger);
    let configCache = null; // { fetchedAt: epoch-ms, releases: [] }
    let pendingFetch = null; // memoização de promise para evitar cache stampede

    async function getReleases(force) {
        if (!force && configCache && (Date.now() - configCache.fetchedAt) < CONFIG_TTL_MS) {
            return configCache.releases;
        }
        // Se há fetch em andamento, reutilizar a promise (dedupe de requisições concorrentes)
        if (pendingFetch) {
            return pendingFetch;
        }
        // Criar nova promise e guardá-la para chamadas concorrentes
        pendingFetch = (async function () {
            try {
                const raw = await fetchJson(WAYBACK_CONFIG_URL);
                const releases = Object.keys(raw)
                    .map(function (num) {
                        return {
                            releaseNum: parseInt(num, 10),
                            releaseDate: parseReleaseDate(raw[num].itemTitle),
                            itemTitle: raw[num].itemTitle,
                            itemURL: raw[num].itemURL,
                            metadataLayerUrl: raw[num].metadataLayerUrl
                        };
                    })
                    .filter(function (r) { return r.releaseDate && r.itemURL; })
                    .sort(function (a, b) { return b.releaseDate.localeCompare(a.releaseDate); });
                configCache = { fetchedAt: Date.now(), releases };
                return releases;
            } finally {
                // Limpar pendingFetch após sucesso ou erro (permitir retry)
                pendingFetch = null;
            }
        })();
        return pendingFetch;
    }

    async function getLocalChanges(lon, lat) {
        const releases = await getReleases();
        const tile = lonLatToTile(lon, lat, DEDUPE_ZOOM);
        const result = [];
        let i = 0;
        while (i < releases.length) {
            const candidate = releases[i];
            const tm = await fetchJson(
                TILEMAP_BASE_URL + '/' + candidate.releaseNum + '/' + tile.z + '/' + tile.y + '/' + tile.x
            );
            if (!tm || !Array.isArray(tm.data) || !tm.data[0]) {
                // Sem tile nesta release neste local: releases mais antigas
                // tampouco terão (cobertura só cresce com o tempo).
                break;
            }
            const actualNum = (Array.isArray(tm.select) && tm.select.length)
                ? parseInt(tm.select[0], 10)
                : candidate.releaseNum;
            const actualIdx = releases.findIndex(function (r) { return r.releaseNum === actualNum; });
            const actual = actualIdx >= 0 ? releases[actualIdx] : candidate;
            result.push(actual);
            i = (actualIdx >= 0 ? actualIdx : i) + 1;
        }
        return result;
    }

    async function getMetadata(release, lon, lat) {
        const empty = { captureDate: null, source: null, resolution: null };
        try {
            const geometry = JSON.stringify({ x: lon, y: lat, spatialReference: { wkid: 4326 } });
            for (const zoom of METADATA_QUERY_ZOOMS) {
                const layerId = getMetadataLayerId(zoom);
                const url = release.metadataLayerUrl + '/' + layerId + '/query'
                    + '?f=json&geometryType=esriGeometryPoint&inSR=4326'
                    + '&spatialRel=esriSpatialRelIntersects&returnGeometry=false'
                    + '&outFields=SRC_DATE2,SRC_DESC,SAMP_RES'
                    + '&geometry=' + encodeURIComponent(geometry);
                const data = await fetchJson(url);
                const attrs = data && data.features && data.features[0] && data.features[0].attributes;
                if (!attrs) continue;
                return {
                    captureDate: attrs.SRC_DATE2
                        ? new Date(attrs.SRC_DATE2).toISOString().slice(0, 10)
                        : null,
                    source: attrs.SRC_DESC || null,
                    resolution: (typeof attrs.SAMP_RES === 'number') ? attrs.SAMP_RES : null
                };
            }
            return empty;
        } catch (err) {
            await logger.warn('Wayback: metadados indisponíveis para release', {
                module: 'waybackService', function: 'getMetadata',
                metadata: { releaseNum: release.releaseNum, error: err.message }
            });
            return empty;
        }
    }

    return { getReleases, getLocalChanges, getMetadata };
}

let instance = null;

module.exports = function (app) {
    if (!instance) {
        instance = createWaybackService({ logger: app.services.logger });
    }
    return instance;
};
module.exports.createWaybackService = createWaybackService;
module.exports.lonLatToTile = lonLatToTile;
module.exports.parseReleaseDate = parseReleaseDate;
module.exports.getMetadataLayerId = getMetadataLayerId;
module.exports.DEDUPE_ZOOM = DEDUPE_ZOOM;
module.exports.METADATA_QUERY_ZOOMS = METADATA_QUERY_ZOOMS;
