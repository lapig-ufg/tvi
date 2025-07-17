module.exports = function(app) {
    const logController = app.controllers.logController;
    
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
    
    // Rotas para administração de logs
    app.get('/api/admin/logs', checkAdminAuth, logController.getLogs);
    app.get('/api/admin/logs/stats', checkAdminAuth, logController.getLogStats);
    app.get('/api/admin/logs/:logId', checkAdminAuth, logController.getLogById);
    app.post('/api/admin/logs/cleanup', checkAdminAuth, logController.cleanupLogs);
    app.post('/api/admin/logs/test', checkAdminAuth, logController.testLog);
};