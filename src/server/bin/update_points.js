var mongodb = require('mongodb');
const exec = require('child_process').exec;

const checkError = function(error) {
	if(error) {
		console.error(error);
		process.exit();
	}
}

const getDB = function(dbUrl, callback) {
	var MongoClient = mongodb.MongoClient;
	MongoClient.connect(dbUrl, function(err, db) {
		if(err)
			return console.dir(err);
		callback(db);
	});
}

const getInfoByRegionCmd = function(coordinate) {
	regions = "SHP/regions.shp";
	sql = "select COD_MUNICI,BIOMA,UF,MUNICIPIO from regions where ST_INTERSECTS(Geometry,GeomFromText('POINT("+coordinate.X+" "+coordinate.Y+")',4326))"
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

		console.log(strs)

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
			}
		}

		var result = {
			"biome": biome,
			"uf": uf,
			"county": county,
			"countyCode": countycode
		};
		
		callback(result);
	});
}

getDB('mongodb://172.18.0.6:27017/tvi', function(db) {
	db.collection('points', function(err, collectionPoints) {
		const points = collectionPoints.find({"campaign": 'amazonia_peru_raisg'});

		points.forEach(function (index, point) {
			if( index > 1){
				process.exit();
			}
			console.log(JSON.stringify(point))
			const coordinate = {X: point.lon, Y: point.lat};
			getInfoByRegion(coordinate, function (regionInfo) {

			});
		})

	})
});
