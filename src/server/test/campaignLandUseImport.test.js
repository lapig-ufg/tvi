/**
 * Busca de campanhas de origem para importar classes
 * (GET /api/campaigns/search com withLandUse=true), contra um Mongo de
 * verdade: só campanhas com classes, com a lista, sem alterar a resposta
 * da busca comum e tratando o texto digitado literalmente.
 *
 * Pré-requisito: MongoDB acessível (default 127.0.0.1:27019). Sem ele, os
 * cenários são pulados.
 *
 * Execução:
 *   cd src/server && npm test
 *   ou
 *   node --test src/server/test/campaignLandUseImport.test.js
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const TEST_DB = 'tvi_campaign_land_use_import_test';
const CAMPAIGN_ID = 'imp_a';

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

function buscar(CampaignCrud, query) {
    const res = buildResponse();
    const req = buildRequest({});
    req.query = query;
    req.method = 'GET';
    req.url = '/api/campaigns/search';
    return CampaignCrud.search(req, res).then(() => res);
}

test('busca de campanhas para importar classes', { concurrency: false }, async (t) => {
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

    await new Promise(r => collections.campaign.deleteMany({}, r));
    await new Promise(r => collections.campaign.insertMany([
        { _id: 'imp_a', initialYear: 1988, finalYear: 2026, imageType: 'landsat', landUse: ['Hutan alam', 'Sawit', 'Tambang'] },
        { _id: 'imp_b', initialYear: 1985, finalYear: 2024, imageType: 'landsat', landUse: [] },
        { _id: 'imp_c', initialYear: 1985, finalYear: 2024, imageType: 'landsat' }
    ], r));

    t.after(async () => {
        await new Promise(r => collections.campaign.deleteMany({}, r));
        db.close();
    });

    await t.test('withLandUse=true devolve só campanhas com classes, com a lista', async () => {
        const res = await buscar(CampaignCrud, { q: 'imp', withLandUse: 'true' });
        assert.equal(res.statusCode, 200);
        assert.equal(res.body.success, true);
        assert.deepEqual(res.body.results.map((r) => r.id), ['imp_a']);
        assert.deepEqual(res.body.results[0].landUse, ['Hutan alam', 'Sawit', 'Tambang']);
    });

    await t.test('sem withLandUse a resposta não muda', async () => {
        const res = await buscar(CampaignCrud, { q: 'imp' });
        assert.equal(res.statusCode, 200);
        assert.deepEqual(res.body.results.map((r) => r.id), ['imp_a', 'imp_b', 'imp_c']);
        res.body.results.forEach((r) => {
            assert.equal(Object.prototype.hasOwnProperty.call(r, 'landUse'), false, r.id);
            assert.deepEqual(Object.keys(r).sort(), ['finalYear', 'id', 'imageType', 'initialYear', 'label']);
        });
    });

    await t.test('texto com caracteres de regex é tratado literalmente', async () => {
        for (const q of ['cp1 (', 'a.b*', 'imp[', 'imp_a)']) {
            const res = await buscar(CampaignCrud, { q: q, withLandUse: 'true' });
            assert.equal(res.statusCode, 200, q);
            assert.equal(res.body.success, true, q);
            assert.deepEqual(res.body.results, [], q);
        }
    });
});
