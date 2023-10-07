let MongoClient = require('mongodb').MongoClient;
const exec = require('child_process').exec;

const checkError = function(error) {
	if(error) {
		console.error(error);
		process.exit();
	}
}

const extractValue = function(str){
	let regex = /\=\s*(\[\{.*\}\])/; // matches anything inside "[{...}]"
	let match = str.match(regex);

	let result = null;

	if (match) {
	  result = JSON.parse(match[1]);
	}
	return result; 
}

const getInfoByRegionCmd = function(coordinate) {
	regions = "SHP/biomas_colombia/biomas_colombia.shp";

	sql = "select json_group_array(json_object( 'id', objectid, 'biome', nombre, 'country', pais )) from biomas_colombia where ST_INTERSECTS(Geometry,GeomFromText('POINT("+coordinate.X+" "+coordinate.Y+")',4326))"
	return 'ogrinfo -q -geom=no -dialect sqlite -sql "'+sql+'" '+ regions;
}

const getInfoByRegion = function(coordinate, callback) {
	exec(getInfoByRegionCmd(coordinate), function(error, stdout, stderr) {
		checkError(error);
		const results = extractValue(stdout);
		let object = results ? results[0] : null;
		if(object){
			callback({
				"biome": object.id + " - " + object.biome,
				"uf": '',
				"county": object.country,
				"countyCode": ''
			});
		}else{
			callback({
				"biome":'No encontrado',
				"uf": 'No encontrado',
				"county": 'No encontrado',
				"countyCode": 'No encontrado'
			});
		}		
	});
}

const url = 'mongodb://172.18.0.6:27017';
	
(async () => {
	let client = await MongoClient.connect(url);

	try {

		const db = client.db("tvi");

		let collection = db.collection('points');

		const campaign = process.argv[2];

		let points = await collection.find({"campaign": campaign });

		const promises = [];

		for (let data = await points.next(); data != null; data = await points.next()) {
			promises.push(new Promise((resolve, reject) => {
			 	const coordinate = {X: data.lon, Y: data.lat};
				getInfoByRegion(coordinate, async (regionInfo) => {
					try {
						let ob = await collection.updateOne(
							{ "_id" : data._id },
							{ $set: { biome: regionInfo.biome, uf: regionInfo.uf, county: regionInfo.county } }
						);
						resolve(data._id + ' | ' + JSON.stringify(ob) + ' | ' + JSON.stringify(regionInfo), '\n')
					} catch (e) {
						reject(e.message)
					}
				});
			}))
		}

		Promise.all(promises).then(result => {
			client.close();
			console.log(result)	
		}).catch(err => {
			client.close();
			console.error(err)
		});

	} catch (err){
		console.error(err)
	}
})()
	.catch(err => console.error(err));