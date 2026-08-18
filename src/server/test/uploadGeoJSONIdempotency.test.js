/**
 * Regressão do incidente de 2026-08-17 — reenvio de GeoJSON duplicando pontos.
 *
 * O que aconteceu: `val_prodes_to_2025_add.geojson` (494 feições) foi enviado
 * duas vezes para a campanha `val_prodes_to_2025`, com dois minutos de
 * intervalo. Os dois uploads responderam `insertedCount: 494` porque
 * `processGeoJSONDirect` calcula `counter = último index + 1` e insere sem
 * verificar reenvio — o segundo envio simplesmente acrescenta os mesmos pontos
 * com novos índices.
 *
 * Este teste exercita o handler HTTP real (`CampaignCrud.uploadGeoJSON`) contra
 * um Mongo de verdade, com o mesmo arquivo enviado duas vezes, e cobre o que os
 * testes de unidade do store não alcançam: a fiação entre handler, store e
 * coleção de pontos.
 *
 * Pré-requisito: MongoDB acessível (default 127.0.0.1:27019). Sem ele, os
 * cenários são pulados.
 *
 * Execução:
 *   cd src/server && npm test
 *   ou
 *   node --test src/server/test/uploadGeoJSONIdempotency.test.js
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const receipts = require(path.join(__dirname, '..', 'services', 'geojsonUploadReceipts'));

const TEST_DB = 'tvi_upload_idempotency_test';
const CAMPAIGN_ID = 'val_prodes_to_2025_test';

let mongodb;
try {
    mongodb = require(path.join(__dirname, '..', 'node_modules', 'mongodb'));
} catch (e) {
    mongodb = null;
}

function getMongoConfig() {
    const url = process.env.TVI_TEST_MONGO_URL;
    if (url) {
        const match = url.match(/^mongodb:\/\/([^:/]+)(?::(\d+))?/);
        if (match) return { host: match[1], port: parseInt(match[2] || '27017', 10) };
    }
    return {
        host: process.env.TVI_TEST_MONGO_HOST || '127.0.0.1',
        port: parseInt(process.env.TVI_TEST_MONGO_PORT || '27019', 10)
    };
}

function openDb() {
    const cfg = getMongoConfig();
    return new mongodb.Db(TEST_DB, new mongodb.Server(cfg.host, cfg.port, { auto_reconnect: true, pool_size: 4 }), { safe: true });
}

function openWithTimeout(db, timeoutMs) {
    return new Promise((resolve) => {
        let settled = false;
        const timer = setTimeout(() => { if (!settled) { settled = true; resolve(false); } }, timeoutMs);
        db.open((err) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(!err);
        });
    });
}

// GeoJSON com 3 feições — o suficiente para provar duplicação sem pesar o teste.
function buildGeoJSON() {
    return JSON.stringify({
        type: 'FeatureCollection',
        features: [
            { type: 'Feature', geometry: { type: 'Point', coordinates: [-47.795268933457, -9.303896313390087] }, properties: { id: 1 } },
            { type: 'Feature', geometry: { type: 'Point', coordinates: [-48.064763518692, -6.207942518200570] }, properties: { id: 2 } },
            { type: 'Feature', geometry: { type: 'Point', coordinates: [-48.610490053795, -10.944579348305980] }, properties: { id: 3 } }
        ]
    });
}

// Logger silencioso com a superfície que o controller usa.
const noopLogger = {
    info: async () => {},
    error: () => {},
    warn: () => {},
    debug: () => {}
};

function buildResponse() {
    const res = { statusCode: 200, body: null };
    res.status = function (code) { res.statusCode = code; return res; };
    res.json = function (payload) { res.body = payload; return res; };
    return res;
}

function buildRequest(body) {
    return {
        body: body,
        sessionID: 'sess-test',
        session: { admin: { superAdmin: { id: 'admin-test' } } },
        ip: '127.0.0.1',
        connection: { remoteAddress: '127.0.0.1' },
        get: () => null,
        headers: {},
        method: 'POST',
        url: '/api/campaigns/upload-geojson'
    };
}

test('upload de GeoJSON — idempotência ponta a ponta', { concurrency: false }, async (t) => {
    if (!mongodb) {
        t.skip('driver mongodb não encontrado em node_modules — pulando integração');
        return;
    }

    const db = openDb();
    if (!await openWithTimeout(db, 3000)) {
        const cfg = getMongoConfig();
        t.skip(`Mongo em ${cfg.host}:${cfg.port} indisponível — pulando integração. ` +
               `Override com TVI_TEST_MONGO_URL (e.g. mongodb://localhost:27017).`);
        return;
    }

    const collections = {
        campaign: db.collection('campaign'),
        points: db.collection('points'),
        [receipts.COLLECTION_NAME]: db.collection(receipts.COLLECTION_NAME)
    };

    await new Promise((resolve, reject) => {
        collections[receipts.COLLECTION_NAME].createIndexes(receipts.INDEXES, (err) => err ? reject(err) : resolve());
    });

    const app = {
        config: {},
        repository: { collections: collections, db: db },
        services: { logger: noopLogger },
        io: null
    };

    const CampaignCrud = require(path.join(__dirname, '..', 'controllers', 'campaign-crud'))(app);

    t.after(async () => {
        await new Promise(r => collections.points.deleteMany({}, r));
        await new Promise(r => collections.campaign.deleteMany({}, r));
        await new Promise(r => collections[receipts.COLLECTION_NAME].deleteMany({}, r));
        db.close();
    });

    t.beforeEach(async () => {
        await new Promise(r => collections.points.deleteMany({}, r));
        await new Promise(r => collections.campaign.deleteMany({}, r));
        await new Promise(r => collections[receipts.COLLECTION_NAME].deleteMany({}, r));
        await new Promise(r => collections.campaign.insertOne({ _id: CAMPAIGN_ID, numInspec: 3 }, r));
    });

    function upload(extra) {
        const req = buildRequest(Object.assign({
            campaignId: CAMPAIGN_ID,
            geojsonContent: buildGeoJSON(),
            filename: 'val_prodes_to_2025_add.geojson'
        }, extra || {}));
        const res = buildResponse();
        return CampaignCrud.uploadGeoJSON(req, res).then(() => res);
    }

    function countPoints() {
        return new Promise((resolve, reject) => {
            collections.points.count({ campaign: CAMPAIGN_ID }, (err, n) => err ? reject(err) : resolve(n));
        });
    }

    await t.test('o primeiro upload insere os pontos', async () => {
        const res = await upload();

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.success, true);
        assert.equal(res.body.insertedCount, 3);
        assert.equal(res.body.firstIndex, 1);
        assert.equal(res.body.lastIndex, 3);
        assert.equal(await countPoints(), 3);
    });

    await t.test('o reenvio do mesmo arquivo é recusado com 409 e não insere nada', async () => {
        await upload();
        const res = await upload();

        assert.equal(res.statusCode, 409, 'o segundo envio precisa ser recusado');
        assert.equal(res.body.duplicate, true);
        assert.equal(res.body.canForce, true);
        assert.equal(res.body.previousUpload.insertedCount, 3);
        assert.equal(res.body.previousUpload.firstIndex, 1);
        assert.equal(res.body.previousUpload.lastIndex, 3);
        assert.equal(await countPoints(), 3, 'a base não pode crescer com o reenvio');
    });

    await t.test('duplo clique: envios concorrentes inserem os pontos uma única vez', async () => {
        const [first, second] = await Promise.all([upload(), upload()]);

        const statuses = [first.statusCode, second.statusCode].sort();
        assert.deepEqual(statuses, [200, 409], 'um envio processa, o outro é recusado');
        assert.equal(await countPoints(), 3);
    });

    await t.test('force: true reenvia deliberadamente e duplica os pontos', async () => {
        await upload();
        const res = await upload({ force: true });

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.insertedCount, 3);
        assert.equal(res.body.firstIndex, 4, 'o reenvio forçado continua a numeração');
        assert.equal(await countPoints(), 6, 'duplicação deliberada é permitida quando explícita');
    });

    await t.test('arquivo diferente na mesma campanha continua sendo aceito', async () => {
        await upload();

        const other = JSON.stringify({
            type: 'FeatureCollection',
            features: [
                { type: 'Feature', geometry: { type: 'Point', coordinates: [-50.11, -12.44] }, properties: { id: 9 } }
            ]
        });
        const res = await upload({ geojsonContent: other });

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.insertedCount, 1);
        assert.equal(await countPoints(), 4);
    });

    await t.test('upload que não inseriu nenhum ponto não bloqueia o reenvio', async () => {
        // Feições com geometria não suportada: o processamento "conclui", mas
        // nada entra na base. Bloquear o reenvio nesse caso seria punir o
        // administrador por um upload que não teve efeito algum — e o retry não
        // pode duplicar nada, justamente porque nada foi inserido.
        const semPontos = JSON.stringify({
            type: 'FeatureCollection',
            features: [
                { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 1], [1, 0], [0, 0]]] }, properties: { id: 1 } }
            ]
        });

        const first = await upload({ geojsonContent: semPontos });
        assert.equal(first.statusCode, 200);
        assert.equal(first.body.insertedCount, 0);
        assert.equal(await countPoints(), 0);

        const retry = await upload({ geojsonContent: semPontos });
        assert.equal(retry.statusCode, 200, 'reenvio de um upload sem efeito deve ser aceito');
    });

    await t.test('o recibo registra o resultado do upload concluído', async () => {
        await upload();

        const receipt = await new Promise((resolve, reject) => {
            collections[receipts.COLLECTION_NAME].findOne({ campaignId: CAMPAIGN_ID }, (err, doc) => err ? reject(err) : resolve(doc));
        });

        assert.equal(receipt.status, 'completed');
        assert.equal(receipt.contentHash, receipts.hashContent(buildGeoJSON()));
        assert.equal(receipt.insertedCount, 3);
        assert.equal(receipt.filename, 'val_prodes_to_2025_add.geojson');
        assert.equal(receipt.forced, false);
    });
});
