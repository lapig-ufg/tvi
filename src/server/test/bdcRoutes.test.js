'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { collection, campaign, point, ready } = require('./helpers/bdcFixtures');
const selectionService = require('../services/bdcSelectionService');

async function fixture(t, override = {}) {
    const app = express();
    app.disable('etag');
    app.use(require('body-parser').json());
    app.use((req, res, next) => {
        const role = req.headers['x-test-session'];
        req.session = role === 'admin' ? { admin: { superAdmin: true } } : role ?
            { user: { name: 'reader', type: role === 'supervisor' ? 'supervisor' : 'inspector', campaign: { _id: role === 'other' ? 'other' : 'c' } } } : {};
        next();
    });
    const seed = selectionService.identity(campaign, point, 2020, 'DRY');
    const saved = Object.assign(seed, { state: 'ready', result: ready().result });
    const selections = collection([saved]);
    const calls = [];
    app.repository = { collections: { points: collection([point]), campaign: collection([override.campaign || campaign]), campaignImageSelections: selections } };
    app.config = { tilesApi: { baseUrl: 'https://tiles.example' } };
    app.services = { bdcTilesClient: { async getTile(...args) { calls.push(args); if (override.tileError) throw override.tileError; return Buffer.from('89504e470d0a1a0a0000', 'hex'); }, async getCatalog() { return { collections: [] }; } },
        bdcSelectionService: selectionService.create(selections, { createJob: async () => ready() }) };
    require('../routes/bdcSelections')(app);
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const url = 'http://127.0.0.1:' + server.address().port;
    return { saved, calls, selections, async get(path, session = 'inspector') {
        return fetch(url + path, { headers: session ? { 'x-test-session': session } : {} });
    }, async post(path, body, session = 'inspector') {
        return fetch(url + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-test-session': session }, body: JSON.stringify(body) });
    } };
}

test('seleções exigem sessão e associação real entre ponto e campanha', async t => {
    const f = await fixture(t);
    assert.equal((await f.get('/service/points/p/bdc-selections?year=2020&period=DRY', null)).status, 401);
    assert.equal((await f.get('/service/points/p/bdc-selections?year=2020&period=DRY', 'other')).status, 404);
    assert.equal((await f.get('/service/points/p/bdc-selections?year=2020&period=DRY', 'supervisor')).status, 200);
    assert.equal((await f.get('/service/points/p/bdc-selections?year=2021&period=WET')).status, 404);
});

test('histórico conserva coordenadas e URLs relativas mesmo após campanha mudar de fonte', async t => {
    const f = await fixture(t, { campaign: { ...campaign, imagerySource: null } });
    const response = await f.get('/service/points/p/bdc-selections?selectionId=' + f.saved._id);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.lon, point.lon);
    assert.equal(body.lat, point.lat);
    assert.equal(body.local.tiles.natural, '/service/bdc/tiles/' + f.saved._id + '/local/natural/{z}/{x}/{y}.png');
    assert.equal(JSON.stringify(body).includes('https://'), false);
});

test('proxy autoriza histórico e encaminha exclusivamente aquisição e composição persistidas', async t => {
    const f = await fixture(t);
    const path = '/service/bdc/tiles/' + f.saved._id + '/local/natural/6/1/2.png';
    assert.equal((await f.get(path, null)).status, 401);
    assert.equal((await f.get(path, 'other')).status, 404);
    const image = await f.get(path);
    assert.equal(image.status, 200);
    assert.equal(image.headers.get('content-type'), 'image/png');
    assert.equal(image.headers.get('x-content-type-options'), 'nosniff');
    assert.deepEqual(f.calls, [['landsat-2', 'scene', 'natural', 6, 1, 2]]);
    for (const invalid of [path + '?url=https://evil', path.replace('/local/', '/other/'),
        path.replace('/natural/', '/not-allowed/'), path.replace('/6/1/2.png', '/6/64/2.png'),
        path.replace(f.saved._id, 'invalid'), path.replace('/6/1/2.png', '/5/1/2.png'), path.replace('/6/1/2.png', '/19/1/2.png')]) {
        assert.ok([400, 404].includes((await f.get(invalid)).status));
    }
    assert.equal(f.calls.length, 1);
});


test('proxy mantém indicação de espera sem transformar capacidade ocupada em imagem ausente', async t => {
    const f = await fixture(t, { tileError: { status: 503, message: 'Temporariamente ocupado.', retryAfterSeconds: 2 } });
    const response = await f.get('/service/bdc/tiles/' + f.saved._id + '/local/natural/6/1/2.png');
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('retry-after'), '2');
    assert.equal(response.headers.get('cache-control'), 'no-store');
});
