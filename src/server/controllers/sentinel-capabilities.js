module.exports = function(app) {
    const sentinelCapabilities = {};
    
    // Get tiles API service from app
    const tilesApi = app.services.tilesApiService;
    const logger = app.services.logger;

    const getSentinelCapabilities = async (req = null) => {
        try {
            await logger.info('Fetching Sentinel capabilities from new Tiles API', {
                module: 'sentinelCapabilities',
                function: 'getSentinelCapabilities'
            });
            
            // Check if we should use new API
            if (app.config.tilesApi && app.config.tilesApi.baseUrl) {
                // Use new API - try legacy endpoint first for compatibility
                let response;
                try {
                    response = await tilesApi.getCapabilitiesLegacy(req);
                } catch (error) {
                    await logger.info('Legacy endpoint failed, trying new capabilities endpoint', {
                        module: 'sentinelCapabilities',
                        function: 'getSentinelCapabilities',
                        metadata: { error: error.message }
                    });
                    response = await tilesApi.getCapabilities(req);
                }
                
                await logger.info(`Total collections found: ${response.collections ? response.collections.length : 0}`, {
                    module: 'sentinelCapabilities',
                    function: 'getSentinelCapabilities',
                    metadata: { 
                        totalCollections: response.collections ? response.collections.length : 0,
                        collections: response.collections ? response.collections.map(c => c.name) : []
                    }
                });
                
                // Filter Sentinel collections
                const sentinelCollections = response.collections ? response.collections.filter(collection => 
                    collection.name && (
                        collection.name.toLowerCase().includes('sentinel') ||
                        collection.name.toLowerCase().includes('s2') ||
                        collection.name.toLowerCase().includes('harmonized')
                    )
                ) : [];
                
                await logger.info(`Sentinel collections found: ${sentinelCollections.length}`, {
                    module: 'sentinelCapabilities',
                    function: 'getSentinelCapabilities',
                    metadata: { 
                        sentinelCount: sentinelCollections.length,
                        sentinelCollections: sentinelCollections.map(c => c.name)
                    }
                });
                
                return sentinelCollections;
            } else {
                // Fallback to legacy HTTPS request
                const https = require('https');
                
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
                
                const baseUrl = app.config.tilesApi.baseUrl;
                const response = await get(`${baseUrl}/api/capabilities`);
                
                await logger.info(`Total collections found: ${response.collections ? response.collections.length : 0}`, {
                    module: 'sentinelCapabilities',
                    function: 'getSentinelCapabilities',
                    metadata: { 
                        totalCollections: response.collections ? response.collections.length : 0,
                        collections: response.collections ? response.collections.map(c => c.name) : []
                    }
                });
                
                const sentinelCollections = response.collections ? response.collections.filter(collection => 
                    collection.name && (
                        collection.name.toLowerCase().includes('sentinel') ||
                        collection.name.toLowerCase().includes('s2')
                    )
                ) : [];
                
                await logger.info(`Sentinel collections found: ${sentinelCollections.length}`, {
                    module: 'sentinelCapabilities',
                    function: 'getSentinelCapabilities',
                    metadata: { 
                        sentinelCount: sentinelCollections.length,
                        sentinelCollections: sentinelCollections.map(c => c.name)
                    }
                });
                
                return sentinelCollections;
            }
        } catch (error) {
            await logger.error("Error fetching Sentinel capabilities", {
                module: 'sentinelCapabilities',
                function: 'getSentinelCapabilities',
                metadata: { error: error.message }
            });
            throw error;
        }
    };

    sentinelCapabilities.getCapabilities = async (request, response) => {
        try {
            await logger.info('Admin Sentinel Capabilities endpoint called', {
                module: 'sentinelCapabilities',
                function: 'getCapabilities',
                req: request
            });
            const result = await getSentinelCapabilities(request);
            
            if (!result || result.length === 0) {
                await logger.warn('No Sentinel collections found, returning empty array', {
                    module: 'sentinelCapabilities',
                    function: 'getCapabilities'
                });
                return response.send([]);
            }
            
            await logger.info(`Sending ${result.length} Sentinel capabilities`, {
                module: 'sentinelCapabilities',
                function: 'getCapabilities',
                metadata: { count: result.length }
            });
            response.send(result);
        } catch (error) {
            await logger.error("Sentinel Capabilities - GET", {
                module: 'sentinelCapabilities',
                function: 'getCapabilities',
                metadata: { error: error.message },
                req: request
            });
            response.status(500).send({ 
                error: 'Não é possível encontrar os registros das capabilities do Sentinel',
                details: error.message,
                source: app.config.tilesApi && app.config.tilesApi.baseUrl ? 'new-api' : 'legacy'
            });
        }
    };

    return sentinelCapabilities;
};