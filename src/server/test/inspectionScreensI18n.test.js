/**
 * Guarda de tradução das telas de inspeção (temporal.tpl.html e
 * supervisor.tpl.html): todo texto visível, inclusive title, placeholder,
 * aria-label e value de botões, deve passar pelo filtro i18n. Os únicos
 * literais aceitos são marcadores técnicos neutros em idioma, listados por
 * tela.
 *
 * O teste é estático: remove comentários, blocos <style>/<script>,
 * expressões {{ }} e valores de atributo antes de extrair os nós de texto,
 * porque atributos como ng-show="lista.length > 1" contêm ">".
 *
 * Roda como parte da suite normal: `cd src/server && npm test`.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const VIEWS_DIR = path.join(__dirname, '..', '..', 'client', 'views');

const TELAS = {
    'temporal.tpl.html': [', - lat-lon', ', - lon-lat'],
    'supervisor.tpl.html': ['index', 'Lat/Lon:', 'Lon/Lat:']
};

function textosLiterais(html) {
    const limpo = html
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<style[\s\S]*?<\/style>/g, '')
        .replace(/<script[\s\S]*?<\/script>/g, '')
        .replace(/\{\{[\s\S]*?\}\}/g, '');

    const encontrados = [];
    for (const m of limpo.matchAll(/\s(title|placeholder|alt|aria-label)="([^"]*)"/g)) {
        if (/\p{L}{2,}/u.test(m[2])) encontrados.push(m[2].trim());
    }
    // value só é texto visível em botões; em rádios e checkboxes é dado.
    for (const tag of limpo.matchAll(/<input\b[^>]*\btype="(?:button|submit|reset)"[^>]*>/g)) {
        const valor = /\svalue="([^"]*)"/.exec(tag[0]);
        if (valor && /\p{L}{2,}/u.test(valor[1])) encontrados.push(valor[1].trim());
    }
    const semAtributos = limpo
        .replace(/="[^"]*"/g, '=""')
        .replace(/='[^']*'/g, "=''")
        .replace(/<[^>]*>/g, '\u0000');
    for (const trecho of semAtributos.split('\u0000')) {
        const texto = trecho.replace(/\s+/g, ' ').trim();
        if (/\p{L}{2,}/u.test(texto)) encontrados.push(texto);
    }
    return encontrados;
}

for (const [arquivo, permitidos] of Object.entries(TELAS)) {
    test(`${arquivo}: nenhum texto visível fora do filtro i18n`, () => {
        const html = fs.readFileSync(path.join(VIEWS_DIR, arquivo), 'utf8');
        const fixos = textosLiterais(html).filter(function (t) { return permitidos.indexOf(t) === -1; });
        assert.deepEqual(fixos, [], `${arquivo} tem textos fixos: ${JSON.stringify(fixos)}`);
    });
}

test('extração ignora ">" dentro de atributos e encontra texto fixo', () => {
    const html = '<div ng-show="lista.length > 1"><label>Rótulo:</label><input title="Dica">' +
        '<input type="radio" value="sortedIndex"><input type="button" value="Enviar"></div>';
    assert.deepEqual(textosLiterais(html), ['Dica', 'Enviar', 'Rótulo:']);
});
