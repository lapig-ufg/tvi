'use strict';

module.exports = function (app) {
    const auth = app.middleware.auth.cacheApiAuth.requireCacheApiAuth;
    const tiles = app.services.tilesApiService;
    const route = '/api/cache/campaign/:campaignId/offline';

    function failure(res, error) {
        const status = error.response && error.response.status;
        const code = [400, 401, 403, 404, 409, 422, 429, 503].includes(status) ? status : 502;
        const messages = {
            404: 'Campanha ou serviço de cache offline não encontrado.',
            422: 'A configuração da campanha não é compatível com esta operação de cache offline.',
            401: 'Autenticação recusada pelo serviço de imagens.',
            403: 'Acesso recusado pelo serviço de imagens.'
        };
        return res.status(code).json({ error: messages[code] || 'Não foi possível acessar o cache offline. Tente novamente.' });
    }

    app.get(route, auth, async function (req, res) {
        const page = Number(req.query.page || 0);
        if (!Number.isInteger(page) || page < 0 || page > 100000) {
            return res.status(400).json({ error: 'Página inválida.' });
        }
        try {
            res.json(await tiles.offlineCampaign(req.params.campaignId, 'get', { page: page, limit: 50 }, req));
        } catch (error) { failure(res, error); }
    });

    app.post(route, auth, async function (req, res) {
        const body = req.body || {};
        const mode = body.mode || 'start';
        const width = body.width === undefined ? 512 : body.width;
        const height = body.height === undefined ? 512 : body.height;
        if (!['start', 'retry_failed', 'regenerate'].includes(mode) ||
            ![width, height].every(value => Number.isInteger(value) && value >= 256 && value <= 2048)) {
            return res.status(400).json({ error: 'Operação ou dimensões da cobertura inválidas.' });
        }
        try {
            res.json(await tiles.offlineCampaign(req.params.campaignId, 'post', { mode, width, height }, req));
        } catch (error) { failure(res, error); }
    });
};
