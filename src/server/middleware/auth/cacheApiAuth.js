const crypto = require('crypto');

module.exports = function (app) {
    const auth = {};
    
    // Defer collection access until runtime
    const getUsersCollection = () => app.repository && app.repository.collections && app.repository.collections.users;
    const getLogger = () => app.services && app.services.logger;

    /**
     * SHA256 hash function
     */
    function sha256(text) {
        return crypto.createHash('sha256').update(text).digest('hex');
    }

    /**
     * Extract credentials from Authorization header
     */
    function parseAuthHeader(authHeader) {
        if (!authHeader || !authHeader.startsWith('Basic ')) {
            return null;
        }

        const base64Credentials = authHeader.slice('Basic '.length);
        const credentials = Buffer.from(base64Credentials, 'base64').toString('ascii');
        const [username, password] = credentials.split(':');

        return { username, password };
    }

    /**
     * Verify user credentials against MongoDB
     */
    async function verifyCredentials(username, password) {
        try {
            const usersCollection = getUsersCollection();
            if (!usersCollection) {
                return { valid: false, reason: 'Database not initialized' };
            }
            
            // Find user by email (username)
            const user = await usersCollection.findOne({ 
                email: username,
                active: { $ne: false } // User must be active
            });

            if (!user) {
                return { valid: false, reason: 'User not found' };
            }

            // Check if user has super-admin role or admin type
            const hasPermission = user.role === 'super-admin' || user.type === 'admin';
            if (!hasPermission) {
                return { valid: false, reason: 'Insufficient permissions' };
            }

            // Verify password - check both plain text and SHA256
            const passwordValid = user.password === password || user.password === sha256(password);
            
            if (!passwordValid) {
                return { valid: false, reason: 'Invalid password' };
            }

            return { 
                valid: true, 
                user: {
                    id: user._id,
                    email: user.email,
                    role: user.role,
                    type: user.type,
                    password: password,  // Store raw password for API authentication
                    rawPassword: password // Also store as rawPassword for compatibility
                }
            };
        } catch (error) {
            const logger = getLogger();
            if (logger) {
                await logger.error('Error verifying credentials', {
                    module: 'cacheApiAuth',
                    function: 'verifyCredentials',
                    metadata: { error: error.message, username }
                });
            }
            return { valid: false, reason: 'Database error' };
        }
    }

    /**
     * Middleware for authenticating cache API endpoints
     * Supports both Basic Auth headers and admin session authentication
     */
    auth.requireCacheApiAuth = async function (req, res, next) {
        const authHeader = req.headers.authorization;
        const logger = getLogger();
        
        // Debug log for vis-params requests (without sensitive data)
        if (req.url && req.url.includes('vis-params') && logger) {
            await logger.debug('Auth middleware processing vis-params request', {
                module: 'cacheApiAuth',
                function: 'requireCacheApiAuth',
                metadata: {
                    url: req.url,
                    method: req.method,
                    hasAuthHeader: !!authHeader,
                    hasSession: !!req.session
                }
            });
        }

        // First, try Basic Auth if header is present
        if (authHeader) {
            const credentials = parseAuthHeader(authHeader);
            if (credentials) {
                const verification = await verifyCredentials(credentials.username, credentials.password);
                
                if (verification.valid) {
                    req.authenticatedUser = verification.user;
                    
                    if (logger) {
                        await logger.info('User authenticated via Basic Auth for cache API access', {
                            module: 'cacheApiAuth',
                            function: 'requireCacheApiAuth',
                            metadata: { 
                                userId: verification.user.id,
                                email: verification.user.email,
                                role: verification.user.role,
                                method: 'basic_auth'
                            },
                            req: req
                        });
                    }
                    
                    return next();
                }
            }
        }

        // If Basic Auth failed or not present, try session authentication
        // First try super-admin session
        if (req.session && req.session.admin && req.session.admin.superAdmin) {
            const superAdmin = req.session.admin.superAdmin;
            
            try {
                const usersCollection = getUsersCollection();
                if (!usersCollection) {
                    if (logger) {
                        await logger.error('Database not initialized for session auth', {
                            module: 'cacheApiAuth',
                            function: 'requireCacheApiAuth',
                            req: req
                        });
                    }
                    return res.status(500).json({
                        error: 'Internal server error',
                        details: 'Database not initialized'
                    });
                }
                
                // Try to find user by different fields
                let user = null;
                
                if (superAdmin.username) {
                    user = await usersCollection.findOne({ 
                        username: superAdmin.username,
                        role: 'super-admin',
                        active: { $ne: false }
                    });
                }
                
                if (!user && superAdmin.email) {
                    user = await usersCollection.findOne({ 
                        email: superAdmin.email,
                        role: 'super-admin',
                        active: { $ne: false }
                    });
                }
                
                if (!user && superAdmin.id) {
                    user = await usersCollection.findOne({ 
                        _id: superAdmin.id,
                        role: 'super-admin',
                        active: { $ne: false }
                    });
                }
                
                if (user) {
                    req.authenticatedUser = {
                        id: user._id,
                        email: user.email,
                        username: user.username,
                        role: user.role,
                        type: user.type,
                        password: superAdmin.password || user.password, // Use session password first, fallback to DB
                        rawPassword: superAdmin.password || user.password // Also store as rawPassword for compatibility
                    };
                    
                    if (logger) {
                        await logger.debug('User authenticated via session', {
                            module: 'cacheApiAuth',
                            function: 'requireCacheApiAuth',
                            metadata: { 
                                userId: user._id,
                                role: user.role,
                                method: 'session'
                            },
                            req: req
                        });
                    }
                    
                    return next();
                } else {
                    if (logger) {
                        await logger.warn('Session user not found in database', {
                            module: 'cacheApiAuth',
                            function: 'requireCacheApiAuth',
                            metadata: { 
                                hasSession: true
                            },
                            req: req
                        });
                    }
                }
            } catch (error) {
                if (logger) {
                    await logger.error('Error during session authentication', {
                        module: 'cacheApiAuth',
                        function: 'requireCacheApiAuth',
                        metadata: { error: error.message },
                        req: req
                    });
                }
            }
        }
        
        // Also try regular user session for supervisors
        if (req.session && req.session.user && req.session.user.type === 'supervisor') {
            const supervisor = req.session.user;
            
            try {
                const usersCollection = getUsersCollection();
                if (!usersCollection) {
                    if (logger) {
                        await logger.error('Database not initialized for supervisor session auth', {
                            module: 'cacheApiAuth',
                            function: 'requireCacheApiAuth',
                            req: req
                        });
                    }
                    return res.status(500).json({
                        error: 'Internal server error',
                        details: 'Database not initialized'
                    });
                }
                
                // Find the admin user to get credentials for API calls
                const adminUser = await usersCollection.findOne({ _id: 'admin' });
                
                if (adminUser && supervisor.name === 'admin') {
                    req.authenticatedUser = {
                        id: 'admin',
                        email: adminUser.email || 'admin@lapig.iesa.ufg.br',
                        username: 'admin',
                        role: 'supervisor',
                        type: 'supervisor',
                        password: adminUser.password // Store for tiles API calls
                    };
                    
                    if (logger) {
                        await logger.info('Supervisor authenticated via regular session for cache API access', {
                            module: 'cacheApiAuth',
                            function: 'requireCacheApiAuth',
                            metadata: { 
                                userId: 'admin',
                                userType: supervisor.type,
                                method: 'regular_session'
                            },
                            req: req
                        });
                    }
                    
                    return next();
                }
            } catch (error) {
                if (logger) {
                    await logger.error('Error during supervisor session authentication', {
                        module: 'cacheApiAuth',
                        function: 'requireCacheApiAuth',
                        metadata: { error: error.message },
                        req: req
                    });
                }
            }
        }

        // If both Basic Auth and session auth failed
        if (logger) {
            await logger.warn('Authentication required - no valid auth method found', {
                module: 'cacheApiAuth',
                function: 'requireCacheApiAuth',
                metadata: { 
                    hasAuthHeader: !!authHeader,
                    hasSession: !!(req.session),
                    hasAdminSession: !!(req.session && req.session.admin),
                    hasSuperAdminSession: !!(req.session && req.session.admin && req.session.admin.superAdmin),
                    hasUserSession: !!(req.session && req.session.user),
                    userType: req.session && req.session.user && req.session.user.type
                },
                req: req
            });
        }

        return res.status(401).json({
            error: 'Authentication required',
            details: 'Missing or invalid Authorization header or admin session'
        });
    };

    /**
     * Middleware for optional authentication (logs user if authenticated)
     */
    auth.optionalCacheApiAuth = async function (req, res, next) {
        const authHeader = req.headers.authorization;

        if (authHeader) {
            const credentials = parseAuthHeader(authHeader);
            if (credentials) {
                const verification = await verifyCredentials(credentials.username, credentials.password);
                if (verification.valid) {
                    req.authenticatedUser = verification.user;
                }
            }
        }

        next();
    };

    /**
     * Helper function to check if request is authenticated
     */
    auth.isAuthenticated = function (req) {
        return !!req.authenticatedUser;
    };

    /**
     * Helper function to check if user has specific role
     */
    auth.hasRole = function (req, role) {
        return req.authenticatedUser && req.authenticatedUser.role === role;
    };

    /**
     * Helper function to check if user has specific type
     */
    auth.hasType = function (req, type) {
        return req.authenticatedUser && req.authenticatedUser.type === type;
    };

    return auth;
};