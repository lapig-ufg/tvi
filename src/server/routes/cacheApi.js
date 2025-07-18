module.exports = function (app) {
    const cacheManager = app.controllers.cacheManagerRefactored;
    const auth = app.middleware.auth.cacheApiAuth;
    
    // Debug log
    console.log('cacheApi.js - cacheManager loaded:', !!cacheManager);
    console.log('cacheApi.js - cacheManager methods:', cacheManager ? Object.keys(cacheManager) : 'undefined');

    // ===== Public endpoints (existing functionality) =====
    
    // Get uncached points grouped by campaign
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
    
    // Cache statistics from new API
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
    
    // Get task status
    app.get('/api/cache/tasks/:taskId', 
        auth.requireCacheApiAuth, 
        cacheManager.getTaskStatus
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