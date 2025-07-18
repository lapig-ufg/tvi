module.exports = function (app) {
    const mapbiomas = app.controllers.mapbiomas;
    const origin = app.middleware.origin;
    /**
     * @swagger
     * /service/mapbiomas/capabilities:
     *   get:
     *     summary: Get MapBiomas service capabilities
     *     tags: [MapBiomas]
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
     *     responses:
     *       200:
     *         description: MapBiomas capabilities
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 collections:
     *                   type: array
     *                   items:
     *                     type: object
     *                     properties:
     *                       id:
     *                         type: string
     *                       name:
     *                         type: string
     *                       years:
     *                         type: array
     *                         items:
     *                           type: number
     *       403:
     *         description: Origin not allowed
     */
    app.get('/service/mapbiomas/capabilities', origin.checkOriginAndHost, mapbiomas.capabilities);
    /**
     * @swagger
     * /service/mapbiomas/wms:
     *   get:
     *     summary: MapBiomas WMS proxy service
     *     tags: [MapBiomas]
     *     parameters:
     *       - in: query
     *         name: SERVICE
     *         schema:
     *           type: string
     *           default: WMS
     *         description: OGC service type
     *       - in: query
     *         name: REQUEST
     *         required: true
     *         schema:
     *           type: string
     *           enum: [GetMap, GetCapabilities, GetFeatureInfo]
     *         description: WMS request type
     *       - in: query
     *         name: LAYERS
     *         schema:
     *           type: string
     *         description: Layer names
     *       - in: query
     *         name: BBOX
     *         schema:
     *           type: string
     *         description: Bounding box coordinates
     *       - in: query
     *         name: WIDTH
     *         schema:
     *           type: number
     *         description: Image width in pixels
     *       - in: query
     *         name: HEIGHT
     *         schema:
     *           type: number
     *         description: Image height in pixels
     *       - in: query
     *         name: FORMAT
     *         schema:
     *           type: string
     *           default: image/png
     *         description: Response format
     *     responses:
     *       200:
     *         description: WMS response
     *         content:
     *           image/png:
     *             schema:
     *               type: string
     *               format: binary
     *           application/xml:
     *             schema:
     *               type: string
     *       403:
     *         description: Origin not allowed
     */
    app.get('/service/mapbiomas/wms', origin.checkOriginAndHost, mapbiomas.proxy);
}
