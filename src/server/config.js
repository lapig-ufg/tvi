var appRoot = require('app-root-path');

module.exports = function(app) {
	//appRoot faz parte da documentação do js
	var config = {
		"appRoot": appRoot, 
		"clientDir": appRoot + "/../client",
		"langDir": appRoot + "/lang",
		"logDir": appRoot + "/log/",
		"imgs": appRoot + "/images/",
		"cache": {
			"parallelRequestsLimit": 8
		},
		"mongo": {
			"host": "localhost",
			"port": "27017",
			"dbname": "tvi"
		},
		"jobs": {
			"timezone": 'America/Sao_Paulo',
			"toRun": [
				{
					"name": "publishLayers",
					"cron": '0 0 19 * * *',
					"runOnAppStart": true,
					"params": {
						"cmd": "python " + appRoot + "/integration/py/publish_layers.py",
						"eeKey": appRoot + "/integration/py/lapig-ee-09144f43f3b5.pem"
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
		"port": 5000,
	};

	if(process.env.NODE_ENV == 'prod') {
		config["mongo"]["port"] = "27017";
		config.jobs.toRun[0].runOnAppStart = true;
		config.jobs.toRun[1].runOnAppStart = true;
		config["imgs"] = "/data/cache-tvi/";
	}

	return config;

}
