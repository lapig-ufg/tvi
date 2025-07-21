module.exports = function(app) {
    const landsatCapabilities = {};
    
    // Get tiles API service from app
    const tilesApi = app.services.tilesApiService;
    const logger = app.services.logger;

    const getLandsatCapabilities = async (req = null) => {
        try {
            await logger.debug('Fetching Landsat capabilities from Tiles API', {
                module: 'landsatCapabilities',
                function: 'getLandsatCapabilities'
            });
            
            // Use tilesApiService - try legacy endpoint first for compatibility
            let response;
            try {
                response = await tilesApi.getCapabilitiesLegacy(req);
            } catch (error) {
                await logger.debug('Legacy endpoint failed, trying new capabilities endpoint', {
                    module: 'landsatCapabilities',
                    function: 'getLandsatCapabilities',
                    metadata: { error: error.message }
                });
                response = await tilesApi.getCapabilities(req);
            }
            
            await logger.debug(`Total collections found: ${response.collections ? response.collections.length : 0}`, {
                module: 'landsatCapabilities',
                function: 'getLandsatCapabilities',
                metadata: { 
                    totalCollections: response.collections ? response.collections.length : 0
                }
            });
            
            // Filter Landsat collections
            const landsatCollections = response.collections ? response.collections.filter(collection => 
                collection.name && (
                    collection.name.toLowerCase().includes('landsat') ||
                    collection.name.toLowerCase().includes('l8') ||
                    collection.name.toLowerCase().includes('l7') ||
                    collection.name.toLowerCase().includes('l5') ||
                    collection.name.toLowerCase().includes('lt05') ||
                    collection.name.toLowerCase().includes('le07') ||
                    collection.name.toLowerCase().includes('lc08')
                )
            ) : [];
            
            await logger.debug(`Landsat collections found: ${landsatCollections.length}`, {
                module: 'landsatCapabilities',
                function: 'getLandsatCapabilities',
                metadata: { 
                    landsatCount: landsatCollections.length
                }
            });
            
            return landsatCollections;
        } catch (error) {
            await logger.error("Error fetching Landsat capabilities", {
                module: 'landsatCapabilities',
                function: 'getLandsatCapabilities',
                metadata: { error: error.message }
            });
            throw error;
        }
    };

    landsatCapabilities.getCapabilities = async (request, response) => {
        try {
            await logger.info('Admin Landsat Capabilities endpoint called', {
                module: 'landsatCapabilities',
                function: 'getCapabilities',
                req: request
            });
            const result = await getLandsatCapabilities(request);
            
            if (!result || result.length === 0) {
                await logger.warn('No Landsat collections found, returning empty array', {
                    module: 'landsatCapabilities',
                    function: 'getCapabilities'
                });
                return response.send([]);
            }
            
            await logger.info(`Sending ${result.length} Landsat capabilities`, {
                module: 'landsatCapabilities',
                function: 'getCapabilities',
                metadata: { count: result.length }
            });
            response.send(result);
        } catch (error) {
            await logger.error("Landsat Capabilities - GET", {
                module: 'landsatCapabilities',
                function: 'getCapabilities',
                metadata: { error: error.message },
                req: request
            });
            response.status(500).send({ 
                error: 'Não é possível encontrar os registros das capabilities do Landsat',
                details: error.message
            });
        }
    };

    return landsatCapabilities;
};