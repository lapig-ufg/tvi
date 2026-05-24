/**
 * Helpers puros de filtro do supervisor — extraídos do controller para
 * permitir teste isolado e reuso. Sem dependências de Express, Mongo ou
 * sessão. Espelhado parcialmente em src/client/controllers/supervisor.js
 * (apenas a constante NOT_CONSOLIDATED_TOKEN).
 */

'use strict';

// -------------------------------------------------------------------------
// Fallback case-insensitive para filtros de bioma/UF (TKT-000010).
//
// Antes da correção do pipeline de ingestão, GeoJSONs com chaves em caixa
// alta (BIOMA, UF, Estado, etc.) deixaram o campo top-level `biome`/`uf`
// como null. Os helpers abaixo constroem cláusulas `$or` sobre
// `properties.<variante>` para atender pontos legados sem exigir
// reimportação. Novos uploads já gravam o valor top-level normalizado.
// -------------------------------------------------------------------------
const BIOME_PROPERTY_KEYS = ['biome', 'Biome', 'BIOME', 'bioma', 'Bioma', 'BIOMA'];
const UF_PROPERTY_KEYS = [
    'uf', 'UF', 'Uf',
    'estado', 'Estado', 'ESTADO',
    'sigla_uf', 'SIGLA_UF', 'sigla_estado', 'SIGLA_ESTADO',
    'unidade_federacao', 'UNIDADE_FEDERACAO',
    'unidade_federativa', 'UNIDADE_FEDERATIVA'
];

function buildResolvedFieldExpression(topLevelField, propertyKeys) {
    // Monta um $ifNull aninhado que devolve o primeiro campo não nulo
    // entre o top-level e cada chave em properties.*.
    var expr = '$' + topLevelField;
    for (var i = 0; i < propertyKeys.length; i++) {
        expr = { $ifNull: [expr, '$properties.' + propertyKeys[i]] };
    }
    return expr;
}

function biomeOrClause(value) {
    return BIOME_PROPERTY_KEYS
        .map(function (k) { return { ['properties.' + k]: value }; })
        .concat([{ biome: value }]);
}

function ufOrClause(value) {
    return UF_PROPERTY_KEYS
        .map(function (k) { return { ['properties.' + k]: value }; })
        .concat([{ uf: value }]);
}

// -------------------------------------------------------------------------
// Filtro composto: classe de uso + status "não consolidado" são DUAS
// dimensões independentes, mas a UX antiga acoplava a string traduzida
// 'Não Consolidados' como se fosse uma classe — impossibilitava combinar
// (e.g. "Pastagem ainda não consolidada"). O cliente novo envia
// notConsolidatedOnly como boolean separado. Para tolerar cliente antigo
// (cache de bundle) ou idioma diferente de PT-BR, qualquer um dos dois
// sentinels chegando em landUse equivale a notConsolidatedOnly=true sem
// aplicar filtro por classe. Espelho client-side em
// src/client/controllers/supervisor.js (NOT_CONSOLIDATED_TOKEN).
// -------------------------------------------------------------------------
const NOT_CONSOLIDATED_TOKEN = '__NOT_CONSOLIDATED__';
const LEGACY_NOT_CONSOLIDATED_PT_BR = 'Não Consolidados';

function isNotConsolidatedSentinel(value) {
    return value === NOT_CONSOLIDATED_TOKEN || value === LEGACY_NOT_CONSOLIDATED_PT_BR;
}

function resolveFilterFlags(landUse, notConsolidatedOnly) {
    if (isNotConsolidatedSentinel(landUse)) {
        return { landUse: null, notConsolidatedOnly: true };
    }
    return { landUse: landUse || null, notConsolidatedOnly: !!notConsolidatedOnly };
}

module.exports = {
    BIOME_PROPERTY_KEYS,
    UF_PROPERTY_KEYS,
    buildResolvedFieldExpression,
    biomeOrClause,
    ufOrClause,
    NOT_CONSOLIDATED_TOKEN,
    LEGACY_NOT_CONSOLIDATED_PT_BR,
    isNotConsolidatedSentinel,
    resolveFilterFlags
};
