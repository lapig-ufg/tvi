const fs = require('fs');
const path = require('path');

module.exports = function(app) {
    const ErrorHandler = {};
    
    // Criar diretório de logs se não existir
    const logDir = path.join(__dirname, '../log');
    if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
    }
    
    // Função para gerar ID único de erro
    const generateErrorId = () => {
        return `ERR_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    };
    
    // Função para escrever logs em arquivo
    const writeErrorLog = (errorData) => {
        const date = new Date();
        const logFile = path.join(logDir, `errors_${date.toISOString().split('T')[0]}.log`);
        const logEntry = JSON.stringify(errorData) + '\n';
        
        fs.appendFile(logFile, logEntry, (err) => {
            if (err) console.error('Failed to write error log:', err);
        });
    };
    
    // Middleware para capturar erros não tratados nas rotas
    ErrorHandler.asyncHandler = (fn) => {
        return (req, res, next) => {
            Promise.resolve(fn(req, res, next)).catch(next);
        };
    };
    
    // Middleware de logging de requisições (para debug)
    ErrorHandler.requestLogger = (req, res, next) => {
        const requestId = req.headers['x-request-id'] || generateErrorId().replace('ERR_', 'REQ_');
        req.requestId = requestId;
        
        // Log de entrada da requisição
        const requestLog = {
            timestamp: new Date().toISOString(),
            requestId: requestId,
            method: req.method,
            url: req.url,
            headers: req.headers,
            query: req.query,
            ip: req.ip || req.connection.remoteAddress,
            userAgent: req.get('User-Agent')
        };
        
        // Para requisições POST/PUT, logar também o body (com limite)
        if (['POST', 'PUT', 'PATCH'].includes(req.method) && req.body) {
            const bodyString = JSON.stringify(req.body);
            requestLog.bodySize = bodyString.length;
            requestLog.bodySample = bodyString.length > 1000 
                ? bodyString.substring(0, 1000) + '...[truncated]'
                : req.body;
        }
        
        // Log apenas requisições importantes em produção
        if (process.env.NODE_ENV === 'prod') {
            if (req.url.includes('/api/') && !req.url.includes('/health')) {
                console.log('[REQUEST]', JSON.stringify(requestLog));
            }
            // Log especial para upload de GeoJSON
            if (req.url.includes('upload-geojson')) {
                console.log('[UPLOAD REQUEST DETECTED]', JSON.stringify(requestLog));
            }
        } else {
            console.log('[REQUEST]', JSON.stringify(requestLog));
        }
        
        // Interceptar o método send para logar a resposta
        const originalSend = res.send;
        res.send = function(data) {
            res.responseData = data;
            originalSend.call(this, data);
        };
        
        // Log de saída da resposta
        res.on('finish', () => {
            const responseLog = {
                timestamp: new Date().toISOString(),
                requestId: requestId,
                statusCode: res.statusCode,
                statusMessage: res.statusMessage,
                headers: res.getHeaders()
            };
            
            // Logar apenas respostas com erro em produção
            if (process.env.NODE_ENV === 'prod') {
                if (res.statusCode >= 400) {
                    responseLog.responseData = res.responseData;
                    console.error('[RESPONSE ERROR]', JSON.stringify(responseLog));
                    writeErrorLog(responseLog);
                }
            } else {
                console.log('[RESPONSE]', JSON.stringify(responseLog));
            }
        });
        
        next();
    };
    
    // Middleware global de tratamento de erros
    ErrorHandler.globalErrorHandler = (err, req, res, next) => {
        const errorId = generateErrorId();
        const timestamp = new Date().toISOString();
        
        // Estrutura completa do erro
        const errorData = {
            errorId: errorId,
            timestamp: timestamp,
            requestId: req.requestId || 'unknown',
            error: {
                name: err.name || 'UnknownError',
                message: err.message || 'An unexpected error occurred',
                stack: err.stack,
                code: err.code,
                statusCode: err.statusCode || err.status || 500
            },
            request: {
                method: req.method,
                url: req.url,
                headers: req.headers,
                query: req.query,
                params: req.params,
                body: req.body,
                ip: req.ip || req.connection.remoteAddress,
                userAgent: req.get('User-Agent')
            },
            session: {
                userId: req.session && req.session.userId,
                adminId: req.session && req.session.admin && req.session.admin.superAdmin && req.session.admin.superAdmin.id,
                sessionId: req.sessionID
            },
            environment: {
                nodeEnv: process.env.NODE_ENV,
                hostname: process.env.HOSTNAME || require('os').hostname()
            }
        };
        
        // Log completo no console
        console.error('[ERROR]', JSON.stringify(errorData, null, 2));
        
        // Salvar em arquivo
        writeErrorLog(errorData);
        
        // Determinar código de status HTTP
        let statusCode = 500;
        let userMessage = 'Erro interno do servidor';
        let errorType = 'INTERNAL_SERVER_ERROR';
        
        // Tratamento específico por tipo de erro
        if (err.name === 'ValidationError' || err.statusCode === 400) {
            statusCode = 400;
            userMessage = 'Dados inválidos na requisição';
            errorType = 'VALIDATION_ERROR';
        } else if (err.name === 'UnauthorizedError' || err.statusCode === 401) {
            statusCode = 401;
            userMessage = 'Não autorizado';
            errorType = 'UNAUTHORIZED';
        } else if (err.statusCode === 403) {
            statusCode = 403;
            userMessage = 'Acesso negado';
            errorType = 'FORBIDDEN';
        } else if (err.name === 'NotFoundError' || err.statusCode === 404) {
            statusCode = 404;
            userMessage = 'Recurso não encontrado';
            errorType = 'NOT_FOUND';
        } else if (err.code === 'ECONNREFUSED') {
            statusCode = 503;
            userMessage = 'Serviço temporariamente indisponível';
            errorType = 'SERVICE_UNAVAILABLE';
        } else if (err.type === 'entity.too.large') {
            statusCode = 413;
            userMessage = 'Arquivo muito grande';
            errorType = 'PAYLOAD_TOO_LARGE';
        } else if (err.type === 'entity.parse.failed') {
            statusCode = 400;
            userMessage = 'Erro ao processar dados da requisição';
            errorType = 'PARSE_ERROR';
        } else if (err.name === 'MongoError' || err.name === 'MongooseError') {
            statusCode = 503;
            userMessage = 'Erro no banco de dados';
            errorType = 'DATABASE_ERROR';
        }
        
        // Resposta padronizada para o cliente
        const errorResponse = {
            error: {
                id: errorId,
                type: errorType,
                message: userMessage,
                timestamp: timestamp
            }
        };
        
        // Em desenvolvimento, incluir mais detalhes
        if (process.env.NODE_ENV !== 'prod') {
            errorResponse.error.details = {
                originalMessage: err.message,
                stack: err.stack,
                code: err.code
            };
        }
        
        // Enviar resposta se ainda não foi enviada
        if (!res.headersSent) {
            res.status(statusCode).json(errorResponse);
        } else {
            // Se os headers já foram enviados, forçar o fechamento da conexão
            res.end();
        }
    };
    
    // Middleware para timeout de requisições
    ErrorHandler.requestTimeout = (timeout = 300000) => { // 5 minutos default
        return (req, res, next) => {
            const timer = setTimeout(() => {
                const timeoutError = new Error('Request timeout');
                timeoutError.statusCode = 408;
                timeoutError.code = 'REQUEST_TIMEOUT';
                next(timeoutError);
            }, timeout);
            
            // Limpar timer em qualquer evento que termine a requisição
            const clearTimer = () => {
                clearTimeout(timer);
            };
            
            res.on('finish', clearTimer);
            res.on('close', clearTimer);
            res.on('error', clearTimer);
            req.on('abort', clearTimer);
            
            next();
        };
    };
    
    // Middleware específico para rotas de upload
    ErrorHandler.uploadErrorHandler = (err, req, res, next) => {
        const errorId = generateErrorId();
        
        console.error('[UPLOAD ERROR]', {
            errorId: errorId,
            timestamp: new Date().toISOString(),
            error: err.message,
            stack: err.stack,
            file: req.file,
            files: req.files,
            body: req.body
        });
        
        // Erros específicos de upload
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({
                error: {
                    id: errorId,
                    type: 'FILE_TOO_LARGE',
                    message: 'Arquivo excede o tamanho máximo permitido',
                    timestamp: new Date().toISOString()
                }
            });
        }
        
        if (err.code === 'LIMIT_UNEXPECTED_FILE') {
            return res.status(400).json({
                error: {
                    id: errorId,
                    type: 'UNEXPECTED_FIELD',
                    message: 'Campo de arquivo inesperado',
                    timestamp: new Date().toISOString()
                }
            });
        }
        
        // Passar para o handler global
        next(err);
    };
    
    return ErrorHandler;
};
