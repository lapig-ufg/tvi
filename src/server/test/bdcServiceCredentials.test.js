'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const factory = require('../services/bdcServiceCredentials');

test('credencial BDC exige token dedicado provisionado no processo', () => {
    for (const value of [undefined, '', 'short']) {
        assert.throws(() => factory.create(() => value).get(), { code: 'BDC_SERVICE_AUTH_UNAVAILABLE' });
    }
});

test('provedor observa rotação sem persistir token ou buscar usuário administrativo', () => {
    let value = 'test-service-token-with-sufficient-entropy';
    const provider = factory.create(() => value);
    assert.deepEqual(provider.get(), { token: value });
    value = 'rotated-service-token-with-sufficient-entropy';
    assert.deepEqual(provider.get(), { token: value });
});

test('segredo montado é lido sem configurar valor em arquivo da aplicação', () => {
    const read = name => { assert.equal(name, '/run/secrets/bdc'); return 'test-mounted-token-with-sufficient-entropy\n'; };
    assert.equal(factory.readToken({ TILES_BDC_SERVICE_TOKEN_FILE: '/run/secrets/bdc' }, read), 'test-mounted-token-with-sufficient-entropy');
    assert.equal(factory.readToken({ TILES_BDC_SERVICE_TOKEN: 'explicit', TILES_BDC_SERVICE_TOKEN_FILE: '/run/secrets/bdc' }, () => assert.fail('não deve ler arquivo')), 'explicit');
    assert.equal(factory.readToken({ TILES_BDC_SERVICE_TOKEN_FILE: '/missing' }, () => { throw new Error('private path'); }), undefined);
});
