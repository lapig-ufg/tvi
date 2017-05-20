var fs = require("fs");
var exec = require('child_process').exec;
var async = require("async");
var mongodb = require('mongodb');
var moment = require('moment');

var geojsonFile = process.argv[2];
var campanha = process.argv[3];
var dbUrl = 'mongodb://localhost:27017/tvi';
var CollectionPointsData = "points";
var CollectionPointsImg = "pointsImg";
var CollectionModis = "pointsModis";
var moment = moment();
//var geojsonFile = JSON.parse(geojsonFile)

//arquivo teste do import.js

var removeEmpty = function(imgArray){
	var imgs = []
	for (var i = 0 - 1; i < imgArray.length; i++) {
		if((imgArray[i]) && (imgArray[i]!=undefined)){
			imgs.push(imgArray[i]);			
		}
	}
	
	return imgs;
}

var bitmapDisjoint = function(imgsSeco, imgsChuvoso, campanha, counter){
	var season=[];

	for(var i =0; i < imgsSeco.length; i+=2){
		seasonBitmap = {};	
		image = [];
		var seco;
		var secoRef;
		var chuvoso;
		var chuvosoRef;
		var dateSeco;
		var dateChuvoso;


		if((imgsSeco[i+0] == "") || (imgsSeco[i+0] == undefined)){
			secoRef = undefined;
		}else{
			dateSeco = parseDate(imgsSeco[i+0]);
			secoRef = fs.readFileSync(imgsSeco[i+0]);
			secoRef = new Buffer(secoRef).toString('base64')
			//fs.unlinkSync(imgsSeco[i+0]);
		}

		if((imgsSeco[i+1] == "") || (imgsSeco[i+1] == undefined)){
			seco = undefined;
		}else{
			seco = fs.readFileSync(imgsSeco[i+1]);
			seco = new Buffer(seco).toString('base64')
			//fs.unlinkSync(imgsSeco[i+1]);
		}

		image.push(
			{
				"date": dateSeco,
				"imageBase": seco,
				"period": "seco",
				"imageBaseRef": secoRef

			})


		if((imgsChuvoso[i+0] == "") || (imgsChuvoso[i+0] == undefined)){
			chuvosoRef = undefined;
		}else{			
			dateChuvoso = parseDate(imgsChuvoso[i+1]);
			chuvosoRef = fs.readFileSync(imgsChuvoso[i+0]);
			chuvosoRef = new Buffer(chuvosoRef).toString('base64')
			//fs.unlinkSync(imgsChuvoso[i+0]);
		}

		if((imgsChuvoso[i+1] == "") || (imgsChuvoso[i+1] == undefined)){			
			chuvoso = undefined
		}else{
			chuvoso = fs.readFileSync(imgsChuvoso[i+1]);
			chuvoso = new Buffer(chuvoso).toString('base64')
			//fs.unlinkSync(imgsChuvoso[i+1]);
		}	

		image.push(
			{
				"date": dateChuvoso,
				"imageBase": chuvoso,
				"period": "chuvoso",
				"imageBaseRef": chuvosoRef

			})

		seasonBitmap.pointId = counter+'_'+campanha;
		seasonBitmap.image = image

		season.push(seasonBitmap);

	}
	return season;

}

var parseDate = function(strings){
	var dateFromEE = strings.split('_');
	return new Date(dateFromEE[1]);
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

insertManyPoints = function(dbUrl, CollectionName, points, callback) {
  var MongoClient = mongodb.MongoClient;
  MongoClient.connect(dbUrl, function(err, db) {
      if(err)
        return console.dir(err);

      db.collection(CollectionName, function(err, collection) {
        collection.insertMany(points, null, function() {
          db.close();
          callback();
        });
      });
  });
}

var counter = 0;

fs.readFile(geojsonFile, 'utf-8', function(error, geojsonDataStr){
	if(error){	
		console.log('erro');
	}
	ano1 = 2000
	ano2 = 2016

	geojsonData = JSON.parse(geojsonDataStr)
	
	var coordinates = []
	for(var i = 0; i < geojsonData.features.length; i++){
		coordinates.push(
			{
				"id": geojsonData.features[i].properties['id'],
				"X": geojsonData.features[i].geometry.coordinates[0],
				"Y": geojsonData.features[i].geometry.coordinates[1],
				"value": geojsonData.features[i].properties.value
			}
		);
	}
	async.eachSeries(coordinates, function(coordinate, next) {

		var cmd = 'python ./../integration/py/png.py'+' '+counter+' '+coordinate.X+' '+coordinate.Y+' '+ano1+' '+ano2;
		console.log(cmd);
		exec(cmd, function(err, stdout, stderr){	
		  
		  if (err) {
		    console.error(err);
		    return;
		  }

			imgs = stdout.split("\n");


			var imgModis;
			var imgsSeco = [];
			var imgsChuvoso = [];
			imgs = imgs.sort()
			imgs.forEach(function(img) {
				if(img.match(/modis/gi)){ 
					imgModis = img;
				} else if(img.match(/seco/gi)){
					imgsSeco.push(img);
				}else{
					imgsChuvoso.push(img);
				}
			});			
			
			imgsChuvoso = removeEmpty(imgsChuvoso);
			imgsSeco = removeEmpty(imgsSeco);
			
			console.log('imgsChuvoso', imgsChuvoso);
			console.log('imgsSeco', imgsSeco);

			var season = bitmapDisjoint(imgsSeco, imgsChuvoso, campanha, counter);	

			var bitmapModis;
			try{
				
				bitmapModis = fs.readFileSync(imgModis);
			}
			catch(err){
				bitmapModis = 'undefined';
			}

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

				var lon = String(coordinate.X).substring(0, String(coordinate.X).length - 10)
				var lat = String(coordinate.Y).substring(0, String(coordinate.Y).length - 10)
				coord = lon+'_'+lat;

			  var point = { 
			  	"_id": counter+'_'+campanha,
			  	"campaign": campanha,	
			  	"lon": coordinate.X,
			  	"lat": coordinate.Y,
			  	"dateImport": new Date(),
			  	"biome": bioma,
			  	"uf": uf,
			  	"county": municipio,
			  	"countyCode": countycode,
			  	"userName":[],
				  "landUse":[],
				  "certaintyIndex":[],
				  "counter":[],
				  "underInspection": 0,
				  "index": counter,
				  "value": coordinate.value,
				  "coord": coord
			  }

			  pointChartModis = {
			  	"_id": counter+'_'+campanha,
			  	"modis": new Buffer(bitmapModis).toString('base64')
			  }

			 	
			  insertPoints(dbUrl, CollectionPointsData, point, function() {

			  	insertManyPoints(dbUrl, CollectionPointsImg, season, function() {

			  		insertPoints(dbUrl, CollectionModis, pointChartModis, function() {

					  	try{
						
								fs.unlinkSync("chart/"+imgModis);
							}
							catch(err){
								console.log("Nao teve graficos MODIS.")
							}
			
					  	console.log(counter + " ("+new Date()+") - Coordinate " + coordinate.id + " inserted");
					  	counter++;
					  	next();

			  		})
				  });
				});
				
			});	  
		}); 
	});
})