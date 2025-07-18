module.exports = function (app) {

	var dashboard = app.controllers.dashboard;

	/**
	 * @swagger
	 * /service/points/count/:
	 *   get:
	 *     summary: Get points count for donut charts
	 *     tags: [Dashboard]
	 *     security:
	 *       - sessionAuth: []
	 *     parameters:
	 *       - in: query
	 *         name: campaign
	 *         required: true
	 *         schema:
	 *           type: string
	 *         description: Campaign identifier
	 *     responses:
	 *       200:
	 *         description: Points count data for visualization
	 *         content:
	 *           application/json:
	 *             schema:
	 *               type: object
	 *               properties:
	 *                 total:
	 *                   type: number
	 *                 inspected:
	 *                   type: number
	 *                 byClass:
	 *                   type: object
	 *       401:
	 *         description: Unauthorized
	 *       500:
	 *         description: Server error
	 */
	app.get('/service/points/count/', dashboard.donuts);
	
	/**
	 * @swagger
	 * /service/points/horizontal1/:
	 *   get:
	 *     summary: Get data for first horizontal bar chart
	 *     tags: [Dashboard]
	 *     security:
	 *       - sessionAuth: []
	 *     parameters:
	 *       - in: query
	 *         name: campaign
	 *         required: true
	 *         schema:
	 *           type: string
	 *         description: Campaign identifier
	 *     responses:
	 *       200:
	 *         description: Horizontal bar chart data
	 *         content:
	 *           application/json:
	 *             schema:
	 *               type: array
	 *               items:
	 *                 type: object
	 *                 properties:
	 *                   label:
	 *                     type: string
	 *                   value:
	 *                     type: number
	 *       401:
	 *         description: Unauthorized
	 */
	app.get('/service/points/horizontal1/', dashboard.horizontalBar1);
	
	/**
	 * @swagger
	 * /service/points/horizontal2/:
	 *   get:
	 *     summary: Get data for second horizontal bar chart
	 *     tags: [Dashboard]
	 *     security:
	 *       - sessionAuth: []
	 *     parameters:
	 *       - in: query
	 *         name: campaign
	 *         required: true
	 *         schema:
	 *           type: string
	 *         description: Campaign identifier
	 *     responses:
	 *       200:
	 *         description: Horizontal bar chart data
	 *         content:
	 *           application/json:
	 *             schema:
	 *               type: array
	 *               items:
	 *                 type: object
	 *                 properties:
	 *                   label:
	 *                     type: string
	 *                   value:
	 *                     type: number
	 *       401:
	 *         description: Unauthorized
	 */
	app.get('/service/points/horizontal2/', dashboard.horizontalBar2)

	/**
	 * @swagger
	 * /service/dashboard/user-inspections:
	 *   get:
	 *     summary: Get user inspection statistics
	 *     tags: [Dashboard]
	 *     security:
	 *       - sessionAuth: []
	 *     parameters:
	 *       - in: query
	 *         name: campaign
	 *         required: true
	 *         schema:
	 *           type: string
	 *         description: Campaign identifier
	 *     responses:
	 *       200:
	 *         description: User inspection statistics
	 *         content:
	 *           application/json:
	 *             schema:
	 *               type: array
	 *               items:
	 *                 type: object
	 *                 properties:
	 *                   userName:
	 *                     type: string
	 *                   inspectionCount:
	 *                     type: number
	 *                   lastInspection:
	 *                     type: string
	 *                     format: date-time
	 *       401:
	 *         description: Unauthorized
	 */
	app.get('/service/dashboard/user-inspections', dashboard.userInspections);
	
	/**
	 * @swagger
	 * /service/dashboard/points-inspection:
	 *   get:
	 *     summary: Get points inspection summary
	 *     tags: [Dashboard]
	 *     security:
	 *       - sessionAuth: []
	 *     parameters:
	 *       - in: query
	 *         name: campaign
	 *         required: true
	 *         schema:
	 *           type: string
	 *         description: Campaign identifier
	 *     responses:
	 *       200:
	 *         description: Points inspection summary data
	 *         content:
	 *           application/json:
	 *             schema:
	 *               type: object
	 *               properties:
	 *                 totalPoints:
	 *                   type: number
	 *                 inspectedPoints:
	 *                   type: number
	 *                 pendingPoints:
	 *                   type: number
	 *                 inspectionProgress:
	 *                   type: number
	 *       401:
	 *         description: Unauthorized
	 */
	app.get('/service/dashboard/points-inspection', dashboard.pointsInspection);
	
	/**
	 * @swagger
	 * /service/dashboard/meanTime-inspection:
	 *   get:
	 *     summary: Get mean time for inspections
	 *     tags: [Dashboard]
	 *     security:
	 *       - sessionAuth: []
	 *     parameters:
	 *       - in: query
	 *         name: campaign
	 *         required: true
	 *         schema:
	 *           type: string
	 *         description: Campaign identifier
	 *     responses:
	 *       200:
	 *         description: Mean inspection time statistics
	 *         content:
	 *           application/json:
	 *             schema:
	 *               type: object
	 *               properties:
	 *                 meanTimeSeconds:
	 *                   type: number
	 *                 meanTimeFormatted:
	 *                   type: string
	 *                 totalInspections:
	 *                   type: number
	 *       401:
	 *         description: Unauthorized
	 */
	app.get('/service/dashboard/meanTime-inspection', dashboard.meanTimeInsp);
	
	/**
	 * @swagger
	 * /service/dashboard/cachedPoints-inspection:
	 *   get:
	 *     summary: Get cached points statistics
	 *     tags: [Dashboard]
	 *     security:
	 *       - sessionAuth: []
	 *     parameters:
	 *       - in: query
	 *         name: campaign
	 *         required: true
	 *         schema:
	 *           type: string
	 *         description: Campaign identifier
	 *     responses:
	 *       200:
	 *         description: Cached points statistics
	 *         content:
	 *           application/json:
	 *             schema:
	 *               type: object
	 *               properties:
	 *                 totalPoints:
	 *                   type: number
	 *                 cachedPoints:
	 *                   type: number
	 *                 cachePercentage:
	 *                   type: number
	 *       401:
	 *         description: Unauthorized
	 */
	app.get('/service/dashboard/cachedPoints-inspection', dashboard.cachedPoints);
	
	/**
	 * @swagger
	 * /service/dashboard/agreementPoints-inspection:
	 *   get:
	 *     summary: Get agreement points between inspectors
	 *     tags: [Dashboard]
	 *     security:
	 *       - sessionAuth: []
	 *     parameters:
	 *       - in: query
	 *         name: campaign
	 *         required: true
	 *         schema:
	 *           type: string
	 *         description: Campaign identifier
	 *     responses:
	 *       200:
	 *         description: Agreement statistics between inspectors
	 *         content:
	 *           application/json:
	 *             schema:
	 *               type: object
	 *               properties:
	 *                 agreementRate:
	 *                   type: number
	 *                 totalComparisons:
	 *                   type: number
	 *                 agreements:
	 *                   type: number
	 *                 disagreements:
	 *                   type: number
	 *       401:
	 *         description: Unauthorized
	 */
	app.get('/service/dashboard/agreementPoints-inspection', dashboard.agreementPoints);
	
	/**
	 * @swagger
	 * /service/dashboard/landCoverPoints-inspection:
	 *   get:
	 *     summary: Get land cover classification statistics
	 *     tags: [Dashboard]
	 *     security:
	 *       - sessionAuth: []
	 *     parameters:
	 *       - in: query
	 *         name: campaign
	 *         required: true
	 *         schema:
	 *           type: string
	 *         description: Campaign identifier
	 *     responses:
	 *       200:
	 *         description: Land cover classification distribution
	 *         content:
	 *           application/json:
	 *             schema:
	 *               type: array
	 *               items:
	 *                 type: object
	 *                 properties:
	 *                   landCoverClass:
	 *                     type: string
	 *                   count:
	 *                     type: number
	 *                   percentage:
	 *                     type: number
	 *       401:
	 *         description: Unauthorized
	 */
	app.get('/service/dashboard/landCoverPoints-inspection', dashboard.landCoverPoints);	
	
	/**
	 * @swagger
	 * /service/dashboard/memberStatus-inspection:
	 *   get:
	 *     summary: Get team member status for inspection
	 *     tags: [Dashboard]
	 *     security:
	 *       - sessionAuth: []
	 *     parameters:
	 *       - in: query
	 *         name: campaign
	 *         required: true
	 *         schema:
	 *           type: string
	 *         description: Campaign identifier
	 *     responses:
	 *       200:
	 *         description: Team member status information
	 *         content:
	 *           application/json:
	 *             schema:
	 *               type: array
	 *               items:
	 *                 type: object
	 *                 properties:
	 *                   memberName:
	 *                     type: string
	 *                   status:
	 *                     type: string
	 *                     enum: [active, inactive, idle]
	 *                   lastActivity:
	 *                     type: string
	 *                     format: date-time
	 *                   pointsInspected:
	 *                     type: number
	 *       401:
	 *         description: Unauthorized
	 */
	app.get('/service/dashboard/memberStatus-inspection', dashboard.memberStatus);
}