module.exports = function (app) {

    const capabilities = app.controllers.capabilities;

    /**
     * @swagger
     * /service/capabilities:
     *   get:
     *     summary: Get all satellite capabilities (unified endpoint)
     *     tags: [Capabilities]
     *     description: Returns capabilities for all available satellites (Sentinel and Landsat)
     *     parameters:
     *       - in: query
     *         name: lon
     *         required: false
     *         schema:
     *           type: number
     *         description: Longitude (optional)
     *       - in: query
     *         name: lat
     *         required: false
     *         schema:
     *           type: number
     *         description: Latitude (optional)
     *     responses:
     *       200:
     *         description: Array of satellite capabilities
     *         content:
     *           application/json:
     *             schema:
     *               type: array
     *               items:
     *                 type: object
     *                 properties:
     *                   name:
     *                     type: string
     *                     description: Internal name (e.g., 's2_harmonized', 'landsat')
     *                   display_name:
     *                     type: string
     *                     description: Human-readable name
     *                   satellite:
     *                     type: string
     *                     description: Satellite type ('sentinel' or 'landsat')
     *                   visparam:
     *                     type: array
     *                     items:
     *                       type: string
     *                     description: Available visualization parameters
     *                   visparam_details:
     *                     type: array
     *                     items:
     *                       type: object
     *                       properties:
     *                         name:
     *                           type: string
     *                         display_name:
     *                           type: string
     *                         description:
     *                           type: string
     *                         tags:
     *                           type: array
     *                           items:
     *                             type: string
     *                   year:
     *                     type: array
     *                     items:
     *                       type: number
     *                     description: Available years
     *                   period:
     *                     type: array
     *                     items:
     *                       type: string
     *                     description: Available periods (WET, DRY, MONTH)
     *       500:
     *         description: Server error
     */
    app.get('/service/capabilities', capabilities.publicCapabilities);

}