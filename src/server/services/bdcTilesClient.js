'use strict';

function create(transport, credentials) {
    async function request(method, url, data, authenticated, options) {
        const config = Object.assign({ method, url, data, timeout: 15000, maxRedirects: 0 }, options);
        if (authenticated) {
            const auth = credentials && await credentials();
            if (!auth || typeof auth.token !== 'string' || auth.token.length < 32 || /\s/.test(auth.token)) {
                const error = new Error('Autenticação do serviço BDC indisponível.');
                error.code = 'BDC_SERVICE_AUTH_UNAVAILABLE';
                throw error;
            }
            config.headers = { Authorization: 'Bearer ' + auth.token };
        }
        try {
            const response = await transport.request(config);
            return response.data;
        } catch (cause) {
            const status = cause.response && cause.response.status;
            const detail = cause.response && cause.response.data && cause.response.data.detail;
            const unconfigured = detail && detail.code === 'bdc_service_auth_unconfigured';
            const error = new Error(unconfigured ? 'Autenticação do serviço BDC não provisionada.' : 'Não foi possível consultar o serviço BDC.');
            error.code = unconfigured ? 'BDC_SERVICE_AUTH_UNAVAILABLE' :
                (status === 401 || status === 403 ? 'BDC_SERVICE_AUTH_REJECTED' : 'BDC_TILES_UNAVAILABLE');
            error.status = Number.isInteger(status) && status >= 400 && status <= 599 ? status : 502;
            const retryAfter = cause.response && cause.response.headers && cause.response.headers['retry-after'];
            if ([429, 503].includes(status) && /^\d{1,3}$/.test(String(retryAfter)) && Number(retryAfter) <= 120) {
                error.retryAfterSeconds = Number(retryAfter);
            }
            throw error;
        }
    }
    return {
        getCatalog() { return request('get', '/api/bdc/collections'); },
        async searchImages(params) {
            if (!params || !['landsat-2', 'S2_L2A-1'].includes(params.collection)
                || !Array.isArray(params.bbox) || params.bbox.length !== 4 || !params.bbox.every(Number.isFinite)
                || ![params.start, params.end].every(value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value))
                || !Number.isInteger(params.page) || params.page < 1 || params.page > 1000
                || !Number.isInteger(params.limit) || params.limit < 1 || params.limit > 24
                || !Number.isInteger(params.maxCloud) || params.maxCloud < 0 || params.maxCloud > 100) {
                throw Object.assign(new Error('Consulta de imagens BDC inválida.'), { status: 400 });
            }
            return request('get', '/api/bdc/search', undefined, false, {
                params: { collection: params.collection, bbox: params.bbox.join(','), start: params.start, end: params.end,
                    page: params.page, limit: params.limit, max_cloud: params.maxCloud }, maxContentLength: 4 * 1024 * 1024
            });
        },
        async getItem(collection, item) {
            if (!['landsat-2', 'S2_L2A-1'].includes(collection)
                || typeof item !== 'string' || !/^[A-Za-z0-9_.-]{1,180}$/.test(item) || ['.', '..'].includes(item)) {
                throw Object.assign(new Error('Aquisição BDC inválida.'), { status: 400 });
            }
            return request('get', '/api/bdc/items/' + encodeURIComponent(collection) + '/' + encodeURIComponent(item),
                undefined, false, { maxContentLength: 1024 * 1024 });
        },
        createJob(params) { return request('post', '/api/bdc/selection-jobs', params, true); },
        async getTile(collection, item, profile, z, x, y) {
            if (!['landsat-2', 'S2_L2A-1'].includes(collection)
                || ![item, profile].every(value => typeof value === 'string' && /^[A-Za-z0-9_.-]{1,180}$/.test(value) && !['.', '..'].includes(value))
                || ![z, x, y].every(Number.isSafeInteger) || z < 6 || z > 18 || x < 0 || y < 0 || x >= 2 ** z || y >= 2 ** z) {
                throw Object.assign(new Error('Tile BDC inválido.'), { status: 400 });
            }
            const path = '/api/bdc/tiles/' + encodeURIComponent(collection) + '/' + encodeURIComponent(item)
                + '/' + z + '/' + x + '/' + y + '.png?profile=' + encodeURIComponent(profile);
            return request('get', path, undefined, false, { responseType: 'arraybuffer', maxContentLength: 8 * 1024 * 1024 });
        },
        async getJob(id) {
            if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(id)) {
                const error = new Error('Identificador de trabalho BDC inválido.');
                error.code = 'BDC_INVALID_JOB_ID';
                throw error;
            }
            return request('get', '/api/bdc/selection-jobs/' + id, undefined, true);
        }
    };
}

module.exports = function (app) {
    const transport = require('axios').create({ baseURL: app.config.tilesApi.baseUrl });
    return create(transport, async function () {
        const provider = app.services.bdcServiceCredentials;
        return provider ? provider.get() : null;
    });
};
module.exports.create = create;
