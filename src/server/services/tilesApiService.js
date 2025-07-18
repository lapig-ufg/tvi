const axios = require('axios');

// Singleton instance
let tilesApiServiceInstance = null;

class TilesApiService {
    constructor(app) {
        this.app = app;
        this.config = app.config.tilesApi;
        this.logger = app.services.logger;
        this.baseURL = this.config.baseUrl;
        
        // Create axios instance without default auth
        this.client = axios.create({
            baseURL: this.baseURL,
            timeout: this.config.timeout,
            headers: {
                'Content-Type': 'application/json'
            }
        });

        // Setup interceptors for retry logic
        this.setupInterceptors();
    }

    setupInterceptors() {
        // Response interceptor for retry logic
        this.client.interceptors.response.use(
            response => response,
            async error => {
                const config = error.config;
                if (!config || !config.retry) {
                    config.retry = 0;
                }

                if (config.retry >= this.config.retryAttempts) {
                    return Promise.reject(error);
                }

                config.retry += 1;
                
                // Wait before retrying
                await new Promise(resolve => 
                    setTimeout(resolve, this.config.retryDelay * config.retry)
                );

                return this.client(config);
            }
        );
    }

    // Helper method to get auth from request session
    async getAuthFromRequest(req) {
        // Check if user is super-admin from session
        if (req && req.session && req.session.admin && req.session.admin.superAdmin) {
            const superAdmin = req.session.admin.superAdmin;
            
            // Fetch password from database for security
            try {
                const usersCollection = this.app.repository.collections.users;
                const user = await usersCollection.findOne({ 
                    username: superAdmin.username,
                    role: 'super-admin'
                });
                
                if (user && user.password) {
                    return {
                        username: superAdmin.username || superAdmin.email,
                        password: user.password // Get password from DB, not session
                    };
                }
            } catch (error) {
                await this.logger.error('Error fetching user password from DB', {
                    module: 'tilesApiService',
                    function: 'getAuthFromRequest',
                    metadata: { error: error.message, username: superAdmin.username }
                });
            }
        }
        
        // If no super-admin in session, check for authenticated user from cacheApiAuth middleware
        if (req && req.authenticatedUser) {
            return {
                username: req.authenticatedUser.email,
                password: req.authenticatedUser.password || req.authenticatedUser.rawPassword
            };
        }
        return null;
    }

    // Helper method to build URLs with parameters
    buildUrl(template, params) {
        let url = template;
        for (const [key, value] of Object.entries(params)) {
            url = url.replace(`{${key}}`, value);
        }
        return url;
    }

    // Create request config with auth
    async createRequestConfig(options = {}, req = null) {
        const config = { ...options };
        const auth = await this.getAuthFromRequest(req);
        if (auth) {
            config.auth = auth;
        }
        return config;
    }

    // Capabilities endpoints
    async getCapabilities(req = null) {
        try {
            const config = await this.createRequestConfig({}, req);
            const response = await this.client.get(this.config.endpoints.capabilities, config);
            return response.data;
        } catch (error) {
            await this.logger.error('Error fetching capabilities', {
                module: 'tilesApiService',
                function: 'getCapabilities',
                metadata: { error: error.message, endpoint: this.config.endpoints.capabilities }
            });
            throw error;
        }
    }

    async getCapabilitiesLegacy(req = null) {
        try {
            const config = await this.createRequestConfig({}, req);
            const response = await this.client.get(this.config.endpoints.capabilitiesLegacy, config);
            return response.data;
        } catch (error) {
            await this.logger.error('Error fetching legacy capabilities', {
                module: 'tilesApiService',
                function: 'getCapabilitiesLegacy',
                metadata: { error: error.message, endpoint: this.config.endpoints.capabilitiesLegacy }
            });
            throw error;
        }
    }

    // Tile endpoints
    async getLandsatTile(x, y, z, params = {}, req = null) {
        try {
            const url = this.buildUrl(this.config.endpoints.landsatTiles, { x, y, z });
            const config = await this.createRequestConfig({ 
                params,
                responseType: 'arraybuffer'
            }, req);
            const response = await this.client.get(url, config);
            return response.data;
        } catch (error) {
            await this.logger.error('Error fetching Landsat tile', {
                module: 'tilesApiService',
                function: 'getLandsatTile',
                metadata: { error: error.message, x, y, z, params }
            });
            throw error;
        }
    }

    async getSentinelTile(x, y, z, params = {}, req = null) {
        try {
            const url = this.buildUrl(this.config.endpoints.sentinelTiles, { x, y, z });
            const config = await this.createRequestConfig({ 
                params,
                responseType: 'arraybuffer'
            }, req);
            const response = await this.client.get(url, config);
            return response.data;
        } catch (error) {
            await this.logger.error('Error fetching Sentinel tile', {
                module: 'tilesApiService',
                function: 'getSentinelTile',
                metadata: { error: error.message, x, y, z, params }
            });
            throw error;
        }
    }

    // Timeseries endpoints
    async getLandsatTimeseries(lat, lon, params = {}, req = null) {
        try {
            const url = this.buildUrl(this.config.endpoints.landsatTimeseries, { lat, lon });
            const config = await this.createRequestConfig({ params }, req);
            const response = await this.client.get(url, config);
            return response.data;
        } catch (error) {
            await this.logger.error('Error fetching Landsat timeseries', {
                module: 'tilesApiService',
                function: 'getLandsatTimeseries',
                metadata: { error: error.message, lat, lon, params }
            });
            throw error;
        }
    }

    async getSentinelTimeseries(lat, lon, params = {}, req = null) {
        try {
            const url = this.buildUrl(this.config.endpoints.sentinelTimeseries, { lat, lon });
            const config = await this.createRequestConfig({ params }, req);
            const response = await this.client.get(url, config);
            return response.data;
        } catch (error) {
            await this.logger.error('Error fetching Sentinel timeseries', {
                module: 'tilesApiService',
                function: 'getSentinelTimeseries',
                metadata: { error: error.message, lat, lon, params }
            });
            throw error;
        }
    }

    async getModisTimeseries(lat, lon, params = {}, req = null) {
        try {
            const url = this.buildUrl(this.config.endpoints.modisTimeseries, { lat, lon });
            const config = await this.createRequestConfig({ params }, req);
            const response = await this.client.get(url, config);
            return response.data;
        } catch (error) {
            await this.logger.error('Error fetching MODIS timeseries', {
                module: 'tilesApiService',
                function: 'getModisTimeseries',
                metadata: { error: error.message, lat, lon, params }
            });
            throw error;
        }
    }

    async getNddiTimeseries(lat, lon, params = {}, req = null) {
        try {
            const url = this.buildUrl(this.config.endpoints.nddiTimeseries, { lat, lon });
            const config = await this.createRequestConfig({ params }, req);
            const response = await this.client.get(url, config);
            return response.data;
        } catch (error) {
            await this.logger.error('Error fetching NDDI timeseries', {
                module: 'tilesApiService',
                function: 'getNddiTimeseries',
                metadata: { error: error.message, lat, lon, params }
            });
            throw error;
        }
    }

    // Cache management endpoints
    async getCacheStats(req = null) {
        try {
            const config = await this.createRequestConfig({}, req);
            const response = await this.client.get(this.config.endpoints.cacheStats, config);
            return response.data;
        } catch (error) {
            await this.logger.error('Error fetching cache stats', {
                module: 'tilesApiService',
                function: 'getCacheStats',
                metadata: { error: error.message }
            });
            throw error;
        }
    }

    async clearCache(params = {}, req = null) {
        try {
            const config = await this.createRequestConfig({ params }, req);
            const response = await this.client.delete(this.config.endpoints.cacheClear, config);
            return response.data;
        } catch (error) {
            await this.logger.error('Error clearing cache', {
                module: 'tilesApiService',
                function: 'clearCache',
                metadata: { error: error.message, params }
            });
            throw error;
        }
    }

    async warmupCache(data, req = null) {
        try {
            const config = await this.createRequestConfig({}, req);
            const response = await this.client.post(this.config.endpoints.cacheWarmup, data, config);
            return response.data;
        } catch (error) {
            await this.logger.error('Error warming up cache', {
                module: 'tilesApiService',
                function: 'warmupCache',
                metadata: { error: error.message, data }
            });
            throw error;
        }
    }

    async startPointCache(pointId, req = null) {
        try {
            const config = await this.createRequestConfig({}, req);
            const response = await this.client.post(this.config.endpoints.cachePointStart, { point_id: pointId }, config);
            return response.data;
        } catch (error) {
            await this.logger.error('Error starting point cache', {
                module: 'tilesApiService',
                function: 'startPointCache',
                metadata: { error: error.message, pointId }
            });
            throw error;
        }
    }

    async startCampaignCache(campaignId, batchSize = 5, req = null) {
        try {
            const config = await this.createRequestConfig({}, req);
            const response = await this.client.post(this.config.endpoints.cacheCampaignStart, {
                campaign_id: campaignId,
                batch_size: batchSize
            }, config);
            return response.data;
        } catch (error) {
            await this.logger.error('Error starting campaign cache', {
                module: 'tilesApiService',
                function: 'startCampaignCache',
                metadata: { error: error.message, campaignId, batchSize }
            });
            throw error;
        }
    }

    async getPointCacheStatus(pointId, req = null) {
        try {
            const url = this.buildUrl(this.config.endpoints.cachePointStatus, { point_id: pointId });
            const config = await this.createRequestConfig({}, req);
            const response = await this.client.get(url, config);
            return response.data;
        } catch (error) {
            await this.logger.error('Error fetching point cache status', {
                module: 'tilesApiService',
                function: 'getPointCacheStatus',
                metadata: { error: error.message, pointId }
            });
            throw error;
        }
    }

    async getCampaignCacheStatus(campaignId, req = null) {
        try {
            const url = this.buildUrl(this.config.endpoints.cacheCampaignStatus, { campaign_id: campaignId });
            const config = await this.createRequestConfig({}, req);
            const response = await this.client.get(url, config);
            return response.data;
        } catch (error) {
            await this.logger.error('Error fetching campaign cache status', {
                module: 'tilesApiService',
                function: 'getCampaignCacheStatus',
                metadata: { error: error.message, campaignId }
            });
            throw error;
        }
    }

    async getTaskStatus(taskId, req = null) {
        try {
            const url = this.buildUrl(this.config.endpoints.cacheTaskStatus, { task_id: taskId });
            const config = await this.createRequestConfig({}, req);
            const response = await this.client.get(url, config);
            return response.data;
        } catch (error) {
            await this.logger.error('Error fetching task status', {
                module: 'tilesApiService',
                function: 'getTaskStatus',
                metadata: { error: error.message, taskId }
            });
            throw error;
        }
    }

    // Analyze cache patterns
    async analyzeCachePatterns(days = 7, req = null) {
        try {
            const url = this.buildUrl(this.config.endpoints.cacheAnalyzePatterns || '/api/cache/analyze-patterns');
            const config = await this.createRequestConfig({ params: { days } }, req);
            const response = await this.client.get(url, config);
            return response.data;
        } catch (error) {
            await this.logger.error('Error analyzing cache patterns', {
                module: 'tilesApiService',
                function: 'analyzeCachePatterns',
                metadata: { error: error.message, days }
            });
            throw error;
        }
    }

    // Get cache recommendations
    async getCacheRecommendations(req = null) {
        try {
            const url = this.buildUrl(this.config.endpoints.cacheRecommendations || '/api/cache/recommendations');
            const config = await this.createRequestConfig({}, req);
            const response = await this.client.get(url, config);
            return response.data;
        } catch (error) {
            await this.logger.error('Error fetching cache recommendations', {
                module: 'tilesApiService',
                function: 'getCacheRecommendations',
                metadata: { error: error.message }
            });
            throw error;
        }
    }

    // Get active tasks
    async getActiveTasks(req = null) {
        try {
            const url = this.buildUrl(this.config.endpoints.cacheActiveTasks || '/api/cache/tasks/active');
            const config = await this.createRequestConfig({}, req);
            const response = await this.client.get(url, config);
            return response.data;
        } catch (error) {
            await this.logger.error('Error fetching active tasks', {
                module: 'tilesApiService',
                function: 'getActiveTasks',
                metadata: { error: error.message }
            });
            throw error;
        }
    }

    // Cancel task
    async cancelTask(taskId, req = null) {
        try {
            const url = this.buildUrl(this.config.endpoints.cacheCancelTask || '/api/cache/tasks/{task_id}', { task_id: taskId });
            const config = await this.createRequestConfig({}, req);
            const response = await this.client.delete(url, config);
            return response.data;
        } catch (error) {
            await this.logger.error('Error canceling task', {
                module: 'tilesApiService',
                function: 'cancelTask',
                metadata: { error: error.message, taskId }
            });
            throw error;
        }
    }

    // Get point cache status
    async getPointCacheStatus(pointId, req = null) {
        try {
            const url = this.buildUrl(this.config.endpoints.cachePointStatus || '/api/cache/point/{point_id}/status', { point_id: pointId });
            const config = await this.createRequestConfig({}, req);
            const response = await this.client.get(url, config);
            return response.data;
        } catch (error) {
            await this.logger.error('Error fetching point cache status', {
                module: 'tilesApiService',
                function: 'getPointCacheStatus',
                metadata: { error: error.message, pointId }
            });
            throw error;
        }
    }

    // Get campaign cache status
    async getCampaignCacheStatus(campaignId, req = null) {
        try {
            const url = this.buildUrl(this.config.endpoints.cacheCampaignStatus || '/api/cache/campaign/{campaign_id}/status', { campaign_id: campaignId });
            const config = await this.createRequestConfig({}, req);
            const response = await this.client.get(url, config);
            return response.data;
        } catch (error) {
            await this.logger.error('Error fetching campaign cache status', {
                module: 'tilesApiService',
                function: 'getCampaignCacheStatus',
                metadata: { error: error.message, campaignId }
            });
            throw error;
        }
    }

    // Clear point cache
    async clearPointCache(pointId, req = null) {
        try {
            const url = this.buildUrl(this.config.endpoints.cacheClearPoint || '/api/cache/point/{point_id}', { point_id: pointId });
            const config = await this.createRequestConfig({}, req);
            const response = await this.client.delete(url, config);
            return response.data;
        } catch (error) {
            await this.logger.error('Error clearing point cache', {
                module: 'tilesApiService',
                function: 'clearPointCache',
                metadata: { error: error.message, pointId }
            });
            throw error;
        }
    }

    // Clear campaign cache
    async clearCampaignCache(campaignId, req = null) {
        try {
            const url = this.buildUrl(this.config.endpoints.cacheClearCampaign || '/api/cache/campaign/{campaign_id}', { campaign_id: campaignId });
            const config = await this.createRequestConfig({}, req);
            const response = await this.client.delete(url, config);
            return response.data;
        } catch (error) {
            await this.logger.error('Error clearing campaign cache', {
                module: 'tilesApiService',
                function: 'clearCampaignCache',
                metadata: { error: error.message, campaignId }
            });
            throw error;
        }
    }

    // Generate megatile
    async getMegatile(layer, x, y, z, req = null) {
        try {
            const url = this.buildUrl(this.config.endpoints.cacheMegatile || '/api/aggregation/megatile/{layer}/{x}/{y}/{z}', { layer, x, y, z });
            const config = await this.createRequestConfig({}, req);
            const response = await this.client.get(url, config);
            return response.data;
        } catch (error) {
            await this.logger.error('Error generating megatile', {
                module: 'tilesApiService',
                function: 'getMegatile',
                metadata: { error: error.message, layer, x, y, z }
            });
            throw error;
        }
    }

    // Generate sprite sheet
    async generateSpriteSheet(data, req = null) {
        try {
            const url = this.buildUrl(this.config.endpoints.cacheSpriteGenerate || '/api/aggregation/sprites/generate');
            const config = await this.createRequestConfig(data, req);
            const response = await this.client.post(url, data, config);
            return response.data;
        } catch (error) {
            await this.logger.error('Error generating sprite sheet', {
                module: 'tilesApiService',
                function: 'generateSpriteSheet',
                metadata: { error: error.message }
            });
            throw error;
        }
    }

    // Get sprite sheet status
    async getSpriteSheetStatus(spriteId, req = null) {
        try {
            const url = this.buildUrl(this.config.endpoints.cacheSpriteStatus || '/api/aggregation/sprites/{sprite_id}/status', { sprite_id: spriteId });
            const config = await this.createRequestConfig({}, req);
            const response = await this.client.get(url, config);
            return response.data;
        } catch (error) {
            await this.logger.error('Error fetching sprite sheet status', {
                module: 'tilesApiService',
                function: 'getSpriteSheetStatus',
                metadata: { error: error.message, spriteId }
            });
            throw error;
        }
    }
}

// Factory function for express-load
module.exports = function(app) {
    if (tilesApiServiceInstance) {
        return tilesApiServiceInstance;
    }
    tilesApiServiceInstance = new TilesApiService(app);
    return tilesApiServiceInstance;
};