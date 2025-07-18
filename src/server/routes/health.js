module.exports = function(app) {
    
    /**
     * @swagger
     * /api/health:
     *   get:
     *     summary: Health check endpoint
     *     tags: [System]
     *     responses:
     *       200:
     *         description: Service is healthy
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 status:
     *                   type: string
     *                   enum: [ok]
     *                 timestamp:
     *                   type: string
     *                   format: date-time
     *                 uptime:
     *                   type: number
     *                   description: Server uptime in seconds
     *                 environment:
     *                   type: string
     *                   description: Current environment
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