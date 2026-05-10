#!/usr/bin/env node
/**
 * inspector-agents.js
 * Spawna N agentes concorrentes que se autenticam como inspetores e
 * fazem o loop next-point → update-point até esgotar a campanha.
 *
 * Uso:
 *   node simulate/inspector-agents.js
 *   node simulate/inspector-agents.js --port=3000 --inspectors-count=50 --campaign=simulation_test_campaign
 *
 * Sai com exit code 0 se todos os agentes terminaram limpos. Sai com 1
 * se algum agente registrou erro 5xx (4xx esperado em race de duplicata
 * é considerado normal). Sai com 2 se nenhum save foi feito.
 *
 * Não acessa Mongo direto. Usa apenas HTTP contra o servidor TVI.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');

// ----- Argumentos de linha -----
function parseArgs() {
    const args = { port: 3000, inspectorsCount: 50, campaign: 'simulation_test_campaign', password: 'simtest123', maxIters: 100000 };
    process.argv.slice(2).forEach(arg => {
        const m = arg.match(/^--([^=]+)=(.*)$/);
        if (!m) return;
        const k = m[1];
        const v = m[2];
        if (k === 'port' || k === 'inspectors-count' || k === 'max-iters') {
            args[k.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = parseInt(v, 10);
        } else {
            args[k.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = v;
        }
    });
    return args;
}

// ----- Cliente HTTP minimalista com cookie jar manual -----
function httpRequest(opts, body) {
    return new Promise((resolve, reject) => {
        const req = http.request(opts, res => {
            let chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => {
                const buf = Buffer.concat(chunks).toString('utf8');
                resolve({ status: res.statusCode, headers: res.headers, body: buf });
            });
        });
        req.on('error', reject);
        if (body) req.write(body);
        req.end();
    });
}

function extractCookie(setCookieHeader) {
    if (!setCookieHeader) return null;
    const arr = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
    for (const sc of arr) {
        // pega "sid=xxx" antes do primeiro ;
        const match = sc.match(/^sid=([^;]+)/);
        if (match) return 'sid=' + match[1];
    }
    return null;
}

// ----- Operações ao servidor -----
async function login(host, port, campaign, name, senha) {
    const body = JSON.stringify({ campaign, name, senha });
    const resp = await httpRequest({
        host, port, path: '/service/login', method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
            'Origin': 'http://' + host + ':' + port,
            'Host': host + ':' + port
        }
    }, body);
    if (resp.status !== 200) throw new Error(`login http ${resp.status}: ${resp.body.substring(0,200)}`);
    let parsed;
    try { parsed = JSON.parse(resp.body); } catch (e) { throw new Error('login resposta não é JSON: ' + resp.body.substring(0,200)); }
    if (!parsed.name) throw new Error('login retornou body inesperado: ' + resp.body.substring(0,200));
    const cookie = extractCookie(resp.headers['set-cookie']);
    if (!cookie) throw new Error('login não retornou sid');
    return { cookie, user: parsed };
}

async function nextPoint(host, port, cookie) {
    const resp = await httpRequest({
        host, port, path: '/service/points/next-point', method: 'GET',
        headers: { 'Cookie': cookie, 'Origin': 'http://' + host + ':' + port, 'Host': host + ':' + port }
    });
    if (resp.status !== 200) throw new Error(`next-point http ${resp.status}: ${resp.body.substring(0,200)}`);
    return JSON.parse(resp.body);
}

async function updatePoint(host, port, cookie, point) {
    const body = JSON.stringify({ point });
    const resp = await httpRequest({
        host, port, path: '/service/points/update-point', method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
            'Cookie': cookie,
            'Origin': 'http://' + host + ':' + port,
            'Host': host + ':' + port
        }
    }, body);
    return resp; // caller decide o que fazer com status
}

// ----- Síntese de inspeção -----
function buildInspection(user, point) {
    // Forma análoga aos dados reais: 1 form com initialYear/finalYear cobrindo
    // toda a janela da campanha + landUse fixo "Pastagem". Counter pseudo-único
    // por agente para reproduzir o índice campaign_inspection_counter.
    const hash = (user.name || '').split('').reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 0);
    return {
        counter: 1 + (hash % 1000),
        form: [{
            initialYear: user.campaign.initialYear || 2000,
            finalYear: user.campaign.finalYear || 2020,
            landUse: 'Pastagem'
        }]
    };
}

function jitter(min, max) {
    return new Promise(r => setTimeout(r, min + Math.floor(Math.random() * (max - min))));
}

// ----- Agente -----
async function runAgent(name, args) {
    const { port, campaign, password, maxIters } = args;
    const host = 'localhost';
    const stats = {
        name, saves: 0, e409: 0, e500: 0, eOther: 0, iters: 0,
        startTs: Date.now(), endTs: null, lastError: null, exitedReason: null
    };
    let cookie, user;
    try {
        const session = await login(host, port, campaign, name, password);
        cookie = session.cookie;
        user = session.user;
    } catch (err) {
        stats.lastError = 'login: ' + err.message;
        stats.exitedReason = 'login_failed';
        stats.endTs = Date.now();
        return stats;
    }

    // Persistir cookie para inspeção manual posterior
    try { fs.writeFileSync('/tmp/sim-cookies-' + name + '.txt', cookie); } catch (e) {}

    while (stats.iters < maxIters) {
        stats.iters++;
        let np;
        try {
            np = await nextPoint(host, port, cookie);
        } catch (err) {
            stats.lastError = 'next-point iter=' + stats.iters + ': ' + err.message;
            stats.eOther++;
            stats.exitedReason = 'next_point_failed';
            break;
        }

        if (!np.point || !np.point._id) {
            stats.exitedReason = 'campaign_done';
            break;
        }

        const inspection = buildInspection(user, np.point);
        let resp;
        try {
            resp = await updatePoint(host, port, cookie, { _id: np.point._id, inspection });
        } catch (err) {
            stats.lastError = 'update-point iter=' + stats.iters + ': ' + err.message;
            stats.eOther++;
            await jitter(50, 200);
            continue;
        }

        if (resp.status === 200) {
            stats.saves++;
        } else if (resp.status === 409) {
            stats.e409++;
        } else if (resp.status >= 500) {
            stats.e500++;
            stats.lastError = 'update http ' + resp.status + ': ' + resp.body.substring(0, 200);
        } else {
            stats.eOther++;
            stats.lastError = 'update http ' + resp.status + ': ' + resp.body.substring(0, 200);
        }

        await jitter(50, 200);
    }

    stats.endTs = Date.now();
    return stats;
}

// ----- Main -----
async function main() {
    const args = parseArgs();
    const namesPath = path.join(__dirname, 'inspector-names.json');
    const allNames = JSON.parse(fs.readFileSync(namesPath, 'utf8'));
    if (allNames.length < args.inspectorsCount) {
        throw new Error(`inspector-names.json tem ${allNames.length} nomes, mas pediu ${args.inspectorsCount}`);
    }
    const names = allNames.slice(0, args.inspectorsCount);

    console.log(`[agents] iniciando ${names.length} agentes contra http://localhost:${args.port}`);
    console.log(`[agents] campanha=${args.campaign}`);
    const t0 = Date.now();

    const results = await Promise.all(names.map(n => runAgent(n, args)));

    const elapsedSec = ((Date.now() - t0) / 1000).toFixed(1);

    // Resumo por agente
    console.log('\n[agents] resultado por agente (top-10 por saves):');
    const byTop = [...results].sort((a, b) => b.saves - a.saves).slice(0, 10);
    byTop.forEach(s => {
        const dur = ((s.endTs - s.startTs) / 1000).toFixed(1);
        console.log(`  ${s.name.padEnd(22)} saves=${String(s.saves).padStart(4)}  409=${String(s.e409).padStart(3)}  500=${s.e500}  iters=${s.iters}  dur=${dur}s  exit=${s.exitedReason}${s.lastError ? '  err=' + s.lastError.substring(0,80) : ''}`);
    });
    if (results.length > 10) console.log(`  ... e mais ${results.length - 10} agentes`);

    // Agregado
    const agg = results.reduce((a, s) => ({
        saves: a.saves + s.saves, e409: a.e409 + s.e409, e500: a.e500 + s.e500, eOther: a.eOther + s.eOther,
        iters: a.iters + s.iters, agentsWithSaves: a.agentsWithSaves + (s.saves > 0 ? 1 : 0),
        agentsWithoutSaves: a.agentsWithoutSaves + (s.saves === 0 ? 1 : 0),
        agentsLoginFailed: a.agentsLoginFailed + (s.exitedReason === 'login_failed' ? 1 : 0),
        agentsCampaignDone: a.agentsCampaignDone + (s.exitedReason === 'campaign_done' ? 1 : 0)
    }), { saves: 0, e409: 0, e500: 0, eOther: 0, iters: 0, agentsWithSaves: 0, agentsWithoutSaves: 0, agentsLoginFailed: 0, agentsCampaignDone: 0 });

    console.log('\n[agents] AGREGADO');
    console.log(`  agentes              : ${results.length}`);
    console.log(`  agentes com saves    : ${agg.agentsWithSaves}`);
    console.log(`  agentes sem saves    : ${agg.agentsWithoutSaves}`);
    console.log(`  agentes login failed : ${agg.agentsLoginFailed}`);
    console.log(`  agentes campaign_done: ${agg.agentsCampaignDone}`);
    console.log(`  saves OK             : ${agg.saves}`);
    console.log(`  409 (race duplicata) : ${agg.e409}  (${(agg.e409 / Math.max(1, agg.saves + agg.e409) * 100).toFixed(1)}% contention)`);
    console.log(`  500 (erro servidor)  : ${agg.e500}`);
    console.log(`  outros 4xx/erros     : ${agg.eOther}`);
    console.log(`  iters totais         : ${agg.iters}`);
    console.log(`  tempo total          : ${elapsedSec}s`);

    // Persistir relatório bruto
    const reportPath = path.join(__dirname, 'results', 'agents-' + Date.now() + '.json');
    try { fs.mkdirSync(path.dirname(reportPath), { recursive: true }); } catch (e) {}
    fs.writeFileSync(reportPath, JSON.stringify({ args, elapsedSec, agg, results }, null, 2));
    console.log(`\n[agents] relatório salvo em ${reportPath}`);

    if (agg.e500 > 0) { console.error('\n[agents] FAIL: houve erro 5xx'); process.exit(1); }
    if (agg.saves === 0) { console.error('\n[agents] FAIL: nenhum save bem-sucedido'); process.exit(2); }
    process.exit(0);
}

main().catch(err => {
    console.error('[agents] FATAL:', err);
    process.exit(99);
});
