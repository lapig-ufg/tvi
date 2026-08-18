/**
 * Testes de `pointsService.clearInspections`.
 *
 * Contexto (2026-08-18): o botão "Remover" da tela do supervisor usava
 * `softWipePoint`, que marca o ponto como arquivado (`archivedAt`). Um ponto
 * arquivado é excluído do job de sincronização Wayback
 * (controllers/wayback.js: `archivedAt: { $exists: false }`) e contabilizado
 * como arquivado em controllers/inspectionHealth.js. A intenção do supervisor,
 * porém, é devolver o ponto à fila para nova inspeção.
 *
 * O teste roda contra um duplo da collection `points` — sem Mongo — porque o
 * que precisa ser travado é o formato do update e o registro de auditoria.
 *
 * Execução: `cd src/server && npm test`.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const criarPointsService = require(path.join(__dirname, '..', 'services', 'pointsService'));

const PONTO_BASE = {
    _id: 'p1',
    campaign: 'camp-1',
    userName: ['ana', 'bruno'],
    inspection: [{ form: [] }, { form: [] }],
    classConsolidated: ['Pastagem'],
    userNameCount: 2,
    underInspection: 1,
    waybackImages: [{ releaseNum: 100 }]
};

// Duplo mínimo do driver mongodb@2.x usado pelo pointsService.
function criarApp(pontoInicial) {
    const estado = {
        ponto: pontoInicial ? Object.assign({}, pontoInicial) : null,
        updates: [],
        audits: []
    };

    return {
        app: {
            repository: {
                collections: {
                    points: {
                        findOne: async function () { return estado.ponto ? Object.assign({}, estado.ponto) : null; },
                        updateOne: async function (filtro, update) {
                            estado.updates.push(update);
                            Object.assign(estado.ponto, update.$set || {});
                            Object.keys(update.$unset || {}).forEach(function (campo) {
                                delete estado.ponto[campo];
                            });
                            return { modifiedCount: 1 };
                        }
                    },
                    points_audit: {
                        insertOne: async function (doc) { estado.audits.push(doc); return { insertedId: 'a1' }; }
                    }
                }
            },
            services: {}
        },
        estado: estado
    };
}

const CTX = {
    actor: { username: 'supervisor-teste', role: 'supervisor' },
    reason: 'Remocao de inspecoes pela tela do supervisor por supervisor-teste'
};

test('clearInspections zera as inspeções sem arquivar o ponto', async () => {
    const { app, estado } = criarApp(PONTO_BASE);
    const service = criarPointsService(app);

    await service.clearInspections('p1', CTX);

    const update = estado.updates[0];
    assert.deepEqual(update.$set.inspection, []);
    assert.deepEqual(update.$set.userName, []);
    assert.deepEqual(update.$set.classConsolidated, []);
    assert.equal(update.$set.userNameCount, 0);
    assert.equal(update.$set.underInspection, 0);

    // O ponto NÃO pode ser marcado como arquivado.
    assert.equal(update.$set.archivedAt, undefined);
    assert.equal(update.$set.archivedReason, undefined);
    assert.equal(update.$set.archivedBy, undefined);
    assert.equal(estado.ponto.archivedAt, undefined);
});

test('clearInspections remove marcas de arquivamento preexistentes', async () => {
    const arquivado = Object.assign({}, PONTO_BASE, {
        archivedAt: new Date('2026-05-09T00:00:00Z'),
        archivedReason: 'soft wipe anterior',
        archivedBy: 'admin'
    });
    const { app, estado } = criarApp(arquivado);
    const service = criarPointsService(app);

    await service.clearInspections('p1', CTX);

    assert.deepEqual(Object.keys(estado.updates[0].$unset).sort(), ['archivedAt', 'archivedBy', 'archivedReason']);
    assert.equal(estado.ponto.archivedAt, undefined);
    assert.equal(estado.ponto.archivedReason, undefined);
    assert.equal(estado.ponto.archivedBy, undefined);
});

test('clearInspections preserva os campos alheios à inspeção', async () => {
    const { app, estado } = criarApp(PONTO_BASE);
    const service = criarPointsService(app);

    await service.clearInspections('p1', CTX);

    // A grade Wayback é cara de recalcular e não tem relação com a inspeção.
    assert.deepEqual(estado.ponto.waybackImages, [{ releaseNum: 100 }]);
    assert.equal(estado.ponto.campaign, 'camp-1');
});

test('clearInspections grava auditoria com snapshot antes e depois', async () => {
    const { app, estado } = criarApp(PONTO_BASE);
    const service = criarPointsService(app);

    await service.clearInspections('p1', CTX);

    assert.equal(estado.audits.length, 1);
    const audit = estado.audits[0];
    assert.equal(audit.operation, 'clear_inspections');
    assert.equal(audit.pointId, 'p1');
    assert.equal(audit.campaignId, 'camp-1');
    assert.equal(audit.actor.username, 'supervisor-teste');
    assert.deepEqual(audit.before.userName, ['ana', 'bruno']);
    assert.deepEqual(audit.after.userName, []);
    assert.equal(audit.metadata.removedInspections, 2);
});

test('clearInspections exige motivo com ao menos 10 caracteres', async () => {
    const { app } = criarApp(PONTO_BASE);
    const service = criarPointsService(app);

    await assert.rejects(
        () => service.clearInspections('p1', { actor: { username: 'x' }, reason: 'curto' }),
        /reason/
    );
});

test('clearInspections falha quando o ponto não existe', async () => {
    const { app } = criarApp(null);
    const service = criarPointsService(app);

    await assert.rejects(() => service.clearInspections('inexistente', CTX), /não encontrado/);
});

test('softWipePoint continua arquivando (comportamento preservado)', async () => {
    // O arquivamento segue disponível para POST /api/admin/points/:id/soft-wipe.
    const { app, estado } = criarApp(PONTO_BASE);
    const service = criarPointsService(app);

    await service.softWipePoint('p1', CTX);

    assert.ok(estado.updates[0].$set.archivedAt instanceof Date);
    assert.equal(estado.audits[0].operation, 'soft_wipe');
});
