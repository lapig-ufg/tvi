var ejs = require('ejs');
var fs = require('fs');
var requester = require('request');
var querystring = require('querystring');
var child_process = require('child_process');
var spawn = require('child_process').spawn;

module.exports = function(app) {

	var eetms = "https://earthengine.googleapis.com";
	var TMS = {};
	var Internal = {};
	var mosaics = app.repository.collections.mosaics;
	var cache = app.middleware.cache;

	var ENHANCE_PARAMS = ['-', '-auto-level', '-auto-gamma', '-channel', 'RGB', '-contrast-stretch', '0.5x0.5%', '-']

	Internal.enhanceImg = function(img, callback) {
		
		convert = spawn('convert', ENHANCE_PARAMS);

		var result = new Buffer([]);
		convert.stdout.on('data', function(data) {
			var data = new Buffer(data);
			result = Buffer.concat([result, data])
    });
    convert.on('close', function(code) {
        return callback(result);
    });

    convert.stderr.on('data', function(data) {
		  console.log(data);
		});

    convert.stdin.write(img);
		convert.stdin.end();
	}

	Internal.enhanceAndResponse = function(img, response) {
		convert = spawn('convert', ENHANCE_PARAMS);
		convert.stdout.pipe(response);
		convert.stdin.write(img);
		convert.stdin.end();
	}

	TMS.process = function(request, response) {

	  var path = request.path;
	  var pathWithOutSlash = path.split('/'); 
	  var id = pathWithOutSlash[2];
	  var user = request.session.user;

	  mosaics.findOne({ "_id": id }, function(err, mosaic) {

	  	if(mosaic != undefined) {
	  		var token = mosaic.ee_token;
				var mapid = mosaic.ee_mapid;
				var url = eetms + request.path;
			  var params = querystring.stringify(request.query);
			  var body = '';

			  if(request.param('url'))
			    url = request.param('url');
			  else
			    url += "?token=" + token;

			  url = url.replace(id,mapid);

				cache.get(path, function(img) {
					if(img){ 
		 				
		 				if(user && user.campaign && user.campaign.enhance_in_cache == 1) {
		 					response.write(img);
		 					response.end();
		 				} else { // Legacy Behavior
		 					Internal.enhanceAndResponse(img, response);
		 				}

			 		} else {
			  		var img = new Buffer([]);
			  		requester({
					  		uri: url,
					  		timeout: 3600 * 1000,
					  		headers: {
						  			'Accept': request.headers['accept']
						  		,	'User-Agent': request.headers['user-agent']
						  		,	'X-Requested-With': request.headers['x-requested-with']
						  		,	'Accept-Language': request.headers['accept-language']
						  		,	'Accept-Encoding': request.headers['accept-encoding']
					  		}},
						  	function(error, proxyResponse, body) {
						  	
							  	if(error) {
							  		console.log('error',error);
							  		response.end();	
							  	}

						  	}).on('data', function(data) {    
							  	var data = new Buffer(data);
							  	img = Buffer.concat([img, data])

								}).on('end', function(data) {
									if(img.length > 0) {
										Internal.enhanceImg(img, function(imgEnhanced) {
												cache.set(path, imgEnhanced, function() {
													response.write(imgEnhanced)
													response.end()
												})
										});
									} else {
										response.end()
									}
								}
						)
			 		}

				});

	  	} else {
	  		response.end()
	  	}
	  	
	  });
	}

	return TMS;

}