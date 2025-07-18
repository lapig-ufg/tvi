var fs = require('fs');
var exec = require('child_process').exec;
var proj4 = require('proj4');
var path = require('path');
var request = require('request');
var async = require('async');

module.exports = function(app) {
	// Usar o logger do app
	const logger = app.services.logger;
	
	var Image = {};
	var Internal = {};

	var campaigns = app.repository.collections.campaign;
	var mosaics = app.repository.collections.mosaics;
	var points = app.repository.collections.points;
	
	var config = app.config;
	var planetCredentials = app.config.planetCredentials;

	var GDAL_PARAMS = ['-of', 'PNG', '-tr', 30, 30 ]

	Internal.TMSUrl = function(mosaicId, campaignId, callback) {
		campaigns.findOne({ "_id": campaignId }, function(err, campaign) {
			if (campaign != undefined && campaign.customURLs != undefined && campaign.customURLs[mosaicId] != undefined) {
				callback(campaign.customURLs[mosaicId]);
			} else {
				mosaics.findOne({ "_id": mosaicId }, function(err, mosaic) {
					
					var url = undefined
					if(mosaic != undefined) {
						var token = mosaic.ee_token;
						var mapid = mosaic.ee_mapid;
						url = "https://earthengine.googleapis.com/v1alpha/" + mapid + "/tiles/${z}/${x}/${y}"
					}

					callback(url);
				})
			}

		})
	}

	Internal.GDALWmsXmlResponse = function(mosaicId, campaignId, TMSurl) {
		return "\
<GDAL_WMS> \n\
    <Service name=\"TMS\"> \n\
        <ServerUrl>"+TMSurl+"</ServerUrl> \n\
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
    	<Path>"+config.imgGDALTmpDir+"/"+mosaicId+"_"+campaignId+"</Path> \n\
    </Cache> \n\
    <Projection>EPSG:900913</Projection> \n\
    <BlockSizeX>256</BlockSizeX> \n\
    <BlockSizeY>256</BlockSizeY> \n\
    <BandsCount>3</BandsCount> \n\
    <MaxConnections>3</MaxConnections> \n\
    <Timeout>30</Timeout> \n\
    <ZeroBlockHttpCodes>429,503,504</ZeroBlockHttpCodes> \n\
    <Cache /> \n\
</GDAL_WMS>"
	}

	Image.gdalDefinition = function(request, response) {
		var mosaicId = request.params.id
		var campaignId = request.query.campaign
		Internal.TMSUrl(mosaicId, campaignId, function(TMSurl) {
			if(TMSurl != undefined)
				response.write(Internal.GDALWmsXmlResponse(mosaicId, campaignId, TMSurl))
			response.end()
		});

	}

	Image.access = async function(request, response) {
		try {
			var layerId = request.params.layerId
			var pointId = request.params.pointId
			var campaignId = request.query.campaign

			if (!layerId || !pointId || !campaignId) {
				const errorCode = await logger.warn('Image access attempted with missing parameters', {
					req: request,
					module: 'image',
					function: 'access',
					metadata: {
						layerId: layerId,
						pointId: pointId,
						campaignId: campaignId
					}
				});
				
				return response.status(400).json({ 
					error: 'LayerId, pointId and campaignId are required',
					errorCode
				});
			}

			await logger.info('Accessing image for point', {
				req: request,
				module: 'image',
				function: 'access',
				metadata: {
					layerId: layerId,
					pointId: pointId,
					campaignId: campaignId
				}
			});

		var sourceUrl = 'http://localhost:3000/source/'+layerId+'?campaign='+campaignId

		campaigns.findOne({ "_id": campaignId }, async function(err, campaign) {
			if(err){
				const errorCode = await logger.error('Database error finding campaign for image access', {
					req: request,
					module: 'image',
					function: 'access',
					metadata: {
						errorMessage: err.message,
						campaignId: campaignId
					}
				});
				
				return response.status(500).json({
					error: 'Database error',
					errorCode
				});
			} else {
				points.findOne({ _id: pointId }, async function(err, point) {
					if (err) {
						const errorCode = await logger.error('Database error finding point for image access', {
							req: request,
							module: 'image',
							function: 'access',
							metadata: {
								errorMessage: err.message,
								pointId: pointId
							}
						});
						
						return response.status(500).json({
							error: 'Database error finding point',
							errorCode
						});
					}

					if (point) {
						var imagePath = path.join(config.imgDir, point.campaign, pointId, layerId +'.png')
						if(campaign.hasOwnProperty('image') && campaign['image'] === 'sentinel-2-l2a'){
							imagePath = path.join(config.imgDir, point.campaign, pointId, layerId +'.jpg')
						}
						fs.exists(imagePath, function(exists) {
							if (exists) {
								response.sendFile(imagePath)
							} else {
								let cmd = '';
								if(campaign.hasOwnProperty('serviceType') && campaign.customURLs != undefined && campaign.customURLs[layerId] != undefined){
									let wmsCredentials = '';
									if(campaign.hasOwnProperty('serviceType') && campaign.image !== undefined && campaign.image === 'planet'){
										wmsCredentials = planetCredentials
									}
									cmd = `${config.imgDownloadWmsCmd} ${point.lon} ${point.lat} "${campaign.customURLs[layerId]}" "${imagePath}" "${wmsCredentials}"`;

								} else {
									var buffer = 4000
									var coordinates = proj4('EPSG:4326', 'EPSG:900913', [point.lon, point.lat])

									var ulx = coordinates[0] - buffer
									var uly = coordinates[1] + buffer
									var lrx = coordinates[0] + buffer
									var lry = coordinates[1] - buffer
									var projwin = ulx + " " + uly + " " + lrx + " " + lry
									cmd = config.imgDownloadCmd + ' "' + sourceUrl + '" "' + projwin + '" ' + imagePath
								}
								if(campaign.hasOwnProperty('image') && campaign['image'] === 'sentinel-2-l2a') {
									response.sendFile(`${config.imgDir}/no_image.png`)
								} else {
									exec(cmd, async function(error, stdout, stderr) {
										if(error || stderr){
											await logger.error('Error executing image download command', {
												module: 'image',
												function: 'getImage',
												metadata: { 
													error: error ? error.message : 'stderr',
													stderr: stderr,
													cmd: cmd,
													imagePath: imagePath
												}
											});
										}
										response.sendFile(imagePath)
									})
								}

							}
						})
					} else {
						await logger.warn('Point not found for image access', {
							req: request,
							module: 'image',
							function: 'access',
							metadata: {
								pointId: pointId
							}
						});
						response.status(404).json({
							error: 'Point not found'
						});
					}
				})
			}
		});
		} catch (error) {
			const errorCode = await logger.error('Unexpected error in image access', {
				req: request,
				module: 'image',
				function: 'access',
				metadata: {
					error: error.message,
					stack: error.stack
				}
			});

			response.status(500).json({
				error: 'Internal server error',
				errorCode
			});
		}
	}

	Image.populateCache = function(requestPointCache, pointCacheCompĺete, finished) {

		var periods = ['DRY','WET']

 		var getRequestTasks = function(point, campaign) {

 			var satellite
 			var requestTasks = [];
 			var urls = [];
			
			var initialYear = campaign.initialYear;
			var finalYear = campaign.finalYear;

			periods.forEach(function(period){
				for (var year = initialYear; year <= finalYear; year++) {
			 				
	 				satellite = 'L7';
					if(year > 2012) { 
						satellite = 'L8'
					} else if(year > 2011) {
						satellite = 'L7'
					} else if(year > 2003  || year < 2000) {
						satellite = 'L5'
					}

					layerId = satellite+"_"+year+"_"+period
					pointId = point._id

					var url = "http://localhost:" + config.port + "/image/"+layerId+"/"+pointId+"?campaign="+campaign._id;
					urls.push(url);
				}
			});

			urls.forEach(function(url) {
				requestTasks.push(function(next) {
					var params = { timeout: 3600 * 1000 };
					var callback = function(error, response, html) {
						requestPointCache(point, url)
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
	 		app.repository.collections.points.findOne({ "cached" : false }, { lon:1, lat: 1, campaign: 1}, { sort: [['index', 1]] }, function(err, point) {
	 			if(point) {
	 				app.repository.collections.campaign.findOne({ "_id" : point.campaign }, function(err, campaign) {
						var requestTasks = getRequestTasks(point, campaign);
						
						var hour = new Date().getHours()
						var day = new Date().getDay();
						var busyTimeCondition = ( (day == 6) || (day == 0) || (hour >= 8 && hour <= 19 ) )

						var parallelRequestsLimit = busyTimeCondition ? config.cache.parallelRequestsBusyTime : config.cache.parallelRequestsDawnTime;

						async.parallelLimit(requestTasks, parallelRequestsLimit, function() {
							app.repository.collections.points.update({ _id: point._id}, { '$set': { "cached": true }  }, {}, function() {
								pointCacheCompĺete(point._id);
								next();
							});
						});
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

	// ===== MÉTODOS ADMIN (sem dependência de sessão) =====
	
	Image.mosaicAdmin = function(request, response) {
		var mosaicId = request.params.mosaicId;
		// Lógica para retornar imagem do mosaico para admin
		response.json({
			mosaicId: mosaicId,
			url: `/service/image/${mosaicId}`,
			success: true
		});
	}
	
	Image.planetMosaicAdmin = function(request, response) {
		var mosaicId = request.params.mosaicId;
		// Lógica para retornar imagem Planet para admin
		response.json({
			mosaicId: mosaicId,
			type: 'planet',
			success: true
		});
	}
	
	Image.sentinelMosaicAdmin = function(request, response) {
		var date = request.params.date;
		// Lógica para retornar imagem Sentinel para admin
		response.json({
			date: date,
			type: 'sentinel',
			success: true
		});
	}

	return Image;

}
