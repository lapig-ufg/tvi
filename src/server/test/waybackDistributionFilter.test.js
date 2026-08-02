'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const pointsModule = require(path.join(__dirname, '..', 'controllers', 'points'));
const { buildFindPointFilter } = pointsModule;

const TEST_DB = 'tvi_wayback_dist_test';

function getMongoConfig() {
    return {
        host: process.env.TVI_TEST_MONGO_HOST || '127.0.0.1',
        port: parseInt(process.env.TVI_TEST_MONGO_PORT || '27019', 10)
    };
}

let mongodb;
try { mongodb = require(path.join(__dirname, '..', 'node_modules', 'mongodb')); } catch (e) { mongodb = null; }

test('buildFindPointFilter: campanha wayback exige ponto com grade pronta (waybackImages não vazio)', () => {
    const filter = buildFindPointFilter({ _id: 'camp_wb', numInspec: 3, imageType: 'wayback' }, 'user1');
    const clause = filter.$and.find(c => c['waybackImages.0']);
    assert.deepEqual(clause, { 'waybackImages.0': { $exists: true } });
});

test('buildFindPointFilter: campanha legada não menciona waybackImages', () => {
    const filter = buildFindPointFilter({ _id: 'camp_ls', numInspec: 3, imageType: 'landsat' }, 'user1');
    assert.equal(filter.$and.find(c => c['waybackImages.0']), undefined);
    assert.equal(JSON.stringify(filter).includes('wayback'), false);
});

test('buildFindPointFilter: preserva as cláusulas de distribuição existentes', () => {
    // O filtro wayback é ADITIVO: as garantias contra over-serve (incidente
    // Peru 2026-06-12) e a retrocompatibilidade de userNameCount permanecem.
    const filter = buildFindPointFilter({ _id: 'camp_wb', numInspec: 3, imageType: 'wayback' }, 'user1');
    assert.ok(filter.$and.find(c => c.campaign), 'cláusula de campanha');
    assert.ok(filter.$and.find(c => c.userName && c.userName.$nin), 'usuário não repetido');
    assert.ok(filter.$and.find(c => c.underInspection), 'limite de serves simultâneos');
    assert.ok(filter.$and.find(c => c.$expr), 'guarda $expr contra over-serve');
    assert.ok(filter.$and.find(c => c.$or), 'retrocompatibilidade userNameCount');
});

test('buildFindPointFilter: seleção real no Mongo serve apenas pontos com grade pronta', async (t) => {
    if (!mongodb) return t.skip('driver mongodb indisponível');
    const cfg = getMongoConfig();
    let db;
    try {
        db = await mongodb.MongoClient.connect(
            `mongodb://${cfg.host}:${cfg.port}/${TEST_DB}`, { connectTimeoutMS: 2000 });
    } catch (e) { return t.skip('MongoDB de teste indisponível: ' + e.message); }

    try {
        await db.dropDatabase();
        const points = db.collection('points');
        await points.insertMany([
            { _id: 'sincronizado', campaign: 'camp_wb', index: 1, userName: [], userNameCount: 0,
              underInspection: 0, waybackSyncedAt: new Date(), waybackImages: [{ releaseNum: 1 }] },
            { _id: 'sem_cobertura', campaign: 'camp_wb', index: 2, userName: [], userNameCount: 0,
              underInspection: 0, waybackSyncedAt: new Date(), waybackImages: [] },
            { _id: 'pendente', campaign: 'camp_wb', index: 3, userName: [], userNameCount: 0,
              underInspection: 0 }
        ]);
        const filter = buildFindPointFilter({ _id: 'camp_wb', numInspec: 3, imageType: 'wayback' }, 'user1');
        const served = await points.find(filter).sort({ index: 1 }).toArray();
        assert.deepEqual(served.map(p => p._id), ['sincronizado'],
            'nem pendente nem sem-cobertura podem ser servidos');
    } finally {
        await db.close();
    }
});
