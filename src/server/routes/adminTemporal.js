module.exports = function (app) {
    
    var points = app.controllers.points;
    var timeseries = app.controllers.timeseries;
    var dashboard = app.controllers.dashboard;
    var supervisor = app.controllers.supervisor;
    var image = app.controllers.image;
    
    // Middleware de autenticação para admin
    var checkAdminAuth = function(req, res, next) {
        // Por enquanto, permitir acesso sem autenticação para admin-temporal
        // TODO: Implementar autenticação específica para admin se necessário
        return next();
    };
    
    // Rotas de pontos para admin (sem dependência de sessão de usuário regular)
    app.get('/service/admin/points/:pointId', checkAdminAuth, points.getPointByIdAdmin);
    app.post('/service/admin/points/get-point', checkAdminAuth, points.getPointByFilterAdmin);
    app.get('/service/admin/points/landUses', checkAdminAuth, points.getLandUsesAdmin);
    app.get('/service/admin/points/users', checkAdminAuth, points.getUsersAdmin);
    app.get('/service/admin/points/biome', checkAdminAuth, points.getBiomesAdmin);
    app.get('/service/admin/points/uf', checkAdminAuth, points.getUfsAdmin);
    app.post('/service/admin/points/next-point', checkAdminAuth, points.getNextPointAdmin);
    app.post('/service/admin/points/get-point-by-id', checkAdminAuth, points.getPointByIdServiceAdmin);
    app.post('/service/admin/points/updatedClassConsolidated', checkAdminAuth, points.updateClassConsolidatedAdmin);
    
    // Rotas de timeseries para admin
    app.get('/service/admin/timeseries/landsat/ndvi', checkAdminAuth, timeseries.getTimeSeriesLandsatNdviByLonLatAdmin);
    app.get('/service/admin/timeseries/nddi', checkAdminAuth, timeseries.getTimeSeriesLandsatNDDIByLonLatAdmin);
    
    // Rotas de dashboard e supervisor para admin
    app.get('/service/admin/dashboard/points-inspection', checkAdminAuth, dashboard.pointsInspectionAdmin);
    app.get('/service/admin/spatial/precipitation', checkAdminAuth, function(req, res) {
        // Retorna dados de precipitação para admin
        res.json({
            precipitation: [],
            success: true
        });
    });
    
    app.get('/service/admin/time-series/MOD13Q1_NDVI', checkAdminAuth, function(req, res) {
        // Retorna dados MODIS NDVI para admin
        res.json({
            timeseries: [],
            success: true
        });
    });
    
    app.get('/service/admin/campaign/config', checkAdminAuth, supervisor.getCampaignConfigAdmin);
    app.get('/service/admin/campaign/correct', checkAdminAuth, supervisor.correctCampaignAdmin);
    app.get('/service/admin/campaign/removeInspections', checkAdminAuth, supervisor.removeInspectionAdmin);
    
    app.get('/service/admin/sentinel/capabilities', checkAdminAuth, function(req, res) {
        // Retorna capabilities do Sentinel para admin
        // TODO: Implementar busca real de capabilities do Sentinel
        res.json([]);
    });
    
    // Rotas de imagens para admin
    app.get('/service/admin/images/:mosaicId', checkAdminAuth, image.mosaicAdmin);
    app.get('/service/admin/images/planet/:mosaicId', checkAdminAuth, image.planetMosaicAdmin);
    app.get('/service/admin/images/sentinel/:date', checkAdminAuth, image.sentinelMosaicAdmin);
}