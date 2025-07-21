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
            },
            maxRedirects: 5, // Follow redirects
            validateStatus: function (status) {
                return status >= 200 && status < 400; // Accept redirects as valid
            }
        });

        // Setup interceptors for retry logic
        this.setupInterceptors();
    }

    setupInterceptors() {
        // Request interceptor to log outgoing requests
        this.client.interceptors.request.use(
            async config => {
                // Only log errors, not every request
                // This interceptor is for debugging only
                return config;
            },
            error => Promise.reject(error)
        );
        
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
                
                // Log retry attempt
                await this.logger.warn('Retrying request due to error', {
                    module: 'tilesApiService',
                    function: 'responseInterceptor',
                    metadata: {
                        url: config.url,
                        attempt: config.retry,
                        maxAttempts: this.config.retryAttempts,
                        error: error.message,
                        status: error.response ? error.response.status : 'No response'
                    }
                });
                
                // Wait before retrying
                await new Promise(resolve => 
                    setTimeout(resolve, this.config.retryDelay * config.retry)
                );

                // IMPORTANT: Preserve all headers including Authorization
                // The axios instance might be clearing headers on retry
                return this.client.request(config);
            }
        );
    }

    // Helper method to get auth from request session
    async getAuthFromRequest(req) {
        // Debug log (without sensitive data)
        await this.logger.debug('Getting auth from request', {
            module: 'tilesApiService',
            function: 'getAuthFromRequest',
            metadata: {
                hasReq: !!req,
                hasSession: !!(req && req.session),
                hasAuthenticatedUser: !!(req && req.authenticatedUser),
                hasSuperAdmin: !!(req && req.session && req.session.admin && req.session.admin.superAdmin)
            }
        });

        // Check if user is super-admin from session
        if (req && req.session && req.session.admin && req.session.admin.superAdmin) {
            const superAdmin = req.session.admin.superAdmin;
            
            // Fetch password from database for security
            try {
                const usersCollection = this.app.repository.collections.users;
                
                // Try to find user by username first, then by email, then by ID
                let user = null;
                
                if (superAdmin.username) {
                    user = await usersCollection.findOne({ 
                        username: superAdmin.username,
                        role: 'super-admin'
                    });
                }
                
                if (!user && superAdmin.email) {
                    user = await usersCollection.findOne({ 
                        email: superAdmin.email,
                        role: 'super-admin'
                    });
                }
                
                if (!user && superAdmin.id) {
                    user = await usersCollection.findOne({ 
                        _id: superAdmin.id,
                        role: 'super-admin'
                    });
                }
                
                if (user) {
                    // Use session password first, fallback to DB password
                    const password = superAdmin.password || user.password;
                    if (password) {
                        // Log auth usage (without sensitive data)
                        await this.logger.debug('Using super admin auth', {
                            module: 'tilesApiService',
                            function: 'getAuthFromRequest',
                            metadata: {
                                hasEmail: !!user.email,
                                hasUsername: !!user.username,
                                passwordSource: superAdmin.password ? 'session' : 'database'
                            }
                        });
                        
                        return {
                            username: user.email || user.username || superAdmin.username,
                            password: password
                        };
                    }
                } else {
                    await this.logger.warn('Super-admin user found in session but not in database or no password', {
                        module: 'tilesApiService',
                        function: 'getAuthFromRequest',
                        metadata: { 
                            sessionUsername: superAdmin.username,
                            sessionEmail: superAdmin.email,
                            sessionId: superAdmin.id,
                            userFound: !!user,
                            hasPassword: !!(user && user.password)
                        }
                    });
                }
            } catch (error) {
                await this.logger.error('Error fetching user password from DB', {
                    module: 'tilesApiService',
                    function: 'getAuthFromRequest',
                    metadata: { error: error.message, username: superAdmin.username, email: superAdmin.email }
                });
            }
        }
        
        // If no super-admin in session, check for authenticated user from cacheApiAuth middleware
        if (req && req.authenticatedUser) {
            const auth = {
                username: req.authenticatedUser.email,
                password: req.authenticatedUser.password || req.authenticatedUser.rawPassword
            };
            
            await this.logger.debug('Using authenticated user from middleware', {
                module: 'tilesApiService',
                function: 'getAuthFromRequest',
                metadata: {
                    hasPassword: !!auth.password,
                    role: req.authenticatedUser.role,
                    type: req.authenticatedUser.type
                }
            });
            
            return auth;
        }
        
        await this.logger.warn('No authentication credentials found', {
            module: 'tilesApiService',
            function: 'getAuthFromRequest',
            metadata: {
                hasReq: !!req,
                hasSession: !!(req && req.session),
                hasAuthenticatedUser: !!(req && req.authenticatedUser)
            }
        });
        
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
        
        // Remove this verbose log
        // Only log if there's an issue
        
        const auth = await this.getAuthFromRequest(req);
        
        if (auth && auth.username && auth.password) {
            // Create Basic Auth header manually for better compatibility
            const credentials = Buffer.from(`${auth.username}:${auth.password}`).toString('base64');
            const authHeader = `Basic ${credentials}`;
            
            config.headers = {
                ...config.headers,
                'Authorization': authHeader
            };
            // Also keep auth config for axios compatibility
            config.auth = auth;
            
            // Log auth configuration (without exposing credentials)
            await this.logger.debug('Auth configured for tiles API request', {
                module: 'tilesApiService',
                function: 'createRequestConfig',
                metadata: { 
                    hasAuth: true,
                    authType: 'Basic'
                }
            });
        } else {
            await this.logger.warn('No auth credentials available for tiles API request', {
                module: 'tilesApiService',
                function: 'createRequestConfig',
                metadata: { 
                    hasReq: !!req,
                    hasSession: !!(req && req.session)
                }
            });
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

    async startCampaignCache(params, req = null) {
        try {
            // Support both old signature (campaignId, batchSize) and new object format
            let requestData;
            if (typeof params === 'string') {
                // Old signature compatibility
                requestData = {
                    campaign_id: params,
                    batch_size: arguments[1] || 50
                };
            } else {
                // New object format with all parameters
                requestData = {
                    campaign_id: params.campaign_id,
                    batch_size: params.batch_size || 50,
                    use_grid: params.use_grid !== undefined ? params.use_grid : true,
                    priority_recent_years: params.priority_recent_years !== undefined ? params.priority_recent_years : true
                };
            }
            
            const config = await this.createRequestConfig({}, req);
            const response = await this.client.post(this.config.endpoints.cacheCampaignStart, requestData, config);
            return response.data;
        } catch (error) {
            await this.logger.error('Error starting campaign cache', {
                module: 'tilesApiService',
                function: 'startCampaignCache',
                metadata: { error: error.message, params }
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

    // Task Management endpoints
    async getTasksList(req = null) {
        try {
            const config = await this.createRequestConfig({}, req);
            const response = await this.client.get(this.config.endpoints.tasksList, config);
            return response.data;
        } catch (error) {
            await this.logger.error('Error fetching tasks list', {
                module: 'tilesApiService',
                function: 'getTasksList',
                metadata: { error: error.message }
            });
            throw error;
        }
    }

    async getTaskStatusById(taskId, req = null) {
        try {
            const url = this.buildUrl(this.config.endpoints.taskStatus, { task_id: taskId });
            const config = await this.createRequestConfig({}, req);
            const response = await this.client.get(url, config);
            return response.data;
        } catch (error) {
            await this.logger.error('Error fetching task status by id', {
                module: 'tilesApiService',
                function: 'getTaskStatusById',
                metadata: { error: error.message, taskId }
            });
            throw error;
        }
    }

    async getWorkersStats(req = null) {
        try {
            const config = await this.createRequestConfig({}, req);
            const response = await this.client.get(this.config.endpoints.tasksWorkers, config);
            return response.data;
        } catch (error) {
            await this.logger.error('Error fetching workers stats', {
                module: 'tilesApiService',
                function: 'getWorkersStats',
                metadata: { error: error.message }
            });
            throw error;
        }
    }

    async purgeTasks(params = {}, req = null) {
        try {
            const config = await this.createRequestConfig({ params }, req);
            const response = await this.client.post(this.config.endpoints.tasksPurge, null, config);
            return response.data;
        } catch (error) {
            await this.logger.error('Error purging tasks', {
                module: 'tilesApiService',
                function: 'purgeTasks',
                metadata: { error: error.message, params }
            });
            throw error;
        }
    }

    async getRegisteredTasks(req = null) {
        try {
            const config = await this.createRequestConfig({}, req);
            const response = await this.client.get(this.config.endpoints.tasksRegistered, config);
            return response.data;
        } catch (error) {
            await this.logger.error('Error fetching registered tasks', {
                module: 'tilesApiService',
                function: 'getRegisteredTasks',
                metadata: { error: error.message }
            });
            throw error;
        }
    }

    async getQueueLength(req = null) {
        try {
            const config = await this.createRequestConfig({}, req);
            const response = await this.client.get(this.config.endpoints.tasksQueueLength, config);
            return response.data;
        } catch (error) {
            await this.logger.error('Error fetching queue length', {
                module: 'tilesApiService',
                function: 'getQueueLength',
                metadata: { error: error.message }
            });
            throw error;
        }
    }

    // Visualization Parameters methods
    async listVisParams(filters = {}, req = null) {
        try {
            // Build request URL
            const fullUrl = `${this.baseURL}${this.config.endpoints.visParams}`;

            const params = {};
            if (filters.category) params.category = filters.category;
            if (filters.active !== undefined) params.active = filters.active;
            if (filters.tag) params.tag = filters.tag;

            const config = await this.createRequestConfig({ params }, req);
            
            // Only log if debugging is needed
            await this.logger.debug('Making request to tiles API', {
                module: 'tilesApiService',
                function: 'listVisParams',
                metadata: {
                    endpoint: this.config.endpoints.visParams,
                    hasAuth: !!(config.headers && config.headers.Authorization)
                }
            });

            const startTime = Date.now();
            const response = await this.client.get(this.config.endpoints.visParams, config);
            const responseTime = Date.now() - startTime;
            
            // Only log if there's an issue or if debugging
            if (response.status !== 200) {
                await this.logger.warn('Tiles API response with non-200 status', {
                    module: 'tilesApiService',
                    function: 'listVisParams',
                    metadata: {
                        status: response.status,
                        statusText: response.statusText,
                        responseTime: `${responseTime}ms`
                    }
                });
            }
            
            return response.data;
        } catch (error) {
            await this.logger.error('Error listing vis params', {
                module: 'tilesApiService',
                function: 'listVisParams',
                metadata: { 
                    endpoint: this.config.endpoints.visParams,
                    error: error.message, 
                    status: error.response && error.response.status,
                    statusText: error.response && error.response.statusText
                }
            });
            throw error;
        }
    }

    async createVisParam(data, req = null) {
        try {
            const config = await this.createRequestConfig(data, req);
            const response = await this.client.post(this.config.endpoints.visParams, data, config);
            return response.data;
        } catch (error) {
            await this.logger.error('Error creating vis param', {
                module: 'tilesApiService',
                function: 'createVisParam',
                metadata: { error: error.message }
            });
            throw error;
        }
    }

    async getVisParam(name, req = null) {
        try {
            const url = this.buildUrl(this.config.endpoints.visParamsDetail, { name });
            const config = await this.createRequestConfig({}, req);
            const response = await this.client.get(url, config);
            return response.data;
        } catch (error) {
            await this.logger.error('Error fetching vis param', {
                module: 'tilesApiService',
                function: 'getVisParam',
                metadata: { error: error.message, name }
            });
            throw error;
        }
    }

    async updateVisParam(name, data, req = null) {
        try {
            const url = this.buildUrl(this.config.endpoints.visParamsDetail, { name });
            const config = await this.createRequestConfig(data, req);
            const response = await this.client.put(url, data, config);
            return response.data;
        } catch (error) {
            await this.logger.error('Error updating vis param', {
                module: 'tilesApiService',
                function: 'updateVisParam',
                metadata: { error: error.message, name }
            });
            throw error;
        }
    }

    async deleteVisParam(name, req = null) {
        try {
            const url = this.buildUrl(this.config.endpoints.visParamsDetail, { name });
            const config = await this.createRequestConfig({}, req);
            const response = await this.client.delete(url, config);
            return response.data;
        } catch (error) {
            await this.logger.error('Error deleting vis param', {
                module: 'tilesApiService',
                function: 'deleteVisParam',
                metadata: { error: error.message, name }
            });
            throw error;
        }
    }

    async toggleVisParam(name, req = null) {
        try {
            const url = this.buildUrl(this.config.endpoints.visParamsToggle, { name });
            const config = await this.createRequestConfig({}, req);
            const response = await this.client.patch(url, {}, config);
            return response.data;
        } catch (error) {
            await this.logger.error('Error toggling vis param', {
                module: 'tilesApiService',
                function: 'toggleVisParam',
                metadata: { error: error.message, name }
            });
            throw error;
        }
    }

    async testVisParams(data, req = null) {
        try {
            const config = await this.createRequestConfig(data, req);
            const response = await this.client.post(this.config.endpoints.visParamsTest, data, config);
            return response.data;
        } catch (error) {
            await this.logger.error('Error testing vis params', {
                module: 'tilesApiService',
                function: 'testVisParams',
                metadata: { error: error.message }
            });
            throw error;
        }
    }

    async cloneVisParam(name, newName, req = null) {
        try {
            const url = this.buildUrl(this.config.endpoints.visParamsClone, { name });
            const config = await this.createRequestConfig({ params: { new_name: newName } }, req);
            const response = await this.client.post(url, {}, config);
            return response.data;
        } catch (error) {
            await this.logger.error('Error cloning vis param', {
                module: 'tilesApiService',
                function: 'cloneVisParam',
                metadata: { error: error.message, name, newName }
            });
            throw error;
        }
    }

    async exportVisParams(req = null) {
        try {
            const config = await this.createRequestConfig({}, req);
            const response = await this.client.get(this.config.endpoints.visParamsExport, config);
            return response.data;
        } catch (error) {
            await this.logger.error('Error exporting vis params', {
                module: 'tilesApiService',
                function: 'exportVisParams',
                metadata: { error: error.message }
            });
            throw error;
        }
    }

    async importVisParams(data, overwrite = false, req = null) {
        try {
            const config = await this.createRequestConfig({ 
                params: { overwrite },
                data 
            }, req);
            const response = await this.client.post(this.config.endpoints.visParamsImport, data, config);
            return response.data;
        } catch (error) {
            await this.logger.error('Error importing vis params', {
                module: 'tilesApiService',
                function: 'importVisParams',
                metadata: { error: error.message, overwrite }
            });
            throw error;
        }
    }

    async getLandsatCollections(req = null) {
        try {
            const config = await this.createRequestConfig({}, req);
            const response = await this.client.get(this.config.endpoints.visParamsLandsatCollections, config);
            return response.data;
        } catch (error) {
            await this.logger.error('Error fetching Landsat collections', {
                module: 'tilesApiService',
                function: 'getLandsatCollections',
                metadata: { error: error.message }
            });
            throw error;
        }
    }

    async updateLandsatCollections(data, req = null) {
        try {
            const config = await this.createRequestConfig(data, req);
            const response = await this.client.put(this.config.endpoints.visParamsLandsatCollections, data, config);
            return response.data;
        } catch (error) {
            await this.logger.error('Error updating Landsat collections', {
                module: 'tilesApiService',
                function: 'updateLandsatCollections',
                metadata: { error: error.message }
            });
            throw error;
        }
    }

    async getSentinelCollections(req = null) {
        try {
            const config = await this.createRequestConfig({}, req);
            const response = await this.client.get(this.config.endpoints.visParamsSentinelCollections, config);
            return response.data;
        } catch (error) {
            await this.logger.error('Error fetching Sentinel collections', {
                module: 'tilesApiService',
                function: 'getSentinelCollections',
                metadata: { error: error.message }
            });
            throw error;
        }
    }

    async updateSentinelCollections(data, req = null) {
        try {
            const config = await this.createRequestConfig(data, req);
            const response = await this.client.put(this.config.endpoints.visParamsSentinelCollections, data, config);
            return response.data;
        } catch (error) {
            await this.logger.error('Error updating Sentinel collections', {
                module: 'tilesApiService',
                function: 'updateSentinelCollections',
                metadata: { error: error.message }
            });
            throw error;
        }
    }

    async initializeSentinelCollections(req = null) {
        try {
            const config = await this.createRequestConfig({}, req);
            const response = await this.client.post(this.config.endpoints.visParamsSentinelInitialize, {}, config);
            return response.data;
        } catch (error) {
            await this.logger.error('Error initializing Sentinel collections', {
                module: 'tilesApiService',
                function: 'initializeSentinelCollections',
                metadata: { error: error.message }
            });
            throw error;
        }
    }

    async getSentinelBands(collectionName, req = null) {
        try {
            const url = this.buildUrl(this.config.endpoints.visParamsSentinelBands, { collection_name: collectionName });
            const config = await this.createRequestConfig({}, req);
            const response = await this.client.get(url, config);
            return response.data;
        } catch (error) {
            await this.logger.error('Error fetching Sentinel bands', {
                module: 'tilesApiService',
                function: 'getSentinelBands',
                metadata: { error: error.message, collectionName }
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
