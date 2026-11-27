'use strict';

module.exports = function(app) {
    const { context } = require('../services/bdcPointAccess')(app);
    const base = '/service/points/:pointId/bdc-images';
    function fingerprint(value) {
        const { campaign, point } = value;
        return JSON.stringify([point._id, point.campaign, point.lon, point.lat, campaign._id,
            campaign.initialYear, campaign.finalYear, campaign.imageType, campaign.imagerySource, campaign.bdcConfig]);
    }
    function handler(operation) {
        return async function(req, res) {
            res.set('Cache-Control', 'no-store');
            try {
                const before = await context(req, req.params.pointId);
                const browser = app.services.bdcImageBrowser;
                const p = req.params;
                const result = operation === 'search'
                    ? await browser.search(before.campaign, before.point, req.query)
                    : operation === 'detail'
                        ? await browser.detail(before.campaign, before.point, p.itemId, req.query)
                        : await browser.tile(before.campaign, before.point, p.itemId, p.profile, [p.z, p.x, p.y], req.query);
                const after = await context(req, before.point._id, before.campaign._id);
                if (fingerprint(before) !== fingerprint(after)) {
                    return res.status(409).json({ error: 'O contexto do ponto mudou. Abra a consulta novamente.' });
                }
                if (operation === 'tile') {
                    res.set('Content-Type', 'image/png');
                    res.set('X-Content-Type-Options', 'nosniff');
                    return res.send(result);
                }
                return res.json(result);
            } catch (error) {
                const status = [400, 401, 403, 404, 409, 422, 429, 502, 503].includes(error.status) ? error.status : 503;
                if ([429, 503].includes(status) && Number.isInteger(error.retryAfterSeconds)
                    && error.retryAfterSeconds >= 0 && error.retryAfterSeconds <= 120) res.set('Retry-After', String(error.retryAfterSeconds));
                return res.status(status).json({ error: error.status ? error.message : 'Não foi possível consultar as imagens BDC.' });
            }
        };
    }
    app.get(base, handler('search'));
    app.get(base + '/:itemId', handler('detail'));
    app.get(base + '/:itemId/tiles/:profile/:z/:x/:y.png', handler('tile'));
};
