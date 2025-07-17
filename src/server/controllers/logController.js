module.exports = function(app) {
    const LogController = {};
    const logger = app.services.logger;

    /**
     * Middleware para verificar autenticação de admin
     */
    const checkAdminAuth = (req, res, next) => {
        if (!req.session || !req.session.admin || !req.session.admin.superAdmin) {
            return res.status(401).json({ 
                success: false, 
                error: 'Unauthorized access' 
            });
        }
        next();
    };

    /**
     * Buscar logs com filtros
     */
    LogController.getLogs = async (req, res) => {
        try {
            const {
                level,
                startDate,
                endDate,
                userId,
                module,
                page = 1,
                limit = 50,
                search
            } = req.query;

            const filters = {};
            if (level) filters.level = level;
            if (startDate) filters.startDate = startDate;
            if (endDate) filters.endDate = endDate;
            if (userId) filters.userId = userId;
            if (module) filters.module = module;

            const options = {
                limit: parseInt(limit),
                skip: (parseInt(page) - 1) * parseInt(limit),
                sort: { timestamp: -1 }
            };

            let logs = await logger.getLogs(filters, options);

            // Filtro de busca por texto
            if (search) {
                logs = logs.filter(log => 
                    log.message.toLowerCase().includes(search.toLowerCase()) ||
                    log.logId.toLowerCase().includes(search.toLowerCase())
                );
            }

            // Contar total para paginação
            const totalQuery = { ...filters };
            const total = await logger.getLogs(totalQuery, { limit: 10000 });
            const totalCount = total.length;

            res.json({
                success: true,
                data: {
                    logs,
                    pagination: {
                        page: parseInt(page),
                        limit: parseInt(limit),
                        total: totalCount,
                        pages: Math.ceil(totalCount / parseInt(limit))
                    }
                }
            });
        } catch (error) {
            const errorCode = await logger.logError(error, req, {
                module: 'logController',
                function: 'getLogs'
            });
            
            res.status(500).json({
                success: false,
                error: 'Error fetching logs',
                errorCode
            });
        }
    };

    /**
     * Buscar log específico por ID
     */
    LogController.getLogById = async (req, res) => {
        try {
            const { logId } = req.params;
            
            const log = await logger.getLogById(logId);
            
            if (!log) {
                return res.status(404).json({
                    success: false,
                    error: 'Log not found'
                });
            }

            res.json({
                success: true,
                data: log
            });
        } catch (error) {
            const errorCode = await logger.logError(error, req, {
                module: 'logController',
                function: 'getLogById'
            });
            
            res.status(500).json({
                success: false,
                error: 'Error fetching log',
                errorCode
            });
        }
    };

    /**
     * Obter estatísticas de logs
     */
    LogController.getLogStats = async (req, res) => {
        try {
            const { days = 7 } = req.query;
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - parseInt(days));

            const logs = await logger.getLogs({
                startDate: startDate.toISOString()
            }, { limit: 10000 });

            // Agrupar por nível
            const levelStats = {};
            const moduleStats = {};
            const dailyStats = {};

            logs.forEach(log => {
                // Por nível
                levelStats[log.level] = (levelStats[log.level] || 0) + 1;
                
                // Por módulo
                const module = log.application.module;
                moduleStats[module] = (moduleStats[module] || 0) + 1;
                
                // Por dia
                const date = log.timestamp.toISOString().split('T')[0];
                if (!dailyStats[date]) {
                    dailyStats[date] = { total: 0, error: 0, warn: 0, info: 0, debug: 0 };
                }
                dailyStats[date].total++;
                dailyStats[date][log.level]++;
            });

            res.json({
                success: true,
                data: {
                    totalLogs: logs.length,
                    levelStats,
                    moduleStats,
                    dailyStats,
                    period: {
                        startDate,
                        endDate: new Date(),
                        days: parseInt(days)
                    }
                }
            });
        } catch (error) {
            const errorCode = await logger.logError(error, req, {
                module: 'logController',
                function: 'getLogStats'
            });
            
            res.status(500).json({
                success: false,
                error: 'Error fetching log statistics',
                errorCode
            });
        }
    };

    /**
     * Limpar logs antigos
     */
    LogController.cleanupLogs = async (req, res) => {
        try {
            const { days = 30 } = req.body;
            
            const result = await logger.cleanupLogs(parseInt(days));
            
            await logger.info('Log cleanup performed', {
                req,
                module: 'logController',
                function: 'cleanupLogs',
                metadata: {
                    removedCount: result.deletedCount,
                    olderThanDays: parseInt(days)
                }
            });

            res.json({
                success: true,
                data: {
                    removedCount: result.deletedCount,
                    olderThanDays: parseInt(days)
                }
            });
        } catch (error) {
            const errorCode = await logger.logError(error, req, {
                module: 'logController',
                function: 'cleanupLogs'
            });
            
            res.status(500).json({
                success: false,
                error: 'Error cleaning up logs',
                errorCode
            });
        }
    };

    /**
     * Endpoint para testar logging
     */
    LogController.testLog = async (req, res) => {
        try {
            const { level = 'info', message = 'Test log message' } = req.body;
            
            const logId = await logger[level](message, {
                req,
                module: 'logController',
                function: 'testLog',
                metadata: {
                    test: true,
                    timestamp: new Date()
                }
            });

            res.json({
                success: true,
                data: {
                    logId,
                    message: 'Test log created successfully'
                }
            });
        } catch (error) {
            const errorCode = await logger.logError(error, req, {
                module: 'logController',
                function: 'testLog'
            });
            
            res.status(500).json({
                success: false,
                error: 'Error creating test log',
                errorCode
            });
        }
    };

    return LogController;
};