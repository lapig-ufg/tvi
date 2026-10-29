/**
 * Guarda estática da fiação do zoom inicial da grade no cliente:
 *
 *   - as telas de inspeção (temporal, supervisor e admin-temporal) não fixam
 *     mais `zoomLevel: 13` e aplicam o valor devolvido por
 *     `GET /service/campaign/config` antes de montar a grade;
 *   - o formulário de campanha expõe `campaign.zoomLevel` com os mesmos
 *     limites validados no servidor (services/campaignZoomLevel.js), evitando
 *     divergência entre a validação do navegador e a da API;
 *   - campanha nova e campanha antiga sem o campo recebem o padrão no cliente.
 *
 * Execução:
 *   cd src/server && npm test
 *   ou
 *   node --test src/server/test/campaignZoomLevelClient.test.js
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const CLIENT_DIR = path.join(__dirname, '..', '..', 'client');
const zoom = require(path.join(__dirname, '..', 'services', 'campaignZoomLevel'));

function read(relative) {
    return fs.readFileSync(path.join(CLIENT_DIR, relative), 'utf8');
}

test('telas de inspeção: zoom inicial vem da campanha, sem valor fixo 13', () => {
    ['controllers/temporal.js', 'controllers/supervisor.js', 'controllers/admin-temporal.js'].forEach((file) => {
        const source = read(file);
        assert.doesNotMatch(source, /zoomLevel:\s*13\b/, `${file} ainda fixa zoomLevel: 13`);
        assert.match(source, /zoomLevel: (?:\$rootScope\.user\.)?campaign\.zoomLevel \|\| 13,/, `${file} não lê campaign.zoomLevel com padrão 13`);
    });
});

test('arquivos do cliente envolvidos continuam sintaticamente válidos', () => {
    [
        'controllers/temporal.js', 'controllers/supervisor.js', 'controllers/admin-temporal.js',
        'controllers/admin-modals.js', 'controllers/admin-campaign.js',
        'directives/waybackMap.js', 'services/wayback-grid-core.js'
    ].forEach((file) => {
        assert.doesNotThrow(() => new vm.Script(read(file), { filename: file }), `${file} não compila`);
    });
});

test('loadCampaignConfig aplica config.zoomLevel ao config da tela', () => {
    ['controllers/temporal.js', 'controllers/supervisor.js'].forEach((file) => {
        const source = read(file);
        const start = source.indexOf('var loadCampaignConfig = function');
        assert.ok(start !== -1, `${file}: loadCampaignConfig não encontrada`);
        const end = source.indexOf('loadPoint', start);
        const body = source.slice(start, end === -1 ? undefined : end);
        assert.match(body, /\$scope\.config\.zoomLevel\s*=\s*config\.zoomLevel/, `${file}: loadCampaignConfig não aplica config.zoomLevel`);
    });
});

test('formulário de campanha: campo zoomLevel com os limites do servidor', () => {
    const template = read('views/campaign-form-modal.tpl.html');
    const input = template.match(/<input[^>]*ng-model="campaign\.zoomLevel"[^>]*>/);
    assert.ok(input, 'input de campaign.zoomLevel ausente no formulário');
    assert.match(input[0], /type="number"/);
    assert.match(input[0], new RegExp(`min="${zoom.MIN_ZOOM_LEVEL}"`), 'min difere de MIN_ZOOM_LEVEL');
    assert.match(input[0], new RegExp(`max="${zoom.MAX_ZOOM_LEVEL}"`), 'max difere de MAX_ZOOM_LEVEL');
    assert.match(input[0], /\brequired\b/);
});

test('cadastro: padrão do zoom em campanha nova e em campanha sem o campo', () => {
    const list = read('controllers/admin-campaign.js');
    const start = list.indexOf('$scope.newCampaign = {');
    assert.ok(start !== -1, 'newCampaign não encontrado em admin-campaign.js');
    const block = list.slice(start, list.indexOf('};', start));
    assert.match(block, new RegExp(`zoomLevel:\\s*${zoom.DEFAULT_ZOOM_LEVEL}\\b`), 'newCampaign sem zoomLevel padrão');

    const modal = read('controllers/admin-modals.js');
    assert.match(modal, new RegExp(`\\$scope\\.campaign\\.zoomLevel\\s*=\\s*${zoom.DEFAULT_ZOOM_LEVEL}\\b`), 'modal não inicializa zoomLevel ausente');
});
