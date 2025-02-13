const fs = require("fs");
const mongodb = require('mongodb');

const geojsonFile = process.argv[2];
const campaign = process.argv[3];

const collectionPointsName = "points";
const dbUrl = 'mongodb://172.16.106.2:27017/tvi';

const checkError = function(error) {
	if(error) {
		console.error(error);
		process.exit();
	}
}

const getInspections = function(geojsonDataStr) {
	const geojsonData = JSON.parse(geojsonDataStr);

	let points = [];
	for(let i = 0; i < geojsonData.features.length; i++) {
		const pointProperties = geojsonData.features[i].properties;
		let inspections = [];
		Object.keys(pointProperties).forEach(function(key) {
			if(key.toLowerCase().includes('CLASS_'.toLowerCase())){
				key = key.toLowerCase();
				inspections.push({
					"year": parseInt(key.replace('class_','')),
					"class": pointProperties[key.toUpperCase()]
				});
			}
		});

		points.push({
			"lon": geojsonData.features[i].geometry.coordinates[0],
			"lat": geojsonData.features[i].geometry.coordinates[1],
			"inspections": inspections
		});
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
			if (err) {
				console.error(err);
				db.close();
				return;
			}

			const points = getInspections(geojsonDataStr);
			const bulkOps = points.map(point => {
				const inspection = {
					"counter": 0,
					"form": point.inspections.map(item => ({
						"initialYear": item.year,
						"finalYear": item.year,
						"landUse": item.class
					})),
					"fillDate": new Date()
				};

				return {
					updateOne: {
						filter: { 'campaign': campaign, 'lon': point.lon, 'lat': point.lat },
						update: {
							'$push': {
								"inspection": inspection,
								"userName": "Classificação Automática"
							}
						}
					}
				};
			});

			collectionPoints.bulkWrite(bulkOps, { ordered: false }, function(err, result) {
				if (err) {
					console.error("[ERROR] Bulk write failed:", err);
				} else {
					console.log("[SUCCESS] Bulk write completed:", result);
				}
				db.close();
			});
		});
	});
});
