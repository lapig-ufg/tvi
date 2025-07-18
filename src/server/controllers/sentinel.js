const https = require('https');

module.exports = function(app) {
	const lapig = {};
	const logger = app.services.logger;

	const get = (url) => {
		return new Promise((resolve, reject) => {
			const req = https.get(url, (res) => {
				let data = '';
				res.on('data', (chunk) => {
					data += chunk;
				});
				res.on('end', () => {
					try {
						resolve(JSON.parse(data));
					} catch (error) {
						reject(error);
					}
				});
			});

			req.on('error', (error) => {
				reject(error);
			});

			req.end();
		});
	};

	const getLapigCapabilities = async () => {
		try {
			const baseUrl = app.config.tilesApi.baseUrl;
			const response = await get(`${baseUrl}/api/capabilities`);
			return response.collections;
		} catch (error) {
			await logger.error('Error fetching capabilities from Lapig API', {
				module: 'sentinel',
				function: 'getLapigCapabilities',
				metadata: { error: error.message }
			});
			throw error;
		}
	};

	lapig.publicCapabilities = async (request, response) => {
		try {
			const result = await getLapigCapabilities();
			response.send(result);
		} catch (error) {
			const logId = await logger.error('Error getting Lapig capabilities', {
				module: 'sentinel',
				function: 'publicCapabilities',
				metadata: { error: error.message },
				req: request
			});
			response.status(500).send({ 
				error: 'Não é possível encontrar os registros das capabilities',
				logId 
			});
		}
	};

	return lapig;
};
