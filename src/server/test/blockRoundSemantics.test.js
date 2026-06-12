/**
 * Testes da semântica de rounds do sistema de blocos (Tier 2.9 relativo).
 *
 * Contexto (incidente Peru, 2026-06):
 *   O guard Tier 2.9 original exigia `userName.length == inspectionRound`,
 *   calibrado em mapbiomas_pastagem_col11, cujos pontos nascem com
 *   ['Classificação Automática'] (length 1). Campanhas sem seed automático
 *   (mapbiomas_peru_col4_region*) nascem com userName=[] (length 0): todos
 *   os rounds pulavam todos os pontos e o primeiro login consumia todos os
 *   blocos via skip recursivo, derrubando a campanha na tela finish.
 *
 *   A correção torna o round relativo às inspeções HUMANAS: round R serve
 *   pontos aguardando a R-ésima inspeção humana (entradas de SYSTEM_USERS
 *   não contam). Esta suíte cobre os DOIS cenários — com e sem seed.
 *
 * Cobertura:
 *   - Unit: usernameMatcher.countHumanInspections.
 *   - Integração (com Mongo): generateBlocks (rounds relativos),
 *     findPointFromBlock via getCurrentPoint (campanha sem seed recebe
 *     ponto no primeiro login; progressão completa até numInspec sem
 *     zumbis; cenário com seed preserva o comportamento anterior),
 *     generateRecoveryBlocks (round = humanLen + 1) e o filtro anti
 *     over-serve do modo legado (vagas = numInspec - inspeções - serves).
 *
 * Pré-requisito da integração:
 *   - MongoDB acessível (default: 127.0.0.1:27019). Se a conexão falhar,
 *     os cenários são pulados com `t.skip(...)`. Requer MongoDB >= 3.6
 *     ($expr em find), mesmo requisito do código de produção (4.4.29).
 *
 * Execução:
 *   cd src/server && npm test
 *   ou
 *   node --test src/server/test/blockRoundSemantics.test.js
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const usernameMatcher = require(path.join(__dirname, '..', 'services', 'usernameMatcher'));

const TEST_DB = 'tvi_block_round_semantics_test';
const AUTO = 'Classificação Automática';

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

let mongodb;
try {
    mongodb = require(path.join(__dirname, '..', 'node_modules', 'mongodb'));
} catch (e) {
    mongodb = null;
}

function openDb() {
    const cfg = getMongoConfig();
    const Db = mongodb.Db, Server = mongodb.Server;
    return new Db(TEST_DB, new Server(cfg.host, cfg.port, { auto_reconnect: true, pool_size: 2 }), { safe: true });
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

// ---------------------------------------------------------------------------
// Unit — countHumanInspections
// ---------------------------------------------------------------------------

test('countHumanInspections ignora entradas de sistema e conta apenas humanos', () => {
    assert.equal(usernameMatcher.countHumanInspections([]), 0);
    assert.equal(usernameMatcher.countHumanInspections(undefined), 0);
    assert.equal(usernameMatcher.countHumanInspections(null), 0);
    assert.equal(usernameMatcher.countHumanInspections([AUTO]), 0);
    assert.equal(usernameMatcher.countHumanInspections([AUTO, 'ana']), 1);
    assert.equal(usernameMatcher.countHumanInspections(['ana', 'bob']), 2);
    assert.equal(usernameMatcher.countHumanInspections(['ana', AUTO, 'bob']), 2);
    // Demais entradas de SYSTEM_USERS também não contam
    assert.equal(usernameMatcher.countHumanInspections(['Exportacion_puntos']), 0);
    assert.equal(usernameMatcher.countHumanInspections(['Clasificação Anterior', 'ana']), 1);
    assert.equal(usernameMatcher.countHumanInspections(['Classificação Anterior']), 0);
});

test('semântica do guard Tier 2.9: equivalência com a regra antiga quando há seed', () => {
    // Regra nova: pular se humanLen < round - 1.
    // Com seed (humanLen = len - 1): len - 1 < R - 1  ⇔  len < R (regra antiga).
    const skips = (userName, round) =>
        usernameMatcher.countHumanInspections(userName) < round - 1;

    // Campanha COM seed (pastagem col11): comportamento idêntico ao anterior
    assert.equal(skips([AUTO], 1), false);              // round 1 serve len 1
    assert.equal(skips([AUTO], 2), true);               // round 2 não serve len 1
    assert.equal(skips([AUTO, 'ana'], 2), false);       // round 2 serve len 2
    assert.equal(skips([AUTO, 'ana'], 3), true);        // round 3 não serve len 2
    assert.equal(skips([AUTO, 'ana', 'bob'], 3), false);

    // Campanha SEM seed (Peru): round 1 precisa servir o ponto virgem
    assert.equal(skips([], 1), false);                  // ANTES DA CORREÇÃO: pulava
    assert.equal(skips([], 2), true);
    assert.equal(skips(['ana'], 2), false);
    assert.equal(skips(['ana'], 3), true);
    assert.equal(skips(['ana', 'bob'], 3), false);
});

// ---------------------------------------------------------------------------
// Integração — helpers
// ---------------------------------------------------------------------------

const stubLogger = {
    info: async () => 'log-id',
    warn: async () => 'log-id',
    error: async () => 'log-id'
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
    app.controllers.blocos = require(path.join(__dirname, '..', 'controllers', 'blocos'))(app);
    app.controllers.points = require(path.join(__dirname, '..', 'controllers', 'points'))(app);
    return app;
}

function fakeRes() {
    let resolveDone;
    const done = new Promise((resolve) => { resolveDone = resolve; });
    const res = {
        statusCode: 200,
        body: null,
        done: done,
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; resolveDone(this); return this; },
        send(body) { this.body = body; resolveDone(this); return this; },
        end() { resolveDone(this); }
    };
    return res;
}

async function callHandler(handler, req) {
    const res = fakeRes();
    await handler(req, res);
    await Promise.race([
        res.done,
        new Promise((_, reject) => setTimeout(() => reject(new Error('handler não respondeu em 15s')), 15000))
    ]);
    return res;
}

function makePoint(campaignId, index, userName) {
    return {
        _id: campaignId + '_' + index,
        campaign: campaignId,
        index: index,
        lon: -74.25 + index / 100,
        lat: -14.73,
        path: 4, row: 68,
        userName: userName.slice(),
        userNameCount: userName.length,
        inspection: [],
        underInspection: 0
    };
}

async function getCurrentPoint(app, campaignDoc, username) {
    const req = {
        session: { user: { name: username, campaign: campaignDoc } },
        sessionID: 'test-session',
        url: '/service/points/next-point',
        method: 'GET'
    };
    const res = await callHandler(app.controllers.points.getCurrentPoint, req);
    return res.body;
}

// Espelha as mutações de updatePoint relevantes ao fluxo de blocos:
// appendInspection ($push userName, userNameCount), decremento de
// underInspection e advance-on-save (Tier 2.3/2.10) com completeBlock.
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

// Inspetor trabalha até receber a tela finish (point: {}); retorna os
// _ids dos pontos efetivamente salvos por ele.
async function workUntilFinish(app, campaignDoc, username, maxIterations) {
    const saved = [];
    for (let i = 0; i < maxIterations; i++) {
        const result = await getCurrentPoint(app, campaignDoc, username);
        assert.ok(result, 'getCurrentPoint deve responder');
        assert.ok(!result.error, 'getCurrentPoint não deve falhar: ' + JSON.stringify(result.error));
        if (!result.point || !result.point._id) {
            return saved; // finish
        }
        await simulateSave(app, campaignDoc._id, username, result.point._id);
        saved.push(result.point._id);
    }
    assert.fail('workUntilFinish não convergiu em ' + maxIterations + ' iterações');
}

// ---------------------------------------------------------------------------
// Integração — cenários
// ---------------------------------------------------------------------------

test('integração: semântica de rounds com e sem Classificação Automática', async (t) => {
    if (!mongodb) {
        t.skip('driver mongodb indisponível');
        return;
    }
    const db = openDb();
    const ok = await openWithTimeout(db, 4000);
    if (!ok) {
        t.skip('MongoDB de teste indisponível em ' + JSON.stringify(getMongoConfig()));
        return;
    }

    try {
        await new Promise((resolve) => db.dropDatabase(() => resolve()));
        const app = buildApp(db);
        const campaigns = app.repository.collections.campaign;
        const points = app.repository.collections.points;
        const blocos = app.repository.collections.tvi_blocos;

        await t.test('campanha SEM seed (cenário Peru): primeiro login recebe ponto e campanha conclui', async () => {
            const campaignDoc = { _id: 'camp_peru', numInspec: 3, initialYear: 2020, finalYear: 2022 };
            await campaigns.insertOne(campaignDoc);
            const pts = [1, 2, 3, 4].map((i) => makePoint('camp_peru', i, []));
            await points.insertMany(pts);

            const genRes = await callHandler(app.controllers.blocos.generateBlocks, {
                params: { id: 'camp_peru' },
                body: { blockSize: 2, timeoutMinutes: 480 }
            });
            assert.equal(genRes.statusCode, 200, JSON.stringify(genRes.body));
            // Sem seed: numInspec rounds (2 chunks × 3 rounds = 6 blocos)
            assert.equal(genRes.body.rounds, 3);
            assert.equal(genRes.body.totalBlocks, 6);

            // REGRESSÃO DO INCIDENTE: antes da correção, o primeiro login
            // pulava todos os pontos (length 0 < round) e recebia finish.
            const first = await getCurrentPoint(app, campaignDoc, 'user1');
            assert.ok(first.point && first.point._id,
                'primeiro login deve receber um ponto real, não a tela finish: ' + JSON.stringify(first.point));
            assert.equal(first.block.inspectionRound, 1);
            await simulateSave(app, 'camp_peru', 'user1', first.point._id);

            // user1 completa o round 1; user2 e user3 completam os demais
            const savedU1 = await workUntilFinish(app, campaignDoc, 'user1', 30);
            const savedU2 = await workUntilFinish(app, campaignDoc, 'user2', 30);
            const savedU3 = await workUntilFinish(app, campaignDoc, 'user3', 30);
            assert.equal(savedU1.length + 1, 4, 'user1 deve salvar os 4 pontos do round 1');
            assert.equal(savedU2.length, 4, 'user2 deve salvar os 4 pontos do round 2');
            assert.equal(savedU3.length, 4, 'user3 deve salvar os 4 pontos do round 3');

            const finals = await points.find({ campaign: 'camp_peru' }).toArray();
            for (const p of finals) {
                assert.equal(p.userName.length, 3, 'ponto ' + p._id + ' deve ter 3 inspeções humanas');
                assert.deepEqual(new Set(p.userName).size, 3, 'inspetores distintos');
            }
            const zombies = await app.controllers.blocos.findZombiePointIds('camp_peru');
            assert.equal(zombies.length, 0, 'não deve restar nenhum ponto zumbi');
        });

        await t.test('campanha COM seed (cenário pastagem): rounds humanos e progressão preservados', async () => {
            const campaignDoc = { _id: 'camp_seed', numInspec: 3, initialYear: 2020, finalYear: 2022 };
            await campaigns.insertOne(campaignDoc);
            const pts = [1, 2, 3, 4].map((i) => makePoint('camp_seed', i, [AUTO]));
            await points.insertMany(pts);

            const genRes = await callHandler(app.controllers.blocos.generateBlocks, {
                params: { id: 'camp_seed' },
                body: { blockSize: 2, timeoutMinutes: 480 }
            });
            assert.equal(genRes.statusCode, 200, JSON.stringify(genRes.body));
            // Com seed: numInspec - 1 rounds humanos (elimina o round morto)
            assert.equal(genRes.body.rounds, 2);
            assert.equal(genRes.body.totalBlocks, 4);

            const first = await getCurrentPoint(app, campaignDoc, 'user1');
            assert.ok(first.point && first.point._id, 'round 1 deve servir ponto com seed (len 1)');
            assert.equal(first.block.inspectionRound, 1);
            await simulateSave(app, 'camp_seed', 'user1', first.point._id);

            const savedU1 = await workUntilFinish(app, campaignDoc, 'user1', 30);
            const savedU2 = await workUntilFinish(app, campaignDoc, 'user2', 30);
            assert.equal(savedU1.length + 1, 4);
            assert.equal(savedU2.length, 4);

            const finals = await points.find({ campaign: 'camp_seed' }).toArray();
            for (const p of finals) {
                assert.equal(p.userName.length, 3, 'seed + 2 humanos = numInspec');
                assert.equal(p.userName[0], AUTO);
            }
            const zombies = await app.controllers.blocos.findZombiePointIds('camp_seed');
            assert.equal(zombies.length, 0);
        });

        await t.test('recovery: inspectionRound = humanLen + 1 nos dois cenários', async () => {
            const campaignDoc = { _id: 'camp_rec', numInspec: 3, initialYear: 2020, finalYear: 2022 };
            await campaigns.insertOne(campaignDoc);
            // Zumbis: pontos pendentes presos em blocos completed
            await points.insertMany([
                makePoint('camp_rec', 1, []),              // virgem sem seed   → round 1
                makePoint('camp_rec', 2, [AUTO]),          // seed puro         → round 1
                makePoint('camp_rec', 3, [AUTO, 'ana'])    // seed + 1 humano   → round 2
            ]);
            await blocos.insertMany([{
                campaignId: 'camp_rec', blockIndex: 1, inspectionRound: 1,
                pointIds: ['camp_rec_1', 'camp_rec_2', 'camp_rec_3'],
                size: 3, status: 'completed', assignedTo: 'old-user',
                assignedAt: new Date(), completedAt: new Date(),
                currentPointOffset: 3, timeoutMinutes: 480, createdAt: new Date()
            }]);

            const zombies = await app.controllers.blocos.findZombiePointIds('camp_rec');
            assert.equal(zombies.length, 3);
            const byId = {};
            zombies.forEach((z) => { byId[z._id] = z; });
            assert.equal(byId['camp_rec_1'].humanLen, 0);
            assert.equal(byId['camp_rec_2'].humanLen, 0);
            assert.equal(byId['camp_rec_3'].humanLen, 1);

            const recRes = await callHandler(app.controllers.blocos.generateRecoveryBlocks, {
                params: { id: 'camp_rec' },
                body: { blockSize: 5 }
            });
            assert.equal(recRes.statusCode, 200, JSON.stringify(recRes.body));
            assert.equal(recRes.body.pointsRecovered, 3);

            const recovery = await blocos.find({ campaignId: 'camp_rec', isRecovery: true }).toArray();
            const roundOf = {};
            recovery.forEach((b) => {
                b.pointIds.forEach((pid) => { roundOf[pid] = b.inspectionRound; });
            });
            // ANTES DA CORREÇÃO: camp_rec_1 ganharia round 0 (inválido) e
            // camp_rec_2/3 rounds 1/2 por coincidência do seed.
            assert.equal(roundOf['camp_rec_1'], 1);
            assert.equal(roundOf['camp_rec_2'], 1);
            assert.equal(roundOf['camp_rec_3'], 2);

            // O bloco de recovery do ponto virgem deve efetivamente servi-lo
            const served = await getCurrentPoint(app, campaignDoc, 'rec-user');
            assert.ok(served.point && served.point._id, 'recovery deve servir ponto');
            assert.equal(served.block.inspectionRound, 1);
        });

        await t.test('modo legado: ponto com vaga única não é servido a dois usuários', async () => {
            const campaignDoc = { _id: 'camp_leg', numInspec: 3, initialYear: 2020, finalYear: 2022 };
            await campaigns.insertOne(campaignDoc);
            // Ponto X: 2 de 3 inspeções (1 vaga). Ponto Y: virgem.
            await points.insertMany([
                makePoint('camp_leg', 1, ['ana', 'bob']),
                makePoint('camp_leg', 2, [])
            ]);
            // Sem blocos → getCurrentPoint roteia para findPoint (legado)

            const r1 = await getCurrentPoint(app, campaignDoc, 'carl');
            assert.equal(r1.point._id, 'camp_leg_1', 'única vaga do ponto X vai para o 1º usuário');

            // ANTES DA CORREÇÃO: o filtro `underInspection < numInspec` ainda
            // serviria X a um 2º usuário (2 inspeções + 1 serve = 3 > vagas),
            // que perderia o trabalho com 409 POINT_ALREADY_FULL no save.
            const r2 = await getCurrentPoint(app, campaignDoc, 'dana');
            assert.equal(r2.point._id, 'camp_leg_2',
                'com a vaga de X ocupada por carl, dana deve receber o ponto Y');
        });

        await t.test('modo legado: ponto virgem continua aceitando numInspec serves simultâneos', async () => {
            const campaignDoc = { _id: 'camp_leg2', numInspec: 3, initialYear: 2020, finalYear: 2022 };
            await campaigns.insertOne(campaignDoc);
            await points.insertOne(makePoint('camp_leg2', 1, []));

            for (const u of ['u1', 'u2', 'u3']) {
                const r = await getCurrentPoint(app, campaignDoc, u);
                assert.equal(r.point._id, 'camp_leg2_1', u + ' deve receber o ponto (3 vagas)');
            }
            // 4º usuário: 0 inspeções + 3 serves em andamento = sem vaga
            const r4 = await getCurrentPoint(app, campaignDoc, 'u4');
            assert.ok(!r4.point._id, '4º serve simultâneo deve ser bloqueado');
        });

        await t.test('modo legado: underInspection negativo não reabre ponto completo', async () => {
            const campaignDoc = { _id: 'camp_leg3', numInspec: 3, initialYear: 2020, finalYear: 2022 };
            await campaigns.insertOne(campaignDoc);
            const full = makePoint('camp_leg3', 1, ['ana', 'bob', 'caio']);
            full.underInspection = -1; // documentos com ui=-1 observados em produção
            await points.insertOne(full);

            const r = await getCurrentPoint(app, campaignDoc, 'dana');
            assert.ok(!r.point._id, 'ponto completo não deve ser servido mesmo com ui negativo');
        });
    } finally {
        await new Promise((resolve) => db.dropDatabase(() => resolve()));
        db.close();
    }
});
