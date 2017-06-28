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

	Internal.enhanceAndResponse = function(img, response) {
		convert = spawn('convert', ['-auto-level','-auto-gamma', '-channel', 'RGB', '-contrast-stretch', '0.5x0.5%', '-','-']);
		convert.stdout.pipe(response);
		convert.stdin.write(img);
		convert.stdin.end();
	}

	TMS.process = function(request, response) {

	  var path = request.path;
	  var pathWithOutSlash = path.split('/'); 
	  var id = pathWithOutSlash[2];

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
		 				Internal.enhanceAndResponse(img, response)
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
									Internal.enhanceAndResponse(img, response)
									if(img.length > 0) {
										cache.set(path, img)
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