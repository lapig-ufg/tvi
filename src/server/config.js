var appRoot = require('app-root-path');

module.exports = function(app) {
	//appRoot faz parte da documentação do js
	var config = {
		"appRoot": appRoot, 
		"clientDir": appRoot + "/../client",
		"langDir": appRoot + "/lang",
		"logDir": appRoot + "/log/",
		"imgDir": appRoot + "/images/",
		"imgGDALTmpDir": process.env.IMG_GDAL_TMP_DIR,
		"imgDownloadCmd": appRoot + "/bin/download_image.sh",
		"imgDownloadWmsCmd": appRoot + "/bin/download_image_wms.sh",
		"correct": appRoot + "/bin/download_image_wms.sh",
		"planetCredentials": process.env.PLANET_CREDENTIALS,
		"cache": {
			"parallelRequestsBusyTime": 42,
			"parallelRequestsDawnTime": 36
		},
		"tilesApi": {
			"baseUrl": process.env.TILES_API_URL || "http://0.0.0.0:8080",
			"endpoints": {
				"capabilities": "/api/capabilities",
				"capabilitiesLegacy": "/api/capabilities/legacy",
				"landsatTiles": "/api/layers/landsat/{x}/{y}/{z}",
				"sentinelTiles": "/api/layers/s2_harmonized/{x}/{y}/{z}",
				"landsatTimeseries": "/api/timeseries/landsat/{lat}/{lon}",
				"sentinelTimeseries": "/api/timeseries/sentinel2/{lat}/{lon}",
				"modisTimeseries": "/api/timeseries/modis/{lat}/{lon}",
				"cacheStats": "/api/cache/stats",
				"cacheClear": "/api/cache/clear",
				"cacheWarmup": "/api/cache/warmup",
				"cachePointStart": "/api/cache/point/start",
				"cacheCampaignStart": "/api/cache/campaign/start",
				"cachePointStatus": "/api/cache/point/{point_id}/status",
				"cacheCampaignStatus": "/api/cache/campaign/{campaign_id}/status",
				"cacheTaskStatus": "/api/cache/tasks/{task_id}",
				"cacheAnalyzePatterns": "/api/cache/analyze-patterns",
				"cacheRecommendations": "/api/cache/recommendations",
				"cacheCancelTask": "/api/cache/tasks/{task_id}",
				"cacheClearPoint": "/api/cache/point/{point_id}",
				"cacheClearCampaign": "/api/cache/campaign/{campaign_id}",
				"cacheMegatile": "/api/aggregation/megatile/{layer}/{x}/{y}/{z}",
				"cacheSpriteGenerate": "/api/aggregation/sprites/generate",
				"cacheSpriteStatus": "/api/aggregation/sprites/{sprite_id}/status",
				"tasksList": "/api/tasks/list",
				"taskStatus": "/api/tasks/status/{task_id}",
				"tasksWorkers": "/api/tasks/workers",
				"tasksPurge": "/api/tasks/purge",
				"tasksRegistered": "/api/tasks/registered",
				"tasksQueueLength": "/api/tasks/queue-length",
				"visParams": "/api/vis-params/",
				"visParamsDetail": "/api/vis-params/{name}",
				"visParamsToggle": "/api/vis-params/{name}/toggle",
				"visParamsTest": "/api/vis-params/test",
				"visParamsClone": "/api/vis-params/clone/{name}",
				"visParamsExport": "/api/vis-params/export/all",
				"visParamsImport": "/api/vis-params/import",
				"visParamsLandsatCollections": "/api/vis-params/landsat-collections/",
				"visParamsSentinelCollections": "/api/vis-params/sentinel-collections/",
				"visParamsSentinelInitialize": "/api/vis-params/sentinel-collections/initialize",
				"visParamsSentinelBands": "/api/vis-params/sentinel-collections/bands/{collection_name}",
				"wsMonitor": "/api/cache/ws/monitor",
				"wsCampaign": "/api/cache/ws/campaign/{campaign_id}",
				"warmTiles": "/api/cache/warm-tiles"
			},
			"timeout": 30000,
			"retryAttempts": 0,
			"retryDelay": 1000
		},
		"mongo": {
			"host": process.env.MONGO_HOST,
			"port":  process.env.MONGO_PORT,
			"dbname":  process.env.MONGO_DATABASE
		},
		"jobs": {
			"timezone": 'America/Sao_Paulo',
			"toRun": [
				{
					"name": "logsCleaner",
					"cron": '0 0 2 */7 * *',
					"runOnAppStart": false,
					"params": {
						"daysToKeep": 30,
						"keepErrors": true,
						"batchSize": 1000,
						"simulate": false
					}
				},
				{
					"name": "telegramQueueProcessor",
					"cron": '*/30 * * * * *',
					"runOnAppStart": false,
					"params": {}
				},
				{
					"name": "telegramDailySummary",
					"cron": '0 59 23 * * *',
					"runOnAppStart": false,
					"params": {}
				},
				{
					"name": "telegramIdleTicketAlert",
					"cron": '0 0 8,12,16,20 * * *',
					"runOnAppStart": false,
					"params": {}
				},
				{
					"name": "telegramSilentFlush",
					"cron": '0 0 7 * * *',
					"runOnAppStart": false,
					"params": {}
				}
			]
		},
		"port": 3000,
	};

	if(process.env.NODE_ENV === 'prod') {
		config["mongo"]["port"] = "27017";
		// Desabilitar execução na inicialização por nome (não por índice)
		config.jobs.toRun.forEach(function(job) {
			job.runOnAppStart = false;
		});
		config["imgDir"] = "/STORAGE/tvi-imgs/";
		if (!require('fs').existsSync(config.logDir)) {
			try {
				require('fs').mkdirSync(config.logDir, { recursive: true });
				console.log('Created production log directory:', config.logDir);
			} catch (error) {
				console.error('Failed to create production log directory:', error);
			}
		}
	}

	return config;

}
