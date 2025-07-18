module.exports = function (app) {

	var login = app.controllers.login;
	var proxy = app.controllers.proxy;

	/**
	 * @swagger
	 * /service/spatial/query:
	 *   get:
	 *     summary: Proxy for spatial queries
	 *     tags: [Spatial Data]
	 *     security:
	 *       - sessionAuth: []
	 *     parameters:
	 *       - in: query
	 *         name: url
	 *         required: true
	 *         schema:
	 *           type: string
	 *         description: Target URL for the query
	 *       - in: query
	 *         name: params
	 *         schema:
	 *           type: object
	 *         description: Query parameters
	 *     responses:
	 *       200:
	 *         description: Query results
	 *         content:
	 *           application/json:
	 *             schema:
	 *               type: object
	 *       401:
	 *         description: Unauthorized
	 *       500:
	 *         description: Proxy error
	 */
	app.get('/service/spatial/query', login.autenticateUser, proxy.doRequest);
	/**
	 * @swagger
	 * /service/time-series/{serie}:
	 *   get:
	 *     summary: Get time series data
	 *     tags: [Time Series]
	 *     security:
	 *       - sessionAuth: []
	 *     parameters:
	 *       - in: path
	 *         name: serie
	 *         required: true
	 *         schema:
	 *           type: string
	 *         description: Time series identifier (e.g., MOD13Q1_NDVI, LANDSAT_NDVI)
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
	 *         description: Start date
	 *       - in: query
	 *         name: endDate
	 *         schema:
	 *           type: string
	 *           format: date
	 *         description: End date
	 *     responses:
	 *       200:
	 *         description: Time series data
	 *         content:
	 *           application/json:
	 *             schema:
	 *               type: object
	 *               properties:
	 *                 series:
	 *                   type: array
	 *                   items:
	 *                     type: object
	 *                     properties:
	 *                       date:
	 *                         type: string
	 *                       value:
	 *                         type: number
	 *       401:
	 *         description: Unauthorized
	 */
	app.get('/service/time-series/:serie', login.autenticateUser, proxy.timeSeries);
	/**
	 * @swagger
	 * /service/spatial/precipitation:
	 *   get:
	 *     summary: Get precipitation maps data
	 *     tags: [Spatial Data]
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
	 *         name: date
	 *         schema:
	 *           type: string
	 *           format: date
	 *         description: Date for precipitation data
	 *     responses:
	 *       200:
	 *         description: Precipitation data
	 *         content:
	 *           application/json:
	 *             schema:
	 *               type: object
	 *               properties:
	 *                 precipitation:
	 *                   type: number
	 *                   description: Precipitation value in mm
	 *                 date:
	 *                   type: string
	 *                   format: date
	 *       500:
	 *         description: Server error
	 */
	app.get('/service/spatial/precipitation', proxy.precipitationMaps);


}