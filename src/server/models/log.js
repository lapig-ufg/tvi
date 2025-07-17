/**
 * Log Model - MongoDB Native Implementation
 * Estrutura de dados para logs do sistema
 */

module.exports = function(app) {
    const mongodb = require('mongodb');
    
    const LogModel = {
        /**
         * Cria índices necessários para a coleção de logs
         */
        createIndexes: async function(collection) {
            try {
                // Índice TTL para expiração automática (logs ficam 30 dias por padrão)
                await collection.createIndex(
                    { "timestamp": 1 }, 
                    { expireAfterSeconds: 30 * 24 * 60 * 60 } // 30 dias
                );
                
                // Índices para consultas eficientes
                await collection.createIndex({ "level": 1 });
                await collection.createIndex({ "logId": 1 }, { unique: true });
                await collection.createIndex({ "application.module": 1 });
                await collection.createIndex({ "user.id": 1 });
                await collection.createIndex({ "timestamp": -1 });
                
                console.log('Log collection indexes created successfully');
            } catch (error) {
                console.error('Error creating log indexes:', error);
            }
        },

        /**
         * Valida estrutura de um documento de log
         */
        validate: function(logData) {
            const required = ['level', 'message', 'timestamp', 'logId'];
            const missing = required.filter(field => !logData[field]);
            
            if (missing.length > 0) {
                throw new Error(`Missing required fields: ${missing.join(', ')}`);
            }
            
            const validLevels = ['error', 'warn', 'info', 'debug'];
            if (!validLevels.includes(logData.level)) {
                throw new Error(`Invalid log level: ${logData.level}`);
            }
            
            return true;
        },

        /**
         * Prepara documento para inserção
         */
        prepare: function(logData) {
            const document = {
                _id: new mongodb.ObjectID(),
                logId: logData.logId,
                level: logData.level,
                message: logData.message,
                timestamp: new Date(logData.timestamp),
                application: {
                    module: logData.application && logData.application.module || 'unknown',
                    function: logData.application && logData.application.function || 'unknown',
                    version: logData.application && logData.application.version || '1.0.0'
                },
                user: {
                    id: logData.user && logData.user.id || null,
                    username: logData.user && logData.user.username || null,
                    role: logData.user && logData.user.role || null
                },
                request: {
                    method: logData.request && logData.request.method || null,
                    url: logData.request && logData.request.url || null,
                    ip: logData.request && logData.request.ip || null,
                    userAgent: logData.request && logData.request.userAgent || null,
                    sessionId: logData.request && logData.request.sessionId || null
                },
                metadata: logData.metadata || {},
                environment: {
                    nodeVersion: process.version,
                    platform: process.platform,
                    hostname: require('os').hostname()
                }
            };

            // Validar antes de retornar
            this.validate(document);
            
            return document;
        }
    };

    return LogModel;
};