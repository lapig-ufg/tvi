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
                    password: password  // Store raw password for API authentication
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
     */
    auth.requireCacheApiAuth = async function (req, res, next) {
        const authHeader = req.headers.authorization;

        // Parse credentials
        const credentials = parseAuthHeader(authHeader);
        if (!credentials) {
            return res.status(401).json({
                error: 'Authentication required',
                details: 'Missing or invalid Authorization header'
            });
        }

        // Verify credentials
        const verification = await verifyCredentials(credentials.username, credentials.password);
        
        if (!verification.valid) {
            const logger = getLogger();
            if (logger) {
                await logger.warn('Authentication failed', {
                    module: 'cacheApiAuth',
                    function: 'requireCacheApiAuth',
                    metadata: { 
                        username: credentials.username,
                        reason: verification.reason 
                    },
                    req: req
                });
            }
            return res.status(401).json({
                error: 'Authentication failed',
                details: verification.reason
            });
        }

        // Attach user to request for use in routes
        req.authenticatedUser = verification.user;
        
        // Log successful authentication
        const logger = getLogger();
        if (logger) {
            await logger.info('User authenticated for cache API access', {
                module: 'cacheApiAuth',
                function: 'requireCacheApiAuth',
                metadata: { 
                    userId: verification.user.id,
                    email: verification.user.email,
                    role: verification.user.role
                },
                req: req
            });
        }
        
        next();
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