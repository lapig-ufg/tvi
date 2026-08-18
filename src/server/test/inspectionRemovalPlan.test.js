/**
 * Testes do módulo util/inspectionRemovalPlan.
 *
 * Este módulo é a única fonte de verdade da aba "Remover Inspeções" do
 * gerenciador de campanhas: a pré-visualização (dryRun) e a execução usam o
 * mesmo plano, de modo que o administrador remova exatamente o que viu.
 *
 * Roda sem Mongo: `cd src/server && npm test`.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    TIPOS_SUPORTADOS,
    normalizeCriteria,
    buildCandidateFilter,
    buildRemovalPlan,
    buildPreviewRows
} = require('../util/inspectionRemovalPlan');

// --------------------------------------------------------------------------
// normalizeCriteria
// --------------------------------------------------------------------------

test('normalizeCriteria aceita os três tipos suportados', () => {
    assert.deepEqual(normalizeCriteria({ type: 'by_user', user: ' ana ' }), { type: 'by_user', user: 'ana' });
    assert.deepEqual(normalizeCriteria({ type: 'by_point', pointId: ' p1 ' }), { type: 'by_point', pointId: 'p1' });
    assert.deepEqual(normalizeCriteria({ type: 'incomplete_only' }), { type: 'incomplete_only' });
    assert.deepEqual(TIPOS_SUPORTADOS, ['by_user', 'by_point', 'incomplete_only']);
});

test('normalizeCriteria rejeita tipo desconhecido com status 400', () => {
    // Os valores antigos do template ('user', 'point', 'date') não existiam no
    // servidor; a divergência é justamente o que este teste trava.
    ['user', 'point', 'date', '', undefined].forEach(function (tipo) {
        assert.throws(
            () => normalizeCriteria({ type: tipo }),
            (err) => err.status === 400,
            'tipo ' + String(tipo) + ' deveria ser rejeitado'
        );
    });
});

test('normalizeCriteria exige o parâmetro específico de cada tipo', () => {
    assert.throws(() => normalizeCriteria({ type: 'by_user' }), (err) => err.status === 400);
    assert.throws(() => normalizeCriteria({ type: 'by_user', user: '   ' }), (err) => err.status === 400);
    assert.throws(() => normalizeCriteria({ type: 'by_point' }), (err) => err.status === 400);
    assert.throws(() => normalizeCriteria(null), (err) => err.status === 400);
});

// --------------------------------------------------------------------------
// buildCandidateFilter
// --------------------------------------------------------------------------

test('buildCandidateFilter restringe sempre à campanha informada', () => {
    const porUsuario = buildCandidateFilter('camp-1', { type: 'by_user', user: 'ana' }, 3);
    assert.equal(porUsuario.campaign, 'camp-1');
    assert.equal(porUsuario.userName, 'ana');

    const porPonto = buildCandidateFilter('camp-1', { type: 'by_point', pointId: 'p1' }, 3);
    assert.equal(porPonto.campaign, 'camp-1');
    assert.equal(porPonto._id, 'p1');
});

test('buildCandidateFilter de incompletos compara a contagem dentro do banco', () => {
    const filtro = buildCandidateFilter('camp-1', { type: 'incomplete_only' }, 3);
    assert.equal(filtro.campaign, 'camp-1');
    assert.deepEqual(filtro['userName.0'], { $exists: true });
    // O $expr cobre documentos legados sem userNameCount via $size.
    assert.ok(filtro.$expr && filtro.$expr.$lt);
    assert.equal(filtro.$expr.$lt[1], 3);
});

// --------------------------------------------------------------------------
// buildRemovalPlan
// --------------------------------------------------------------------------

const PONTOS = [
    { _id: 'p1', userName: ['ana', 'bruno'] },
    { _id: 'p2', userName: ['ana'] },
    { _id: 'p3', userName: [] },
    { _id: 'p4', userName: ['carla', 'bruno', 'ana'] }
];

test('by_user remove somente o inspetor indicado, preservando os demais', () => {
    const plan = buildRemovalPlan(PONTOS, { type: 'by_user', user: 'ana' }, 3);

    assert.equal(plan.pointsAffected, 3);
    assert.equal(plan.inspectionsAffected, 3);
    plan.actions.forEach(function (acao) {
        assert.equal(acao.operation, 'remove_inspector');
        assert.equal(acao.inspector, 'ana');
    });
    assert.deepEqual(plan.actions.map(a => a.pointId), ['p1', 'p2', 'p4']);
});

test('by_user ignora pontos em que o inspetor não consta', () => {
    const plan = buildRemovalPlan(PONTOS, { type: 'by_user', user: 'carla' }, 3);
    assert.deepEqual(plan.actions.map(a => a.pointId), ['p4']);
    assert.equal(plan.inspectionsAffected, 1);
});

test('by_point limpa todas as inspeções do ponto', () => {
    const plan = buildRemovalPlan([PONTOS[0]], { type: 'by_point', pointId: 'p1' }, 3);
    assert.equal(plan.actions.length, 1);
    assert.equal(plan.actions[0].operation, 'clear_inspections');
    assert.deepEqual(plan.actions[0].inspectors, ['ana', 'bruno']);
    assert.equal(plan.inspectionsAffected, 2);
});

test('incomplete_only ignora pontos que já atingiram numInspec', () => {
    const plan = buildRemovalPlan(PONTOS, { type: 'incomplete_only' }, 3);
    // p4 tem 3 de 3 → completo; p3 não tem inspeção → nada a remover.
    assert.deepEqual(plan.actions.map(a => a.pointId), ['p1', 'p2']);
    assert.equal(plan.inspectionsAffected, 3);
});

test('pontos sem inspeção nunca entram no plano', () => {
    const plan = buildRemovalPlan([{ _id: 'px', userName: [] }, { _id: 'py' }], { type: 'by_point' }, 3);
    assert.deepEqual(plan.actions, []);
    assert.equal(plan.pointsAffected, 0);
    assert.equal(plan.inspectionsAffected, 0);
});

// --------------------------------------------------------------------------
// buildPreviewRows
// --------------------------------------------------------------------------

test('buildPreviewRows gera uma linha por inspeção a ser removida', () => {
    const plan = buildRemovalPlan(PONTOS, { type: 'incomplete_only' }, 3);
    const linhas = buildPreviewRows(plan);

    assert.equal(linhas.length, plan.inspectionsAffected);
    assert.deepEqual(linhas[0], { pointId: 'p1', user: 'ana', operation: 'clear_inspections' });
    assert.deepEqual(linhas[2], { pointId: 'p2', user: 'ana', operation: 'clear_inspections' });
});
