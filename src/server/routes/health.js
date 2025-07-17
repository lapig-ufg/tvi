module.exports = function(app) {
    
    /**
     * Health check endpoint
     */
    app.get('/api/health', function(req, res) {
        res.json({
            status: 'ok',
            timestamp: new Date(),
            uptime: process.uptime(),
            environment: process.env.NODE_ENV || 'development'
        });
    });
    
};