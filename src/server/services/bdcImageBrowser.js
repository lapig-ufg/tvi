'use strict';

const collections = { landsat: 'landsat-2', 'sentinel-2': 'S2_L2A-1' };
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9_.-]{1,180}$/.test(value) && !['.', '..'].includes(value);
const failure = (message, status = 400) => Object.assign(new Error(message), { status });

function integer(value, fallback, min, max) {
    if (value === undefined) return fallback;
    if (typeof value !== 'string' || !/^\d+$/.test(value)) throw failure('Parâmetro numérico inválido.');
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < min || number > max) throw failure('Parâmetro numérico fora dos limites.');
    return number;
}

function date(value, year) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number(value.slice(0, 4)) !== year) throw failure('Data inválida para o ano selecionado.');
    const timestamp = Date.parse(value + 'T00:00:00Z');
    if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) throw failure('Data inválida.');
    return value;
}

function parameters(campaign, point, query, paginated) {
    const config = campaign && campaign.bdcConfig;
    if (!campaign || campaign.imagerySource !== 'bdc' || !config || config.collection !== collections[campaign.imageType]
        || !collections[campaign.imageType] || !Array.isArray(config.profiles) || !config.profiles.some(identifier)) {
        throw failure('Exploração BDC indisponível para esta campanha.', 404);
    }
    if (!point || point.campaign !== campaign._id || !Number.isFinite(point.lon) || !Number.isFinite(point.lat)
        || Math.abs(point.lon) > 180 || Math.abs(point.lat) > 80) throw failure('Coordenadas do ponto inválidas.');
    const allowed = ['year', 'period', 'start', 'end'].concat(paginated ? ['page', 'limit', 'maxCloud'] : []);
    if (Object.keys(query).some(key => !allowed.includes(key))) throw failure('Parâmetro de exploração inválido.');
    const year = integer(query.year, null, 1000, 9999);
    if (!year || !Number.isInteger(Number(campaign.initialYear)) || !Number.isInteger(Number(campaign.finalYear))
        || year < Number(campaign.initialYear) || year > Number(campaign.finalYear)) throw failure('Ano fora do período da campanha.');
    const period = query.period || 'YEAR';
    if (!['YEAR', 'DRY', 'WET', 'CUSTOM'].includes(period)) throw failure('Período inválido.');
    if (period !== 'CUSTOM' && (query.start !== undefined || query.end !== undefined)) throw failure('Datas livres exigem período personalizado.');
    const start = period === 'CUSTOM' ? date(query.start, year) : year + (period === 'DRY' ? '-06-01' : '-01-01');
    const end = period === 'CUSTOM' ? date(query.end, year) : year + (period === 'DRY' ? '-10-30' : period === 'WET' ? '-04-30' : '-12-31');
    if (start > end) throw failure('A data inicial deve anteceder a data final.');
    return { collection: config.collection, profiles: config.profiles.filter(identifier), year, period, start, end,
        page: integer(query.page, 1, 1, 1000), limit: integer(query.limit, 12, 1, 24), maxCloud: integer(query.maxCloud, 100, 0, 100),
        bbox: [Math.max(-180, point.lon - 0.0001), point.lat - 0.0001, Math.min(180, point.lon + 0.0001), point.lat + 0.0001] };
}

function ringPosition(ring, lon, lat) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const a = ring[i], b = ring[j];
        const cross = (lon - a[0]) * (b[1] - a[1]) - (lat - a[1]) * (b[0] - a[0]);
        if (Math.abs(cross) < 1e-10 && lon >= Math.min(a[0], b[0]) && lon <= Math.max(a[0], b[0])
            && lat >= Math.min(a[1], b[1]) && lat <= Math.max(a[1], b[1])) return 0;
        if ((a[1] > lat) !== (b[1] > lat) && lon < (b[0] - a[0]) * (lat - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    return inside ? 1 : -1;
}

function covers(geometry, point) {
    if (!geometry || !['Polygon', 'MultiPolygon'].includes(geometry.type)) return false;
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    if (!Array.isArray(polygons) || polygons.length > 100) return false;
    let vertices = 0;
    if (!polygons.every(polygon => Array.isArray(polygon) && polygon.length > 0 && polygon.length <= 100 && polygon.every(ring => {
        if (!Array.isArray(ring) || ring.length < 4) return false;
        vertices += ring.length;
        return vertices <= 20000 && ring.every(p => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1])
            && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90);
    }))) return false;
    return polygons.some(polygon => ringPosition(polygon[0], point.lon, point.lat) >= 0
        && !polygon.slice(1).some(ring => ringPosition(ring, point.lon, point.lat) > 0));
}

function presentItem(item, params, point) {
    if (!item || !identifier(item.id) || item.collection !== params.collection || !covers(item.geometry, point)) return null;
    const timestamp = item.properties && typeof item.properties.datetime === 'string' ? Date.parse(item.properties.datetime) : NaN;
    if (!Number.isFinite(timestamp) || timestamp < Date.parse(params.start + 'T00:00:00Z')
        || timestamp >= Date.parse(params.end + 'T00:00:00Z') + 86400000) return null;
    const cloud = item.properties['eo:cloud_cover'];
    return { id: item.id, datetime: new Date(timestamp).toISOString(), cloudPercent: Number.isFinite(cloud) && cloud >= 0 && cloud <= 100 ? cloud : null };
}

function periodInfo(params) {
    return { collection: params.collection, year: params.year, period: params.period, startDate: params.start, endDate: params.end };
}

function create(client, options = {}) {
    const metadata = new Map();
    const now = options.now || Date.now;
    async function itemDetail(collection, id) {
        const key = collection + '/' + id;
        const saved = metadata.get(key);
        if (saved && saved.expires > now()) return saved.promise;
        if (saved) metadata.delete(key);
        while (metadata.size >= 64) metadata.delete(metadata.keys().next().value);
        const entry = { expires: now() + 60000 };
        entry.promise = Promise.resolve().then(() => client.getItem(collection, id)).catch(error => {
            if (metadata.get(key) === entry) metadata.delete(key);
            throw error;
        });
        metadata.set(key, entry);
        return entry.promise;
    }
    async function validated(campaign, point, id, query) {
        const params = parameters(campaign, point, query, false);
        if (!identifier(id)) throw failure('Aquisição inválida.');
        const detail = await itemDetail(params.collection, id);
        const item = detail && presentItem(detail.item, params, point);
        if (!item || item.id !== id || !detail.collection || detail.collection.id !== params.collection) throw failure('Aquisição não disponível para este ponto e período.', 404);
        const profiles = Array.isArray(detail.profiles) ? detail.profiles.filter(profile => profile && identifier(profile.id)
            && params.profiles.includes(profile.id)).map(profile => ({ id: profile.id, label: typeof profile.label === 'string' ? profile.label.slice(0, 200) : profile.id })) : [];
        if (!profiles.length) throw failure('Nenhuma composição permitida para esta aquisição.', 404);
        return { params, item, profiles };
    }
    return {
        async search(campaign, point, query = {}) {
            const params = parameters(campaign, point, query, true);
            const result = await client.searchImages(params);
            if (!result || !Array.isArray(result.items) || result.items.length > params.limit) throw failure('Resposta de busca BDC inválida.', 502);
            const seen = new Set();
            const items = result.items.map(item => presentItem(item, params, point)).filter(item => {
                if (!item || seen.has(item.id)) return false;
                seen.add(item.id);
                return true;
            });
            return Object.assign(periodInfo(params), { items, page: params.page, limit: params.limit,
                nextPage: result.next_page === params.page + 1 && result.next_page <= 1000 ? result.next_page : null });
        },
        async detail(campaign, point, id, query = {}) {
            const value = await validated(campaign, point, id, query);
            const suffix = '?year=' + value.params.year + '&period=' + value.params.period
                + (value.params.period === 'CUSTOM' ? '&start=' + value.params.start + '&end=' + value.params.end : '');
            const tiles = Object.create(null);
            value.profiles.forEach(profile => {
                tiles[profile.id] = '/service/points/' + encodeURIComponent(point._id) + '/bdc-images/' + encodeURIComponent(id)
                    + '/tiles/' + encodeURIComponent(profile.id) + '/{z}/{x}/{y}.png' + suffix;
            });
            return Object.assign(periodInfo(value.params), value.item, { profiles: value.profiles, tiles });
        },
        async tile(campaign, point, id, profile, coords, query = {}) {
            if (!identifier(profile) || !Array.isArray(coords) || coords.length !== 3) throw failure('Tile BDC inválido.');
            const xyz = coords.map(value => integer(value, null, 0, 2 ** 18 - 1));
            if (xyz.some(value => value === null) || xyz[0] < 6 || xyz[0] > 18 || xyz[1] >= 2 ** xyz[0] || xyz[2] >= 2 ** xyz[0]) throw failure('Tile BDC inválido.');
            const value = await validated(campaign, point, id, query);
            if (!value.profiles.some(entry => entry.id === profile)) throw failure('Composição indisponível.', 404);
            const data = await client.getTile(value.params.collection, id, profile, ...xyz);
            if (!Buffer.isBuffer(data) || data.length < 8 || data.length > 8 * 1024 * 1024
                || !data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) throw failure('Imagem BDC inválida.', 502);
            return data;
        }
    };
}

module.exports = function(app) {
    let browser;
    function current() { if (!browser) browser = create(app.services.bdcTilesClient); return browser; }
    return { search(...args) { return current().search(...args); }, detail(...args) { return current().detail(...args); }, tile(...args) { return current().tile(...args); } };
};
module.exports.create = create;
