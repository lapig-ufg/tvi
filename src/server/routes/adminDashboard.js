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
    
    /**
     * @swagger
     * /api/admin/dashboard/stats:
     *   get:
     *     summary: Get admin dashboard statistics
     *     tags: [Admin Dashboard]
     *     security:
     *       - sessionAuth: []
     *     responses:
     *       200:
     *         description: Dashboard statistics
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 totalUsers:
     *                   type: number
     *                 totalCampaigns:
     *                   type: number
     *                 totalPoints:
     *                   type: number
     *                 totalInspections:
     *                   type: number
     *                 activeUsers:
     *                   type: number
     *       401:
     *         description: Unauthorized - Admin access required
     */
    app.get('/api/admin/dashboard/stats', checkAdminAuth, dashboardController.getStats);
    /**
     * @swagger
     * /api/admin/campaigns/stats:
     *   get:
     *     summary: Get campaign statistics for admin
     *     tags: [Admin Dashboard]
     *     security:
     *       - sessionAuth: []
     *     responses:
     *       200:
     *         description: Campaign statistics
     *         content:
     *           application/json:
     *             schema:
     *               type: array
     *               items:
     *                 type: object
     *                 properties:
     *                   _id:
     *                     type: string
     *                   name:
     *                     type: string
     *                   totalPoints:
     *                     type: number
     *                   inspectedPoints:
     *                     type: number
     *                   completionRate:
     *                     type: number
     *                   activeInspectors:
     *                     type: number
     *       401:
     *         description: Unauthorized - Admin access required
     */
    app.get('/api/admin/campaigns/stats', checkAdminAuth, dashboardController.getCampaignStats);
    /**
     * @swagger
     * /api/admin/cache/stats:
     *   get:
     *     summary: Get cache statistics for admin
     *     tags: [Admin Dashboard]
     *     security:
     *       - sessionAuth: []
     *     responses:
     *       200:
     *         description: Cache statistics
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 redis:
     *                   type: object
     *                   properties:
     *                     hits:
     *                       type: number
     *                     misses:
     *                       type: number
     *                     hitRate:
     *                       type: string
     *                     size:
     *                       type: number
     *                     memory:
     *                       type: string
     *                 tilesApi:
     *                   type: object
     *                   properties:
     *                     totalTiles:
     *                       type: number
     *                     cachedTiles:
     *                       type: number
     *       401:
     *         description: Unauthorized - Admin access required
     */
    app.get('/api/admin/cache/stats', checkAdminAuth, dashboardController.getCacheStats);
};