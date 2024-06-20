const https = require('https');

module.exports = function(app) {
	const lapig = {};

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
			const response = await get('https://tiles.lapig.iesa.ufg.br/api/capabilities');
			return response.collections;
		} catch (error) {
			console.error("Error fetching capabilities: ", error);
			throw error;
		}
	};

	lapig.publicCapabilities = async (request, response) => {
		try {
			const result = await getLapigCapabilities();
			response.send(result);
		} catch (error) {
			console.error("Capabilities - GET: ", error);
			response.status(500).send({ error: 'Não é possível encontrar os registros das capabilities' });
		}
	};

	return lapig;
};
