var fs = require("fs");
var exec = require('child_process').exec;
var async = require("async");
var mongodb = require('mongodb');
var moment = require('moment');

var geojsonFile = process.argv[2];
var campanha = process.argv[3];
var dbUrl = 'mongodb://localhost:27017/tvi';
var CollectionName = "points"
var d = moment();

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

fs.readFile(geojsonFile, 'utf-8', function(error, data){
	if(error){
		console.log('erro');
	}
	
	ano1 = 2014
	ano2 = 2015
	var coordinates = []
	var imgModis;
	data = JSON.parse(data)
	
	for(var i = 0; i < data.features.length; i++){
		coordinates.push(data.features[i].geometry.coordinates)	
	}

	points = []

	async.eachSeries(coordinates, function(coordinate, next) {
		coordinates = []
		var cmd = 'python ./../integration/py/satImageGen.py'+' '+coordinate[0]+' '+coordinate[1]+' '+ano1+' '+ano2 ;

		exec(cmd, function(err, stdout, stderr){	
		  
		  if (err) {
		    console.error(err);
		    return;
		  }
		  
			imgs = stdout.split("\n");
			console.log(imgs)

			for(var i = 0; i < (imgs.length-1); i = 2 + i){
				if(imgs[i].match(/modis/gi)){
					var bitmap = fs.readFileSync("chart/"+imgs[i]);	
					var imgbase = new Buffer(bitmap).toString('base64');
					imgModis = imgbase;
					fs.unlinkSync("chart/"+imgs[i]);	
				}else{
					var date = imgs[i].slice(33,43);
					var periodo;
					if(parseInt(imgs[i].slice(38,40)) >= 10){
						periodo = "chuvoso";
					}else{
						periodo = "seco";
					}
					console.log(imgs[i], imgs[i+1])
			  	var bitmap = fs.readFileSync(imgs[i]);
	  			var imgbase = new Buffer(bitmap).toString('base64');
	  			var bitmappoint = fs.readFileSync(imgs[i+1]);
	  			var imgbasepoint = new Buffer(bitmappoint).toString('base64');
		  		coordinates.push({"data": d.format(), "imageBase": imgbase, "periodo": periodo, "data": date, "imagePoint": imgbasepoint})
		  		fs.unlinkSync(imgs[i]);
		  		fs.unlinkSync(imgs[i]+".aux.xml")
		  		fs.unlinkSync(imgs[i+1]);
		  		fs.unlinkSync(imgs[i+1]+".aux.xml")				
				}
									
			}
			
			regions = "REGIONS/regions2.shp";
			sql = "select COD_MUNICI,BIOMA,UF,MUNICIPIO from regions2 where ST_INTERSECTS(Geometry,GeomFromText('POINT("+coordinate[0]+" "+coordinate[1]+")',4326))"
			cmd = 'ogrinfo -q -geom=no -dialect sqlite -sql "'+sql+'" '+regions;
			console.log(cmd);
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
				date = new Date();
			  points.push(
			  { "campaign": campanha,	
			  	"images": coordinates,
			  	"lon": coordinate[0],
			  	"lat": coordinate[1],
			  	"dateImport": date,
			  	"biome": bioma,
			  	"UF": uf,
			  	"county": municipio,
			  	"Modis": imgModis,
			  	"countyCode": countycode
			  })
			  

			  next();

			});	  
		  
			

		});
    
	}, function() {
  	insertPoints(dbUrl, CollectionName, points, function() {
			console.log('terminou')
		});
	});
});