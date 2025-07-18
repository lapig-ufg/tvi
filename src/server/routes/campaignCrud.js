module.exports = function (app) {
    
    var campaignCrud = app.controllers.campaignCrud;
    var errorHandler = app.middleware.errorHandler;
    var logger = app.services.logger;
    
    if (logger) {
        logger.info('Loading campaignCrud routes', {
            module: 'routes',
            function: 'campaignCrud'
        });
    }
    
    // Middleware de autenticação para super-admin
    var requireSuperAdmin = function(req, res, next) {
        if (logger) {
            logger.debug('Auth check for super-admin', {
                module: 'routes',
                function: 'requireSuperAdmin',
                metadata: {
                    url: req.url,
                    hasSession: !!req.session,
                    hasAdmin: !!(req.session && req.session.admin),
                    hasSuperAdmin: !!(req.session && req.session.admin && req.session.admin.superAdmin)
                },
                req: req
            });
        }
        
        if (req.session && req.session.admin && req.session.admin.superAdmin) {
            return next();
        }
        const authError = new Error('Super admin authentication required');
        authError.statusCode = 401;
        authError.code = 'AUTH_REQUIRED';
        return next(authError);
    };
    
    // Rotas de autenticação para super-admin
    app.post('/api/admin/login', campaignCrud.adminLogin);
    app.post('/api/admin/logout', campaignCrud.adminLogout);
    app.get('/api/admin/check', campaignCrud.checkAdminAuth);
    
    // Rotas para CRUD de campanhas - protegidas por autenticação de super-admin
    app.get('/api/campaigns', requireSuperAdmin, campaignCrud.list);
    app.get('/api/campaigns/:id', campaignCrud.get); // Acesso público para leitura
    app.get('/api/campaigns/:id/details', requireSuperAdmin, campaignCrud.getDetails);
    app.post('/api/campaigns', requireSuperAdmin, campaignCrud.create);
    app.put('/api/campaigns/:id', requireSuperAdmin, campaignCrud.update);
    app.delete('/api/campaigns/:id', requireSuperAdmin, campaignCrud.delete);
    
    // Rotas para gerenciar pontos - protegidas por autenticação de super-admin
    // Usando asyncHandler para capturar erros assíncronos
    if (logger) {
        logger.info('Registering route POST /api/campaigns/upload-geojson', {
            module: 'routes',
            function: 'campaignCrud'
        });
    }
    app.post('/api/campaigns/upload-geojson', 
        requireSuperAdmin, 
        errorHandler.asyncHandler(campaignCrud.uploadGeoJSON)
    );
    app.get('/api/campaigns/:id/points', requireSuperAdmin, campaignCrud.listPoints);
    app.delete('/api/campaigns/:id/points', requireSuperAdmin, campaignCrud.deletePoints);
    app.get('/api/campaigns/:id/properties', requireSuperAdmin, campaignCrud.getAvailableProperties);
    app.get('/api/campaigns/:id/aggregate-property', requireSuperAdmin, campaignCrud.aggregatePropertyData);
};