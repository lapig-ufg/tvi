module.exports = function(app) {
	const lapig = {};
	const logger = app.services.logger;
	const tilesApiService = app.services.tilesApiService;

	const getLapigCapabilities = async (req = null) => {
		try {
			// Use tilesApiService which handles auth, retries, and proper URL formatting
			const response = await tilesApiService.getCapabilities(req);
			return response.collections;
		} catch (error) {
			await logger.error('Error fetching capabilities from Tiles API', {
				module: 'capabilities',
				function: 'getLapigCapabilities',
				metadata: { error: error.message }
			});
			throw error;
		}
	};

	lapig.publicCapabilities = async (request, response) => {
		try {
			// Pass request to enable authentication if needed
			const result = await getLapigCapabilities(request);
			response.send(result);
		} catch (error) {
			const logId = await logger.error('Error getting Lapig capabilities', {
				module: 'capabilities',
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
