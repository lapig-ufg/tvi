'use strict';
const fs = require('fs');

function readToken(environment, readFile) {
    if (environment.TILES_BDC_SERVICE_TOKEN !== undefined) return environment.TILES_BDC_SERVICE_TOKEN;
    if (environment.TILES_BDC_SERVICE_TOKEN_FILE) {
        try {
            const value = readFile(environment.TILES_BDC_SERVICE_TOKEN_FILE, 'utf8');
            if (typeof value === 'string' && value.length <= 4096) return value.trim();
        } catch (error) { return undefined; }
    }
    return undefined;
}

function create(readToken) {
    return {
        get() {
            const token = readToken();
            if (typeof token !== 'string' || token.length < 32 || /\s/.test(token)) {
                const error = new Error('Autenticação do serviço BDC não provisionada.');
                error.code = 'BDC_SERVICE_AUTH_UNAVAILABLE';
                throw error;
            }
            return { token };
        }
    };
}

module.exports = function () {
    return create(() => readToken(process.env, fs.readFileSync));
};
module.exports.create = create;
module.exports.readToken = readToken;
