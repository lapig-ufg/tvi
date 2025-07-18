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
				"nddiTimeseries": "/api/timeseries/nddi/{lat}/{lon}",
				"cacheStats": "/api/cache/stats",
				"cacheClear": "/api/cache/clear",
				"cacheWarmup": "/api/cache/warmup",
				"cachePointStart": "/api/cache/point/start",
				"cacheCampaignStart": "/api/cache/campaign/start",
				"cachePointStatus": "/api/cache/point/{point_id}/status",
				"cacheCampaignStatus": "/api/cache/campaign/{campaign_id}/status",
				"cacheTaskStatus": "/api/cache/tasks/{task_id}"
			},
			"timeout": 30000,
			"retryAttempts": 3,
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
					"name": "publishLayers",
					"cron": '0 0 19 * * *',
					"runOnAppStart": false,
					"params": {
						"cmd": "python " + appRoot + "/integration/py/publish_layers.py",
						"keys": [
							{
								"file": appRoot + "/integration/py/gee-keys/key85.json",
								"startYear": 1985
							},
							{
								"file": appRoot + "/integration/py/gee-keys/key86.json",
								"startYear": 1986
							},
							{
								"file": appRoot + "/integration/py/gee-keys/key87.json",
								"startYear": 1987
							}
						]
					}
				},
				{
					"name": "populateCache",
					"cron": '0 0 20 1 0 *',
					"runOnAppStart": false,
					"params": {}
				},
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
				}
			]
		},
		"port": 3000,
	};

	if(process.env.NODE_ENV === 'prod') {
		config["mongo"]["port"] = "27017";
		config.jobs.toRun[0].runOnAppStart = false;
		config.jobs.toRun[1].runOnAppStart = false;
		config.jobs.toRun[2].runOnAppStart = false;
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
