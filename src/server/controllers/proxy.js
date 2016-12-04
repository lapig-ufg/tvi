var ejs = require('ejs');
var fs = require('fs');
var requester = require('request');

module.exports = function(app) {

	var Internal = {};

	Internal.doRequest = function(request, response, baseUrl) {

		var region = request.param('region');
		var city = request.param('city');
		var absoluteUrl = "http://maps.lapig.iesa.ufg.br/spatial/query?region="+region+"&regionType=biome&city="+city+"&lang=pt-br";

	  requester({
	  		uri: absoluteUrl
	  	,	timeout: 50000
	  	, headers: {
	  			'Accept': request.headers['accept']
	  		,	'User-Agent': request.headers['user-agent']
	  		,	'X-Requested-With': request.headers['x-requested-with']
	  		,	'Accept-Language': request.headers['accept-language']
	  		,	'Accept-Encoding': request.headers['accept-encoding']
	  	}
	  }, function(error, proxyResponse, body) {
	  	
	  	if(error) {
	  		console.log(error);
	  		response.end();	
	  	}

	  }).pipe(response)
	}

	return Internal;

}