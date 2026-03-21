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

	/**
	 * Proxy de imagens de tiles para captura de screenshot.
	 * Necessário porque html2canvas precisa de CORS para renderizar imagens
	 * cross-origin, mas os tile servers não enviam Access-Control-Allow-Origin.
	 * Este endpoint busca a imagem e retorna com os headers CORS adequados.
	 */
	Internal.tileProxy = function(request, response) {
		var url = request.query.url;

		if (!url) {
			return response.status(400).json({ error: 'Parâmetro url é obrigatório' });
		}

		// Segurança: aceitar apenas domínios conhecidos de tiles
		var allowedPatterns = [
			/^https?:\/\/tm\d+\.lapig\.iesa\.ufg\.br\//,
			/^https?:\/\/earthengine\.googleapis\.com\//
		];

		var isAllowed = allowedPatterns.some(function(pattern) {
			return pattern.test(url);
		});

		if (!isAllowed) {
			return response.status(403).json({ error: 'Domínio não permitido' });
		}

		requester.get({ url: url, encoding: null, timeout: 15000 }, function(err, proxyRes, body) {
			if (err) {
				return response.status(502).json({ error: 'Erro ao buscar imagem do tile server' });
			}

			if (proxyRes.statusCode !== 200) {
				return response.status(proxyRes.statusCode).end();
			}

			response.set('Access-Control-Allow-Origin', '*');
			response.set('Content-Type', proxyRes.headers['content-type'] || 'image/png');
			response.set('Cache-Control', 'public, max-age=86400');
			response.send(body);
		});
	}

	return Internal;

}