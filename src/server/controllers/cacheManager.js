module.exports = function (app) {

    var Internal = {};
    var request = require('request');
    var fs = require('fs');
    var repository = app.repository;
    var pointsCollection = app.repository.collections.points;
    var campaignCollection = app.repository.collections.campaign;
    var cacheConfigCollection = app.repository.collections.cacheConfig;
    
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
    app.get('/service/cache/uncached-points', function (request, response) {
        
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
                    // Definir prioridade da campanha (pode ser configurado futuramente)
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
                    campaignPriority: 1,  // Prioridade da campanha primeiro
                    uncachedCount: -1     // Depois por número de pontos não cacheados
                }
            }
        ];

        pointsCollection
            .aggregate(query)
            .toArray(function (err, result) {
                if (err) {
                    console.error('Erro ao buscar pontos não cacheados:', err);
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
    });

    /**
     * Start cache simulation for specific campaign or all
     */
    app.post('/service/cache/simulate', function (request, response) {
        
        var campaignId = request.body.campaignId;
        var limitPoints = request.body.limitPoints || 10; // Limite de pontos por execução
        var simulate = request.body.simulate !== false; // Por padrão simula sem fazer cache real
        
        var query = { cached: { $ne: true } };
        if (campaignId) {
            query.campaign = campaignId;
        }

        // Buscar pontos não cacheados
        pointsCollection
            .find(query)
            .sort({ index: 1 })
            .limit(limitPoints)
            .toArray(function (err, points) {
                if (err) {
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

                // Processar pontos de forma assíncrona
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
                        console.error('Erro no processamento:', error);
                        response.status(500).json({
                            error: 'Erro no processamento',
                            details: error.message
                        });
                    });
            });
    });

    /**
     * Get cache status summary
     */
    app.get('/service/cache/status', function (request, response) {
        
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

                // Calcular totais gerais
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
    });

    /**
     * Get or create cache configuration from MongoDB
     */
    Internal.getCacheConfig = function(callback) {
        cacheConfigCollection.findOne({ configType: 'smartCacheProcessor' }, function(err, config) {
            if (err) {
                return callback(err);
            }
            
            if (!config) {
                // Criar configuração padrão se não existir
                var defaultConfig = {
                    configType: 'smartCacheProcessor',
                    isEnabled: true,
                    batchSize: 3,
                    maxPointsPerRun: 15,
                    simulate: true,
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
    app.get('/service/cache/job-status', function (request, response) {
        var fs = require('fs');
        var path = require('path');
        
        Internal.getCacheConfig(function(err, mongoConfig) {
            if (err) {
                console.error('Erro ao buscar configuração no MongoDB:', err);
                return response.status(500).json({
                    error: 'Erro ao buscar configuração',
                    details: err.message
                });
            }
            
            try {
                var logDir = app.config.logDir;
                var smartCacheLogFile = path.join(logDir, 'smartCacheProcessor.log');
                
                var jobStatus = {
                    isConfigured: true,
                    isEnabled: mongoConfig.isEnabled,
                    lastExecution: null,
                    nextExecution: null,
                    recentLogs: [],
                    configuration: {
                        batchSize: mongoConfig.batchSize,
                        maxPointsPerRun: mongoConfig.maxPointsPerRun,
                        simulate: mongoConfig.simulate,
                        cronExpression: mongoConfig.cronExpression
                    }
                };
                
                // Tentar ler logs recentes
                if (fs.existsSync(smartCacheLogFile)) {
                    try {
                        var logContent = fs.readFileSync(smartCacheLogFile, 'utf8');
                        var lines = logContent.split('\n').filter(line => line.trim());
                        jobStatus.recentLogs = lines.slice(-20); // Últimas 20 linhas
                        
                        // Tentar extrair data da última execução
                        var startLines = lines.filter(line => line.includes('Job smartCacheProcessor start'));
                        if (startLines.length > 0) {
                            var lastStartLine = startLines[startLines.length - 1];
                            var dateMatch = lastStartLine.match(/(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/);
                            if (dateMatch) {
                                jobStatus.lastExecution = dateMatch[1];
                            }
                        }
                    } catch (logError) {
                        console.warn('Erro ao ler log do job:', logError.message);
                    }
                }
                
                response.json({
                    success: true,
                    jobStatus: jobStatus
                });
                
            } catch (error) {
                console.error('Erro ao obter status do job:', error);
                response.status(500).json({
                    error: 'Erro ao obter status do job',
                    details: error.message
                });
            }
        });
    });

    /**
     * Update job configuration
     */
    app.put('/service/cache/job-config', function (request, response) {
        var newConfig = request.body;
        
        // Validações
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
            updatedAt: new Date()
        };
        
        // Atualizar no MongoDB
        cacheConfigCollection.updateOne(
            { configType: 'smartCacheProcessor' },
            { $set: updateData },
            { upsert: true },
            function(err, result) {
                if (err) {
                    console.error('Erro ao atualizar configuração no MongoDB:', err);
                    return response.status(500).json({
                        error: 'Erro ao salvar configuração',
                        details: err.message
                    });
                }
                
                // Também atualizar na memória (para compatibilidade com job atual)
                var jobConfig = app.config.jobs.toRun.find(job => job.name === 'smartCacheProcessor');
                if (jobConfig) {
                    jobConfig.params.batchSize = updateData.batchSize;
                    jobConfig.params.maxPointsPerRun = updateData.maxPointsPerRun;
                    jobConfig.params.simulate = updateData.simulate;
                }
                
                console.log('Configuração de cache atualizada:', updateData);
                
                response.json({
                    success: true,
                    message: 'Configuração do job atualizada com sucesso',
                    newConfig: updateData
                });
            }
        );
    });

    /**
     * Trigger job execution manually
     */
    app.post('/service/cache/trigger-job', function (request, response) {
        var customParams = request.body || {};
        
        // Buscar configuração atual do MongoDB
        Internal.getCacheConfig(function(err, mongoConfig) {
            if (err) {
                console.error('Erro ao buscar configuração para execução manual:', err);
                return response.status(500).json({
                    error: 'Erro ao buscar configuração',
                    details: err.message
                });
            }
            
            try {
                // Mesclar configuração do MongoDB com parâmetros customizados
                var params = Object.assign({}, mongoConfig, customParams);
                
                var fs = require('fs');
                var logFile = app.config.logDir + "/smartCacheProcessor-manual.log";
                var logStream = fs.createWriteStream(logFile, {'flags': 'a'});
                
                logStream.write(`${new Date().toISOString()} - Execução manual iniciada com parâmetros: ${JSON.stringify(params)}\n`);
                
                // Executar job manualmente
                app.middleware.jobs.smartCacheProcessor(params, logStream, function(error) {
                    var endMessage = error 
                        ? `${new Date().toISOString()} - Execução manual finalizada com erro: ${error.message}\n`
                        : `${new Date().toISOString()} - Execução manual finalizada com sucesso\n`;
                    
                    logStream.write(endMessage);
                    logStream.end();
                    
                    if (error) {
                        response.status(500).json({
                            error: 'Erro na execução manual do job',
                            details: error.message
                        });
                    } else {
                        response.json({
                            success: true,
                            message: 'Job executado manualmente com sucesso',
                            logFile: 'smartCacheProcessor-manual.log'
                        });
                    }
                });
                
            } catch (error) {
                console.error('Erro ao executar job manualmente:', error);
                response.status(500).json({
                    error: 'Erro ao executar job manualmente',
                    details: error.message
                });
            }
        });
    });

    /**
     * Update campaign priority
     */
    app.put('/service/cache/campaign-priority', function (request, response) {
        
        var campaignId = request.body.campaignId;
        var priority = parseInt(request.body.priority) || 3;
        
        if (!campaignId) {
            response.status(400).json({
                error: 'Campaign ID é obrigatório'
            });
            return;
        }

        campaignCollection
            .updateOne(
                { _id: campaignId },
                { $set: { cachePriority: priority } },
                function (err, result) {
                    if (err) {
                        response.status(500).json({
                            error: 'Erro ao atualizar prioridade',
                            details: err.message
                        });
                        return;
                    }

                    response.json({
                        success: true,
                        message: 'Prioridade atualizada com sucesso',
                        campaignId: campaignId,
                        priority: priority
                    });
                }
            );
    });

    /**
     * Process points for cache simulation
     */
    Internal.processPointsForCache = async function(points, simulate = true) {
    var results = [];
    
    for (let point of points) {
        try {
            // Buscar informações da campanha
            const campaign = await new Promise((resolve, reject) => {
                campaignCollection.findOne({ _id: point.campaign }, (err, result) => {
                    if (err) reject(err);
                    else resolve(result);
                });
            });
            
            if (!campaign) {
                console.warn(`Campanha ${point.campaign} não encontrada para ponto ${point._id}`);
                continue;
            }

            var pointResult = {
                pointId: point._id,
                campaign: point.campaign,
                processed: false,
                imagesProcessed: 0,
                errors: []
            };

            // Simular requisições para todos os anos da campanha
            for (let year = campaign.initialYear; year <= campaign.finalYear; year++) {
                
                // Processar para períodos DRY e WET
                for (let period of ['DRY', 'WET']) {
                    
                    if (simulate) {
                        // Apenas simular - não fazer requisições reais
                        console.log(`[SIMULAÇÃO] Processando ${point._id} - Landsat ${year} ${period}`);
                        pointResult.imagesProcessed++;
                        
                        // Simular tempo de processamento
                        await Internal.sleep(100);
                        
                    } else {
                        // Fazer requisições reais ao sistema de cache
                        try {
                            await Internal.simulateLeafletRequest(point, period, year, campaign);
                            pointResult.imagesProcessed++;
                            console.log(`[REAL] Cacheado ${point._id} - Landsat ${year} ${period}`);
                        } catch (error) {
                            console.error(`Erro ao cachear ${point._id} - Landsat ${year} ${period}:`, error.message);
                            pointResult.errors.push(`Landsat ${year} ${period}: ${error.message}`);
                        }
                    }
                }
            }

            pointResult.processed = true;
            results.push(pointResult);

            // Se não for simulação, marcar ponto como cacheado
            if (!simulate && pointResult.errors.length === 0) {
                await new Promise((resolve, reject) => {
                    pointsCollection.updateOne(
                        { _id: point._id },
                        { $set: { cached: true, cachedAt: new Date() } },
                        (err, result) => {
                            if (err) reject(err);
                            else resolve(result);
                        }
                    );
                });
            }

        } catch (error) {
            console.error(`Erro ao processar ponto ${point._id}:`, error);
            results.push({
                pointId: point._id,
                campaign: point.campaign,
                processed: false,
                error: error.message
            });
        }
    }

        return results;
    };


    /**
     * Simulate Leaflet tile requests for caching - Optimized for zoom 13 only
     */
    Internal.simulateLeafletRequest = async function(point, period, year, campaign) {
    
    // Configurações otimizadas - apenas zoom 13
    var subdomains = ['1', '2', '3', '4', '5'];
    var targetZoom = 13; // Usar apenas zoom 13 conforme solicitado
    
    // Visparam padrão ou da campaign
    var visparam = campaign.visparam || 'landsat-tvi-false';
    
    var requests = [];
    var subdomainIndex = Math.floor(Math.random() * subdomains.length); // Iniciar com subdomain aleatório
    
    // Emitir evento de início do processamento
    Internal.emitCacheUpdate('cache-point-processing', {
        pointId: point._id,
        campaign: campaign._id,
        period: period,
        year: year,
        source: 'manual'
    });
    
    // Calcular tiles ao redor do ponto apenas para zoom 13
    var tiles = Internal.getTilesAroundPoint(point.lat, point.lon, targetZoom, 1); // 1x1 ao redor do ponto
    
    var processedTiles = 0;
    var errorTiles = 0;
    
    for (let tile of tiles) {
        // Distribuir entre subdomains de forma circular
        var subdomain = subdomains[subdomainIndex % subdomains.length];
        subdomainIndex++;
        
        // URL seguindo padrão do Landsat
        var tileUrl = `https://tm${subdomain}.lapig.iesa.ufg.br/api/layers/landsat/${tile.x}/${tile.y}/${targetZoom}` +
                     `?period=${period}` +
                     `&year=${year}` +
                     `&visparam=${visparam}`;
        
        requests.push(
            new Promise((resolve, reject) => {
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
                        console.warn(`[ERRO] ${tileUrl}:`, error.message);
                        Internal.emitCacheUpdate('cache-tile-error', {
                            pointId: point._id,
                            url: tileUrl,
                            error: error.message
                        });
                        resolve(null); // Não falha o processo todo
                    } else {
                        processedTiles++;
                        console.log(`[OK] ${tileUrl} - Status: ${response.statusCode}`);
                        Internal.emitCacheUpdate('cache-tile-success', {
                            pointId: point._id,
                            url: tileUrl,
                            status: response.statusCode
                        });
                        resolve(response);
                    }
                });
            })
        );
    }
    
    // Executar todas as requisições em paralelo com limite maior
    var batchSize = 20; // Aumentar batch size já que estamos usando apenas zoom 13
    for (let i = 0; i < requests.length; i += batchSize) {
        var batch = requests.slice(i, i + batchSize);
        await Promise.all(batch);
        
        // Pequena pausa entre batches para não sobrecarregar
        if (i + batchSize < requests.length) {
            await Internal.sleep(200); // Reduzir tempo de espera
        }
    }
    
    // Emitir evento de conclusão
    Internal.emitCacheUpdate('cache-point-completed', {
        pointId: point._id,
        campaign: campaign._id,
        period: period,
        year: year,
        processedTiles: processedTiles,
        errorTiles: errorTiles,
        totalTiles: tiles.length,
        source: 'manual'
    });
    
    console.log(`Concluído: ${point._id} - ${period}/${year} - ${processedTiles}/${tiles.length} tiles (Zoom 13)`);
    };

    /**
     * Get tiles around a point for caching
     */
    Internal.getTilesAroundPoint = function(lat, lon, zoom, radius = 1) {
    var tiles = [];
    
    // Converter lat/lon para tile coordinates
    var centerTile = Internal.latLonToTile(lat, lon, zoom);
    
    // Gerar tiles ao redor do centro
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
        var x = Math.floor((lon + 180) / 360 * Math.pow(2, zoom));
        var y = Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, zoom));
        
        return { x: x, y: y };
    };

    /**
     * Sleep utility function
     */
    Internal.sleep = function(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    };

    /**
     * Get points from a specific campaign
     */
    app.get('/service/cache/campaign-points', function (request, response) {
        var campaignId = request.query.campaignId;
        
        if (!campaignId) {
            return response.status(400).json({
                success: false,
                error: 'ID da campanha é obrigatório'
            });
        }
        
        var collection = repository.collections.points;
        
        collection.find({ campaign: campaignId })
            .limit(1000) // Limitar para não sobrecarregar
            .toArray(function (err, points) {
                if (err) {
                    console.error('Erro ao buscar pontos da campanha:', err);
                    return response.status(500).json({
                        success: false,
                        error: 'Erro ao buscar pontos da campanha'
                    });
                }
                
                // Formatar pontos para exibição
                var formattedPoints = points.map(function(point) {
                    return {
                        _id: point._id,
                        lat: point.lat,
                        lon: point.lon,
                        dates: point.dates || []
                    };
                });
                
                response.json({
                    success: true,
                    points: formattedPoints,
                    total: formattedPoints.length
                });
            });
    });

    /**
     * Clear cache from tiles API
     */
    app.delete('/service/cache/clear', function (request, response) {
        var layer = request.query.layer;
        var year = request.query.year ? parseInt(request.query.year) : null;
        var x = request.query.x ? parseInt(request.query.x) : null;
        var y = request.query.y ? parseInt(request.query.y) : null;
        var z = request.query.z ? parseInt(request.query.z) : null;
        var pattern = request.query.pattern;

        // URL base da API de tiles
        var tilesApiUrl = 'https://tiles.lapig.iesa.ufg.br/api/layers/cache/clear';
        
        // Montar query string
        var queryParams = [];
        if (layer) queryParams.push(`layer=${layer}`);
        if (year) queryParams.push(`year=${year}`);
        if (x !== null) queryParams.push(`x=${x}`);
        if (y !== null) queryParams.push(`y=${y}`);
        if (z !== null) queryParams.push(`z=${z}`);
        if (pattern) queryParams.push(`pattern=${encodeURIComponent(pattern)}`);
        
        var fullUrl = tilesApiUrl;
        if (queryParams.length > 0) {
            fullUrl += '?' + queryParams.join('&');
        }
        
        console.log(`Chamando API de remoção de cache: ${fullUrl}`);
        
        // Fazer requisição para API de tiles
        request({
            url: fullUrl,
            method: 'DELETE',
            timeout: 60000,
            headers: {
                'User-Agent': 'TVI-CacheManager/1.0',
                'Accept': 'application/json'
            }
        }, function(error, apiResponse, body) {
            if (error) {
                console.error('Erro ao chamar API de remoção de cache:', error);
                return response.status(500).json({
                    success: false,
                    error: 'Erro ao conectar com API de tiles',
                    details: error.message
                });
            }
            
            try {
                var result = JSON.parse(body || '{}');
                
                if (apiResponse.statusCode === 200) {
                    console.log('Cache removido com sucesso:', result);
                    
                    response.json({
                        success: true,
                        removed: result.removed || 0,
                        message: result.message || 'Cache removido com sucesso'
                    });
                } else {
                    console.error('Erro na API de tiles:', apiResponse.statusCode, body);
                    response.status(apiResponse.statusCode).json({
                        success: false,
                        error: result.error || 'Erro ao remover cache',
                        details: result.details || body
                    });
                }
            } catch (parseError) {
                console.error('Erro ao parsear resposta da API:', parseError);
                response.status(500).json({
                    success: false,
                    error: 'Resposta inválida da API de tiles',
                    details: body
                });
            }
        });
    });

    /**
     * Reset cache status in MongoDB (set cached = false)
     */
    app.post('/service/cache/reset-mongo', function (request, response) {
        var campaignIds = request.body.campaignIds;
        var campaignId = request.body.campaignId;
        var pointIds = request.body.pointIds;
        var resetAll = request.body.resetAll;
        
        var updateQuery = {};
        var updateData = {
            $set: {
                cached: false,
                cachedAt: null,
                cachedBy: null
            }
        };
        
        // Construir query baseada nos parâmetros
        if (resetAll) {
            // Resetar todos os pontos
            updateQuery = { cached: true };
        } else if (campaignIds && campaignIds.length > 0) {
            // Resetar múltiplas campanhas
            updateQuery = { 
                campaign: { $in: campaignIds },
                cached: true
            };
        } else if (campaignId && pointIds && pointIds.length > 0) {
            // Resetar pontos específicos de uma campanha
            var numericPointIds = pointIds.map(function(id) {
                return parseInt(id);
            }).filter(function(id) {
                return !isNaN(id);
            });
            
            updateQuery = {
                campaign: campaignId,
                _id: { $in: numericPointIds },
                cached: true
            };
        } else {
            return response.status(400).json({
                success: false,
                error: 'Parâmetros inválidos. Forneça campaignIds, ou campaignId com pointIds, ou resetAll=true'
            });
        }
        
        // Log da operação
        console.log('Reset cache MongoDB - Query:', JSON.stringify(updateQuery));
        
        // Executar update
        pointsCollection.updateMany(
            updateQuery,
            updateData,
            function(err, result) {
                if (err) {
                    console.error('Erro ao resetar cache no MongoDB:', err);
                    return response.status(500).json({
                        success: false,
                        error: 'Erro ao resetar cache no banco de dados',
                        details: err.message
                    });
                }
                
                var updatedCount = result.modifiedCount || 0;
                console.log(`Cache resetado para ${updatedCount} pontos`);
                
                // Emitir evento de atualização
                Internal.emitCacheUpdate('cache-reset-mongodb', {
                    updatedCount: updatedCount,
                    resetType: resetAll ? 'all' : (campaignIds ? 'campaigns' : 'points'),
                    source: 'manual'
                });
                
                response.json({
                    success: true,
                    updated: updatedCount,
                    message: `${updatedCount} pontos marcados como não cacheados`
                });
            }
        );
    });

};