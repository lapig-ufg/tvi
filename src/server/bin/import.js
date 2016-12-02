var fs = require("fs");
var exec = require('child_process').exec;
var async = require("async");
var mongodb = require('mongodb');
var moment = require('moment');

var geojsonFile = process.argv[2];
var campanha = process.argv[3];
var dbUrl = 'mongodb://localhost:27018/tvi';
var CollectionName = "points"
var moment = moment();

var bitmapDisjoint = function(imgsSeco, imgsChuvoso){
	seasonBitmap = {};
	
	if((imgsSeco[0] == "") || (imgsSeco[0] == undefined)){
		seasonBitmap.imgsSeco = undefined;
	}else{
		seasonBitmap.imgsSeco = fs.readFileSync(imgsSeco[0]);
		seasonBitmap.imgsSeco = new Buffer(seasonBitmap.imgsSeco).toString('base64')
		fs.unlinkSync(imgsSeco[0]);
	}

	if((imgsSeco[1] == "") || (imgsSeco[1] == undefined)){
		seasonBitmap.imgsSecoRef = undefined;
	}else{
		seasonBitmap.imgsSecoRef = fs.readFileSync(imgsSeco[1]);
		seasonBitmap.imgsSecoRef = new Buffer(seasonBitmap.imgsSecoRef).toString('base64')
		fs.unlinkSync(imgsSeco[1]);
	}


	if((imgsChuvoso[0] == "") || (imgsChuvoso[0] == undefined)){
		seasonBitmap.imgsChuvoso = undefined;
	}else{
		seasonBitmap.imgsChuvoso = fs.readFileSync(imgsChuvoso[0]);
		seasonBitmap.imgsChuvoso = new Buffer(seasonBitmap.imgsChuvoso).toString('base64')
		fs.unlinkSync(imgsChuvoso[0]);
	}

	if((imgsChuvoso[1] == "") || (imgsChuvoso[1] == undefined)){
		console.log(imgsChuvoso[1])
		seasonBitmap.imgsChuvosoRef = undefined;
	}else{
		seasonBitmap.imgsChuvosoRef = fs.readFileSync(imgsChuvoso[1]);
		seasonBitmap.imgsChuvosoRef = new Buffer(seasonBitmap.imgsChuvosoRef).toString('base64')
		fs.unlinkSync(imgsChuvoso[1]);
	}	

	return seasonBitmap;

}

insertPoints = function(dbUrl, CollectionName, points, callback) {
  var MongoClient = mongodb.MongoClient;
  MongoClient.connect(dbUrl, function(err, db) {
      if(err)
        return console.dir(err);

      db.collection(CollectionName, function(err, collection) {
        collection.insert(points, null, function() {
          db.close();
          callback();
        });
      });
  });
}

var counter = 1;
fs.readFile(geojsonFile, 'utf-8', function(error, geojsonDataStr){
	if(error){
		console.log('erro');
	}
	ano1 = 2015
	ano2 = 2016

	geojsonData = JSON.parse(geojsonDataStr)
	
	var coordinates = []
	for(var i = 0; i < geojsonData.features.length; i++){
		coordinates.push(
			{
				"id": geojsonData.features[i].properties['id'],
				"X": geojsonData.features[i].geometry.coordinates[0],
				"Y": geojsonData.features[i].geometry.coordinates[1]
			}
		);
	}

	async.eachSeries(coordinates, function(coordinate, next) {

		var cmd = 'python ./../integration/py/satImageGen.py'+' '+coordinate.id+' '+coordinate.X+' '+coordinate.Y+' '+ano1+' '+ano2;

		exec(cmd, function(err, stdout, stderr){	
		  
		  if (err) {
		    console.error(err);
		    return;
		  }
		  
			imgs = stdout.split("\n");

			var imgModis;
			var imgsSeco = [];
			var imgsChuvoso = [];

			imgs.forEach(function(img) {
				if(img.match(/modis/gi)){ 
					imgModis = img;
				} else if(img.match(/seco/gi)){
					imgsSeco.push(img);
				}else{
					imgsChuvoso.push(img);
				}
			});

			
			var seasonBitmap = bitmapDisjoint(imgsSeco, imgsChuvoso);

			var bitmapModis = fs.readFileSync("chart/"+imgModis);
			
			regions = "REGIONS/regions.shp";
			sql = "select COD_MUNICI,BIOMA,UF,MUNICIPIO from regions where ST_INTERSECTS(Geometry,GeomFromText('POINT("+coordinate.X+" "+coordinate.Y+")',4326))"
			cmd = 'ogrinfo -q -geom=no -dialect sqlite -sql "'+sql+'" '+regions;
			exec(cmd, function(err, stdout, stderr){	
			  if (err) {
			    console.error(err);
			    return;
			  }  
			 	strs = stdout.split("\n");
			 	var bioma;
			 	var uf;
			 	var municipio;
			 	var countycode;	  
			 	for(var i = 0; i < (strs.length-8); i++){
			 		if(strs[i].match(/BIOMA/g)){
			 			bioma = strs[i].slice(18,40);
			 			bioma = bioma.trim();
			 		}else if(strs[i].match(/UF/g)){
			 			uf = strs[i].slice(15,18);
			 			uf = uf.trim();
			 		}else if(strs[i].match(/MUNICIPIO/g)){
			 			municipio = strs[i].slice(22,40);
			 			municipio = municipio.trim();
			 		}else if(strs[i].match(/COD_MUNICI/g)){
			 			countycode = strs[i].slice(24,31);
			 			countycode = countycode.trim();
			 		}
			 	}


			 	var dateSeco;
			 	var dateChuvoso;

			 	dateSeco = new Date(imgsSeco[0].split('_')[3]);
				dateChuvoso = new Date(imgsChuvoso[0].split('_')[3]);
				

			  var point = { 
			  	"campaign": campanha,	
			  	"images": [
			  		{
			  			"date": dateSeco,
			  			"imageBase": seasonBitmap.imgsSeco,
			  			"period": 'seco', 
			  			"imageBaseRef": seasonBitmap.imgsSecoRef,
		  			},
		  			{
			  			"date": dateChuvoso, 
			  			"imageBase": seasonBitmap.imgsChuvoso,
			  			"period": 'chuvoso', 
			  			"imageBaseRef":seasonBitmap.imgsChuvosoRef,
		  			}
			  	],
			  	"lon": coordinate.X,
			  	"lat": coordinate.Y,
			  	"dateImport": new Date(),
			  	"biome": bioma,
			  	"uf": uf,
			  	"county": municipio,
			  	"modis": new Buffer(bitmapModis).toString('base64'),
			  	"countyCode": countycode,
			  	"userName":[],
				  "landUse":[],
				  "certaintyIndex":[],
				  "counter":[],
				  "underInspection": 0,
				  "index": counter
			  }
			  
			  insertPoints(dbUrl, CollectionName, point, function() {
			  	
			  	fs.unlinkSync("chart/"+imgModis);
	
			  	console.log(counter + " ("+new Date()+") - Coordinate " + coordinate.id + " inserted");
			  	counter++;
			  	next();
				});
			  

			});	  
		}); 
	});
});