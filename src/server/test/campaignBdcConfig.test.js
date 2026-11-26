'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeBdcConfig, validateBdcConfig } = require('../services/campaignBdcConfig');

const catalog = { collections: [
    { id: 'landsat-2', profiles: [{ id: 'landsat-tvi-true' }, { id: 'landsat-tvi-ndvi' }] },
    { id: 'S2_L2A-1', profiles: [{ id: 'tvi-rgb' }, { id: 'tvi-ndvi' }] }
] };

function campaign(overrides) {
    return Object.assign({ imagerySource: 'bdc', imageType: 'landsat', useDynamicMaps: true,
        initialYear: 2020, finalYear: 2021,
        bdcConfig: { schemaVersion: 1, collection: 'landsat-2', selectionStrategy: 'local_cloud',
            bufferRadiusM: 1000, periodPolicy: 'tvi-seasonal-v1',
            profiles: ['landsat-tvi-true'], defaultProfile: 'landsat-tvi-true' }
    }, overrides);
}

test('campanha legada conserva a resolução anterior e não recebe configuração BDC', () => {
    for (const imageType of ['landsat', 'sentinel-2', 'planet', 'wayback', 'wms']) {
        assert.deepEqual(normalizeBdcConfig({ imageType }), {});
        assert.deepEqual(validateBdcConfig({ imageType }, null).value, {});
    }
});

test('criação valida os perfis reais e controla a revisão no servidor', () => {
    const input = campaign();
    input.bdcConfig.selectionRevision = 999;
    const result = validateBdcConfig(input, catalog);
    assert.equal(result.error, undefined);
    assert.equal(result.value.bdcConfig.selectionRevision, 1);
    assert.deepEqual(result.value.bdcConfig.profiles, ['landsat-tvi-true']);
    assert.equal(input.bdcConfig.selectionRevision, 999);
});

test('perfil e composição padrão não alteram a revisão de seleção', () => {
    const previous = campaign();
    previous.bdcConfig.selectionRevision = 4;
    const input = campaign();
    input.bdcConfig.profiles = ['landsat-tvi-ndvi', 'landsat-tvi-true'];
    input.bdcConfig.defaultProfile = 'landsat-tvi-ndvi';
    assert.equal(validateBdcConfig(input, catalog, previous).value.bdcConfig.selectionRevision, 4);
});

test('mudança da política incrementa a revisão sem aceitar revisão fornecida pelo cliente', () => {
    const previous = campaign();
    previous.bdcConfig.selectionRevision = 4;
    for (const change of [{ bufferRadiusM: 1500 }, { selectionStrategy: 'local_unusable' }]) {
        const input = campaign();
        Object.assign(input.bdcConfig, change, { selectionRevision: 1 });
        assert.equal(validateBdcConfig(input, catalog, previous).value.bdcConfig.selectionRevision, 5);
    }
});

test('desativação e reativação preservam o contador de revisão anterior', () => {
    const previous = campaign();
    previous.bdcConfig.selectionRevision = 4;
    const disabled = Object.assign({}, previous, validateBdcConfig({ imagerySource: null }, null, previous).value);
    assert.deepEqual(normalizeBdcConfig(disabled), {});
    assert.equal(validateBdcConfig(campaign(), catalog, disabled).value.bdcConfig.selectionRevision, 5);
});

for (const [name, change, field] of [
    ['sensor incompatível', { imageType: 'planet' }, 'imageType'],
    ['mapa estático', { useDynamicMaps: false }, 'useDynamicMaps'],
    ['intervalo de anos invertido', { initialYear: 2022, finalYear: 2021 }, 'initialYear'],
    ['intervalo de anos ilimitado', { initialYear: 0, finalYear: 99999999 }, 'initialYear'],
    ['sobreposição WMS', { wmsConfig: { enabled: true } }, 'wmsConfig'],
    ['coleção incompatível', { bdcConfig: { collection: 'S2_L2A-1' } }, 'bdcConfig.collection'],
    ['raio abaixo do limite', { bdcConfig: { bufferRadiusM: 99 } }, 'bdcConfig.bufferRadiusM'],
    ['raio acima do limite', { bdcConfig: { bufferRadiusM: 5001 } }, 'bdcConfig.bufferRadiusM'],
    ['raio não numérico', { bdcConfig: { bufferRadiusM: '1000' } }, 'bdcConfig.bufferRadiusM'],
    ['perfil desconhecido', { bdcConfig: { profiles: ['gee-profile'] } }, 'bdcConfig.profiles'],
    ['padrão fora da lista', { bdcConfig: { defaultProfile: 'landsat-tvi-ndvi' } }, 'bdcConfig.defaultProfile'],
    ['política desconhecida', { bdcConfig: { periodPolicy: 'other' } }, 'bdcConfig.periodPolicy'],
    ['versão desconhecida', { bdcConfig: { schemaVersion: 2 } }, 'bdcConfig.schemaVersion']
]) {
    test('rejeita ' + name, () => {
        const input = campaign();
        Object.assign(input, change, { bdcConfig: Object.assign({}, input.bdcConfig, change.bdcConfig) });
        const result = validateBdcConfig(input, catalog);
        assert.equal(result.field, field);
        assert.ok(result.error);
    });
}

test('catálogo ausente ou sem perfis impede configuração BDC', () => {
    assert.ok(validateBdcConfig(campaign(), null).error);
    assert.ok(validateBdcConfig(campaign(), { collections: [{ id: 'landsat-2' }] }).error);
});

test('normalização não compartilha referências mutáveis com a campanha persistida', () => {
    const input = campaign();
    input.bdcConfig.selectionRevision = 2;
    const config = normalizeBdcConfig(input);
    config.bdcConfig.profiles.push('other');
    assert.deepEqual(input.bdcConfig.profiles, ['landsat-tvi-true']);
});

const { abrirModal } = require('./helpers/campaignFormModal');

test('formulário legado não consulta BDC; ativação usa catálogo e configura fonte explícita', () => {
    const input = { _id: 'new', landUse: [], properties: ['uf'], imageType: 'landsat' };
    const opened = abrirModal(input, true, { '/api/bdc/catalog': { data: catalog } });
    assert.equal(opened.requisicoes.filter(request => request.url === '/api/bdc/catalog').length, 0);
    opened.$scope.bdc.source = 'bdc';
    opened.$scope.onImagerySourceChange();
    assert.equal(input.imagerySource, 'bdc');
    assert.equal(input.useDynamicMaps, true);
    assert.equal(input.bdcConfig.collection, 'landsat-2');
    assert.equal(input.bdcConfig.defaultProfile, 'landsat-tvi-true');
    assert.equal(opened.$scope.bdc.error, null);
});

test('formulário reabre BDC preservando política, composições e revisão', () => {
    const input = campaign({ _id: 'existing', landUse: [], properties: ['uf'] });
    input.bdcConfig.selectionRevision = 7;
    input.bdcConfig.bufferRadiusM = 1200;
    input.bdcConfig.profiles = ['landsat-tvi-ndvi'];
    input.bdcConfig.defaultProfile = 'landsat-tvi-ndvi';
    const original = structuredClone(input.bdcConfig);
    const opened = abrirModal(input, false, { '/api/bdc/catalog': { data: catalog } });
    assert.deepEqual(input.bdcConfig, original);
    assert.equal(opened.$scope.bdc.source, 'bdc');
    opened.$scope.toggleBdcProfile({ id: 'landsat-tvi-true' });
    assert.deepEqual(input.bdcConfig.profiles, ['landsat-tvi-ndvi', 'landsat-tvi-true']);
    assert.equal(input.bdcConfig.selectionRevision, 7);
});

test('falha do catálogo não troca BDC por fonte legada nem inventa composições', () => {
    const input = campaign({ _id: 'existing', landUse: [], properties: ['uf'] });
    const opened = abrirModal(input, false, { '/api/bdc/catalog': new Error('indisponível') });
    assert.equal(input.imagerySource, 'bdc');
    assert.ok(opened.$scope.bdc.error);
    assert.equal(opened.$scope.bdc.loading, false);
    assert.equal(opened.$scope.bdcProfiles().length, 0);
});

test('troca de sensor limpa composições incompatíveis e requer escolha do catálogo correspondente', () => {
    const input = campaign({ _id: 'existing', landUse: [], properties: ['uf'] });
    input.bdcConfig.selectionRevision = 7;
    const opened = abrirModal(input, false, { '/api/bdc/catalog': { data: catalog } });
    input.imageType = 'sentinel-2';
    opened.$scope.onImageTypeChange();
    assert.equal(input.bdcConfig.collection, 'S2_L2A-1');
    assert.equal(input.bdcConfig.profiles.length, 0);
    assert.ok(opened.$scope.bdcValidationError());
    opened.$scope.toggleBdcProfile({ id: 'tvi-rgb' });
    assert.equal(opened.$scope.bdcValidationError(), null);
    assert.equal(input.bdcConfig.selectionRevision, 7);
});
