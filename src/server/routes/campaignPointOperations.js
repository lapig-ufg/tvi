'use strict';
module.exports = function (app) {
    const base = '/api/campaigns/:campaignId/point-operations';
    function actor(req) {
        const admin = req.session && req.session.admin;
        if (!admin || !admin.superAdmin) throw Object.assign(new Error('Autenticação de administrador necessária.'), { statusCode: 401 });
        const name = admin.superAdmin.username || admin.username || admin.name;
        if (typeof name !== 'string' || !name.length) throw Object.assign(new Error('Identificação do administrador ausente.'), { statusCode: 401 });
        return name;
    }
    function handle(method, accepted) {
        return async function (req, res) {
            res.set('Cache-Control', 'no-store');
            try {
                const name = actor(req);
                const service = app.services.campaignPointOperations;
                const args = [req.params.campaignId, name];
                if (method === 'preview') args.push(req.body);
                else if (method !== 'list') args.push(req.params.id, req.body);
                const result = await service[method](...args);
                return res.status(accepted ? 202 : 200).json(result);
            } catch (failure) {
                const status = [400, 401, 403, 404, 409, 413, 422].includes(failure.statusCode) ? failure.statusCode : 500;
                return res.status(status).json({ error: status === 500 ? 'Não foi possível processar a operação de pontos.' : failure.message });
            }
        };
    }
    app.get(base, handle('list'));
    app.post(base + '/preview', handle('preview'));
    app.get(base + '/:id', handle('get'));
    app.post(base + '/:id/confirm', handle('confirm', true));
    app.post(base + '/:id/resume', handle('resume', true));
};
