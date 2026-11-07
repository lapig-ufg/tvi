/**
 * Dica "Shift + clique" das células da grade (others/directives.js): o
 * texto vem do i18n no momento em que o tooltip abre, para acompanhar a
 * troca de idioma sem recriar os mapas.
 *
 * Execução:
 *   cd src/server && npm test
 *   ou
 *   node --test src/server/test/sampleShiftHintI18n.test.js
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const CLIENT_DIR = path.join(__dirname, '..', '..', 'client');
const DIRECTIVES_PATH = path.join(CLIENT_DIR, 'others', 'directives.js');
const KEY = 'TEMPORAL.MAP.SHIFT_HIDE_SAMPLE';
const DIRETIVAS = ['inspectionMap', 'planetMap', 'sentinelMap', 'landsatMap', 'wmsMap'];

function fonteSemComentarios() {
    return fs.readFileSync(DIRECTIVES_PATH, 'utf8')
        .split('\n')
        .filter((linha) => !linha.trim().startsWith('//'))
        .join('\n');
}

function extrairFuncao(fonte, nome) {
    const inicio = fonte.indexOf(`function ${nome}(`);
    assert.ok(inicio !== -1, `${nome} não encontrada`);
    let profundidade = 0;
    for (let i = fonte.indexOf('{', inicio); i < fonte.length; i++) {
        if (fonte[i] === '{') profundidade += 1;
        if (fonte[i] === '}') profundidade -= 1;
        if (profundidade === 0) return fonte.slice(inicio, i + 1);
    }
    throw new Error(`${nome} sem fechamento`);
}

function traducao(idioma) {
    const json = JSON.parse(fs.readFileSync(path.join(CLIENT_DIR, 'i18n', `${idioma}.json`), 'utf8'));
    return KEY.split('.').reduce((atual, parte) => (atual ? atual[parte] : undefined), json);
}

test('toda chamada de applyMarkerShiftHint passa o i18nService e não há texto fixo da dica', () => {
    const fonte = fonteSemComentarios();
    const chamadas = fonte.match(/applyMarkerShiftHint\([^)]*\)/g).filter((c) => !c.startsWith('applyMarkerShiftHint(marker'));
    assert.equal(chamadas.length, 5, JSON.stringify(chamadas));
    chamadas.forEach((chamada) => assert.equal(chamada, 'applyMarkerShiftHint($scope.marker, i18nService)'));
    assert.equal(fonte.indexOf('Shift + clique'), -1, 'texto da dica fixo em directives.js');
});

test('as cinco diretivas com a dica injetam o i18nService', () => {
    const fonte = fonteSemComentarios();
    DIRETIVAS.forEach((nome) => {
        const assinatura = new RegExp(`\\.directive\\('${nome}', function ?\\(([^)]*)\\)`).exec(fonte);
        assert.ok(assinatura, `${nome} não encontrada`);
        assert.match(assinatura[1], /\bi18nService\b/, `${nome} sem i18nService`);
    });
});

test('a dica é uma função que traduz no momento da exibição', () => {
    const contexto = vm.createContext({});
    vm.runInContext(extrairFuncao(fonteSemComentarios(), 'applyMarkerShiftHint'), contexto);
    const marcador = {
        bindTooltip: function (conteudo, opcoes) { this.conteudo = conteudo; this.opcoes = opcoes; return this; }
    };
    let idioma = 'en';
    const i18nService = { translate: (key) => `${idioma}:${key}` };
    contexto.applyMarkerShiftHint(marcador, i18nService);
    assert.equal(typeof marcador.conteudo, 'function');
    assert.equal(marcador.conteudo(marcador), `en:${KEY}`);
    idioma = 'id';
    assert.equal(marcador.conteudo(marcador), `id:${KEY}`, 'acompanha a troca de idioma');
    assert.equal(marcador.opcoes.className, 'marker-shift-hint');
});

test('chave da dica existe nos três idiomas com os textos definidos', () => {
    assert.equal(traducao('pt-BR'), 'Shift + clique no mapa para ocultar o marcador');
    assert.equal(traducao('en'), 'Shift + click on the map to hide the marker');
    assert.equal(traducao('id'), 'Shift + klik pada peta untuk menyembunyikan penanda');
});

test('directives.js continua sintaticamente válido', () => {
    assert.doesNotThrow(() => new vm.Script(fs.readFileSync(DIRECTIVES_PATH, 'utf8'), { filename: DIRECTIVES_PATH }));
});
