var ejs = require('ejs');
var fs = require('fs');
var requester = require('request');
var querystring = require('querystring');
var child_process = require('child_process');
var spawn = require('child_process').spawn;
var exec = require('child_process').exec;
var proj4 = require('proj4');
var path = require('path');

module.exports = function(app) {

	var eetms = "https://earthengine.googleapis.com";
	var TMS = {};
	var Internal = {};
	var mosaics = app.repository.collections.mosaics;
	var points = app.repository.collections.points;
	var cache = app.middleware.cache;
	var config = app.config;

	var GDAL_PARAMS = ['-of', 'PNG', '-tr', 30, 30 ]
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

	TMS.gdalDefinition = function(request, response) {
		id = request.param('id')

	  mosaics.findOne({ "_id": id }, function(err, mosaic) {

	  	if(mosaic != undefined) {

	  		var token = mosaic.ee_token;
				var mapid = mosaic.ee_mapid;
				var url = eetms + "/map/" + mapid + "/${z}/${x}/${y}?token=" + token

				var xmlResponse = "\
<GDAL_WMS> \n\
    <Service name=\"TMS\"> \n\
        <ServerUrl>"+url+"</ServerUrl> \n\
    </Service> \n\
    <DataWindow> \n\
        <UpperLeftX>-20037508.34</UpperLeftX> \n\
        <UpperLeftY>20037508.34</UpperLeftY> \n\
        <LowerRightX>20037508.34</LowerRightX> \n\
        <LowerRightY>-20037508.34</LowerRightY> \n\
        <TileLevel>20</TileLevel> \n\
        <TileCountX>1</TileCountX> \n\
        <TileCountY>1</TileCountY> \n\
        <YOrigin>top</YOrigin> \n\
    </DataWindow> \n\
    <Cache> \n\
    	<Expires>1</Expires> \n\
    	<Path>"+config.imgGDALTmpDir+"</Path> \n\
    </Cache> \n\
    <Projection>EPSG:900913</Projection> \n\
    <BlockSizeX>256</BlockSizeX> \n\
    <BlockSizeY>256</BlockSizeY> \n\
    <BandsCount>3</BandsCount> \n\
    <MaxConnections>10</MaxConnections> \n\
    <Cache /> \n\
</GDAL_WMS>"

			  response.write(xmlResponse)
			  response.end()

	  	} else {
	  		response.end()
	  	}

	  });
	}

	TMS.processSingle = function(request, response) {
		layerId = request.param('layerId')
		pointId = request.param('pointId')

		var url = 'http://localhost:5000/source/'+layerId
		
		points.findOne({ _id:pointId }, function(err, point) {

			if (point) {
				
				var imagePath = path.join(config.imgDir, point.campaign, pointId, layerId +'.png')

				fs.exists(imagePath, function(exists) {
					if (exists) {
						response.sendFile(imagePath)
					} else {

						var buffer = 4000
						var coordinates = proj4('EPSG:4326', 'EPSG:900913', [point.lon, point.lat])

						var ulx = coordinates[0] - buffer
						var uly = coordinates[1] + buffer
						var lrx = coordinates[0] + buffer
						var lry = coordinates[1] - buffer
						var projwin = ulx + " " + uly + " " + lrx + " " + lry

						var cmd = config.imgDownloadCmd + ' ' + layerId + ' "' + projwin + '" ' + imagePath

						exec(cmd, function() {
							response.sendFile(imagePath)
						})
					}
				})

			} else {
				response.end()
			}

		})
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