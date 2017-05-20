var fs = require("fs");
var async = require("async");
var mongodb = require('mongodb');

var geojsonFile = process.argv[2];
var dbUrl = 'mongodb://localhost:27018/tvi';
var CollectionName = "points_result"

var MongoClient = mongodb.MongoClient;

MongoClient.connect(dbUrl, function(err, db) {
    if(err)
      return console.dir(err);

    fs.readFile(geojsonFile, 'utf-8', function(error, geojsonDataStr){
	
			geojsonData = JSON.parse(geojsonDataStr)

			var i=0;
			async.each(geojsonData.features, function(features, next) {
				db.collection(CollectionName, function(err, collection) {
					collection.findOne({ "value.lon": features.geometry.coordinates[0], "value.lat": features.geometry.coordinates[1] }, function(err, point) {
						if(point) {
							console.log(features.properties.id+
								"#"+features.geometry.coordinates[0]+
								"#"+features.geometry.coordinates[1]+
								'#'+features.properties.classValue+
								"#"+point.value.class+
								"#"+point.value.votes+
								"#"+point.value.certainty);
						}
						next();
					});
				});
			}, function() {
				db.close();
			});

		});
});