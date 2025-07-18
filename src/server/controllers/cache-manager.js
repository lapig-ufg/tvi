module.exports = function (app) {

    var Internal = {};
    var cacheManager = {};
    var request = require('request');
    var fs = require('fs');
    var axios = require('axios');
    var repository = app.repository;
    var pointsCollection = app.repository.collections.points;
    var campaignCollection = app.repository.collections.campaign;
    var cacheConfigCollection = app.repository.collections.cacheConfig;
    var db = app.repository.db;
    
    // Get tiles API service from app
    const tilesApiService = app.services.tilesApiService;
    const tilesApi = tilesApiService;
    const logger = app.services.logger;
    
    /**
     * Emit cache update events via socket.io
     */
    Internal.emitCacheUpdate = function(event, data) {
        if (app.io) {
            app.io.to('cache-updates').emit(event, {
                timestamp: new Date().toISOString(),
                ...data
            });
        }
    };

    /**
     * Get uncached points grouped by campaign with priority
     */
    cacheManager.getUncachedPoints = function (request, response) {
        
        var query = [
            {
                $match: {
                    cached: { $ne: true }
                }
            },
            {
                $lookup: {
                    from: "campaign",
                    localField: "campaign",
                    foreignField: "_id",
                    as: "campaignInfo"
                }
            },
            {
                $unwind: "$campaignInfo"
            },
            {
                $addFields: {
                    campaignPriority: {
                        $switch: {
                            branches: [
                                { case: { $regexMatch: { input: "$campaign", regex: /urgent/i } }, then: 1 },
                                { case: { $regexMatch: { input: "$campaign", regex: /priority/i } }, then: 2 }
                            ],
                            default: 3
                        }
                    }
                }
            },
            {
                $group: {
                    _id: "$campaign",
                    campaignInfo: { $first: "$campaignInfo" },
                    campaignPriority: { $first: "$campaignPriority" },
                    uncachedCount: { $sum: 1 },
                    points: {
                        $push: {
                            _id: "$_id",
                            index: "$index",
                            lon: "$lon",
                            lat: "$lat",
                            cached: "$cached"
                        }
                    }
                }
            },
            {
                $sort: {
                    campaignPriority: 1,
                    uncachedCount: -1
                }
            }
        ];

        pointsCollection
            .aggregate(query)
            .toArray(function (err, result) {
                if (err) {
                    logger.error('Erro ao buscar pontos não cacheados', {
                        module: 'cacheManager',
                        function: 'uncached-points',
                        metadata: { error: err.message },
                        req: request
                    });
                    response.status(500).json({ 
                        error: 'Erro interno do servidor',
                        details: err.message 
                    });
                    return;
                }

                var totalUncached = result.reduce((sum, campaign) => sum + campaign.uncachedCount, 0);
                
                response.json({
                    success: true,
                    totalUncachedPoints: totalUncached,
                    campaigns: result
                });
            });
    };

    /**
     * Start cache simulation for specific campaign or all
     */
    cacheManager.simulateCache = function (request, response) {
        
        var campaignId = request.body.campaignId;
        var limitPoints = request.body.limitPoints || 10;
        var simulate = request.body.simulate !== false;
        
        var query = { cached: { $ne: true } };
        if (campaignId) {
            query.campaign = campaignId;
        }

        pointsCollection
            .find(query)
            .sort({ index: 1 })
            .limit(limitPoints)
            .toArray(function (err, points) {
                if (err) {
                    logger.error('Erro ao buscar pontos', {
                        module: 'cacheManager',
                        function: 'simulate',
                        metadata: { error: err.message, campaignId, limitPoints },
                        req: request
                    });
                    response.status(500).json({ 
                        error: 'Erro ao buscar pontos',
                        details: err.message 
                    });
                    return;
                }

                if (points.length === 0) {
                    response.json({
                        success: true,
                        message: 'Nenhum ponto para cachear',
                        processed: 0
                    });
                    return;
                }

                Internal.processPointsForCache(points, simulate)
                    .then(function(results) {
                        response.json({
                            success: true,
                            message: `Processamento ${simulate ? 'simulado' : 'real'} iniciado`,
                            processed: results.length,
                            points: results
                        });
                    })
                    .catch(function(error) {
                        logger.error('Erro no processamento', {
                            module: 'cacheManager',
                            function: 'simulate',
                            metadata: { error: error.message, simulate },
                            req: request
                        });
                        response.status(500).json({
                            error: 'Erro no processamento',
                            details: error.message
                        });
                    });
            });
    };

    /**
     * Get cache status summary
     */
    cacheManager.getCacheStatus = function (request, response) {
        
        var pipeline = [
            {
                $group: {
                    _id: "$campaign",
                    totalPoints: { $sum: 1 },
                    cachedPoints: {
                        $sum: { $cond: [{ $eq: ["$cached", true] }, 1, 0] }
                    },
                    uncachedPoints: {
                        $sum: { $cond: [{ $ne: ["$cached", true] }, 1, 0] }
                    }
                }
            },
            {
                $lookup: {
                    from: "campaign",
                    localField: "_id",
                    foreignField: "_id",
                    as: "campaignInfo"
                }
            },
            {
                $unwind: "$campaignInfo"
            },
            {
                $addFields: {
                    cachePercentage: {
                        $multiply: [
                            { $divide: ["$cachedPoints", "$totalPoints"] },
                            100
                        ]
                    }
                }
            },
            {
                $sort: { uncachedPoints: -1 }
            }
        ];

        pointsCollection
            .aggregate(pipeline)
            .toArray(function (err, result) {
                if (err) {
                    response.status(500).json({
                        error: 'Erro ao obter status do cache',
                        details: err.message
                    });
                    return;
                }

                var totals = result.reduce((acc, campaign) => {
                    acc.totalPoints += campaign.totalPoints;
                    acc.cachedPoints += campaign.cachedPoints;
                    acc.uncachedPoints += campaign.uncachedPoints;
                    return acc;
                }, { totalPoints: 0, cachedPoints: 0, uncachedPoints: 0 });

                totals.cachePercentage = totals.totalPoints > 0 
                    ? (totals.cachedPoints / totals.totalPoints) * 100 
                    : 0;

                response.json({
                    success: true,
                    totals: totals,
                    campaigns: result
                });
            });
    };

    // Note: API methods for tiles API are defined later in the file to avoid duplication

    /**
     * Get or create cache configuration from MongoDB
     */
    Internal.getCacheConfig = function(callback) {
        cacheConfigCollection.findOne({ configType: 'smartCacheProcessor' }, function(err, config) {
            if (err) {
                return callback(err);
            }
            
            if (!config) {
                var defaultConfig = {
                    configType: 'smartCacheProcessor',
                    isEnabled: true,
                    batchSize: 3,
                    maxPointsPerRun: 15,
                    simulate: true,
                    useNewApi: true, // New flag to use new tiles API
                    cronExpression: '0 */15 * * * *',
                    createdAt: new Date(),
                    updatedAt: new Date()
                };
                
                cacheConfigCollection.insertOne(defaultConfig, function(insertErr, result) {
                    if (insertErr) {
                        return callback(insertErr);
                    }
                    callback(null, defaultConfig);
                });
            } else {
                callback(null, config);
            }
        });
    };

    /**
     * Get job status and logs
     */
    cacheManager.getJobStatus = function (request, response) {
        var fs = require('fs');
        var path = require('path');
        
        Internal.getCacheConfig(function(err, mongoConfig) {
            if (err) {
                logger.error('Erro ao buscar configuração no MongoDB', {
                    module: 'cacheManager',
                    function: 'job-status',
                    metadata: { error: err.message },
                    req: request
                });
                return response.status(500).json({
                    error: 'Erro ao buscar configuração',
                    details: err.message
                });
            }
            
            try {
                var logDir = app.config.logDir;
                
                if (!fs.existsSync(logDir)) {
                    try {
                        fs.mkdirSync(logDir, { recursive: true });
                        logger.info('Created log directory for cache manager', {
                            module: 'cacheManager',
                            function: 'job-status',
                            metadata: { logDir }
                        });
                    } catch (mkdirError) {
                        logger.error('Failed to create log directory', {
                            module: 'cacheManager',
                            function: 'job-status',
                            metadata: { error: mkdirError.message, logDir }
                        });
                    }
                }
                
                var smartCacheLogFile = path.join(logDir, 'smartCacheProcessor.log');
                
                var jobStatus = {
                    isConfigured: true,
                    isEnabled: mongoConfig.isEnabled,
                    useNewApi: mongoConfig.useNewApi || false,
                    lastExecution: null,
                    nextExecution: null,
                    recentLogs: [],
                    configuration: {
                        batchSize: mongoConfig.batchSize,
                        maxPointsPerRun: mongoConfig.maxPointsPerRun,
                        simulate: mongoConfig.simulate,
                        useNewApi: mongoConfig.useNewApi || false,
                        cronExpression: mongoConfig.cronExpression
                    }
                };
                
                if (fs.existsSync(smartCacheLogFile)) {
                    try {
                        var logContent = fs.readFileSync(smartCacheLogFile, 'utf8');
                        var lines = logContent.split('\n').filter(line => line.trim());
                        jobStatus.recentLogs = lines.slice(-20);
                        
                        var startLines = lines.filter(line => line.includes('Job smartCacheProcessor start'));
                        if (startLines.length > 0) {
                            var lastStartLine = startLines[startLines.length - 1];
                            var dateMatch = lastStartLine.match(/(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/);
                            if (dateMatch) {
                                jobStatus.lastExecution = dateMatch[1];
                            }
                        }
                    } catch (logError) {
                        logger.warn('Erro ao ler log do job', {
                            module: 'cacheManager',
                            function: 'job-status',
                            metadata: { error: logError.message, file: smartCacheLogFile }
                        });
                    }
                }
                
                response.json({
                    success: true,
                    jobStatus: jobStatus
                });
                
            } catch (error) {
                logger.error('Erro ao obter status do job', {
                    module: 'cacheManager',
                    function: 'job-status',
                    metadata: { error: error.message },
                    req: request
                });
                response.status(500).json({
                    error: 'Erro ao obter status do job',
                    details: error.message
                });
            }
        });
    };

    /**
     * Update job configuration
     */
    cacheManager.updateJobConfig = function (request, response) {
        var newConfig = request.body;
        
        if (!newConfig.batchSize || !newConfig.maxPointsPerRun) {
            response.status(400).json({
                error: 'Configuração inválida. batchSize e maxPointsPerRun são obrigatórios.'
            });
            return;
        }
        
        if (newConfig.batchSize < 1 || newConfig.batchSize > 10) {
            response.status(400).json({
                error: 'batchSize deve estar entre 1 e 10'
            });
            return;
        }
        
        if (newConfig.maxPointsPerRun < 5 || newConfig.maxPointsPerRun > 100) {
            response.status(400).json({
                error: 'maxPointsPerRun deve estar entre 5 e 100'
            });
            return;
        }
        
        var updateData = {
            batchSize: parseInt(newConfig.batchSize),
            maxPointsPerRun: parseInt(newConfig.maxPointsPerRun),
            simulate: newConfig.simulate !== false,
            isEnabled: newConfig.isEnabled !== false,
            useNewApi: newConfig.useNewApi === true,
            updatedAt: new Date()
        };
        
        cacheConfigCollection.updateOne(
            { configType: 'smartCacheProcessor' },
            { $set: updateData },
            { upsert: true },
            function(err, result) {
                if (err) {
                    logger.error('Erro ao atualizar configuração no MongoDB', {
                        module: 'cacheManager',
                        function: 'updateJobConfig',
                        metadata: { error: err.message, updateData },
                        req: request
                    });
                    return response.status(500).json({
                        error: 'Erro ao salvar configuração',
                        details: err.message
                    });
                }
                
                response.json({
                    success: true,
                    message: 'Configuração atualizada com sucesso',
                    configuration: updateData
                });
                
                // Emitir evento de atualização
                Internal.emitCacheUpdate('cache-config-updated', {
                    configuration: updateData
                });
            }
        );
    };

    /**
     * Process points for cache simulation - Refactored to use new API
     */
    Internal.processPointsForCache = async function(points, simulate = true) {
        var results = [];
        
        // Check if we should use the new API
        const config = await new Promise((resolve, reject) => {
            Internal.getCacheConfig((err, config) => {
                if (err) reject(err);
                else resolve(config);
            });
        });
        
        if (config.useNewApi && !simulate) {
            // Use new API for real caching
            for (let point of points) {
                try {
                    const result = await tilesApi.startPointCache(point._id, request);
                    results.push({
                        pointId: point._id,
                        campaign: point.campaign,
                        processed: true,
                        taskId: result.data && result.data.task_id,
                        method: 'new-api'
                    });
                    
                    Internal.emitCacheUpdate('cache-point-queued', {
                        pointId: point._id,
                        taskId: result.data && result.data.task_id,
                        source: 'new-api'
                    });
                } catch (error) {
                    await logger.error(`Error queueing point ${point._id} for cache`, {
                        module: 'cacheManager',
                        function: 'processPointsForCache',
                        metadata: { error: error.message, pointId: point._id, method: 'new-api' }
                    });
                    results.push({
                        pointId: point._id,
                        campaign: point.campaign,
                        processed: false,
                        error: error.message,
                        method: 'new-api'
                    });
                }
            }
        } else {
            // Use legacy method (existing code)
            for (let point of points) {
                try {
                    const campaign = await new Promise((resolve, reject) => {
                        campaignCollection.findOne({ _id: point.campaign }, (err, result) => {
                            if (err) reject(err);
                            else resolve(result);
                        });
                    });
                    
                    if (!campaign) {
                        await logger.warn(`Campanha ${point.campaign} não encontrada para ponto ${point._id}`, {
                            module: 'cacheManager',
                            function: 'processPointsForCache',
                            metadata: { campaignId: point.campaign, pointId: point._id }
                        });
                        continue;
                    }

                    var pointResult = {
                        pointId: point._id,
                        campaign: point.campaign,
                        processed: false,
                        imagesProcessed: 0,
                        errors: [],
                        method: 'legacy'
                    };

                    // Process for all visParamsEnable if using new API structure
                    const visParams = campaign.visParamsEnable || ['landsat-tvi-false'];
                    
                    for (let year = campaign.initialYear; year <= campaign.finalYear; year++) {
                        for (let period of ['DRY', 'WET']) {
                            for (let visparam of visParams) {
                                if (simulate) {
                                    pointResult.imagesProcessed++;
                                    await Internal.sleep(100);
                                } else {
                                    try {
                                        await Internal.simulateLeafletRequest(point, period, year, campaign, visparam, request);
                                        pointResult.imagesProcessed++;
                                    } catch (error) {
                                        await logger.error(`Erro ao cachear ${point._id} - ${visparam} ${year} ${period}`, {
                                            module: 'cacheManager',
                                            function: 'processPointsForCache',
                                            metadata: { error: error.message, pointId: point._id, visparam, year, period }
                                        });
                                        pointResult.errors.push(`${visparam} ${year} ${period}: ${error.message}`);
                                    }
                                }
                            }
                        }
                    }

                    pointResult.processed = true;
                    results.push(pointResult);

                    if (!simulate && pointResult.errors.length === 0) {
                        await new Promise((resolve, reject) => {
                            pointsCollection.updateOne(
                                { _id: point._id },
                                { $set: { cached: true, cachedAt: new Date(), cachedBy: 'legacy' } },
                                (err, result) => {
                                    if (err) reject(err);
                                    else resolve(result);
                                }
                            );
                        });
                    }

                } catch (error) {
                    await logger.error(`Erro ao processar ponto ${point._id}`, {
                        module: 'cacheManager',
                        function: 'processPointsForCache',
                        metadata: { error: error.message, pointId: point._id, campaign: point.campaign }
                    });
                    results.push({
                        pointId: point._id,
                        campaign: point.campaign,
                        processed: false,
                        error: error.message,
                        method: 'legacy'
                    });
                }
            }
        }

        return results;
    };

    /**
     * Simulate Leaflet tile requests for caching - Updated to use new API URLs
     */
    Internal.simulateLeafletRequest = async function(point, period, year, campaign, visparam = null, request = null) {
        const targetZoom = 13;
        
        visparam = visparam || campaign.visparam || 'landsat-tvi-false';
        
        Internal.emitCacheUpdate('cache-point-processing', {
            pointId: point._id,
            campaign: campaign._id,
            period: period,
            year: year,
            visparam: visparam,
            source: 'legacy'
        });
        
        const tiles = Internal.getTilesAroundPoint(point.lat, point.lon, targetZoom, 1);
        
        let processedTiles = 0;
        let errorTiles = 0;
        
        // Check if we should use new API URLs
        const useNewUrls = app.config.tilesApi && app.config.tilesApi.baseUrl;
        
        for (let tile of tiles) {
            try {
                let tileData;
                
                if (useNewUrls) {
                    // Use new API through service
                    const params = {
                        period: period,
                        year: year,
                        visparam: visparam
                    };
                    
                    // Determine if it's Landsat or Sentinel based on visparam
                    if (visparam.includes('landsat')) {
                        tileData = await tilesApi.getLandsatTile(tile.x, tile.y, targetZoom, params, request);
                    } else {
                        tileData = await tilesApi.getSentinelTile(tile.x, tile.y, targetZoom, params, request);
                    }
                    
                    processedTiles++;
                    Internal.emitCacheUpdate('cache-tile-success', {
                        pointId: point._id,
                        tile: `${tile.x}/${tile.y}/${targetZoom}`,
                        status: 200
                    });
                } else {
                    // Use legacy URLs
                    const subdomains = ['1', '2', '3', '4', '5'];
                    const subdomain = subdomains[Math.floor(Math.random() * subdomains.length)];
                    
                    const tileUrl = `https://tm${subdomain}.lapig.iesa.ufg.br/api/layers/landsat/${tile.x}/${tile.y}/${targetZoom}` +
                                   `?period=${period}` +
                                   `&year=${year}` +
                                   `&visparam=${visparam}`;
                    
                    await new Promise((resolve, reject) => {
                        request({
                            url: tileUrl,
                            method: 'GET',
                            timeout: 30000,
                            headers: {
                                'User-Agent': 'TVI-CacheManager/1.0'
                            }
                        }, (error, response, body) => {
                            if (error) {
                                errorTiles++;
                                logger.warn(`[ERRO] ${tileUrl}`, {
                                    module: 'cacheManager',
                                    function: 'simulateLeafletRequest',
                                    metadata: { error: error.message, tileUrl, pointId: point._id }
                                });
                                Internal.emitCacheUpdate('cache-tile-error', {
                                    pointId: point._id,
                                    url: tileUrl,
                                    error: error.message
                                });
                                resolve(null);
                            } else {
                                processedTiles++;
                                Internal.emitCacheUpdate('cache-tile-success', {
                                    pointId: point._id,
                                    url: tileUrl,
                                    status: response.statusCode
                                });
                                resolve(response);
                            }
                        });
                    });
                }
            } catch (error) {
                errorTiles++;
                await logger.error(`Error processing tile for point ${point._id}`, {
                    module: 'cacheManager',
                    function: 'simulateLeafletRequest',
                    metadata: { error: error.message, pointId: point._id, tile: `${tile.x}/${tile.y}/${targetZoom}` }
                });
                Internal.emitCacheUpdate('cache-tile-error', {
                    pointId: point._id,
                    tile: `${tile.x}/${tile.y}/${targetZoom}`,
                    error: error.message
                });
            }
        }
        
        Internal.emitCacheUpdate('cache-point-completed', {
            pointId: point._id,
            campaign: campaign._id,
            period: period,
            year: year,
            processedTiles: processedTiles,
            errorTiles: errorTiles,
            source: useNewUrls ? 'new-api' : 'legacy'
        });
        
        if (errorTiles > 0) {
            throw new Error(`Failed to cache ${errorTiles} tiles`);
        }
        
        return processedTiles;
    };

    /**
     * Calculate tiles around a point
     */
    Internal.getTilesAroundPoint = function(lat, lon, zoom, radius) {
        const tiles = [];
        const centerTile = Internal.latLonToTile(lat, lon, zoom);
        
        for (let dx = -radius; dx <= radius; dx++) {
            for (let dy = -radius; dy <= radius; dy++) {
                tiles.push({
                    x: centerTile.x + dx,
                    y: centerTile.y + dy,
                    z: zoom
                });
            }
        }
        
        return tiles;
    };

    /**
     * Convert lat/lon to tile coordinates
     */
    Internal.latLonToTile = function(lat, lon, zoom) {
        const n = Math.pow(2, zoom);
        const x = Math.floor((lon + 180) / 360 * n);
        const y = Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n);
        return { x: x, y: y };
    };

    /**
     * Sleep utility
     */
    Internal.sleep = function(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    };

    /**
     * Clear layers cache - Legacy endpoint
     */
    cacheManager.clearLayerCache = function (request, response) {
        var layer = request.body.layer;
        var campaign = request.body.campaign;
        var year = request.body.year;
        var points = request.body.points || [];
        
        if (!layer && !campaign) {
            response.status(400).json({
                error: 'Layer ou campaign é obrigatório'
            });
            return;
        }

        if (app.config.tilesApi && app.config.tilesApi.baseUrl) {
            // Use new API for cache clearing
            const params = {};
            if (layer) params.layer = layer;
            if (year) params.year = parseInt(year);
            
            tilesApi.clearCache(params, request)
                .then(result => {
                    Internal.emitCacheUpdate('cache-cleared', {
                        layer: layer,
                        year: year,
                        source: 'new-api'
                    });
                    
                    response.json({
                        success: true,
                        message: 'Cache limpo com sucesso',
                        data: result
                    });
                })
                .catch(error => {
                    logger.error('Error clearing cache', {
                        module: 'cacheManager',
                        function: 'clear-layer',
                        metadata: { error: error.message, layer, year },
                        req: request
                    });
                    response.status(500).json({
                        error: 'Erro ao limpar cache',
                        details: error.message
                    });
                });
        } else {
            // Legacy implementation
            request({
                url: `${app.config.tilesApi.baseUrl}/api/layers/cache/clear`,
                method: 'POST',
                json: true,
                body: {
                    layer: layer,
                    campaign: campaign,
                    year: year,
                    points: points
                },
                timeout: 60000
            }, function (error, httpResponse, body) {
                if (error) {
                    logger.error('Erro ao limpar cache', {
                        module: 'cacheManager',
                        function: 'clear-layer',
                        metadata: { error: error.message, layer, campaign, year },
                        req: request
                    });
                    response.status(500).json({
                        error: 'Erro ao limpar cache',
                        details: error.message
                    });
                    return;
                }

                response.json({
                    success: true,
                    message: 'Cache limpo com sucesso',
                    response: body
                });
            });
        }
    };

    /**
     * Controller method mappings for routes
     */
    
    // Map internal methods to controller exports
    // cacheManager already declared at the beginning of the file
    
    // ===== NEW TILES API METHODS =====
    
    /**
     * Get API cache statistics
     */
    cacheManager.getApiCacheStats = async function (request, response) {
        try {
            const stats = await tilesApi.getCacheStats(request);
            
            response.json({
                success: true,
                data: stats
            });
        } catch (error) {
            await logger.error('Error getting API cache stats', {
                module: 'cacheManager',
                function: 'getApiCacheStats',
                metadata: { error: error.message },
                req: request
            });
            response.status(500).json({
                error: 'Error getting API cache stats',
                details: error.message
            });
        }
    };
    
    /**
     * Clear API cache
     */
    cacheManager.clearApiCache = async function (request, response) {
        try {
            const params = request.body;
            const result = await tilesApi.clearCache(params, request);
            
            Internal.emitCacheUpdate('cache-cleared', {
                ...params,
                source: 'tiles-api'
            });
            
            response.json({
                success: true,
                data: result
            });
        } catch (error) {
            await logger.error('Error clearing API cache', {
                module: 'cacheManager',
                function: 'clearApiCache',
                metadata: { error: error.message },
                req: request
            });
            response.status(500).json({
                error: 'Error clearing API cache',
                details: error.message
            });
        }
    };
    
    /**
     * Get active tasks
     */
    cacheManager.getActiveTasks = async function (request, response) {
        try {
            const tasks = await tilesApi.getActiveTasks(request);
            
            response.json({
                success: true,
                data: tasks
            });
        } catch (error) {
            await logger.error('Error getting active tasks', {
                module: 'cacheManager',
                function: 'getActiveTasks',
                metadata: { error: error.message },
                req: request
            });
            response.status(500).json({
                error: 'Error getting active tasks',
                details: error.message
            });
        }
    };
    
    /**
     * Get task status
     */
    cacheManager.getTaskStatus = async function (request, response) {
        const { taskId } = request.params;
        
        try {
            const status = await tilesApi.getTaskStatus(taskId, request);
            
            response.json({
                success: true,
                data: status
            });
        } catch (error) {
            await logger.error('Error getting task status', {
                module: 'cacheManager',
                function: 'getTaskStatus',
                metadata: { error: error.message, taskId },
                req: request
            });
            response.status(500).json({
                error: 'Error getting task status',
                details: error.message
            });
        }
    };
    
    /**
     * Cancel task
     */
    cacheManager.cancelTask = async function (request, response) {
        const { taskId } = request.params;
        
        try {
            const result = await tilesApi.cancelTask(taskId, request);
            
            Internal.emitCacheUpdate('task-cancelled', {
                taskId: taskId,
                source: 'tiles-api'
            });
            
            response.json({
                success: true,
                data: result
            });
        } catch (error) {
            await logger.error('Error cancelling task', {
                module: 'cacheManager',
                function: 'cancelTask',
                metadata: { error: error.message, taskId },
                req: request
            });
            response.status(500).json({
                error: 'Error cancelling task',
                details: error.message
            });
        }
    };
    
    /**
     * Start point cache
     */
    cacheManager.startPointCache = async function (request, response) {
        try {
            const data = request.body;
            
            if (!data.pointId) {
                return response.status(400).json({
                    error: 'Point ID is required'
                });
            }
            
            const result = await tilesApi.startPointCache(data, request);
            
            Internal.emitCacheUpdate('point-cache-started', {
                pointId: data.pointId,
                taskId: result.data && result.data.task_id,
                source: 'tiles-api'
            });
            
            response.json({
                success: true,
                data: result
            });
        } catch (error) {
            await logger.error('Error starting point cache', {
                module: 'cacheManager',
                function: 'startPointCache',
                metadata: { error: error.message },
                req: request
            });
            response.status(500).json({
                error: 'Error starting point cache',
                details: error.message
            });
        }
    };
    
    /**
     * Get point cache status
     */
    cacheManager.getPointCacheStatus = async function (request, response) {
        const { pointId } = request.params;
        
        try {
            const status = await tilesApi.getPointCacheStatus(pointId, request);
            
            response.json({
                success: true,
                data: status
            });
        } catch (error) {
            await logger.error('Error getting point cache status', {
                module: 'cacheManager',
                function: 'getPointCacheStatus',
                metadata: { error: error.message, pointId },
                req: request
            });
            response.status(500).json({
                error: 'Error getting point cache status',
                details: error.message
            });
        }
    };
    
    /**
     * Start campaign cache
     */
    cacheManager.startCampaignCache = async function (request, response) {
        try {
            const data = request.body;
            
            if (!data.campaignId) {
                return response.status(400).json({
                    error: 'Campaign ID is required'
                });
            }
            
            const result = await tilesApi.startCampaignCache(data, request);
            
            Internal.emitCacheUpdate('campaign-cache-started', {
                campaignId: data.campaignId,
                taskId: result.data && result.data.task_id,
                source: 'tiles-api'
            });
            
            response.json({
                success: true,
                data: result
            });
        } catch (error) {
            await logger.error('Error starting campaign cache', {
                module: 'cacheManager',
                function: 'startCampaignCache',
                metadata: { error: error.message },
                req: request
            });
            response.status(500).json({
                error: 'Error starting campaign cache',
                details: error.message
            });
        }
    };
    
    /**
     * Get campaign cache status
     */
    cacheManager.getCampaignCacheStatus = async function (request, response) {
        const { campaignId } = request.params;
        
        try {
            const status = await tilesApi.getCampaignCacheStatus(campaignId, request);
            
            response.json({
                success: true,
                data: status
            });
        } catch (error) {
            await logger.error('Error getting campaign cache status', {
                module: 'cacheManager',
                function: 'getCampaignCacheStatus',
                metadata: { error: error.message, campaignId },
                req: request
            });
            response.status(500).json({
                error: 'Error getting campaign cache status',
                details: error.message
            });
        }
    };

    // Additional methods that need to be implemented
    cacheManager.warmupCache = async function (request, response) {
        try {
            const data = request.body;
            
            if (!data.layer) {
                return response.status(400).json({
                    error: 'Layer is required'
                });
            }
            
            const result = await tilesApi.warmupCache(data, request);
            
            Internal.emitCacheUpdate('cache-warmup-started', {
                layer: data.layer,
                taskId: result.data && result.data.task_id,
                source: 'api'
            });
            
            response.json({
                success: true,
                data: result
            });
        } catch (error) {
            await logger.error('Error starting cache warmup', {
                module: 'cacheManager',
                function: 'startCacheWarmup',
                metadata: { error: error.message },
                req: request
            });
            response.status(500).json({
                error: 'Error starting cache warmup',
                details: error.message
            });
        }
    };
    
    cacheManager.analyzeCachePatterns = async function (request, response) {
        const { days = 7 } = request.body;
        
        try {
            // Analyze cache access patterns from MongoDB logs
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - days);
            
            // Aggregate cache hits by region and time
            const patterns = await new Promise((resolve, reject) => {
                pointsCollection.aggregate([
                    {
                        $match: {
                            cachedAt: { $gte: startDate },
                            cached: true
                        }
                    },
                    {
                        $group: {
                            _id: {
                                campaign: '$campaign',
                                date: { $dateToString: { format: '%Y-%m-%d', date: '$cachedAt' } },
                                hour: { $hour: '$cachedAt' }
                            },
                            count: { $sum: 1 },
                            points: { $push: { lat: '$lat', lon: '$lon' } }
                        }
                    },
                    {
                        $sort: { '_id.date': -1, '_id.hour': -1 }
                    }
                ]).toArray((err, results) => {
                    if (err) reject(err);
                    else resolve(results);
                });
            });
            
            // Calculate heatmap data
            const heatmapData = patterns.reduce((acc, pattern) => {
                pattern.points.forEach(point => {
                    const key = `${Math.floor(point.lat)},${Math.floor(point.lon)}`;
                    acc[key] = (acc[key] || 0) + 1;
                });
                return acc;
            }, {});
            
            // Identify peak hours
            const hourlyStats = patterns.reduce((acc, pattern) => {
                const hour = pattern._id.hour;
                acc[hour] = (acc[hour] || 0) + pattern.count;
                return acc;
            }, {});
            
            const peakHour = Object.entries(hourlyStats)
                .sort(([,a], [,b]) => b - a)[0];
            
            response.json({
                success: true,
                data: {
                    patterns: patterns.slice(0, 100), // Limit results
                    heatmap: Object.entries(heatmapData).map(([coords, count]) => {
                        const [lat, lon] = coords.split(',');
                        return { lat: parseFloat(lat), lon: parseFloat(lon), intensity: count };
                    }),
                    summary: {
                        totalAccesses: patterns.reduce((sum, p) => sum + p.count, 0),
                        uniqueCampaigns: new Set(patterns.map(p => p._id.campaign)).size,
                        peakHour: peakHour ? { hour: parseInt(peakHour[0]), count: peakHour[1] } : null,
                        analyzedDays: days
                    }
                }
            });
        } catch (error) {
            await logger.error('Error analyzing cache patterns', {
                module: 'cacheManager',
                function: 'analyzeCachePatterns',
                metadata: { error: error.message, days },
                req: request
            });
            response.status(500).json({
                error: 'Error analyzing cache patterns',
                details: error.message
            });
        }
    };
    
    cacheManager.getCacheRecommendations = async function (request, response) {
        try {
            // Analyze recent cache patterns
            const sevenDaysAgo = new Date();
            sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
            
            // Get most accessed but uncached regions
            const uncachedHotspots = await new Promise((resolve, reject) => {
                pointsCollection.aggregate([
                    {
                        $match: {
                            cached: false,
                            updatedAt: { $gte: sevenDaysAgo }
                        }
                    },
                    {
                        $group: {
                            _id: {
                                campaign: '$campaign',
                                region: {
                                    lat: { $floor: { $divide: ['$lat', 5] } },
                                    lon: { $floor: { $divide: ['$lon', 5] } }
                                }
                            },
                            count: { $sum: 1 },
                            bounds: {
                                $push: {
                                    minLat: '$lat',
                                    maxLat: '$lat',
                                    minLon: '$lon',
                                    maxLon: '$lon'
                                }
                            }
                        }
                    },
                    {
                        $sort: { count: -1 }
                    },
                    {
                        $limit: 10
                    }
                ]).toArray((err, results) => {
                    if (err) reject(err);
                    else resolve(results);
                });
            });
            
            // Get cache statistics
            const cacheStats = await new Promise((resolve, reject) => {
                pointsCollection.aggregate([
                    {
                        $group: {
                            _id: null,
                            totalPoints: { $sum: 1 },
                            cachedPoints: { $sum: { $cond: ['$cached', 1, 0] } },
                            avgCacheAge: {
                                $avg: {
                                    $cond: [
                                        '$cached',
                                        { $subtract: [new Date(), '$cachedAt'] },
                                        null
                                    ]
                                }
                            }
                        }
                    }
                ]).toArray((err, results) => {
                    if (err) reject(err);
                    else resolve(results[0] || {});
                });
            });
            
            const recommendations = [];
            
            // Recommend caching uncached hotspots
            if (uncachedHotspots.length > 0) {
                recommendations.push({
                    type: 'uncached_hotspots',
                    priority: 'high',
                    description: 'Pre-cache frequently accessed but uncached regions',
                    regions: uncachedHotspots.map(h => ({
                        campaign: h._id.campaign,
                        accessCount: h.count,
                        bounds: {
                            minLat: Math.min(...h.bounds.map(b => b.minLat)),
                            maxLat: Math.max(...h.bounds.map(b => b.maxLat)),
                            minLon: Math.min(...h.bounds.map(b => b.minLon)),
                            maxLon: Math.max(...h.bounds.map(b => b.maxLon))
                        }
                    }))
                });
            }
            
            // Recommend cache refresh if average age is high
            if (cacheStats.avgCacheAge && cacheStats.avgCacheAge > 30 * 24 * 60 * 60 * 1000) {
                recommendations.push({
                    type: 'cache_refresh',
                    priority: 'medium',
                    description: 'Refresh old cached data',
                    avgCacheAgeDays: Math.floor(cacheStats.avgCacheAge / (24 * 60 * 60 * 1000))
                });
            }
            
            // Recommend zoom level optimization
            recommendations.push({
                type: 'zoom_optimization',
                priority: 'medium',
                description: 'Optimize cache for most used zoom levels',
                recommended_zooms: [12, 13, 14] // Based on typical usage patterns
            });
            
            // Add coverage recommendation
            const cachePercentage = cacheStats.totalPoints > 0 ? 
                (cacheStats.cachedPoints / cacheStats.totalPoints * 100) : 0;
                
            if (cachePercentage < 80) {
                recommendations.push({
                    type: 'increase_coverage',
                    priority: 'high',
                    description: 'Increase cache coverage',
                    currentCoverage: cachePercentage.toFixed(2) + '%',
                    targetCoverage: '80%'
                });
            }
            
            response.json({
                success: true,
                recommendations: recommendations,
                stats: {
                    totalPoints: cacheStats.totalPoints || 0,
                    cachedPoints: cacheStats.cachedPoints || 0,
                    cachePercentage: cachePercentage.toFixed(2)
                }
            });
        } catch (error) {
            await logger.error('Error getting cache recommendations', {
                module: 'cacheManager',
                function: 'getCacheRecommendations',
                metadata: { error: error.message },
                req: request
            });
            response.status(500).json({
                error: 'Error getting cache recommendations',
                details: error.message
            });
        }
    };
    
    cacheManager.clearPointCache = async function (request, response) {
        const { pointId } = request.params;
        
        try {
            // Clear cache for specific point
            // This would interact with the tiles API to clear cached tiles for this point
            
            // Update MongoDB to mark point as not cached
            await new Promise((resolve, reject) => {
                pointsCollection.updateOne(
                    { _id: pointId },
                    { $set: { cached: false, cachedAt: null } },
                    (err, result) => {
                        if (err) reject(err);
                        else resolve(result);
                    }
                );
            });
            
            Internal.emitCacheUpdate('cache-point-cleared', {
                pointId: pointId,
                source: 'api'
            });
            
            response.json({
                success: true,
                message: `Cache cleared for point ${pointId}`
            });
        } catch (error) {
            await logger.error('Error clearing point cache', {
                module: 'cacheManager',
                function: 'clearPointCache',
                metadata: { error: error.message, pointId },
                req: request
            });
            response.status(500).json({
                error: 'Error clearing point cache',
                details: error.message
            });
        }
    };
    
    cacheManager.clearCampaignCache = async function (request, response) {
        const { campaignId } = request.params;
        
        try {
            // Clear cache for all points in campaign
            const result = await new Promise((resolve, reject) => {
                pointsCollection.updateMany(
                    { campaign: campaignId, cached: true },
                    { $set: { cached: false, cachedAt: null } },
                    (err, result) => {
                        if (err) reject(err);
                        else resolve(result);
                    }
                );
            });
            
            Internal.emitCacheUpdate('cache-campaign-cleared', {
                campaignId: campaignId,
                pointsCleared: result.modifiedCount,
                source: 'api'
            });
            
            response.json({
                success: true,
                message: `Cache cleared for campaign ${campaignId}`,
                pointsCleared: result.modifiedCount
            });
        } catch (error) {
            await logger.error('Error clearing campaign cache', {
                module: 'cacheManager',
                function: 'clearCampaignCache',
                metadata: { error: error.message, campaignId },
                req: request
            });
            response.status(500).json({
                error: 'Error clearing campaign cache',
                details: error.message
            });
        }
    };
    
    cacheManager.getMegatile = async function (request, response) {
        const { layer, x, y, z } = request.params;
        const { years, size = 2 } = request.query;
        
        try {
            // Validate parameters
            const tileX = parseInt(x);
            const tileY = parseInt(y);
            const zoom = parseInt(z);
            const megatileSize = parseInt(size);
            
            if (isNaN(tileX) || isNaN(tileY) || isNaN(zoom)) {
                return response.status(400).json({
                    error: 'Invalid tile coordinates'
                });
            }
            
            if (megatileSize < 1 || megatileSize > 4) {
                return response.status(400).json({
                    error: 'Megatile size must be between 1 and 4'
                });
            }
            
            // Calculate megatile bounds
            const startX = Math.floor(tileX / megatileSize) * megatileSize;
            const startY = Math.floor(tileY / megatileSize) * megatileSize;
            
            // Forward request to tiles API
            const tilesApiUrl = `${tilesApiService.config.baseUrl}/megatile/${layer}/${startX}/${startY}/${zoom}`;
            const queryParams = new URLSearchParams();
            
            if (years) {
                queryParams.append('years', years);
            }
            queryParams.append('size', megatileSize.toString());
            
            const fullUrl = tilesApiUrl + '?' + queryParams.toString();
            
            const megatileResponse = await axios.get(fullUrl, {
                headers: {
                    'Accept': 'image/png',
                    'X-API-Key': tilesApiService.config.apiKey
                },
                responseType: 'arraybuffer'
            });
            
            // Get the buffer from response
            const buffer = Buffer.from(megatileResponse.data);
            
            response.set({
                'Content-Type': 'image/png',
                'Cache-Control': 'public, max-age=31536000'
            });
            
            response.send(buffer);
            
        } catch (error) {
            await logger.error('Error getting megatile', {
                module: 'cacheManager',
                function: 'getMegatile',
                metadata: { error: error.message, layer, x, y, z, years, size },
                req: request
            });
            response.status(500).json({
                error: 'Error getting megatile',
                details: error.message
            });
        }
    };
    
    cacheManager.generateSpriteSheet = async function (request, response) {
        try {
            const { layer, tiles, format = 'png' } = request.body;
            
            // Validate input
            if (!layer || !tiles || !Array.isArray(tiles)) {
                return response.status(400).json({
                    error: 'Invalid request: layer and tiles array required'
                });
            }
            
            if (tiles.length === 0 || tiles.length > 100) {
                return response.status(400).json({
                    error: 'Tiles array must contain 1-100 tiles'
                });
            }
            
            // Generate unique sprite ID
            const spriteId = 'sprite-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
            
            // Store sprite generation task
            const task = {
                id: spriteId,
                type: 'sprite_generation',
                layer: layer,
                tiles: tiles,
                format: format,
                status: 'pending',
                createdAt: new Date(),
                progress: 0
            };
            
            // Add to active tasks
            await new Promise((resolve, reject) => {
                db.collection('cache_tasks').insertOne(task, (err, result) => {
                    if (err) reject(err);
                    else resolve(result);
                });
            });
            
            // Start async sprite generation
            setImmediate(async () => {
                try {
                    // Update task status
                    await new Promise((resolve, reject) => {
                        db.collection('cache_tasks').updateOne(
                            { id: spriteId },
                            { $set: { status: 'processing' } },
                            (err, result) => {
                                if (err) reject(err);
                                else resolve(result);
                            }
                        );
                    });
                    
                    // Forward to tiles API
                    const tilesApiUrl = `${tilesApiService.config.baseUrl}/sprite/generate`;
                    const spriteResponse = await axios.post(tilesApiUrl, {
                        layer: layer,
                        tiles: tiles,
                        format: format
                    }, {
                        headers: {
                            'Content-Type': 'application/json',
                            'X-API-Key': tilesApiService.config.apiKey
                        }
                    });
                    
                    const result = spriteResponse.data;
                    
                    // Update task with result
                    await new Promise((resolve, reject) => {
                        db.collection('cache_tasks').updateOne(
                            { id: spriteId },
                            { 
                                $set: { 
                                    status: 'completed',
                                    completedAt: new Date(),
                                    progress: 100,
                                    result: result
                                } 
                            },
                            (err, result) => {
                                if (err) reject(err);
                                else resolve(result);
                            }
                        );
                    });
                    
                    Internal.emitCacheUpdate('sprite-generated', {
                        spriteId: spriteId,
                        layer: layer,
                        tilesCount: tiles.length
                    });
                    
                } catch (error) {
                    // Update task with error
                    await new Promise((resolve, reject) => {
                        db.collection('cache_tasks').updateOne(
                            { id: spriteId },
                            { 
                                $set: { 
                                    status: 'failed',
                                    error: error.message,
                                    failedAt: new Date()
                                } 
                            },
                            (err, result) => {
                                if (err) reject(err);
                                else resolve(result);
                            }
                        );
                    });
                    
                    await logger.error('Sprite generation failed', {
                        module: 'cacheManager',
                        function: 'generateSpriteSheet',
                        metadata: { error: error.message, spriteId }
                    });
                }
            });
            
            response.json({
                success: true,
                data: {
                    sprite_id: spriteId,
                    status: 'processing',
                    message: 'Sprite generation started'
                }
            });
            
        } catch (error) {
            await logger.error('Error generating sprite sheet', {
                module: 'cacheManager',
                function: 'generateSpriteSheet',
                metadata: { error: error.message },
                req: request
            });
            response.status(500).json({
                error: 'Error generating sprite sheet',
                details: error.message
            });
        }
    };
    
    cacheManager.getSpriteSheetStatus = async function (request, response) {
        const { spriteId } = request.params;
        
        try {
            if (!spriteId) {
                return response.status(400).json({
                    error: 'Sprite ID is required'
                });
            }
            
            // Get sprite task from database
            const task = await new Promise((resolve, reject) => {
                db.collection('cache_tasks').findOne(
                    { id: spriteId, type: 'sprite_generation' },
                    (err, task) => {
                        if (err) reject(err);
                        else resolve(task);
                    }
                );
            });
            
            if (!task) {
                return response.status(404).json({
                    error: 'Sprite task not found'
                });
            }
            
            // Format response based on task status
            const responseData = {
                sprite_id: task.id,
                status: task.status,
                layer: task.layer,
                tiles_count: task.tiles.length,
                created_at: task.createdAt,
                progress: task.progress || 0
            };
            
            if (task.status === 'completed') {
                responseData.completed_at = task.completedAt;
                responseData.result = task.result;
                
                // If result contains URL, check if it's still valid
                if (task.result && task.result.url) {
                    responseData.download_url = task.result.url;
                    responseData.expires_at = task.result.expiresAt;
                }
            } else if (task.status === 'failed') {
                responseData.failed_at = task.failedAt;
                responseData.error = task.error;
            }
            
            response.json({
                success: true,
                data: responseData
            });
            
        } catch (error) {
            await logger.error('Error getting sprite sheet status', {
                module: 'cacheManager',
                function: 'getSpriteSheetStatus',
                metadata: { error: error.message, spriteId },
                req: request
            });
            response.status(500).json({
                error: 'Error getting sprite sheet status',
                details: error.message
            });
        }
    };
    
    return cacheManager;
};