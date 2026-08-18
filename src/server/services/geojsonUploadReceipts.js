/**
 * geojsonUploadReceipts — idempotência do upload de pontos por campanha.
 *
 * Motivação (incidente de 2026-08-17): o arquivo `val_prodes_to_2025_add.geojson`
 * (494 feições) foi enviado duas vezes para a campanha `val_prodes_to_2025`, com
 * dois minutos de intervalo, e ambos os envios reportaram `insertedCount: 494`.
 * O `processGeoJSONDirect` (controllers/campaign-crud.js) calcula
 * `counter = último index + 1` e insere sem qualquer verificação de reenvio,
 * de modo que o segundo upload duplica a base silenciosamente — sem erro para o
 * administrador e sem rastro além dos logs.
 *
 * Estratégia: cada upload reivindica (`claim`) um recibo ANTES de processar. O
 * recibo é identificado por `dedupeKey = campanha + hash SHA-256 do conteúdo`,
 * com índice ÚNICO no Mongo. O reenvio do mesmo arquivo colide no índice e é
 * recusado com o recibo original em mãos (quem enviou, quando, quantos pontos
 * entraram e em qual faixa de índices).
 *
 * Por que o claim vem ANTES do processamento: é isso que fecha a janela do duplo
 * clique. Duas requisições simultâneas podem cair em workers diferentes
 * (`app-tvi-cluster.js`, 2-10 workers) ou em réplicas diferentes; a segunda
 * colide enquanto a primeira ainda está com `status: 'processing'`. Uma
 * verificação do tipo "consultar e depois inserir" não cobriria esse caso.
 *
 * Por que no Mongo e não em memória: mesmo raciocínio que levou
 * `destructive_tokens` (2026-05-23) e `excess_inspection_previews` (2026-05-24)
 * a migrarem de `Map` para coleção — em deploy multi-processo, estado local é
 * invisível para os demais workers.
 *
 * Ciclo de vida do recibo:
 *   claim   → status 'processing'  (antes de inserir qualquer ponto)
 *   complete→ status 'completed'   (grava contadores e faixa de índices)
 *   release → recibo removido      (processamento falhou; libera novo envio)
 *
 * Retomada de recibo abandonado: se o worker morrer entre o claim e o
 * complete/release, o recibo ficaria em 'processing' para sempre e o arquivo
 * jamais poderia ser reenviado sem intervenção no banco. Passados
 * STALE_PROCESSING_MS, um novo claim reassume o recibo existente de forma
 * atômica. O prazo é maior que o timeout do painel (600s em
 * client/controllers/admin-modals.js), portanto não atropela upload em curso.
 */

'use strict';

var crypto = require('crypto');

var COLLECTION_NAME = 'geojson_upload_receipts';

// 15 minutos: acima do timeout de 10 minutos do upload no painel, de forma que
// um upload legítimo em andamento nunca seja reassumido por outra requisição.
var STALE_PROCESSING_MS = 15 * 60 * 1000;

var INDEXES = [
    // A garantia de idempotência. Toda a proteção contra duplicação depende
    // deste índice existir — sem ele, o claim vira um insert comum.
    { key: { dedupeKey: 1 }, name: 'dedupeKey_unique', unique: true },
    // Consulta de histórico de envios de uma campanha (auditoria).
    { key: { campaignId: 1, createdAt: -1 }, name: 'campaignId_createdAt' }
];

function hashContent(content) {
    return crypto.createHash('sha256').update(String(content), 'utf8').digest('hex');
}

function buildDedupeKey(campaignId, contentHash, force) {
    var base = campaignId + ':' + contentHash;
    if (!force) return base;
    // Reenvio deliberado: a chave precisa escapar do índice único, mas o recibo
    // preserva `contentHash` e `forced` para o histórico continuar legível.
    return base + ':force:' + Date.now().toString(36) + '-' + crypto.randomBytes(6).toString('hex');
}

function createStore(collection) {

    function buildReceipt(upload, dedupeKey, now) {
        return {
            _id: crypto.randomBytes(16).toString('hex'),
            dedupeKey: dedupeKey,
            campaignId: upload.campaignId,
            contentHash: upload.contentHash,
            filename: upload.filename || null,
            featuresCount: upload.featuresCount || 0,
            userId: upload.userId || null,
            sessionId: upload.sessionId || null,
            requestId: upload.requestId || null,
            forced: !!upload.force,
            status: 'processing',
            createdAt: now,
            completedAt: null,
            insertedCount: null,
            errorCount: null,
            firstIndex: null,
            lastIndex: null
        };
    }

    // Reassume um recibo 'processing' abandonado. findOneAndUpdate garante que,
    // sob N tentativas concorrentes, apenas uma encontre o documento ainda com
    // `createdAt` antigo — as demais já veem o createdAt renovado.
    async function takeOverStale(dedupeKey, upload, now) {
        var staleBefore = new Date(now.getTime() - STALE_PROCESSING_MS);
        var result = await collection.findOneAndUpdate(
            { dedupeKey: dedupeKey, status: 'processing', createdAt: { $lte: staleBefore } },
            { $set: {
                createdAt: now,
                tookOverAt: now,
                filename: upload.filename || null,
                featuresCount: upload.featuresCount || 0,
                userId: upload.userId || null,
                sessionId: upload.sessionId || null,
                requestId: upload.requestId || null
            } },
            { returnOriginal: false }
        );
        return (result && result.value) || null;
    }

    return {
        /**
         * Reivindica o direito de processar este arquivo nesta campanha.
         *
         * @returns {Promise<{claimed: true, receipt: Object, tookOver?: boolean}
         *                  |{claimed: false, existing: Object|null}>}
         */
        claim: async function (upload) {
            var now = new Date();
            var dedupeKey = buildDedupeKey(upload.campaignId, upload.contentHash, upload.force);
            var receipt = buildReceipt(upload, dedupeKey, now);

            try {
                await collection.insertOne(receipt);
                return { claimed: true, receipt: receipt };
            } catch (err) {
                if (!err || err.code !== 11000) throw err;

                var reclaimed = await takeOverStale(dedupeKey, upload, now);
                if (reclaimed) return { claimed: true, receipt: reclaimed, tookOver: true };

                // `existing` pode ser null se o recibo tiver sido liberado por
                // release() entre o insert e esta leitura — corrida rara e
                // benigna: o administrador reenvia e o próximo claim vence.
                var existing = await collection.findOne({ dedupeKey: dedupeKey });
                return { claimed: false, existing: existing || null };
            }
        },

        /** Marca o recibo como concluído, com o resultado do processamento. */
        complete: async function (receiptId, result) {
            result = result || {};
            await collection.updateOne(
                { _id: receiptId },
                { $set: {
                    status: 'completed',
                    completedAt: new Date(),
                    insertedCount: result.insertedCount != null ? result.insertedCount : null,
                    errorCount: result.errorCount != null ? result.errorCount : null,
                    firstIndex: result.firstIndex != null ? result.firstIndex : null,
                    lastIndex: result.lastIndex != null ? result.lastIndex : null
                } }
            );
        },

        /**
         * Remove o recibo — usado quando o processamento falha. Sem isto, um
         * upload que quebrou no meio bloquearia o reenvio do arquivo corrigido.
         */
        release: async function (receiptId) {
            await collection.deleteOne({ _id: receiptId });
        }
    };
}

module.exports = {
    COLLECTION_NAME: COLLECTION_NAME,
    STALE_PROCESSING_MS: STALE_PROCESSING_MS,
    INDEXES: INDEXES,
    hashContent: hashContent,
    buildDedupeKey: buildDedupeKey,
    createStore: createStore
};
