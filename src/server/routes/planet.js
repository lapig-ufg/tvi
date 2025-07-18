module.exports = function (app) {

    const kml = app.controllers.planet;

    /**
     * @swagger
     * /service/planet/mosaics:
     *   get:
     *     summary: Get available Planet mosaics
     *     tags: [Planet]
     *     parameters:
     *       - in: query
     *         name: lon
     *         schema:
     *           type: number
     *         description: Longitude
     *       - in: query
     *         name: lat
     *         schema:
     *           type: number
     *         description: Latitude
     *       - in: query
     *         name: startDate
     *         schema:
     *           type: string
     *           format: date
     *         description: Start date for mosaic search
     *       - in: query
     *         name: endDate
     *         schema:
     *           type: string
     *           format: date
     *         description: End date for mosaic search
     *     responses:
     *       200:
     *         description: List of available Planet mosaics
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
     *                   date:
     *                     type: string
     *                     format: date
     *                   cloudCover:
     *                     type: number
     *       500:
     *         description: Server error
     */
    app.get('/service/planet/mosaics', kml.publicMosaicPlanet);

}