module.exports = function(app) {
    // Função para obter logger com verificação
    const getLogger = () => {
        return app.services && app.services.logger;
    };

    /**
     * Middleware para logging de requisições
     */
    const requestLogger = (req, res, next) => {
        const logger = getLogger();
        if (!logger) return next();
        
        // Capturar informações da requisição
        const startTime = Date.now();
        
        // Log da requisição entrada
        logger.info(`${req.method} ${req.originalUrl}`, {
            req,
            module: 'http',
            function: 'request',
            metadata: {
                userAgent: req.get('User-Agent'),
                contentType: req.get('Content-Type'),
                contentLength: req.get('Content-Length')
            }
        });

        // Interceptar a resposta
        const originalSend = res.send;
        res.send = function(data) {
            const duration = Date.now() - startTime;
            
            // Log da resposta
            logger.info(`${req.method} ${req.originalUrl} - ${res.statusCode} (${duration}ms)`, {
                req,
                module: 'http',
                function: 'response',
                metadata: {
                    statusCode: res.statusCode,
                    duration: duration,
                    responseSize: data ? data.length : 0
                }
            });
            
            return originalSend.call(this, data);
        };

        next();
    };

    /**
     * Middleware para capturar erros não tratados
     */
    const errorLogger = (err, req, res, next) => {
        const logger = getLogger();
        if (!logger) {
            console.error('Error (no logger):', err);
            return res.status(500).json({ error: 'Internal Server Error' });
        }
        
        // Gerar código de erro único
        const errorCode = logger.generateLogId();
        
        // Log do erro
        logger.logError(err, req, {
            module: (req.route && req.route.path) || 'unknown',
            function: req.method,
            metadata: {
                errorCode,
                route: (req.route && req.route.path) || undefined,
                stack: err.stack
            }
        });

        // Adicionar código de erro à resposta
        err.errorCode = errorCode;
        
        // Resposta padronizada de erro
        const errorResponse = {
            success: false,
            error: err.message || 'Internal Server Error',
            errorCode: errorCode,
            timestamp: new Date().toISOString()
        };

        // Adicionar stack trace apenas em desenvolvimento
        if (process.env.NODE_ENV === 'development') {
            errorResponse.stack = err.stack;
        }

        res.status(err.statusCode || 500).json(errorResponse);
    };

    /**
     * Middleware para logging de autenticação
     */
    const authLogger = (req, res, next) => {
        const logger = getLogger();
        if (!logger) return next();
        
        // Interceptar tentativas de login
        const originalMethod = req.method;
        const originalUrl = req.originalUrl;
        
        if (originalUrl.includes('/login') || originalUrl.includes('/auth')) {
            const originalSend = res.send;
            res.send = function(data) {
                const parsedData = typeof data === 'string' ? JSON.parse(data) : data;
                
                if (parsedData.success) {
                    logger.info('Login successful', {
                        req,
                        module: 'auth',
                        function: 'login',
                        metadata: {
                            loginType: originalUrl.includes('/admin') ? 'admin' : 'user',
                            ip: req.ip
                        }
                    });
                } else {
                    logger.warn('Login failed', {
                        req,
                        module: 'auth',
                        function: 'login',
                        metadata: {
                            loginType: originalUrl.includes('/admin') ? 'admin' : 'user',
                            ip: req.ip,
                            reason: parsedData.error || 'Unknown'
                        }
                    });
                }
                
                return originalSend.call(this, data);
            };
        }
        
        next();
    };

    /**
     * Middleware para logging de operações críticas
     */
    const criticalOperationLogger = (operation) => {
        return (req, res, next) => {
            const logger = getLogger();
            if (!logger) return next();
            
            const originalSend = res.send;
            res.send = function(data) {
                const parsedData = typeof data === 'string' ? JSON.parse(data) : data;
                
                if (parsedData.success) {
                    logger.info(`Critical operation: ${operation} - Success`, {
                        req,
                        module: 'critical',
                        function: operation,
                        metadata: {
                            operation,
                            result: 'success',
                            data: parsedData
                        }
                    });
                } else {
                    logger.error(`Critical operation: ${operation} - Failed`, {
                        req,
                        module: 'critical',
                        function: operation,
                        metadata: {
                            operation,
                            result: 'failed',
                            error: parsedData.error || 'Unknown error'
                        }
                    });
                }
                
                return originalSend.call(this, data);
            };
            
            next();
        };
    };

    /**
     * Função para criar um wrapper de logging para funções
     */
    const logFunction = (moduleName, functionName) => {
        return (originalFunction) => {
            return async (...args) => {
                const logger = getLogger();
                if (!logger) return await originalFunction(...args);
                
                const startTime = Date.now();
                
                try {
                    const result = await originalFunction(...args);
                    const duration = Date.now() - startTime;
                    
                    logger.debug(`Function ${functionName} executed successfully`, {
                        module: moduleName,
                        function: functionName,
                        metadata: {
                            duration,
                            args: args.length
                        }
                    });
                    
                    return result;
                } catch (error) {
                    const duration = Date.now() - startTime;
                    
                    const errorCode = await logger.logError(error, null, {
                        module: moduleName,
                        function: functionName,
                        metadata: {
                            duration,
                            args: args.length
                        }
                    });
                    
                    // Adicionar código de erro ao erro original
                    error.errorCode = errorCode;
                    throw error;
                }
            };
        };
    };

    return {
        requestLogger,
        errorLogger,
        authLogger,
        criticalOperationLogger,
        logFunction
    };
};