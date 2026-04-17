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
        // ObjectID created
        return x;
    };

    Repository.init = function (callback) {
        Repository.db.open(function (err) {
            if (err) {
                console.error('MongoDB connection error:', err);
                return callback(err);
            }
            console.log('MongoDB connected successfully');

            Repository.db.listCollections({}).toArray(function (err, names) {

                var forEachOne = function (collection, callback) {
                    var name = collection.name.substr(collection.name.indexOf('\.') + 1);
                    if (name != 'indexes') {
                        Repository.db.collection(name, function (err, repository) {
                            if (err) {
                                console.error('Collection error for', name, ':', err);
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
                    // weekly_progress adicionada em TKT-000009 para persistir progresso e carry-over.
                    var requiredCollections = ['campaign', 'points', 'users', 'cacheConfig', 'logs', 'logsConfig', 'tvi_blocos', 'tickets', 'ticket_counters', 'weekly_progress'];
                    var ensureCollection = function(collectionName, callback) {
                        if (!Repository.collections[collectionName]) {
                            Repository.db.collection(collectionName, function (err, repository) {
                                if (err) {
                                    console.error('Required collection error for', collectionName, ':', err);
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
                                console.error('Timeseries collection error for', name, ':', err);
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
        // Criando índices para otimização de performance
        
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
                    // Índice para filtro de pontos editados pelo supervisor (TKT-000012)
                    { key: { campaign: 1, pointEdited: 1 }, name: 'campaign_pointEdited' },
                    // Índice para contagem de inspeções
                    { key: { campaign: 1, 'inspection.counter': 1 }, name: 'campaign_inspection_counter' },
                    // Índice para data de importação
                    { key: { dateImport: -1 }, name: 'dateImport_desc' },
                    // Índice para cache
                    { key: { cached: 1, enhance_in_cache: 1 }, name: 'cached_enhance' },
                    // Índices sparse para subestrutura `doubt` (TKT-000011).
                    // sparse:true evita indexar a maioria dos pontos que não
                    // possuem dúvida, mantendo o índice pequeno.
                    { key: { campaign: 1, 'doubt.status': 1 }, name: 'campaign_doubt_status', sparse: true },
                    { key: { campaign: 1, 'doubt.openedAt': -1 }, name: 'campaign_doubt_openedAt', sparse: true },
                    // TKT-000015 — índice para o próximo ponto sem $where
                    // (campaign, underInspection, userNameCount, index)
                    { key: { campaign: 1, underInspection: 1, userNameCount: 1, index: 1 }, name: 'campaign_inspection_index' },
                    // TKT-000008/000009 — filtragem por fillDate em janelas semanais
                    { key: { campaign: 1, 'inspection.fillDate': 1 }, name: 'campaign_inspection_fillDate' }
                ], function(err) {
                    if (err) {
                        console.error('Erro ao criar índices para points:', err);
                    } else {
                        // Índices criados para collection points
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
                        // Índices criados para collection campaign
                    }
                    cb();
                });
            },
            // Índices para collection tvi_blocos
            function(cb) {
                if (!Repository.collections.tvi_blocos) return cb();

                Repository.collections.tvi_blocos.createIndexes([
                    // Atribuição atômica: próximo bloco disponível por campanha/rodada
                    { key: { campaignId: 1, inspectionRound: 1, status: 1, blockIndex: 1 }, name: 'campaign_round_status_blockIndex' },
                    // Buscar bloco ativo do inspetor
                    { key: { campaignId: 1, assignedTo: 1, status: 1 }, name: 'campaign_assignedTo_status' },
                    // Operações de timeout
                    { key: { status: 1, assignedAt: 1 }, name: 'status_assignedAt' }
                ], function(err) {
                    if (err) {
                        console.error('Erro ao criar índices para tvi_blocos:', err);
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
                        // Índices criados para collection users
                    }
                    cb();
                });
            },
            // Índices para collection tickets
            function(cb) {
                if (!Repository.collections.tickets) return cb();

                Repository.collections.tickets.createIndexes([
                    { key: { ticketNumber: 1 }, unique: true, name: 'ticketNumber_unique' },
                    { key: { status: 1, createdAt: -1 }, name: 'status_createdAt' },
                    { key: { origin: 1, status: 1, createdAt: -1 }, name: 'origin_status_createdAt' },
                    { key: { 'author.name': 1, createdAt: -1 }, name: 'author_name_createdAt' },
                    { key: { type: 1, status: 1 }, name: 'type_status' }
                ], function(err) {
                    if (err && err.code !== 11000) {
                        console.error('Erro ao criar índices para tickets:', err);
                    }
                    cb();
                });
            },
            // TKT-000009 — índices para weekly_progress
            function(cb) {
                if (!Repository.collections.weekly_progress) return cb();

                Repository.collections.weekly_progress.createIndexes([
                    { key: { userName: 1, campaign: 1, weekStart: -1 }, name: 'user_campaign_weekStart' },
                    { key: { campaign: 1, weekStart: -1 }, name: 'campaign_weekStart' },
                    { key: { closed: 1, weekEnd: 1 }, name: 'closed_weekEnd' }
                ], function(err) {
                    if (err && err.code !== 11000) {
                        console.error('Erro ao criar índices para weekly_progress:', err);
                    }
                    cb();
                });
            }
        ], function(err) {
            if (err) {
                console.error('Erro ao criar índices:', err);
            } else {
                // Todos os índices foram criados com sucesso
            }
            callback();
        });
    };

    return Repository;
};
