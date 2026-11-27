'use strict';

module.exports = function(app) {
    function access(req) {
        const session = req.session || {};
        if (session.admin && session.admin.superAdmin) return { admin: true };
        const campaignId = session.user && session.user.campaign && session.user.campaign._id;
        if (!campaignId) throw Object.assign(new Error('Autenticação necessária.'), { status: 401 });
        return { campaignId };
    }
    async function context(req, pointId, campaignId) {
        const permission = access(req);
        if ((typeof pointId !== 'string' && typeof pointId !== 'number') || String(pointId).length > 256) {
            throw Object.assign(new Error('Ponto inválido.'), { status: 400 });
        }
        if (!permission.admin && campaignId && campaignId !== permission.campaignId) {
            throw Object.assign(new Error('Ponto não encontrado.'), { status: 404 });
        }
        const query = { _id: pointId };
        if (campaignId || !permission.admin) query.campaign = campaignId || permission.campaignId;
        const point = await app.repository.collections.points.findOne(query);
        if (!point) throw Object.assign(new Error('Ponto não encontrado.'), { status: 404 });
        if (point.pointMutationLock) throw Object.assign(new Error('O ponto está em manutenção.'), { status: 409 });
        const campaign = await app.repository.collections.campaign.findOne({ _id: point.campaign });
        if (!campaign) throw Object.assign(new Error('Campanha não encontrada.'), { status: 404 });
        return { point, campaign };
    }
    return { access, context };
};
