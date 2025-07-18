module.exports = function (app) {

	var kml = app.controllers.kml;
	var login = app.controllers.login;
	
	/**
	 * @swagger
	 * /service/kml:
	 *   get:
	 *     summary: Generate KML file for visualization
	 *     tags: [Export]
	 *     security:
	 *       - sessionAuth: []
	 *     parameters:
	 *       - in: query
	 *         name: campaign
	 *         schema:
	 *           type: string
	 *         description: Campaign identifier
	 *       - in: query
	 *         name: filters
	 *         schema:
	 *           type: object
	 *         description: Filters for KML generation
	 *     responses:
	 *       200:
	 *         description: KML file
	 *         content:
	 *           application/vnd.google-earth.kml+xml:
	 *             schema:
	 *               type: string
	 *               format: xml
	 *       401:
	 *         description: Unauthorized
	 */
	app.get('/service/kml', login.autenticateUser, kml.KmlGenerator);

}