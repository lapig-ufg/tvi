var appRoot = require('app-root-path');

module.exports = function(app) {
	//appRoot faz parte da documentação do js
	var config = {
		"appRoot": appRoot, 
		"clientDir": appRoot + "/../client",
		"langDir": appRoot + "/lang",
		"logDir": appRoot + "/log/",
		"imgDir": appRoot + "/images/",
		"imgGDALTmpDir": "/var/tmp/gdalwmscache",
		"imgDownloadCmd": appRoot + "/bin/download_image.sh",
		"imgDownloadWmsCmd": appRoot + "/bin/download_image_wms.sh",
		"correct": appRoot + "/bin/download_image_wms.sh",
		"cache": {
			"parallelRequestsBusyTime": 36,
			"parallelRequestsDawnTime": 46
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
				}
			]
		},
		"port": 3000,
	};

	if(process.env.NODE_ENV == 'prod') {
		config["mongo"]["port"] = "27017";
		config.jobs.toRun[0].runOnAppStart = false;
		config.jobs.toRun[1].runOnAppStart = true;
		config["imgDir"] = "/STORAGE/tvi-imgs/";
	}

	return config;

}
