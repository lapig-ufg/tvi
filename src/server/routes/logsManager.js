module.exports = function (app) {

    var auth = function(req, res, next) {
        var token = req.session.token;
        if (token && token.ACCESS_TOKEN) {
            next();
        } else {
            res.status(403).json({ 
                error: 'Access denied',
                message: 'Authentication required' 
            });
        }
    };

    var adminAuth = function(req, res, next) {
        var admin = req.session.admin;
        if (admin && admin.active && admin.superAdmin) {
            next();
        } else {
            res.status(403).json({ 
                error: 'Access denied',
                message: 'Admin privileges required' 
            });
        }
    };

    /**
     * @swagger
     * /service/logs/statistics:
     *   get:
     *     summary: Get log statistics for monitoring
     *     tags: [Logs Service]
     *     security:
     *       - sessionAuth: []
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
     *                 errorRate:
     *                   type: number
     *                 warningRate:
     *                   type: number
     *                 averageResponseTime:
     *                   type: number
     *                 moduleStats:
     *                   type: object
     *       403:
     *         description: Access denied - Admin privileges required
     */
    app.get('/service/logs/statistics', adminAuth);
    
    /**
     * @swagger
     * /service/logs/job-status:
     *   get:
     *     summary: Get log cleanup job status
     *     tags: [Logs Service]
     *     security:
     *       - sessionAuth: []
     *     responses:
     *       200:
     *         description: Job status information
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 enabled:
     *                   type: boolean
     *                 lastRun:
     *                   type: string
     *                   format: date-time
     *                 nextRun:
     *                   type: string
     *                   format: date-time
     *                 config:
     *                   type: object
     *                   properties:
     *                     schedule:
     *                       type: string
     *                     daysToKeep:
     *                       type: number
     *       403:
     *         description: Access denied - Admin privileges required
     */
    app.get('/service/logs/job-status', adminAuth);
    
    /**
     * @swagger
     * /service/logs/job-config:
     *   put:
     *     summary: Update log cleanup job configuration
     *     tags: [Logs Service]
     *     security:
     *       - sessionAuth: []
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             properties:
     *               enabled:
     *                 type: boolean
     *               schedule:
     *                 type: string
     *                 description: Cron expression for job schedule
     *               daysToKeep:
     *                 type: number
     *                 description: Number of days to retain logs
     *               levelsToClean:
     *                 type: array
     *                 items:
     *                   type: string
     *                   enum: [error, warn, info, debug]
     *     responses:
     *       200:
     *         description: Configuration updated
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 success:
     *                   type: boolean
     *                 message:
     *                   type: string
     *       403:
     *         description: Access denied - Admin privileges required
     */
    app.put('/service/logs/job-config', adminAuth);
    
    /**
     * @swagger
     * /service/logs/trigger-job:
     *   post:
     *     summary: Manually trigger log cleanup job
     *     tags: [Logs Service]
     *     security:
     *       - sessionAuth: []
     *     requestBody:
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             properties:
     *               force:
     *                 type: boolean
     *                 description: Force job execution even if recently run
     *     responses:
     *       200:
     *         description: Job triggered successfully
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 success:
     *                   type: boolean
     *                 jobId:
     *                   type: string
     *                 message:
     *                   type: string
     *       403:
     *         description: Access denied - Admin privileges required
     */
    app.post('/service/logs/trigger-job', adminAuth);
    
    /**
     * @swagger
     * /service/logs/recent:
     *   get:
     *     summary: Get recent log entries
     *     tags: [Logs Service]
     *     security:
     *       - sessionAuth: []
     *     parameters:
     *       - in: query
     *         name: limit
     *         schema:
     *           type: number
     *           default: 100
     *         description: Number of recent logs to retrieve
     *       - in: query
     *         name: level
     *         schema:
     *           type: string
     *           enum: [error, warn, info, debug]
     *         description: Filter by log level
     *     responses:
     *       200:
     *         description: Recent log entries
     *         content:
     *           application/json:
     *             schema:
     *               type: array
     *               items:
     *                 type: object
     *                 properties:
     *                   _id:
     *                     type: string
     *                   timestamp:
     *                     type: string
     *                     format: date-time
     *                   level:
     *                     type: string
     *                   message:
     *                     type: string
     *                   module:
     *                     type: string
     *       403:
     *         description: Access denied - Admin privileges required
     */
    app.get('/service/logs/recent', adminAuth);
    
    /**
     * @swagger
     * /service/logs/{logId}:
     *   get:
     *     summary: Get specific log entry
     *     tags: [Logs Service]
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
     *                 message:
     *                   type: string
     *                 metadata:
     *                   type: object
     *                 stack:
     *                   type: string
     *       403:
     *         description: Access denied - Admin privileges required
     *       404:
     *         description: Log entry not found
     */
    app.get('/service/logs/:logId', adminAuth);
    
    /**
     * @swagger
     * /service/logs/cleanup:
     *   delete:
     *     summary: Delete logs based on criteria
     *     tags: [Logs Service]
     *     security:
     *       - sessionAuth: []
     *     parameters:
     *       - in: query
     *         name: daysOld
     *         schema:
     *           type: number
     *         description: Delete logs older than specified days
     *       - in: query
     *         name: level
     *         schema:
     *           type: string
     *           enum: [error, warn, info, debug]
     *         description: Delete only logs of specific level
     *       - in: query
     *         name: module
     *         schema:
     *           type: string
     *         description: Delete only logs from specific module
     *     responses:
     *       200:
     *         description: Logs deleted successfully
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
     *       403:
     *         description: Access denied - Admin privileges required
     */
    app.delete('/service/logs/cleanup', adminAuth);
    
    /**
     * @swagger
     * /service/logs/export:
     *   get:
     *     summary: Export logs to file
     *     tags: [Logs Service]
     *     security:
     *       - sessionAuth: []
     *     parameters:
     *       - in: query
     *         name: format
     *         schema:
     *           type: string
     *           enum: [json, csv]
     *           default: json
     *         description: Export format
     *       - in: query
     *         name: startDate
     *         schema:
     *           type: string
     *           format: date-time
     *         description: Start date for export
     *       - in: query
     *         name: endDate
     *         schema:
     *           type: string
     *           format: date-time
     *         description: End date for export
     *       - in: query
     *         name: level
     *         schema:
     *           type: string
     *           enum: [error, warn, info, debug]
     *         description: Filter by log level
     *     responses:
     *       200:
     *         description: Log export file
     *         content:
     *           application/json:
     *             schema:
     *               type: array
     *           text/csv:
     *             schema:
     *               type: string
     *       403:
     *         description: Access denied - Admin privileges required
     */
    app.get('/service/logs/export', adminAuth);

};