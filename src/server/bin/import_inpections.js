const fs = require("fs");
const async = require("async");
const mongodb = require('mongodb');
const exec = require('child_process').exec;

/**
 * Args
 * geojsonFile - path
 * campaign - identification of campaign
 */

const geojsonFile = process.argv[2];
const campaign = process.argv[3];

const collectionPointsName = "points";
const dbUrl = 'mongodb://172.18.0.6:27017/tvi';

const checkError = function(error) {
	if(error) {
		console.error(error);
		process.exit();
	}
}

const getInspections = function(geojsonDataStr) {
	const geojsonData = JSON.parse(geojsonDataStr)

	let points = []
	for(let i = 0; i < geojsonData.features.length; i++) {
		const pointProperties = geojsonData.features[i].properties;
		let inspections = [];
		Object.keys(pointProperties).forEach(function(key) {
			if(key.includes('Cons_')){
				inspections.push({
					"year": parseInt(key.replace('Cons_','')),
					"class": pointProperties[key]
				})
			}
		});

		points.push(
			{
				"lon": geojsonData.features[i].geometry.coordinates[0],
				"lat": geojsonData.features[i].geometry.coordinates[1],
				"inspections": inspections
			}
		);
	}

	return points;
}

const getDB = function(dbUrl, callback) {
	const MongoClient = mongodb.MongoClient;
	MongoClient.connect(dbUrl, function(err, db) {
			if(err)
				return console.dir(err);
			callback(db);
	});
}


fs.readFile(geojsonFile, 'utf-8', function(error, geojsonDataStr){
	checkError(error);

	getDB(dbUrl, function(db) {
		db.collection(collectionPointsName, function(err, collectionPoints) {

			const insertInspections = (point, next) => {

				let inspection = {
					"counter" : 0,
					"form" : point.inspections.map((item) =>{
						return {
							"initialYear" : item.year,
							"finalYear" : item.year,
							"landUse" : item.class
						}
					}) ,
					"fillDate" : new Date()
				};

				const update = {
					'$push': {
						"inspection": inspection,
						"userName": "Clasificação Anterior"
					}
				};

				collectionPoints.update({ 'campaign': campaign, 'lon': point.lon, lat: point.lat }, update, function(err, pto) {
					if(err){
						console.log("[ERROR] " + JSON.stringify(pto) + " not updated.");
					} else{
						console.log("[SUCCESS] " + JSON.stringify(pto) + " updated.");
					}
					next();
				});

			}

			const onComplete = function() {
				db.close();
			};

			async.eachSeries(getInspections(geojsonDataStr), insertInspections, onComplete);
		});
	});
});
