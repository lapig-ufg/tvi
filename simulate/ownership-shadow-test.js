#!/usr/bin/env node
/**
 * ownership-shadow-test.js  (Fase D)
 *
 * Cria um cenário ISOLADO sem interferir com a Fase A já consumada:
 *   - Insere 1 ponto sintético sim_shadow_<ts> (campaign principal)
 *   - Insere 1 bloco artificial 'assigned' ao inspetor A (alice.shadow),
 *     com pointIds contendo o ponto sintético
 *   - Loga in como inspetor B (eve.intruder, NÃO é o owner do bloco)
 *   - B tenta POST /service/points/update-point com o ponto sintético
 *
 * Esperado pelo modo SOMBRA do Tier 2.1:
 *   - HTTP 200 (save NÃO é bloqueado)
 *   - Warning estruturado em logs (module='points' + 'Tier 2.1 shadow')
 *   - O ponto agora contém eve.intruder em userName (length=2)
 *   - audit log tem 1 entrada de append_inspection para o ponto
 */

'use strict';

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
async function login(name) {
    const body = JSON.stringify({ campaign: CAMPAIGN_ID, name, senha: PASSWORD });
    const r = await httpReq({
        host: HOST, port: PORT, path: '/service/login', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'Origin': `http://${HOST}:${PORT}`, 'Host': `${HOST}:${PORT}` }
    }, body);
    if (r.status !== 200) throw new Error('login http ' + r.status + ': ' + r.body);
    return getCookie(r.headers['set-cookie']);
}
async function updatePoint(cookie, pointId, inspection) {
    const body = JSON.stringify({ point: { _id: pointId, inspection } });
    const r = await httpReq({
        host: HOST, port: PORT, path: '/service/points/update-point', method: 'POST',
        headers: {
            'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body),
            'Cookie': cookie,
            'Origin': `http://${HOST}:${PORT}`, 'Host': `${HOST}:${PORT}`
        }
    }, body);
    return r;
}

async function main() {
    console.log(`[shadow-test] target ${HOST}:${PORT}, mongo ${MONGO_URL}/${MONGO_DB}`);
    const client = await MongoClient.connect(MONGO_URL);
    const db = client.db(MONGO_DB);
    const points = db.collection('points');
    const blocos = db.collection('tvi_blocos');
    const auditCol = db.collection('points_audit');
    const logsCol = db.collection('logs');

    const ts = Date.now();
    const SHADOW_POINT_ID = `sim_shadow_${ts}_${CAMPAIGN_ID}`;
    const OWNER = 'alice.shadow';
    const INTRUDER = 'eve.intruder';

    console.log(`[shadow-test] inserindo ponto ${SHADOW_POINT_ID}`);
    await points.insertOne({
        _id: SHADOW_POINT_ID, campaign: CAMPAIGN_ID,
        lat: -15.999, lon: -49.999,
        biome: 'CERRADO', uf: 'GO', county: 'Goiania', countyCode: '5208707',
        path: 222, row: 70, index: 9999,
        userName: ['Classificação Automática'],
        inspection: [{ counter: 0, form: [{ initialYear: 2000, finalYear: 2020, landUse: 'Pastagem' }], fillDate: new Date() }],
        classConsolidated: [], underInspection: 0, cached: true, userNameCount: 1,
        properties: { bioma: 'CERRADO' }, dateImport: new Date()
    });

    console.log(`[shadow-test] criando bloco artificial assigned=${OWNER}`);
    const blockIns = await blocos.insertOne({
        campaignId: CAMPAIGN_ID, blockIndex: 99998, inspectionRound: 1,
        pointIndexStart: 9999, pointIndexEnd: 9999,
        pointIds: [SHADOW_POINT_ID], size: 1,
        status: 'assigned', assignedTo: OWNER,
        assignedAt: new Date(), completedAt: null,
        currentPointOffset: 0, timeoutMinutes: 480,
        discardedBy: null, discardedAt: null, discardReason: null,
        createdAt: new Date()
    });

    const tStart = new Date();
    console.log(`[shadow-test] login intruder ${INTRUDER}`);
    const cookie = await login(INTRUDER);
    if (!cookie) throw new Error('intruder login falhou');

    console.log(`[shadow-test] intruder POST /service/points/update-point sobre ${SHADOW_POINT_ID}`);
    const inspection = { counter: 1, form: [{ initialYear: 2000, finalYear: 2020, landUse: 'Pastagem' }] };
    const resp = await updatePoint(cookie, SHADOW_POINT_ID, inspection);
    console.log(`[shadow-test] response http=${resp.status}, body curto=${resp.body.substring(0,150)}`);

    // Aguardar um pouco para o logger gravar (assíncrono em alguns paths)
    await new Promise(r => setTimeout(r, 500));

    const pointAfter = await points.findOne({ _id: SHADOW_POINT_ID });
    const audits = await auditCol.find({ pointId: SHADOW_POINT_ID }).toArray();
    const shadowWarns = await logsCol.find({
        timestamp: { $gte: tStart },
        message: /Tier 2\.1 shadow/
    }).toArray();

    console.log('\n[shadow-test] ESTADO PÓS-SAVE INTRUSO');
    console.log(`  HTTP do save                : ${resp.status}                (esperado: 200 — shadow não bloqueia)`);
    console.log(`  point.userName              : ${JSON.stringify(pointAfter.userName)}  (esperado: [..., ${INTRUDER}])`);
    console.log(`  point.inspection.length     : ${(pointAfter.inspection || []).length}                (esperado: 2)`);
    console.log(`  audit append_inspection     : ${audits.filter(a => a.operation === 'append_inspection').length}                (esperado: 1)`);
    console.log(`  warn 'Tier 2.1 shadow'      : ${shadowWarns.length}                (esperado: >= 1)`);
    if (shadowWarns.length > 0) {
        console.log(`  warn metadata: ${JSON.stringify(shadowWarns[0].metadata).substring(0, 220)}`);
    }

    let ok = true;
    if (resp.status !== 200) { console.error('  FAIL: save deveria passar (modo sombra)'); ok = false; }
    if (!pointAfter.userName.includes(INTRUDER)) { console.error('  FAIL: intruder não foi anexado'); ok = false; }
    if (audits.filter(a => a.operation === 'append_inspection').length < 1) { console.error('  FAIL: audit log não tem o append_inspection'); ok = false; }
    if (shadowWarns.length === 0) { console.error('  FAIL: warn de shadow ownership não foi registrado'); ok = false; }

    await client.close();
    if (!ok) { console.error('\n[shadow-test] FAIL'); process.exit(1); }
    console.log('\n[shadow-test] PASS');
    process.exit(0);
}

main().catch(err => { console.error('[shadow-test] FATAL:', err); process.exit(99); });
