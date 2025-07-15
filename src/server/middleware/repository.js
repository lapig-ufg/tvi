var util = require('util')
    , mongodb = require('mongodb')
    , async = require('async');

module.exports = function (app) {

    var Db = mongodb.Db,
        Connection = mongodb.Connection,
        Server = mongodb.Server,
        config = app.config,
        Repository = {
            collections: {},
            tSCollections: {}
        };
    Repository.db = new Db(config.mongo.dbname
        , new Server(config.mongo.host, config.mongo.port, {'auto_reconnect': true, 'pool_size': 5})
        , {safe: true}
    );

    Repository.dbTs = new Db('tvi-timeseries'
        , new Server(config.mongo.host, config.mongo.port, {'auto_reconnect': true, 'pool_size': 5})
        , {safe: true}
    )

    Repository.bin = function (data) {
        return new mongodb.Binary(data);
    }

    Repository.id = function (id) {
        var x = new mongodb.ObjectID(id);
        console.log(typeof x);
        return x;
    };

    Repository.init = function (callback) {
        Repository.db.open(function (err) {
            if (err) {
                return callback(err);
            }

            Repository.db.listCollections({}).toArray(function (err, names) {

                var forEachOne = function (collection, callback) {
                    var name = collection.name.substr(collection.name.indexOf('\.') + 1);
                    if (name != 'indexes') {
                        Repository.db.collection(name, function (err, repository) {
                            if (err) {
                                console.log(err)
                            }
                            Repository.collections[name] = repository;
                            callback();
                        });
                    } else {
                        callback();
                    }
                };

                async.each(names, forEachOne, function(err) {
                    if (err) return callback(err);
                    
                    // Garantir que as coleções necessárias existam
                    var requiredCollections = ['campaign', 'points', 'users', 'cacheConfig'];
                    var ensureCollection = function(collectionName, callback) {
                        if (!Repository.collections[collectionName]) {
                            Repository.db.collection(collectionName, function (err, repository) {
                                if (err) {
                                    console.log(err);
                                }
                                Repository.collections[collectionName] = repository;
                                callback();
                            });
                        } else {
                            callback();
                        }
                    };
                    
                    async.each(requiredCollections, ensureCollection, function(err) {
                        if (err) return callback(err);
                        
                        // Criar índices para melhorar performance
                        Repository.createIndexes(callback);
                    });
                })
            });
        });
    };

    Repository.initTimeseriesDb = function (callback){
        Repository.dbTs.open(function (err) {
            if (err) {
                return callback(err);
            }

            Repository.dbTs.listCollections({}).toArray(function (err, names) {

                var forEachOne = function (collection, callback) {
                    var name = collection.name.substr(collection.name.indexOf('\.') + 1);
                    if (name != 'indexes') {
                        Repository.dbTs.collection(name, function (err, repository) {
                            if (err) {
                                console.log(err)
                            }
                            Repository.tSCollections[name] = repository;
                            callback();
                        });
                    } else {
                        callback();
                    }
                };
                async.each(names, forEachOne, callback)
            });
        });
    }

    Repository.getSync = function (collectionName) {
        return Repository.collections[collectionName];
    };

    Repository.get = function (collectionName, callback) {
        Repository.db.collection(collectionName, callback);
    };

    // Criar índices para melhorar performance das consultas
    Repository.createIndexes = function(callback) {
        console.log('Criando índices para otimização de performance...');
        
        async.series([
            // Índices para collection points
            function(cb) {
                if (!Repository.collections.points) return cb();
                
                Repository.collections.points.createIndexes([
                    // Índice composto para consultas por campanha e status
                    { key: { campaign: 1, _id: 1 }, name: 'campaign_id' },
                    { key: { campaign: 1, userName: 1 }, name: 'campaign_userName' },
                    { key: { campaign: 1, cached: 1 }, name: 'campaign_cached' },
                    { key: { campaign: 1, uf: 1 }, name: 'campaign_uf' },
                    { key: { campaign: 1, biome: 1 }, name: 'campaign_biome' },
                    { key: { campaign: 1, county: 1, uf: 1 }, name: 'campaign_county_uf' },
                    { key: { campaign: 1, mode: 1 }, name: 'campaign_mode' },
                    // Índice para contagem de inspeções
                    { key: { campaign: 1, 'inspection.counter': 1 }, name: 'campaign_inspection_counter' },
                    // Índice para data de importação
                    { key: { dateImport: -1 }, name: 'dateImport_desc' },
                    // Índice para cache
                    { key: { cached: 1, enhance_in_cache: 1 }, name: 'cached_enhance' }
                ], function(err) {
                    if (err) {
                        console.error('Erro ao criar índices para points:', err);
                    } else {
                        console.log('Índices criados para collection points');
                    }
                    cb();
                });
            },
            // Índices para collection campaign
            function(cb) {
                if (!Repository.collections.campaign) return cb();
                
                Repository.collections.campaign.createIndexes([
                    // O índice _id já existe automaticamente, não precisa criar
                    // Índice para busca por data de criação
                    { key: { createdAt: -1 }, name: 'createdAt_desc' },
                    // Índice para busca por tipo de imagem
                    { key: { imageType: 1 }, name: 'imageType' },
                    // Índice para prioridade de cache
                    { key: { cachePriority: 1 }, name: 'cachePriority' }
                ], function(err) {
                    if (err) {
                        console.error('Erro ao criar índices para campaign:', err);
                    } else {
                        console.log('Índices criados para collection campaign');
                    }
                    cb();
                });
            },
            // Índices para collection users
            function(cb) {
                if (!Repository.collections.users) return cb();
                
                Repository.collections.users.createIndexes([
                    { key: { username: 1 }, unique: true, name: 'username_unique' },
                    { key: { username: 1, role: 1 }, name: 'username_role' }
                ], function(err) {
                    if (err && err.code !== 11000) { // Ignorar erro de duplicação
                        console.error('Erro ao criar índices para users:', err);
                    } else {
                        console.log('Índices criados para collection users');
                    }
                    cb();
                });
            }
        ], function(err) {
            if (err) {
                console.error('Erro ao criar índices:', err);
            } else {
                console.log('Todos os índices foram criados com sucesso');
            }
            callback();
        });
    };

    return Repository;
};
