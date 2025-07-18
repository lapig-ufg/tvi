module.exports = function (app) {
	const timeseries = app.controllers.timeseries;
	
	/**
	 * @swagger
	 * /service/timeseries/landsat/ndvi:
	 *   get:
	 *     summary: Get Landsat NDVI timeseries by coordinates
	 *     tags: [Timeseries]
	 *     parameters:
	 *       - in: query
	 *         name: lon
	 *         required: true
	 *         schema:
	 *           type: number
	 *         description: Longitude coordinate
	 *       - in: query
	 *         name: lat
	 *         required: true
	 *         schema:
	 *           type: number
	 *         description: Latitude coordinate
	 *       - in: query
	 *         name: data_inicio
	 *         schema:
	 *           type: string
	 *           format: date
	 *         description: Start date (YYYY-MM-DD)
	 *       - in: query
	 *         name: data_fim
	 *         schema:
	 *           type: string
	 *           format: date
	 *         description: End date (YYYY-MM-DD)
	 *     responses:
	 *       200:
	 *         description: Successful response with timeseries data
	 *         content:
	 *           application/json:
	 *             schema:
	 *               type: array
	 *               items:
	 *                 type: object
	 *                 properties:
	 *                   date:
	 *                     type: string
	 *                   ndvi:
	 *                     type: number
	 *                   cloud_coverage:
	 *                     type: number
	 *       400:
	 *         description: Missing required parameters
	 *       500:
	 *         description: Server error
	 */
	app.get('/service/timeseries/landsat/ndvi', timeseries.getTimeSeriesLandsatNdviByLonLat);
	
	/**
	 * @swagger
	 * /service/timeseries/nddi:
	 *   get:
	 *     summary: Get Landsat NDDI (Normalized Difference Drought Index) timeseries
	 *     tags: [Timeseries]
	 *     parameters:
	 *       - in: query
	 *         name: lon
	 *         required: true
	 *         schema:
	 *           type: number
	 *         description: Longitude coordinate
	 *       - in: query
	 *         name: lat
	 *         required: true
	 *         schema:
	 *           type: number
	 *         description: Latitude coordinate
	 *       - in: query
	 *         name: data_inicio
	 *         schema:
	 *           type: string
	 *           format: date
	 *         description: Start date (YYYY-MM-DD)
	 *       - in: query
	 *         name: data_fim
	 *         schema:
	 *           type: string
	 *           format: date
	 *         description: End date (YYYY-MM-DD)
	 *     responses:
	 *       200:
	 *         description: Successful response with NDDI timeseries data
	 *       400:
	 *         description: Missing required parameters
	 *       500:
	 *         description: Server error
	 */
	app.get('/service/timeseries/nddi', timeseries.getTimeSeriesLandsatNDDIByLonLat);
	
	/**
	 * @swagger
	 * /service/timeseries/landsat/ndvi:
	 *   post:
	 *     summary: Get Landsat NDVI timeseries by geometry
	 *     tags: [Timeseries]
	 *     requestBody:
	 *       required: true
	 *       content:
	 *         application/json:
	 *           schema:
	 *             type: object
	 *             required:
	 *               - geometry
	 *             properties:
	 *               geometry:
	 *                 type: object
	 *                 description: GeoJSON geometry (point or polygon)
	 *               startDate:
	 *                 type: string
	 *                 format: date
	 *                 description: Start date (YYYY-MM-DD)
	 *               endDate:
	 *                 type: string
	 *                 format: date
	 *                 description: End date (YYYY-MM-DD)
	 *     responses:
	 *       200:
	 *         description: Successful response with timeseries data
	 *         content:
	 *           application/json:
	 *             schema:
	 *               type: array
	 *               items:
	 *                 type: object
	 *                 properties:
	 *                   date:
	 *                     type: string
	 *                   ndvi:
	 *                     type: number
	 *                   statistics:
	 *                     type: object
	 *                     properties:
	 *                       mean:
	 *                         type: number
	 *                       min:
	 *                         type: number
	 *                       max:
	 *                         type: number
	 *                       std:
	 *                         type: number
	 *       400:
	 *         description: Invalid geometry or parameters
	 *       500:
	 *         description: Server error
	 */
	app.post('/service/timeseries/landsat/ndvi', timeseries.landsatNdviByGeometry);
	
	/**
	 * @swagger
	 * /api/timeseries/landsat/ndvi:
	 *   get:
	 *     summary: Get Landsat NDVI timeseries (API version)
	 *     tags: [Timeseries API]
	 *     parameters:
	 *       - in: query
	 *         name: lon
	 *         required: true
	 *         schema:
	 *           type: number
	 *         description: Longitude coordinate
	 *       - in: query
	 *         name: lat
	 *         required: true
	 *         schema:
	 *           type: number
	 *         description: Latitude coordinate
	 *       - in: query
	 *         name: startDate
	 *         schema:
	 *           type: string
	 *           format: date
	 *         description: Start date (YYYY-MM-DD)
	 *       - in: query
	 *         name: endDate
	 *         schema:
	 *           type: string
	 *           format: date
	 *         description: End date (YYYY-MM-DD)
	 *     responses:
	 *       200:
	 *         description: Successful response with timeseries data
	 *         content:
	 *           application/json:
	 *             schema:
	 *               type: array
	 *               items:
	 *                 type: object
	 *                 properties:
	 *                   date:
	 *                     type: string
	 *                   ndvi:
	 *                     type: number
	 *       400:
	 *         description: Missing required parameters
	 */
	app.get('/api/timeseries/landsat/ndvi', timeseries.getTimeSeriesLandsatNdviByLonLat);
	
	/**
	 * @swagger
	 * /api/timeseries/nddi:
	 *   get:
	 *     summary: Get Landsat NDDI timeseries (API version)
	 *     tags: [Timeseries API]
	 *     parameters:
	 *       - in: query
	 *         name: lon
	 *         required: true
	 *         schema:
	 *           type: number
	 *         description: Longitude coordinate
	 *       - in: query
	 *         name: lat
	 *         required: true
	 *         schema:
	 *           type: number
	 *         description: Latitude coordinate
	 *       - in: query
	 *         name: startDate
	 *         schema:
	 *           type: string
	 *           format: date
	 *         description: Start date (YYYY-MM-DD)
	 *       - in: query
	 *         name: endDate
	 *         schema:
	 *           type: string
	 *           format: date
	 *         description: End date (YYYY-MM-DD)
	 *     responses:
	 *       200:
	 *         description: Successful response with NDDI timeseries data
	 *         content:
	 *           application/json:
	 *             schema:
	 *               type: array
	 *               items:
	 *                 type: object
	 *                 properties:
	 *                   date:
	 *                     type: string
	 *                   nddi:
	 *                     type: number
	 *       400:
	 *         description: Missing required parameters
	 */
	app.get('/api/timeseries/nddi', timeseries.getTimeSeriesLandsatNDDIByLonLat);
}
