module.exports = function (app) {

    var Internal = {};
    var repository = app.repository;
    var logsCollection = app.repository.collections.logs;
    var logsConfigCollection = app.repository.collections.logsConfig;
    
    /**
     * Emit logs update events via socket.io
     */
    Internal.emitLogsUpdate = function(event, data) {
        if (app.io) {
            app.io.to('logs-updates').emit(event, {
                timestamp: new Date().toISOString(),
                ...data
            });
        }
    };

    /**
     * Get logs statistics
     */
    app.get('/service/logs/statistics', function (request, response) {
        
        var pipeline = [
            {
                $facet: {
                    // Estatísticas por nível
                    byLevel: [
                        {
                            $group: {
                                _id: "$level",
                                count: { $sum: 1 }
                            }
                        },
                        {
                            $sort: { count: -1 }
                        }
                    ],
                    // Estatísticas por módulo
                    byModule: [
                        {
                            $group: {
                                _id: "$application.module",
                                count: { $sum: 1 }
                            }
                        },
                        {
                            $sort: { count: -1 }
                        },
                        {
                            $limit: 10
                        }
                    ],
                    // Total de logs e datas
                    totals: [
                        {
                            $group: {
                                _id: null,
                                totalLogs: { $sum: 1 },
                                oldestLog: { $min: "$timestamp" },
                                newestLog: { $max: "$timestamp" }
                            }
                        }
                    ],
                    // Logs por período (últimos 7 dias)
                    byDay: [
                        {
                            $match: {
                                timestamp: {
                                    $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
                                }
                            }
                        },
                        {
                            $group: {
                                _id: {
                                    $dateToString: {
                                        format: "%Y-%m-%d",
                                        date: "$timestamp"
                                    }
                                },
                                count: { $sum: 1 },
                                errors: {
                                    $sum: {
                                        $cond: [{ $eq: ["$level", "error"] }, 1, 0]
                                    }
                                }
                            }
                        },
                        {
                            $sort: { _id: 1 }
                        }
                    ]
                }
            }
        ];

        logsCollection
            .aggregate(pipeline)
            .toArray(function (err, results) {
                if (err) {
                    console.error('Erro ao buscar estatísticas de logs:', err);
                    response.status(500).json({ 
                        error: 'Erro interno do servidor',
                        details: err.message 
                    });
                    return;
                }

                var statistics = results[0] || {};
                
                // Processar totais
                var totals = statistics.totals && statistics.totals[0] || {
                    totalLogs: 0,
                    oldestLog: null,
                    newestLog: null
                };

                response.json({
                    success: true,
                    statistics: {
                        totals: totals,
                        byLevel: statistics.byLevel || [],
                        byModule: statistics.byModule || [],
                        byDay: statistics.byDay || []
                    }
                });
            });
    });

    /**
     * Get or create logs cleaner configuration from MongoDB
     */
    Internal.getLogsCleanerConfig = function(callback) {
        // Se não existir a coleção logsConfig, criar
        if (!logsConfigCollection) {
            logsConfigCollection = app.repository.db.collection('logsConfig');
            app.repository.collections.logsConfig = logsConfigCollection;
        }

        logsConfigCollection.findOne({ configType: 'logsCleaner' }, function(err, config) {
            if (err) {
                return callback(err);
            }
            
            if (!config) {
                // Criar configuração padrão se não existir
                var defaultConfig = {
                    configType: 'logsCleaner',
                    isEnabled: true,
                    daysToKeep: 30,
                    keepErrors: true,
                    batchSize: 1000,
                    simulate: false,
                    cronExpression: '0 0 2 */7 * *', // 2 AM a cada 7 dias
                    createdAt: new Date(),
                    updatedAt: new Date()
                };
                
                logsConfigCollection.insertOne(defaultConfig, function(insertErr, result) {
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
    app.get('/service/logs/job-status', function (request, response) {
        var fs = require('fs');
        var path = require('path');
        
        Internal.getLogsCleanerConfig(function(err, mongoConfig) {
            if (err) {
                console.error('Erro ao buscar configuração no MongoDB:', err);
                return response.status(500).json({
                    error: 'Erro ao buscar configuração',
                    details: err.message
                });
            }
            
            try {
                var logDir = app.config.logDir;
                
                // Ensure log directory exists
                if (!fs.existsSync(logDir)) {
                    try {
                        fs.mkdirSync(logDir, { recursive: true });
                        console.log('Created log directory for logs manager:', logDir);
                    } catch (mkdirError) {
                        console.error('Failed to create log directory:', mkdirError);
                    }
                }
                
                var logsCleanerLogFile = path.join(logDir, 'logsCleaner.log');
                
                var jobStatus = {
                    isConfigured: true,
                    isEnabled: mongoConfig.isEnabled,
                    lastExecution: null,
                    nextExecution: null,
                    recentLogs: [],
                    configuration: {
                        daysToKeep: mongoConfig.daysToKeep,
                        keepErrors: mongoConfig.keepErrors,
                        batchSize: mongoConfig.batchSize,
                        simulate: mongoConfig.simulate,
                        cronExpression: mongoConfig.cronExpression
                    }
                };
                
                // Tentar ler logs recentes
                if (fs.existsSync(logsCleanerLogFile)) {
                    try {
                        var logContent = fs.readFileSync(logsCleanerLogFile, 'utf8');
                        var lines = logContent.split('\n').filter(line => line.trim());
                        jobStatus.recentLogs = lines.slice(-20); // Últimas 20 linhas
                        
                        // Tentar extrair data da última execução
                        var startLines = lines.filter(line => line.includes('Job logsCleaner start'));
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
    app.put('/service/logs/job-config', function (request, response) {
        var newConfig = request.body;
        
        // Validações
        if (newConfig.daysToKeep === undefined || newConfig.batchSize === undefined) {
            response.status(400).json({
                error: 'Configuração inválida. daysToKeep e batchSize são obrigatórios.'
            });
            return;
        }
        
        if (newConfig.daysToKeep < 1 || newConfig.daysToKeep > 365) {
            response.status(400).json({
                error: 'daysToKeep deve estar entre 1 e 365 dias'
            });
            return;
        }
        
        if (newConfig.batchSize < 100 || newConfig.batchSize > 10000) {
            response.status(400).json({
                error: 'batchSize deve estar entre 100 e 10000'
            });
            return;
        }
        
        var updateData = {
            daysToKeep: parseInt(newConfig.daysToKeep),
            keepErrors: newConfig.keepErrors !== false,
            batchSize: parseInt(newConfig.batchSize),
            simulate: newConfig.simulate === true,
            isEnabled: newConfig.isEnabled !== false,
            updatedAt: new Date()
        };
        
        // Se não existir a coleção logsConfig, criar
        if (!logsConfigCollection) {
            logsConfigCollection = app.repository.db.collection('logsConfig');
            app.repository.collections.logsConfig = logsConfigCollection;
        }
        
        // Atualizar no MongoDB
        logsConfigCollection.updateOne(
            { configType: 'logsCleaner' },
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
                
                response.json({
                    success: true,
                    message: 'Configuração do job de limpeza de logs atualizada com sucesso',
                    newConfig: updateData
                });
            }
        );
    });

    /**
     * Trigger job execution manually
     */
    app.post('/service/logs/trigger-job', function (request, response) {
        var customParams = request.body || {};
        
        // Buscar configuração atual do MongoDB
        Internal.getLogsCleanerConfig(function(err, mongoConfig) {
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
                
                // Ensure log directory exists
                if (!fs.existsSync(app.config.logDir)) {
                    try {
                        fs.mkdirSync(app.config.logDir, { recursive: true });
                        console.log('Created log directory for manual logs execution:', app.config.logDir);
                    } catch (mkdirError) {
                        console.error('Failed to create log directory for manual execution:', mkdirError);
                        return response.status(500).json({
                            success: false,
                            error: 'Failed to create log directory: ' + mkdirError.message
                        });
                    }
                }
                
                var logFile = app.config.logDir + "/logsCleaner-manual.log";
                var logStream;
                
                try {
                    logStream = fs.createWriteStream(logFile, {'flags': 'a'});
                } catch (streamError) {
                    console.error('Failed to create log stream:', streamError);
                    return response.status(500).json({
                        success: false,
                        error: 'Failed to create log stream: ' + streamError.message
                    });
                }
                
                logStream.write(`${new Date().toISOString()} - Execução manual iniciada com parâmetros: ${JSON.stringify(params)}\n`);
                
                // Executar job manualmente
                app.middleware.jobs.logsCleaner(params, logStream, function(error) {
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
                            message: 'Job de limpeza de logs executado manualmente com sucesso',
                            logFile: 'logsCleaner-manual.log'
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
     * Get recent logs
     */
    app.get('/service/logs/recent', function (request, response) {
        var limit = parseInt(request.query.limit) || 100;
        var level = request.query.level;
        var module = request.query.module;
        var startDate = request.query.startDate;
        var endDate = request.query.endDate;
        
        // Construir query
        var query = {};
        
        if (level) {
            query.level = level;
        }
        
        if (module) {
            query['application.module'] = module;
        }
        
        if (startDate || endDate) {
            query.timestamp = {};
            if (startDate) {
                query.timestamp.$gte = new Date(startDate);
            }
            if (endDate) {
                query.timestamp.$lte = new Date(endDate);
            }
        }
        
        logsCollection
            .find(query)
            .sort({ timestamp: -1 })
            .limit(limit)
            .toArray(function (err, logs) {
                if (err) {
                    console.error('Erro ao buscar logs recentes:', err);
                    return response.status(500).json({
                        success: false,
                        error: 'Erro ao buscar logs',
                        details: err.message
                    });
                }
                
                response.json({
                    success: true,
                    logs: logs,
                    total: logs.length
                });
            });
    });

    /**
     * Get log details by ID
     */
    app.get('/service/logs/:logId', function (request, response) {
        var logId = request.params.logId;
        
        logsCollection.findOne({ logId: logId }, function (err, log) {
            if (err) {
                console.error('Erro ao buscar log:', err);
                return response.status(500).json({
                    success: false,
                    error: 'Erro ao buscar log',
                    details: err.message
                });
            }
            
            if (!log) {
                return response.status(404).json({
                    success: false,
                    error: 'Log não encontrado'
                });
            }
            
            response.json({
                success: true,
                log: log
            });
        });
    });

    /**
     * Delete logs manually (além do job automático)
     */
    app.delete('/service/logs/cleanup', function (request, response) {
        var daysToKeep = parseInt(request.query.daysToKeep) || 30;
        var keepErrors = request.query.keepErrors !== 'false';
        var dryRun = request.query.dryRun === 'true';
        
        // Calcular data de corte
        var cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
        
        // Construir query
        var deleteQuery = {
            timestamp: { $lt: cutoffDate }
        };
        
        if (keepErrors) {
            deleteQuery.level = { $ne: 'error' };
        }
        
        // Primeiro contar quantos serão deletados
        logsCollection.count(deleteQuery, function(err, count) {
            if (err) {
                console.error('Erro ao contar logs:', err);
                return response.status(500).json({
                    success: false,
                    error: 'Erro ao contar logs',
                    details: err.message
                });
            }
            
            if (dryRun) {
                // Apenas retornar contagem
                response.json({
                    success: true,
                    dryRun: true,
                    wouldDelete: count,
                    cutoffDate: cutoffDate,
                    keepErrors: keepErrors
                });
            } else {
                // Executar deleção
                logsCollection.deleteMany(deleteQuery, function(err, result) {
                    if (err) {
                        console.error('Erro ao deletar logs:', err);
                        return response.status(500).json({
                            success: false,
                            error: 'Erro ao deletar logs',
                            details: err.message
                        });
                    }
                    
                    var deletedCount = result.deletedCount || 0;
                    
                    // Emitir evento
                    Internal.emitLogsUpdate('manual-cleanup-completed', {
                        deletedCount: deletedCount,
                        cutoffDate: cutoffDate,
                        keepErrors: keepErrors
                    });
                    
                    response.json({
                        success: true,
                        deleted: deletedCount,
                        cutoffDate: cutoffDate,
                        keepErrors: keepErrors
                    });
                });
            }
        });
    });

    /**
     * Export logs to CSV
     */
    app.get('/service/logs/export', function (request, response) {
        var limit = parseInt(request.query.limit) || 1000;
        var level = request.query.level;
        var startDate = request.query.startDate;
        var endDate = request.query.endDate;
        
        // Construir query
        var query = {};
        
        if (level) {
            query.level = level;
        }
        
        if (startDate || endDate) {
            query.timestamp = {};
            if (startDate) {
                query.timestamp.$gte = new Date(startDate);
            }
            if (endDate) {
                query.timestamp.$lte = new Date(endDate);
            }
        }
        
        logsCollection
            .find(query)
            .sort({ timestamp: -1 })
            .limit(limit)
            .toArray(function (err, logs) {
                if (err) {
                    console.error('Erro ao exportar logs:', err);
                    return response.status(500).json({
                        success: false,
                        error: 'Erro ao exportar logs',
                        details: err.message
                    });
                }
                
                // Converter para CSV
                var csv = 'LogID,Timestamp,Level,Module,Function,Message,User,IP,URL\n';
                
                logs.forEach(function(log) {
                    csv += `"${log.logId || ''}",`;
                    csv += `"${log.timestamp || ''}",`;
                    csv += `"${log.level || ''}",`;
                    csv += `"${(log.application && log.application.module) || ''}",`;
                    csv += `"${(log.application && log.application.function) || ''}",`;
                    csv += `"${(log.message || '').replace(/"/g, '""')}",`;
                    csv += `"${(log.user && log.user.username) || ''}",`;
                    csv += `"${(log.request && log.request.ip) || ''}",`;
                    csv += `"${(log.request && log.request.url) || ''}"\n`;
                });
                
                // Enviar como download
                response.setHeader('Content-Type', 'text/csv');
                response.setHeader('Content-Disposition', 'attachment; filename="logs-export.csv"');
                response.send(csv);
            });
    });

};