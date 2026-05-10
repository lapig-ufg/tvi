#!/usr/bin/env node
/**
 * setup-test-campaign.js
 * Popula tvi_sim com fixtures para a simulação end-to-end (50 inspetores, numInspec=2).
 *
 * Idempotente: se já existir uma campanha com _id `simulation_test_campaign`,
 * aborta e orienta o usuário a rodar `simulate/cleanup.sh` antes.
 *
 * NÃO apaga nada por conta própria.
 *
 * Uso:
 *   node simulate/setup-test-campaign.js
 *
 * Variáveis de ambiente (com defaults):
 *   MONGO_URL  (mongodb://localhost:27019)   ← container docker tvi-sim-mongo (mongo:4.4)
 *   MONGO_DB   (tvi_sim)
 *
 * Por que porta 27019: o Mongo local na 27017 é versão 8.x, incompatível
 * com o driver mongodb 2.2.36 do projeto (OP_QUERY removido). O servidor
 * TVI precisa rodar contra Mongo 4.x, então usamos um container dedicado
 * em 27019. Subir o container:
 *   docker run -d --name tvi-sim-mongo -p 27019:27017 \
 *     -v tvi-sim-mongo-data:/data/db mongo:4.4
 */

'use strict';

const path = require('path');
const MongoClient = require('/tmp/test-mongo-deps/node_modules/mongodb').MongoClient;

const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27019';
const MONGO_DB = process.env.MONGO_DB || 'tvi_sim';

const CAMPAIGN_ID = 'simulation_test_campaign';
const CAMPAIGN_PASSWORD = 'simtest123';
const NUM_POINTS = 500;
const NUM_INSPEC = 2;
const INITIAL_YEAR = 2000;
const FINAL_YEAR = 2020;

function buildCampaign() {
    return {
        _id: CAMPAIGN_ID,
        name: 'Simulation Test Campaign',
        description: 'Campanha sintética para validar fluxo pós-Tier 0-3 (50 agentes, numInspec=2)',
        numInspec: NUM_INSPEC,
        password: CAMPAIGN_PASSWORD,
        initialYear: INITIAL_YEAR,
        finalYear: FINAL_YEAR,
        imageType: 'landsat',
        landUse: ['Pastagem', 'Agricultura', 'Floresta', 'Não Pastagem'],
        defaultLandUse: 'Pastagem',
        totalPoints: NUM_POINTS,
        completedPoints: 0,
        pendingPoints: NUM_POINTS,
        showTimeseries: false,
        showPointInfo: true,
        useDynamicMaps: false,
        autoLoadTimeseries: true,
        createdAt: new Date(),
        updatedAt: new Date()
    };
}

function buildPoint(index) {
    return {
        _id: `sim${index}_${CAMPAIGN_ID}`,
        campaign: CAMPAIGN_ID,
        lat: -15.0 - (index * 0.001),
        lon: -49.0 - (index * 0.001),
        biome: 'CERRADO',
        uf: 'GO',
        county: 'Goiania',
        countyCode: '5208707',
        path: 222,
        row: 70,
        index: index,
        userName: ['Classificação Automática'],
        inspection: [{
            counter: 0,
            form: [{ initialYear: INITIAL_YEAR, finalYear: FINAL_YEAR, landUse: 'Pastagem' }],
            fillDate: new Date()
        }],
        classConsolidated: [],
        underInspection: 0,
        cached: true,
        userNameCount: 1,
        properties: { bioma: 'CERRADO' },
        dateImport: new Date()
    };
}

async function main() {
    console.log(`[setup] target=${MONGO_URL}/${MONGO_DB}`);
    const client = await MongoClient.connect(MONGO_URL);
    const db = client.db(MONGO_DB);

    try {
        // --- Idempotência ---
        const existing = await db.collection('campaign').findOne({ _id: CAMPAIGN_ID });
        if (existing) {
            console.error(`\n[setup] ERRO: campanha "${CAMPAIGN_ID}" já existe em ${MONGO_DB}.`);
            console.error('[setup] Para repopular, rode primeiro: bash simulate/cleanup.sh');
            await client.close();
            process.exit(2);
        }

        // --- Garantir collections vazias que o servidor consulta no fluxo do inspetor ---
        // (o bootstrap do repository.js só pré-cria algumas; precisa
        // existirem ANTES do server start para que app.repository.collections
        // tenha referência válida)
        for (const name of ['mosaics', 'status', 'vis_params', 'ticket_counters', 'cacheConfig', 'logsConfig']) {
            try { await db.createCollection(name); } catch (e) { /* já existe */ }
        }
        console.log('[setup] collections auxiliares (mosaics, status, vis_params, ...) garantidas');

        // --- Inserir campanha ---
        await db.collection('campaign').insertOne(buildCampaign());
        console.log(`[setup] campanha inserida: _id=${CAMPAIGN_ID} numInspec=${NUM_INSPEC}`);

        // --- Inserir 500 pontos em batch ---
        const points = [];
        for (let i = 1; i <= NUM_POINTS; i++) {
            points.push(buildPoint(i));
        }
        await db.collection('points').insertMany(points, { ordered: false });
        console.log(`[setup] ${NUM_POINTS} pontos inseridos (índices 1..${NUM_POINTS})`);

        // --- Super-admin (idempotente; criamos só se não existir) ---
        const usersCol = db.collection('users');
        const existingAdmin = await usersCol.findOne({ role: 'super-admin' });
        if (existingAdmin) {
            console.log(`[setup] super-admin já existe: username=${existingAdmin.username}`);
        } else {
            await usersCol.insertOne({
                _id: 'admin',
                username: 'admin',
                password: 'admin123',
                role: 'super-admin',
                createdAt: new Date()
            });
            console.log('[setup] super-admin criado: username=admin password=admin123');
        }

        // --- Sumário ---
        console.log('\n[setup] FIXTURES PRONTAS');
        console.log(`  campaign     : ${await db.collection('campaign').countDocuments()}`);
        console.log(`  points       : ${await db.collection('points').countDocuments()}`);
        console.log(`  users        : ${await db.collection('users').countDocuments()}`);
        console.log('\nPróximos passos:');
        console.log('  1) Instalar validator (em Mongo 4.4 do container tvi-sim-mongo, porta 27019):');
        console.log('     mongosh "mongodb://localhost:27019/tvi_sim" --quiet --file simulate/install-validator.mongosh.js');
        console.log('  2) Subir servidor TVI (porta 3000 — hardcoded em config.js) apontando para o container:');
        console.log('     cd src/server && NODE_ENV=dev MONGO_HOST=localhost MONGO_PORT=27019 \\');
        console.log('       MONGO_DATABASE=tvi_sim ALLOWED_ORIGINS=http://localhost:3000 ALLOWED_HOSTS=localhost:3000 \\');
        console.log('       node app-tvi-cluster.js > /tmp/tvi-sim-server.log 2>&1 &');
        console.log('  3) Gerar blocos: bash simulate/generate-blocks.sh');
        console.log('  4) Rodar agentes: node simulate/inspector-agents.js');
    } finally {
        await client.close();
    }
}

main().catch(err => {
    console.error('[setup] FALHA:', err);
    process.exit(1);
});
