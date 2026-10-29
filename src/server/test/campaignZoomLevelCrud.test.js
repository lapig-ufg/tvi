/**
 * Zoom inicial da grade por campanha, ponta a ponta no servidor: handlers
 * reais de `campaign-crud.js` (create e update) e `supervisor.js`
 * (getCampaignConfig) contra um Mongo de verdade. Cobre a persistência do
 * inteiro, o padrão 13, a rejeição de valores fora da faixa e a exposição do
 * campo em GET /service/campaign/config.
 *
 * Pré-requisito: MongoDB acessível (default 127.0.0.1:27019). Sem ele, os
 * cenários são pulados.
 *
 * Execução:
 *   cd src/server && npm test
 *   ou
 *   node --test src/server/test/campaignZoomLevelCrud.test.js
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const TEST_DB = 'tvi_campaign_zoom_level_test';
const CAMPAIGN_ID = 'zoom_level_test';

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

test('zoom inicial da grade: create, update e campaign/config', { concurrency: false }, async (t) => {
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

    await t.test('create sem zoomLevel grava o padrão 13', async () => {
        const res = await create({});
        assert.equal(res.statusCode, 200);
        assert.equal((await stored()).zoomLevel, 13);
    });

    await t.test('create com string numérica grava o inteiro', async () => {
        const res = await create({ zoomLevel: '15' });
        assert.equal(res.statusCode, 200);
        assert.equal((await stored()).zoomLevel, 15);
    });

    await t.test('create com zoomLevel fora da faixa ou não numérico responde 400 e não insere', async () => {
        for (const value of [25, 'abc', 9.5]) {
            const res = await create({ zoomLevel: value });
            assert.equal(res.statusCode, 400, `valor ${value}`);
            assert.match(String(res.body.error), /zoomLevel/);
            assert.equal(await stored(), null, `valor ${value} não pode ser inserido`);
        }
    });

    await t.test('update grava inteiro válido e rejeita inválido mantendo o valor anterior', async () => {
        await create({ zoomLevel: 17 });
        let res = await update({ zoomLevel: 18 });
        assert.equal(res.statusCode, 200);
        assert.equal((await stored()).zoomLevel, 18);

        res = await update({ zoomLevel: 9 });
        assert.equal(res.statusCode, 400);
        assert.match(String(res.body.error), /zoomLevel/);
        assert.equal((await stored()).zoomLevel, 18);
    });

    await t.test('update com zoomLevel vazio volta ao padrão; sem a chave, mantém o valor', async () => {
        await create({ zoomLevel: 17 });
        let res = await update({ zoomLevel: '' });
        assert.equal(res.statusCode, 200);
        assert.equal((await stored()).zoomLevel, 13);

        await update({ zoomLevel: 16 });
        res = await update({ numInspec: 5 });
        assert.equal(res.statusCode, 200);
        assert.equal((await stored()).zoomLevel, 16);
    });

    await t.test('campaign/config expõe zoomLevel do documento e 13 quando ausente', async () => {
        await create({ zoomLevel: 17 });
        let res = await campaignConfig();
        assert.equal(res.body.zoomLevel, 17);

        await new Promise(r => collections.campaign.updateOne({ _id: CAMPAIGN_ID }, { $unset: { zoomLevel: '' } }, r));
        res = await campaignConfig();
        assert.equal(res.body.zoomLevel, 13);
    });
});
