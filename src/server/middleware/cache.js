var util  = require('util')
	, redis = require('redis')
	, request = require('request')
	, async = require('async');
var fs = require('fs');
var exec = require('child_process').exec;

var count = 0
module.exports = function(app) {

	var config = app.config;

	var redisClient = redis.createClient(config.redis.port, config.redis.host);
	var Cache = {};

	Cache.get = function(cacheKey, callback) {
		var path = config.imgs+cacheKey+'/';
		var img = cacheKey.slice(24, 29);	
		fs.readFile(path+img, function (err,data) {
		  if (!err && data) {
		  	callback(data);	  	
		  }else{
		    callback(undefined);
		  }
		});
	};

	Cache.set = function(cacheKey, data){
		cacheKey = cacheKey.substr(1);
		exec('mkdir -p '+config.imgs+cacheKey, function(err, stdout, stderr){
			var path = config.imgs+cacheKey+'/';
			var img = cacheKey.slice(24, 29);	
			fs.writeFile(path+img, data, function(err) {
			  if(err) {
			    return console.log(err);
			  }
			  console.log("The file was saved!");
			});
			 			
		})
	}

	Cache.del = function(keyPattern, data) {
		redisClient.keys(keyPattern, function(err, keys) {
			keys.forEach(function(key) {
				redisClient.del(key);
			})
		});
	}
	
	Cache.populateCache = function(pointCacheCompĺete, finished) {

		var zoom = 13;
		var initialYear = 2000;
		var finalYear = 2016;
		var periods = ['DRY','WET']
		var parallelRequestsLimit = 8;

		var long2tile = function(lon,zoom) { 
			return (Math.floor((lon+180)/360*Math.pow(2,zoom))); 
		}
 		
 		var lat2tile = function (lat,zoom) { 
 			return (Math.floor((1-Math.log(Math.tan(lat*Math.PI/180) + 1/Math.cos(lat*Math.PI/180))/Math.PI)/2 *Math.pow(2,zoom))); 
 		}

 		var getRequestTasks = function(point) {
 			var xtile = long2tile(point.lon, zoom);
 			var ytile = lat2tile(point.lat, zoom);

 			var satellite
 			var requestTasks = [];
 			var urls = [];
			periods.forEach(function(period){
	 			for (var year = initialYear; year <= finalYear; year++) {
	 				satellite = 'L7';
					if(year > 2012) { 
						satellite = 'L8'
					} else if(year > 2011) {
						satellite = 'L7'
					} else if(year > 2003) {
						satellite = 'L5'
					}

						for (var x = (xtile-1); x <= (xtile+1); x++) {
							for (var y = (ytile-1); y <= (ytile+1); y++) {
								var url = "http://localhost:" + config.port + "/map/"+satellite+"_"+year+"_"+period+"/"+zoom+"/"+x+"/"+y;
								urls.push(url);
							}
						}
				}
			});

			urls.forEach(function(url) {
				requestTasks.push(function(next) {
					var params = { timeout: 3600 * 1000 };
					var callback = function(error, response, html) {
						if(error) {
							request(url, params, callback);
						} else {
				    	next();
						}
				  }
					request(url, params, callback);
				});
			});

			return requestTasks;
 		}

 		var cacheJobCanStopFlag = false;
 		var startCacheJob = function(next) {
	 		app.repository.collections.points.findOne({ "cached" : false }, { lon:1, lat: 1}, { sort: [['index', 1]] }, function(err, point) {
	 			if(point) {
					var requestTasks = getRequestTasks(point);
					async.parallelLimit(requestTasks, parallelRequestsLimit, function() {
						app.repository.collections.points.update({ _id: point._id}, { '$set': { "cached": true }  });
						pointCacheCompĺete(point._id);
						next();
					});
	 			} else {
	 				cacheJobCanStopFlag = true;
	 				next()
	 			}
	 		});
 		}

 		var cacheJobCanStop = function() {
 			return cacheJobCanStopFlag;
 		}

 		var onComplete = function() {
 			finished();
 		}

 		async.doUntil(startCacheJob, cacheJobCanStop, onComplete);

	}

	return Cache;
	
}; 