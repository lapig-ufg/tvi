'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { campaign, point } = require('./helpers/bdcFixtures');

function item(overrides = {}) {
    return Object.assign({ id: 'scene', collection: 'landsat-2', properties: { datetime: '2020-08-01T12:00:00Z', 'eo:cloud_cover': 7 },
        geometry: { type: 'Polygon', coordinates: [[[-50, -4], [-48, -4], [-48, -2], [-50, -2], [-50, -4]]] },
        assets: { arbitrary: { href: 'https://externo.example/arquivo' } } }, overrides);
}

function setup(options = {}) {
    const calls = [];
    let now = 0;
    const detail = { item: item(options.item), collection: { id: 'landsat-2' }, profiles: [{ id: 'natural', label: 'Natural' }, { id: 'not-allowed', label: 'Indisponível' }] };
    const service = require('../services/bdcImageBrowser').create({
        searchImages: async params => { calls.push(['search', params]); return { items: options.items || [detail.item], next_page: 2 }; },
        getItem: async (...args) => { calls.push(['detail', ...args]); return detail; },
        getTile: async (...args) => { calls.push(['tile', ...args]); return Buffer.from('89504e470d0a1a0a0000', 'hex'); }
    }, { now: () => now });
    return { service, calls, detail, advance: () => { now += 61000; } };
}

test('exploração deriva coleção e área do ponto e oferece ano inteiro sem expor ativos remotos', async () => {
    const f = setup();
    const result = await f.service.search(campaign, point, { year: '2020', period: 'YEAR', limit: '24' });
    assert.equal(f.calls[0][1].collection, 'landsat-2');
    assert.equal(f.calls[0][1].start, '2020-01-01');
    assert.equal(f.calls[0][1].end, '2020-12-31');
    assert.equal(f.calls[0][1].limit, 24);
    assert.ok(f.calls[0][1].bbox[0] < point.lon && f.calls[0][1].bbox[2] > point.lon);
    assert.deepEqual(result.items, [{ id: 'scene', datetime: '2020-08-01T12:00:00.000Z', cloudPercent: 7 }]);
    assert.equal(result.nextPage, 2);
    assert.equal(JSON.stringify(result).includes('https://'), false);
});

test('detalhe e tile validam candidato e composição e reutilizam metadados por tempo limitado', async () => {
    const f = setup();
    const query = { year: '2020', period: 'DRY' };
    const result = await f.service.detail(campaign, point, 'scene', query);
    assert.deepEqual(result.profiles, [{ id: 'natural', label: 'Natural' }]);
    assert.match(result.tiles.natural, /^\/service\/points\/p\/bdc-images\/scene\/tiles\/natural\/\{z\}\/\{x\}\/\{y\}\.png\?year=2020&period=DRY$/);
    await f.service.tile(campaign, point, 'scene', 'natural', ['6', '1', '2'], query);
    assert.equal(f.calls.filter(x => x[0] === 'detail').length, 1);
    assert.deepEqual(f.calls.find(x => x[0] === 'tile'), ['tile', 'landsat-2', 'scene', 'natural', 6, 1, 2]);
    f.advance();
    await f.service.detail(campaign, point, 'scene', query);
    assert.equal(f.calls.filter(x => x[0] === 'detail').length, 2);
});

test('períodos personalizados e paginação são validados antes de consultar o BDC', async () => {
    const f = setup();
    for (const query of [
        { year: '2019' }, { year: '2022' }, { year: ['2020'] }, { year: '2020', limit: '25' },
        { year: '2020', page: '0' }, { year: '2020', page: '1001' }, { year: '2020', maxCloud: '101' },
        { year: '2020', collection: 'outra' }, { year: '2020', bbox: '0,0,1,1' }, { year: '2020', url: 'https://externo' },
        { year: '2020', period: 'CUSTOM', start: '2020-02-30', end: '2020-03-01' },
        { year: '2020', period: 'CUSTOM', start: '2020-12-01', end: '2021-01-01' },
        { year: '2020', period: 'CUSTOM', start: '2020-12-01', end: '2020-01-01' }
    ]) await assert.rejects(f.service.search(campaign, point, query), { status: 400 });
    assert.equal(f.calls.length, 0);
    const result = await f.service.search(campaign, point, { year: '2020', period: 'CUSTOM', start: '2020-02-29', end: '2020-08-02' });
    assert.equal(result.startDate, '2020-02-29');
    assert.equal(result.endDate, '2020-08-02');
    await assert.rejects(f.service.search({ ...campaign, imagerySource: null }, point, { year: '2020' }), { status: 404 });
});

test('aquisição de outro ponto, ano ou coleção não pode servir tiles', async () => {
    const outer = [[-50, -4], [-48, -4], [-48, -2], [-50, -2], [-50, -4]];
    for (const override of [
        { collection: 'S2_L2A-1' },
        { properties: { datetime: '2021-08-01T00:00:00Z' } },
        { geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] } },
        { geometry: { type: 'Polygon', coordinates: [outer, [[-49.1, -3.1], [-48.9, -3.1], [-48.9, -2.9], [-49.1, -2.9], [-49.1, -3.1]]] } },
        { geometry: null }, { id: '../scene' }
    ]) {
        const f = setup({ item: override });
        assert.equal((await f.service.search(campaign, point, { year: '2020' })).items.length, 0);
        await assert.rejects(f.service.tile(campaign, point, 'scene', 'natural', ['6', '1', '2'], { year: '2020' }), { status: 404 });
        assert.equal(f.calls.some(call => call[0] === 'tile'), false);
    }
});

test('tiles rejeitam composição e coordenadas fora do contrato sem encaminhar origem arbitrária', async () => {
    const f = setup();
    for (const coords of [['5', '1', '2'], ['19', '1', '2'], ['6', '-1', '2'], ['6', '64', '2']]) {
        await assert.rejects(f.service.tile(campaign, point, 'scene', 'natural', coords, { year: '2020' }), { status: 400 });
    }
    await assert.rejects(f.service.tile(campaign, point, '../scene', 'natural', ['6', '1', '2'], { year: '2020' }), { status: 400 });
    await assert.rejects(f.service.tile(campaign, point, 'scene', 'natural', ['6', '1', '2'], { year: '2020', url: 'https://externo' }), { status: 400 });
    await assert.rejects(f.service.tile(campaign, point, 'scene', 'not-allowed', ['6', '1', '2'], { year: '2020' }), { status: 404 });
    assert.equal(f.calls.some(call => call[0] === 'tile'), false);
});

async function httpFixture(t, options = {}) {
    const express = require('express');
    const { collection } = require('./helpers/bdcFixtures');
    const app = express();
    app.use((req, res, next) => {
        const session = req.headers['x-test-session'];
        req.session = session === 'admin' ? { admin: { superAdmin: true } }
            : session ? { user: { campaign: { _id: session === 'other' ? 'other' : 'c' } } } : {};
        next();
    });
    const points = collection([point]);
    const campaigns = collection([campaign]);
    const calls = [];
    const client = {
        async searchImages() {
            calls.push('search');
            if (options.afterSearch) options.afterSearch(points, campaigns);
            if (options.error) throw options.error;
            return { items: [item()], next_page: null };
        },
        async getItem() { calls.push('detail'); return { item: item(), collection: { id: 'landsat-2' }, profiles: [{ id: 'natural' }] }; },
        async getTile() { calls.push('tile'); return Buffer.from('89504e470d0a1a0a0000', 'hex'); }
    };
    app.repository = { collections: { points, campaign: campaigns } };
    app.services = { bdcImageBrowser: require('../services/bdcImageBrowser').create(client) };
    require('../routes/bdcImages')(app);
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    return { calls, points, campaigns, request: (path, role = 'inspector', method = 'GET') => fetch('http://127.0.0.1:' + server.address().port + path, { method, headers: role ? { 'x-test-session': role } : {} }) };
}

test('rotas autorizam ponto da sessão em cada consulta e não escrevem seleção nem inspeção', async t => {
    const f = await httpFixture(t);
    const base = '/service/points/p/bdc-images';
    for (const path of [base + '?year=2020', base + '/scene?year=2020', base + '/scene/tiles/natural/6/1/2.png?year=2020']) {
        assert.equal((await f.request(path, null)).status, 401);
        assert.equal((await f.request(path, 'other')).status, 404);
    }
    assert.equal(f.calls.length, 0);
    assert.equal((await f.request(base + '?year=2020', 'admin')).status, 200);
    const detail = await f.request(base + '/scene?year=2020');
    assert.equal(detail.status, 200);
    const url = (await detail.json()).tiles.natural.replace('{z}', '6').replace('{x}', '1').replace('{y}', '2');
    const image = await f.request(url);
    assert.equal(image.status, 200);
    assert.equal(image.headers.get('content-type'), 'image/png');
    assert.equal(image.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(image.headers.get('cache-control'), 'no-store');
    assert.equal((await f.request(base + '?year=2020', 'admin', 'POST')).status, 404);
    assert.deepEqual([...f.points.docs.values()], [point]);
    assert.deepEqual([...f.campaigns.docs.values()], [campaign]);
});

test('mudança de ponto ou configuração durante a consulta impede uso da resposta antiga', async t => {
    for (const change of [
        points => { points.docs.get('p').campaign = 'other'; },
        (points, campaigns) => { campaigns.docs.get('c').bdcConfig.profiles = ['false-color']; },
        points => { points.docs.get('p').pointMutationLock = 'op'; }
    ]) {
        const f = await httpFixture(t, { afterSearch: change });
        const response = await f.request('/service/points/p/bdc-images?year=2020');
        assert.ok([404, 409].includes(response.status));
    }
});

test('serviço ocupado mantém Retry-After e não converte falha em lista vazia', async t => {
    const f = await httpFixture(t, { error: { status: 503, message: 'Origem ocupada.', retryAfterSeconds: 2 } });
    const response = await f.request('/service/points/p/bdc-images?year=2020');
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('retry-after'), '2');
    assert.deepEqual(await response.json(), { error: 'Origem ocupada.' });
});

test('cobertura respeita MultiPolygon, bordas e interior de buracos', async () => {
    const outer = [[-50, -4], [-48, -4], [-48, -2], [-50, -2], [-50, -4]];
    const hole = [[-49, -3], [-48.5, -3], [-48.5, -2.5], [-49, -2.5], [-49, -3]];
    const geometry = { type: 'MultiPolygon', coordinates: [[[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]], [outer, hole]] };
    const f = setup({ item: { geometry } });
    assert.equal((await f.service.detail(campaign, point, 'scene', { year: '2020' })).id, 'scene');
    assert.equal((await f.service.detail(campaign, { ...point, lon: -50, lat: -3 }, 'scene', { year: '2020' })).id, 'scene');
    await assert.rejects(f.service.detail(campaign, { ...point, lon: -48.75, lat: -2.75 }, 'scene', { year: '2020' }), { status: 404 });
});

test('cache de metadados não dispensa autorização nem perfil atual a cada tile', async t => {
    const f = await httpFixture(t);
    const url = '/service/points/p/bdc-images/scene/tiles/natural/6/1/2.png?year=2020';
    assert.equal((await f.request(url)).status, 200);
    f.campaigns.docs.get('c').bdcConfig.profiles = ['false-color'];
    assert.equal((await f.request(url)).status, 404);
    assert.equal((await f.request(url, 'other')).status, 404);
    assert.equal((await f.request(url, null)).status, 401);
    assert.equal(f.calls.filter(call => call === 'tile').length, 1);
    assert.equal(f.calls.filter(call => call === 'detail').length, 1);
});
