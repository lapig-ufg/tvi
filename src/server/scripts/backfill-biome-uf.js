/*
 * backfill-biome-uf.js (TKT-000010)
 * ============================================================================
 * Script idempotente para normalizar os campos top-level `biome` e `uf` da
 * coleção `points` a partir de variantes em `properties.*`.
 *
 * Motivação
 * ---------
 * Antes da correção do pipeline de ingestão, GeoJSONs com chaves em caixa
 * diferente (BIOMA, UF, Estado, etc.) deixaram o campo top-level nulo.
 * Este script promove os valores de `properties.<variante>` para o top-level,
 * permitindo que os filtros existentes voltem a funcionar sem depender da
 * agregação de fallback.
 *
 * Execução (manual — NÃO executar em runtime)
 * ----------------------------------------------------------------------------
 *   # Opção 1: mongo shell diretamente no container/servidor
 *   mongo --host <host> --port <port> <dbname> \
 *     src/server/scripts/backfill-biome-uf.js
 *
 *   # Opção 2: via mongosh (driver moderno)
 *   mongosh "mongodb://<host>:<port>/<dbname>" \
 *     --file src/server/scripts/backfill-biome-uf.js
 *
 *   # Opção 3 (escopado por campanha, quando desejado):
 *   mongosh "..." --eval "var CAMPAIGN_ID='mapbiomas_pastagem_col11'" \
 *     --file src/server/scripts/backfill-biome-uf.js
 *
 * Segurança e idempotência
 * ----------------------------------------------------------------------------
 * - Só escreve no documento quando o campo top-level estiver faltando OU for
 *   null/''. Documentos já preenchidos não são tocados.
 * - Percorre as variantes em ordem; a primeira correspondência válida vence.
 * - Executar mais de uma vez é seguro: nenhuma mutação adicional ocorre após
 *   a primeira passagem bem-sucedida.
 * - Loga totais: inspecionados, atualizados e sem match.
 *
 * NOTA: este arquivo NÃO deve ser require'd pelo servidor. É consumido apenas
 * pelo shell do MongoDB ou por um operador executando manualmente.
 * ============================================================================
 */

(function () {
    'use strict';

    var BIOME_KEYS = ['biome', 'Biome', 'BIOME', 'bioma', 'Bioma', 'BIOMA'];
    var UF_KEYS = [
        'uf', 'UF', 'Uf',
        'estado', 'Estado', 'ESTADO',
        'sigla_uf', 'SIGLA_UF', 'sigla_estado', 'SIGLA_ESTADO',
        'unidade_federacao', 'UNIDADE_FEDERACAO',
        'unidade_federativa', 'UNIDADE_FEDERATIVA'
    ];

    function pickFromProperties(properties, candidates) {
        if (!properties) return null;
        for (var i = 0; i < candidates.length; i++) {
            var key = candidates[i];
            if (!Object.prototype.hasOwnProperty.call(properties, key)) continue;
            var value = properties[key];
            if (value === null || typeof value === 'undefined') continue;
            if (typeof value === 'string') {
                var trimmed = value.trim();
                if (trimmed === '') continue;
                return trimmed;
            }
            return value;
        }
        return null;
    }

    var matchMissingTopLevel = {
        $or: [
            { biome: null },
            { biome: '' },
            { biome: { $exists: false } },
            { uf: null },
            { uf: '' },
            { uf: { $exists: false } }
        ]
    };

    // Aceita escopo por campanha via variável global CAMPAIGN_ID (opcional).
    // No mongosh: --eval "var CAMPAIGN_ID='mapbiomas_pastagem_col11'"
    if (typeof CAMPAIGN_ID !== 'undefined' && CAMPAIGN_ID) {
        matchMissingTopLevel.campaign = CAMPAIGN_ID;
        print('[backfill-biome-uf] Escopo: campaign = ' + CAMPAIGN_ID);
    } else {
        print('[backfill-biome-uf] Escopo: TODAS as campanhas');
    }

    var cursor = db.points.find(matchMissingTopLevel, {
        _id: 1, biome: 1, uf: 1, properties: 1
    });

    var inspected = 0;
    var updated = 0;
    var noMatch = 0;

    cursor.forEach(function (doc) {
        inspected++;
        var setPayload = {};

        var needsBiome = doc.biome === null
            || typeof doc.biome === 'undefined'
            || doc.biome === '';
        var needsUf = doc.uf === null
            || typeof doc.uf === 'undefined'
            || doc.uf === '';

        if (needsBiome) {
            var resolvedBiome = pickFromProperties(doc.properties, BIOME_KEYS);
            if (resolvedBiome !== null) setPayload.biome = resolvedBiome;
        }
        if (needsUf) {
            var resolvedUf = pickFromProperties(doc.properties, UF_KEYS);
            if (resolvedUf !== null) setPayload.uf = resolvedUf;
        }

        if (Object.keys(setPayload).length === 0) {
            noMatch++;
            return;
        }

        db.points.updateOne({ _id: doc._id }, { $set: setPayload });
        updated++;
    });

    print('[backfill-biome-uf] Inspecionados: ' + inspected);
    print('[backfill-biome-uf] Atualizados: ' + updated);
    print('[backfill-biome-uf] Sem match em properties.*: ' + noMatch);
    print('[backfill-biome-uf] Concluído.');
})();
