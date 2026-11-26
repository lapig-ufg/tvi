'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const mongodb = require('mongodb');
const operations = require('../services/campaignPointOperations');

function point(campaign, index, extra = {}) {
    return Object.assign({ _id: index + '_' + campaign, campaign, index, lon: index, lat: -index,
        userName: [], userNameCount: 0, inspection: [], underInspection: 0 }, extra);
}
function geo(kind, coordinates, properties = {}) {
    return { kind, format: 'geojson', content: { type: 'FeatureCollection', features: coordinates.map(coords => ({
        type: 'Feature', geometry: { type: 'Point', coordinates: coords }, properties
    })) } };
}
const confirmation = campaignId => ({ confirmation: campaignId, reason: 'Revisão dos pontos da campanha.' });

async function drain(service, campaignId, id) {
    for (let i = 0; i < 20; i++) {
        const status = await service.get(campaignId, 'admin', id);
        if (status.status === 'completed') return status;
        await service.processNext(2);
    }
    throw new Error('A operação não terminou dentro do limite de etapas.');
}

test('a apresentação pública não expõe entradas, hashes ou reservas internas', () => {
    const view = operations.present({ _id: 'a', rows: [{ entry: { properties: { private: 'x' } }, fingerprint: 'secret' }],
        status: 'preview', canApply: true, outcomes: [], issues: [], expiresAt: new Date(Date.now() + 1000), leaseToken: 'secret' });
    assert.equal(view.canApply, true);
    assert.equal(JSON.stringify(view).includes('secret'), false);
    assert.equal(JSON.stringify(view).includes('private'), false);
});

test('operações persistidas preservam reservas, histórico e retomada no MongoDB', async t => {
    const db = new mongodb.Db('tvi_campaign_point_operations_test', new mongodb.Server(
        process.env.TVI_TEST_MONGO_HOST || '127.0.0.1', Number(process.env.TVI_TEST_MONGO_PORT || 27019),
        { poolSize: 2, socketOptions: { connectTimeoutMS: 1500, socketTimeoutMS: 3000 } }), { safe: true });
    try { await db.open(); }
    catch (failure) { t.skip('MongoDB de teste indisponível.'); return; }
    try {
        await db.dropDatabase();
        const service = operations.create(db);
        const campaigns = db.collection('campaign');
        const points = db.collection('points');
        const blocks = db.collection('tvi_blocos');
        const jobs = db.collection(operations.COLLECTION);
        await jobs.createIndexes(operations.INDEXES);
        await campaigns.insertMany(['add', 'delete', 'change', 'audit', 'recovery', 'identity', 'reserved', 'partial', 'import', 'add-recovery', 'concurrent', 'fencing', 'skip-fencing', 'config-race', 'audit-race'].map(_id => ({ _id, numInspec: 2, properties: ['original'] })));

        await t.test('inclusão mantém blocos atribuídos e cria todas as rodadas antes de liberar os pontos', async () => {
            await points.insertOne(point('add', 1));
            await blocks.insertOne({ _id: 'assigned', campaignId: 'add', blockIndex: 1, inspectionRound: 1,
                pointIds: ['1_add'], size: 1, currentPointOffset: 0, status: 'assigned', assignedTo: 'ana' });
            const original = await blocks.findOne({ _id: 'assigned' });
            const preview = await service.preview('add', 'admin', geo('add', [[20, -20], [21, -21]], { Bioma: 'Cerrado' }));
            assert.equal(preview.canApply, true);
            await service.confirm('add', 'admin', preview.id, confirmation('add'));
            await service.processNext(1);
            const staged = await points.findOne({ _id: '2_add' });
            assert.equal(staged.pointMutationLock, preview.id);
            const done = await drain(service, 'add', preview.id);
            assert.equal(done.added, 2);
            assert.equal(await points.count({ campaign: 'add', pointMutationLock: { $exists: true } }), 0);
            assert.equal(await blocks.count({ campaignId: 'add', createdByOperation: preview.id }), 4);
            assert.deepEqual(await blocks.findOne({ _id: 'assigned' }), original);
            assert.deepEqual((await campaigns.findOne({ _id: 'add' })).properties, ['original', 'Bioma']);
            assert.equal((await points.findOne({ _id: '2_add' })).biome, 'Cerrado');
            assert.equal((await campaigns.findOne({ _id: 'add' })).pointOperationId, undefined);
            const repeated = await service.confirm('add', 'admin', preview.id, confirmation('add'));
            assert.equal(repeated.status, 'completed');
        });

        await t.test('bloco esvaziado conserva marcador que impede upsert atrasado', async () => {
            const originalBlock = await blocks.findOne({ campaignId: 'add', pointIds: '2_add' });
            assert.ok(originalBlock.createdByOperation);
            const preview = await service.preview('add', 'admin', { kind: 'delete', format: 'ids', ids: ['2_add'] });
            await service.confirm('add', 'admin', preview.id, confirmation('add'));
            assert.equal((await drain(service, 'add', preview.id)).deleted, 1);
            const marker = await blocks.findOne({ _id: originalBlock._id });
            assert.deepEqual(Object.keys(marker).sort(), ['_id', 'pointMutationLock', 'pointRemovedAt'].sort());
            await assert.rejects(blocks.updateOne({ _id: originalBlock._id, createdByOperation: originalBlock.createdByOperation },
                { $setOnInsert: originalBlock }, { upsert: true }), failure => failure.code === 11000);
            assert.equal(await blocks.count({ campaignId: 'add', pointIds: '2_add' }), 0);
        });

        await t.test('remoção limpa referências locais e ajusta offset sem apagar resultados compartilhados', async () => {
            await points.insertMany([point('delete', 1), point('delete', 2, { userName: ['ana'], inspection: [{ form: ['x'] }], userNameCount: 1 }), point('delete', 3)]);
            await blocks.insertOne({ _id: 'deletion-block', campaignId: 'delete', pointIds: ['1_delete', '2_delete', '3_delete'],
                currentPointOffset: 2, size: 3, status: 'available' });
            await db.collection('campaignImageSelections').insertMany([{ _id: 'reference', campaignId: 'delete', pointId: '2_delete' }, { _id: 'other', campaignId: 'delete', pointId: '1_delete' }]);
            await db.collection('offline_cache_jobs').insertOne({ _id: 'delete', run_id: 'run', status: 'running', lease_token: 'worker', lease_until: new Date(Date.now() + 100000), progress_summary: { total: 3 } });
            await db.collection('offline_cache_items').insertMany([{ _id: 'manifest', run_id: 'run', point_ref: '2_delete', key: 'shared' }, { _id: 'other-manifest', run_id: 'run', point_ref: '1_delete', key: 'shared' }]);
            await db.collection('bdc_selection_jobs').insertOne({ _id: 'shared' });
            const preview = await service.preview('delete', 'admin', geo('delete', [[2, -2]]));
            assert.equal(preview.inspections, 1);
            await service.confirm('delete', 'admin', preview.id, confirmation('delete'));
            const done = await drain(service, 'delete', preview.id);
            assert.equal(done.deleted, 1);
            assert.equal(await points.findOne({ _id: '2_delete', campaign: 'delete' }), null);
            const marker = await points.findOne({ _id: '2_delete' });
            assert.deepEqual(Object.keys(marker).sort(), ['_id', 'pointMutationLock', 'pointRemovedAt'].sort());
            await assert.rejects(points.insertOne(point('delete', 2)), failure => failure.code === 11000);
            const block = await blocks.findOne({ _id: 'deletion-block' });
            assert.deepEqual(block.pointIds, ['1_delete', '3_delete']);
            assert.equal(block.size, 2);
            assert.equal(block.currentPointOffset, 1);
            assert.equal(await db.collection('campaignImageSelections').count(), 1);
            assert.equal(await db.collection('offline_cache_items').count(), 1);
            assert.equal(await db.collection('bdc_selection_jobs').count(), 1);
            const offline = await db.collection('offline_cache_jobs').findOne({ _id: 'delete' });
            assert.equal(offline.status, 'stale');
            assert.equal(offline.lease_token, undefined);
            const audit = await db.collection('points_audit').findOne({ operationId: preview.id });
            assert.deepEqual(audit.before.inspection, [{ form: ['x'] }]);
            assert.ok(audit.deletionCompletedAt);
        });

        await t.test('prévia recusa ambiguidade de coordenadas e usa coordenadas, não feature.id', async () => {
            await points.insertMany([point('identity', 1), point('identity', 2, { lon: 1, lat: -1 })]);
            const request = geo('delete', [[1, -1]]);
            request.content.features[0].id = '1_identity';
            const ambiguous = await service.preview('identity', 'admin', request);
            assert.equal(ambiguous.canApply, false);
            assert.match(ambiguous.issues[0].reason, /mais de um/);
            await assert.rejects(service.confirm('identity', 'admin', ambiguous.id, confirmation('identity')), { statusCode: 409 });
            const literal = await service.preview('identity', 'admin', { kind: 'delete', format: 'ids', ids: ['.*'] });
            assert.equal(literal.canApply, false);
            await assert.rejects(service.get('identity', 'other', ambiguous.id), { statusCode: 404 });
        });

        await t.test('inspeção iniciada depois da prévia impede a remoção', async () => {
            await points.insertOne(point('reserved', 1));
            const preview = await service.preview('reserved', 'admin', { kind: 'delete', format: 'ids', ids: ['1_reserved'] });
            await service.confirm('reserved', 'admin', preview.id, confirmation('reserved'));
            await points.updateOne({ _id: '1_reserved' }, { $set: { underInspection: 1 } });
            const done = await drain(service, 'reserved', preview.id);
            assert.equal(done.skipped, 1);
            assert.ok(await points.findOne({ _id: '1_reserved' }));
            assert.equal((await points.findOne({ _id: '1_reserved' })).underInspection, 1);
        });

        await t.test('mudanças após a prévia e atribuição de blocos produzem resultados parciais explícitos', async () => {
            await points.insertMany([point('partial', 1), point('partial', 2), point('partial', 3)]);
            const preview = await service.preview('partial', 'admin', { kind: 'delete', format: 'ids', ids: ['1_partial', '2_partial', '3_partial'] });
            await service.confirm('partial', 'admin', preview.id, confirmation('partial'));
            await points.updateOne({ _id: '1_partial' }, { $set: { inspection: [{ form: ['new'] }] } });
            await blocks.insertOne({ _id: 'partial-assigned', campaignId: 'partial', pointIds: ['2_partial'], status: 'assigned', size: 1, currentPointOffset: 0 });
            const done = await drain(service, 'partial', preview.id);
            assert.equal(done.deleted, 1);
            assert.equal(done.skipped, 2);
            assert.equal(await points.count({ campaign: 'partial' }), 2);
            assert.equal(await points.count({ campaign: 'partial', pointMutationLock: { $exists: true } }), 0);
        });

        await t.test('falha de auditoria impede exclusão e permite retomada sem liberar a campanha', async () => {
            await points.insertOne(point('audit', 1));
            const preview = await service.preview('audit', 'admin', { kind: 'delete', format: 'ids', ids: ['1_audit'] });
            await service.confirm('audit', 'admin', preview.id, confirmation('audit'));
            const wrapped = { collection(name) {
                const collection = db.collection(name);
                if (name === 'points_audit') return { findOne: (...args) => collection.findOne(...args), updateOne: async () => { throw new Error('Falha de gravação simulada'); } };
                return collection;
            } };
            await assert.rejects(operations.create(wrapped).processNext());
            assert.ok(await points.findOne({ _id: '1_audit' }));
            assert.equal((await campaigns.findOne({ _id: 'audit' })).pointOperationId, preview.id);
            assert.equal((await service.get('audit', 'admin', preview.id)).status, 'failed');
            await service.resume('audit', 'admin', preview.id, confirmation('audit'));
            assert.equal((await drain(service, 'audit', preview.id)).deleted, 1);
        });

        await t.test('alteração após auditoria impede remoção e é preservada na retomada', async () => {
            await points.insertOne(point('audit-race', 1, { properties: { categoria: 'original' } }));
            const preview = await service.preview('audit-race', 'admin', { kind: 'delete', format: 'ids', ids: ['1_audit-race'] });
            await service.confirm('audit-race', 'admin', preview.id, confirmation('audit-race'));
            const wrapped = { collection(name) {
                const collection = db.collection(name);
                if (name !== 'points_audit') return collection;
                return new Proxy(collection, { get(target, field) {
                    if (field === 'updateOne') return async (query, change, options) => {
                        const result = await target.updateOne(query, change, options);
                        if (change.$setOnInsert) await points.updateOne({ _id: '1_audit-race' },
                            { $set: { properties: { categoria: 'revisada' } } });
                        return result;
                    };
                    return typeof target[field] === 'function' ? target[field].bind(target) : target[field];
                } });
            } };
            await assert.rejects(operations.create(wrapped).processNext());
            assert.equal((await service.get('audit-race', 'admin', preview.id)).status, 'failed');
            assert.deepEqual((await points.findOne({ _id: '1_audit-race' })).properties, { categoria: 'revisada' });
            const audit = await db.collection('points_audit').findOne({ operationId: preview.id });
            assert.equal(audit.deletionCompletedAt, undefined);
            assert.deepEqual(audit.before.properties, { categoria: 'original' });
            await service.resume('audit-race', 'admin', preview.id, confirmation('audit-race'));
            const done = await drain(service, 'audit-race', preview.id);
            assert.equal(done.deleted, 0);
            assert.equal(done.skipped, 1);
            const preserved = await points.findOne({ _id: '1_audit-race' });
            assert.deepEqual(preserved.properties, { categoria: 'revisada' });
            assert.equal(preserved.pointMutationLock, undefined);
        });

        await t.test('retomada após remoção dos dados termina limpeza usando auditoria sem duplicar contadores', async () => {
            await points.insertOne(point('recovery', 1));
            const preview = await service.preview('recovery', 'admin', { kind: 'delete', format: 'ids', ids: ['1_recovery'] });
            await service.confirm('recovery', 'admin', preview.id, confirmation('recovery'));
            const wrapped = { collection(name) {
                if (name === 'campaignImageSelections') return { deleteMany: async () => { throw new Error('Falha de limpeza simulada'); } };
                return db.collection(name);
            } };
            await assert.rejects(operations.create(wrapped).processNext());
            assert.equal(await points.findOne({ _id: '1_recovery', campaign: 'recovery' }), null);
            await service.resume('recovery', 'admin', preview.id, confirmation('recovery'));
            const done = await drain(service, 'recovery', preview.id);
            assert.equal(done.deleted, 1);
            assert.equal(done.processed, 1);
            assert.equal(await db.collection('points_audit').count({ operationId: preview.id }), 1);
        });

        await t.test('inclusão retomada após escrita preserva faixa e não duplica pontos', async () => {
            const preview = await service.preview('add-recovery', 'admin', geo('add', [[40, -40], [41, -41]]));
            await service.confirm('add-recovery', 'admin', preview.id, confirmation('add-recovery'));
            const wrapped = { collection(name) {
                const collection = db.collection(name);
                if (name !== operations.COLLECTION) return collection;
                return new Proxy(collection, { get(target, field) {
                    if (field === 'updateOne') return async (query, change, options) => {
                        if (change.$set && change.$set.cursor === 1) throw new Error('Interrupção após inclusão');
                        return target.updateOne(query, change, options);
                    };
                    return typeof target[field] === 'function' ? target[field].bind(target) : target[field];
                } });
            } };
            await assert.rejects(operations.create(wrapped).processNext(1));
            assert.equal(await points.count({ campaign: 'add-recovery' }), 1);
            const range = (await jobs.findOne({ _id: preview.id })).range;
            await service.resume('add-recovery', 'admin', preview.id, confirmation('add-recovery'));
            const done = await drain(service, 'add-recovery', preview.id);
            assert.equal(done.added, 2);
            assert.equal(await points.count({ campaign: 'add-recovery' }), 2);
            assert.deepEqual((await jobs.findOne({ _id: preview.id })).range, range);
        });

        await t.test('confirmações e processadores concorrentes não duplicam a execução', async () => {
            const preview = await service.preview('concurrent', 'admin', geo('add', [[50, -50], [51, -51], [52, -52]]));
            await Promise.all([service.confirm('concurrent', 'admin', preview.id, confirmation('concurrent')),
                service.confirm('concurrent', 'admin', preview.id, confirmation('concurrent'))]);
            await Promise.all([service.processNext(1), service.processNext(1)]);
            const done = await drain(service, 'concurrent', preview.id);
            assert.equal(done.added, 3);
            assert.equal(done.processed, 3);
            assert.equal(await points.count({ campaign: 'concurrent' }), 3);
        });

        await t.test('reserva de configuração recusa mudança concorrente antes do lock', async () => {
            const preview = await service.preview('config-race', 'admin', geo('add', [[60, -60]]));
            const wrapped = { collection(name) {
                const collection = db.collection(name);
                if (name !== 'campaign') return collection;
                return new Proxy(collection, { get(target, field) {
                    if (field === 'updateOne') return async (query, change, options) => {
                        if (change.$set && change.$set.pointOperationId) {
                            await target.updateOne({ _id: 'config-race' }, { $set: { numInspec: 3 } });
                        }
                        return target.updateOne(query, change, options);
                    };
                    return typeof target[field] === 'function' ? target[field].bind(target) : target[field];
                } });
            } };
            await assert.rejects(operations.create(wrapped).confirm('config-race', 'admin', preview.id, confirmation('config-race')));
            assert.equal((await campaigns.findOne({ _id: 'config-race' })).pointOperationId, undefined);
            assert.equal(await points.count({ campaign: 'config-race' }), 0);
        });

        await t.test('inclusão descartada conserva marcador mínimo contra escrita atrasada', async () => {
            const preview = await service.preview('skip-fencing', 'admin', geo('add', [[61, -61]]));
            await service.confirm('skip-fencing', 'admin', preview.id, confirmation('skip-fencing'));
            await points.insertOne(point('skip-fencing', 9, { lon: 61, lat: -61 }));
            const done = await drain(service, 'skip-fencing', preview.id);
            assert.equal(done.skipped, 1);
            const marker = await points.findOne({ _id: '10_skip-fencing' });
            assert.equal(marker.campaign, undefined);
            assert.equal(marker.pointMutationLock, 'removed:' + preview.id);
            await assert.rejects(points.insertOne(point('skip-fencing', 10, { lon: 61, lat: -61 })), failure => failure.code === 11000);
        });

        await t.test('worker antigo pausado não recria ponto removido depois de takeover', async () => {
            const preview = await service.preview('fencing', 'admin', geo('add', [[62, -62]]));
            await service.confirm('fencing', 'admin', preview.id, confirmation('fencing'));
            let reachedInsert;
            let continueInsert;
            const reached = new Promise(resolve => { reachedInsert = resolve; });
            const proceed = new Promise(resolve => { continueInsert = resolve; });
            const wrapped = { collection(name) {
                const collection = db.collection(name);
                if (name !== 'points') return collection;
                return new Proxy(collection, { get(target, field) {
                    if (field === 'insertOne') return async document => {
                        reachedInsert();
                        await proceed;
                        return target.insertOne(document);
                    };
                    return typeof target[field] === 'function' ? target[field].bind(target) : target[field];
                } });
            } };
            const oldExecution = operations.create(wrapped).processNext().then(value => ({ value }), failure => ({ failure }));
            await reached;
            await jobs.updateOne({ _id: preview.id }, { $set: { leaseUntil: new Date(0) } });
            assert.equal((await drain(service, 'fencing', preview.id)).added, 1);
            const removal = await service.preview('fencing', 'admin', { kind: 'delete', format: 'ids', ids: ['1_fencing'] });
            await service.confirm('fencing', 'admin', removal.id, confirmation('fencing'));
            assert.equal((await drain(service, 'fencing', removal.id)).deleted, 1);
            continueInsert();
            assert.ok((await oldExecution).failure);
            assert.equal(await points.count({ campaign: 'fencing' }), 0);
            assert.equal((await points.findOne({ _id: '1_fencing' })).pointMutationLock, 'removed:' + removal.id);
            assert.equal((await service.get('fencing', 'admin', preview.id)).status, 'completed');
        });

        await t.test('confirmação interrompida entre reserva e fila é recuperada sem expiração', async () => {
            const preview = await service.preview('change', 'admin', geo('add', [[31, -31]]));
            let interrupted = false;
            const wrapped = { collection(name) {
                const collection = db.collection(name);
                if (name !== operations.COLLECTION) return collection;
                return new Proxy(collection, { get(target, field) {
                    if (field === 'updateOne') return async (query, change, options) => {
                        if (change.$set && change.$set.status === 'queued' && !interrupted) {
                            interrupted = true;
                            throw new Error('Interrupção antes de enfileirar');
                        }
                        return target.updateOne(query, change, options);
                    };
                    return typeof target[field] === 'function' ? target[field].bind(target) : target[field];
                } });
            } };
            await assert.rejects(operations.create(wrapped).confirm('change', 'admin', preview.id, confirmation('change')));
            assert.equal((await jobs.findOne({ _id: preview.id })).status, 'confirming');
            assert.equal((await campaigns.findOne({ _id: 'change' })).pointOperationId, preview.id);
            await jobs.updateOne({ _id: preview.id }, { $set: { expiresAt: new Date(0) } });
            const done = await drain(service, 'change', preview.id);
            assert.equal(done.added, 1);
            assert.equal((await campaigns.findOne({ _id: 'change' })).pointOperationId, undefined);
        });

        await t.test('exclusão do maior índice legado preserva a sequência para próximas inclusões', async () => {
            await campaigns.insertOne({ _id: 'legacy-sequence', numInspec: 1 });
            await points.insertOne(point('legacy-sequence', 9));
            const removal = await service.preview('legacy-sequence', 'admin', { kind: 'delete', format: 'ids', ids: ['9_legacy-sequence'] });
            await service.confirm('legacy-sequence', 'admin', removal.id, confirmation('legacy-sequence'));
            await drain(service, 'legacy-sequence', removal.id);
            assert.equal((await campaigns.findOne({ _id: 'legacy-sequence' })).pointSequence, 9);
            const addition = await service.preview('legacy-sequence', 'admin', geo('add', [[9, -9]]));
            await service.confirm('legacy-sequence', 'admin', addition.id, confirmation('legacy-sequence'));
            const done = await drain(service, 'legacy-sequence', addition.id);
            assert.equal(done.added, 1);
            assert.equal((await points.findOne({ _id: '10_legacy-sequence' })).campaign, 'legacy-sequence');
            assert.equal((await points.findOne({ _id: '9_legacy-sequence' })).campaign, undefined);
        });

        await t.test('confirmação recusa importação legada ativa e prévia expirada', async () => {
            const preview = await service.preview('import', 'admin', geo('add', [[30, -30]]));
            await campaigns.updateOne({ _id: 'import' }, { $set: { pointImportLock: 'legacy' } });
            await assert.rejects(service.confirm('import', 'admin', preview.id, confirmation('import')), { statusCode: 409 });
            await campaigns.updateOne({ _id: 'import' }, { $unset: { pointImportLock: '' } });
            await jobs.updateOne({ _id: preview.id }, { $set: { status: 'preview', expiresAt: new Date(0) } });
            await assert.rejects(service.confirm('import', 'admin', preview.id, confirmation('import')), { statusCode: 409 });
            assert.equal((await campaigns.findOne({ _id: 'import' })).pointOperationId, undefined);
        });
    } finally { await db.dropDatabase(); await db.close(); }
});
