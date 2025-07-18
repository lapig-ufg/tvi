module.exports = function (app) {
    const cacheManager = app.controllers.cacheManager;
    const auth = app.middleware.auth.cacheApiAuth;
    
    // Debug log
    // console.log('cacheApi.js - cacheManager loaded:', !!cacheManager);
    // console.log('cacheApi.js - cacheManager methods:', cacheManager ? Object.keys(cacheManager) : 'undefined');

    // ===== Public endpoints (existing functionality) =====
    
    /**
     * @swagger
     * /service/cache/uncached-points:
     *   get:
     *     summary: Get uncached points grouped by campaign
     *     tags: [Cache]
     *     description: Returns a list of points that haven't been cached yet, grouped by campaign with priority
     *     responses:
     *       200:
     *         description: Success
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 success:
     *                   type: boolean
     *                 totalUncachedPoints:
     *                   type: number
     *                 campaigns:
     *                   type: array
     *                   items:
     *                     type: object
     *                     properties:
     *                       _id:
     *                         type: string
     *                       campaignInfo:
     *                         type: object
     *                       uncachedCount:
     *                         type: number
     *                       points:
     *                         type: array
     *       500:
     *         description: Server error
     */
    app.get('/service/cache/uncached-points', cacheManager.getUncachedPoints);
    
    // Start cache simulation
    app.post('/service/cache/simulate', cacheManager.simulateCache);
    
    // Get cache status summary
    app.get('/service/cache/status', cacheManager.getCacheStatus);
    
    // Get job status
    app.get('/service/cache/job-status', cacheManager.getJobStatus);
    
    // Update job configuration
    app.put('/service/cache/job-config', cacheManager.updateJobConfig);
    
    // Clear layer cache (legacy)
    app.post('/service/cache/clear-layer', cacheManager.clearLayerCache);

    // ===== Protected endpoints (new API features) =====
    
    /**
     * @swagger
     * /api/cache/stats:
     *   get:
     *     summary: Get cache statistics from the Tiles API
     *     tags: [Cache]
     *     security:
     *       - cacheApiAuth: []
     *     description: Returns comprehensive cache statistics including Redis hits/misses, storage info and performance metrics
     *     responses:
     *       200:
     *         description: Success
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 success:
     *                   type: boolean
     *                 data:
     *                   type: object
     *                   properties:
     *                     redis:
     *                       type: object
     *                       properties:
     *                         hits:
     *                           type: number
     *                         misses:
     *                           type: number
     *                         size:
     *                           type: number
     *                         memory:
     *                           type: number
     *                     storage:
     *                       type: object
     *                       properties:
     *                         tiles:
     *                           type: number
     *                         size:
     *                           type: number
     *                         campaigns:
     *                           type: array
     *                     performance:
     *                       type: object
     *                       properties:
     *                         avgResponseTime:
     *                           type: number
     *                         requestsPerMinute:
     *                           type: number
     *                         errorRate:
     *                           type: number
     *       401:
     *         description: Unauthorized
     *       500:
     *         description: Server error
     */
    app.get('/api/cache/stats', 
        auth.requireCacheApiAuth, 
        cacheManager.getApiCacheStats
    );
    
    // Clear cache with new API
    app.delete('/api/cache/clear', 
        auth.requireCacheApiAuth, 
        cacheManager.clearApiCache
    );
    
    // Warm up cache
    app.post('/api/cache/warmup', 
        auth.requireCacheApiAuth, 
        cacheManager.warmupCache
    );
    
    // Analyze cache patterns
    app.post('/api/cache/analyze-patterns', 
        auth.requireCacheApiAuth, 
        cacheManager.analyzeCachePatterns
    );
    
    // Get cache recommendations
    app.get('/api/cache/recommendations', 
        auth.requireCacheApiAuth, 
        cacheManager.getCacheRecommendations
    );
    
    // ===== Point cache management =====
    
    // Start cache for a point
    app.post('/api/cache/point/start', 
        auth.requireCacheApiAuth, 
        cacheManager.startPointCache
    );
    
    // Get point cache status
    app.get('/api/cache/point/:pointId/status', 
        auth.requireCacheApiAuth, 
        cacheManager.getPointCacheStatus
    );
    
    // Clear point cache
    app.delete('/api/cache/point/:pointId', 
        auth.requireCacheApiAuth, 
        cacheManager.clearPointCache
    );
    
    // ===== Campaign cache management =====
    
    // Start cache for a campaign
    app.post('/api/cache/campaign/start', 
        auth.requireCacheApiAuth, 
        cacheManager.startCampaignCache
    );
    
    // Get campaign cache status
    app.get('/api/cache/campaign/:campaignId/status', 
        auth.requireCacheApiAuth, 
        cacheManager.getCampaignCacheStatus
    );
    
    // Clear campaign cache
    app.delete('/api/cache/campaign/:campaignId', 
        auth.requireCacheApiAuth, 
        cacheManager.clearCampaignCache
    );
    
    // ===== Task management =====
    
    // Get active tasks
    app.get('/api/cache/tasks/active', 
        auth.requireCacheApiAuth, 
        cacheManager.getActiveTasks
    );
    
    // Get task status
    app.get('/api/cache/tasks/:taskId', 
        auth.requireCacheApiAuth, 
        cacheManager.getTaskStatus
    );
    
    // Cancel task
    app.delete('/api/cache/tasks/:taskId', 
        auth.requireCacheApiAuth, 
        cacheManager.cancelTask
    );
    
    // ===== Aggregation endpoints =====
    
    // Get megatile (if implemented in tiles API)
    app.get('/api/aggregation/megatile/:layer/:x/:y/:z', 
        auth.optionalCacheApiAuth, 
        cacheManager.getMegatile
    );
    
    // Generate sprite sheet
    app.post('/api/aggregation/sprites/generate', 
        auth.requireCacheApiAuth, 
        cacheManager.generateSpriteSheet
    );
    
    // Get sprite sheet status
    app.get('/api/aggregation/sprites/:spriteId/status', 
        auth.optionalCacheApiAuth, 
        cacheManager.getSpriteSheetStatus
    );
};
