/**
 * Símbolo da amostra por campanha, ponta a ponta no servidor: handlers reais
 * de `campaign-crud.js` (create e update) e `supervisor.js`
 * (getCampaignConfig) contra um Mongo de verdade. Cobre a persistência do
 * objeto normalizado, os padrões para campanha sem o campo, a rejeição de
 * valores inválidos e a exposição do campo em GET /service/campaign/config.
 *
 * Pré-requisito: MongoDB acessível (default 127.0.0.1:27019). Sem ele, os
 * cenários são pulados.
 *
 * Execução:
 *   cd src/server && npm test
 *   ou
 *   node --test src/server/test/campaignSampleMarkerCrud.test.js
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const TEST_DB = 'tvi_campaign_sample_marker_test';
const CAMPAIGN_ID = 'sample_marker_test';
const DEFAULTS = { symbol: 'marker', radiusMeters: 15, color: '#29e7e4', weight: 2, fill: false, fillOpacity: 0.2 };

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

const noopLogger = {
    info: async () => {},
    error: () => {},
    warn: async () => 'warn-code',
    debug: () => {},
    logError: async () => 'error-code'
};

function buildResponse() {
    const res = { statusCode: 200, body: null };
    res.done = new Promise((resolve) => { res.finish = resolve; });
    res.status = function (code) { res.statusCode = code; return res; };
    res.json = function (payload) { res.body = payload; res.finish(res); return res; };
    return res;
}

function buildRequest(body, params) {
    return {
        body: body,
        params: params || {},
        sessionID: 'sess-test',
        session: {
            admin: { superAdmin: { id: 'admin-test' } },
            user: { campaign: { _id: CAMPAIGN_ID } }
        },
        ip: '127.0.0.1',
        connection: { remoteAddress: '127.0.0.1' },
        get: () => null,
        headers: {},
        method: 'POST',
        url: '/api/campaigns'
    };
}

test('símbolo da amostra: create, update e campaign/config', { concurrency: false }, async (t) => {
    if (!mongodb) {
        t.skip('driver mongodb não encontrado em node_modules; pulando integração');
        return;
    }

    const db = openDb();
    if (!await openWithTimeout(db, 3000)) {
        const cfg = getMongoConfig();
        t.skip(`Mongo em ${cfg.host}:${cfg.port} indisponível; pulando integração. ` +
               `Override com TVI_TEST_MONGO_URL (e.g. mongodb://localhost:27017).`);
        return;
    }

    const collections = {
        campaign: db.collection('campaign'),
        points: db.collection('points'),
        mosaics: db.collection('mosaics')
    };

    const app = {
        config: {},
        repository: { collections: collections, db: db },
        services: { logger: noopLogger },
        io: null
    };

    const CampaignCrud = require(path.join(__dirname, '..', 'controllers', 'campaign-crud'))(app);
    const Supervisor = require(path.join(__dirname, '..', 'controllers', 'supervisor'))(app);

    t.after(async () => {
        await new Promise(r => collections.campaign.deleteMany({}, r));
        db.close();
    });

    t.beforeEach(async () => {
        await new Promise(r => collections.campaign.deleteMany({}, r));
    });

    async function create(extra) {
        const res = buildResponse();
        const body = Object.assign({ _id: CAMPAIGN_ID, landUse: ['Pastagem'], imageType: 'landsat' }, extra);
        await CampaignCrud.create(buildRequest(body), res);
        return res;
    }

    async function update(body) {
        const res = buildResponse();
        await CampaignCrud.update(buildRequest(body, { id: CAMPAIGN_ID }), res);
        return res;
    }

    function stored() {
        return collections.campaign.findOne({ _id: CAMPAIGN_ID });
    }

    function campaignConfig() {
        const res = buildResponse();
        Supervisor.getCampaignConfig(buildRequest({}), res);
        return res.done;
    }

    await t.test('create sem sampleMarker grava os padrões (marcador tradicional)', async () => {
        const res = await create({});
        assert.equal(res.statusCode, 200);
        assert.deepEqual((await stored()).sampleMarker, DEFAULTS);
    });

    await t.test('create com quadrado grava o objeto normalizado (números e cor em minúsculas)', async () => {
        const res = await create({ sampleMarker: { symbol: 'square', radiusMeters: '15', color: '#FF8800', weight: '3', fill: true, fillOpacity: '0.4' } });
        assert.equal(res.statusCode, 200);
        assert.deepEqual((await stored()).sampleMarker,
            { symbol: 'square', radiusMeters: 15, color: '#ff8800', weight: 3, fill: true, fillOpacity: 0.4 });
    });

    await t.test('create com símbolo, cor, raio ou tipo inválidos responde 400 e não insere', async () => {
        for (const value of [{ symbol: 'star' }, { color: 'red' }, { radiusMeters: 0 }, 'square']) {
            const res = await create({ sampleMarker: value });
            assert.equal(res.statusCode, 400, JSON.stringify(value));
            assert.match(String(res.body.error), /sampleMarker/);
            assert.equal(await stored(), null, `${JSON.stringify(value)} não pode ser inserido`);
        }
    });

    await t.test('update grava objeto válido normalizado e rejeita inválido mantendo o anterior', async () => {
        await create({ sampleMarker: { symbol: 'square' } });
        const circulo = Object.assign({}, DEFAULTS, { symbol: 'circle', radiusMeters: 150 });

        let res = await update({ sampleMarker: { symbol: 'circle', radiusMeters: 150 } });
        assert.equal(res.statusCode, 200);
        assert.deepEqual((await stored()).sampleMarker, circulo);

        res = await update({ sampleMarker: { symbol: 'circle', weight: 99 } });
        assert.equal(res.statusCode, 400);
        assert.match(String(res.body.error), /sampleMarker\.weight/);
        assert.deepEqual((await stored()).sampleMarker, circulo);
    });

    await t.test('update com sampleMarker nulo volta aos padrões; sem a chave, mantém o valor', async () => {
        await create({ sampleMarker: { symbol: 'square' } });
        let res = await update({ sampleMarker: null });
        assert.equal(res.statusCode, 200);
        assert.deepEqual((await stored()).sampleMarker, DEFAULTS);

        await update({ sampleMarker: { symbol: 'circle' } });
        res = await update({ numInspec: 5 });
        assert.equal(res.statusCode, 200);
        assert.deepEqual((await stored()).sampleMarker, Object.assign({}, DEFAULTS, { symbol: 'circle' }));
    });

    await t.test('campaign/config expõe o objeto resolvido e os padrões quando o documento não tem o campo', async () => {
        await create({ sampleMarker: { symbol: 'square', radiusMeters: 50 } });
        let res = await campaignConfig();
        assert.deepEqual(res.body.sampleMarker, Object.assign({}, DEFAULTS, { symbol: 'square', radiusMeters: 50 }));

        await new Promise(r => collections.campaign.updateOne({ _id: CAMPAIGN_ID }, { $unset: { sampleMarker: '' } }, r));
        res = await campaignConfig();
        assert.deepEqual(res.body.sampleMarker, DEFAULTS);
    });
});
