'use strict';

const COLLECTIONS = Object.freeze({ landsat: 'landsat-2', 'sentinel-2': 'S2_L2A-1' });
const CONFIG_FIELDS = ['schemaVersion', 'collection', 'selectionStrategy', 'bufferRadiusM',
    'periodPolicy', 'profiles', 'defaultProfile', 'selectionRevision'];

function object(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function copyConfig(config) {
    if (!object(config)) return null;
    const result = {};
    CONFIG_FIELDS.forEach(field => {
        if (config[field] !== undefined) result[field] = Array.isArray(config[field]) ? config[field].slice() : config[field];
    });
    return result;
}

function normalizeBdcConfig(campaign) {
    if (!campaign || campaign.imagerySource !== 'bdc') return {};
    return { imagerySource: 'bdc', bdcConfig: copyConfig(campaign.bdcConfig) };
}

function selectionPolicy(campaign) {
    const config = campaign.bdcConfig || {};
    return JSON.stringify([campaign.imageType, config.collection, config.selectionStrategy,
        config.bufferRadiusM, config.periodPolicy]);
}

function validateBdcConfig(input, catalog, previous) {
    const campaign = Object.assign({}, previous, input);
    const source = campaign.imagerySource;
    const invalid = (field, error) => ({ field, error });
    const protectedFields = source === 'bdc' || (previous && previous.imagerySource === 'bdc')
        ? ['imagerySource', 'bdcConfig', 'imageType', 'useDynamicMaps', 'wmsConfig'] : ['imagerySource', 'bdcConfig'];
    const dottedField = Object.keys(input).find(field => field.includes('.') && protectedFields.includes(field.split('.')[0]));
    if (dottedField) return invalid(dottedField, 'Envie a configuração completa do campo, sem caminhos pontuados.');
    if (source !== undefined && source !== null && source !== '' && source !== 'bdc') {
        return invalid('imagerySource', 'Fonte de imagens inválida.');
    }
    if (source !== 'bdc') {
        return { value: previous && previous.bdcConfig
            ? { imagerySource: null, bdcConfig: copyConfig(previous.bdcConfig) } : {} };
    }
    if (!Object.prototype.hasOwnProperty.call(COLLECTIONS, campaign.imageType)) {
        return invalid('imageType', 'O BDC requer o sensor Landsat ou Sentinel-2.');
    }
    if (campaign.useDynamicMaps !== true) {
        return invalid('useDynamicMaps', 'A fonte BDC requer mapas dinâmicos.');
    }
    const initialYear = Number(campaign.initialYear), finalYear = Number(campaign.finalYear);
    if (!Number.isInteger(initialYear) || !Number.isInteger(finalYear) || initialYear < 1970
        || finalYear > new Date().getFullYear() || initialYear > finalYear) {
        return invalid('initialYear', 'Informe um intervalo de anos entre 1970 e o ano atual, em ordem crescente.');
    }
    if (campaign.wmsConfig && campaign.wmsConfig.enabled) {
        return invalid('wmsConfig', 'A fonte BDC não pode ser combinada com WMS.');
    }
    const config = campaign.bdcConfig;
    if (!object(config)) return invalid('bdcConfig', 'Informe a configuração BDC.');
    if (config.schemaVersion !== 1) return invalid('bdcConfig.schemaVersion', 'Versão da configuração BDC inválida.');
    if (config.collection !== COLLECTIONS[campaign.imageType]) {
        return invalid('bdcConfig.collection', 'Coleção BDC incompatível com o sensor selecionado.');
    }
    if (!['local_cloud', 'local_unusable'].includes(config.selectionStrategy)) {
        return invalid('bdcConfig.selectionStrategy', 'Estratégia de seleção BDC inválida.');
    }
    if (typeof config.bufferRadiusM !== 'number' || !Number.isFinite(config.bufferRadiusM)
        || config.bufferRadiusM < 100 || config.bufferRadiusM > 5000) {
        return invalid('bdcConfig.bufferRadiusM', 'O raio de qualidade deve estar entre 100 e 5.000 metros.');
    }
    if (config.periodPolicy !== 'tvi-seasonal-v1') {
        return invalid('bdcConfig.periodPolicy', 'Política de períodos BDC inválida.');
    }
    const collection = catalog && Array.isArray(catalog.collections)
        && catalog.collections.find(entry => entry.id === config.collection);
    if (!collection || !Array.isArray(collection.profiles) || !collection.profiles.length) {
        return invalid('bdcConfig.collection', 'O catálogo BDC não disponibilizou as composições desta coleção.');
    }
    const allowed = new Set(collection.profiles.map(profile => profile.id));
    if (!Array.isArray(config.profiles) || !config.profiles.length || config.profiles.length > 32
        || config.profiles.some(profile => typeof profile !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(profile) || !allowed.has(profile))) {
        return invalid('bdcConfig.profiles', 'Selecione composições disponíveis no catálogo BDC da coleção.');
    }
    if (!config.profiles.includes(config.defaultProfile)) {
        return invalid('bdcConfig.defaultProfile', 'A composição padrão deve pertencer às composições selecionadas.');
    }
    const priorRevision = previous && previous.bdcConfig && previous.bdcConfig.selectionRevision;
    const revision = Number.isSafeInteger(priorRevision) && priorRevision > 0 ? priorRevision : 0;
    const unchanged = previous && previous.imagerySource === 'bdc' && selectionPolicy(previous) === selectionPolicy(campaign);
    const value = copyConfig(config);
    value.profiles = [...new Set(config.profiles)];
    value.selectionRevision = unchanged && revision ? revision : revision + 1;
    return { value: { imagerySource: 'bdc', bdcConfig: value } };
}

module.exports = { normalizeBdcConfig, validateBdcConfig };
