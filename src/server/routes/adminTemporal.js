module.exports = function (app) {
    
    var points = app.controllers.points;
    var timeseries = app.controllers.timeseries;
    var dashboard = app.controllers.dashboard;
    var supervisor = app.controllers.supervisor;
    var image = app.controllers.image;
    var capabilities = app.controllers.capabilities;
    
    // Middleware de autenticação para admin
    var checkAdminAuth = function(req, res, next) {
        // Por enquanto, permitir acesso sem autenticação para admin-temporal
        // TODO: Implementar autenticação específica para admin se necessário
        return next();
    };
    
    /**
     * @swagger
     * /service/admin/points/{pointId}:
     *   get:
     *     summary: Get point by ID for admin
     *     tags: [Admin Temporal]
     *     parameters:
     *       - in: path
     *         name: pointId
     *         required: true
     *         schema:
     *           type: string
     *         description: Point identifier
     *     responses:
     *       200:
     *         description: Point details
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Point'
     *       404:
     *         description: Point not found
     */
    app.get('/service/admin/points/:pointId', checkAdminAuth, points.getPointByIdAdmin);
    
    /**
     * @swagger
     * /service/admin/points/get-point:
     *   post:
     *     summary: Get point by filter for admin
     *     tags: [Admin Temporal]
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             properties:
     *               campaign:
     *                 type: string
     *               index:
     *                 type: number
     *               filters:
     *                 type: object
     *     responses:
     *       200:
     *         description: Point data matching filters
     *       400:
     *         description: Invalid filters
     */
    app.post('/service/admin/points/get-point', checkAdminAuth, points.getPointByFilterAdmin);
    
    /**
     * @swagger
     * /service/admin/points/landUses:
     *   get:
     *     summary: Get land use classes for admin
     *     tags: [Admin Temporal]
     *     parameters:
     *       - in: query
     *         name: campaign
     *         schema:
     *           type: string
     *         description: Campaign identifier
     *     responses:
     *       200:
     *         description: List of land use classes
     *         content:
     *           application/json:
     *             schema:
     *               type: array
     *               items:
     *                 type: object
     *                 properties:
     *                   id:
     *                     type: string
     *                   name:
     *                     type: string
     */
    app.get('/service/admin/points/landUses', checkAdminAuth, points.getLandUsesAdmin);
    
    /**
     * @swagger
     * /service/admin/points/users:
     *   get:
     *     summary: Get users list for admin
     *     tags: [Admin Temporal]
     *     parameters:
     *       - in: query
     *         name: campaign
     *         schema:
     *           type: string
     *         description: Campaign identifier
     *     responses:
     *       200:
     *         description: List of users
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
     *                   email:
     *                     type: string
     */
    app.get('/service/admin/points/users', checkAdminAuth, points.getUsersAdmin);
    
    /**
     * @swagger
     * /service/admin/points/biome:
     *   get:
     *     summary: Get biomes list for admin
     *     tags: [Admin Temporal]
     *     parameters:
     *       - in: query
     *         name: campaign
     *         schema:
     *           type: string
     *         description: Campaign identifier
     *     responses:
     *       200:
     *         description: List of biomes
     *         content:
     *           application/json:
     *             schema:
     *               type: array
     *               items:
     *                 type: object
     *                 properties:
     *                   id:
     *                     type: string
     *                   name:
     *                     type: string
     */
    app.get('/service/admin/points/biome', checkAdminAuth, points.getBiomesAdmin);
    
    /**
     * @swagger
     * /service/admin/points/uf:
     *   get:
     *     summary: Get states (UF) list for admin
     *     tags: [Admin Temporal]
     *     parameters:
     *       - in: query
     *         name: campaign
     *         schema:
     *           type: string
     *         description: Campaign identifier
     *     responses:
     *       200:
     *         description: List of states
     *         content:
     *           application/json:
     *             schema:
     *               type: array
     *               items:
     *                 type: object
     *                 properties:
     *                   id:
     *                     type: string
     *                   name:
     *                     type: string
     */
    app.get('/service/admin/points/uf', checkAdminAuth, points.getUfsAdmin);
    
    /**
     * @swagger
     * /service/admin/points/next-point:
     *   post:
     *     summary: Get next point for admin inspection
     *     tags: [Admin Temporal]
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             properties:
     *               campaign:
     *                 type: string
     *               filters:
     *                 type: object
     *     responses:
     *       200:
     *         description: Next point data
     *       404:
     *         description: No more points available
     */
    app.post('/service/admin/points/next-point', checkAdminAuth, points.getNextPointAdmin);
    
    /**
     * @swagger
     * /service/admin/points/get-point-by-id:
     *   post:
     *     summary: Get point by ID service for admin
     *     tags: [Admin Temporal]
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required:
     *               - pointId
     *             properties:
     *               pointId:
     *                 type: string
     *     responses:
     *       200:
     *         description: Point details
     *       404:
     *         description: Point not found
     */
    app.post('/service/admin/points/get-point-by-id', checkAdminAuth, points.getPointByIdServiceAdmin);
    
    /**
     * @swagger
     * /service/admin/points/updatedClassConsolidated:
     *   post:
     *     summary: Update consolidated classification for admin
     *     tags: [Admin Temporal]
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required:
     *               - pointId
     *               - classConsolidated
     *             properties:
     *               pointId:
     *                 type: string
     *               classConsolidated:
     *                 type: string
     *               campaign:
     *                 type: string
     *     responses:
     *       200:
     *         description: Classification updated
     *       400:
     *         description: Invalid data
     */
    app.post('/service/admin/points/updatedClassConsolidated', checkAdminAuth, points.updateClassConsolidatedAdmin);
    
    /**
     * @swagger
     * /service/admin/timeseries/landsat/ndvi:
     *   get:
     *     summary: Get Landsat NDVI time series for admin
     *     tags: [Admin Temporal]
     *     parameters:
     *       - in: query
     *         name: lon
     *         required: true
     *         schema:
     *           type: number
     *         description: Longitude
     *       - in: query
     *         name: lat
     *         required: true
     *         schema:
     *           type: number
     *         description: Latitude
     *       - in: query
     *         name: startDate
     *         schema:
     *           type: string
     *           format: date
     *       - in: query
     *         name: endDate
     *         schema:
     *           type: string
     *           format: date
     *     responses:
     *       200:
     *         description: NDVI time series data
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 timeseries:
     *                   type: array
     *                   items:
     *                     type: object
     *                     properties:
     *                       date:
     *                         type: string
     *                       ndvi:
     *                         type: number
     */
    app.get('/service/admin/timeseries/landsat/ndvi', checkAdminAuth, timeseries.getTimeSeriesLandsatNdviByLonLatAdmin);
    
    /**
     * @swagger
     * /service/admin/timeseries/nddi:
     *   get:
     *     summary: Get NDDI time series for admin
     *     tags: [Admin Temporal]
     *     parameters:
     *       - in: query
     *         name: lon
     *         required: true
     *         schema:
     *           type: number
     *         description: Longitude
     *       - in: query
     *         name: lat
     *         required: true
     *         schema:
     *           type: number
     *         description: Latitude
     *       - in: query
     *         name: startDate
     *         schema:
     *           type: string
     *           format: date
     *       - in: query
     *         name: endDate
     *         schema:
     *           type: string
     *           format: date
     *     responses:
     *       200:
     *         description: NDDI time series data
     */
    app.get('/service/admin/timeseries/nddi', checkAdminAuth, timeseries.getTimeSeriesLandsatNDDIByLonLatAdmin);
    
    /**
     * @swagger
     * /service/admin/dashboard/points-inspection:
     *   get:
     *     summary: Get points inspection summary for admin
     *     tags: [Admin Temporal]
     *     parameters:
     *       - in: query
     *         name: campaign
     *         schema:
     *           type: string
     *         description: Campaign identifier
     *     responses:
     *       200:
     *         description: Points inspection summary
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 totalPoints:
     *                   type: number
     *                 inspectedPoints:
     *                   type: number
     *                 progress:
     *                   type: number
     */
    app.get('/service/admin/dashboard/points-inspection', checkAdminAuth, dashboard.pointsInspectionAdmin);
    
    /**
     * @swagger
     * /service/admin/spatial/precipitation:
     *   get:
     *     summary: Get precipitation data for admin
     *     tags: [Admin Temporal]
     *     parameters:
     *       - in: query
     *         name: lon
     *         schema:
     *           type: number
     *       - in: query
     *         name: lat
     *         schema:
     *           type: number
     *     responses:
     *       200:
     *         description: Precipitation data
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 precipitation:
     *                   type: array
     *                 success:
     *                   type: boolean
     */
    app.get('/service/admin/spatial/precipitation', checkAdminAuth, function(req, res) {
        // Retorna dados de precipitação para admin
        res.json({
            precipitation: [],
            success: true
        });
    });
    
    /**
     * @swagger
     * /service/admin/time-series/MOD13Q1_NDVI:
     *   get:
     *     summary: Get MODIS NDVI time series for admin
     *     tags: [Admin Temporal]
     *     parameters:
     *       - in: query
     *         name: lon
     *         schema:
     *           type: number
     *       - in: query
     *         name: lat
     *         schema:
     *           type: number
     *     responses:
     *       200:
     *         description: MODIS NDVI time series
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 timeseries:
     *                   type: array
     *                 success:
     *                   type: boolean
     */
    app.get('/service/admin/time-series/MOD13Q1_NDVI', checkAdminAuth, function(req, res) {
        // Retorna dados MODIS NDVI para admin
        res.json({
            timeseries: [],
            success: true
        });
    });
    
    /**
     * @swagger
     * /service/admin/campaign/config:
     *   get:
     *     summary: Get campaign configuration for admin
     *     tags: [Admin Temporal]
     *     parameters:
     *       - in: query
     *         name: campaign
     *         required: true
     *         schema:
     *           type: string
     *         description: Campaign identifier
     *     responses:
     *       200:
     *         description: Campaign configuration
     *       404:
     *         description: Campaign not found
     */
    app.get('/service/admin/campaign/config', checkAdminAuth, supervisor.getCampaignConfigAdmin);
    
    /**
     * @swagger
     * /service/admin/campaign/correct:
     *   get:
     *     summary: Correct campaign data for admin
     *     tags: [Admin Temporal]
     *     parameters:
     *       - in: query
     *         name: campaign
     *         required: true
     *         schema:
     *           type: string
     *         description: Campaign identifier
     *     responses:
     *       200:
     *         description: Campaign corrected
     *       500:
     *         description: Correction failed
     */
    app.get('/service/admin/campaign/correct', checkAdminAuth, supervisor.correctCampaignAdmin);
    
    /**
     * @swagger
     * /service/admin/campaign/removeInspections:
     *   get:
     *     summary: Remove inspections for admin
     *     tags: [Admin Temporal]
     *     parameters:
     *       - in: query
     *         name: campaign
     *         required: true
     *         schema:
     *           type: string
     *         description: Campaign identifier
     *       - in: query
     *         name: confirm
     *         required: true
     *         schema:
     *           type: boolean
     *         description: Confirmation flag
     *     responses:
     *       200:
     *         description: Inspections removed
     *       400:
     *         description: Missing confirmation
     */
    app.get('/service/admin/campaign/removeInspections', checkAdminAuth, supervisor.removeInspectionAdmin);
    
    // Novo endpoint unificado para admin
    app.get('/service/admin/capabilities', checkAdminAuth, capabilities.publicCapabilities);
    
    /**
     * @swagger
     * /service/admin/images/{mosaicId}:
     *   get:
     *     summary: Get mosaic image for admin
     *     tags: [Admin Temporal]
     *     parameters:
     *       - in: path
     *         name: mosaicId
     *         required: true
     *         schema:
     *           type: string
     *         description: Mosaic identifier
     *       - in: query
     *         name: bbox
     *         schema:
     *           type: string
     *         description: Bounding box coordinates
     *     responses:
     *       200:
     *         description: Image data
     *         content:
     *           image/png:
     *             schema:
     *               type: string
     *               format: binary
     */
    app.get('/service/admin/images/:mosaicId', checkAdminAuth, image.mosaicAdmin);
    
    /**
     * @swagger
     * /service/admin/images/planet/{mosaicId}:
     *   get:
     *     summary: Get Planet mosaic image for admin
     *     tags: [Admin Temporal]
     *     parameters:
     *       - in: path
     *         name: mosaicId
     *         required: true
     *         schema:
     *           type: string
     *         description: Planet mosaic identifier
     *       - in: query
     *         name: bbox
     *         schema:
     *           type: string
     *         description: Bounding box coordinates
     *     responses:
     *       200:
     *         description: Planet image data
     *         content:
     *           image/png:
     *             schema:
     *               type: string
     *               format: binary
     */
    app.get('/service/admin/images/planet/:mosaicId', checkAdminAuth, image.planetMosaicAdmin);
    
    /**
     * @swagger
     * /service/admin/images/sentinel/{date}:
     *   get:
     *     summary: Get Sentinel mosaic image for admin
     *     tags: [Admin Temporal]
     *     parameters:
     *       - in: path
     *         name: date
     *         required: true
     *         schema:
     *           type: string
     *           format: date
     *         description: Date for Sentinel image
     *       - in: query
     *         name: bbox
     *         schema:
     *           type: string
     *         description: Bounding box coordinates
     *     responses:
     *       200:
     *         description: Sentinel image data
     *         content:
     *           image/png:
     *             schema:
     *               type: string
     *               format: binary
     */
    app.get('/service/admin/images/sentinel/:date', checkAdminAuth, image.sentinelMosaicAdmin);
}