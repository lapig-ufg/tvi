/**
 * Guarda estática da fiação das colunas do ponto por idioma nas telas do
 * intérprete (temporal) e do supervisor: carga do núcleo, normalização da
 * configuração da campanha, recálculo das linhas ao trocar ponto,
 * configuração ou idioma, e renderização como texto.
 *
 * Execução:
 *   cd src/server && npm test
 *   ou
 *   node --test src/server/test/pointPropertyDisplayClient.test.js
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const CLIENT_DIR = path.join(__dirname, '..', '..', 'client');
const TELAS = [
    { controller: 'controllers/temporal.js', template: 'views/temporal.tpl.html' },
    { controller: 'controllers/supervisor.js', template: 'views/supervisor.tpl.html' }
];

function read(relative) {
    return fs.readFileSync(path.join(CLIENT_DIR, relative), 'utf8');
}

test('index.html carrega o núcleo das colunas do ponto', () => {
    assert.match(read('index.html'), /<script src="services\/point-property-display-core\.js"><\/script>/);
});

test('temporal e supervisor normalizam config.propertyDisplay na montagem e em loadCampaignConfig', () => {
    TELAS.forEach(({ controller }) => {
        const fonte = read(controller);
        assert.match(fonte, /propertyDisplay: PointPropertyDisplayCore\.normalize\(\$rootScope\.user\.campaign\.propertyDisplay\)/,
            `${controller}: montagem do config sem propertyDisplay`);
        const inicio = fonte.indexOf('var loadCampaignConfig = function');
        assert.ok(inicio !== -1, `${controller}: loadCampaignConfig não encontrada`);
        const corpo = fonte.slice(inicio, fonte.indexOf('loadPoint', inicio));
        assert.match(corpo, /\$scope\.config\.propertyDisplay\s*=\s*PointPropertyDisplayCore\.normalize\(config\.propertyDisplay\)/,
            `${controller}: loadCampaignConfig não aplica propertyDisplay`);
    });
});

test('temporal e supervisor recalculam pointPropertyRows ao trocar ponto, configuração e idioma', () => {
    TELAS.forEach(({ controller }) => {
        const fonte = read(controller);
        assert.match(fonte, /function refreshPointPropertyRows\(\)/, `${controller}: refreshPointPropertyRows ausente`);
        assert.match(fonte, /PointPropertyDisplayCore\.rows\(/, `${controller}: linhas fora do núcleo`);
        assert.match(fonte, /i18nService\.currentLanguage/, `${controller}: idioma ativo não consultado`);
        assert.match(fonte, /\$scope\.\$watch\('point', refreshPointPropertyRows\)/, `${controller}: troca de ponto`);
        assert.match(fonte, /\$scope\.\$watch\('config\.propertyDisplay', refreshPointPropertyRows, true\)/, `${controller}: troca de configuração`);
        assert.match(fonte, /\$scope\.\$on\('languageChanged', refreshPointPropertyRows\)/, `${controller}: troca de idioma`);
    });
});

test('templates iteram pointPropertyRows como texto, sem a regra antiga', () => {
    TELAS.forEach(({ template }) => {
        const html = read(template);
        const bloco = html.match(/<div[^>]*ng-if="pointPropertyRows\.length"[^>]*>[\s\S]*?ng-repeat="row in pointPropertyRows track by row\.key"[\s\S]*?<\/div>\s*<\/div>/);
        assert.ok(bloco, `${template}: bloco de pointPropertyRows ausente`);
        assert.match(bloco[0], /\{\{row\.label\}\}/);
        assert.match(bloco[0], /\{\{row\.value\}\}/);
        assert.equal(bloco[0].indexOf('ng-bind-html'), -1, `${template}: rótulo renderizado como HTML`);
        ['hasCustomProperties', 'shouldShowProperty', 'formatPropertyName'].forEach((antigo) => {
            assert.equal(html.indexOf(antigo), -1, `${template}: ${antigo} ainda usado`);
        });
    });
});

test('temporal e supervisor não mantêm o comentário da antiga lista de propriedades padrão', () => {
    TELAS.forEach(({ controller }) => {
        assert.equal(read(controller).indexOf('Lista de propriedades padrão'), -1, `${controller}: comentário órfão`);
    });
});

test('controladores e núcleo continuam sintaticamente válidos', () => {
    ['controllers/temporal.js', 'controllers/supervisor.js', 'services/point-property-display-core.js'].forEach((file) => {
        assert.doesNotThrow(() => new vm.Script(read(file), { filename: file }), `${file} não compila`);
    });
});
