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
    app.post('/api/campaigns/upload-geojson', (req, res, next) => {
        console.log('=== GeoJSON Upload Request Debug ===');
        console.log('Timestamp:', new Date().toISOString());
        console.log('Method:', req.method);
        console.log('URL:', req.url);
        console.log('Headers:', JSON.stringify(req.headers, null, 2));
        console.log('Content-Type:', req.get('Content-Type'));
        console.log('Content-Length:', req.get('Content-Length'));
        console.log('Body exists:', !!req.body);
        console.log('Body type:', typeof req.body);
        console.log('Body keys:', req.body ? Object.keys(req.body) : 'no body');
        console.log('Session exists:', !!req.session);
        console.log('Session admin:', req.session && req.session.admin ? 'exists' : 'missing');
        console.log('Session superAdmin:', req.session && req.session.admin && req.session.admin.superAdmin ? 'exists' : 'missing');
        console.log('=====================================');
        next();
    }, requireSuperAdmin, campaignCrud.uploadGeoJSON);
    app.get('/api/campaigns/:id/points', requireSuperAdmin, campaignCrud.listPoints);
    app.delete('/api/campaigns/:id/points', requireSuperAdmin, campaignCrud.deletePoints);
    app.get('/api/campaigns/:id/properties', requireSuperAdmin, campaignCrud.getAvailableProperties);
    app.get('/api/campaigns/:id/aggregate-property', requireSuperAdmin, campaignCrud.aggregatePropertyData);
};