var MongoClient = require('mongodb').MongoClient;
var execSync = require('child_process').execSync;

var url = "mongodb://172.18.0.6:27017/tvi";

var index = process.argv[2]
var campaign = process.argv[3]

MongoClient.connect(url, function(err, db) {
  if (err) throw err;
  db.collection("points").findOne({ "index": Number(index), "campaign" : campaign }, function(err, result) {
    
  	var lon = result.lon
		var lat = result.lat
		
		var IMG_DIR = '/data/cache-tvi'
		var zoom = 13;
		var periods = ['DRY','WET']

		var long2tile = function(lon,zoom) { 
			return (Math.floor((lon+180)/360*Math.pow(2,zoom))); 
		}
			
		var lat2tile = function (lat,zoom) { 
			return (Math.floor((1-Math.log(Math.tan(lat*Math.PI/180) + 1/Math.cos(lat*Math.PI/180))/Math.PI)/2 *Math.pow(2,zoom))); 
		}

		var xtile = long2tile(lon, zoom);
		var ytile = lat2tile(lat, zoom);

		var satellite
		var requestTasks = [];
		var urls = [];

		var initialYear = 2000;
		var finalYear = 2016;

		periods.forEach(function(period){
			for (var x = (xtile-1); x <= (xtile+1); x++) {
				for (var y = (ytile-1); y <= (ytile+1); y++) {
		 			for (var year = initialYear; year <= finalYear; year++) {
		 				
		 				satellite = 'L7';
						if(year > 2012) { 
							satellite = 'L8'
						} else if(year > 2011) {
							satellite = 'L7'
						} else if(year > 2003  || year < 2000) {
							satellite = 'L5'
						}
						
						var file = IMG_DIR+"/map/"+satellite+"_"+year+"_"+period+"/"+zoom+"/"+x+"/"+y+"/"+y
						console.log(file)
						execSync('convert -auto-level -auto-gamma -channel RGB -contrast-stretch 0.5x0.5% '+file+' '+file)
						/*try {
							
							console.log('convert -auto-level -auto-gamma -channel RGB -contrast-stretch 0.5x0.5% '+file+' '+file)
						} catch(err) {
							console.log(err)
						}*/
					}
				}
			}
		});

    db.close();
  });
});

