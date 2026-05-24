/**
 * Testes do módulo util/supervisorFilters.
 *
 * Cobertura:
 *   - Unit (sem Mongo): helpers puros — resolveFilterFlags, sentinels,
 *     biomeOrClause, ufOrClause, buildResolvedFieldExpression.
 *   - Integração (com Mongo): valida que as queries geradas pelos helpers
 *     filtram os pontos esperados — inclusive contra pontos legados que
 *     só têm bioma/uf em properties.<chave em caixa alta>, comportamento
 *     que motivou a reabertura do bug "Pastagem Natural não aparece em
 *     Mata Atlântica/Caatinga".
 *
 * Pré-requisito da integração:
 *   - MongoDB acessível (default: 127.0.0.1:27019, container `mongo-tvi`
 *     com mongo:4.4 — compatível com o driver legado `mongodb@2.2.36`).
 *   - Override via variável de ambiente TVI_TEST_MONGO_URL
 *     (e.g. "mongodb://localhost:27017"). Se a conexão falhar, os
 *     cenários de integração são pulados com `t.skip(...)` e os
 *     unit-tests continuam rodando.
 *
 * Execução:
 *   cd src/server && npm test
 *   ou
 *   node --test src/server/test/
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const filters = require('../util/supervisorFilters');
const {
    BIOME_PROPERTY_KEYS,
    UF_PROPERTY_KEYS,
    buildResolvedFieldExpression,
    biomeOrClause,
    ufOrClause,
    NOT_CONSOLIDATED_TOKEN,
    LEGACY_NOT_CONSOLIDATED_PT_BR,
    isNotConsolidatedSentinel,
    resolveFilterFlags
} = filters;

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

test('isNotConsolidatedSentinel reconhece token novo e string legada PT-BR', () => {
    assert.equal(isNotConsolidatedSentinel(NOT_CONSOLIDATED_TOKEN), true);
    assert.equal(isNotConsolidatedSentinel(LEGACY_NOT_CONSOLIDATED_PT_BR), true);
    assert.equal(isNotConsolidatedSentinel('Pastagem'), false);
    assert.equal(isNotConsolidatedSentinel(''), false);
    assert.equal(isNotConsolidatedSentinel(null), false);
    assert.equal(isNotConsolidatedSentinel(undefined), false);
    // Variantes próximas que NÃO devem casar:
    assert.equal(isNotConsolidatedSentinel('Não consolidados'), false, 'minúscula no meio não casa');
    assert.equal(isNotConsolidatedSentinel('Não Consolidado'), false, 'singular não casa');
    assert.equal(isNotConsolidatedSentinel('Not Consolidated'), false, 'tradução EN não é sentinel');
});

test('resolveFilterFlags: token novo desativa landUse e ativa flag', () => {
    const r = resolveFilterFlags(NOT_CONSOLIDATED_TOKEN, false);
    assert.deepEqual(r, { landUse: null, notConsolidatedOnly: true });
});

test('resolveFilterFlags: string legada PT-BR equivale ao token novo', () => {
    const r = resolveFilterFlags(LEGACY_NOT_CONSOLIDATED_PT_BR, false);
    assert.deepEqual(r, { landUse: null, notConsolidatedOnly: true });
});

test('resolveFilterFlags: classe real + flag explícito coexistem (filtro composto)', () => {
    const r = resolveFilterFlags('Pastagem', true);
    assert.deepEqual(r, { landUse: 'Pastagem', notConsolidatedOnly: true });
});

test('resolveFilterFlags: tudo vazio resulta em ambos falsy', () => {
    assert.deepEqual(resolveFilterFlags(null, false), { landUse: null, notConsolidatedOnly: false });
    assert.deepEqual(resolveFilterFlags(undefined, undefined), { landUse: null, notConsolidatedOnly: false });
    assert.deepEqual(resolveFilterFlags('', 0), { landUse: null, notConsolidatedOnly: false });
});

test('resolveFilterFlags: só checkbox (sem classe) também é válido', () => {
    assert.deepEqual(resolveFilterFlags(null, true), { landUse: null, notConsolidatedOnly: true });
    assert.deepEqual(resolveFilterFlags(undefined, 'true'), { landUse: null, notConsolidatedOnly: true });
});

test('biomeOrClause inclui top-level + todas as variantes de properties.*', () => {
    const clause = biomeOrClause('Mata Atlântica');
    // 6 chaves em properties + 1 top-level
    assert.equal(clause.length, BIOME_PROPERTY_KEYS.length + 1);
    assert.deepEqual(clause[clause.length - 1], { biome: 'Mata Atlântica' });
    assert.deepEqual(clause[0], { 'properties.biome': 'Mata Atlântica' });
    assert.deepEqual(clause[5], { 'properties.BIOMA': 'Mata Atlântica' });
});

test('ufOrClause inclui top-level + todas as variantes incluindo sigla_uf', () => {
    const clause = ufOrClause('GO');
    assert.equal(clause.length, UF_PROPERTY_KEYS.length + 1);
    assert.deepEqual(clause[clause.length - 1], { uf: 'GO' });
    // Algumas chaves obrigatórias:
    const flatKeys = clause.map(c => Object.keys(c)[0]);
    assert.ok(flatKeys.includes('properties.UF'));
    assert.ok(flatKeys.includes('properties.Estado'));
    assert.ok(flatKeys.includes('properties.SIGLA_UF'));
});

test('buildResolvedFieldExpression aninha $ifNull começando pelo top-level', () => {
    const expr = buildResolvedFieldExpression('biome', ['BIOMA', 'Bioma']);
    // $ifNull mais externo deve preferir 'properties.Bioma' (último)
    assert.equal(expr.$ifNull[1], '$properties.Bioma');
    // Penúltimo deve preferir 'properties.BIOMA'
    assert.equal(expr.$ifNull[0].$ifNull[1], '$properties.BIOMA');
    // O mais interno é o top-level
    assert.equal(expr.$ifNull[0].$ifNull[0], '$biome');
});

// ---------------------------------------------------------------------------
// Integração com MongoDB
// ---------------------------------------------------------------------------
//
// Conecta no Mongo de teste e prova que as queries geradas pelos helpers
// filtram exatamente os pontos esperados, incluindo pontos legados que só
// têm bioma/uf em properties.<variante>.
//
// A conexão é aberta UMA vez via `t.before` e o fixture (5 pontos) é
// recriado em cada teste via `t.beforeEach` para isolamento.

const TEST_DB = 'tvi_supervisor_filters_test';
const CAMPAIGN = 'campaign-test-1';

function getMongoConfig() {
    const url = process.env.TVI_TEST_MONGO_URL;
    if (url) {
        const match = url.match(/^mongodb:\/\/([^:/]+)(?::(\d+))?/);
        if (match) return { host: match[1], port: parseInt(match[2] || '27017', 10) };
    }
    // Default: container mongo-tvi (mongo:4.4) na porta 27019.
    return { host: process.env.TVI_TEST_MONGO_HOST || '127.0.0.1',
             port: parseInt(process.env.TVI_TEST_MONGO_PORT || '27019', 10) };
}

function fixtureDocs() {
    return [
        // p1: Mata Atlântica modernizado (biome top-level preenchido)
        {
            _id: 'p1', campaign: CAMPAIGN, index: 1,
            biome: 'Mata Atlântica', uf: 'SP', properties: {},
            inspection: [{ form: { landUse: 'Floresta' }, counter: 10 }],
            userName: ['ana'], classConsolidated: ['Floresta']
        },
        // p2: Mata Atlântica LEGADO (só properties.BIOMA, biome null)
        {
            _id: 'p2', campaign: CAMPAIGN, index: 2,
            biome: null, uf: null,
            properties: { BIOMA: 'Mata Atlântica', ESTADO: 'MG' },
            inspection: [{ form: { landUse: 'Pastagem Natural' }, counter: 20 }],
            userName: ['ana'], classConsolidated: ['Não consolidado']
        },
        // p3: Caatinga LEGADO (properties.Bioma + UF top-level)
        {
            _id: 'p3', campaign: CAMPAIGN, index: 3,
            biome: null, uf: null,
            properties: { Bioma: 'Caatinga', UF: 'BA' },
            inspection: [{ form: { landUse: 'Pastagem Natural' }, counter: 15 }],
            userName: ['bruno'], classConsolidated: ['Não consolidado']
        },
        // p4: Cerrado moderno, classe Pastagem, JÁ CONSOLIDADO
        {
            _id: 'p4', campaign: CAMPAIGN, index: 4,
            biome: 'Cerrado', uf: 'GO', properties: {},
            inspection: [{ form: { landUse: 'Pastagem' }, counter: 5 }],
            userName: ['ana'], classConsolidated: ['Pastagem']
        },
        // p5: Cerrado moderno, classe Pastagem, AINDA NÃO consolidado
        {
            _id: 'p5', campaign: CAMPAIGN, index: 5,
            biome: 'Cerrado', uf: 'GO', properties: {},
            inspection: [{ form: { landUse: 'Pastagem' }, counter: 8 }],
            userName: ['bruno'], classConsolidated: ['Não consolidado']
        }
    ];
}

// Tenta carregar o driver do node_modules do server. Se falhar, marca a
// integração inteira para skip.
let mongodb;
try {
    mongodb = require(path.join(__dirname, '..', 'node_modules', 'mongodb'));
} catch (e) {
    mongodb = null;
}

test('integração Mongo (queries de filtro)', { concurrency: false }, async (t) => {
    if (!mongodb) {
        t.skip('driver mongodb não encontrado em node_modules — pulando integração');
        return;
    }

    const cfg = getMongoConfig();
    const Db = mongodb.Db, Server = mongodb.Server;
    const db = new Db(TEST_DB, new Server(cfg.host, cfg.port, { auto_reconnect: true, pool_size: 2 }), { safe: true });

    // Abre conexão com timeout — falha rápida se Mongo não responder.
    const opened = await new Promise((resolve) => {
        let settled = false;
        const timer = setTimeout(() => { if (!settled) { settled = true; resolve(false); } }, 3000);
        db.open((err) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(!err);
        });
    });

    if (!opened) {
        t.skip(`Mongo em ${cfg.host}:${cfg.port} indisponível — pulando integração. ` +
               `Override com TVI_TEST_MONGO_URL (e.g. mongodb://localhost:27017).`);
        return;
    }

    const coll = db.collection('points');

    t.after(async () => {
        await new Promise(r => coll.deleteMany({}, r));
        db.close();
    });

    t.beforeEach(async () => {
        await new Promise(r => coll.deleteMany({}, r));
        await new Promise((resolve, reject) => {
            coll.insertMany(fixtureDocs(), (err) => err ? reject(err) : resolve());
        });
    });

    await t.test('BUG 2: landUseFilter com biome legado em properties.BIOMA traz "Pastagem Natural"', async () => {
        const filter = { campaign: CAMPAIGN, $or: biomeOrClause('Mata Atlântica') };
        const landUses = await new Promise((resolve, reject) => {
            coll.distinct('inspection.form.landUse', filter, (err, r) => err ? reject(err) : resolve(r));
        });
        assert.ok(landUses.includes('Pastagem Natural'),
            'esperava "Pastagem Natural" (do ponto p2, legado em properties.BIOMA), recebido: ' + JSON.stringify(landUses));
        assert.ok(landUses.includes('Floresta'),
            'esperava "Floresta" (do ponto p1, biome top-level)');
    });

    await t.test('BUG 2 contra-prova: padrão antigo (filter.biome direto) PERDE "Pastagem Natural"', async () => {
        // Demonstra empiricamente que sem o $or o bug existe.
        const filterAntigo = { campaign: CAMPAIGN, biome: 'Mata Atlântica' };
        const landUses = await new Promise((resolve, reject) => {
            coll.distinct('inspection.form.landUse', filterAntigo, (err, r) => err ? reject(err) : resolve(r));
        });
        assert.equal(landUses.includes('Pastagem Natural'), false,
            'padrão antigo NÃO deveria trazer Pastagem Natural (essa é a definição do bug)');
    });

    await t.test('BUG 2: Caatinga (properties.Bioma) também traz "Pastagem Natural"', async () => {
        const filter = { campaign: CAMPAIGN, $or: biomeOrClause('Caatinga') };
        const landUses = await new Promise((resolve, reject) => {
            coll.distinct('inspection.form.landUse', filter, (err, r) => err ? reject(err) : resolve(r));
        });
        assert.ok(landUses.includes('Pastagem Natural'));
    });

    await t.test('BUG 3b: filtro composto classe + notConsolidatedOnly retorna count exato', async () => {
        // Cerrado + classe=Pastagem + notConsolidatedOnly → apenas p5
        const composto = {
            campaign: CAMPAIGN,
            'inspection.form.landUse': 'Pastagem',
            classConsolidated: 'Não consolidado',
            $or: biomeOrClause('Cerrado')
        };
        const c1 = await new Promise((resolve, reject) => {
            coll.count(composto, (err, c) => err ? reject(err) : resolve(c));
        });
        assert.equal(c1, 1, 'esperava count=1 (apenas p5)');

        // Sem o checkbox: classe Pastagem em Cerrado → p4 + p5
        const soClasse = {
            campaign: CAMPAIGN,
            'inspection.form.landUse': 'Pastagem',
            $or: biomeOrClause('Cerrado')
        };
        const c2 = await new Promise((resolve, reject) => {
            coll.count(soClasse, (err, c) => err ? reject(err) : resolve(c));
        });
        assert.equal(c2, 2, 'esperava count=2 (p4 + p5)');
    });

    await t.test('Composição $and: biome legado + uf legada simultâneas', async () => {
        // Caatinga (properties.Bioma) + BA (properties.UF) → só p3
        const filter = {
            campaign: CAMPAIGN,
            $and: [
                { $or: ufOrClause('BA') },
                { $or: biomeOrClause('Caatinga') }
            ]
        };
        const docs = await new Promise((resolve, reject) => {
            coll.find(filter).toArray((err, r) => err ? reject(err) : resolve(r));
        });
        assert.equal(docs.length, 1);
        assert.equal(docs[0]._id, 'p3');
    });

    await t.test('BUG 1a fallback: cliente legado envia "Não Consolidados" como landUse', async () => {
        const resolved = resolveFilterFlags(LEGACY_NOT_CONSOLIDATED_PT_BR, false);
        const filter = { campaign: CAMPAIGN };
        if (resolved.landUse) filter['inspection.form.landUse'] = resolved.landUse;
        if (resolved.notConsolidatedOnly) filter.classConsolidated = 'Não consolidado';
        const count = await new Promise((resolve, reject) => {
            coll.count(filter, (err, c) => err ? reject(err) : resolve(c));
        });
        // p2, p3, p5 estão "Não consolidado"
        assert.equal(count, 3, 'esperava 3 pontos não consolidados via fallback legado');
    });

    await t.test('Token novo __NOT_CONSOLIDATED__ produz o mesmo resultado', async () => {
        const resolved = resolveFilterFlags(NOT_CONSOLIDATED_TOKEN, false);
        const filter = { campaign: CAMPAIGN };
        if (resolved.landUse) filter['inspection.form.landUse'] = resolved.landUse;
        if (resolved.notConsolidatedOnly) filter.classConsolidated = 'Não consolidado';
        const count = await new Promise((resolve, reject) => {
            coll.count(filter, (err, c) => err ? reject(err) : resolve(c));
        });
        assert.equal(count, 3);
    });
});
