const crypto = require('crypto');

class Logger {
    constructor(app) {
        this.app = app;
        this.environment = process.env.NODE_ENV || 'development';
        this.version = process.env.APP_VERSION || '1.0.0';
        this.logModel = null;
        this.logCollection = null;
        
        // Inicializar quando o app estiver pronto
        if (app && app.repository) {
            this.init();
        }
    }

    /**
     * Inicializa o logger com a conexão do MongoDB
     */
    async init() {
        try {
            // Obter coleção de logs do repository
            this.logCollection = this.app.repository.collections.logs || 
                                await this.app.repository.db.collection('logs');
            
            // Criar modelo se não existir na coleção
            if (!this.app.repository.collections.logs) {
                this.app.repository.collections.logs = this.logCollection;
            }
            
            // Carregar modelo de log
            this.logModel = require('../models/log')(this.app);
            
            // Criar índices
            await this.logModel.createIndexes(this.logCollection);
            
            console.log('Logger initialized successfully');
        } catch (error) {
            console.error('Failed to initialize logger:', error);
        }
    }

    /**
     * Gera um ID único para o log
     */
    generateLogId() {
        const timestamp = Date.now().toString(36);
        const random = crypto.randomBytes(3).toString('hex');
        return `${timestamp}-${random}`.toUpperCase();
    }

    /**
     * Formata o contexto da requisição
     */
    formatRequest(req) {
        if (!req) return {};
        
        return {
            method: req.method,
            url: req.originalUrl || req.url,
            params: req.params || {},
            query: req.query || {},
            body: this.sanitizeBody(req.body),
            headers: this.sanitizeHeaders(req.headers),
            userAgent: req.get('User-Agent'),
            ip: req.ip || req.connection.remoteAddress,
            sessionId: req.sessionID
        };
    }

    /**
     * Sanitiza dados sensíveis do body
     */
    sanitizeBody(body) {
        if (!body) return {};
        
        const sanitized = Object.assign({}, body);
        const sensitiveFields = ['password', 'token', 'authorization', 'secret', 'key'];
        
        for (const field of sensitiveFields) {
            if (sanitized[field]) {
                sanitized[field] = '[HIDDEN]';
            }
        }
        
        return sanitized;
    }

    /**
     * Sanitiza headers sensíveis
     */
    sanitizeHeaders(headers) {
        if (!headers) return {};
        
        const sanitized = Object.assign({}, headers);
        const sensitiveHeaders = ['authorization', 'cookie', 'x-api-key'];
        
        for (const header of sensitiveHeaders) {
            if (sanitized[header]) {
                sanitized[header] = '[HIDDEN]';
            }
        }
        
        return sanitized;
    }

    /**
     * Extrai informações do usuário da requisição
     */
    extractUserInfo(req) {
        if (!req) return {};
        
        // Tentar diferentes fontes de informação do usuário
        const user = req.user || (req.session && req.session.user) || (req.session && req.session.admin && req.session.admin.superAdmin);
        
        return {
            id: (user && user.id) || (user && user._id),
            username: user && user.username,
            role: user && user.role,
        };
    }

    /**
     * Cria um documento de log
     */
    createLogDocument(level, message, options = {}) {
        const logId = this.generateLogId();
        const timestamp = new Date();
        
        const logData = {
            logId,
            level,
            message,
            timestamp,
            application: {
                module: options.module || 'unknown',
                function: options.function || 'unknown',
                version: this.version
            },
            user: this.extractUserInfo(options.req),
            request: this.formatRequest(options.req),
            metadata: options.metadata || {},
            environment: {
                nodeEnv: this.environment,
                nodeVersion: process.version,
                platform: process.platform,
                hostname: require('os').hostname()
            }
        };

        return { logId, document: this.logModel ? this.logModel.prepare(logData) : logData };
    }

    /**
     * Salva log no MongoDB
     */
    async saveLog(level, message, options = {}) {
        try {
            const { logId, document } = this.createLogDocument(level, message, options);
            
            // Se não tiver coleção, apenas log no console
            if (!this.logCollection) {
                console.log(`[${level.toUpperCase()}] ${message}`, options.metadata || '');
                return logId;
            }

            // Inserir no MongoDB
            await this.logCollection.insertOne(document);
            
            // Log também no console em desenvolvimento
            if (this.environment === 'development') {
                const consoleMethod = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log';
                console[consoleMethod](`[${level.toUpperCase()}] ${message}`, options.metadata || '');
                if (options.details && options.details.stack) {
                    console[consoleMethod](options.details.stack);
                }
            }
            
            return logId;
        } catch (error) {
            // Fallback para console se falhar
            console.error('Failed to save log to MongoDB:', error);
            console.log(`[${level.toUpperCase()}] ${message}`, options.metadata || '');
            return this.generateLogId();
        }
    }

    /**
     * Métodos de logging por nível
     */
    async error(message, options = {}) {
        return await this.saveLog('error', message, options);
    }

    async warn(message, options = {}) {
        return await this.saveLog('warn', message, options);
    }

    async info(message, options = {}) {
        return await this.saveLog('info', message, options);
    }

    async debug(message, options = {}) {
        return await this.saveLog('debug', message, options);
    }

    /**
     * Log específico para erros
     */
    async logError(error, req, options = {}) {
        const errorDetails = {
            name: error.name,
            message: error.message,
            stack: error.stack,
            code: error.code,
            statusCode: error.statusCode || error.status
        };

        return await this.error(error.message, {
            req,
            module: options.module,
            function: options.function,
            metadata: Object.assign({}, options.metadata, { errorDetails })
        });
    }

    /**
     * Buscar logs com filtros
     */
    async getLogs(filters = {}, options = {}) {
        if (!this.logCollection) return [];

        try {
            const query = {};
            
            // Aplicar filtros
            if (filters.level) query.level = filters.level;
            if (filters.module) query['application.module'] = filters.module;
            if (filters.userId) query['user.id'] = filters.userId;
            if (filters.startDate) {
                query.timestamp = query.timestamp || {};
                query.timestamp.$gte = new Date(filters.startDate);
            }
            if (filters.endDate) {
                query.timestamp = query.timestamp || {};
                query.timestamp.$lte = new Date(filters.endDate);
            }

            const cursor = this.logCollection.find(query);
            
            // Aplicar opções
            if (options.sort) cursor.sort(options.sort);
            if (options.skip) cursor.skip(options.skip);
            if (options.limit) cursor.limit(options.limit);

            return await cursor.toArray();
        } catch (error) {
            console.error('Error fetching logs:', error);
            return [];
        }
    }

    /**
     * Buscar log por ID
     */
    async getLogById(logId) {
        if (!this.logCollection) return null;

        try {
            return await this.logCollection.findOne({ logId });
        } catch (error) {
            console.error('Error fetching log by ID:', error);
            return null;
        }
    }

    /**
     * Limpar logs antigos
     */
    async cleanupLogs(olderThanDays = 30) {
        if (!this.logCollection) return { deletedCount: 0 };

        try {
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

            const result = await this.logCollection.deleteMany({
                timestamp: { $lt: cutoffDate }
            });

            return result;
        } catch (error) {
            console.error('Error cleaning up logs:', error);
            return { deletedCount: 0 };
        }
    }
}

// Função factory para criar instância do logger
module.exports = function(app) {
    if (!module.exports._instance) {
        module.exports._instance = new Logger(app);
    }
    return module.exports._instance;
};

// Também exportar diretamente se não houver app
module.exports.Logger = Logger;