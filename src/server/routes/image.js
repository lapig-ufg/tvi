module.exports = function (app) {

	var image = app.controllers.image;
	
	/**
	 * @swagger
	 * /source/{id}:
	 *   get:
	 *     summary: Get GDAL definition for image source
	 *     tags: [Images]
	 *     parameters:
	 *       - in: path
	 *         name: id
	 *         required: true
	 *         schema:
	 *           type: string
	 *         description: Source identifier
	 *     responses:
	 *       200:
	 *         description: GDAL definition
	 *         content:
	 *           application/json:
	 *             schema:
	 *               type: object
	 *               properties:
	 *                 driver:
	 *                   type: string
	 *                 source:
	 *                   type: string
	 *                 bands:
	 *                   type: array
	 *                   items:
	 *                     type: number
	 *       404:
	 *         description: Source not found
	 */
	app.get('/source/:id', image.gdalDefinition);
	/**
	 * @swagger
	 * /image/{layerId}/{pointId}:
	 *   get:
	 *     summary: Access image for specific layer and point
	 *     tags: [Images]
	 *     parameters:
	 *       - in: path
	 *         name: layerId
	 *         required: true
	 *         schema:
	 *           type: string
	 *         description: Layer identifier
	 *       - in: path
	 *         name: pointId
	 *         required: true
	 *         schema:
	 *           type: string
	 *         description: Point identifier
	 *     responses:
	 *       200:
	 *         description: Image data
	 *         content:
	 *           image/png:
	 *             schema:
	 *               type: string
	 *               format: binary
	 *           image/jpeg:
	 *             schema:
	 *               type: string
	 *               format: binary
	 *       404:
	 *         description: Image not found
	 */
	app.get('/image/:layerId/:pointId', image.access);

}