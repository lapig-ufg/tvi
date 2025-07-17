module.exports = function(app) {
    const dashboardController = app.controllers.dashboardController;
    
    // Middleware para verificar autenticação de admin
    const checkAdminAuth = (req, res, next) => {
        if (!req.session || !req.session.admin || !req.session.admin.superAdmin) {
            return res.status(401).json({ 
                success: false, 
                error: 'Unauthorized access' 
            });
        }
        next();
    };
    
    // Rotas para estatísticas do dashboard
    app.get('/api/admin/dashboard/stats', checkAdminAuth, dashboardController.getStats);
    app.get('/api/admin/campaigns/stats', checkAdminAuth, dashboardController.getCampaignStats);
    app.get('/api/admin/cache/stats', checkAdminAuth, dashboardController.getCacheStats);
};