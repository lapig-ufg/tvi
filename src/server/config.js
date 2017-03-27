var appRoot = require('app-root-path');

module.exports = function(app) {
	//appRoot faz parte da documentação do js
	var config = {
		"appRoot": appRoot, 
		"clientDir": appRoot + "/../client",
		"langDir": appRoot + "/lang",
		"mongo": {
			"host": "localhost",
			"port": "27018",
			"dbname": "tvi"
		},
		"port": 5000,
	};

	if(process.env.NODE_ENV == 'prod') {
		config["mongo"]["host"] = "27017";
	}

	return config;

}