module.exports = function (app) {
    const Verifier = {};
    const logger = app.services && app.services.logger;

    Verifier.checkOriginAndHost = (req, res, next) => {
        // Lê as envs, converte em arrays, tira espaços e converte pra minúsculo
        const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
            .split(',')
            .map(s => s.trim().toLowerCase());
        const allowedHosts = (process.env.ALLOWED_HOSTS || '')
            .split(',')
            .map(s => s.trim().toLowerCase());

        // Captura o cabeçalho Origin e converte para minúsculo
        const requestOrigin = (req.headers['origin'] || req.headers['referer'] ||  '').toLowerCase()
            .replace(/\/$/, '');

        const fullHost = (req.headers.host || '').toLowerCase();
        const [hostnameOnly] = fullHost.split(':');

        // Se não estiver na lista de allowedOrigins e também não estiver na de allowedHosts, bloqueia
        if (
            !allowedOrigins.includes(requestOrigin) &&
            !allowedHosts.includes(hostnameOnly)
        ) {
            // Log detalhado do bloqueio CORS
            if (logger) {
                logger.error('CORS blocked', {
                    module: 'origin',
                    function: 'checkOriginAndHost',
                    metadata: {
                        requestOrigin: requestOrigin,
                        allowedOrigins: allowedOrigins,
                        hostnameOnly: hostnameOnly,
                        allowedHosts: allowedHosts,
                        headers: req.headers,
                        url: req.url,
                        method: req.method
                    },
                    req: req
                });
            }
            
            const corsError = new Error('Acesso não permitido - CORS');
            corsError.statusCode = 403;
            corsError.code = 'CORS_BLOCKED';
            return next(corsError);
        }

        // Se passou, está liberado - adicionar headers CORS
        if (requestOrigin && allowedOrigins.includes(requestOrigin)) {
            res.setHeader('Access-Control-Allow-Origin', requestOrigin);
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
            res.setHeader('Access-Control-Allow-Credentials', 'true');
        }
        
        // Lidar com preflight requests
        if (req.method === 'OPTIONS') {
            return res.status(200).end();
        }
        
        next();
    };

    return Verifier;
};
