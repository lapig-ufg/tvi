'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const createService = require('../services/pointsService');
const createBlocks = require('../controllers/blocos');
const { buildFindPointFilter } = require('../controllers/points');

const context = { actor: { username: 'ana' }, maxUserNameLength: 3 };

function serviceWithResult(result) {
    const state = { audits: [], filter: null };
    const point = { _id: 'p1', campaign: 'c1', userName: [], inspection: [] };
    const service = createService({ repository: { collections: {
        points: {
            findOne: async () => point,
            updateOne: async filter => { state.filter = filter; return result; }
        },
        points_audit: { insertOne: async audit => state.audits.push(audit) }
    } }, services: {} });
    return { service, state };
}

test('distribuição exclui pontos bloqueados sem retirar a condição de capacidade', () => {
    const filter = buildFindPointFilter({ _id: 'c1', numInspec: 3 }, 'ana');
    assert.deepEqual(filter.$and.find(item => item.pointMutationLock), { pointMutationLock: { $exists: false } });
    assert.ok(filter.$and.some(item => item.$expr));
});

for (const result of [{ matchedCount: 0 }, { result: { n: 0 } }]) {
    test('inspeção não registra sucesso quando o ponto deixa de aceitar alterações: ' + JSON.stringify(result), async () => {
        const { service, state } = serviceWithResult(result);
        await assert.rejects(service.appendInspection('p1', 'ana', { form: [] }, context), { code: 'POINT_UNAVAILABLE' });
        assert.deepEqual(state.filter, { _id: 'p1', pointMutationLock: { $exists: false } });
        assert.equal(state.audits.length, 0);
    });
}

test('inspeção aceita confirmação de escrita do driver MongoDB 2.2', async () => {
    const { service, state } = serviceWithResult({ result: { n: 1 } });
    await service.appendInspection('p1', 'ana', { form: [] }, context);
    assert.equal(state.audits.length, 1);
});

test('geração de blocos recusa campanha com operação de pontos em andamento', async () => {
    let responseStatus;
    const controller = createBlocks({ repository: { collections: {
        campaign: { findOne: async () => ({ _id: 'c1', pointOperationId: 'op1' }) },
        tvi_blocos: { count: async () => { throw new Error('Consulta indevida'); } }
    } }, services: { logger: {} } });
    await controller.generateBlocks({ params: { id: 'c1' }, body: {} }, {
        status(code) { responseStatus = code; return this; }, json() {}
    });
    assert.equal(responseStatus, 409);
});
