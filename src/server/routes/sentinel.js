module.exports = function (app) {

    const sentinel = app.controllers.sentinel;

    /**
     * @swagger
     * /service/sentinel/capabilities:
     *   get:
     *     summary: Get Sentinel satellite capabilities
     *     tags: [Sentinel]
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
     *         name: startDate
     *         schema:
     *           type: string
     *           format: date
     *         description: Start date for capabilities search
     *       - in: query
     *         name: endDate
     *         schema:
     *           type: string
     *           format: date
     *         description: End date for capabilities search
     *     responses:
     *       200:
     *         description: Sentinel capabilities
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 dates:
     *                   type: array
     *                   items:
     *                     type: string
     *                     format: date
     *                 cloudCoverage:
     *                   type: object
     *                   additionalProperties:
     *                     type: number
     *                 availableBands:
     *                   type: array
     *                   items:
     *                     type: string
     *       500:
     *         description: Server error
     */
    app.get('/service/sentinel/capabilities', sentinel.publicCapabilities);

}