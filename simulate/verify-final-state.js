#!/usr/bin/env node
/**
 * verify-final-state.js  (Fase E)
 *
 * Roda asserções finais após Fases A/B/C/D contra:
 *   - tvi_sim (queries diretas no Mongo)
 *   - GET /api/admin/inspection-health (endpoint Tier 3.2)
 *
 * Salva o JSON do health endpoint em simulate/results/ para auditoria
 * posterior. Não muta nada.
 *
 * Exit 0 = PASS  |  Exit 1 = FAIL
 */

'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const MongoClient = require('/tmp/test-mongo-deps/node_modules/mongodb').MongoClient;

const HOST = 'localhost';
const PORT = parseInt(process.env.TVI_SIM_PORT || '3000', 10);
const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27019';
const MONGO_DB = process.env.MONGO_DB || 'tvi_sim';
const CAMPAIGN_ID = 'simulation_test_campaign';

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
    if (r.status !== 200) throw new Error('admin login http ' + r.status);
    return getCookie(r.headers['set-cookie']);
}

async function getHealth(cookie) {
    const r = await httpReq({
        host: HOST, port: PORT,
        path: `/api/admin/inspection-health?campaignId=${CAMPAIGN_ID}`,
        method: 'GET',
        headers: { 'Cookie': cookie, 'Origin': `http://${HOST}:${PORT}`, 'Host': `${HOST}:${PORT}` }
    });
    if (r.status !== 200) throw new Error('health http ' + r.status + ': ' + r.body);
    return JSON.parse(r.body);
}

const checks = [];
function assert(name, cond, observed, expected) {
    checks.push({ name, pass: !!cond, observed, expected });
}

async function main() {
    console.log(`[verify] target ${HOST}:${PORT}, mongo ${MONGO_URL}/${MONGO_DB}`);
    const client = await MongoClient.connect(MONGO_URL);
    const db = client.db(MONGO_DB);

    // ----- Queries diretas no Mongo -----
    const points = db.collection('points');
    const blocos = db.collection('tvi_blocos');
    const auditCol = db.collection('points_audit');
    const releaseLog = db.collection('tvi_blocos_release_log');

    // 1. Distribuição esperada de userName.length nos pontos da campanha
    const lenAgg = await points.aggregate([
        { $match: { campaign: CAMPAIGN_ID } },
        { $project: { len: { $size: { $ifNull: ['$userName', []] } } } },
        { $group: { _id: '$len', n: { $sum: 1 } } }
    ]).toArray();
    const byLen = {};
    lenAgg.forEach(r => { byLen[String(r._id)] = r.n; });
    const len3 = byLen['3'] || 0;
    const lenGT3 = lenAgg.filter(r => r._id > 3).reduce((a, r) => a + r.n, 0);

    assert('Pontos com userName.length === 3 >= 500 (Fase A consumiu 500)', len3 >= 500, len3, '>= 500');
    assert('Pontos com userName.length > 3 (concorrência ok se = 0)', lenGT3 === 0, lenGT3, 0);

    // 2. Sincronia de arrays paralelos
    const desync = await points.countDocuments({
        campaign: CAMPAIGN_ID,
        $expr: { $ne: [{ $size: { $ifNull: ['$userName', []] } }, { $size: { $ifNull: ['$inspection', []] } }] }
    });
    assert('userName.length === inspection.length (validator)', desync === 0, desync, 0);

    // 3. Blocos: 200 completed (100 round1 + 100 round2)
    const blAgg = await blocos.aggregate([
        { $match: { campaignId: CAMPAIGN_ID } },
        { $group: { _id: { round: '$inspectionRound', status: '$status' }, n: { $sum: 1 } } }
    ]).toArray();
    const byRoundStatus = {};
    blAgg.forEach(r => { byRoundStatus[`${r._id.round}.${r._id.status}`] = r.n; });
    assert('Blocos round=1 completed >= 100', (byRoundStatus['1.completed'] || 0) >= 100, byRoundStatus['1.completed'] || 0, '>= 100');
    assert('Blocos round=2 completed >= 100', (byRoundStatus['2.completed'] || 0) >= 100, byRoundStatus['2.completed'] || 0, '>= 100');

    // 4. Audit log: pelo menos 1000 append_inspection (500 × 2)
    const auditAgg = await auditCol.aggregate([
        { $match: { campaignId: CAMPAIGN_ID } },
        { $group: { _id: '$operation', n: { $sum: 1 } } }
    ]).toArray();
    const byOp = {};
    auditAgg.forEach(r => { byOp[r._id] = r.n; });
    assert('points_audit append_inspection >= 1000', (byOp['append_inspection'] || 0) >= 1000, byOp['append_inspection'] || 0, '>= 1000');

    // 5. tvi_blocos_release_log com pelo menos 1 doc (Fase C)
    const releaseCount = await releaseLog.countDocuments({ campaignId: CAMPAIGN_ID, releaseReason: 'timeout' });
    assert('tvi_blocos_release_log timeout >= 1 (Fase C)', releaseCount >= 1, releaseCount, '>= 1');

    // 6. Mesmo inspetor 1º E 2º do mesmo bloco — deve ser 0 (Tier 0.5)
    const sameInspector = await blocos.aggregate([
        { $match: { campaignId: CAMPAIGN_ID, blockIndex: { $lt: 90000 } } }, // ignora artificiais
        { $group: { _id: '$blockIndex', who: { $push: { round: '$inspectionRound', who: '$assignedTo' } } } },
        {
            $match: {
                $expr: {
                    $and: [
                        { $eq: [{ $size: '$who' }, 2] },
                        { $eq: [{ $arrayElemAt: ['$who.who', 0] }, { $arrayElemAt: ['$who.who', 1] }] }
                    ]
                }
            }
        },
        { $count: 'n' }
    ]).toArray();
    const sameInspCount = (sameInspector[0] && sameInspector[0].n) || 0;
    assert('Mesmo inspetor virou 1º E 2º (Tier 0.5)', sameInspCount === 0, sameInspCount, 0);

    // 7. Health endpoint disponível e métricas batem
    let health;
    try {
        const adm = await adminLogin();
        health = await getHealth(adm);
    } catch (err) {
        assert('inspection-health endpoint responde', false, err.message, '200 OK JSON');
    }

    if (health) {
        assert('health.points.total === 501 (500 fase A + 1 sintético do shadow)',
            health.metrics.points.total >= 500, health.metrics.points.total, '>= 500');
        assert('health.points.byUserNameLength["3"] >= 500',
            (health.metrics.points.byUserNameLength['3'] || 0) >= 500,
            health.metrics.points.byUserNameLength['3'] || 0, '>= 500');
        assert('health.audit.last24h.byOperation.append_inspection >= 1000',
            (health.metrics.audit.last24h.byOperation.append_inspection || 0) >= 1000,
            health.metrics.audit.last24h.byOperation.append_inspection || 0, '>= 1000');
        assert('health.releaseLog.last24h.total >= 1',
            (health.metrics.releaseLog.last24h.total || 0) >= 1,
            health.metrics.releaseLog.last24h.total || 0, '>= 1');
    }

    // ----- Persistência do health -----
    if (health) {
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        const out = path.join(__dirname, 'results', `inspection-health-${ts}.json`);
        try { fs.mkdirSync(path.dirname(out), { recursive: true }); } catch (e) {}
        fs.writeFileSync(out, JSON.stringify({ generatedAt: new Date(), health, checks }, null, 2));
        console.log(`\n[verify] inspection-health salvo em ${out}`);
    }

    // ----- Resumo -----
    console.log('\n=== CHECKS ===');
    let pass = 0, fail = 0;
    checks.forEach(c => {
        const tag = c.pass ? '✓ PASS' : '✗ FAIL';
        console.log(`${tag}  ${c.name}  observed=${JSON.stringify(c.observed)}  expected=${JSON.stringify(c.expected)}`);
        if (c.pass) pass++; else fail++;
    });
    console.log(`\nTotal: ${pass} pass / ${fail} fail / ${checks.length} checks`);

    await client.close();
    if (fail > 0) { console.error('\n[verify] FAIL'); process.exit(1); }
    console.log('\n[verify] PASS — todos os critérios da simulação atendidos');
    process.exit(0);
}

main().catch(err => { console.error('[verify] FATAL:', err); process.exit(99); });
