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
            throw error;
        }
    }
    return {
        getCatalog() { return request('get', '/api/bdc/collections'); },
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
