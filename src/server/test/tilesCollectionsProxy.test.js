'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');

test('consultas e gravações de coleções usam a rota autenticada sem redirecionamento', async () => {
    const calls = [];
    const server = http.createServer((req, res) => {
        calls.push({ url: req.url, method: req.method, authenticated: !!req.headers.authorization });
        if (req.url.endsWith('/')) {
            res.writeHead(307, { Location: '/authentication-required' });
            return res.end();
        }
        if (req.url === '/authentication-required') {
            res.writeHead(401);
            return res.end();
        }
        req.resume();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const config = require('../config')({}).tilesApi;
    config.baseUrl = 'http://127.0.0.1:' + server.address().port;
    config.retryAttempts = 0;
    config.timeout = 2000;
    const logger = { debug: async () => {}, warn: async () => {}, error: async () => {} };
    const service = require('../services/tilesApiService')({ config: { tilesApi: config }, services: { logger } });
    service.client.defaults.proxy = false;
    service.getAuthFromRequest = async () => ({ username: 'fixture-admin', password: 'fixture-only' });
    try {
        await service.getLandsatCollections({});
        await service.updateLandsatCollections([], {});
        await service.getSentinelCollections({});
        await service.updateSentinelCollections({}, {});
        assert.deepEqual(calls, [
            { url: '/api/vis-params/landsat-collections', method: 'GET', authenticated: true },
            { url: '/api/vis-params/landsat-collections', method: 'PUT', authenticated: true },
            { url: '/api/vis-params/sentinel-collections', method: 'GET', authenticated: true },
            { url: '/api/vis-params/sentinel-collections', method: 'PUT', authenticated: true }
        ]);
    } finally {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    }
});
