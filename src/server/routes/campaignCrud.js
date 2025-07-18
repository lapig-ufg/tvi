module.exports = function (app) {
    
    var campaignCrud = app.controllers.campaignCrud;
    var errorHandler = app.middleware.errorHandler;
    var logger = app.services.logger;
    
    if (logger) {
        logger.info('Loading campaignCrud routes', {
            module: 'routes',
            function: 'campaignCrud'
        });
    }
    
    // Middleware de autenticação para super-admin
    var requireSuperAdmin = function(req, res, next) {
        if (logger) {
            logger.debug('Auth check for super-admin', {
                module: 'routes',
                function: 'requireSuperAdmin',
                metadata: {
                    url: req.url,
                    hasSession: !!req.session,
                    hasAdmin: !!(req.session && req.session.admin),
                    hasSuperAdmin: !!(req.session && req.session.admin && req.session.admin.superAdmin)
                },
                req: req
            });
        }
        
        if (req.session && req.session.admin && req.session.admin.superAdmin) {
            return next();
        }
        const authError = new Error('Super admin authentication required');
        authError.statusCode = 401;
        authError.code = 'AUTH_REQUIRED';
        return next(authError);
    };
    
    /**
     * @swagger
     * /api/admin/login:
     *   post:
     *     summary: Admin login
     *     tags: [Campaign Admin Auth]
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required:
     *               - username
     *               - password
     *             properties:
     *               username:
     *                 type: string
     *               password:
     *                 type: string
     *                 format: password
     *     responses:
     *       200:
     *         description: Login successful
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 success:
     *                   type: boolean
     *                 admin:
     *                   type: object
     *                   properties:
     *                     username:
     *                       type: string
     *                     superAdmin:
     *                       type: boolean
     *       401:
     *         description: Invalid credentials
     */
    app.post('/api/admin/login', campaignCrud.adminLogin);
    
    /**
     * @swagger
     * /api/admin/logout:
     *   post:
     *     summary: Admin logout
     *     tags: [Campaign Admin Auth]
     *     security:
     *       - sessionAuth: []
     *     responses:
     *       200:
     *         description: Logout successful
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 success:
     *                   type: boolean
     */
    app.post('/api/admin/logout', campaignCrud.adminLogout);
    
    /**
     * @swagger
     * /api/admin/check:
     *   get:
     *     summary: Check admin authentication status
     *     tags: [Campaign Admin Auth]
     *     security:
     *       - sessionAuth: []
     *     responses:
     *       200:
     *         description: Authentication status
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 authenticated:
     *                   type: boolean
     *                 admin:
     *                   type: object
     *                   properties:
     *                     username:
     *                       type: string
     *                     superAdmin:
     *                       type: boolean
     *       401:
     *         description: Not authenticated
     */
    app.get('/api/admin/check', campaignCrud.checkAdminAuth);
    
    /**
     * @swagger
     * /api/campaigns:
     *   get:
     *     summary: List all campaigns
     *     tags: [Campaign Management]
     *     security:
     *       - sessionAuth: []
     *     responses:
     *       200:
     *         description: List of campaigns
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
     *                   description:
     *                     type: string
     *                   created:
     *                     type: string
     *                     format: date-time
     *                   pointsCount:
     *                     type: number
     *       401:
     *         description: Unauthorized - Super admin required
     */
    app.get('/api/campaigns', requireSuperAdmin, campaignCrud.list);
    
    /**
     * @swagger
     * /api/campaigns/{id}:
     *   get:
     *     summary: Get campaign by ID (public access)
     *     tags: [Campaign Management]
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema:
     *           type: string
     *         description: Campaign ID
     *     responses:
     *       200:
     *         description: Campaign details
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 _id:
     *                   type: string
     *                 name:
     *                   type: string
     *                 description:
     *                   type: string
     *                 classes:
     *                   type: array
     *                   items:
     *                     type: object
     *       404:
     *         description: Campaign not found
     */
    app.get('/api/campaigns/:id', campaignCrud.get); // Acesso público para leitura
    
    /**
     * @swagger
     * /api/campaigns/{id}/details:
     *   get:
     *     summary: Get detailed campaign information
     *     tags: [Campaign Management]
     *     security:
     *       - sessionAuth: []
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema:
     *           type: string
     *         description: Campaign ID
     *     responses:
     *       200:
     *         description: Detailed campaign information
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 _id:
     *                   type: string
     *                 name:
     *                   type: string
     *                 description:
     *                   type: string
     *                 created:
     *                   type: string
     *                   format: date-time
     *                 pointsCount:
     *                   type: number
     *                 inspectedCount:
     *                   type: number
     *                 classes:
     *                   type: array
     *                 config:
     *                   type: object
     *       401:
     *         description: Unauthorized - Super admin required
     *       404:
     *         description: Campaign not found
     */
    app.get('/api/campaigns/:id/details', requireSuperAdmin, campaignCrud.getDetails);
    
    /**
     * @swagger
     * /api/campaigns:
     *   post:
     *     summary: Create new campaign
     *     tags: [Campaign Management]
     *     security:
     *       - sessionAuth: []
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required:
     *               - name
     *               - classes
     *             properties:
     *               name:
     *                 type: string
     *               description:
     *                 type: string
     *               classes:
     *                 type: array
     *                 items:
     *                   type: object
     *                   properties:
     *                     id:
     *                       type: string
     *                     name:
     *                       type: string
     *                     color:
     *                       type: string
     *               config:
     *                 type: object
     *     responses:
     *       201:
     *         description: Campaign created successfully
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 _id:
     *                   type: string
     *                 name:
     *                   type: string
     *       400:
     *         description: Invalid campaign data
     *       401:
     *         description: Unauthorized - Super admin required
     */
    app.post('/api/campaigns', requireSuperAdmin, campaignCrud.create);
    
    /**
     * @swagger
     * /api/campaigns/{id}:
     *   put:
     *     summary: Update campaign
     *     tags: [Campaign Management]
     *     security:
     *       - sessionAuth: []
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema:
     *           type: string
     *         description: Campaign ID
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             properties:
     *               name:
     *                 type: string
     *               description:
     *                 type: string
     *               classes:
     *                 type: array
     *               config:
     *                 type: object
     *     responses:
     *       200:
     *         description: Campaign updated successfully
     *       400:
     *         description: Invalid update data
     *       401:
     *         description: Unauthorized - Super admin required
     *       404:
     *         description: Campaign not found
     */
    app.put('/api/campaigns/:id', requireSuperAdmin, campaignCrud.update);
    
    /**
     * @swagger
     * /api/campaigns/{id}:
     *   delete:
     *     summary: Delete campaign
     *     tags: [Campaign Management]
     *     security:
     *       - sessionAuth: []
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema:
     *           type: string
     *         description: Campaign ID
     *     responses:
     *       200:
     *         description: Campaign deleted successfully
     *       401:
     *         description: Unauthorized - Super admin required
     *       404:
     *         description: Campaign not found
     */
    app.delete('/api/campaigns/:id', requireSuperAdmin, campaignCrud.delete);
    
    /**
     * @swagger
     * /api/campaigns/upload-geojson:
     *   post:
     *     summary: Upload GeoJSON file with points for campaign
     *     tags: [Campaign Points]
     *     security:
     *       - sessionAuth: []
     *     requestBody:
     *       required: true
     *       content:
     *         multipart/form-data:
     *           schema:
     *             type: object
     *             required:
     *               - campaignId
     *               - file
     *             properties:
     *               campaignId:
     *                 type: string
     *                 description: Campaign ID
     *               file:
     *                 type: string
     *                 format: binary
     *                 description: GeoJSON file
     *               clearExisting:
     *                 type: boolean
     *                 description: Clear existing points before upload
     *     responses:
     *       200:
     *         description: Points uploaded successfully
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 success:
     *                   type: boolean
     *                 pointsAdded:
     *                   type: number
     *                 totalPoints:
     *                   type: number
     *       400:
     *         description: Invalid GeoJSON or campaign ID
     *       401:
     *         description: Unauthorized - Super admin required
     */
    // Rotas para gerenciar pontos - protegidas por autenticação de super-admin
    // Usando asyncHandler para capturar erros assíncronos
    if (logger) {
        logger.info('Registering route POST /api/campaigns/upload-geojson', {
            module: 'routes',
            function: 'campaignCrud'
        });
    }
    app.post('/api/campaigns/upload-geojson', 
        requireSuperAdmin, 
        errorHandler.asyncHandler(campaignCrud.uploadGeoJSON)
    );
    
    /**
     * @swagger
     * /api/campaigns/{id}/points:
     *   get:
     *     summary: List points for a campaign
     *     tags: [Campaign Points]
     *     security:
     *       - sessionAuth: []
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema:
     *           type: string
     *         description: Campaign ID
     *       - in: query
     *         name: page
     *         schema:
     *           type: number
     *           default: 1
     *       - in: query
     *         name: limit
     *         schema:
     *           type: number
     *           default: 100
     *       - in: query
     *         name: filters
     *         schema:
     *           type: object
     *         description: Filter criteria
     *     responses:
     *       200:
     *         description: Campaign points list
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 points:
     *                   type: array
     *                   items:
     *                     type: object
     *                 total:
     *                   type: number
     *                 page:
     *                   type: number
     *                 pages:
     *                   type: number
     *       401:
     *         description: Unauthorized - Super admin required
     */
    app.get('/api/campaigns/:id/points', requireSuperAdmin, campaignCrud.listPoints);
    
    /**
     * @swagger
     * /api/campaigns/{id}/points:
     *   delete:
     *     summary: Delete all points from a campaign
     *     tags: [Campaign Points]
     *     security:
     *       - sessionAuth: []
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema:
     *           type: string
     *         description: Campaign ID
     *     responses:
     *       200:
     *         description: Points deleted successfully
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 success:
     *                   type: boolean
     *                 deletedCount:
     *                   type: number
     *       401:
     *         description: Unauthorized - Super admin required
     *       404:
     *         description: Campaign not found
     */
    app.delete('/api/campaigns/:id/points', requireSuperAdmin, campaignCrud.deletePoints);
    
    /**
     * @swagger
     * /api/campaigns/{id}/properties:
     *   get:
     *     summary: Get available properties from campaign points
     *     tags: [Campaign Points]
     *     security:
     *       - sessionAuth: []
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema:
     *           type: string
     *         description: Campaign ID
     *     responses:
     *       200:
     *         description: List of available properties
     *         content:
     *           application/json:
     *             schema:
     *               type: array
     *               items:
     *                 type: string
     *       401:
     *         description: Unauthorized - Super admin required
     *       404:
     *         description: Campaign not found
     */
    app.get('/api/campaigns/:id/properties', requireSuperAdmin, campaignCrud.getAvailableProperties);
    
    /**
     * @swagger
     * /api/campaigns/{id}/aggregate-property:
     *   get:
     *     summary: Aggregate data by a specific property
     *     tags: [Campaign Points]
     *     security:
     *       - sessionAuth: []
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema:
     *           type: string
     *         description: Campaign ID
     *       - in: query
     *         name: property
     *         required: true
     *         schema:
     *           type: string
     *         description: Property name to aggregate by
     *     responses:
     *       200:
     *         description: Aggregated data
     *         content:
     *           application/json:
     *             schema:
     *               type: array
     *               items:
     *                 type: object
     *                 properties:
     *                   _id:
     *                     type: string
     *                   count:
     *                     type: number
     *       400:
     *         description: Missing property parameter
     *       401:
     *         description: Unauthorized - Super admin required
     *       404:
     *         description: Campaign not found
     */
    app.get('/api/campaigns/:id/aggregate-property', requireSuperAdmin, campaignCrud.aggregatePropertyData);
};