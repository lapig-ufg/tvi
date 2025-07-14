const mongodb = require('mongodb');

// Configuração do banco (ajustar conforme necessário)
const config = {
    mongo: {
        host: 'localhost',
        port: 27017,
        dbname: 'tvi'
    }
};

const createSuperAdmin = async () => {
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

        const usersCollection = await new Promise((resolve, reject) => {
            db.collection('users', (err, collection) => {
                if (err) reject(err);
                else resolve(collection);
            });
        });

        // Verificar se já existe um super-admin
        const existingAdmin = await usersCollection.findOne({ role: 'super-admin' });
        
        if (existingAdmin) {
            console.log('Super-admin já existe:', existingAdmin.username);
            return;
        }

        // Criar super-admin
        const superAdmin = {
            username: 'admin',
            password: 'admin123', // IMPORTANTE: Trocar por uma senha forte em produção
            role: 'super-admin',
            createdAt: new Date()
        };

        await usersCollection.insertOne(superAdmin);
        console.log('Super-admin criado com sucesso!');
        console.log('Username: admin');
        console.log('Password: admin123');
        console.log('IMPORTANTE: Trocar a senha em produção!');

    } catch (error) {
        console.error('Erro ao criar super-admin:', error);
    } finally {
        db.close();
    }
};

// Executar se chamado diretamente
if (require.main === module) {
    createSuperAdmin().then(() => {
        console.log('Script finalizado');
        process.exit(0);
    }).catch((error) => {
        console.error('Erro:', error);
        process.exit(1);
    });
}

module.exports = createSuperAdmin;