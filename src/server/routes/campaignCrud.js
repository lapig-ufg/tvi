module.exports = function (app) {
    
    var campaignCrud = app.controllers.campaignCrud;
    
    // Middleware de autenticação para super-admin
    var requireSuperAdmin = function(req, res, next) {
        if (req.session && req.session.admin && req.session.admin.superAdmin) {
            return next();
        }
        return res.status(401).json({ error: 'Super admin authentication required' });
    };
    
    // Rotas de autenticação para super-admin
    app.post('/api/admin/login', campaignCrud.adminLogin);
    app.post('/api/admin/logout', campaignCrud.adminLogout);
    app.get('/api/admin/check', campaignCrud.checkAdminAuth);
    
    // Rotas para CRUD de campanhas - protegidas por autenticação de super-admin
    app.get('/api/campaigns', requireSuperAdmin, campaignCrud.list);
    app.get('/api/campaigns/:id', requireSuperAdmin, campaignCrud.get);
    app.get('/api/campaigns/:id/details', requireSuperAdmin, campaignCrud.getDetails);
    app.post('/api/campaigns', requireSuperAdmin, campaignCrud.create);
    app.put('/api/campaigns/:id', requireSuperAdmin, campaignCrud.update);
    app.delete('/api/campaigns/:id', requireSuperAdmin, campaignCrud.delete);
    
    // Rotas para gerenciar pontos - protegidas por autenticação de super-admin
    app.post('/api/campaigns/upload-geojson', requireSuperAdmin, campaignCrud.uploadGeoJSON);
    app.get('/api/campaigns/:id/points', requireSuperAdmin, campaignCrud.listPoints);
    app.delete('/api/campaigns/:id/points', requireSuperAdmin, campaignCrud.deletePoints);
    app.get('/api/campaigns/:id/properties', requireSuperAdmin, campaignCrud.getAvailableProperties);
    app.get('/api/campaigns/:id/aggregate-property', requireSuperAdmin, campaignCrud.aggregatePropertyData);
};