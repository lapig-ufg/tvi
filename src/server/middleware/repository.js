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

                async.each(names, forEachOne, callback)
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

    return Repository;
};
