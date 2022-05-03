const {MongoClient} = require('mongodb');

const util = require('util')
    , mongodb = require('mongodb')
    , async = require('async');

module.exports = function (app) {

    var Db = mongodb.Db,
        Connection = mongodb.Connection,
        Server = mongodb.Server,
        config = app.config,
        Repository = {
            collections: {}
        };

    const uri = `mongodb://${config.mongo.host}:${config.mongo.port}/?poolSize=20&writeConcern=majority`;
    Repository.client = MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true });

    // console.log(app.config)
    // 	Repository.db = new Db(config.mongo.dbname
    // 			, new Server(config.mongo.host, config.mongo.port, {'auto_reconnect': true, 'pool_size': 5 })
    // 			, { safe: true }
    // 	);
    //
    // 	Repository.bin = function(data) {
    // 		return new mongodb.Binary(data);
    // 	}
    //
    // 	Repository.id = function(id) {
    // 		var x = new mongodb.ObjectID(id);
    // 		console.log(typeof x);
    // 			return x;
    // 	};

    Repository.init = function (callback) {
        Repository.client.connect((err,  client) => {
            if (err) {
                return callback(err);
            }
            Repository.db = client.db(config.mongo.dbname);
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
        })
    };

    Repository.getSync = function (collectionName) {
        return Repository.collections[collectionName];
    };

    Repository.get = function (collectionName, callback) {
        Repository.db.collection(collectionName, callback);
    };

    return Repository;
};
