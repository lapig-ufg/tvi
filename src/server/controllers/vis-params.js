module.exports = function(app) {
    const config = app.config;
    const logger = app.services.logger;
    const tilesApiService = app.services.tilesApiService;

    const controller = {};

    // List visualization parameters with filters
    controller.list = async function(req, res) {
        try {
            // Log request (minimal info)
            await logger.debug('Processing vis-params list request', {
                module: 'vis-params',
                function: 'list',
                metadata: {
                    method: req.method,
                    path: req.path
                }
            });
            
            // Check authentication (without exposing sensitive data)
            if (!req.authenticatedUser) {
                await logger.warn('No authenticated user for vis-params request', {
                    module: 'vis-params',
                    function: 'list'
                });
            }

            const filters = {
                category: req.query.category,
                active: req.query.active !== undefined ? req.query.active === 'true' : undefined,
                tag: req.query.tag
            };

            // Remove verbose logging
            
            const result = await tilesApiService.listVisParams(filters, req);
            
            await logger.info('VIS-PARAMS LIST RESPONSE', {
                module: 'vis-params',
                function: 'list',
                metadata: { 
                    filters, 
                    count: Array.isArray(result) ? result.length : 'Not an array',
                    resultType: typeof result,
                    resultKeys: result && typeof result === 'object' ? Object.keys(result) : null
                }
            });

            // Log successful response only if debugging
            await logger.debug('Vis params list returned successfully', {
                module: 'vis-params',
                function: 'list',
                metadata: { 
                    count: Array.isArray(result) ? result.length : 0
                }
            });
            
            res.json(result);
        } catch (error) {
            await logger.error('Error listing vis params', {
                module: 'vis-params',
                function: 'list',
                metadata: { 
                    error: error.message,
                    status: error.response && error.response.status
                }
            });
            res.status(500).json({ error: error.message });
        }
    };

    // Create new visualization parameter
    controller.create = async function(req, res) {
        try {
            const data = req.body;
            
            if (!data.name || !data.display_name || !data.category) {
                return res.status(400).json({ 
                    error: 'Missing required fields: name, display_name, and category are required' 
                });
            }

            const result = await tilesApiService.createVisParam(data, req);
            
            await logger.info('Vis param created successfully', {
                module: 'vis-params',
                function: 'create',
                metadata: { name: data.name }
            });

            res.json(result);
        } catch (error) {
            await logger.error('Error creating vis param', {
                module: 'vis-params',
                function: 'create',
                metadata: { error: error.message, data: req.body }
            });
            res.status(500).json({ error: error.message });
        }
    };

    // Get specific visualization parameter
    controller.get = async function(req, res) {
        try {
            const { name } = req.params;
            const result = await tilesApiService.getVisParam(name, req);
            
            await logger.info('Vis param retrieved successfully', {
                module: 'vis-params',
                function: 'get',
                metadata: { name }
            });

            res.json(result);
        } catch (error) {
            await logger.error('Error getting vis param', {
                module: 'vis-params',
                function: 'get',
                metadata: { error: error.message, name: req.params.name }
            });
            res.status(500).json({ error: error.message });
        }
    };

    // Update visualization parameter
    controller.update = async function(req, res) {
        try {
            const { name } = req.params;
            const data = req.body;
            
            const result = await tilesApiService.updateVisParam(name, data, req);
            
            await logger.info('Vis param updated successfully', {
                module: 'vis-params',
                function: 'update',
                metadata: { name }
            });

            res.json(result);
        } catch (error) {
            await logger.error('Error updating vis param', {
                module: 'vis-params',
                function: 'update',
                metadata: { error: error.message, name: req.params.name }
            });
            res.status(500).json({ error: error.message });
        }
    };

    // Delete visualization parameter
    controller.delete = async function(req, res) {
        try {
            const { name } = req.params;
            const result = await tilesApiService.deleteVisParam(name, req);
            
            await logger.info('Vis param deleted successfully', {
                module: 'vis-params',
                function: 'delete',
                metadata: { name }
            });

            res.json(result);
        } catch (error) {
            await logger.error('Error deleting vis param', {
                module: 'vis-params',
                function: 'delete',
                metadata: { error: error.message, name: req.params.name }
            });
            res.status(500).json({ error: error.message });
        }
    };

    // Toggle visualization parameter active status
    controller.toggle = async function(req, res) {
        try {
            const { name } = req.params;
            const result = await tilesApiService.toggleVisParam(name, req);
            
            await logger.info('Vis param toggled successfully', {
                module: 'vis-params',
                function: 'toggle',
                metadata: { name }
            });

            res.json(result);
        } catch (error) {
            await logger.error('Error toggling vis param', {
                module: 'vis-params',
                function: 'toggle',
                metadata: { error: error.message, name: req.params.name }
            });
            res.status(500).json({ error: error.message });
        }
    };

    // Test visualization parameters
    controller.test = async function(req, res) {
        try {
            const data = req.body;
            
            if (!data.vis_params || !data.x || !data.y || !data.z) {
                return res.status(400).json({ 
                    error: 'Missing required fields: vis_params, x, y, and z are required' 
                });
            }

            const result = await tilesApiService.testVisParams(data, req);
            
            await logger.info('Vis params tested successfully', {
                module: 'vis-params',
                function: 'test',
                metadata: { x: data.x, y: data.y, z: data.z }
            });

            res.json(result);
        } catch (error) {
            await logger.error('Error testing vis params', {
                module: 'vis-params',
                function: 'test',
                metadata: { error: error.message }
            });
            res.status(500).json({ error: error.message });
        }
    };

    // Clone visualization parameter
    controller.clone = async function(req, res) {
        try {
            const { name } = req.params;
            const { new_name } = req.query;
            
            if (!new_name) {
                return res.status(400).json({ 
                    error: 'Missing required query parameter: new_name' 
                });
            }

            const result = await tilesApiService.cloneVisParam(name, new_name, req);
            
            await logger.info('Vis param cloned successfully', {
                module: 'vis-params',
                function: 'clone',
                metadata: { originalName: name, newName: new_name }
            });

            res.json(result);
        } catch (error) {
            await logger.error('Error cloning vis param', {
                module: 'vis-params',
                function: 'clone',
                metadata: { error: error.message, name: req.params.name }
            });
            res.status(500).json({ error: error.message });
        }
    };

    // Export all visualization parameters
    controller.export = async function(req, res) {
        try {
            const result = await tilesApiService.exportVisParams(req);
            
            await logger.info('Vis params exported successfully', {
                module: 'vis-params',
                function: 'export'
            });

            res.json(result);
        } catch (error) {
            await logger.error('Error exporting vis params', {
                module: 'vis-params',
                function: 'export',
                metadata: { error: error.message }
            });
            res.status(500).json({ error: error.message });
        }
    };

    // Import visualization parameters
    controller.import = async function(req, res) {
        try {
            const data = req.body;
            const overwrite = req.query.overwrite === 'true';
            
            if (!data || !data.vis_params || !Array.isArray(data.vis_params)) {
                return res.status(400).json({ 
                    error: 'Invalid data format. Expected { vis_params: [...] }' 
                });
            }

            const result = await tilesApiService.importVisParams(data, overwrite, req);
            
            await logger.info('Vis params imported successfully', {
                module: 'vis-params',
                function: 'import',
                metadata: { count: data.vis_params.length, overwrite }
            });

            res.json(result);
        } catch (error) {
            await logger.error('Error importing vis params', {
                module: 'vis-params',
                function: 'import',
                metadata: { error: error.message }
            });
            res.status(500).json({ error: error.message });
        }
    };

    // Get Landsat collections
    controller.getLandsatCollections = async function(req, res) {
        try {
            const result = await tilesApiService.getLandsatCollections(req);
            
            await logger.info('Landsat collections retrieved successfully', {
                module: 'vis-params',
                function: 'getLandsatCollections'
            });

            res.json(result);
        } catch (error) {
            await logger.error('Error getting Landsat collections', {
                module: 'vis-params',
                function: 'getLandsatCollections',
                metadata: { error: error.message }
            });
            res.status(500).json({ error: error.message });
        }
    };

    // Update Landsat collections
    controller.updateLandsatCollections = async function(req, res) {
        try {
            const data = req.body;
            
            if (!Array.isArray(data)) {
                return res.status(400).json({ 
                    error: 'Invalid data format. Expected an array of collection mappings' 
                });
            }

            const result = await tilesApiService.updateLandsatCollections(data, req);
            
            await logger.info('Landsat collections updated successfully', {
                module: 'vis-params',
                function: 'updateLandsatCollections',
                metadata: { count: data.length }
            });

            res.json(result);
        } catch (error) {
            await logger.error('Error updating Landsat collections', {
                module: 'vis-params',
                function: 'updateLandsatCollections',
                metadata: { error: error.message }
            });
            res.status(500).json({ error: error.message });
        }
    };

    // Get Sentinel collections
    controller.getSentinelCollections = async function(req, res) {
        try {
            const result = await tilesApiService.getSentinelCollections(req);
            
            await logger.info('Sentinel collections retrieved successfully', {
                module: 'vis-params',
                function: 'getSentinelCollections'
            });

            res.json(result);
        } catch (error) {
            await logger.error('Error getting Sentinel collections', {
                module: 'vis-params',
                function: 'getSentinelCollections',
                metadata: { error: error.message }
            });
            res.status(500).json({ error: error.message });
        }
    };

    // Update Sentinel collections
    controller.updateSentinelCollections = async function(req, res) {
        try {
            const data = req.body;
            
            if (!data || typeof data !== 'object') {
                return res.status(400).json({ 
                    error: 'Invalid data format. Expected an object with collections configuration' 
                });
            }

            const result = await tilesApiService.updateSentinelCollections(data, req);
            
            await logger.info('Sentinel collections updated successfully', {
                module: 'vis-params',
                function: 'updateSentinelCollections'
            });

            res.json(result);
        } catch (error) {
            await logger.error('Error updating Sentinel collections', {
                module: 'vis-params',
                function: 'updateSentinelCollections',
                metadata: { error: error.message }
            });
            res.status(500).json({ error: error.message });
        }
    };

    // Initialize Sentinel collections
    controller.initializeSentinelCollections = async function(req, res) {
        try {
            const result = await tilesApiService.initializeSentinelCollections(req);
            
            await logger.info('Sentinel collections initialized successfully', {
                module: 'vis-params',
                function: 'initializeSentinelCollections'
            });

            res.json(result);
        } catch (error) {
            await logger.error('Error initializing Sentinel collections', {
                module: 'vis-params',
                function: 'initializeSentinelCollections',
                metadata: { error: error.message }
            });
            res.status(500).json({ error: error.message });
        }
    };

    // Get Sentinel bands for specific collection
    controller.getSentinelBands = async function(req, res) {
        try {
            const { collection_name } = req.params;
            const result = await tilesApiService.getSentinelBands(collection_name, req);
            
            await logger.info('Sentinel bands retrieved successfully', {
                module: 'vis-params',
                function: 'getSentinelBands',
                metadata: { collectionName: collection_name }
            });

            res.json(result);
        } catch (error) {
            await logger.error('Error getting Sentinel bands', {
                module: 'vis-params',
                function: 'getSentinelBands',
                metadata: { error: error.message, collectionName: req.params.collection_name }
            });
            res.status(500).json({ error: error.message });
        }
    };

    return controller;
};