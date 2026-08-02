# Plano de Implementação — Módulo Esri Wayback no TVI

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir campanhas TVI cuja grade de imagens é a série histórica do Esri Wayback, com datas específicas por ponto, classificação por release e zero impacto no fluxo existente.

**Architecture:** Módulo paralelo isolado ativado por `imageType: 'wayback'` na campanha. Server: serviço de integração com as APIs públicas do Wayback (catálogo, tilemap, metadados) + job de pré-computação que persiste `waybackImages[]` por ponto. Client: núcleo puro de montagem de grade (testável em Node), serviço Angular, diretiva Leaflet própria e ramo de formulário por data. Único ponto de contato com o fluxo atual: *early-return* em `generateMaps()` e guardas `!isWayback` nos `ng-if` do template.

**Tech Stack:** Node/Express 4 + MongoDB driver 2.2 (server), AngularJS 1.5.8 + Leaflet (client), `node --test` + `node:assert/strict` (testes), axios (HTTP externo).

**Spec:** `docs/superpowers/specs/2026-08-01-wayback-imagery-design.md`

## Global Constraints

- **Zero impacto no fluxo existente**: campanhas `landsat`/`sentinel-2`/`planet`/`wms` não mudam de comportamento. Pontos de contato permitidos com código existente estão enumerados nas tarefas 3, 4, 7 e 8 — nada além deles.
- **Testes**: executar sempre com `cd src/server && npm test` (roda `node --test test/*.test.js`). Testes de integração com Mongo seguem o padrão de `test/blockRoundSemantics.test.js` (skip quando Mongo indisponível; default `127.0.0.1:27019`, env `TVI_TEST_MONGO_HOST/PORT`).
- **i18n**: toda chave nova deve ser adicionada aos 3 arquivos `src/client/i18n/{pt-BR,en,id}.json` — o teste `i18nParity.test.js` falha se faltar paridade.
- **Commits**: formato MEMORA `tipo(tvi): descrição` — sem Co-Authored-By, sem referências autorais. **Executar os passos de commit somente se o usuário tiver autorizado commits ao aprovar a execução deste plano; caso contrário, pular os passos de commit e informar ao final.**
- **Norma culta pt-BR** em comentários de documentação e mensagens exibidas ao usuário.
- **Constantes Wayback** (verificadas contra `@esri/wayback-core`; se o serviço real divergir na Tarefa 9, ajustar somente `waybackService.js`):
  - Catálogo: `https://s3-us-west-2.amazonaws.com/config.maptiles.arcgis.com/waybackconfig.json`
  - Tilemap: `https://wayback.maptiles.arcgis.com/arcgis/rest/services/world_imagery/mapserver/tilemap/{releaseNum}/{z}/{y}/{x}`
  - Tiles: campo `itemURL` do catálogo, template com `{level}/{row}/{col}`
  - Metadados: campo `metadataLayerUrl` do catálogo + `/query` (ArcGIS REST, `f=json`)
  - Zoom de dedupe: `14`

---

### Task 1: Serviço server-side `waybackService`

**Files:**
- Create: `src/server/services/waybackService.js`
- Test: `src/server/test/waybackService.test.js`

**Interfaces:**
- Consumes: `app.services.logger` (já existente; carregado antes por ordem alfabética do `express-load`).
- Produces (usado pelas Tarefas 2 e 9):
  - `module.exports = function(app)` → objeto singleton `{ getReleases, getLocalChanges, getMetadata }` exposto como `app.services.waybackService`.
  - `module.exports.createWaybackService({ logger, fetchJson })` → mesma API com HTTP injetável (para testes).
  - `module.exports.lonLatToTile(lon, lat, zoom)` → `{ x, y, z }` (slippy tiles, WebMercator).
  - `getReleases(force?)` → `Promise<[{ releaseNum:number, releaseDate:'YYYY-MM-DD', itemTitle, itemURL, metadataLayerUrl }]>` ordenado por `releaseDate` **decrescente**, cache em memória com TTL 24 h.
  - `getLocalChanges(lon, lat)` → `Promise<subconjunto de releases>` em que a imagem do tile z14 do ponto de fato mudou.
  - `getMetadata(release, lon, lat)` → `Promise<{ captureDate:'YYYY-MM-DD'|null, source:string|null, resolution:number|null }>` (nunca rejeita; em falha retorna nulls).

- [ ] **Step 1: Escrever os testes que falham**

Criar `src/server/test/waybackService.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const waybackModule = require(path.join(__dirname, '..', 'services', 'waybackService'));
const { createWaybackService, lonLatToTile } = waybackModule;

const silentLogger = {
    info: async () => {}, warn: async () => {}, error: async () => {}
};

// Catálogo fake: 4 releases (datas decrescentes 2024, 2022, 2018, 2014).
const FAKE_CONFIG = {
    '64776': { itemTitle: 'World Imagery (Wayback 2024-01-11)', itemURL: 'https://wayback.maptiles.arcgis.com/arcgis/rest/services/world_imagery/wmts/1.0.0/default028mm/mapserver/tile/64776/{level}/{row}/{col}', metadataLayerUrl: 'https://metadata.maptiles.arcgis.com/arcgis/rest/services/Wayback_2024_r01/MapServer/0' },
    '35098': { itemTitle: 'World Imagery (Wayback 2022-03-02)', itemURL: 'https://wayback.maptiles.arcgis.com/arcgis/rest/services/world_imagery/wmts/1.0.0/default028mm/mapserver/tile/35098/{level}/{row}/{col}', metadataLayerUrl: 'https://metadata.maptiles.arcgis.com/arcgis/rest/services/Wayback_2022_r05/MapServer/0' },
    '47963': { itemTitle: 'World Imagery (Wayback 2018-06-06)', itemURL: 'https://wayback.maptiles.arcgis.com/arcgis/rest/services/world_imagery/wmts/1.0.0/default028mm/mapserver/tile/47963/{level}/{row}/{col}', metadataLayerUrl: 'https://metadata.maptiles.arcgis.com/arcgis/rest/services/Wayback_2018_r10/MapServer/0' },
    '10':    { itemTitle: 'World Imagery (Wayback 2014-02-20)', itemURL: 'https://wayback.maptiles.arcgis.com/arcgis/rest/services/world_imagery/wmts/1.0.0/default028mm/mapserver/tile/10/{level}/{row}/{col}', metadataLayerUrl: 'https://metadata.maptiles.arcgis.com/arcgis/rest/services/Wayback_2014_r01/MapServer/0' }
};

function fetchJsonStub(routes) {
    const calls = [];
    const fn = async (url) => {
        calls.push(url);
        for (const [match, result] of routes) {
            if (url.includes(match)) {
                if (result instanceof Error) throw result;
                return typeof result === 'function' ? result(url) : result;
            }
        }
        throw new Error('URL inesperada no stub: ' + url);
    };
    fn.calls = calls;
    return fn;
}

test('lonLatToTile: converte lon/lat em tile XYZ correto', () => {
    // Goiânia aprox (-49.25, -16.68) em z14 → x=5950, y=8955
    // x = floor((lon+180)/360 * 2^14); y = floor((1 - ln(tan+sec)/PI)/2 * 2^14)
    const t = lonLatToTile(-49.25, -16.68, 14);
    assert.equal(t.z, 14);
    assert.equal(t.x, Math.floor(((-49.25 + 180) / 360) * 16384));
    const latRad = -16.68 * Math.PI / 180;
    assert.equal(t.y, Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * 16384));
});

test('getReleases: ordena por data decrescente, extrai releaseDate do itemTitle e usa cache', async () => {
    const fetchJson = fetchJsonStub([['waybackconfig.json', FAKE_CONFIG]]);
    const svc = createWaybackService({ logger: silentLogger, fetchJson });
    const releases = await svc.getReleases();
    assert.deepEqual(releases.map(r => r.releaseDate),
        ['2024-01-11', '2022-03-02', '2018-06-06', '2014-02-20']);
    assert.deepEqual(releases.map(r => r.releaseNum), [64776, 35098, 47963, 10]);
    await svc.getReleases();
    assert.equal(fetchJson.calls.length, 1, 'segunda chamada deve vir do cache');
});

test('getLocalChanges: deduplica via tilemap seguindo select[] e para quando não há tile', async () => {
    // Cenário: consulta à release 2024 responde select=[35098] (imagem veio de 2022);
    // 2022 entra no resultado; próxima candidata é 2018, que responde sem select
    // (ela própria provê o tile); 2014 responde data=[0] (sem tile) e encerra.
    const fetchJson = fetchJsonStub([
        ['waybackconfig.json', FAKE_CONFIG],
        ['/tilemap/64776/', { data: [1], select: [35098] }],
        ['/tilemap/35098/', { data: [1], select: [35098] }],
        ['/tilemap/47963/', { data: [1] }],
        ['/tilemap/10/',    { data: [0] }]
    ]);
    const svc = createWaybackService({ logger: silentLogger, fetchJson });
    const changes = await svc.getLocalChanges(-49.25, -16.68);
    assert.deepEqual(changes.map(r => r.releaseNum), [35098, 47963]);
});

test('getMetadata: extrai captureDate/source/resolution e nunca rejeita', async () => {
    const epoch2018 = Date.UTC(2018, 3, 12); // 2018-04-12
    const fetchJson = fetchJsonStub([
        ['Wayback_2018_r10/MapServer/0/query', {
            features: [{ attributes: { SRC_DATE2: epoch2018, SRC_DESC: 'Maxar', SRC_RES: 0.3 } }]
        }],
        ['Wayback_2014_r01/MapServer/0/query', new Error('timeout')]
    ]);
    const svc = createWaybackService({ logger: silentLogger, fetchJson });

    const ok = await svc.getMetadata(
        { releaseNum: 47963, metadataLayerUrl: FAKE_CONFIG['47963'].metadataLayerUrl }, -49.25, -16.68);
    assert.deepEqual(ok, { captureDate: '2018-04-12', source: 'Maxar', resolution: 0.3 });

    const fail = await svc.getMetadata(
        { releaseNum: 10, metadataLayerUrl: FAKE_CONFIG['10'].metadataLayerUrl }, -49.25, -16.68);
    assert.deepEqual(fail, { captureDate: null, source: null, resolution: null });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `cd src/server && node --test test/waybackService.test.js`
Expected: FAIL (`Cannot find module '.../services/waybackService'`)

- [ ] **Step 3: Implementar `src/server/services/waybackService.js`**

```js
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

    async function getReleases(force) {
        if (!force && configCache && (Date.now() - configCache.fetchedAt) < CONFIG_TTL_MS) {
            return configCache.releases;
        }
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
            const url = release.metadataLayerUrl + '/query'
                + '?f=json&geometryType=esriGeometryPoint&inSR=4326'
                + '&spatialRel=esriSpatialRelIntersects&returnGeometry=false'
                + '&outFields=SRC_DATE2,SRC_DESC,SRC_RES'
                + '&geometry=' + encodeURIComponent(geometry);
            const data = await fetchJson(url);
            const attrs = data && data.features && data.features[0] && data.features[0].attributes;
            if (!attrs) return empty;
            return {
                captureDate: attrs.SRC_DATE2
                    ? new Date(attrs.SRC_DATE2).toISOString().slice(0, 10)
                    : null,
                source: attrs.SRC_DESC || null,
                resolution: (typeof attrs.SRC_RES === 'number') ? attrs.SRC_RES : null
            };
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
module.exports.DEDUPE_ZOOM = DEDUPE_ZOOM;
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `cd src/server && node --test test/waybackService.test.js`
Expected: PASS (4 testes)

- [ ] **Step 5: Rodar a suíte completa (regressão)**

Run: `cd src/server && npm test`
Expected: PASS (nenhum teste existente quebrado)

- [ ] **Step 6: Commit (se autorizado)**

```bash
git add src/server/services/waybackService.js src/server/test/waybackService.test.js
git commit -m "feat(tvi): adiciona serviço de integração com o Esri Wayback"
```

---

### Task 2: Job de pré-computação, coleção `waybackSync`, controller e rotas

**Files:**
- Create: `src/server/controllers/wayback.js`
- Create: `src/server/routes/wayback.js`
- Modify: `src/server/middleware/repository.js` (linha ~76, array `requiredCollections`)
- Test: `src/server/test/waybackSyncJob.test.js`

**Interfaces:**
- Consumes: `app.services.waybackService` (Task 1), `app.services.logger`, `app.repository.collections.{points, campaign, waybackSync}`.
- Produces (usado pelas Tarefas 3 e 7):
  - `app.controllers.wayback.runSyncJob(campaignId, { force })` → `Promise<{ alreadyRunning?:true, total, processed, failed }>`
  - `app.controllers.wayback.triggerSyncIfWayback(campaignId)` → fire-and-forget (lê a campanha; só age se `imageType === 'wayback'`)
  - `POST /api/wayback/sync/:campaignId?force=1` (sessão super-admin) → `{ started: true }`
  - `GET  /api/wayback/sync/:campaignId/status` (sessão super-admin) → documento `waybackSync`
  - `GET  /service/wayback/releases` → `[{ releaseNum, releaseDate, itemURL }]`
  - Documento `waybackSync`: `{ _id: campaignId, status: 'running'|'completed'|'completed_with_errors', startedAt, finishedAt, total, processed, errors: [{ pointId, error }] }`
  - Campos gravados no ponto: `waybackImages: [{ releaseNum, releaseDate, captureDate, source, resolution }]` (ordenado por data crescente) e `waybackSyncedAt: Date`.
- Nota: a spec cita `/service/wayback/sync`; o plano usa `/api/wayback/...` para os endpoints administrativos porque o middleware de sessão super-admin do projeto (clonado de `routes/campaignCrud.js:14-40`) opera sobre `req.session.admin` usado nas rotas `/api`. O endpoint consumido pelo client (`releases`) permanece em `/service/` como na spec.

- [ ] **Step 1: Adicionar a coleção `waybackSync` ao repositório**

Em `src/server/middleware/repository.js` (linha ~76), acrescentar `'waybackSync'` ao final do array:

```js
var requiredCollections = ['campaign', 'points', 'users', 'cacheConfig', 'logs', 'logsConfig', 'tvi_blocos', 'tickets', 'ticket_counters', 'weekly_progress', 'points_audit', 'tvi_blocos_release_log', 'tvi_zombie_counts', 'destructive_tokens', 'excess_inspection_previews', 'waybackSync'];
```

- [ ] **Step 2: Escrever os testes que falham**

Criar `src/server/test/waybackSyncJob.test.js` (padrão de integração de `blockRoundSemantics.test.js`: conecta em Mongo de teste; `t.skip` se indisponível). O controller é instanciado com um `app` fake:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const TEST_DB = 'tvi_wayback_sync_test';

function getMongoConfig() {
    return {
        host: process.env.TVI_TEST_MONGO_HOST || '127.0.0.1',
        port: parseInt(process.env.TVI_TEST_MONGO_PORT || '27019', 10)
    };
}

let mongodb;
try { mongodb = require(path.join(__dirname, '..', 'node_modules', 'mongodb')); } catch (e) { mongodb = null; }

const silentLogger = { info: async () => {}, warn: async () => {}, error: async () => {}, logError: async () => {} };

// waybackService fake e determinístico: 2 releases para qualquer ponto,
// exceto lon === 99 (sem cobertura) e lon === 88 (erro persistente).
function fakeWaybackService() {
    return {
        getReleases: async () => ([
            { releaseNum: 200, releaseDate: '2022-03-02', itemURL: 'https://w/{level}/{row}/{col}', metadataLayerUrl: 'https://m/0' },
            { releaseNum: 100, releaseDate: '2018-06-06', itemURL: 'https://w/{level}/{row}/{col}', metadataLayerUrl: 'https://m/0' }
        ]),
        getLocalChanges: async (lon) => {
            if (lon === 99) return [];
            if (lon === 88) throw new Error('tilemap fora do ar');
            return [
                { releaseNum: 200, releaseDate: '2022-03-02', metadataLayerUrl: 'https://m/0' },
                { releaseNum: 100, releaseDate: '2018-06-06', metadataLayerUrl: 'https://m/0' }
            ];
        },
        getMetadata: async (release) => ({
            captureDate: release.releaseNum === 200 ? '2022-01-15' : null,
            source: 'Maxar', resolution: 0.5
        })
    };
}

function buildApp(db, waybackService) {
    return {
        services: { logger: silentLogger, waybackService },
        repository: { collections: {
            points: db.collection('points'),
            campaign: db.collection('campaign'),
            waybackSync: db.collection('waybackSync')
        } }
    };
}

test('waybackSyncJob (integração)', async (t) => {
    if (!mongodb) return t.skip('driver mongodb indisponível');
    const cfg = getMongoConfig();
    let db;
    try {
        db = await mongodb.MongoClient.connect(
            `mongodb://${cfg.host}:${cfg.port}/${TEST_DB}`, { connectTimeoutMS: 2000 });
    } catch (e) { return t.skip('MongoDB de teste indisponível: ' + e.message); }

    const controllerFactory = require(path.join(__dirname, '..', 'controllers', 'wayback'));

    await t.test('processa pontos, grava waybackImages ordenado e marca waybackSyncedAt', async () => {
        await db.dropDatabase();
        const app = buildApp(db, fakeWaybackService());
        const wayback = controllerFactory(app);
        await db.collection('campaign').insertOne({ _id: 'camp_wb', imageType: 'wayback' });
        await db.collection('points').insertMany([
            { _id: '1_camp_wb', campaign: 'camp_wb', lon: -49.2, lat: -16.6 },
            { _id: '2_camp_wb', campaign: 'camp_wb', lon: 99, lat: 0 } // sem cobertura
        ]);
        const result = await wayback.runSyncJob('camp_wb', {});
        assert.equal(result.total, 2);
        assert.equal(result.processed, 2);
        assert.equal(result.failed.length, 0);

        const p1 = await db.collection('points').findOne({ _id: '1_camp_wb' });
        assert.ok(p1.waybackSyncedAt instanceof Date);
        // Ordenado por data de exibição crescente (captureDate || releaseDate):
        // release 100 → releaseDate 2018-06-06 (captureDate null);
        // release 200 → captureDate 2022-01-15.
        assert.deepEqual(p1.waybackImages.map(i => i.releaseNum), [100, 200]);
        assert.equal(p1.waybackImages[1].captureDate, '2022-01-15');
        assert.equal(p1.waybackImages[0].captureDate, null);

        const p2 = await db.collection('points').findOne({ _id: '2_camp_wb' });
        assert.deepEqual(p2.waybackImages, []); // sem cobertura ≠ falha
        assert.ok(p2.waybackSyncedAt instanceof Date);

        const status = await db.collection('waybackSync').findOne({ _id: 'camp_wb' });
        assert.equal(status.status, 'completed');
    });

    await t.test('é idempotente: segunda execução sem force não reprocessa', async () => {
        const app = buildApp(db, fakeWaybackService());
        const wayback = controllerFactory(app);
        const result = await wayback.runSyncJob('camp_wb', {});
        assert.equal(result.total, 0, 'nenhum ponto pendente');
    });

    await t.test('ponto com erro persistente fica sem waybackSyncedAt e listado em errors', async () => {
        await db.collection('points').insertOne({ _id: '3_camp_wb', campaign: 'camp_wb', lon: 88, lat: 0 });
        const app = buildApp(db, fakeWaybackService());
        const wayback = controllerFactory(app);
        const result = await wayback.runSyncJob('camp_wb', {});
        assert.equal(result.failed.length, 1);
        const p3 = await db.collection('points').findOne({ _id: '3_camp_wb' });
        assert.equal(p3.waybackSyncedAt, undefined);
        assert.equal(p3.waybackImages, undefined, 'nunca grava parcial');
        const status = await db.collection('waybackSync').findOne({ _id: 'camp_wb' });
        assert.equal(status.status, 'completed_with_errors');
        assert.equal(status.errors[0].pointId, '3_camp_wb');
    });

    await t.test('lock: execução simultânea retorna alreadyRunning', async () => {
        await db.collection('waybackSync').updateOne(
            { _id: 'camp_wb' }, { $set: { status: 'running' } });
        const app = buildApp(db, fakeWaybackService());
        const wayback = controllerFactory(app);
        const result = await wayback.runSyncJob('camp_wb', {});
        assert.equal(result.alreadyRunning, true);
        await db.collection('waybackSync').updateOne(
            { _id: 'camp_wb' }, { $set: { status: 'completed' } });
    });

    await t.test('triggerSyncIfWayback ignora campanha de outro tipo', async () => {
        await db.collection('campaign').insertOne({ _id: 'camp_landsat', imageType: 'landsat' });
        await db.collection('points').insertOne({ _id: '1_camp_landsat', campaign: 'camp_landsat', lon: 1, lat: 1 });
        const app = buildApp(db, fakeWaybackService());
        const wayback = controllerFactory(app);
        await wayback.triggerSyncIfWayback('camp_landsat');
        await new Promise(r => setTimeout(r, 100));
        const p = await db.collection('points').findOne({ _id: '1_camp_landsat' });
        assert.equal(p.waybackSyncedAt, undefined);
    });

    await db.close();
});
```

- [ ] **Step 3: Rodar e confirmar falha**

Run: `cd src/server && node --test test/waybackSyncJob.test.js`
Expected: FAIL (`Cannot find module '.../controllers/wayback'`) — ou SKIP se Mongo indisponível (nesse caso, subir o Mongo de teste antes de prosseguir).

- [ ] **Step 4: Implementar `src/server/controllers/wayback.js`**

```js
/**
 * Controller do módulo Esri Wayback.
 *
 * Job de pré-computação: para cada ponto da campanha, consulta o Wayback
 * (dedupe via tilemap + metadados por release) e persiste waybackImages[] no
 * documento do ponto. Idempotente (pula pontos com waybackSyncedAt, salvo
 * force) e retomável; progresso e lock na coleção waybackSync (1 doc por
 * campanha). Nada aqui roda para campanhas de outros imageType.
 */
module.exports = function (app) {

    const Wayback = {};
    const logger = app.services.logger;
    const waybackService = app.services.waybackService;

    const SYNC_CONCURRENCY = 5;
    const MAX_ERRORS_LISTED = 50;

    const cols = function () { return app.repository.collections; };

    function displayDate(img) { return img.captureDate || img.releaseDate; }

    async function mapWithConcurrency(items, limit, fn) {
        const queue = items.slice();
        const workers = [];
        for (let w = 0; w < Math.min(limit, queue.length); w++) {
            workers.push((async function () {
                while (queue.length) {
                    const item = queue.shift();
                    await fn(item);
                }
            })());
        }
        await Promise.all(workers);
    }

    async function syncOnePoint(point) {
        const local = await waybackService.getLocalChanges(point.lon, point.lat);
        const images = [];
        for (const rel of local) {
            const meta = await waybackService.getMetadata(rel, point.lon, point.lat);
            images.push({
                releaseNum: rel.releaseNum,
                releaseDate: rel.releaseDate,
                captureDate: meta.captureDate,
                source: meta.source,
                resolution: meta.resolution
            });
        }
        images.sort(function (a, b) { return displayDate(a).localeCompare(displayDate(b)); });
        // Escrita única e atômica por ponto: nunca persiste estado parcial.
        await cols().points.updateOne(
            { _id: point._id },
            { $set: { waybackImages: images, waybackSyncedAt: new Date() } }
        );
    }

    Wayback.runSyncJob = async function (campaignId, options) {
        const force = !!(options && options.force);
        const syncCol = cols().waybackSync;

        // Lock: só um sync por campanha. No driver 2.x o upsert concorrente
        // com filtro por status lança 11000 — tratado como "já em execução".
        try {
            const lock = await syncCol.findOneAndUpdate(
                { _id: campaignId, status: { $ne: 'running' } },
                { $set: { status: 'running', startedAt: new Date(), finishedAt: null, errors: [] } },
                { upsert: true, returnOriginal: false }
            );
            if (!lock || !lock.value) return { alreadyRunning: true };
        } catch (err) {
            if (err.code === 11000) return { alreadyRunning: true };
            throw err;
        }

        const filter = { campaign: campaignId, archivedAt: { $exists: false } };
        if (!force) filter.waybackSyncedAt = { $exists: false };
        const points = await cols().points.find(filter).toArray();

        let processed = 0;
        let failed = [];

        const processPass = async function (list, collectFailures) {
            await mapWithConcurrency(list, SYNC_CONCURRENCY, async function (point) {
                try {
                    await syncOnePoint(point);
                    processed++;
                } catch (err) {
                    collectFailures.push({ pointId: point._id, error: err.message });
                }
                await syncCol.updateOne({ _id: campaignId }, {
                    $set: { total: points.length, processed: processed, errors: failed.slice(0, MAX_ERRORS_LISTED) }
                });
            });
        };

        await processPass(points, failed);

        // Uma passada de retry sobre as falhas (transientes de rede).
        if (failed.length) {
            const retryIds = failed.map(function (f) { return f.pointId; });
            const retryPoints = points.filter(function (p) { return retryIds.indexOf(p._id) !== -1; });
            failed = [];
            await processPass(retryPoints, failed);
        }

        await syncCol.updateOne({ _id: campaignId }, {
            $set: {
                status: failed.length ? 'completed_with_errors' : 'completed',
                finishedAt: new Date(),
                total: points.length, processed: processed,
                errors: failed.slice(0, MAX_ERRORS_LISTED)
            }
        });

        await logger.info('Wayback sync concluído', {
            module: 'wayback', function: 'runSyncJob',
            metadata: { campaignId, total: points.length, processed, failedCount: failed.length }
        });

        return { total: points.length, processed: processed, failed: failed };
    };

    Wayback.triggerSyncIfWayback = async function (campaignId) {
        try {
            const campaign = await cols().campaign.findOne({ _id: campaignId });
            if (!campaign || campaign.imageType !== 'wayback') return;
            Wayback.runSyncJob(campaignId, {}).catch(async function (err) {
                await logger.error('Wayback sync automático falhou', {
                    module: 'wayback', function: 'triggerSyncIfWayback',
                    metadata: { campaignId, error: err.message }
                });
            });
        } catch (err) {
            await logger.error('Wayback triggerSyncIfWayback falhou', {
                module: 'wayback', function: 'triggerSyncIfWayback',
                metadata: { campaignId, error: err.message }
            });
        }
    };

    Wayback.startSync = function (request, response) {
        const campaignId = request.params.campaignId;
        const force = request.query.force === '1' || request.query.force === 'true';
        Wayback.runSyncJob(campaignId, { force: force }).catch(async function (err) {
            await logger.error('Wayback sync manual falhou', {
                module: 'wayback', function: 'startSync',
                metadata: { campaignId, error: err.message }
            });
        });
        response.json({ started: true, campaignId: campaignId, force: force });
    };

    Wayback.status = async function (request, response) {
        const doc = await cols().waybackSync.findOne({ _id: request.params.campaignId });
        if (!doc) return response.status(404).json({ error: 'Nenhum sync registrado para esta campanha.' });
        response.json(doc);
    };

    Wayback.releases = async function (request, response) {
        try {
            const releases = await waybackService.getReleases();
            response.json(releases.map(function (r) {
                return { releaseNum: r.releaseNum, releaseDate: r.releaseDate, itemURL: r.itemURL };
            }));
        } catch (err) {
            const errorCode = await logger.error('Wayback: falha ao obter catálogo de releases', {
                module: 'wayback', function: 'releases', metadata: { error: err.message }
            });
            response.status(502).json({ error: 'Catálogo Wayback indisponível.', errorCode });
        }
    };

    return Wayback;
};
```

- [ ] **Step 5: Rodar os testes e confirmar que passam**

Run: `cd src/server && node --test test/waybackSyncJob.test.js`
Expected: PASS (5 subtestes)

- [ ] **Step 6: Criar `src/server/routes/wayback.js`**

Clonar o middleware super-admin de `routes/campaignCrud.js:14-40` (mesma verificação `req.session.admin.superAdmin`):

```js
module.exports = function (app) {

    const wayback = app.controllers.wayback;
    const logger = app.services.logger;

    // Mesma verificação de sessão super-admin usada em routes/campaignCrud.js.
    const requireSuperAdmin = async (req, res, next) => {
        if (req.session && req.session.admin && req.session.admin.superAdmin) {
            return next();
        }
        const errorCode = await logger.warn('Wayback: acesso negado (super-admin requerido)', {
            module: 'wayback', function: 'requireSuperAdmin',
            metadata: { path: req.path }
        });
        res.status(401).json({ error: 'Super admin authentication required', errorCode });
    };

    app.post('/api/wayback/sync/:campaignId', requireSuperAdmin, wayback.startSync);
    app.get('/api/wayback/sync/:campaignId/status', requireSuperAdmin, wayback.status);

    // Catálogo consumido pelo visualizador (sessão de inspetor comum).
    app.get('/service/wayback/releases', wayback.releases);
};
```

- [ ] **Step 7: Rodar a suíte completa (regressão)**

Run: `cd src/server && npm test`
Expected: PASS

- [ ] **Step 8: Commit (se autorizado)**

```bash
git add src/server/controllers/wayback.js src/server/routes/wayback.js src/server/middleware/repository.js src/server/test/waybackSyncJob.test.js
git commit -m "feat(tvi): adiciona job de pré-computação de imagens Wayback por ponto"
```

---

### Task 3: Ganchos na campanha (create/update, upload de pontos, form admin, proxy)

**Files:**
- Modify: `src/server/controllers/campaign-crud.js:1135` (create), `:1201-1204` (update), `:2109` e `:2448` (pós-upload)
- Modify: `src/client/views/campaign-form-modal.tpl.html:156-160` (select de tipo)
- Modify: `src/server/controllers/proxy.js:41-44` (allowlist)

**Interfaces:**
- Consumes: `app.controllers.wayback.triggerSyncIfWayback(campaignId)` (Task 2).
- Produces: campanhas com `imageType: 'wayback'` sempre têm `useDynamicMaps: true`; sync automático dispara após o upload de GeoJSON.

- [ ] **Step 1: Forçar `useDynamicMaps` no create**

Em `campaign-crud.js:1135`, trocar:

```js
useDynamicMaps: campaignData.useDynamicMaps || false,
```

por:

```js
// Wayback só funciona com tiles dinâmicos — força a flag no tipo wayback.
useDynamicMaps: campaignData.imageType === 'wayback' ? true : (campaignData.useDynamicMaps || false),
```

- [ ] **Step 2: Forçar `useDynamicMaps` no update**

Em `campaign-crud.js`, logo após as coerções numéricas do update (linhas ~1202-1204), adicionar:

```js
// Wayback só funciona com tiles dinâmicos — força a flag no tipo wayback.
if (updateData.imageType === 'wayback') {
    updateData.useDynamicMaps = true;
}
```

- [ ] **Step 3: Disparar o sync após o upload de GeoJSON**

Nos DOIS pontos de conclusão de upload (`campaign-crud.js:2109` e `:2448`), logo após `emitToUser('upload-completed', result);`, adicionar:

```js
// Wayback: dispara a pré-computação de releases por ponto (fire-and-forget;
// não bloqueia a resposta do upload). No-op para campanhas de outros tipos.
if (app.controllers && app.controllers.wayback) {
    app.controllers.wayback.triggerSyncIfWayback(campaignId);
}
```

Confirmar em cada local que a variável em escopo com o id da campanha se chama `campaignId` (é a mesma usada no `emitToUser` adjacente); se o segundo local usar outro nome, usar o nome local.

- [ ] **Step 4: Opção no form admin**

Em `campaign-form-modal.tpl.html`, dentro do `<select ng-model="campaign.imageType">` (linhas 156-159), adicionar após a opção `wms`:

```html
<option value="wayback">Esri Wayback (imagens históricas de alta resolução)</option>
```

- [ ] **Step 5: Allowlist do proxy de screenshot**

Em `proxy.js:41-44`, adicionar o domínio de tiles do Wayback:

```js
var allowedPatterns = [
    /^https?:\/\/tm\d+\.lapig\.iesa\.ufg\.br\//,
    /^https?:\/\/earthengine\.googleapis\.com\//,
    /^https:\/\/wayback\.maptiles\.arcgis\.com\//
];
```

- [ ] **Step 6: Verificação**

Run: `cd src/server && npm test`
Expected: PASS.
Verificação manual adicional: `grep -n "wayback" src/server/controllers/campaign-crud.js` deve mostrar exatamente os 3 ganchos (create, update, 2× upload) e nada mais.

- [ ] **Step 7: Commit (se autorizado)**

```bash
git add src/server/controllers/campaign-crud.js src/server/controllers/proxy.js src/client/views/campaign-form-modal.tpl.html
git commit -m "feat(tvi): habilita criação de campanhas do tipo Esri Wayback"
```

---

### Task 4: Guarda de payload de inspeção Wayback no server

**Files:**
- Create: `src/server/services/waybackInspectionGuard.js`
- Modify: `src/server/controllers/points.js:776` (dentro de `updatePoint`, após a validação de `point._id`)
- Test: `src/server/test/waybackInspectionGuard.test.js`

**Interfaces:**
- Produces: `waybackInspectionGuard.validate(campaign, inspection)` → `{ ok: true }` ou `{ ok: false, error: 'mensagem' }`. Módulo puro (sem `app`), `require`-ável direto como `usernameMatcher`.
- Regra: campanha `wayback` exige TODAS as entradas de `inspection.form` com `releaseNum` (number), `captureDate` (string não vazia) e `landUse` (string não vazia) e form não vazio; campanha não-wayback rejeita QUALQUER entrada com `releaseNum`.

- [ ] **Step 1: Escrever os testes que falham**

Criar `src/server/test/waybackInspectionGuard.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const guard = require(path.join(__dirname, '..', 'services', 'waybackInspectionGuard'));

const wbCampaign = { _id: 'c1', imageType: 'wayback' };
const lsCampaign = { _id: 'c2', imageType: 'landsat' };
const legacyCampaign = { _id: 'c3' }; // campanhas antigas sem imageType

test('aceita payload wayback válido em campanha wayback', () => {
    const r = guard.validate(wbCampaign, { form: [
        { releaseNum: 100, captureDate: '2018-06-06', landUse: 'Pastagem', pixelBorder: false },
        { releaseNum: 200, captureDate: '2022-01-15', landUse: 'Agricultura', pixelBorder: true }
    ] });
    assert.equal(r.ok, true);
});

test('rejeita payload por ano em campanha wayback', () => {
    const r = guard.validate(wbCampaign, { form: [
        { initialYear: 1985, finalYear: 2024, landUse: 'Pastagem' }
    ] });
    assert.equal(r.ok, false);
});

test('rejeita form vazio em campanha wayback', () => {
    assert.equal(guard.validate(wbCampaign, { form: [] }).ok, false);
    assert.equal(guard.validate(wbCampaign, {}).ok, false);
});

test('rejeita entrada wayback incompleta (sem captureDate ou landUse)', () => {
    assert.equal(guard.validate(wbCampaign, { form: [{ releaseNum: 100, landUse: 'Pastagem' }] }).ok, false);
    assert.equal(guard.validate(wbCampaign, { form: [{ releaseNum: 100, captureDate: '2018-06-06', landUse: '' }] }).ok, false);
});

test('rejeita payload wayback em campanha não-wayback', () => {
    const r = guard.validate(lsCampaign, { form: [
        { releaseNum: 100, captureDate: '2018-06-06', landUse: 'Pastagem' }
    ] });
    assert.equal(r.ok, false);
});

test('não interfere no payload por ano em campanha não-wayback (inclusive legada)', () => {
    const yearForm = { form: [{ initialYear: 1985, finalYear: 2024, landUse: 'Pastagem' }] };
    assert.equal(guard.validate(lsCampaign, yearForm).ok, true);
    assert.equal(guard.validate(legacyCampaign, yearForm).ok, true);
    // Também não valida conteúdo do payload por ano (fora do escopo do guard):
    assert.equal(guard.validate(lsCampaign, { form: [] }).ok, true);
    assert.equal(guard.validate(legacyCampaign, {}).ok, true);
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `cd src/server && node --test test/waybackInspectionGuard.test.js`
Expected: FAIL (`Cannot find module`)

- [ ] **Step 3: Implementar `src/server/services/waybackInspectionGuard.js`**

```js
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
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `cd src/server && node --test test/waybackInspectionGuard.test.js`
Expected: PASS (6 testes)

- [ ] **Step 5: Integrar em `updatePoint`**

Em `points.js`, logo após o bloco `if (!point || !point._id) {...}` (termina na linha ~776) e ANTES de `point.inspection.fillDate = new Date();`, adicionar:

```js
// Wayback (2026-08): impede o cruzamento de formatos de inspeção —
// campanha wayback exige payload por release; as demais o rejeitam.
const waybackGuard = require('../services/waybackInspectionGuard');
const guardResult = waybackGuard.validate(user.campaign, point.inspection);
if (!guardResult.ok) {
    const errorCode = await logger.warn('Inspeção rejeitada pelo waybackInspectionGuard', {
        module: 'points', function: 'updatePoint',
        metadata: { pointId: point._id, username: user.name, reason: guardResult.error }
    });
    return response.status(400).json({ error: guardResult.error, errorCode });
}
```

(Colocar o `require` no topo do arquivo, junto aos demais `require`, e usar apenas a chamada aqui.)

- [ ] **Step 6: Regressão completa**

Run: `cd src/server && npm test`
Expected: PASS — em particular `blockRoundSemantics.test.js` intacto (payload por ano de campanhas sem `imageType` continua aceito).

- [ ] **Step 7: Commit (se autorizado)**

```bash
git add src/server/services/waybackInspectionGuard.js src/server/test/waybackInspectionGuard.test.js src/server/controllers/points.js
git commit -m "feat(tvi): valida formato de inspeção por release em campanhas Wayback"
```

---

### Task 5: Núcleo puro da grade Wayback (client, testável em Node)

**Files:**
- Create: `src/client/services/wayback-grid-core.js`
- Test: `src/server/test/waybackGridCore.test.js`

**Interfaces:**
- Produces (usado pelas Tarefas 7 e 8): objeto `WaybackGridCore` (UMD: `window.WaybackGridCore` no browser, `module.exports` em Node) com:
  - `displayDate(img)` → `captureDate || releaseDate`
  - `leafletUrl(itemURL)` → template `{level}/{row}/{col}` convertido para `{z}/{y}/{x}`
  - `buildGrid(point, config, releasesIndex)` → `[{ date, approximateDate, year, releaseNum, url, bounds, index }]` ordenado por data crescente, filtrado por `initialYear`/`finalYear`; `releasesIndex` é `{ [releaseNum]: { itemURL } }`
  - `buildInitialAnswers(grid, defaultLandUse)` → `[{ initialDate, finalDate, landUse, pixelBorder }]` (uma caixa cobrindo toda a série) ou `[]` para grade vazia
  - `optionDates(grid, fromDate)` → array de datas `>= fromDate` (para os selects do form)
  - `expandAnswersToForm(answers, grid)` → `[{ releaseNum, captureDate, landUse, pixelBorder }]`, uma entrada por célula da grade (formato exigido pelo guard da Task 4)

- [ ] **Step 1: Escrever os testes que falham**

Criar `src/server/test/waybackGridCore.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const core = require(path.join(__dirname, '..', '..', 'client', 'services', 'wayback-grid-core'));

const RELEASES_INDEX = {
    100: { itemURL: 'https://w/tile/100/{level}/{row}/{col}' },
    200: { itemURL: 'https://w/tile/200/{level}/{row}/{col}' },
    300: { itemURL: 'https://w/tile/300/{level}/{row}/{col}' }
};

const POINT = {
    bounds: [[1, 2], [3, 4]],
    waybackImages: [
        { releaseNum: 200, releaseDate: '2022-03-02', captureDate: '2022-01-15' },
        { releaseNum: 100, releaseDate: '2018-06-06', captureDate: null },
        { releaseNum: 300, releaseDate: '2024-01-11', captureDate: '2023-12-01' }
    ]
};

test('buildGrid: ordena por data de exibição, marca datas aproximadas e monta URL Leaflet', () => {
    const grid = core.buildGrid(POINT, {}, RELEASES_INDEX);
    assert.deepEqual(grid.map(g => g.releaseNum), [100, 200, 300]);
    assert.deepEqual(grid.map(g => g.date), ['2018-06-06', '2022-01-15', '2023-12-01']);
    assert.deepEqual(grid.map(g => g.approximateDate), [true, false, false]);
    assert.deepEqual(grid.map(g => g.year), [2018, 2022, 2023]);
    assert.deepEqual(grid.map(g => g.index), [0, 1, 2]);
    assert.equal(grid[0].url, 'https://w/tile/100/{z}/{y}/{x}');
    assert.deepEqual(grid[0].bounds, POINT.bounds);
});

test('buildGrid: filtra por initialYear/finalYear da campanha', () => {
    const grid = core.buildGrid(POINT, { initialYear: 2020, finalYear: 2022 }, RELEASES_INDEX);
    assert.deepEqual(grid.map(g => g.releaseNum), [200]);
    assert.deepEqual(grid.map(g => g.index), [0], 'índices recomputados após filtro');
});

test('buildGrid: grade vazia para ponto sem waybackImages', () => {
    assert.deepEqual(core.buildGrid({}, {}, RELEASES_INDEX), []);
    assert.deepEqual(core.buildGrid({ waybackImages: [] }, {}, RELEASES_INDEX), []);
});

test('buildInitialAnswers: uma caixa cobrindo toda a série, com classe padrão', () => {
    const grid = core.buildGrid(POINT, {}, RELEASES_INDEX);
    assert.deepEqual(core.buildInitialAnswers(grid, 'Pastagem'), [{
        initialDate: '2018-06-06', finalDate: '2023-12-01', landUse: 'Pastagem', pixelBorder: false
    }]);
    assert.deepEqual(core.buildInitialAnswers([], 'Pastagem'), []);
});

test('optionDates: datas a partir de um limite', () => {
    const grid = core.buildGrid(POINT, {}, RELEASES_INDEX);
    assert.deepEqual(core.optionDates(grid, '2018-06-06'),
        ['2018-06-06', '2022-01-15', '2023-12-01']);
    assert.deepEqual(core.optionDates(grid, '2022-01-16'), ['2023-12-01']);
});

test('expandAnswersToForm: expande intervalos consolidados em uma entrada por release', () => {
    const grid = core.buildGrid(POINT, {}, RELEASES_INDEX);
    const answers = [
        { initialDate: '2018-06-06', finalDate: '2022-01-15', landUse: 'Vegetação Nativa', pixelBorder: false },
        { initialDate: '2023-12-01', finalDate: '2023-12-01', landUse: 'Pastagem', pixelBorder: true }
    ];
    assert.deepEqual(core.expandAnswersToForm(answers, grid), [
        { releaseNum: 100, captureDate: '2018-06-06', landUse: 'Vegetação Nativa', pixelBorder: false },
        { releaseNum: 200, captureDate: '2022-01-15', landUse: 'Vegetação Nativa', pixelBorder: false },
        { releaseNum: 300, captureDate: '2023-12-01', landUse: 'Pastagem', pixelBorder: true }
    ]);
});

test('expandAnswersToForm: célula fora de qualquer intervalo sai com landUse null (barrado pelo guard/form)', () => {
    const grid = core.buildGrid(POINT, {}, RELEASES_INDEX);
    const answers = [{ initialDate: '2018-06-06', finalDate: '2018-06-06', landUse: 'Pastagem', pixelBorder: false }];
    const form = core.expandAnswersToForm(answers, grid);
    assert.equal(form[1].landUse, null);
    assert.equal(form[2].landUse, null);
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `cd src/server && node --test test/waybackGridCore.test.js`
Expected: FAIL (`Cannot find module '.../client/services/wayback-grid-core'`)

- [ ] **Step 3: Implementar `src/client/services/wayback-grid-core.js`**

```js
/**
 * WaybackGridCore — núcleo puro da grade Wayback (sem Angular/Leaflet).
 *
 * UMD mínimo: no browser registra window.WaybackGridCore (consumido por
 * waybackGridService e pelos controllers); em Node exporta via module.exports
 * (consumido pelos testes em src/server/test/waybackGridCore.test.js).
 * ES5 por compatibilidade com o restante do client (AngularJS 1.5.8).
 */
(function (global) {
    'use strict';

    var WaybackGridCore = {

        displayDate: function (img) {
            return img.captureDate || img.releaseDate;
        },

        leafletUrl: function (itemURL) {
            return String(itemURL)
                .replace('{level}', '{z}')
                .replace('{row}', '{y}')
                .replace('{col}', '{x}');
        },

        buildGrid: function (point, config, releasesIndex) {
            var images = (point && point.waybackImages) || [];
            var initialYear = config && config.initialYear;
            var finalYear = config && config.finalYear;
            var sorted = images.slice().sort(function (a, b) {
                return WaybackGridCore.displayDate(a).localeCompare(WaybackGridCore.displayDate(b));
            });
            var grid = [];
            sorted.forEach(function (img) {
                var date = WaybackGridCore.displayDate(img);
                var year = parseInt(date.slice(0, 4), 10);
                if (initialYear && year < initialYear) return;
                if (finalYear && year > finalYear) return;
                var release = releasesIndex && releasesIndex[img.releaseNum];
                grid.push({
                    date: date,
                    approximateDate: !img.captureDate,
                    year: year,
                    releaseNum: img.releaseNum,
                    url: release ? WaybackGridCore.leafletUrl(release.itemURL) : null,
                    bounds: point.bounds,
                    index: grid.length
                });
            });
            return grid;
        },

        buildInitialAnswers: function (grid, defaultLandUse) {
            if (!grid || !grid.length) return [];
            return [{
                initialDate: grid[0].date,
                finalDate: grid[grid.length - 1].date,
                landUse: defaultLandUse || '',
                pixelBorder: false
            }];
        },

        optionDates: function (grid, fromDate) {
            return (grid || [])
                .map(function (g) { return g.date; })
                .filter(function (d) { return !fromDate || d >= fromDate; });
        },

        expandAnswersToForm: function (answers, grid) {
            return (grid || []).map(function (g) {
                var match = null;
                for (var i = 0; i < (answers || []).length; i++) {
                    if (g.date >= answers[i].initialDate && g.date <= answers[i].finalDate) {
                        match = answers[i];
                        break;
                    }
                }
                return {
                    releaseNum: g.releaseNum,
                    captureDate: g.date,
                    landUse: match ? (match.landUse || null) : null,
                    pixelBorder: match ? !!match.pixelBorder : false
                };
            });
        }
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = WaybackGridCore;
    }
    if (global) {
        global.WaybackGridCore = WaybackGridCore;
    }
})(typeof window !== 'undefined' ? window : null);
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `cd src/server && node --test test/waybackGridCore.test.js`
Expected: PASS (7 testes)

- [ ] **Step 5: Regressão completa**

Run: `cd src/server && npm test`
Expected: PASS

- [ ] **Step 6: Commit (se autorizado)**

```bash
git add src/client/services/wayback-grid-core.js src/server/test/waybackGridCore.test.js
git commit -m "feat(tvi): adiciona núcleo de montagem da grade de datas Wayback"
```

---

### Task 6: Diretiva `<wayback-map>` e serviço Angular `waybackGridService`

**Files:**
- Create: `src/client/directives/waybackMap.js`
- Create: `src/client/services/waybackGridService.js`
- Modify: `src/client/index.html` (registro dos 3 scripts novos)

**Interfaces:**
- Consumes: `window.WaybackGridCore` (Task 5), `GET /service/wayback/releases` (Task 2), `requester` e `mapSyncService` (já existentes em `others/services.js`/`others/directives.js`).
- Produces (usado pelas Tarefas 7 e 8):
  - Diretiva `<wayback-map lon lat zoom tile-url map-date>` — mapa Leaflet de uma célula.
  - Serviço `waybackGridService`:
    - `getReleasesIndex()` → `Promise<{ [releaseNum]: { releaseNum, releaseDate, itemURL } }>` (cache em memória + dedupe de promise, padrão `capabilitiesService`)
    - `core` → referência a `WaybackGridCore` (buildGrid, buildInitialAnswers, optionDates, expandAnswersToForm)

- [ ] **Step 1: Implementar `src/client/services/waybackGridService.js`**

```js
/**
 * waybackGridService — obtém o catálogo de releases do backend (com cache em
 * memória e dedupe de promise, mesmo padrão do capabilitiesService) e expõe o
 * núcleo puro WaybackGridCore para os controllers temporal/supervisor.
 */
angular.module('application').factory('waybackGridService', function ($q, requester) {
    'use strict';

    var releasesIndexCache = null;
    var releasesPromise = null;

    function getReleasesIndex() {
        if (releasesIndexCache) {
            return $q.resolve(releasesIndexCache);
        }
        if (releasesPromise) {
            return releasesPromise;
        }
        var deferred = $q.defer();
        requester._get('wayback/releases', function (data) {
            var index = {};
            (data || []).forEach(function (r) {
                index[r.releaseNum] = r;
            });
            releasesIndexCache = index;
            releasesPromise = null;
            deferred.resolve(index);
        });
        releasesPromise = deferred.promise;
        return releasesPromise;
    }

    return {
        getReleasesIndex: getReleasesIndex,
        core: window.WaybackGridCore
    };
});
```

- [ ] **Step 2: Implementar `src/client/directives/waybackMap.js`**

Estrutura clonada de `landsatMap` (`others/directives.js:801`), sem visparam/period; a URL já chega resolvida por célula:

```js
/**
 * <wayback-map> — célula da grade para campanhas Esri Wayback.
 *
 * Recebe a URL de tiles XYZ já resolvida para a release da célula (montada
 * por WaybackGridCore.leafletUrl a partir do itemURL do catálogo). Sem
 * visparam nem período — conceitos que não existem no Wayback. Em erro de
 * tile (release removida/renumerada pela Esri), exibe aviso na célula sem
 * quebrar a grade.
 */
angular.module('application').directive('waybackMap', function ($timeout, mapSyncService) {
    'use strict';
    return {
        template: '<div style="width: 100%; height: 100%; position: relative;">' +
                  '  <div id="wayback-map-{{::$id}}" style="width: 100%; height: 100%;"></div>' +
                  '  <div ng-show="tileError" class="alert alert-warning" ' +
                  '       style="position: absolute; top: 4px; left: 4px; right: 4px; z-index: 1000; padding: 4px 8px; font-size: 11px;">' +
                  "       {{ 'TEMPORAL.MAP.WAYBACK_TILE_ERROR' | i18n }}" +
                  '  </div>' +
                  '</div>',
        scope: {
            lon: '=',
            lat: '=',
            zoom: '=',
            tileUrl: '=',
            mapDate: '='
        },
        controller: function ($scope, $element) {
            $scope._destroyed = false;
            $scope.tileError = false;
            $scope.markerInMap = true;

            $timeout(function () {
                var mapElement = $element[0].querySelector('#wayback-map-' + $scope.$id);
                if (!mapElement || $scope._destroyed) return;

                $scope.map = L.map(mapElement, {
                    center: [$scope.lat, $scope.lon],
                    zoom: $scope.zoom,
                    minZoom: $scope.zoom,
                    maxZoom: $scope.zoom + 6,
                    zoomControl: true,
                    dragging: true,
                    doubleClickZoom: true,
                    scrollWheelZoom: true
                });

                mapSyncService.register($scope.map);

                if ($scope.tileUrl) {
                    $scope.tileLayer = L.tileLayer($scope.tileUrl, {
                        attribution: 'Esri Wayback — ' + ($scope.mapDate || ''),
                        maxZoom: $scope.zoom + 6
                    });
                    $scope.tileLayer.on('tileerror', function () {
                        $timeout(function () { $scope.tileError = true; });
                    });
                    $scope.tileLayer.addTo($scope.map);
                } else {
                    $scope.tileError = true;
                }

                $scope.marker = L.marker([$scope.lat, $scope.lon], {
                    icon: L.icon({
                        iconUrl: 'assets/marker2.png',
                        iconSize: [42, 42]
                    }),
                    zIndexOffset: 1000
                }).addTo($scope.map);
            });

            $scope.$on('$destroy', function () {
                $scope._destroyed = true;
                if ($scope.map) {
                    if ($scope.tileLayer) {
                        $scope.tileLayer.off();
                        $scope.map.removeLayer($scope.tileLayer);
                    }
                    mapSyncService.unregister($scope.map);
                    $scope.map.remove();
                    $scope.map = null;
                }
            });
        }
    };
});
```

Antes de finalizar, conferir em `others/directives.js` como o `landsatMap` faz o cleanup no `$destroy` (procurar `mapSyncService.unregister` e o handler `$scope.$on('$destroy')` no corpo da diretiva) e replicar exatamente o mesmo contrato (se o método se chamar diferente de `unregister`, usar o nome real).

- [ ] **Step 3: Registrar os scripts em `index.html`**

Após a linha 84 (`<script src="services/diagnostic-capture.js"></script>`), adicionar:

```html
<script src="services/wayback-grid-core.js"></script>
<script src="services/waybackGridService.js"></script>
```

Após a linha 93 (`<script src="directives/campaignPointsMap.js"></script>`), adicionar:

```html
<script src="directives/waybackMap.js"></script>
```

- [ ] **Step 4: Verificação de sintaxe**

Run: `node --check src/client/services/waybackGridService.js && node --check src/client/directives/waybackMap.js && node --check src/client/services/wayback-grid-core.js`
Expected: sem saída (sintaxe válida). A verificação funcional visual acontece na Task 9.

- [ ] **Step 5: Commit (se autorizado)**

```bash
git add src/client/services/waybackGridService.js src/client/directives/waybackMap.js src/client/index.html
git commit -m "feat(tvi): adiciona diretiva de mapa e serviço Angular do módulo Wayback"
```

---

### Task 7: Integração no visualizador do inspetor (`/temporal`)

**Files:**
- Modify: `src/client/controllers/temporal.js` (pontos exatos abaixo)
- Modify: `src/client/views/temporal.tpl.html` (form ~linha 192-263; grade ~linha 296-353)
- Modify: `src/client/i18n/pt-BR.json`, `src/client/i18n/en.json`, `src/client/i18n/id.json`

**Interfaces:**
- Consumes: `waybackGridService` (Task 6), `WaybackGridCore` via `waybackGridService.core` (Task 5), payload validado pelo guard (Task 4).
- Produces: fluxo completo de inspeção Wayback no `/temporal`. Pontos de contato com código existente (TODOS eles): (a) *early-return* em `generateMaps()`; (b) flag `isWayback` em `loadCampaignConfig`; (c) ramo em `buildFormPoint()`; (d) ramo em `initFormViewVariables()`; (e) guardas `ng-if`/`ng-hide` no template; (f) injeção de `waybackGridService` na assinatura do controller.

- [ ] **Step 1: Injetar o serviço e criar a flag**

Na assinatura do controller `temporal.js` (função com `$scope, $rootScope, ...`), adicionar `waybackGridService` ao final da lista de injeções.

Em `loadCampaignConfig` (temporal.js:853-959), dentro do bloco `if (config.imageType) {` (linha ~882), adicionar:

```js
$scope.isWayback = config.imageType === 'wayback';
```

E inicializar no topo do controller (junto às demais inicializações de flags, perto de `$scope.useDynamicMaps` na linha ~25):

```js
$scope.isWayback = false;
$scope.waybackGridLoading = false;
```

- [ ] **Step 2: Early-return em `generateMaps()` + geração da grade Wayback**

Em `temporal.js:752`, primeira linha do corpo de `generateMaps`:

```js
const generateMaps = function () {
    if ($scope.isWayback) {
        generateWaybackMaps();
        return;
    }
    $scope.maps = [];
    // ... (restante inalterado)
```

Adicionar, imediatamente antes de `generateMaps`, a função nova:

```js
// Grade Wayback: substitui o laço fixo por ano pela série de releases
// pré-computada no ponto (point.waybackImages, gravado pelo sync job).
const generateWaybackMaps = function () {
    $scope.maps = [];
    $scope.waybackGridLoading = true;
    waybackGridService.getReleasesIndex().then(function (releasesIndex) {
        $scope.maps = waybackGridService.core.buildGrid($scope.point, $scope.config, releasesIndex);
        $scope.answers = waybackGridService.core.buildInitialAnswers(
            $scope.maps, ($scope.config && $scope.config.defaultLandUse) || '');
        $scope.waybackOptionDates = [waybackGridService.core.optionDates($scope.maps, null)];
        $scope.waybackGridLoading = false;
    });
};
```

- [ ] **Step 3: Ramo Wayback no form (answers por data)**

Em `initFormViewVariables` (temporal.js:832-851), adicionar no início:

```js
const initFormViewVariables = function () {
    if ($scope.isWayback) {
        // Wayback: answers é montado por generateWaybackMaps (depende da
        // grade, que é assíncrona). Aqui apenas zera o estado.
        $scope.answers = [];
        $scope.waybackOptionDates = [];
        return;
    }
    $scope.optionYears = [];
    // ... (restante inalterado)
```

Adicionar as funções novas (após `formSubtraction`, linha ~278):

```js
// Consolidação por data (equivalente Wayback de formPlus/formSubtraction):
// ajustar a data final da caixa corrente cria a caixa seguinte cobrindo o
// restante da série.
$scope.waybackFormPlus = function () {
    var prevIndex = $scope.answers.length - 1;
    var prev = $scope.answers[prevIndex];
    var lastDate = $scope.maps.length ? $scope.maps[$scope.maps.length - 1].date : null;
    if (!lastDate || prev.finalDate === lastDate) return;

    var nextDates = waybackGridService.core.optionDates($scope.maps, prev.finalDate)
        .filter(function (d) { return d > prev.finalDate; });
    if (!nextDates.length) return;

    $scope.waybackOptionDates.push(nextDates);
    var defaultLU = ($scope.config && $scope.config.defaultLandUse) || '';
    $scope.answers.push({
        initialDate: nextDates[0],
        finalDate: lastDate,
        landUse: defaultLU || ($scope.config.landUse && $scope.config.landUse[0]) || '',
        pixelBorder: false
    });
};

$scope.waybackFormSubtraction = function () {
    if ($scope.answers.length > 1) {
        $scope.answers.splice(-1, 1);
        $scope.waybackOptionDates.splice(-1, 1);
        var last = $scope.answers[$scope.answers.length - 1];
        last.finalDate = $scope.maps[$scope.maps.length - 1].date;
    }
};
```

- [ ] **Step 4: Ramo Wayback em `buildFormPoint()`**

Em `buildFormPoint` (temporal.js:322-336), adicionar no início:

```js
function buildFormPoint() {
    if ($scope.isWayback) {
        var entries = waybackGridService.core.expandAnswersToForm($scope.answers, $scope.maps);
        for (var w = 0; w < entries.length; w++) {
            if (!entries[w].landUse) {
                NotificationDialog.error(i18nService.translate('TEMPORAL.FORM.VALIDATION_ERROR'));
                return null;
            }
        }
        if (!entries.length) return null;
        return {
            _id: $scope.point._id,
            inspection: { counter: $scope.counter, form: entries }
        };
    }
    // ... (restante inalterado)
```

- [ ] **Step 5: Template — grade, aviso de ponto sem imagem e guardas**

Em `temporal.tpl.html`:

1. Guardas nas diretivas existentes (linhas 314, 324, 334): acrescentar `&& !isWayback` a cada `ng-if`. Exemplo (linha 314):

```html
<landsat-map ng-if="useDynamicMaps === true && !isSentinel && !useWmsForCurrentPeriod && !isWayback"
```

(mesma alteração em `sentinel-map` e `wms-map`).

2. Célula Wayback — dentro do mesmo `div` da grade (após o bloco `wms-map`, linha ~341):

```html
<!-- Célula Wayback: URL de tiles já resolvida por release -->
<wayback-map ng-if="useDynamicMaps === true && isWayback"
             lon="point.lon"
             lat="point.lat"
             zoom="config.zoomLevel"
             tile-url="map.url"
             map-date="map.date">
</wayback-map>
<div ng-if="isWayback && map.approximateDate" class="text-muted" style="font-size: 10px; text-align: center;">
    {{ 'TEMPORAL.MAP.WAYBACK_APPROXIMATE_DATE' | i18n }}
</div>
```

3. Aviso de ponto sem imagens — imediatamente antes de `<div class="maps-grid">` (linha 296):

```html
<div ng-if="isWayback && pointLoaded && !waybackGridLoading && maps.length === 0"
     class="alert alert-warning" style="margin: 10px;">
    {{ 'TEMPORAL.MAP.WAYBACK_NO_IMAGES' | i18n }}
</div>
```

4. Cabeçalho: na linha 269, trocar `ng-hide="isSentinel"` por `ng-hide="isSentinel || isWayback"` e adicionar após o bloco Sentinel (linha ~283):

```html
<span ng-show="isWayback" class="pull-left" style="font-weight: bold; font-size: 18px; margin:5px 5px 5px 5px;">
    {{ 'TEMPORAL.MAP.WAYBACK_IMAGES' | i18n }}
</span>
```

5. Seletor de período DRY/WET: localizar o controle de período no template (buscar `changePeriod`) e acrescentar `!isWayback` à sua condição de exibição (`ng-show`/`ng-if` existente, com `&& !isWayback`).

- [ ] **Step 6: Template — formulário por data**

Envolver o form atual e adicionar o ramo Wayback. Na linha 192, trocar:

```html
<form class="form-temporal" ng-repeat="answer in answers">
```

por:

```html
<form class="form-temporal" ng-if="!isWayback" ng-repeat="answer in answers">
```

Adicionar após o `</form>` (linha 229) o bloco Wayback:

```html
<!-- Formulário Wayback: consolidação por data de captura -->
<form class="form-temporal" ng-if="isWayback" ng-repeat="answer in answers">
    <div class="form-row-dates">
        <div class="form-group-inline">
            <label class="form-label">{{ 'COMMON.BETWEEN' | i18n }}</label>
            <select ng-disabled="answers.length >= ($index + 1)"
                    class="form-control form-year-select"
                    ng-model="answer.initialDate"
                    ng-options="x for x in waybackOptionDates[$index]">
            </select>
        </div>
        <div class="form-group-inline">
            <label class="form-label">{{ 'COMMON.AND' | i18n }}</label>
            <select ng-disabled="answers.length != ($index + 1)"
                    class="form-control form-year-select"
                    ng-model="answer.finalDate"
                    ng-change="waybackFormPlus()"
                    ng-options="y for y in waybackOptionDates[$index]">
            </select>
        </div>
    </div>
    <div class="form-row">
        <div class="form-group-inline">
            <label class="form-label">{{ 'TEMPORAL.FORM.CLASS' | i18n }}:</label>
            <select class="form-control form-landuse-select" ng-model="answer.landUse">
                <option value="" disabled selected>{{ 'COMMON.CHOOSE' | i18n }}</option>
                <option ng-repeat="z in config.landUse" value="{{z}}">{{z}}</option>
            </select>
        </div>
        <div class="form-group-inline">
            <label class="form-label checkbox-label">
                <input type="checkbox" ng-model="answer.pixelBorder">
                {{ 'TEMPORAL.FORM.BORDER_PIXEL' | i18n }}
            </label>
        </div>
    </div>
</form>
```

Nos botões de ação (linhas 230-262): as condições `ng-disabled` referenciam `answers[answers.length - 1].finalYear != config.finalYear`. Trocar as duas ocorrências por expressão compatível com ambos os modos:

```html
ng-disabled="(isWayback ? (answers.length === 0 || answers[answers.length - 1].finalDate !== maps[maps.length - 1].date) : answers[answers.length - 1].finalYear != config.finalYear) || onSubmission || alreadyInspected"
```

E no botão `-` (linha 258-261), trocar `ng-click="formSubtraction()"` por:

```html
ng-click="isWayback ? waybackFormSubtraction() : formSubtraction()"
```

- [ ] **Step 7: Chaves i18n**

Adicionar em `TEMPORAL.MAP` dos 3 arquivos (`pt-BR.json`, `en.json`, `id.json`):

| Chave | pt-BR | en | id |
|---|---|---|---|
| `WAYBACK_IMAGES` | `"Imagens Esri Wayback"` | `"Esri Wayback Imagery"` | `"Citra Esri Wayback"` |
| `WAYBACK_NO_IMAGES` | `"Este ponto ainda não possui imagens Wayback processadas. A inspeção está bloqueada até a sincronização ser concluída."` | `"This point has no processed Wayback imagery yet. Inspection is blocked until synchronization completes."` | `"Titik ini belum memiliki citra Wayback yang diproses. Inspeksi diblokir sampai sinkronisasi selesai."` |
| `WAYBACK_TILE_ERROR` | `"Imagem indisponível nesta release."` | `"Imagery unavailable for this release."` | `"Citra tidak tersedia untuk rilis ini."` |
| `WAYBACK_APPROXIMATE_DATE` | `"Data aproximada (data da release)"` | `"Approximate date (release date)"` | `"Tanggal perkiraan (tanggal rilis)"` |

- [ ] **Step 8: Verificação**

Run: `cd src/server && npm test`
Expected: PASS — em particular `i18nParity.test.js` (paridade das 4 chaves novas nas 3 línguas).

Run: `node --check src/client/controllers/temporal.js`
Expected: sem saída.

- [ ] **Step 9: Commit (se autorizado)**

```bash
git add src/client/controllers/temporal.js src/client/views/temporal.tpl.html src/client/i18n/pt-BR.json src/client/i18n/en.json src/client/i18n/id.json
git commit -m "feat(tvi): integra grade e formulário Wayback no visualizador do inspetor"
```

---

### Task 8: Integração na tela do supervisor

**Files:**
- Modify: `src/client/controllers/supervisor.js` (mesmos pontos da Task 7: `generateMaps` linha ~715, `loadCampaignConfig`, `buildFormPoint`/answers linha ~330-365 e ~802, injeção do serviço)
- Modify: `src/client/views/supervisor.tpl.html` (grade linha ~293-341; form e botões — mesma estrutura do temporal)

**Interfaces:**
- Consumes: idênticos à Task 7 (`waybackGridService`, chaves i18n já criadas).
- Produces: supervisor vê a mesma grade Wayback e as inspeções por data.

- [ ] **Step 1: Replicar as alterações de controller**

Aplicar em `supervisor.js` exatamente as mesmas alterações da Task 7, adaptando os números de linha (o código é quase idêntico ao `temporal.js`):

1. Injetar `waybackGridService` na assinatura do controller.
2. Inicializar `$scope.isWayback = false; $scope.waybackGridLoading = false;` junto às flags do topo.
3. Em `loadCampaignConfig` do supervisor (buscar `config.imageType`), adicionar `$scope.isWayback = config.imageType === 'wayback';`.
4. Early-return em `generateMaps` (linha ~715-716) com a mesma função `generateWaybackMaps` da Task 7, copiada integralmente:

```js
var generateMaps = function () {
    if ($scope.isWayback) {
        generateWaybackMaps();
        return;
    }
    $scope.maps = [];
    // ... (restante inalterado)
```

```js
var generateWaybackMaps = function () {
    $scope.maps = [];
    $scope.waybackGridLoading = true;
    waybackGridService.getReleasesIndex().then(function (releasesIndex) {
        $scope.maps = waybackGridService.core.buildGrid($scope.point, $scope.config, releasesIndex);
        $scope.answers = waybackGridService.core.buildInitialAnswers(
            $scope.maps, ($scope.config && $scope.config.defaultLandUse) || '');
        $scope.waybackOptionDates = [waybackGridService.core.optionDates($scope.maps, null)];
        $scope.waybackGridLoading = false;
    });
};
```

5. Ramo Wayback no `buildFormPoint`/equivalente do supervisor (buscar `form: $scope.answers` na linha ~363) e no `initFormViewVariables` equivalente (linha ~802), com o mesmo código da Task 7.
6. Adicionar `$scope.waybackFormPlus` e `$scope.waybackFormSubtraction` (mesmo código da Task 7, copiado integralmente — o supervisor tem `formPlus` próprio na linha ~332).

- [ ] **Step 2: Replicar as alterações de template**

Aplicar em `supervisor.tpl.html` as mesmas alterações de template da Task 7 (guardas `&& !isWayback` nos `ng-if` de `landsat-map`/`sentinel-map`/`wms-map` nas linhas ~310-337; célula `<wayback-map>`; aviso `WAYBACK_NO_IMAGES`; cabeçalho `WAYBACK_IMAGES`; ocultação do seletor de período; form por data e botões). Atenção: `supervisor.tpl.html:340` ainda usa `inspection-map` ativo para `useDynamicMaps !== true` — não tocar nesse bloco (campanhas Wayback sempre têm `useDynamicMaps: true` pela Task 3).

- [ ] **Step 3: Verificação**

Run: `node --check src/client/controllers/supervisor.js && cd src/server && npm test`
Expected: sem saída no check; suíte PASS.

- [ ] **Step 4: Commit (se autorizado)**

```bash
git add src/client/controllers/supervisor.js src/client/views/supervisor.tpl.html
git commit -m "feat(tvi): integra grade e formulário Wayback na tela do supervisor"
```

---

### Task 9: Verificação de ponta a ponta e validação contra o serviço real

**Files:**
- Create: `simulate/wayback-smoke.js` (script descartável de validação do contrato real)

**Interfaces:**
- Consumes: tudo das tarefas anteriores.

- [ ] **Step 1: Smoke test do contrato real da Esri**

Criar `simulate/wayback-smoke.js`:

```js
/**
 * Smoke test do contrato real do Esri Wayback (rodar manualmente, com rede).
 * Valida: catálogo acessível, dedupe por tilemap e metadados num ponto do
 * Brasil (Goiânia). Uso: node simulate/wayback-smoke.js
 */
'use strict';

const { createWaybackService } = require('../src/server/services/waybackService');

const logger = {
    info: async (...a) => console.log('[info]', ...a),
    warn: async (...a) => console.warn('[warn]', ...a),
    error: async (...a) => console.error('[error]', ...a)
};

(async function main() {
    const svc = createWaybackService({ logger });

    const releases = await svc.getReleases();
    console.log('releases no catálogo:', releases.length);
    console.log('mais recente:', releases[0]);
    if (!releases.length || !releases[0].releaseDate) throw new Error('catálogo inválido');

    const lon = -49.25, lat = -16.68; // Goiânia
    const changes = await svc.getLocalChanges(lon, lat);
    console.log('releases com imagem distinta no ponto:', changes.length);
    console.log(changes.map(r => r.releaseDate).join(', '));
    if (!changes.length) throw new Error('dedupe retornou vazio para área urbana — verificar contrato tilemap');

    const meta = await svc.getMetadata(changes[0], lon, lat);
    console.log('metadados da release mais recente:', meta);

    console.log('\nSMOKE OK');
})().catch(err => { console.error('SMOKE FALHOU:', err.message); process.exit(1); });
```

Run: `cd src/server && node ../../simulate/wayback-smoke.js` (rodar da pasta `src/server` para resolver o axios de `src/server/node_modules`).
Expected: `SMOKE OK`, com dezenas de releases no catálogo e 10-40 releases com imagem distinta no ponto. **Se falhar**: o contrato assumido diverge do real — corrigir SOMENTE `waybackService.js` (URLs/formato de resposta), atualizar os mocks dos testes da Task 1 para o formato corrigido e rodar de novo até `SMOKE OK`.

- [ ] **Step 2: Suíte completa de regressão**

Run: `cd src/server && npm test`
Expected: PASS integral (suítes novas: waybackService, waybackSyncJob, waybackInspectionGuard, waybackGridCore; suítes pré-existentes intactas: blockRoundSemantics, excessInspectionsPreviewStore, i18nParity, supervisorFilters).

- [ ] **Step 3: Verificação manual guiada (requer instância local com Mongo)**

Checklist (documentar o resultado de cada item):

1. Subir o server local; logar como super-admin; criar campanha com `imageType: 'wayback'`, 3-5 landUse e `numInspec: 1`.
2. Fazer upload de um GeoJSON pequeno (3-5 pontos em área urbana brasileira).
3. `GET /api/wayback/sync/<campaignId>/status` até `status: 'completed'`; conferir no Mongo `db.points.findOne()` com `waybackImages` ordenado e `waybackSyncedAt` presente.
4. Logar como inspetor: a grade deve exibir N células com datas irregulares (não 1/ano), imagens de alta resolução carregando, sem seletor de período nem visparam.
5. Preencher o form por data com uma transição de classe (2 caixas), enviar; conferir no Mongo `inspection[0].form[]` com `{releaseNum, captureDate, landUse}` por release.
6. Logar como supervisor: mesma grade, mesmas datas.
7. Regressão visual: abrir uma campanha `landsat` existente e confirmar comportamento idêntico ao anterior (grade por ano, período DRY/WET, visparam, submit por ano).
8. Ponto sem `waybackImages` (inserir um manualmente sem o campo): aviso de bloqueio exibido, submit desabilitado.

- [ ] **Step 4: Commit final (se autorizado)**

```bash
git add simulate/wayback-smoke.js
git commit -m "test(tvi): adiciona smoke test do contrato do Esri Wayback"
```

---

## Autorrevisão do plano (executada na escrita)

- **Cobertura da spec**: modelo de dados §4 → Tasks 2 e 3; serviço server §5.1 → Task 1; endpoints/job §5.2-5.3 → Task 2; alterações mínimas §5.4 → Task 3; client §6.1-6.6 → Tasks 5, 6, 7; casos de borda §7 → distribuídos (release removida → Task 6 `tileerror`; captureDate nulo → Tasks 1, 5; ponto sem imagens → Task 7; lock/idempotência → Task 2; regressão → Tasks 4, 7, 9); testes §8 → Tasks 1, 2, 4, 5 e regressão na 9.
- **Divergências conscientes da spec**: endpoints administrativos em `/api/wayback/...` (motivo documentado na Task 2); teste de regressão de `generateMaps` (§8.4) coberto pela verificação manual 9.3.7 + guard da Task 4, pois o laço por ano vive em controller AngularJS sem harness de unidade.
- **Consistência de tipos**: `waybackImages[]` (Task 2) ↔ `buildGrid` (Task 5) ↔ template (Task 7); `expandAnswersToForm` (Task 5) produz exatamente o formato validado por `waybackInspectionGuard` (Task 4); `getReleasesIndex` (Task 6) indexa a resposta de `/service/wayback/releases` (Task 2).
- **Riscos sinalizados**: contrato real da Esri validado na Task 9 com correção confinada ao `waybackService`; nomes exatos de variáveis locais (`campaignId` no segundo ponto de upload, método de unregister do `mapSyncService`) têm instrução de conferência in loco.
