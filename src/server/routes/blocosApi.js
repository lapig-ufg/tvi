module.exports = function (app) {

    var blocos = app.controllers.blocos;
    var errorHandler = app.middleware.errorHandler;

    // Middleware de autenticação para super-admin (mesmo padrão de campaignCrud.js)
    var requireSuperAdmin = function(req, res, next) {
        if (req.session && req.session.admin && req.session.admin.superAdmin) {
            return next();
        }
        var authError = new Error('Super admin authentication required');
        authError.statusCode = 401;
        authError.code = 'AUTH_REQUIRED';
        return next(authError);
    };

    // Gerar blocos para uma campanha
    app.post('/api/campaigns/:id/generate-blocks',
        requireSuperAdmin,
        errorHandler.asyncHandler(blocos.generateBlocks)
    );

    // Listar blocos de uma campanha (paginado, com filtros)
    app.get('/api/campaigns/:id/blocks',
        requireSuperAdmin,
        errorHandler.asyncHandler(blocos.listBlocks)
    );

    // Resumo de blocos por status/inspetor
    app.get('/api/campaigns/:id/blocks/summary',
        requireSuperAdmin,
        errorHandler.asyncHandler(blocos.getBlocksSummary)
    );

    // Descartar bloco específico
    app.post('/api/campaigns/:id/blocks/:blockIndex/discard',
        requireSuperAdmin,
        errorHandler.asyncHandler(blocos.discardBlock)
    );

    // Liberar blocos expirados manualmente
    app.post('/api/campaigns/:id/blocks/release-expired',
        requireSuperAdmin,
        errorHandler.asyncHandler(blocos.releaseExpiredBlocks)
    );

    // Remover todos os blocos (reset)
    app.delete('/api/campaigns/:id/blocks',
        requireSuperAdmin,
        errorHandler.asyncHandler(blocos.deleteAllBlocks)
    );
};
