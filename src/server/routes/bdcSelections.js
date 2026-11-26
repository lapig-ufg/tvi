'use strict';
const selectionIdPattern = /^[a-f0-9]{64}$/;
const identifierPattern = /^[A-Za-z0-9_.-]{1,180}$/;

module.exports = function (app) {
    const route = '/service/points/:pointId/bdc-selections';
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
    function availableProfiles(selection, row) {
        return (selection.profiles || []).filter(profile => typeof profile === 'string'
            && identifierPattern.test(profile) && (!row || (row.profiles || []).includes(profile)));
    }
    function present(selection) {
        const result = selection.result || {};
        function acquisition(id, side) {
            const row = (result.rows || []).find(value => value.id === id && value.eligible);
            if (!row) return null;
            const tiles = {};
            availableProfiles(selection, row).forEach(profile => {
                tiles[profile] = '/service/bdc/tiles/' + selection._id + '/' + side + '/' + encodeURIComponent(profile) + '/{z}/{x}/{y}.png';
            });
            return { itemId: id, datetime: row.datetime, cloudPercent: row.cloud_pct,
                unusablePercent: row.unusable_pct, tiles };
        }
        const local = acquisition(result.best_local_id, 'local');
        const profiles = local ? availableProfiles(selection, (result.rows || []).find(row => row.id === result.best_local_id)) : availableProfiles(selection);
        return { id: selection._id, state: selection.state, revision: selection.revision,
            year: selection.year, period: selection.period, startDate: selection.params.start,
            endDate: selection.params.end, lon: selection.params.lon, lat: selection.params.lat,
            local, global: acquisition(result.best_global_id, 'global'),
            profiles: profiles.map(id => ({ id, label: id })), retryAfterSeconds: 3,
            retryable: !!(selection.error && selection.error.retryable), error: selection.error && selection.error.code };
    }
    function failure(res, error) {
        const status = [400, 401, 403, 404, 409, 422, 429, 502, 503].includes(error.status) ? error.status : 503;
        if ([429, 503].includes(status) && Number.isInteger(error.retryAfterSeconds)
            && error.retryAfterSeconds >= 0 && error.retryAfterSeconds <= 120) {
            res.set('Retry-After', String(error.retryAfterSeconds));
        }
        return res.status(status).json({ error: error.status ? error.message : 'Serviço BDC temporariamente indisponível.' });
    }
    function handler(start) {
        return async function (req, res) {
            res.set('Cache-Control', 'no-store');
            try {
                const ctx = await context(req, req.params.pointId);
                const input = start ? req.body || {} : req.query || {};
                if (input.retry !== undefined && typeof input.retry !== 'boolean') return res.status(400).json({ error: 'Retentativa inválida.' });
                let selected;
                if (input.selectionId) {
                    if (start) return res.status(400).json({ error: 'Referências históricas são somente para consulta.' });
                    selected = await app.services.bdcSelectionService.historical(input.selectionId, ctx.campaign._id, ctx.point._id);
                    if (!selected) return res.status(404).json({ error: 'Referência não encontrada.' });
                } else {
                    selected = await app.services.bdcSelectionService.resolve(ctx.campaign, ctx.point, Number(input.year), input.period, start, input.retry === true);
                    if (!selected) return res.status(404).json({ code: 'BDC_NOT_STARTED', error: 'Seleção BDC ainda não solicitada.' });
                }
                await context(req, ctx.point._id, ctx.campaign._id);
                res.status(start && ['pending', 'running'].includes(selected.state) ? 202 : 200).json(present(selected));
            } catch (error) { failure(res, error); }
        };
    }
    app.get(route, handler(false));
    app.post(route, handler(true));
    app.get('/service/bdc/tiles/:selectionId/:side/:profile/:z/:x/:y.png', async function (req, res) {
        res.set('Cache-Control', 'no-store');
        try {
            access(req);
            const p = req.params;
            const xyz = [p.z, p.x, p.y].map(Number);
            if (!selectionIdPattern.test(p.selectionId) || !['local', 'global'].includes(p.side)
                || !identifierPattern.test(p.profile) || ['.', '..'].includes(p.profile)
                || Object.keys(req.query || {}).length || ![p.z, p.x, p.y].every(value => /^\d+$/.test(value))
                || !xyz.every(Number.isSafeInteger) || xyz[0] < 6 || xyz[0] > 18 || xyz[1] >= 2 ** xyz[0] || xyz[2] >= 2 ** xyz[0]) {
                return res.status(400).json({ error: 'Tile BDC inválido.' });
            }
            const selected = await app.repository.collections.campaignImageSelections.findOne({ _id: p.selectionId });
            if (!selected) return res.status(404).json({ error: 'Seleção não encontrada.' });
            await context(req, selected.pointId, selected.campaignId);
            const result = selected.result || {};
            const id = result[p.side === 'local' ? 'best_local_id' : 'best_global_id'];
            const row = (result.rows || []).find(value => value.id === id && value.eligible);
            if (selected.state !== 'ready' || result.complete !== true || !row || !identifierPattern.test(id)
                || ['.', '..'].includes(id) || !['landsat-2', 'S2_L2A-1'].includes(selected.params.collection)
                || !availableProfiles(selected, row).includes(p.profile)) return res.status(404).json({ error: 'Imagem ou composição indisponível.' });
            const data = await app.services.bdcTilesClient.getTile(selected.params.collection, id, p.profile, ...xyz);
            await context(req, selected.pointId, selected.campaignId);
            if (!Buffer.isBuffer(data) || data.length < 8 || data.length > 8 * 1024 * 1024
                || !data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
                return res.status(502).json({ error: 'Imagem BDC inválida.' });
            }
            res.set('Content-Type', 'image/png');
            res.set('X-Content-Type-Options', 'nosniff');
            res.send(data);
        } catch (error) { failure(res, error); }
    });
    app.get('/api/bdc/catalog', async function (req, res) {
        if (!(req.session && req.session.admin && req.session.admin.superAdmin)) return res.status(403).json({ error: 'Acesso administrativo necessário.' });
        try { res.json(await app.services.bdcTilesClient.getCatalog()); }
        catch (error) { res.status(503).json({ error: 'Catálogo BDC indisponível.' }); }
    });
};
