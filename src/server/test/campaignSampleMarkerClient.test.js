/**
 * Guarda estática da fiação do símbolo da amostra no cliente:
 *
 *   - index.html carrega o núcleo e o adaptador antes das diretivas de mapa;
 *   - toda diretiva de mapa cria a camada pelo sampleMarkerService e recebe
 *     a configuração por atributo, em todos os templates que a instanciam;
 *   - os controladores das telas montam config.sampleMarker a partir da
 *     campanha e aplicam o valor devolvido por GET /service/campaign/config;
 *   - o formulário de campanha expõe os mesmos símbolos e limites validados
 *     no servidor (services/campaignSampleMarker.js).
 *
 * Execução:
 *   cd src/server && npm test
 *   ou
 *   node --test src/server/test/campaignSampleMarkerClient.test.js
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const CLIENT_DIR = path.join(__dirname, '..', '..', 'client');
const sampleMarker = require(path.join(__dirname, '..', 'services', 'campaignSampleMarker'));

function read(relative) {
    return fs.readFileSync(path.join(CLIENT_DIR, relative), 'utf8');
}

test('index.html carrega o núcleo e o adaptador do símbolo antes das diretivas de mapa', () => {
    const html = read('index.html');
    const posicao = (src) => html.indexOf(`<script src="${src}"></script>`);
    const core = posicao('services/sample-marker-core.js');
    const service = posicao('services/sampleMarkerService.js');
    const directives = posicao('others/directives.js');
    assert.ok(core !== -1, 'sample-marker-core.js ausente do index.html');
    assert.ok(service !== -1, 'sampleMarkerService.js ausente do index.html');
    assert.ok(core < service && service < directives, 'ordem: núcleo, adaptador, others/directives.js');
});

const MAP_TAGS = ['landsat-map', 'sentinel-map', 'wms-map', 'wayback-map', 'inspection-map', 'leaflet-swipe-map'];
const TEMPLATES = [
    'views/temporal.tpl.html', 'views/supervisor.tpl.html', 'views/admin-temporal.tpl.html',
    'views/admin-campaign-monitoring.tpl.html', 'views/mosaic-dialog.tpl.html'
];

function semComentariosHtml(html) {
    return html.replace(/<!--[\s\S]*?-->/g, '');
}

// Declarações comentadas (ex.: a versão antiga do sentinelMap) são ignoradas.
function corpoDaDiretiva(fonte, nome) {
    const declaracao = new RegExp(`^[ \\t]*\\.directive\\('${nome}'`, 'm');
    const match = declaracao.exec(fonte);
    assert.ok(match, `diretiva ${nome} não encontrada`);
    const inicio = match.index;
    const proxima = /^[ \t]*\.directive\('/m.exec(fonte.slice(inicio + match[0].length));
    return proxima ? fonte.slice(inicio, inicio + match[0].length + proxima.index) : fonte.slice(inicio);
}

function linhasDeCodigo(fonte) {
    return fonte.split('\n').filter((linha) => !linha.trim().startsWith('//')).join('\n');
}

test('diretivas de mapa recebem sampleMarker por atributo e criam a amostra pelo sampleMarkerService', () => {
    const directives = read('others/directives.js');
    const corpos = ['inspectionMap', 'sentinelMap', 'landsatMap', 'wmsMap'].map((nome) => [nome, corpoDaDiretiva(directives, nome)]);
    corpos.push(['leafletSwipeMap', read('others/leaflet-swipe-map.js')]);
    corpos.push(['waybackMap', read('directives/waybackMap.js')]);
    corpos.forEach(([nome, corpo]) => {
        assert.match(corpo, /sampleMarker:\s*'='/, `${nome}: scope sem sampleMarker`);
        assert.match(corpo, /function\s*\([^)]*\bsampleMarkerService\b[^)]*\)/, `${nome}: sampleMarkerService não injetado`);
        assert.match(corpo, /sampleMarkerService\.createLayer\(/, `${nome}: não cria a amostra pelo sampleMarkerService`);
        const codigo = linhasDeCodigo(corpo);
        assert.doesNotMatch(codigo, /L\.marker\(/, `${nome}: ainda cria L.marker diretamente`);
        assert.doesNotMatch(codigo, /L\.geoJSON\(/, `${nome}: ainda desenha a amostra com L.geoJSON`);
    });
});

test('templates passam sample-marker="config.sampleMarker" a toda instância das diretivas de mapa', () => {
    const tag = new RegExp(`<(${MAP_TAGS.join('|')})\\b[^>]*>`, 'g');
    let total = 0;
    TEMPLATES.forEach((file) => {
        const html = semComentariosHtml(read(file));
        for (const match of html.matchAll(tag)) {
            total += 1;
            assert.match(match[0], /sample-marker="config\.sampleMarker"/, `${file}: <${match[1]}> sem sample-marker`);
        }
    });
    assert.ok(total >= 16, `esperadas ao menos 16 instâncias de diretivas de mapa, encontradas ${total}`);
});

test('arquivos do cliente envolvidos continuam sintaticamente válidos', () => {
    [
        'others/directives.js', 'others/leaflet-swipe-map.js', 'directives/waybackMap.js',
        'services/sample-marker-core.js', 'services/sampleMarkerService.js'
    ].forEach((file) => {
        assert.doesNotThrow(() => new vm.Script(read(file), { filename: file }), `${file} não compila`);
    });
});

test('telas montam config.sampleMarker a partir da campanha com o núcleo do sampleMarkerService', () => {
    [
        ['controllers/temporal.js', /sampleMarker: sampleMarkerService\.core\.normalize\(\$rootScope\.user\.campaign\.sampleMarker\)/],
        ['controllers/supervisor.js', /sampleMarker: sampleMarkerService\.core\.normalize\(\$rootScope\.user\.campaign\.sampleMarker\)/],
        ['controllers/admin-temporal.js', /sampleMarker: sampleMarkerService\.core\.normalize\(campaign\.sampleMarker\)/],
        ['controllers/admin-campaign-monitoring.js', /sampleMarker: sampleMarkerService\.core\.normalize\(response\.data\.sampleMarker\)/]
    ].forEach(([file, pattern]) => {
        assert.match(read(file), pattern, `${file}: config sem sampleMarker normalizado`);
    });
});

test('loadCampaignConfig aplica config.sampleMarker normalizado ao config da tela', () => {
    ['controllers/temporal.js', 'controllers/supervisor.js'].forEach((file) => {
        const source = read(file);
        const start = source.indexOf('var loadCampaignConfig = function');
        assert.ok(start !== -1, `${file}: loadCampaignConfig não encontrada`);
        const end = source.indexOf('loadPoint', start);
        const body = source.slice(start, end === -1 ? undefined : end);
        assert.match(body, /\$scope\.config\.sampleMarker\s*=\s*sampleMarkerService\.core\.normalize\(config\.sampleMarker\)/,
            `${file}: loadCampaignConfig não aplica config.sampleMarker`);
    });
});

test('controladores envolvidos continuam sintaticamente válidos', () => {
    [
        'controllers/temporal.js', 'controllers/supervisor.js', 'controllers/admin-temporal.js',
        'controllers/admin-campaign-monitoring.js', 'controllers/admin-modals.js', 'controllers/admin-campaign.js'
    ].forEach((file) => {
        assert.doesNotThrow(() => new vm.Script(read(file), { filename: file }), `${file} não compila`);
    });
});

test('formulário de campanha: símbolo da amostra com as opções e os limites do servidor', () => {
    const template = read('views/campaign-form-modal.tpl.html');
    const select = template.match(/<select[^>]*ng-model="campaign\.sampleMarker\.symbol"[^>]*>([\s\S]*?)<\/select>/);
    assert.ok(select, 'select de campaign.sampleMarker.symbol ausente');
    const options = Array.from(select[1].matchAll(/<option value="([^"]+)"/g)).map((m) => m[1]);
    assert.deepEqual(options, sampleMarker.SYMBOLS);

    const input = (field) => {
        const match = template.match(new RegExp(`<input[^>]*ng-model="campaign\\.sampleMarker\\.${field}"[^>]*>`));
        assert.ok(match, `input de campaign.sampleMarker.${field} ausente`);
        return match[0];
    };
    const limites = sampleMarker.LIMITS;
    const radius = input('radiusMeters');
    assert.match(radius, /type="number"/);
    assert.match(radius, new RegExp(`min="${limites.radiusMeters.min}"`), 'min do raio difere do servidor');
    assert.match(radius, new RegExp(`max="${limites.radiusMeters.max}"`), 'max do raio difere do servidor');
    assert.match(radius, /\brequired\b/);
    const weight = input('weight');
    assert.match(weight, /type="number"/);
    assert.match(weight, new RegExp(`min="${limites.weight.min}"`), 'min da espessura difere do servidor');
    assert.match(weight, new RegExp(`max="${limites.weight.max}"`), 'max da espessura difere do servidor');
    const opacity = input('fillOpacity');
    assert.match(opacity, new RegExp(`min="${limites.fillOpacity.min}"`), 'min da opacidade difere do servidor');
    assert.match(opacity, new RegExp(`max="${limites.fillOpacity.max}"`), 'max da opacidade difere do servidor');
    const color = input('color');
    assert.match(color, /type="color"/);
    assert.match(color, /ng-pattern="\/\^#\[0-9a-fA-F\]\{6\}\$\/"/, 'cor sem validação hexadecimal');
    assert.match(input('fill'), /type="checkbox"/);
    assert.match(template, /ng-if="campaign\.sampleMarker\.symbol !== 'marker'"/,
        'campos vetoriais devem sair do formulário quando o símbolo é o marcador');
});

test('cadastro: símbolo padrão em campanha nova e normalização no modal de edição', () => {
    const list = read('controllers/admin-campaign.js');
    const start = list.indexOf('$scope.newCampaign = {');
    assert.ok(start !== -1, 'newCampaign não encontrado em admin-campaign.js');
    const block = list.slice(start, list.indexOf('};', start));
    assert.match(block, /sampleMarker:\s*sampleMarkerService\.core\.defaults\(\)/, 'newCampaign sem sampleMarker padrão');

    const modal = read('controllers/admin-modals.js');
    assert.match(modal, /\$scope\.campaign\.sampleMarker\s*=\s*sampleMarkerService\.core\.normalize\(\$scope\.campaign\.sampleMarker\)/,
        'modal não normaliza sampleMarker da campanha');
});
