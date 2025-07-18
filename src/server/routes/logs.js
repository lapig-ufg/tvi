module.exports = function(app) {
    const logController = app.controllers.logController;
    
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
     * /api/admin/logs:
     *   get:
     *     summary: Get system logs with pagination and filters
     *     tags: [Logs Management]
     *     security:
     *       - sessionAuth: []
     *     parameters:
     *       - in: query
     *         name: page
     *         schema:
     *           type: number
     *           default: 1
     *         description: Page number
     *       - in: query
     *         name: limit
     *         schema:
     *           type: number
     *           default: 50
     *         description: Items per page
     *       - in: query
     *         name: level
     *         schema:
     *           type: string
     *           enum: [error, warn, info, debug]
     *         description: Filter by log level
     *       - in: query
     *         name: module
     *         schema:
     *           type: string
     *         description: Filter by module
     *       - in: query
     *         name: startDate
     *         schema:
     *           type: string
     *           format: date-time
     *         description: Start date for filtering
     *       - in: query
     *         name: endDate
     *         schema:
     *           type: string
     *           format: date-time
     *         description: End date for filtering
     *     responses:
     *       200:
     *         description: List of logs
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 logs:
     *                   type: array
     *                   items:
     *                     type: object
     *                     properties:
     *                       _id:
     *                         type: string
     *                       timestamp:
     *                         type: string
     *                         format: date-time
     *                       level:
     *                         type: string
     *                       module:
     *                         type: string
     *                       message:
     *                         type: string
     *                       metadata:
     *                         type: object
     *                 total:
     *                   type: number
     *                 page:
     *                   type: number
     *                 pages:
     *                   type: number
     *       401:
     *         description: Unauthorized - Admin access required
     */
    app.get('/api/admin/logs', checkAdminAuth, logController.getLogs);
    /**
     * @swagger
     * /api/admin/logs/stats:
     *   get:
     *     summary: Get log statistics
     *     tags: [Logs Management]
     *     security:
     *       - sessionAuth: []
     *     parameters:
     *       - in: query
     *         name: period
     *         schema:
     *           type: string
     *           enum: [hour, day, week, month]
     *           default: day
     *         description: Statistics period
     *     responses:
     *       200:
     *         description: Log statistics
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 totalLogs:
     *                   type: number
     *                 byLevel:
     *                   type: object
     *                   properties:
     *                     error:
     *                       type: number
     *                     warn:
     *                       type: number
     *                     info:
     *                       type: number
     *                     debug:
     *                       type: number
     *                 byModule:
     *                   type: object
     *                 timeline:
     *                   type: array
     *                   items:
     *                     type: object
     *                     properties:
     *                       date:
     *                         type: string
     *                       count:
     *                         type: number
     *       401:
     *         description: Unauthorized - Admin access required
     */
    app.get('/api/admin/logs/stats', checkAdminAuth, logController.getLogStats);
    /**
     * @swagger
     * /api/admin/logs/{logId}:
     *   get:
     *     summary: Get specific log entry by ID
     *     tags: [Logs Management]
     *     security:
     *       - sessionAuth: []
     *     parameters:
     *       - in: path
     *         name: logId
     *         required: true
     *         schema:
     *           type: string
     *         description: Log entry ID
     *     responses:
     *       200:
     *         description: Log entry details
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 _id:
     *                   type: string
     *                 timestamp:
     *                   type: string
     *                   format: date-time
     *                 level:
     *                   type: string
     *                 module:
     *                   type: string
     *                 function:
     *                   type: string
     *                 message:
     *                   type: string
     *                 metadata:
     *                   type: object
     *                 stack:
     *                   type: string
     *                 userInfo:
     *                   type: object
     *       401:
     *         description: Unauthorized - Admin access required
     *       404:
     *         description: Log entry not found
     */
    app.get('/api/admin/logs/:logId', checkAdminAuth, logController.getLogById);
    /**
     * @swagger
     * /api/admin/logs/cleanup:
     *   post:
     *     summary: Clean up old logs
     *     tags: [Logs Management]
     *     security:
     *       - sessionAuth: []
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             properties:
     *               daysToKeep:
     *                 type: number
     *                 description: Number of days to keep logs
     *                 default: 30
     *               level:
     *                 type: string
     *                 enum: [error, warn, info, debug]
     *                 description: Clean only specific level logs
     *               dryRun:
     *                 type: boolean
     *                 description: Simulate cleanup without deleting
     *                 default: false
     *     responses:
     *       200:
     *         description: Cleanup completed
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 success:
     *                   type: boolean
     *                 deletedCount:
     *                   type: number
     *                 message:
     *                   type: string
     *       401:
     *         description: Unauthorized - Admin access required
     *       500:
     *         description: Cleanup failed
     */
    app.post('/api/admin/logs/cleanup', checkAdminAuth, logController.cleanupLogs);
    /**
     * @swagger
     * /api/admin/logs/test:
     *   post:
     *     summary: Create test log entry
     *     tags: [Logs Management]
     *     security:
     *       - sessionAuth: []
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             properties:
     *               level:
     *                 type: string
     *                 enum: [error, warn, info, debug]
     *                 default: info
     *               message:
     *                 type: string
     *                 default: Test log message
     *               metadata:
     *                 type: object
     *     responses:
     *       200:
     *         description: Test log created
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 success:
     *                   type: boolean
     *                 logId:
     *                   type: string
     *       401:
     *         description: Unauthorized - Admin access required
     */
    app.post('/api/admin/logs/test', checkAdminAuth, logController.testLog);
};