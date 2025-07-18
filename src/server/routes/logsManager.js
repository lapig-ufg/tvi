module.exports = function (app) {

    var auth = function(req, res, next) {
        var token = req.session.token;
        if (token && token.ACCESS_TOKEN) {
            next();
        } else {
            res.status(403).json({ 
                error: 'Access denied',
                message: 'Authentication required' 
            });
        }
    };

    var adminAuth = function(req, res, next) {
        var admin = req.session.admin;
        if (admin && admin.active && admin.superAdmin) {
            next();
        } else {
            res.status(403).json({ 
                error: 'Access denied',
                message: 'Admin privileges required' 
            });
        }
    };

    app.get('/service/logs/statistics', adminAuth);
    app.get('/service/logs/job-status', adminAuth);
    app.put('/service/logs/job-config', adminAuth);
    app.post('/service/logs/trigger-job', adminAuth);
    app.get('/service/logs/recent', adminAuth);
    app.get('/service/logs/:logId', adminAuth);
    app.delete('/service/logs/cleanup', adminAuth);
    app.get('/service/logs/export', adminAuth);

};