module.exports = function (app) {
    const Verifier = {};

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
            return res.status(403).json({ msg: 'Acesso não permitido.' });
        }

        // Se passou, está liberado
        next();
    };

    return Verifier;
};
