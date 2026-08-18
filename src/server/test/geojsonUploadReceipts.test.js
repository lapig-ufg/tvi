/**
 * Testes do store de recibos de upload de GeoJSON (idempotência do
 * /api/campaigns/upload-geojson).
 *
 * Contexto:
 *   Em 2026-08-17 o arquivo `val_prodes_to_2025_add.geojson` (494 feições) foi
 *   enviado duas vezes para a campanha `val_prodes_to_2025`, com dois minutos
 *   de intervalo, e ambos os uploads reportaram `insertedCount: 494`. O
 *   `processGeoJSONDirect` não tem nenhuma verificação de reenvio: calcula
 *   `counter = último index + 1` e insere, de modo que o segundo envio
 *   duplicaria a base silenciosamente.
 *
 *   O guard precisa viver no MongoDB, e não em memória: a aplicação roda em
 *   cluster (`app-tvi-cluster.js`, 2-10 workers) e pode rodar multi-réplica,
 *   portanto duas requisições do mesmo usuário caem em processos distintos.
 *   Mesmo padrão adotado em `destructive_tokens` (2026-05-23) e
 *   `excess_inspection_previews` (2026-05-24).
 *
 * Pré-requisito da integração:
 *   - MongoDB acessível (default: 127.0.0.1:27019). Se a conexão falhar,
 *     os cenários são pulados com `t.skip(...)`.
 *
 * Execução:
 *   cd src/server && npm test
 *   ou
 *   node --test src/server/test/geojsonUploadReceipts.test.js
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const receipts = require(path.join(__dirname, '..', 'services', 'geojsonUploadReceipts'));

const TEST_DB = 'tvi_geojson_upload_receipts_test';

const GEOJSON_A = JSON.stringify({
    type: 'FeatureCollection',
    features: [
        { type: 'Feature', geometry: { type: 'Point', coordinates: [-47.79, -9.30] }, properties: { id: 1 } },
        { type: 'Feature', geometry: { type: 'Point', coordinates: [-48.06, -6.20] }, properties: { id: 2 } }
    ]
});

const GEOJSON_B = JSON.stringify({
    type: 'FeatureCollection',
    features: [
        { type: 'Feature', geometry: { type: 'Point', coordinates: [-50.11, -12.44] }, properties: { id: 1 } }
    ]
});

// --------------------------------------------------------------------------
// Unidade — hash e chave de deduplicação (sem Mongo)
// --------------------------------------------------------------------------

test('hashContent: mesmo conteúdo produz o mesmo hash', () => {
    assert.equal(receipts.hashContent(GEOJSON_A), receipts.hashContent(GEOJSON_A));
});

test('hashContent: conteúdos diferentes produzem hashes diferentes', () => {
    assert.notEqual(receipts.hashContent(GEOJSON_A), receipts.hashContent(GEOJSON_B));
});

test('hashContent: retorna sha256 em hexadecimal', () => {
    assert.match(receipts.hashContent(GEOJSON_A), /^[0-9a-f]{64}$/);
});

test('buildDedupeKey: sem force é estável e inclui campanha e hash', () => {
    const hash = receipts.hashContent(GEOJSON_A);
    const first = receipts.buildDedupeKey('camp1', hash, false);
    const second = receipts.buildDedupeKey('camp1', hash, false);

    assert.equal(first, second, 'a chave normal precisa ser determinística — é ela que colide no índice único');
    assert.ok(first.indexOf('camp1') === 0, 'a chave deve ser prefixada pela campanha');
    assert.ok(first.indexOf(hash) > 0, 'a chave deve conter o hash do conteúdo');
});

test('buildDedupeKey: campanhas distintas não colidem para o mesmo arquivo', () => {
    const hash = receipts.hashContent(GEOJSON_A);
    assert.notEqual(receipts.buildDedupeKey('camp1', hash, false), receipts.buildDedupeKey('camp2', hash, false));
});

test('buildDedupeKey: com force gera chave distinta a cada chamada', () => {
    const hash = receipts.hashContent(GEOJSON_A);
    const first = receipts.buildDedupeKey('camp1', hash, true);
    const second = receipts.buildDedupeKey('camp1', hash, true);

    assert.notEqual(first, second, 'reenvio forçado precisa escapar do índice único');
    assert.notEqual(first, receipts.buildDedupeKey('camp1', hash, false));
});

test('COLLECTION_NAME e INDEXES são exportados para o repository registrar', () => {
    assert.equal(receipts.COLLECTION_NAME, 'geojson_upload_receipts');
    const unique = receipts.INDEXES.filter(ix => ix.key && ix.key.dedupeKey && ix.unique === true);
    assert.equal(unique.length, 1, 'a garantia de idempotência é o índice único sobre dedupeKey');
});

// --------------------------------------------------------------------------
// Integração — claim/complete/release contra Mongo, em conexões distintas
// --------------------------------------------------------------------------

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

function createIndexes(coll) {
    return new Promise((resolve, reject) => {
        coll.createIndexes(receipts.INDEXES, (err) => err ? reject(err) : resolve());
    });
}

function uploadOf(campaignId, content, extra) {
    return Object.assign({
        campaignId: campaignId,
        contentHash: receipts.hashContent(content),
        filename: 'val_prodes_to_2025_add.geojson',
        featuresCount: 494,
        userId: '68769a6810641054b351e59e',
        sessionId: 'WkKSPWttF_xIXi_V66RDGk5PnD3B1_MR',
        requestId: 'req_test'
    }, extra || {});
}

test('store de recibos de upload GeoJSON — Mongo multi-conexão', { concurrency: false }, async (t) => {
    if (!mongodb) {
        t.skip('driver mongodb não encontrado em node_modules — pulando integração');
        return;
    }

    // Duas conexões distintas contra o mesmo banco representam dois workers do
    // cluster Node. Qualquer estado "em memória do processo" estaria isolado
    // entre elas; se o bloqueio funciona de A para B, funciona em produção.
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

    const collA = dbA.collection(receipts.COLLECTION_NAME);
    const collB = dbB.collection(receipts.COLLECTION_NAME);
    await createIndexes(collA);

    const storeA = receipts.createStore(collA);
    const storeB = receipts.createStore(collB);

    t.after(async () => {
        await new Promise(r => collA.deleteMany({}, r));
        dbA.close();
        dbB.close();
    });

    t.beforeEach(async () => {
        await new Promise(r => collA.deleteMany({}, r));
    });

    await t.test('cenário do incidente: reenvio do mesmo arquivo pela conexão B é recusado', async () => {
        const upload = uploadOf('val_prodes_to_2025', GEOJSON_A);

        const first = await storeA.claim(upload);
        assert.equal(first.claimed, true, 'o primeiro envio deve ser aceito');
        assert.equal(first.receipt.status, 'processing');

        const second = await storeB.claim(upload);
        assert.equal(second.claimed, false, 'o reenvio do mesmo arquivo deve ser recusado');
        assert.equal(second.existing._id, first.receipt._id, 'a recusa deve devolver o recibo original');
        assert.equal(second.existing.filename, 'val_prodes_to_2025_add.geojson');
        assert.equal(second.existing.featuresCount, 494);
    });

    await t.test('duplo clique: sob claims concorrentes existe exatamente um vencedor', async () => {
        const upload = uploadOf('val_prodes_to_2025', GEOJSON_A);

        const results = await Promise.all([
            storeA.claim(upload),
            storeB.claim(upload),
            storeA.claim(upload),
            storeB.claim(upload),
            storeA.claim(upload)
        ]);

        assert.equal(results.filter(r => r.claimed).length, 1, 'apenas um envio pode processar');
        assert.equal(results.filter(r => !r.claimed).length, 4);
    });

    await t.test('complete registra o resultado e a recusa posterior o expõe', async () => {
        const upload = uploadOf('val_prodes_to_2025', GEOJSON_A);
        const first = await storeA.claim(upload);

        await storeA.complete(first.receipt._id, {
            insertedCount: 494,
            errorCount: 0,
            firstIndex: 1001,
            lastIndex: 1494
        });

        const blocked = await storeB.claim(upload);
        assert.equal(blocked.claimed, false);
        assert.equal(blocked.existing.status, 'completed');
        assert.equal(blocked.existing.insertedCount, 494);
        assert.equal(blocked.existing.firstIndex, 1001);
        assert.equal(blocked.existing.lastIndex, 1494);
        assert.ok(blocked.existing.completedAt instanceof Date, 'completedAt alimenta a mensagem de erro no painel');
    });

    await t.test('release libera novo envio após falha no processamento', async () => {
        const upload = uploadOf('val_prodes_to_2025', GEOJSON_A);
        const first = await storeA.claim(upload);

        await storeA.release(first.receipt._id);

        const retry = await storeB.claim(upload);
        assert.equal(retry.claimed, true, 'após falha, o mesmo arquivo precisa poder ser reenviado');
    });

    await t.test('force permite reenvio deliberado de um arquivo já processado', async () => {
        const upload = uploadOf('val_prodes_to_2025', GEOJSON_A);
        const first = await storeA.claim(upload);
        await storeA.complete(first.receipt._id, { insertedCount: 494, errorCount: 0, firstIndex: 1001, lastIndex: 1494 });

        assert.equal((await storeB.claim(upload)).claimed, false);

        const forced = await storeB.claim(Object.assign({}, upload, { force: true }));
        assert.equal(forced.claimed, true, 'force deve escapar do bloqueio');
        assert.equal(forced.receipt.forced, true, 'o recibo forçado precisa ficar marcado para auditoria');
        assert.notEqual(forced.receipt._id, first.receipt._id, 'o histórico dos dois envios é preservado');
    });

    await t.test('o mesmo arquivo em campanhas distintas não é bloqueado', async () => {
        const first = await storeA.claim(uploadOf('val_prodes_to_2025', GEOJSON_A));
        const other = await storeB.claim(uploadOf('mapbiomas_peru_col4_region1', GEOJSON_A));

        assert.equal(first.claimed, true);
        assert.equal(other.claimed, true, 'a chave é por campanha — arquivos iguais em campanhas diferentes são legítimos');
    });

    await t.test('arquivo diferente na mesma campanha não é bloqueado', async () => {
        await storeA.claim(uploadOf('val_prodes_to_2025', GEOJSON_A));
        const other = await storeB.claim(uploadOf('val_prodes_to_2025', GEOJSON_B));

        assert.equal(other.claimed, true);
    });

    await t.test('processing abandonado por queda do worker é reassumido após o prazo', async () => {
        const upload = uploadOf('val_prodes_to_2025', GEOJSON_A);
        const first = await storeA.claim(upload);

        // Simula o worker morto no meio do processamento: o recibo ficou em
        // 'processing' e nunca recebeu complete nem release. Sem a retomada,
        // o arquivo ficaria bloqueado para sempre sem intervenção no banco.
        const abandoned = new Date(Date.now() - (receipts.STALE_PROCESSING_MS + 60 * 1000));
        await new Promise(r => collA.updateOne({ _id: first.receipt._id }, { $set: { createdAt: abandoned } }, r));

        const retry = await storeB.claim(upload);
        assert.equal(retry.claimed, true, 'recibo abandonado deve ser reassumido');
        assert.equal(retry.receipt._id, first.receipt._id, 'a retomada reaproveita o recibo, sem duplicar histórico');
        assert.equal(retry.tookOver, true);
    });

    await t.test('processing recente NÃO é reassumido', async () => {
        const upload = uploadOf('val_prodes_to_2025', GEOJSON_A);
        await storeA.claim(upload);

        const retry = await storeB.claim(upload);
        assert.equal(retry.claimed, false, 'upload em andamento legítimo não pode ser atropelado');
    });

    await t.test('retomada concorrente de recibo abandonado tem um único vencedor', async () => {
        const upload = uploadOf('val_prodes_to_2025', GEOJSON_A);
        const first = await storeA.claim(upload);

        const abandoned = new Date(Date.now() - (receipts.STALE_PROCESSING_MS + 60 * 1000));
        await new Promise(r => collA.updateOne({ _id: first.receipt._id }, { $set: { createdAt: abandoned } }, r));

        const results = await Promise.all([
            storeA.claim(upload),
            storeB.claim(upload),
            storeA.claim(upload)
        ]);

        assert.equal(results.filter(r => r.claimed).length, 1, 'a retomada precisa ser atômica');
    });
});