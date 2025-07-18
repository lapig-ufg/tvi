module.exports = function (app) {

	var points = app.controllers.points;

	/**
	 * @swagger
	 * /service/points/next-point:
	 *   get:
	 *     summary: Get next point for inspection
	 *     tags: [Points]
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
	 *         description: Next point data
	 *         content:
	 *           application/json:
	 *             schema:
	 *               type: object
	 *               properties:
	 *                 _id:
	 *                   type: string
	 *                 campaign:
	 *                   type: string
	 *                 lat:
	 *                   type: number
	 *                 lon:
	 *                   type: number
	 *                 index:
	 *                   type: number
	 *                 userName:
	 *                   type: string
	 *                 classConsolidated:
	 *                   type: string
	 *       401:
	 *         description: Unauthorized - session required
	 *       404:
	 *         description: No more points available
	 */
	app.get('/service/points/next-point', points.getCurrentPoint);
	
	/**
	 * @swagger
	 * /service/points/update-point:
	 *   post:
	 *     summary: Update point inspection data
	 *     tags: [Points]
	 *     security:
	 *       - sessionAuth: []
	 *     requestBody:
	 *       required: true
	 *       content:
	 *         application/json:
	 *           schema:
	 *             type: object
	 *             properties:
	 *               pointId:
	 *                 type: string
	 *                 description: Point ID to update
	 *               campaign:
	 *                 type: string
	 *                 description: Campaign identifier
	 *               class:
	 *                 type: string
	 *                 description: Classification result
	 *               userName:
	 *                 type: string
	 *                 description: Inspector username
	 *               inspectionDate:
	 *                 type: string
	 *                 format: date-time
	 *     responses:
	 *       200:
	 *         description: Point updated successfully
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
	 *       500:
	 *         description: Server error
	 */
	app.post('/service/points/update-point', points.updatePoint);
}
