const fs = require("fs");
const mongodb = require('mongodb');

const geojsonFile = process.argv[2];
const campaign = process.argv[3];

const collectionPointsName = "points";
const dbUrl = 'mongodb://172.16.106.2:27017/tvi';
const CHUNK_SIZE = 1000; // Número de pontos por chunk

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

const processChunk = async (collectionPoints, chunk, campaign) => {
	const bulkOps = chunk.map(point => {
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

	try {
		const result = await collectionPoints.bulkWrite(bulkOps, { ordered: false });
		console.log(`[SUCCESS] Chunk processed: ${result.modifiedCount} documents updated.`);
	} catch (err) {
		console.error("[ERROR] Chunk processing failed:", err);
	}
};

fs.readFile(geojsonFile, 'utf-8', async function(error, geojsonDataStr){
	checkError(error);

	getDB(dbUrl, async function(db) {
		const collectionPoints = db.collection(collectionPointsName);
		const points = getInspections(geojsonDataStr);

		// Dividir os pontos em chunks
		for (let i = 0; i < points.length; i += CHUNK_SIZE) {
			const chunk = points.slice(i, i + CHUNK_SIZE);
			console.log(`Processing chunk ${i / CHUNK_SIZE + 1} of ${Math.ceil(points.length / CHUNK_SIZE)}`);
			await processChunk(collectionPoints, chunk, campaign);
		}

		db.close();
	});
});
