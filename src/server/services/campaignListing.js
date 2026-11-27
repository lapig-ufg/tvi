'use strict';

const SORTS = new Set(['createdAt', 'createdAtAsc', 'campaignId', 'initialYear', 'finalYear', 'totalPoints', 'progress']);
const STATUSES = new Set(['empty', 'notStarted', 'started', 'completed']);

function invalid(field) {
    const error = new Error('Valor inválido para o filtro ' + field + '.');
    error.statusCode = 400;
    return error;
}

function text(query, field) {
    const value = query[field];
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string' || value.length > 500) throw invalid(field);
    return value.trim() || null;
}

function number(query, field, fallback, min, max, integer = true) {
    const raw = text(query, field);
    if (raw === null) return fallback;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) throw invalid(field);
    return value;
}

function parseQuery(input) {
    const query = input || {};
    const clauses = [];
    const filters = {};
    const campaignId = text(query, 'campaignId');
    if (campaignId) filters._id = { $regex: campaignId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
    for (const field of ['initialYear', 'finalYear', 'numInspec']) {
        const value = number(query, field, null, 0, 9999);
        if (value !== null) filters[field] = value;
    }
    for (const field of ['imageType', 'landUse']) {
        const value = text(query, field);
        if (value) filters[field] = value;
    }
    for (const field of ['showTimeseries', 'showPointInfo', 'autoLoadTimeseries', 'useDynamicMaps']) {
        const value = text(query, field);
        if (value === null) continue;
        if (value !== 'true' && value !== 'false') throw invalid(field);
        const defaultValue = field !== 'useDynamicMaps';
        filters[field] = (value === 'true') === defaultValue ? { $ne: !defaultValue } : !defaultValue;
    }
    const source = text(query, 'imagerySource');
    if (source && source !== 'legacy' && source !== 'bdc') throw invalid('imagerySource');
    if (source) clauses.push({ imagerySource: source === 'bdc' ? 'bdc' : { $ne: 'bdc' } });
    const bdcFields = { bdcCollection: 'collection', bdcSelectionStrategy: 'selectionStrategy', bdcDefaultProfile: 'defaultProfile' };
    for (const key of Object.keys(bdcFields)) {
        const value = text(query, key);
        if (value) {
            filters['bdcConfig.' + bdcFields[key]] = value;
            filters.imagerySource = 'bdc';
        }
    }
    const radius = number(query, 'bdcBufferRadiusM', null, 100, 5000, false);
    if (radius !== null) {
        filters['bdcConfig.bufferRadiusM'] = radius;
        filters.imagerySource = 'bdc';
    }
    const zoom = number(query, 'zoomLevel', null, 10, 18);
    if (zoom !== null) {
        if (zoom === 13) clauses.push({ $or: [{ zoomLevel: 13 }, { zoomLevel: null }] });
        else filters.zoomLevel = zoom;
    }
    if (clauses.length) filters.$and = clauses;
    let sort = text(query, 'sortBy') || 'createdAt';
    if (sort === '_id') sort = 'campaignId';
    if (!SORTS.has(sort)) throw invalid('sortBy');
    const status = text(query, 'progressStatus');
    if (status && !STATUSES.has(status)) throw invalid('progressStatus');
    const page = number(query, 'page', 1, 1, 1000000);
    const limit = number(query, 'limit', 10, 1, 200);
    return { filters, sort, status, page, limit, skip: (page - 1) * limit };
}

function emptyStats() {
    return { totalPoints: 0, completedPoints: 0, inspectedPoints: 0, totalInspections: 0 };
}

async function pointStats(points, campaigns) {
    const stats = new Map(campaigns.map(campaign => [campaign._id, emptyStats()]));
    if (!campaigns.length) return stats;
    const required = new Map(campaigns.map(campaign => [campaign._id, Number(campaign.numInspec) > 0 ? Number(campaign.numInspec) : 3]));
    const counts = await points.aggregate([
        { $match: { campaign: { $in: campaigns.map(campaign => campaign._id) } } },
        { $project: { campaign: 1, inspections: { $cond: [{ $isArray: '$userName' }, { $size: '$userName' }, 0] } } },
        { $group: { _id: { campaign: '$campaign', inspections: '$inspections' }, count: { $sum: 1 } } }
    ], { allowDiskUse: true }).toArray();
    for (const group of counts) {
        const entry = stats.get(group._id.campaign);
        entry.totalPoints += group.count;
        entry.totalInspections += group.count * group._id.inspections;
        if (group._id.inspections > 0) entry.inspectedPoints += group.count;
        if (group._id.inspections >= required.get(group._id.campaign)) entry.completedPoints += group.count;
    }
    return stats;
}

function progress(stats) {
    return stats.totalPoints ? stats.completedPoints / stats.totalPoints : 0;
}

function matchesStatus(stats, status) {
    switch (status) {
        case 'empty': return stats.totalPoints === 0;
        case 'notStarted': return stats.totalPoints > 0 && stats.inspectedPoints === 0;
        case 'started': return stats.inspectedPoints > 0 && stats.completedPoints < stats.totalPoints;
        case 'completed': return stats.totalPoints > 0 && stats.completedPoints === stats.totalPoints;
        default: return true;
    }
}

function compare(left, right, sort, stats) {
    let order = 0;
    if (sort === 'createdAt' || sort === 'createdAtAsc') {
        const date = campaign => campaign.createdAt ? new Date(campaign.createdAt).getTime() : NaN;
        const a = date(left), b = date(right);
        if (Number.isFinite(a) !== Number.isFinite(b)) return Number.isFinite(a) ? -1 : 1;
        if (Number.isFinite(a)) order = (sort === 'createdAtAsc' ? 1 : -1) * (a - b);
    } else if (sort === 'totalPoints') order = stats.get(right._id).totalPoints - stats.get(left._id).totalPoints;
    else if (sort === 'progress') order = progress(stats.get(right._id)) - progress(stats.get(left._id));
    else if (sort !== 'campaignId') order = (right[sort] || 0) - (left[sort] || 0);
    return order || (left._id < right._id ? -1 : left._id > right._id ? 1 : 0);
}

async function pageDocuments(campaigns, parsed) {
    if (parsed.sort === 'createdAt' || parsed.sort === 'createdAtAsc') {
        return campaigns.aggregate([
            { $match: parsed.filters },
            { $addFields: { _listingDate: { $convert: { input: '$createdAt', to: 'date', onError: null, onNull: null } } } },
            { $addFields: { _listingDated: { $cond: [{ $eq: ['$_listingDate', null] }, 0, 1] } } },
            { $sort: { _listingDated: -1, _listingDate: parsed.sort === 'createdAtAsc' ? 1 : -1, _id: 1 } },
            { $skip: parsed.skip }, { $limit: parsed.limit },
            { $project: { _listingDate: 0, _listingDated: 0 } }
        ], { allowDiskUse: true }).toArray();
    }
    const sort = parsed.sort === 'campaignId' ? { _id: 1 } : { [parsed.sort]: -1, _id: 1 };
    return campaigns.find(parsed.filters).sort(sort).skip(parsed.skip).limit(parsed.limit).toArray();
}

async function list(campaigns, points, query) {
    const parsed = parseQuery(query);
    let documents, stats, total;
    if (parsed.status || parsed.sort === 'totalPoints' || parsed.sort === 'progress') {
        const candidates = await campaigns.find(parsed.filters).project({ _id: 1, numInspec: 1, createdAt: 1, initialYear: 1, finalYear: 1 }).toArray();
        stats = await pointStats(points, candidates);
        const matching = candidates.filter(campaign => matchesStatus(stats.get(campaign._id), parsed.status));
        matching.sort((left, right) => compare(left, right, parsed.sort, stats));
        total = matching.length;
        const page = matching.slice(parsed.skip, parsed.skip + parsed.limit);
        const details = page.length ? await campaigns.find({ _id: { $in: page.map(campaign => campaign._id) } }).toArray() : [];
        const byId = new Map(details.map(campaign => [campaign._id, campaign]));
        documents = page.map(campaign => byId.get(campaign._id)).filter(Boolean);
    } else {
        [total, documents] = await Promise.all([campaigns.count(parsed.filters), pageDocuments(campaigns, parsed)]);
        stats = await pointStats(points, documents);
    }
    const totalPages = Math.ceil(total / parsed.limit);
    return {
        campaigns: documents.map(campaign => Object.assign(campaign, stats.get(campaign._id), { progress: Number((progress(stats.get(campaign._id)) * 100).toFixed(2)) })),
        pagination: { currentPage: parsed.page, totalPages, totalCampaigns: total, limit: parsed.limit, hasNext: parsed.page < totalPages, hasPrev: parsed.page > 1 }
    };
}

async function filterOptions(campaigns) {
    const fields = {
        initialYears: 'initialYear', finalYears: 'finalYear', imageTypes: 'imageType', numInspec: 'numInspec',
        bdcCollections: 'bdcConfig.collection', bdcSelectionStrategies: 'bdcConfig.selectionStrategy',
        bdcDefaultProfiles: 'bdcConfig.defaultProfile', bdcBufferRadii: 'bdcConfig.bufferRadiusM',
        zoomLevels: 'zoomLevel', landUses: 'landUse'
    };
    const numeric = new Set(['initialYears', 'finalYears', 'numInspec', 'bdcBufferRadii', 'zoomLevels']);
    const entries = await Promise.all(Object.keys(fields).map(async key => {
        const values = await campaigns.distinct(fields[key], key.startsWith('bdc') ? { imagerySource: 'bdc' } : {});
        const clean = values.filter(value => numeric.has(key)
            ? typeof value === 'number' && Number.isFinite(value)
            : typeof value === 'string' && value.trim().length > 0);
        clean.sort(numeric.has(key) ? (a, b) => a - b : undefined);
        return [key, clean];
    }));
    const data = Object.fromEntries(entries);
    const [bdc, legacy, defaultZoom] = await Promise.all([
        campaigns.count({ imagerySource: 'bdc' }), campaigns.count({ imagerySource: { $ne: 'bdc' } }),
        campaigns.count({ zoomLevel: null })
    ]);
    data.imagerySources = [bdc ? 'bdc' : null, legacy ? 'legacy' : null].filter(Boolean);
    if (defaultZoom && !data.zoomLevels.includes(13)) data.zoomLevels.push(13);
    data.zoomLevels = data.zoomLevels.filter(value => Number.isInteger(value) && value >= 10 && value <= 18).sort((a, b) => a - b);
    return data;
}

async function summary(campaigns, points) {
    const documents = await campaigns.find({}).project({ _id: 1, numInspec: 1 }).toArray();
    const stats = await pointStats(points, documents);
    const result = { total: documents.length, active: 0, completed: 0, totalPoints: 0, totalInspections: 0 };
    for (const entry of stats.values()) {
        result.totalPoints += entry.totalPoints;
        result.totalInspections += entry.totalInspections;
        if (matchesStatus(entry, 'completed')) result.completed++;
        else if (entry.totalPoints > 0) result.active++;
    }
    return result;
}

module.exports = { parseQuery, pointStats, matchesStatus, list, filterOptions, summary };
