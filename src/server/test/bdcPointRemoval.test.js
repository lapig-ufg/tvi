'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { collection, campaign, point, ready } = require('./helpers/bdcFixtures');
const { create } = require('../services/bdcSelectionService');

function selections() {
    const store = collection();
    store.deleteMany = async query => {
        for (const [id, value] of store.docs) {
            if (value.pointId === query.pointId && value.campaignId === query.campaignId) store.docs.delete(id);
        }
    };
    return store;
}

test('seleção BDC não inicia para ponto bloqueado para exclusão', async () => {
    const refs = selections();
    const points = collection([{ ...point, pointMutationLock: 'operation' }]);
    const service = create(refs, { createJob() { throw new Error('Consulta externa indevida'); } }, points);
    await assert.rejects(service.resolve(campaign, point, 2020, 'DRY', true), { status: 409 });
    assert.equal(refs.docs.size, 0);
});

test('resposta BDC após exclusão do ponto não deixa referência ativa', async () => {
    const refs = selections();
    const points = collection([point]);
    const service = create(refs, { async createJob() { points.docs.delete(point._id); return ready(); } }, points);
    await assert.rejects(service.resolve(campaign, point, 2020, 'DRY', true), { status: 404 });
    assert.equal(refs.docs.size, 0);
});

test('bloqueio temporário preserva referências históricas já existentes', async () => {
    const refs = selections();
    const points = collection([point]);
    const service = create(refs, { async createJob() {
        points.docs.get(point._id).pointMutationLock = 'operation';
        return ready();
    } }, points);
    await assert.rejects(service.resolve(campaign, point, 2020, 'DRY', true), { status: 409 });
    assert.equal(refs.docs.size, 1);
});
