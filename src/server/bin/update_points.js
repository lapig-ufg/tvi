let MongoClient = require('mongodb').MongoClient;
const exec = require('child_process').exec;

const checkError = function(error) {
	if(error) {
		console.error(error);
		process.exit();
	}
}

const getInfoByRegionCmd = function(coordinate) {
	regions = "SHP/regions.shp";
	sql = "select COD_MUNICI,BIOMA,UF,MUNICIPIO, id_regionC as ID_REGION, pais from regions where ST_INTERSECTS(Geometry,GeomFromText('POINT("+coordinate.X+" "+coordinate.Y+")',4326))"
	return 'ogrinfo -q -geom=no -dialect sqlite -sql "'+sql+'" '+regions;
}

const getInfoByRegion = function(coordinate, callback) {
	exec(getInfoByRegionCmd(coordinate), function(error, stdout, stderr) {
		checkError(error);

		let strs = stdout.split("\n");

		let biome;
		let uf;
		let county;
		let countycode;
		let idRegionC;
		let country;

		for(var i = 0; i < strs.length; i++) {
			if(strs[i].match(/BIOMA/g)) {
				biome = strs[i].slice(18,strs[i].length);
				biome = biome.trim();
			}else if(strs[i].match(/UF/g)) {
				uf = strs[i].slice(15,18);
				uf = uf.trim();
			}else if(strs[i].match(/MUNICIPIO/g)) {
				county = strs[i].slice(22,strs[i].length);
				county = county.trim();
			}else if(strs[i].match(/COD_MUNICI/g)) {
				countycode = strs[i].slice(26,35);
				countycode = countycode.trim();
			}else if(strs[i].match(/ID_REGION/g)) {
				idRegionC = strs[i].slice(26,strs[i].length);
				idRegionC = idRegionC.trim();
			}else if(strs[i].match(/pais/g)) {
				country = strs[i].slice(18,strs[i].length);
				country = country.trim();
			}
		}
		var result = {
			"biome": idRegionC + " - " + county,
			"uf": uf === '(n' ? '' : uf,
			"county": country ,
			"countyCode": countycode
		};

		callback(result);
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