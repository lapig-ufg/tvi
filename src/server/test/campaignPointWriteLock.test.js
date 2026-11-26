const test = require('node:test');
const assert = require('node:assert/strict');
const { withLock } = require('../services/campaignPointWriteLock');

function collection(initial = { _id: 'campaign' }) {
    let doc = initial;
    return {
        get document() { return doc; },
        async findOne() { return doc; },
        async findOneAndUpdate(query, update) {
            if (!doc || doc._id !== query._id || Object.hasOwn(doc, 'pointOperationId') || Object.hasOwn(doc, 'pointImportLock')) return { value: null };
            Object.assign(doc, update.$set);
            return { value: { ...doc } };
        },
        async updateOne(query) {
            if (doc && doc._id === query._id && doc.pointImportLock === query.pointImportLock) delete doc.pointImportLock;
        }
    };
}

test('somente um escritor pode executar por campanha e o bloqueio é liberado', async () => {
    const campaigns = collection();
    let release;
    const barrier = new Promise(resolve => { release = resolve; });
    let entered;
    const ready = new Promise(resolve => { entered = resolve; });
    const first = withLock(campaigns, 'campaign', async () => { entered(); await barrier; return 42; });
    await ready;
    await assert.rejects(withLock(campaigns, 'campaign', async () => assert.fail('Escritor concorrente executado')), { statusCode: 409 });
    release();
    assert.equal(await first, 42);
    assert.equal(campaigns.document.pointImportLock, undefined);
});

test('operações de pontos e bloqueios abandonados impedem aquisição', async () => {
    for (const field of ['pointOperationId', 'pointImportLock']) {
        await assert.rejects(withLock(collection({ _id: 'campaign', [field]: 'existing' }), 'campaign', async () => assert.fail()), { statusCode: 409 });
    }
});

test('libera após exceção sem remover token pertencente a outro escritor', async () => {
    const campaigns = collection();
    const failure = new Error('Falha de escrita');
    await assert.rejects(withLock(campaigns, 'campaign', async () => { throw failure; }), error => error === failure);
    assert.equal(campaigns.document.pointImportLock, undefined);
    await withLock(campaigns, 'campaign', async () => { campaigns.document.pointImportLock = 'other'; });
    assert.equal(campaigns.document.pointImportLock, 'other');
});

test('rejeita campanha ausente e identificador inválido antes da aquisição', async () => {
    const campaigns = collection(null);
    campaigns.findOneAndUpdate = async () => assert.fail('Aquisição indevida');
    await assert.rejects(withLock(campaigns, 'campaign', async () => {}), { statusCode: 404 });
    await assert.rejects(withLock(campaigns, { $ne: null }, async () => {}), { statusCode: 400 });
});

for (const method of ['generateBlocks', 'generateRecoveryBlocks']) {
    test(method + ' recusa uma operação iniciada após a leitura da campanha', async () => {
        const campaigns = collection();
        campaigns.findOneAndUpdate = async (query) => {
            assert.deepEqual(query.pointOperationId, { $exists: false });
            assert.deepEqual(query.pointImportLock, { $exists: false });
            return { value: null };
        };
        const controller = require('../controllers/blocos')({ repository: { collections: {
            campaign: campaigns,
            tvi_blocos: { count: async () => assert.fail('Leitura fora do bloqueio') },
            points: {}
        } }, services: { logger: { error: async () => {} } } });
        const response = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; } };
        await controller[method]({ params: { id: 'campaign' }, body: {} }, response);
        assert.equal(response.statusCode, 409);
        assert.match(response.body.error, /operação de pontos/);
    });
}

test('importação direta preserva propriedades anteriores por união atômica', async () => {
    const campaigns = collection({ _id: 'campaign', properties: ['existing'] });
    const release = campaigns.updateOne;
    let propertyUpdate;
    campaigns.updateOne = async (query, update) => {
        if (update.$addToSet) {
            assert.ok(campaigns.document.pointImportLock);
            propertyUpdate = update;
            campaigns.document.properties = [...new Set([...campaigns.document.properties, ...update.$addToSet.properties.$each])];
        } else {
            assert.equal(update.$set, undefined);
            await release(query, update);
        }
    };
    const controller = require('../controllers/campaign-crud')({ config: {}, repository: { collections: {
        campaign: campaigns, points: { findOne: async () => null }
    } }, services: { logger: {} } });
    await controller.processGeoJSONDirect('campaign', { type: 'FeatureCollection', features: [] }, 'empty.geojson', null, null, null);
    assert.deepEqual(propertyUpdate, { $addToSet: { properties: { $each: [] } } });
    assert.deepEqual(campaigns.document.properties, ['existing']);
    assert.equal(campaigns.document.pointImportLock, undefined);
});

function response() {
    return { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}
function campaignController(campaigns, points = {}) {
    return require('../controllers/campaign-crud')({ config: {}, repository: { collections: { campaign: campaigns, points } },
        services: { logger: { info: async () => {}, warn: async () => {}, logError: async () => {} } } });
}

for (const method of ['discardBlock', 'deleteAllBlocks']) {
    test(method + ' preserva blocos durante uma operação de pontos', async () => {
        const campaigns = collection({ _id: 'campaign', pointOperationId: 'operation' });
        const controller = require('../controllers/blocos')({ repository: { collections: {
            campaign: campaigns,
            tvi_blocos: { findOne: async () => assert.fail('Leitura sem bloqueio'), count: async () => assert.fail('Leitura sem bloqueio'), deleteMany: async () => assert.fail('Exclusão sem bloqueio') }
        } }, services: { logger: { error: async () => {} } } });
        const res = response();
        await controller[method]({ params: { id: 'campaign', blockIndex: '1' }, body: { inspectionRound: 1, force: true } }, res);
        assert.equal(res.statusCode, 409);
    });
}

test('edição não aceita campos internos de reserva nem caminhos derivados', async () => {
    for (const field of ['pointOperationId', 'pointImportLock', 'pointOperationRange', 'pointSequence', 'pointOperationRange.start']) {
        const campaigns = collection();
        campaigns.updateOne = async () => assert.fail('Campo interno gravado');
        const res = response();
        await campaignController(campaigns).update({ params: { id: 'campaign' }, body: { [field]: 'client-value' } }, res);
        assert.equal(res.statusCode, 400);
    }
});

test('edição recusa campanha bloqueada sem alterar sua configuração', async () => {
    for (const field of ['pointOperationId', 'pointImportLock']) {
        const campaigns = collection({ _id: 'campaign', [field]: 'operation' });
        campaigns.updateOne = async () => assert.fail('Campanha bloqueada alterada');
        const res = response();
        await campaignController(campaigns).update({ params: { id: 'campaign' }, body: { numInspec: 3 } }, res);
        assert.equal(res.statusCode, 409);
    }
});

test('exclusão exige reserva própria e ausência de operação concorrente', async () => {
    const campaigns = collection();
    campaigns.deleteOne = async query => {
        assert.deepEqual(query, { _id: 'campaign', pointOperationId: { $exists: false }, pointImportLock: campaigns.document.pointImportLock });
        assert.equal(typeof query.pointImportLock, 'string');
        campaigns.document.pointOperationId = 'operation';
        return { deletedCount: 0 };
    };
    const res = response();
    await campaignController(campaigns, { count: async () => 0 }).delete({ params: { id: 'campaign' } }, res);
    assert.equal(res.statusCode, 409);
    assert.equal(campaigns.document._id, 'campaign');
});

test('rota legada de exclusão integral exige prévia sem modificar o banco', async () => {
    const forbidden = async () => assert.fail('A rota legada não pode alterar o banco');
    const controller = campaignController({ findOne: forbidden, findOneAndUpdate: forbidden, updateOne: forbidden }, { deleteMany: forbidden });
    const res = response();
    await controller.deletePoints({ params: { id: 'campaign' } }, res);
    assert.equal(res.statusCode, 409);
    assert.deepEqual(res.body, { code: 'POINT_PREVIEW_REQUIRED', error: 'Use o gerenciamento de pontos para conferir a prévia e confirmar a exclusão.' });
});

test('edição verifica reservas na escrita mesmo após uma leitura sem bloqueio', async () => {
    const campaigns = collection({ _id: 'campaign', imageType: 'landsat', numInspec: 2 });
    let writes = 0;
    campaigns.updateOne = async query => {
        writes++;
        assert.deepEqual(query.pointOperationId, { $exists: false });
        assert.deepEqual(query.pointImportLock, { $exists: false });
        return { result: { n: 0 } };
    };
    const res = response();
    await campaignController(campaigns).update({ params: { id: 'campaign' }, body: { numInspec: 3 } }, res);
    assert.equal(writes, 1);
    assert.equal(res.statusCode, 409);
});

test('exclusão de campanha mantém a reserva durante a contagem de pontos', async () => {
    const campaigns = collection();
    const res = response();
    const controller = campaignController(campaigns, { count: async () => {
        assert.equal(typeof campaigns.document.pointImportLock, 'string');
        await assert.rejects(withLock(campaigns, 'campaign', async () => assert.fail('Importação simultânea')), { statusCode: 409 });
        return 1;
    } });
    await controller.delete({ params: { id: 'campaign' } }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(campaigns.document.pointImportLock, undefined);
});

for (const method of ['importClassifications', 'importClassificationsFromFile']) {
    test(method + ' não grava classificações durante operação de pontos', async () => {
        const campaigns = collection({ _id: 'campaign', pointOperationId: 'operation' });
        const controller = campaignController(campaigns, {
            count: async () => 1,
            find: () => assert.fail('Leitura de pontos fora da reserva'),
            bulkWrite: () => assert.fail('Escrita de classificações fora da reserva')
        });
        const res = response();
        await controller[method]({ params: { id: 'campaign' }, body: { geojsonContent: JSON.stringify({
            type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [1, 2] }, properties: {} }]
        }) } }, res);
        assert.equal(res.statusCode, 409);
    });
}

test('importação mantém reserva após a resposta inicial até terminar o processamento', async () => {
    const campaigns = collection();
    let finish;
    const barrier = new Promise(resolve => { finish = resolve; });
    let entered;
    const ready = new Promise(resolve => { entered = resolve; });
    const controller = campaignController(campaigns, { count: async () => 1,
        find: () => ({ batchSize: () => ({ hasNext: async () => { entered(); await barrier; return false; } }) }) });
    const res = response();
    const running = controller.importClassifications({ params: { id: 'campaign' } }, res);
    await ready;
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    await assert.rejects(withLock(campaigns, 'campaign', async () => assert.fail('Escrita concorrente')), { statusCode: 409 });
    finish();
    await running;
    assert.equal(campaigns.document.pointImportLock, undefined);
});

test('importação legada não reutiliza o maior índice removido', async () => {
    const campaigns = collection({ _id: 'campaign', pointSequence: 9 });
    const release = campaigns.updateOne;
    campaigns.updateOne = async (query, update) => {
        if (update.$max) {
            assert.equal(query.pointImportLock, campaigns.document.pointImportLock);
            campaigns.document.pointSequence = Math.max(campaigns.document.pointSequence, update.$max.pointSequence);
            return { result: { n: 1 } };
        }
        if (update.$unset) await release(query, update);
        return { result: { n: 1 } };
    };
    const inserted = [];
    const controller = campaignController(campaigns, {
        findOne: async () => ({ index: 8 }),
        insertMany: async values => {
            assert.equal(campaigns.document.pointSequence, 10);
            inserted.push(...values);
            return { insertedCount: values.length };
        }
    });
    const result = await controller.processGeoJSONDirect('campaign', { type: 'FeatureCollection', features: [
        { type: 'Feature', geometry: { type: 'Point', coordinates: [1, 2] }, properties: {} }
    ] }, 'points.geojson', null, null, null);
    assert.equal(result.insertedCount, 1);
    assert.equal(inserted[0]._id, '10_campaign');
    assert.equal(inserted[0].index, 10);
});

test('criação de campanha rejeita campos internos antes de consultar ou gravar', async () => {
    const forbidden = async () => assert.fail('Banco acessado com campo reservado');
    for (const field of ['pointOperationId', 'pointImportLock', 'pointOperationRange', 'pointSequence', 'pointOperationRange.start']) {
        const res = response();
        await campaignController({ findOne: forbidden, insertOne: forbidden }).create({ body: { _id: 'campaign', [field]: 1 } }, res);
        assert.equal(res.statusCode, 400);
    }
});
