/**
 * Colunas do ponto por idioma, ponta a ponta no servidor: handlers reais de
 * `campaign-crud.js` (create e update) e `supervisor.js` (getCampaignConfig)
 * contra um Mongo de verdade.
 *
 * Pré-requisito: MongoDB acessível (default 127.0.0.1:27019). Sem ele, os
 * cenários são pulados.
 *
 * Execução:
 *   cd src/server && npm test
 *   ou
 *   node --test src/server/test/campaignPropertyDisplayCrud.test.js
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const TEST_DB = 'tvi_campaign_property_display_test';
const CAMPAIGN_ID = 'property_display_test';
const VAZIO = { default: [], 'pt-BR': [], en: [], id: [] };
const INDONESIA = {
    default: [{ key: 'Kel_Desa', label: '' }, { key: 'Satuan_BL', label: 'Bentuklahan' }],
    'pt-BR': [],
    en: [{ key: 'Village', label: '' }, { key: 'Landform', label: '' }],
    id: [{ key: 'Kel_Desa', label: '' }, { key: 'Satuan_BL', label: 'Bentuklahan' }]
};

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

test('colunas do ponto por idioma: create, update e campaign/config', { concurrency: false }, async (t) => {
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

    await t.test('create sem propertyDisplay grava as listas vazias', async () => {
        const res = await create({});
        assert.equal(res.statusCode, 200);
        assert.deepEqual((await stored()).propertyDisplay, VAZIO);
        assert.deepEqual((await campaignConfig()).body.propertyDisplay, VAZIO);
    });

    await t.test('create com a configuração da Indonésia grava normalizado e campaign/config devolve o mesmo objeto', async () => {
        const res = await create({ propertyDisplay: {
            default: [{ key: ' Kel_Desa ' }, { key: 'Satuan_BL', label: 'Bentuklahan ' }],
            en: [{ key: 'Village' }, { key: 'Landform' }],
            id: [{ key: 'Kel_Desa' }, { key: 'Satuan_BL', label: 'Bentuklahan' }]
        } });
        assert.equal(res.statusCode, 200);
        assert.deepEqual((await stored()).propertyDisplay, INDONESIA);
        assert.deepEqual((await campaignConfig()).body.propertyDisplay, INDONESIA);
    });

    await t.test('create e update inválidos respondem 400 e não alteram o documento', async () => {
        let res = await create({ propertyDisplay: { es: [] } });
        assert.equal(res.statusCode, 400);
        assert.match(String(res.body.error), /propertyDisplay/);
        assert.equal(await stored(), null);

        await create({ propertyDisplay: INDONESIA });
        res = await update({ propertyDisplay: { en: [{ key: 'Village' }, { key: 'Village' }] } });
        assert.equal(res.statusCode, 400);
        assert.match(String(res.body.error), /propertyDisplay\.en repeats column Village/);
        assert.deepEqual((await stored()).propertyDisplay, INDONESIA);
    });

    await t.test('update sem a chave propertyDisplay mantém o valor gravado', async () => {
        await create({ propertyDisplay: INDONESIA });
        const res = await update({ numInspec: 5 });
        assert.equal(res.statusCode, 200);
        assert.deepEqual((await stored()).propertyDisplay, INDONESIA);

        await update({ propertyDisplay: null });
        assert.deepEqual((await stored()).propertyDisplay, VAZIO, 'nulo limpa a configuração');
    });

    await t.test('campaign/config resolve documento antigo sem o campo', async () => {
        await create({ propertyDisplay: INDONESIA });
        await new Promise(r => collections.campaign.updateOne({ _id: CAMPAIGN_ID }, { $unset: { propertyDisplay: '' } }, r));
        assert.deepEqual((await campaignConfig()).body.propertyDisplay, VAZIO);
    });
});
