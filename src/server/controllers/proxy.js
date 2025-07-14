var ejs = require('ejs');
var fs = require('fs');
var requester = require('request');

module.exports = function(app) {

	var Internal = {};

	Internal.doRequest = function(request, response, baseUrl) {
		// Desabilitado - retornando vazio
		response.json({});
		response.end();
	}

	Internal.timeSeries = function(request, response) {
		// Desabilitado - retornando array vazio de valores
		response.json({ values: [] });
		response.end();
	}

	Internal.precipitationMaps = function(request, response){
		// Desabilitado - retornando array vazio de valores
		response.json({ values: [] });
		response.end();
	}

	return Internal;

}