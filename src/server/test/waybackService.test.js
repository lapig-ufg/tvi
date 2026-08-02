'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const waybackModule = require(path.join(__dirname, '..', 'services', 'waybackService'));
const { createWaybackService, lonLatToTile, getMetadataLayerId } = waybackModule;

const silentLogger = {
    info: async () => {}, warn: async () => {}, error: async () => {}
};

// Catálogo fake: 4 releases (datas decrescentes 2024, 2022, 2018, 2014).
// metadataLayerUrl aponta para a raiz do MapServer, sem id de sub-layer —
// confirmado contra o waybackconfig.json real (o id do sub-layer de
// resolução é decidido por getMetadata/getMetadataLayerId, não vem do catálogo).
const FAKE_CONFIG = {
    '64776': { itemTitle: 'World Imagery (Wayback 2024-01-11)', itemURL: 'https://wayback.maptiles.arcgis.com/arcgis/rest/services/world_imagery/wmts/1.0.0/default028mm/mapserver/tile/64776/{level}/{row}/{col}', metadataLayerUrl: 'https://metadata.maptiles.arcgis.com/arcgis/rest/services/Wayback_2024_r01/MapServer' },
    '35098': { itemTitle: 'World Imagery (Wayback 2022-03-02)', itemURL: 'https://wayback.maptiles.arcgis.com/arcgis/rest/services/world_imagery/wmts/1.0.0/default028mm/mapserver/tile/35098/{level}/{row}/{col}', metadataLayerUrl: 'https://metadata.maptiles.arcgis.com/arcgis/rest/services/Wayback_2022_r05/MapServer' },
    '47963': { itemTitle: 'World Imagery (Wayback 2018-06-06)', itemURL: 'https://wayback.maptiles.arcgis.com/arcgis/rest/services/world_imagery/wmts/1.0.0/default028mm/mapserver/tile/47963/{level}/{row}/{col}', metadataLayerUrl: 'https://metadata.maptiles.arcgis.com/arcgis/rest/services/Wayback_2018_r10/MapServer' },
    '10':    { itemTitle: 'World Imagery (Wayback 2014-02-20)', itemURL: 'https://wayback.maptiles.arcgis.com/arcgis/rest/services/world_imagery/wmts/1.0.0/default028mm/mapserver/tile/10/{level}/{row}/{col}', metadataLayerUrl: 'https://metadata.maptiles.arcgis.com/arcgis/rest/services/Wayback_2014_r01/MapServer' }
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

test('getMetadataLayerId: deriva o sub-layer de metadados a partir do zoom, com clamp no piso', () => {
    // MAX_ZOOM(23) - zoom, clamp em MAX_ZOOM - MIN_ZOOM(10) = 13
    assert.equal(getMetadataLayerId(23), 0);
    assert.equal(getMetadataLayerId(19), 4); // primeiro zoom da cascata do getMetadata
    assert.equal(getMetadataLayerId(10), 13);
    assert.equal(getMetadataLayerId(5), 13); // abaixo do MIN_ZOOM: clamp no sub-layer mais raso
    assert.deepEqual(waybackModule.METADATA_QUERY_ZOOMS, [19, 17, 15, 13]);
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

test('getReleases: memoização de promise evita cache stampede em chamadas concorrentes', async () => {
    // Stub que atrasa um pouco para garantir que as 2 chamadas são concorrentes
    const fetchJson = fetchJsonStub([
        ['waybackconfig.json', async function () {
            await new Promise(r => setImmediate(r));
            return FAKE_CONFIG;
        }]
    ]);
    const svc = createWaybackService({ logger: silentLogger, fetchJson });
    // Fazer 2 chamadas concorrentes (sem await)
    const p1 = svc.getReleases();
    const p2 = svc.getReleases();
    const [r1, r2] = await Promise.all([p1, p2]);
    // Ambas devem ter os mesmos dados
    assert.deepEqual(r1.map(r => r.releaseNum), [64776, 35098, 47963, 10]);
    assert.deepEqual(r2.map(r => r.releaseNum), [64776, 35098, 47963, 10]);
    // Apenas 1 chamada HTTP (não 2)
    assert.equal(fetchJson.calls.length, 1, 'chamadas concorrentes devem reutilizar a mesma promise');
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
    // URL real: {metadataLayerUrl}/{layerId}/query — cascata de sub-layers
    // [4, 6, 8, 10] (zooms 19..13); layer 4 é a primeira consultada.
    // (confirmado contra o serviço real da Esri: MapServer/0/query e MapServer/query
    // retornam vazio/schema, não features; o campo de resolução é SAMP_RES, não SRC_RES).
    const epoch2018 = Date.UTC(2018, 3, 12); // 2018-04-12
    const fetchJson = fetchJsonStub([
        ['Wayback_2018_r10/MapServer/4/query', {
            features: [{ attributes: { SRC_DATE2: epoch2018, SRC_DESC: 'Maxar', SAMP_RES: 0.3 } }]
        }],
        ['Wayback_2014_r01/MapServer/4/query', new Error('timeout')]
    ]);
    const svc = createWaybackService({ logger: silentLogger, fetchJson });

    const ok = await svc.getMetadata(
        { releaseNum: 47963, metadataLayerUrl: FAKE_CONFIG['47963'].metadataLayerUrl }, -49.25, -16.68);
    assert.deepEqual(ok, { captureDate: '2018-04-12', source: 'Maxar', resolution: 0.3 });

    const fail = await svc.getMetadata(
        { releaseNum: 10, metadataLayerUrl: FAKE_CONFIG['10'].metadataLayerUrl }, -49.25, -16.68);
    assert.deepEqual(fail, { captureDate: null, source: null, resolution: null });
});

test('getMetadata: cai em cascata para sub-layers mais grossas quando a detalhada não tem features', async () => {
    // Cenário real (Amazônia, 2026-08-01): layer 4 sem features; cobertura
    // WV03/1.2m aparece a partir da layer 6. A cascata deve parar na primeira
    // camada com resultado.
    const epoch2021 = Date.UTC(2021, 6, 10); // 2021-07-10
    const fetchJson = fetchJsonStub([
        ['Wayback_2018_r10/MapServer/4/query', { features: [] }],
        ['Wayback_2018_r10/MapServer/6/query', {
            features: [{ attributes: { SRC_DATE2: epoch2021, SRC_DESC: 'WV03', SAMP_RES: 1.2 } }]
        }]
    ]);
    const svc = createWaybackService({ logger: silentLogger, fetchJson });
    const meta = await svc.getMetadata(
        { releaseNum: 47963, metadataLayerUrl: FAKE_CONFIG['47963'].metadataLayerUrl }, -60.24, -7.69);
    assert.deepEqual(meta, { captureDate: '2021-07-10', source: 'WV03', resolution: 1.2 });
    assert.equal(fetchJson.calls.length, 2, 'para na primeira camada com features');
});

test('getMetadata: retorna nulls quando todas as sub-layers da cascata vêm vazias', async () => {
    const fetchJson = fetchJsonStub([
        ['Wayback_2018_r10/MapServer/4/query', { features: [] }],
        ['Wayback_2018_r10/MapServer/6/query', { features: [] }],
        ['Wayback_2018_r10/MapServer/8/query', { features: [] }],
        ['Wayback_2018_r10/MapServer/10/query', { features: [] }]
    ]);
    const svc = createWaybackService({ logger: silentLogger, fetchJson });
    const meta = await svc.getMetadata(
        { releaseNum: 47963, metadataLayerUrl: FAKE_CONFIG['47963'].metadataLayerUrl }, 0, 0);
    assert.deepEqual(meta, { captureDate: null, source: null, resolution: null });
    assert.equal(fetchJson.calls.length, 4, 'esgota a cascata [4,6,8,10]');
});
