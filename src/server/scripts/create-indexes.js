const mongodb = require('mongodb');

// Configuração do banco (ajustar conforme necessário)
const config = {
    mongo: {
        host: 'localhost',
        port: 27017,
        dbname: 'tvi'
    }
};

const createIndexes = async () => {
    const Db = mongodb.Db;
    const Server = mongodb.Server;
    
    const db = new Db(config.mongo.dbname, 
        new Server(config.mongo.host, config.mongo.port, {'auto_reconnect': true}),
        {safe: true}
    );

    try {
        await new Promise((resolve, reject) => {
            db.open((err) => {
                if (err) reject(err);
                else resolve();
            });
        });

        console.log('Conectado ao MongoDB');

        // Índices para a coleção campaigns
        console.log('Criando índices para a coleção campaigns...');
        const campaignCollection = await new Promise((resolve, reject) => {
            db.collection('campaign', (err, collection) => {
                if (err) reject(err);
                else resolve(collection);
            });
        });

        // O índice _id já existe automaticamente, não precisa criar
        
        // Índice para consultas de listagem ordenadas por data de criação
        await campaignCollection.createIndex({ createdAt: -1 });
        console.log('✓ Índice criado: campaigns.createdAt (desc)');
        
        // Índice para prioridade de cache
        await campaignCollection.createIndex({ cachePriority: 1 });
        console.log('✓ Índice criado: campaigns.cachePriority');

        // Índice para consultas por status/tipo se houver
        if (await hasField(campaignCollection, 'status')) {
            await campaignCollection.createIndex({ status: 1 });
            console.log('✓ Índice criado: campaigns.status');
        }

        // Índices para a coleção points
        console.log('\nCriando índices para a coleção points...');
        const pointsCollection = await new Promise((resolve, reject) => {
            db.collection('points', (err, collection) => {
                if (err) reject(err);
                else resolve(collection);
            });
        });

        // Índice principal para consultas por campanha (muito usado)
        await pointsCollection.createIndex({ campaign: 1 });
        console.log('✓ Índice criado: points.campaign');

        // Índice para consultas de progresso (contagem de userName)
        await pointsCollection.createIndex({ campaign: 1, userName: 1 });
        console.log('✓ Índice criado: points.campaign + userName');

        // Índice para consultas geoespaciais se necessário
        await pointsCollection.createIndex({ 
            campaign: 1, 
            lat: 1, 
            lon: 1 
        });
        console.log('✓ Índice criado: points.campaign + lat + lon');

        // Índice para consultas por status de inspeção
        await pointsCollection.createIndex({ 
            campaign: 1, 
            underInspection: 1 
        });
        console.log('✓ Índice criado: points.campaign + underInspection');

        // Índice para paginação de pontos
        await pointsCollection.createIndex({ 
            campaign: 1, 
            index: 1 
        });
        console.log('✓ Índice criado: points.campaign + index');

        // Índice para consultas por data de importação
        await pointsCollection.createIndex({ 
            campaign: 1, 
            dateImport: -1 
        });
        console.log('✓ Índice criado: points.campaign + dateImport (desc)');

        // Índice para consultas por região geográfica
        await pointsCollection.createIndex({ 
            biome: 1, 
            uf: 1, 
            county: 1 
        });
        console.log('✓ Índice criado: points.biome + uf + county');

        // Índice para consultas por path e row (tiles Landsat)
        await pointsCollection.createIndex({ 
            campaign: 1, 
            path: 1, 
            row: 1 
        });
        console.log('✓ Índice criado: points.campaign + path + row');

        // Índices para a coleção users (se existir)
        console.log('\nCriando índices para a coleção users...');
        const usersCollection = await new Promise((resolve, reject) => {
            db.collection('users', (err, collection) => {
                if (err) {
                    console.log('Coleção users não encontrada, pulando...');
                    resolve(null);
                } else {
                    resolve(collection);
                }
            });
        });

        if (usersCollection) {
            // Índice único para username
            await usersCollection.createIndex({ username: 1 }, { unique: true });
            console.log('✓ Índice criado: users.username (unique)');

            // Índice para consultas por role
            await usersCollection.createIndex({ role: 1 });
            console.log('✓ Índice criado: users.role');

            // Índice composto para autenticação
            await usersCollection.createIndex({ username: 1, role: 1 });
            console.log('✓ Índice criado: users.username + role');
        }

        console.log('\n🎉 Todos os índices foram criados com sucesso!');
        
        // Mostrar estatísticas dos índices
        console.log('\n📊 Estatísticas dos índices:');
        await showIndexStats(campaignCollection, 'campaigns');
        await showIndexStats(pointsCollection, 'points');
        if (usersCollection) {
            await showIndexStats(usersCollection, 'users');
        }

    } catch (error) {
        console.error('Erro ao criar índices:', error);
    } finally {
        db.close();
    }
};

// Função auxiliar para verificar se um campo existe na coleção
const hasField = async (collection, fieldName) => {
    try {
        const sample = await collection.findOne({});
        return sample && sample.hasOwnProperty(fieldName);
    } catch (error) {
        return false;
    }
};

// Função auxiliar para mostrar estatísticas dos índices
const showIndexStats = async (collection, collectionName) => {
    try {
        const indexes = await collection.indexes();
        console.log(`\n${collectionName.toUpperCase()}:`);
        indexes.forEach(index => {
            const keyStr = Object.keys(index.key).map(k => 
                `${k}:${index.key[k]}`
            ).join(', ');
            console.log(`  - ${index.name}: {${keyStr}}`);
        });
    } catch (error) {
        console.log(`Erro ao obter estatísticas de ${collectionName}:`, error.message);
    }
};

// Executar se chamado diretamente
if (require.main === module) {
    createIndexes().then(() => {
        console.log('\n✅ Script de criação de índices finalizado');
        process.exit(0);
    }).catch((error) => {
        console.error('❌ Erro:', error);
        process.exit(1);
    });
}

module.exports = createIndexes;