module.exports = function (app) {

    const wayback = app.controllers.wayback;
    const errorHandler = app.middleware.errorHandler;

    // Mesma verificação de sessão super-admin usada em routes/campaignCrud.js e
    // routes/blocosApi.js: síncrona, delega ao globalErrorHandler via next(err)
    // (que já loga e formata a resposta 401 padronizada do projeto).
    const requireSuperAdmin = function (req, res, next) {
        if (req.session && req.session.admin && req.session.admin.superAdmin) {
            return next();
        }
        const authError = new Error('Super admin authentication required');
        authError.statusCode = 401;
        authError.code = 'AUTH_REQUIRED';
        return next(authError);
    };

    app.post('/api/wayback/sync/:campaignId', requireSuperAdmin, errorHandler.asyncHandler(wayback.startSync));
    app.get('/api/wayback/sync/:campaignId/status', requireSuperAdmin, errorHandler.asyncHandler(wayback.status));

    // Catálogo consumido pelo visualizador (sessão de inspetor comum).
    app.get('/service/wayback/releases', errorHandler.asyncHandler(wayback.releases));
};
