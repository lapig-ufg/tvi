var 
		cron = require('cron')
	,	exec = require('child_process').exec
	,	dateFormat = require('dateformat')
	,	fs = require('fs')
	,	async = require('async');

module.exports = function(app) {

	var config = app.config;

	var Jobs = {};

	var strDate = function() {
		return dateFormat(new Date(), "yyyy-mm-dd HH:MM:ss ");
	}

	var writeLog = function(logStream, msg) {
		logStream.write(strDate() + msg + "\n");
	}

	Jobs.populateCache = function(params, logStream, cacheComplete) {
		
		var requestPointCache = function(pointId, url) {
			writeLog(logStream, ' Resquest ' + url + ' for ' + pointId._id)
		}

		var pointCacheCompĺete = function(pointId) {
			writeLog(logStream, pointId + ' images cached.')
		}

		app.controllers.image.populateCache(requestPointCache, pointCacheCompĺete, cacheComplete);
	}

	Jobs.publishLayers = function(params, logStream, callback) {
		
		var onEach = function(key, next) {
			var cmd = params.cmd + " " + key.file + " " +config.currentCampaign + " " + key.startYear + " " + params.keys.length;
			console.log(cmd)
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
					
					next();
				});
		}

		async.eachSeries(params.keys, onEach, callback)

	}
	
	Jobs.start = function() {
		config.jobs.toRun.forEach(function(job) {
			var logFile = config.logDir + "/" + job.name + ".log";

			new cron.CronJob(job.cron, function() {
				var logStream = fs.createWriteStream(logFile, {'flags': 'a'});
				var startLogMsg = "Job " + job.name + " start.";
				
				console.log(strDate() + " " + startLogMsg);
				writeLog(logStream, startLogMsg);

				Jobs[job.name](job.params,logStream, function() {

					var endLogMsg = "Job " + job.name + " end.";
					console.log(strDate() + " " + endLogMsg);
					writeLog(logStream, endLogMsg);
					
					logStream.end();
					
				});

			}, null, true, config.jobs.timezone, null, job.runOnAppStart);
		});
	}

	return Jobs;
	
}; 