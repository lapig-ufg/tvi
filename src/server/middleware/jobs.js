var 
		cron = require('cron')
	,	exec = require('child_process').exec
	,	fs = require('fs');

module.exports = function(app) {

	var config = app.config;

	var Jobs = {};

	var strDate = function() {
		return new Date().toISOString()
		  .replace(/T/, ' ')
		  .replace(/\..+/, '') + " # "
	}

	var writeLog = function(logStream, msg) {
		logStream.write(msg + "\n");
	}

	Jobs.populateCache = function(params, logStream, cacheComplete) {
		var pointCacheCompĺete = function(pointId) {
			writeLog(logStream, pointId + ' images cached.')
		}

		app.middleware.cache.populateCache(pointCacheCompĺete, cacheComplete);
	}

	Jobs.publishLayers = function(params, logStream, callback) {
		
		var cmd = params.cmd + " " + params.eeKey;

		exec(cmd, function (error, stdout, stderr) {
			  
			  if(error || stderr) {
			  	writeLog(logStream, error);
			  	writeLog(logStream, stderr);
			  }

			  if(stdout) {
			  	var lines = stdout.split("\n");
			  	
			  	lines.forEach(function(line) {
			  		if(line) {
			  			writeLog(logStream, line);
			  		}
			  	});
			  }
				
				callback();
			});
	}
	
	Jobs.start = function() {
		config.jobs.toRun.forEach(function(job) {
			var logFile = config.logDir + "/" + job.name + ".log";

			new cron.CronJob(job.cron, function() {
				var logStream = fs.createWriteStream(logFile, {'flags': 'a'});
				var startLogMsg = strDate() + "Job " + job.name + " start.";
				
				console.log(startLogMsg);
				writeLog(logStream, startLogMsg);

				Jobs[job.name](job.params,logStream, function() {

					var endLogMsg = strDate() + "Job " + job.name + " end.";
					console.log(endLogMsg);
					writeLog(logStream, endLogMsg);
					
					logStream.end();
					
				});

			}, null, true, config.jobs.timezone, null, job.runOnAppStart);
		});
	}

	return Jobs;
	
}; 