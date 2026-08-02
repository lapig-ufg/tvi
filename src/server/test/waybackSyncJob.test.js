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

    await t.test('startSync: 404 se a campanha não existe', async () => {
        const app = buildApp(db, fakeWaybackService());
        const wayback = controllerFactory(app);
        const req = { params: { campaignId: 'camp_inexistente' }, query: {} };
        let statusCode, body;
        const res = { status(code) { statusCode = code; return this; }, json(payload) { body = payload; } };
        await wayback.startSync(req, res);
        assert.equal(statusCode, 404);
        assert.equal(body.error, 'Campanha não encontrada.');
    });

    await t.test('startSync: 400 se a campanha não é do tipo wayback', async () => {
        await db.collection('campaign').insertOne({ _id: 'camp_startsync_landsat', imageType: 'landsat' });
        const app = buildApp(db, fakeWaybackService());
        const wayback = controllerFactory(app);
        const req = { params: { campaignId: 'camp_startsync_landsat' }, query: {} };
        let statusCode, body;
        const res = { status(code) { statusCode = code; return this; }, json(payload) { body = payload; } };
        await wayback.startSync(req, res);
        assert.equal(statusCode, 400);
        assert.equal(body.error, 'Campanha não é do tipo wayback.');
    });

    await t.test('consulta metadados das releases de um ponto em paralelo', async () => {
        const releases = [100, 200, 300, 400].map(n => (
            { releaseNum: n, releaseDate: `20${n / 100 + 10}-01-01`, metadataLayerUrl: 'https://m/0' }));
        const inFlight = { cur: 0, max: 0 };
        const svc = {
            getReleases: async () => releases,
            getLocalChanges: async () => releases,
            getMetadata: async () => {
                inFlight.cur++;
                inFlight.max = Math.max(inFlight.max, inFlight.cur);
                await new Promise(r => setImmediate(r));
                inFlight.cur--;
                return { captureDate: null, source: null, resolution: null };
            }
        };
        await db.collection('campaign').insertOne({ _id: 'camp_par', imageType: 'wayback' });
        await db.collection('points').insertOne({ _id: '1_camp_par', campaign: 'camp_par', lon: 1, lat: 1 });
        const wayback = controllerFactory(buildApp(db, svc));
        const result = await wayback.runSyncJob('camp_par', {});
        assert.equal(result.processed, 1);
        assert.ok(inFlight.max >= 2,
            `metadados devem ser consultados em paralelo (máximo em voo: ${inFlight.max})`);
        const p = await db.collection('points').findOne({ _id: '1_camp_par' });
        assert.equal(p.waybackImages.length, 4, 'todas as releases presentes');
        const dates = p.waybackImages.map(i => i.captureDate || i.releaseDate);
        assert.deepEqual(dates, dates.slice().sort(), 'ordenação preservada com consultas paralelas');
    });

    await t.test('WAYBACK_SYNC_CONCURRENCY controla o paralelismo de pontos', async () => {
        const inFlight = { cur: 0, max: 0 };
        const svc = {
            getReleases: async () => [],
            getLocalChanges: async () => {
                inFlight.cur++;
                inFlight.max = Math.max(inFlight.max, inFlight.cur);
                await new Promise(r => setImmediate(r));
                inFlight.cur--;
                return [];
            },
            getMetadata: async () => ({ captureDate: null, source: null, resolution: null })
        };
        await db.collection('campaign').insertOne({ _id: 'camp_conc', imageType: 'wayback' });
        await db.collection('points').insertMany([
            { _id: '1_camp_conc', campaign: 'camp_conc', lon: 1, lat: 1 },
            { _id: '2_camp_conc', campaign: 'camp_conc', lon: 2, lat: 2 },
            { _id: '3_camp_conc', campaign: 'camp_conc', lon: 3, lat: 3 }
        ]);
        process.env.WAYBACK_SYNC_CONCURRENCY = '1';
        try {
            const wayback = controllerFactory(buildApp(db, svc));
            const result = await wayback.runSyncJob('camp_conc', {});
            assert.equal(result.processed, 3);
            assert.equal(inFlight.max, 1,
                'com WAYBACK_SYNC_CONCURRENCY=1 os pontos devem ser processados em série');
        } finally {
            delete process.env.WAYBACK_SYNC_CONCURRENCY;
        }
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
