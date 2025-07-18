/**
 * Middleware para sanitizar dados sensíveis em logs e respostas
 */

module.exports = function(app) {
    const sanitizer = {};
    
    /**
     * Remove campos sensíveis de um objeto
     */
    sanitizer.sanitizeObject = function(obj, fieldsToRemove = ['password', 'senha', 'token', 'secret']) {
        if (!obj || typeof obj !== 'object') {
            return obj;
        }
        
        // Clonar objeto para não modificar o original
        const sanitized = Array.isArray(obj) ? [...obj] : { ...obj };
        
        // Recursivamente remover campos sensíveis
        const sanitizeRecursive = (target) => {
            for (const key in target) {
                if (target.hasOwnProperty(key)) {
                    // Remover campos sensíveis
                    if (fieldsToRemove.some(field => key.toLowerCase().includes(field.toLowerCase()))) {
                        delete target[key];
                    } 
                    // Recursão para objetos aninhados
                    else if (target[key] && typeof target[key] === 'object') {
                        if (Array.isArray(target[key])) {
                            target[key] = target[key].map(item => 
                                typeof item === 'object' ? sanitizeRecursive({ ...item }) : item
                            );
                        } else {
                            target[key] = sanitizeRecursive({ ...target[key] });
                        }
                    }
                }
            }
            return target;
        };
        
        return sanitizeRecursive(sanitized);
    };
    
    /**
     * Middleware para interceptar res.json e sanitizar respostas
     */
    sanitizer.responseInterceptor = function(req, res, next) {
        const originalJson = res.json;
        
        res.json = function(data) {
            // Não sanitizar respostas de erro de autenticação que precisam mostrar detalhes
            const isAuthError = res.statusCode === 401 || res.statusCode === 403;
            
            if (!isAuthError && data) {
                // Sanitizar dados antes de enviar
                data = sanitizer.sanitizeObject(data);
            }
            
            return originalJson.call(this, data);
        };
        
        next();
    };
    
    /**
     * Sanitizar dados para logs
     */
    sanitizer.sanitizeForLog = function(data) {
        // Lista expandida de campos sensíveis para logs
        const sensitiveFields = [
            'password', 'senha', 'token', 'secret', 'apiKey', 'api_key',
            'authorization', 'auth', 'credentials', 'sessionId', 'session'
        ];
        
        return sanitizer.sanitizeObject(data, sensitiveFields);
    };
    
    /**
     * Sanitizar objeto de requisição para logs
     */
    sanitizer.sanitizeRequest = function(req) {
        const sanitized = {
            method: req.method,
            url: req.url,
            path: req.path,
            params: sanitizer.sanitizeObject(req.params),
            query: sanitizer.sanitizeObject(req.query),
            headers: sanitizer.sanitizeObject({
                ...req.headers,
                authorization: req.headers.authorization ? '[REDACTED]' : undefined,
                cookie: req.headers.cookie ? '[REDACTED]' : undefined
            }),
            ip: req.ip || req.connection.remoteAddress,
            userAgent: req.get('User-Agent')
        };
        
        // Incluir body apenas se não for muito grande
        if (req.body && JSON.stringify(req.body).length < 1000) {
            sanitized.body = sanitizer.sanitizeObject(req.body);
        }
        
        return sanitized;
    };
    
    return sanitizer;
};