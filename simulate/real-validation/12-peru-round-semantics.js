/**
 * 12-peru-round-semantics.js
 *
 * Valida a correção da semântica de rounds (Tier 2.9 relativo, 2026-06-12)
 * contra uma CÓPIA da campanha real `mapbiomas_peru_col4_region5` — campanha
 * SEM seed de 'Classificação Automática' (pontos nascem com userName=[] e
 * sem o campo userNameCount, diferentemente de mapbiomas_pastagem_col11).
 *
 * Reproduz exatamente o cenário do incidente de 2026-06:
 *   1. Clona campanha + pontos de SRC (prod, somente leitura) para um banco
 *      isolado dedicado (DST), que é DESCARTADO e recriado a cada execução.
 *   2. Gera blocos (blockSize=5, como o gestor usou em produção).
 *   3. Verifica que o PRIMEIRO login recebe um ponto real — antes da
 *      correção, o Tier 2.9 pulava todos os pontos (length 0 < round) e o
 *      primeiro usuário consumia todos os blocos, recebendo a tela finish.
 *   4. Três inspetores simulados trabalham até o fim (save espelha as
 *      mutações de updatePoint: $push userName, userNameCount, decremento
 *      de underInspection, advance-on-save + completeBlock).
 *   5. Verificação final: todos os pontos com numInspec inspeções, sem
 *      inspetor duplicado e zero zumbis (findZombiePointIds).
 *
 * Uso:
 *   node simulate/real-validation/12-peru-round-semantics.js
 *
 * Variáveis de ambiente:
 *   SRC_MONGO_HOST/PORT/DB  (default: localhost / 27018 / tvi)
 *   DST_MONGO_HOST/PORT/DB  (default: localhost / 27019 / tvi_real_validation_peru)
 *   CAMPAIGN_ID             (default: mapbiomas_peru_col4_region5)
 *   BLOCK_SIZE              (default: 5)
 *
 * Resultado: simulate/real-validation/results/12-peru-round-semantics.json
 * Exit code 0 = todas as verificações passaram.
 */

'use strict';

const path = require('node:path');
const fs = require('node:fs');

const SERVER_DIR = path.join(__dirname, '..', '..', 'src', 'server');
const mongodb = require(path.join(SERVER_DIR, 'node_modules', 'mongodb'));

const SRC = {
    host: process.env.SRC_MONGO_HOST || 'localhost',
    port: parseInt(process.env.SRC_MONGO_PORT || '27018', 10),
    db: process.env.SRC_MONGO_DB || 'tvi'
};
const DST = {
    host: process.env.DST_MONGO_HOST || 'localhost',
    port: parseInt(process.env.DST_MONGO_PORT || '27019', 10),
    db: process.env.DST_MONGO_DB || 'tvi_real_validation_peru'
};
const CAMPAIGN_ID = process.env.CAMPAIGN_ID || 'mapbiomas_peru_col4_region5';
const BLOCK_SIZE = parseInt(process.env.BLOCK_SIZE || '5', 10);
const RESULTS_FILE = path.join(__dirname, 'results', '12-peru-round-semantics.json');

const checks = [];
function check(name, ok, detail) {
    checks.push({ name: name, ok: !!ok, detail: detail === undefined ? null : detail });
    console.log((ok ? '  [OK]   ' : '  [FAIL] ') + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : ''));
    return !!ok;
}

function openDb(cfg) {
    const Db = mongodb.Db, Server = mongodb.Server;
    const db = new Db(cfg.db, new Server(cfg.host, cfg.port, { auto_reconnect: true, pool_size: 4 }), { safe: true });
    return new Promise((resolve, reject) => {
        db.open((err) => err ? reject(new Error('Falha ao conectar em ' + cfg.host + ':' + cfg.port + '/' + cfg.db + ': ' + err.message)) : resolve(db));
    });
}

const stubLogger = {
    info: async () => 'log-id',
    warn: async () => 'log-id',
    error: async (msg, meta) => {
        console.error('  [logger.error] ' + msg, meta && meta.metadata && meta.metadata.error);
        return 'log-id';
    }
};

function buildApp(db) {
    const app = {
        services: { logger: stubLogger },
        repository: {
            collections: {
                points: db.collection('points'),
                mosaics: db.collection('mosaics'),
                status: db.collection('status'),
                tvi_blocos: db.collection('tvi_blocos'),
                campaign: db.collection('campaign')
            }
        },
        controllers: {}
    };
    app.controllers.blocos = require(path.join(SERVER_DIR, 'controllers', 'blocos'))(app);
    app.controllers.points = require(path.join(SERVER_DIR, 'controllers', 'points'))(app);
    return app;
}

function fakeRes() {
    let resolveDone;
    const done = new Promise((resolve) => { resolveDone = resolve; });
    return {
        statusCode: 200, body: null, done: done,
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; resolveDone(this); return this; },
        send(body) { this.body = body; resolveDone(this); return this; },
        end() { resolveDone(this); }
    };
}

async function callHandler(handler, req) {
    const res = fakeRes();
    await handler(req, res);
    await Promise.race([
        res.done,
        new Promise((_, reject) => setTimeout(() => reject(new Error('handler não respondeu em 30s')), 30000))
    ]);
    return res;
}

async function getCurrentPoint(app, campaignDoc, username) {
    const req = {
        session: { user: { name: username, campaign: campaignDoc } },
        sessionID: 'sim-' + username,
        url: '/service/points/next-point',
        method: 'GET'
    };
    const res = await callHandler(app.controllers.points.getCurrentPoint, req);
    if (res.statusCode !== 200) {
        throw new Error('getCurrentPoint HTTP ' + res.statusCode + ': ' + JSON.stringify(res.body));
    }
    return res.body;
}

// Espelha as mutações de updatePoint relevantes (pointsService.appendInspection
// + decremento de underInspection + advance-on-save Tier 2.3/2.10).
async function simulateSave(app, campaignId, username, pointId) {
    const points = app.repository.collections.points;
    const blocos = app.repository.collections.tvi_blocos;
    const blocosCtrl = app.controllers.blocos;

    const before = await points.findOne({ _id: pointId });
    await points.updateOne({ _id: pointId }, {
        $push: { userName: username, inspection: { counter: 1, form: [] } },
        $set: { userNameCount: (before.userName || []).length + 1 }
    });
    await points.updateOne(
        { _id: pointId, underInspection: { $gt: 0 } },
        { $inc: { underInspection: -1 } }
    );

    const block = await blocos.findOne({
        campaignId: campaignId,
        assignedTo: username,
        status: 'assigned',
        pointIds: pointId
    });
    if (block) {
        const slot = block.pointIds.indexOf(pointId);
        const updated = await blocosCtrl.advanceBlockOffsetToAtLeast(block._id, slot + 1);
        if (updated && updated.currentPointOffset >= updated.size) {
            await blocosCtrl.completeBlock(block._id);
        }
    }
}

async function workUntilFinish(app, campaignDoc, username, maxIterations) {
    let saves = 0;
    for (let i = 0; i < maxIterations; i++) {
        const result = await getCurrentPoint(app, campaignDoc, username);
        if (result.error) throw new Error('getCurrentPoint erro: ' + JSON.stringify(result.error));
        if (!result.point || !result.point._id) return saves; // finish
        await simulateSave(app, campaignDoc._id, username, result.point._id);
        saves++;
        if (saves % 250 === 0) console.log('    ' + username + ': ' + saves + ' saves...');
    }
    throw new Error(username + ' não convergiu em ' + maxIterations + ' iterações');
}

async function main() {
    console.log('=== 12-peru-round-semantics ===');
    console.log('SRC: ' + SRC.host + ':' + SRC.port + '/' + SRC.db + ' (somente leitura)');
    console.log('DST: ' + DST.host + ':' + DST.port + '/' + DST.db + ' (descartado e recriado)');
    console.log('Campanha: ' + CAMPAIGN_ID + ' | blockSize: ' + BLOCK_SIZE);

    const srcDb = await openDb(SRC);
    const dstDb = await openDb(DST);

    try {
        // ------------------------------------------------------------------
        // (1) Clone para banco isolado dedicado
        // ------------------------------------------------------------------
        await new Promise((resolve) => dstDb.dropDatabase(() => resolve()));

        const srcCampaign = await srcDb.collection('campaign').findOne({ _id: CAMPAIGN_ID });
        if (!srcCampaign) throw new Error('Campanha ' + CAMPAIGN_ID + ' não encontrada em ' + SRC.db);
        await dstDb.collection('campaign').insertOne(srcCampaign);

        const cursor = srcDb.collection('points').find({ campaign: CAMPAIGN_ID }).sort({ _id: 1 });
        let batch = [], copied = 0;
        // eslint-disable-next-line no-constant-condition
        while (true) {
            const doc = await cursor.nextObject();
            if (!doc) break;
            batch.push(doc);
            if (batch.length >= 1000) {
                await dstDb.collection('points').insertMany(batch, { ordered: false });
                copied += batch.length; batch = [];
            }
        }
        if (batch.length > 0) {
            await dstDb.collection('points').insertMany(batch, { ordered: false });
            copied += batch.length;
        }
        console.log('(1/5) clone: campanha + ' + copied + ' pontos copiados');

        const app = buildApp(dstDb);
        const points = app.repository.collections.points;
        const numInspec = srcCampaign.numInspec;
        const pendingBefore = await points.count({
            campaign: CAMPAIGN_ID,
            $where: 'this.userName.length < ' + numInspec
        });
        console.log('      pendentes: ' + pendingBefore + ' / ' + copied + ' (numInspec=' + numInspec + ')');

        // ------------------------------------------------------------------
        // (2) generateBlocks — como o gestor fez em produção
        // ------------------------------------------------------------------
        const genRes = await callHandler(app.controllers.blocos.generateBlocks, {
            params: { id: CAMPAIGN_ID },
            body: { blockSize: BLOCK_SIZE, timeoutMinutes: 480 }
        });
        if (genRes.statusCode !== 200) throw new Error('generateBlocks falhou: ' + JSON.stringify(genRes.body));
        console.log('(2/5) generateBlocks: ' + JSON.stringify(genRes.body));
        check('generateBlocks cria numInspec rounds para campanha sem seed', genRes.body.rounds === numInspec, genRes.body.rounds);

        // ------------------------------------------------------------------
        // (3) Regressão do incidente: primeiro login deve receber ponto
        // ------------------------------------------------------------------
        const first = await getCurrentPoint(app, srcCampaign, 'sim_user_1');
        const gotPoint = !!(first.point && first.point._id);
        check('primeiro login recebe ponto real (incidente: recebia finish)', gotPoint,
            gotPoint ? { pointIndex: first.current, round: first.block && first.block.inspectionRound } : first.point);
        if (!gotPoint) throw new Error('Regressão do incidente reproduzida — abortando.');
        await simulateSave(app, CAMPAIGN_ID, 'sim_user_1', first.point._id);

        // ------------------------------------------------------------------
        // (4) Três inspetores até o fim
        // ------------------------------------------------------------------
        console.log('(4/5) simulação de ' + numInspec + ' inspetores...');
        const maxIters = pendingBefore + 100;
        const savesPerUser = { sim_user_1: 1 };
        savesPerUser.sim_user_1 += await workUntilFinish(app, srcCampaign, 'sim_user_1', maxIters);
        savesPerUser.sim_user_2 = await workUntilFinish(app, srcCampaign, 'sim_user_2', maxIters);
        savesPerUser.sim_user_3 = await workUntilFinish(app, srcCampaign, 'sim_user_3', maxIters);
        console.log('      saves: ' + JSON.stringify(savesPerUser));

        // ------------------------------------------------------------------
        // (5) Verificação consolidada
        // ------------------------------------------------------------------
        const incomplete = await points.count({
            campaign: CAMPAIGN_ID,
            $where: 'this.userName.length < ' + numInspec
        });
        check('todos os pontos atingem numInspec inspeções', incomplete === 0, { pontosIncompletos: incomplete });

        const overfull = await points.count({
            campaign: CAMPAIGN_ID,
            $where: 'this.userName.length > ' + numInspec
        });
        check('nenhum ponto excede numInspec (Tier 2.5)', overfull === 0, { pontosExcedidos: overfull });

        const dupes = await points.aggregate([
            { $match: { campaign: CAMPAIGN_ID } },
            { $project: { n: { $size: '$userName' }, d: { $size: { $setUnion: ['$userName', []] } } } },
            { $match: { $expr: { $ne: ['$n', '$d'] } } },
            { $count: 'c' }
        ]).toArray();
        check('nenhum inspetor duplicado no mesmo ponto', dupes.length === 0, dupes[0] || { c: 0 });

        const zombies = await app.controllers.blocos.findZombiePointIds(CAMPAIGN_ID);
        check('zero pontos zumbi ao final', zombies.length === 0, { zumbis: zombies.length });

        const blockStates = await dstDb.collection('tvi_blocos').aggregate([
            { $match: { campaignId: CAMPAIGN_ID } },
            { $group: { _id: '$status', c: { $sum: 1 } } }
        ]).toArray();
        const nonCompleted = blockStates.filter((s) => s._id !== 'completed');
        check('todos os blocos terminam completed', nonCompleted.length === 0, blockStates);

        // ------------------------------------------------------------------
        // Relatório
        // ------------------------------------------------------------------
        const failed = checks.filter((c) => !c.ok);
        const report = {
            script: '12-peru-round-semantics',
            executedAt: new Date().toISOString(),
            campaign: CAMPAIGN_ID,
            blockSize: BLOCK_SIZE,
            numInspec: numInspec,
            pointsCloned: copied,
            pendingBefore: pendingBefore,
            savesPerUser: savesPerUser,
            checks: checks,
            passed: failed.length === 0
        };
        fs.mkdirSync(path.dirname(RESULTS_FILE), { recursive: true });
        fs.writeFileSync(RESULTS_FILE, JSON.stringify(report, null, 2));
        console.log('(5/5) relatório: ' + RESULTS_FILE);
        console.log(failed.length === 0
            ? '=== RESULTADO: TODAS AS VERIFICAÇÕES PASSARAM ==='
            : '=== RESULTADO: ' + failed.length + ' FALHA(S) ===');
        process.exitCode = failed.length === 0 ? 0 : 1;
    } finally {
        srcDb.close();
        dstDb.close();
    }
}

main().catch((err) => {
    console.error('ERRO FATAL: ' + err.message);
    console.error(err.stack);
    process.exitCode = 2;
});
