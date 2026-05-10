#!/usr/bin/env node
/**
 * timeout-scenario.js  (Fase C)
 *
 * Como já consumimos toda a campanha na Fase A (todos os blocos completed),
 * este teste cria um BLOCO ARTIFICIAL com `assignedAt` antigo e `status='assigned'`
 * para verificar:
 *   - releaseExpiredBlocksInternal detecta o timeout e libera o bloco
 *   - tvi_blocos_release_log recebe 1 doc com previousAssignedTo / previousOffset / releaseReason='timeout'
 *   - O bloco original tem status='available', assignedTo=null, currentPointOffset PRESERVADO
 *
 * O trigger é uma chamada POST /api/campaigns/:id/blocks/release-expired
 * (admin-only) que executa releaseExpiredBlocksInternal SEM passar pelo
 * claim subsequente, permitindo observar o estado intermediário do bloco
 * (available com offset preservado) antes que algum claim sobrescreva.
 *
 * Não muta nada além do bloco artificial e seus efeitos.
 */

'use strict';

const path = require('path');
const http = require('http');
const MongoClient = require('/tmp/test-mongo-deps/node_modules/mongodb').MongoClient;

const HOST = 'localhost';
const PORT = parseInt(process.env.TVI_SIM_PORT || '3000', 10);
const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27019';
const MONGO_DB = process.env.MONGO_DB || 'tvi_sim';
const CAMPAIGN_ID = 'simulation_test_campaign';
const PASSWORD = 'simtest123';

function httpReq(opts, body) {
    return new Promise((resolve, reject) => {
        const req = http.request(opts, res => {
            let chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
        });
        req.on('error', reject);
        if (body) req.write(body);
        req.end();
    });
}
function getCookie(setCookie) {
    if (!setCookie) return null;
    const arr = Array.isArray(setCookie) ? setCookie : [setCookie];
    for (const sc of arr) { const m = sc.match(/^sid=([^;]+)/); if (m) return 'sid=' + m[1]; }
    return null;
}
async function adminLogin() {
    const body = JSON.stringify({ username: 'admin', password: 'admin123' });
    const r = await httpReq({
        host: HOST, port: PORT, path: '/api/admin/login', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'Origin': `http://${HOST}:${PORT}`, 'Host': `${HOST}:${PORT}` }
    }, body);
    if (r.status !== 200) throw new Error('admin login http ' + r.status + ': ' + r.body);
    return getCookie(r.headers['set-cookie']);
}
async function releaseExpired(cookie) {
    const r = await httpReq({
        host: HOST, port: PORT, path: `/api/campaigns/${CAMPAIGN_ID}/blocks/release-expired`, method: 'POST',
        headers: { 'Cookie': cookie, 'Content-Length': '0', 'Origin': `http://${HOST}:${PORT}`, 'Host': `${HOST}:${PORT}` }
    });
    return r;
}

async function main() {
    console.log(`[timeout-scenario] target ${HOST}:${PORT}, mongo ${MONGO_URL}/${MONGO_DB}`);
    const client = await MongoClient.connect(MONGO_URL);
    const db = client.db(MONGO_DB);
    const blocos = db.collection('tvi_blocos');
    const releaseLog = db.collection('tvi_blocos_release_log');

    // Pegar 1 ponto que existe no campanha (qualquer um) para montar o bloco artificial
    const samplePoint = await db.collection('points').findOne({ campaign: CAMPAIGN_ID });
    if (!samplePoint) throw new Error('campanha sem pontos — rode o setup primeiro');
    const fakePointIds = [samplePoint._id];

    const FAKE_BLOCK_INDEX = 99999;
    const FAKE_INSPECTOR = 'timeout.victim';
    const FAKE_OFFSET = 3;
    const NINE_HOURS_AGO = new Date(Date.now() - 9 * 60 * 60 * 1000);

    // Garante que não há resíduo de runs anteriores
    await blocos.deleteMany({ campaignId: CAMPAIGN_ID, blockIndex: FAKE_BLOCK_INDEX });
    await releaseLog.deleteMany({ blockIndex: FAKE_BLOCK_INDEX });

    const fakeBlock = {
        campaignId: CAMPAIGN_ID,
        blockIndex: FAKE_BLOCK_INDEX,
        inspectionRound: 1,
        pointIndexStart: 0,
        pointIndexEnd: 4,
        pointIds: [samplePoint._id, samplePoint._id, samplePoint._id, samplePoint._id, samplePoint._id],
        size: 5,
        status: 'assigned',
        assignedTo: FAKE_INSPECTOR,
        assignedAt: NINE_HOURS_AGO,
        completedAt: null,
        currentPointOffset: FAKE_OFFSET,
        timeoutMinutes: 480,
        discardedBy: null, discardedAt: null, discardReason: null,
        createdAt: new Date()
    };
    const ins = await blocos.insertOne(fakeBlock);
    const fakeBlockId = ins.insertedId;
    console.log(`[timeout-scenario] bloco artificial criado: _id=${fakeBlockId} blockIndex=${FAKE_BLOCK_INDEX} size=5 assignedTo=${FAKE_INSPECTOR} offset=${FAKE_OFFSET} assignedAt=${NINE_HOURS_AGO.toISOString()}`);

    console.log('[timeout-scenario] login admin + POST /api/campaigns/:id/blocks/release-expired');
    const cookie = await adminLogin();
    if (!cookie) throw new Error('admin login falhou');
    const rel = await releaseExpired(cookie);
    console.log(`[timeout-scenario] release-expired http=${rel.status} body=${rel.body.substring(0,150)}`);

    // Esperado:
    //  (a) o bloco artificial vira status='available', assignedTo=null, currentPointOffset PRESERVADO=3
    //  (b) tvi_blocos_release_log recebe 1 doc com previousAssignedTo=timeout.victim, previousOffset=3
    const after = await blocos.findOne({ _id: fakeBlockId });
    const log = await releaseLog.findOne({ blockId: fakeBlockId });

    console.log('\n[timeout-scenario] ESTADO PÓS-RELEASE');
    console.log(`  bloco status            : ${after.status}            (esperado: available)`);
    console.log(`  bloco assignedTo        : ${after.assignedTo}        (esperado: null)`);
    console.log(`  bloco currentPointOffset: ${after.currentPointOffset} (esperado: ${FAKE_OFFSET} - PRESERVADO)`);
    console.log(`  release_log existe      : ${!!log}`);
    if (log) {
        console.log(`    previousAssignedTo  : ${log.previousAssignedTo}    (esperado: ${FAKE_INSPECTOR})`);
        console.log(`    previousOffset      : ${log.previousOffset}        (esperado: ${FAKE_OFFSET})`);
        console.log(`    releaseReason       : ${log.releaseReason}`);
    }

    let ok = true;
    if (after.status !== 'available') { console.error('  FAIL: status não voltou para available'); ok = false; }
    if (after.assignedTo !== null) { console.error('  FAIL: assignedTo não foi limpo'); ok = false; }
    if (after.currentPointOffset !== FAKE_OFFSET) { console.error('  FAIL: currentPointOffset não foi preservado'); ok = false; }
    if (!log) { console.error('  FAIL: tvi_blocos_release_log não tem snapshot'); ok = false; }
    else {
        if (log.previousAssignedTo !== FAKE_INSPECTOR) { console.error('  FAIL: previousAssignedTo errado'); ok = false; }
        if (log.previousOffset !== FAKE_OFFSET) { console.error('  FAIL: previousOffset errado'); ok = false; }
        if (log.releaseReason !== 'timeout') { console.error('  FAIL: releaseReason errado'); ok = false; }
    }

    await client.close();
    if (!ok) { console.error('\n[timeout-scenario] FAIL'); process.exit(1); }
    console.log('\n[timeout-scenario] PASS');
    process.exit(0);
}

main().catch(err => { console.error('[timeout-scenario] FATAL:', err); process.exit(99); });
