'use strict';
const crypto = require('crypto');
const identifier = /^[A-Za-z0-9_.-]{1,180}$/;
const jobIdentifier = /^[a-f0-9]{64}$/;

function identity(campaign, point, year, period) {
    const config = campaign && campaign.bdcConfig;
    if (!campaign || campaign.imagerySource !== 'bdc' || !config || point.campaign !== campaign._id
        || !Number.isInteger(year) || year < Number(campaign.initialYear) || year > Number(campaign.finalYear)
        || !['DRY', 'WET'].includes(period) || !Number.isFinite(point.lon) || !Number.isFinite(point.lat)
        || Math.abs(point.lon) > 180 || Math.abs(point.lat) > 80
        || !['landsat-2', 'S2_L2A-1'].includes(config.collection)
        || !Number.isSafeInteger(config.selectionRevision) || config.selectionRevision < 1
        || !Number.isFinite(config.bufferRadiusM) || config.bufferRadiusM < 100 || config.bufferRadiusM > 5000
        || !['local_cloud', 'local_unusable'].includes(config.selectionStrategy)) {
        throw Object.assign(new Error('Ponto ou período BDC inválido.'), { status: 400 });
    }
    const params = { collection: config.collection, lon: point.lon, lat: point.lat,
        radius_m: config.bufferRadiusM, criterion: config.selectionStrategy === 'local_unusable' ? 'unusable' : 'cloud',
        start: year + (period === 'WET' ? '-01-01' : '-06-01'), end: year + (period === 'WET' ? '-04-30' : '-10-30') };
    const key = JSON.stringify([campaign._id, point._id, config.selectionRevision, year, period, params]);
    return { _id: crypto.createHash('sha256').update(key).digest('hex'), kind: 'selection', campaignId: campaign._id,
        pointId: point._id, revision: config.selectionRevision, year, period, params,
        profiles: (config.profiles || []).slice(), state: 'pending', updateVersion: 0, createdAt: new Date() };
}

function validRemote(remote, params, jobId) {
    if (!remote || !jobIdentifier.test(remote.id) || (jobId && remote.id !== jobId)
        || !['pending', 'running', 'ready', 'no_image', 'failed'].includes(remote.state)) return false;
    if (remote.params && Object.keys(params).some(key => remote.params[key] !== params[key])) return false;
    if (!['ready', 'no_image'].includes(remote.state)) return true;
    const result = remote.result;
    if (!result || result.complete !== true || !Array.isArray(result.rows) || result.rows.length > 22020
        || result.evaluated !== result.rows.length || !Number.isSafeInteger(result.eligible)) return false;
    if (result.rows.some(row => !row || typeof row.id !== 'string' || !identifier.test(row.id) || ['.', '..'].includes(row.id))) return false;
    const eligible = result.rows.filter(row => row.eligible === true).map(row => row.id);
    if (new Set(result.rows.map(row => row.id)).size !== result.rows.length || result.eligible !== eligible.length) return false;
    if (remote.state === 'no_image') return eligible.length === 0 && !result.best_local_id && !result.best_global_id;
    return eligible.includes(result.best_local_id) && (!result.best_global_id || eligible.includes(result.best_global_id));
}

function create(collection, tiles, points) {
    async function available(point) {
        if (!points) return;
        const current = await points.findOne({ _id: point._id, campaign: point.campaign });
        if (!current) {
            await collection.deleteMany({ campaignId: point.campaign, pointId: point._id });
            throw Object.assign(new Error('Ponto não encontrado.'), { status: 404 });
        }
        if (current.pointMutationLock) {
            throw Object.assign(new Error('O ponto está em manutenção.'), { status: 409 });
        }
    }
    return {
        async resolve(campaign, point, year, period, start, retry = false) {
            await available(point);
            const seed = identity(campaign, point, year, period);
            let saved = await collection.findOne({ _id: seed._id });
            if (!saved && !start) return null;
            if (!saved) {
                try { await collection.updateOne({ _id: seed._id }, { $setOnInsert: seed }, { upsert: true }); }
                catch (error) { if (error.code !== 11000) throw error; }
                saved = await collection.findOne({ _id: seed._id });
            }
            await available(point);
            if (['ready', 'no_image'].includes(saved.state)) {
                if (seed.profiles.some(profile => !(saved.profiles || []).includes(profile))) {
                    await collection.updateOne({ _id: seed._id }, { $addToSet: { profiles: { $each: seed.profiles } } });
                    saved = await collection.findOne({ _id: seed._id });
                }
                await available(point);
                return saved;
            }
            const retrying = start && retry === true && saved.state === 'failed' && saved.error && saved.error.retryable;
            if (saved.state === 'failed' && !retrying) return saved;
            const remote = retrying || !saved.jobId
                ? await tiles.createJob(Object.assign({}, seed.params, { idempotency_key: seed._id, retry: !!retrying }))
                : await tiles.getJob(saved.jobId);
            if (!validRemote(remote, seed.params, saved.jobId)) {
                throw Object.assign(new Error('Resultado BDC incompleto.'), { status: 502 });
            }
            const update = { jobId: remote.id, state: remote.state, result: remote.result || null,
                error: remote.error || null, algorithmVersion: remote.algorithm_version, updatedAt: new Date() };
            const states = retrying ? ['failed', 'pending', 'running'] : remote.state === 'pending' ? ['pending'] : ['pending', 'running'];
            const updateVersion = Number.isSafeInteger(saved.updateVersion) ? saved.updateVersion : { $exists: false };
            await available(point);
            await collection.updateOne({ _id: seed._id, state: { $in: states }, updateVersion },
                { $set: update, $inc: { updateVersion: 1 } });
            await available(point);
            return collection.findOne({ _id: seed._id });
        },
        async historical(id, campaignId, pointId) {
            if (typeof id !== 'string' || !jobIdentifier.test(id)) return null;
            return collection.findOne({ _id: id, campaignId, pointId });
        }
    };
}
module.exports = function (app) {
    function service() { return create(app.repository.collections.campaignImageSelections, app.services.bdcTilesClient, app.repository.collections.points); }
    return { resolve(...args) { return service().resolve(...args); }, historical(...args) { return service().historical(...args); } };
};
module.exports.create = create;
module.exports.identity = identity;
module.exports.validRemote = validRemote;
