/**
 * Testes do store de previews da feature de inspeções excedentes.
 *
 * Cobertura:
 *   - Integração (com Mongo): simula o cenário multi-processo que causava o
 *     erro "Preview expirado ou desconhecido" em produção — preview inserido
 *     por uma conexão (representa o worker A do cluster) e reivindicado por
 *     uma conexão DISTINTA (representa o worker B, ou outra réplica Swarm).
 *
 * Contexto:
 *   Antes de 2026-05-24 o `previewStore` em src/server/controllers/
 *   excessInspections.js era `new Map()` na memória do processo. Em deploy
 *   com `app-tvi-cluster.js` (Node cluster, múltiplos workers) e duas
 *   réplicas Swarm, requisições HTTP do mesmo usuário caíam em workers
 *   diferentes — `previewStore.get(previewId)` retornava `undefined` e o
 *   handler respondia 410. A migração para a coleção
 *   `excess_inspection_previews` corrige isto, no mesmo padrão usado para
 *   `destructive_tokens` em 2026-05-23.
 *
 * Pré-requisito da integração:
 *   - MongoDB acessível (default: 127.0.0.1:27019). Se a conexão falhar,
 *     os cenários são pulados com `t.skip(...)`.
 *
 * Execução:
 *   cd src/server && npm test
 *   ou
 *   node --test src/server/test/excessInspectionsPreviewStore.test.js
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const crypto = require('node:crypto');

const TEST_DB = 'tvi_excess_inspections_preview_test';
const COLLECTION = 'excess_inspection_previews';
const TTL_MS = 5 * 60 * 1000;

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

// Replica EXATAMENTE o que excessInspections.previewRemoval faz: gera id,
// monta o doc com TTL, persiste via insertOne. Recebe a coleção para que
// o teste possa usar uma conexão diferente da do claim (simulando processos
// distintos).
function buildPreviewDoc(campaignId, actions) {
    const previewId = crypto.randomBytes(16).toString('hex');
    const now = new Date();
    return {
        previewId: previewId,
        doc: {
            _id: previewId,
            campaignId: campaignId,
            actions: actions,
            rule: 'keepOldest',
            createdAt: now,
            expiresAt: new Date(now.getTime() + TTL_MS),
            used: false,
            usedAt: null,
            createdBy: 'test-admin'
        }
    };
}

function insertPreview(coll, doc) {
    return new Promise((resolve, reject) => {
        coll.insertOne(doc, (err) => err ? reject(err) : resolve());
    });
}

// Replica EXATAMENTE o claim atômico do applyRemoval. É a operação cuja
// quebra causava o bug original em ambiente multi-worker.
function claimPreview(coll, previewId) {
    return new Promise((resolve, reject) => {
        coll.findAndModify(
            { _id: previewId, used: false, expiresAt: { $gt: new Date() } },
            [],
            { $set: { used: true, usedAt: new Date() } },
            { new: true },
            (err, result) => err ? reject(err) : resolve(result && result.value)
        );
    });
}

function findRaw(coll, previewId) {
    return new Promise((resolve, reject) => {
        coll.findOne({ _id: previewId }, (err, doc) => err ? reject(err) : resolve(doc));
    });
}

test('store de preview de inspeções excedentes — Mongo multi-conexão', { concurrency: false }, async (t) => {
    if (!mongodb) {
        t.skip('driver mongodb não encontrado em node_modules — pulando integração');
        return;
    }

    // Abre DUAS conexões distintas contra o mesmo banco — representa dois
    // workers do cluster Node (ou duas réplicas Swarm). Cada conexão tem sua
    // própria pool de sockets, portanto qualquer estado "em memória do
    // processo" estaria isolado e invisível à outra. Se o teste passa, prova
    // que o substrato compartilhado (Mongo) faz a ponte corretamente.
    const dbA = openDb();
    const dbB = openDb();

    const okA = await openWithTimeout(dbA, 3000);
    const okB = okA && await openWithTimeout(dbB, 3000);

    if (!okA || !okB) {
        const cfg = getMongoConfig();
        t.skip(`Mongo em ${cfg.host}:${cfg.port} indisponível — pulando integração. ` +
               `Override com TVI_TEST_MONGO_URL (e.g. mongodb://localhost:27017).`);
        if (okA) dbA.close();
        return;
    }

    const collA = dbA.collection(COLLECTION);
    const collB = dbB.collection(COLLECTION);

    t.after(async () => {
        await new Promise(r => collA.deleteMany({}, r));
        dbA.close();
        dbB.close();
    });

    t.beforeEach(async () => {
        await new Promise(r => collA.deleteMany({}, r));
    });

    await t.test('cenário do bug: preview inserido em conexão A é reivindicado pela conexão B', async () => {
        // Antes da migração, este era o caminho que falhava: o /preview era
        // atendido pelo worker A, o /apply pelo worker B, e o Map em memória
        // do A não era visível para o B.
        const { previewId, doc } = buildPreviewDoc('campaign-peru', [
            { pointId: 'p1', toRemove: [{ inspectorName: 'alice' }] }
        ]);

        await insertPreview(collA, doc);

        const claimed = await claimPreview(collB, previewId);

        assert.ok(claimed, 'conexão B deve enxergar e reivindicar o preview inserido por A');
        assert.equal(claimed.campaignId, 'campaign-peru');
        assert.equal(claimed.used, true, 'claim deve marcar o doc como consumido');
        assert.ok(claimed.usedAt instanceof Date, 'usedAt deve ser preenchido');
        assert.equal(claimed.actions.length, 1);
    });

    await t.test('single-use: segundo claim do mesmo previewId retorna null', async () => {
        const { previewId, doc } = buildPreviewDoc('c1', []);
        await insertPreview(collA, doc);

        const first = await claimPreview(collA, previewId);
        assert.ok(first, 'primeiro claim deve suceder');

        const second = await claimPreview(collB, previewId);
        assert.equal(second, null, 'segundo claim deve falhar (single-use)');

        // O doc continua existindo (para discriminação da mensagem de erro),
        // mas com used: true.
        const raw = await findRaw(collA, previewId);
        assert.equal(raw.used, true);
    });

    await t.test('claim concorrente: apenas um vencedor sob N tentativas em paralelo', async () => {
        const { previewId, doc } = buildPreviewDoc('c1', [{ pointId: 'p1', toRemove: [] }]);
        await insertPreview(collA, doc);

        // Dispara 5 claims em paralelo a partir de conexões alternadas.
        const claims = await Promise.all([
            claimPreview(collA, previewId),
            claimPreview(collB, previewId),
            claimPreview(collA, previewId),
            claimPreview(collB, previewId),
            claimPreview(collA, previewId)
        ]);

        const winners = claims.filter(c => c !== null);
        assert.equal(winners.length, 1, 'exatamente um claim deve vencer; demais nulls');
    });

    await t.test('expirado: doc com expiresAt no passado não é reivindicado', async () => {
        const { previewId, doc } = buildPreviewDoc('c1', []);
        doc.expiresAt = new Date(Date.now() - 1000); // 1s no passado
        await insertPreview(collA, doc);

        const claimed = await claimPreview(collB, previewId);
        assert.equal(claimed, null, 'preview expirado não deve ser reivindicável');

        // O doc continua existindo até o TTL reaper do Mongo passar — o
        // controller usa findOne no caminho de erro para discriminar 'expired'.
        const raw = await findRaw(collA, previewId);
        assert.ok(raw, 'doc expirado ainda está fisicamente no banco até o TTL reaper');
        assert.equal(raw.used, false);
    });

    await t.test('id inexistente: claim de um previewId nunca emitido retorna null', async () => {
        const claimed = await claimPreview(collA, 'desconhecido-1234567890abcdef');
        assert.equal(claimed, null);

        const raw = await findRaw(collA, 'desconhecido-1234567890abcdef');
        assert.equal(raw, null, 'controller usa este findOne para distinguir not_found de already_used/expired');
    });
});
