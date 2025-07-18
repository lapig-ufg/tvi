module.exports = function (app) {

	var points = app.controllers.supervisor;

	/**
	 * @swagger
	 * /service/points/csv:
	 *   get:
	 *     summary: Export points data to CSV format
	 *     tags: [Supervisor]
	 *     security:
	 *       - sessionAuth: []
	 *     parameters:
	 *       - in: query
	 *         name: campaign
	 *         required: true
	 *         schema:
	 *           type: string
	 *         description: Campaign identifier
	 *       - in: query
	 *         name: filters
	 *         schema:
	 *           type: object
	 *         description: Optional filters for the export
	 *     responses:
	 *       200:
	 *         description: CSV file download
	 *         content:
	 *           text/csv:
	 *             schema:
	 *               type: string
	 *       401:
	 *         description: Unauthorized
	 *       500:
	 *         description: Server error
	 */
	app.get('/service/points/csv', points.csv);
	/**
	 * @swagger
	 * /service/points/get-point:
	 *   post:
	 *     summary: Get specific point details
	 *     tags: [Supervisor]
	 *     security:
	 *       - sessionAuth: []
	 *     requestBody:
	 *       required: true
	 *       content:
	 *         application/json:
	 *           schema:
	 *             type: object
	 *             required:
	 *               - pointId
	 *               - campaign
	 *             properties:
	 *               pointId:
	 *                 type: string
	 *                 description: Point identifier
	 *               campaign:
	 *                 type: string
	 *                 description: Campaign identifier
	 *     responses:
	 *       200:
	 *         description: Point details
	 *         content:
	 *           application/json:
	 *             schema:
	 *               type: object
	 *               properties:
	 *                 _id:
	 *                   type: string
	 *                 lat:
	 *                   type: number
	 *                 lon:
	 *                   type: number
	 *                 index:
	 *                   type: number
	 *                 classConsolidated:
	 *                   type: string
	 *                 inspections:
	 *                   type: array
	 *                   items:
	 *                     type: object
	 *       401:
	 *         description: Unauthorized
	 *       404:
	 *         description: Point not found
	 */
	app.post('/service/points/get-point', points.getPoint);
	/**
	 * @swagger
	 * /service/points/landUses/:
	 *   get:
	 *     summary: Get available land use classes for filtering
	 *     tags: [Supervisor]
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
	 *                   count:
	 *                     type: number
	 *       401:
	 *         description: Unauthorized
	 */
	app.get('/service/points/landUses/', points.landUseFilter);
	/**
	 * @swagger
	 * /service/points/users/:
	 *   get:
	 *     summary: Get list of users who performed inspections
	 *     tags: [Supervisor]
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
	 *                   inspectionCount:
	 *                     type: number
	 *       401:
	 *         description: Unauthorized
	 */
	app.get('/service/points/users/', points.usersFilter);
	/**
	 * @swagger
	 * /service/points/biome/:
	 *   get:
	 *     summary: Get available biomes for filtering
	 *     tags: [Supervisor]
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
	 *                   count:
	 *                     type: number
	 *       401:
	 *         description: Unauthorized
	 */
	app.get('/service/points/biome/', points.biomeFilter);
	/**
	 * @swagger
	 * /service/points/uf/:
	 *   get:
	 *     summary: Get available states (UF) for filtering
	 *     tags: [Supervisor]
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
	 *                   count:
	 *                     type: number
	 *       401:
	 *         description: Unauthorized
	 */
	app.get('/service/points/uf/', points.ufFilter);
	/**
	 * @swagger
	 * /service/points/updatedClassConsolidated/:
	 *   post:
	 *     summary: Update consolidated classification for a point
	 *     tags: [Supervisor]
	 *     security:
	 *       - sessionAuth: []
	 *     requestBody:
	 *       required: true
	 *       content:
	 *         application/json:
	 *           schema:
	 *             type: object
	 *             required:
	 *               - pointId
	 *               - campaign
	 *               - classConsolidated
	 *             properties:
	 *               pointId:
	 *                 type: string
	 *                 description: Point identifier
	 *               campaign:
	 *                 type: string
	 *                 description: Campaign identifier
	 *               classConsolidated:
	 *                 type: string
	 *                 description: New consolidated classification
	 *     responses:
	 *       200:
	 *         description: Classification updated successfully
	 *         content:
	 *           application/json:
	 *             schema:
	 *               type: object
	 *               properties:
	 *                 success:
	 *                   type: boolean
	 *                 message:
	 *                   type: string
	 *       400:
	 *         description: Invalid request data
	 *       401:
	 *         description: Unauthorized
	 */
	app.post('/service/points/updatedClassConsolidated/', points.updatedClassConsolidated);
	/**
	 * @swagger
	 * /service/campaign/correct:
	 *   get:
	 *     summary: Correct campaign data inconsistencies
	 *     tags: [Supervisor]
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
	 *         description: Campaign corrected successfully
	 *         content:
	 *           application/json:
	 *             schema:
	 *               type: object
	 *               properties:
	 *                 success:
	 *                   type: boolean
	 *                 correctedCount:
	 *                   type: number
	 *                 message:
	 *                   type: string
	 *       401:
	 *         description: Unauthorized
	 *       500:
	 *         description: Server error
	 */
	app.get('/service/campaign/correct', points.correctCampaign);
	/**
	 * @swagger
	 * /service/campaign/csv-borda:
	 *   get:
	 *     summary: Export border points to CSV
	 *     tags: [Supervisor]
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
	 *         description: CSV file with border points
	 *         content:
	 *           text/csv:
	 *             schema:
	 *               type: string
	 *       401:
	 *         description: Unauthorized
	 */
	app.get('/service/campaign/csv-borda', points.getBorda);
	/**
	 * @swagger
	 * /service/campaign/removeInspections:
	 *   get:
	 *     summary: Remove all inspections from a campaign
	 *     tags: [Supervisor]
	 *     security:
	 *       - sessionAuth: []
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
	 *         description: Confirmation flag to prevent accidental deletion
	 *     responses:
	 *       200:
	 *         description: Inspections removed successfully
	 *         content:
	 *           application/json:
	 *             schema:
	 *               type: object
	 *               properties:
	 *                 success:
	 *                   type: boolean
	 *                 removedCount:
	 *                   type: number
	 *                 message:
	 *                   type: string
	 *       400:
	 *         description: Missing confirmation parameter
	 *       401:
	 *         description: Unauthorized
	 */
	app.get('/service/campaign/removeInspections', points.removeInspections);
	/**
	 * @swagger
	 * /service/campaign/config:
	 *   get:
	 *     summary: Get campaign configuration
	 *     tags: [Supervisor]
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
	 *         description: Campaign configuration
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
	 *                     properties:
	 *                       id:
	 *                         type: string
	 *                       name:
	 *                         type: string
	 *                       color:
	 *                         type: string
	 *                 config:
	 *                   type: object
	 *       401:
	 *         description: Unauthorized
	 *       404:
	 *         description: Campaign not found
	 */
	app.get('/service/campaign/config', points.getCampaignConfig);
}
