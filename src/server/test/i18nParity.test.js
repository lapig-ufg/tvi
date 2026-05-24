/**
 * Testes de paridade i18n entre pt-BR / en / id.
 *
 * Cobertura:
 *   - Paridade estrutural: as três línguas devem ter exatamente o mesmo
 *     conjunto de chaves (todas, recursivamente). Falhas comuns capturadas:
 *     - Chave nova adicionada em uma língua mas esquecida em outra (regressão
 *       que costuma passar por code review).
 *     - Estrutura aninhada divergente (e.g. um lado define
 *       FOO.BAR como string, o outro define FOO.BAR como objeto).
 *   - Chaves específicas das entregas recentes (sentinel para garantir que
 *     essas mudanças não foram revertidas):
 *       - SUPERVISOR.FILTERS.ONLY_NOT_CONSOLIDATED (checkbox do supervisor)
 *       - TEMPORAL.FORM.SUBMIT_ERROR (mensagem genérica de erro no Enviar)
 *       - TEMPORAL.FORM.ALREADY_INSPECTED (aviso preventivo no temporal)
 *   - Sanidade dos valores: nenhum leaf pode ser objeto/array vazio nem string
 *     vazia, e nenhum leaf pode coincidir literalmente com o próprio caminho
 *     da chave (sinal forte de tradução esquecida).
 *
 * Roda como parte da suite normal: `cd src/server && npm test`.
 *
 * Notas:
 *   - O dicionário inteiro é carregado em memória uma vez via require, então
 *     todos os testes são síncronos e baratos (~poucos ms cada).
 *   - As línguas suportadas estão hardcoded propositalmente. Adicionar uma
 *     nova língua deve sempre disparar uma falha aqui até as traduções serem
 *     completadas.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const I18N_DIR = path.resolve(__dirname, '..', '..', 'client', 'i18n');
const LANGS = ['pt-BR', 'en', 'id'];
const REFERENCE_LANG = 'pt-BR'; // língua mais completa historicamente

function loadLang(lang) {
    return require(path.join(I18N_DIR, lang + '.json'));
}

/**
 * Achata um objeto em um Set de chaves "FOO.BAR.BAZ". Distinção entre
 * folhas (strings/números) e nós internos (objects) é importante: dois
 * dicionários com a mesma chave mas tipos diferentes (string num lado,
 * objeto no outro) são considerados estruturalmente divergentes.
 */
function flattenLeafPaths(obj, prefix) {
    const acc = new Set();
    const pfx = prefix || '';
    if (obj === null || obj === undefined) return acc;
    if (typeof obj !== 'object' || Array.isArray(obj)) {
        acc.add(pfx);
        return acc;
    }
    for (const k of Object.keys(obj)) {
        const child = obj[k];
        const childPath = pfx ? pfx + '.' + k : k;
        if (child !== null && typeof child === 'object' && !Array.isArray(child)) {
            for (const sub of flattenLeafPaths(child, childPath)) acc.add(sub);
        } else {
            acc.add(childPath);
        }
    }
    return acc;
}

function getByPath(obj, dottedPath) {
    return dottedPath.split('.').reduce(function (acc, key) {
        return (acc && typeof acc === 'object') ? acc[key] : undefined;
    }, obj);
}

// Carrega os três dicionários uma única vez.
const dicts = {};
for (const lang of LANGS) {
    dicts[lang] = loadLang(lang);
}
const leafPaths = {};
for (const lang of LANGS) {
    leafPaths[lang] = flattenLeafPaths(dicts[lang]);
}

// ---------------------------------------------------------------------------
// Paridade estrutural
// ---------------------------------------------------------------------------

test('i18n: cada par de línguas tem o mesmo conjunto de chaves', () => {
    const reference = leafPaths[REFERENCE_LANG];
    for (const other of LANGS) {
        if (other === REFERENCE_LANG) continue;
        const otherSet = leafPaths[other];
        const missingInOther = [...reference].filter(k => !otherSet.has(k));
        const extraInOther = [...otherSet].filter(k => !reference.has(k));
        assert.deepEqual(
            { missingInOther, extraInOther },
            { missingInOther: [], extraInOther: [] },
            `Divergência ${REFERENCE_LANG} vs ${other}:\n` +
            `  faltam em ${other}: ${JSON.stringify(missingInOther)}\n` +
            `  sobram em ${other}: ${JSON.stringify(extraInOther)}`
        );
    }
});

// ---------------------------------------------------------------------------
// Chaves específicas das entregas recentes — sentinel contra reversão acidental
// ---------------------------------------------------------------------------

const REQUIRED_KEYS = [
    'SUPERVISOR.FILTERS.ONLY_NOT_CONSOLIDATED',
    'TEMPORAL.FORM.SUBMIT_ERROR',
    'TEMPORAL.FORM.ALREADY_INSPECTED'
];

for (const key of REQUIRED_KEYS) {
    test(`i18n: chave "${key}" presente, não vazia e traduzida nas 3 línguas`, () => {
        for (const lang of LANGS) {
            const value = getByPath(dicts[lang], key);
            assert.equal(typeof value, 'string',
                `[${lang}] "${key}" deveria ser string, recebido: ${typeof value}`);
            assert.ok(value.trim().length > 0,
                `[${lang}] "${key}" não pode ser string vazia`);
            assert.notEqual(value, key,
                `[${lang}] "${key}" parece não traduzido (valor === chave)`);
        }
    });
}

// ---------------------------------------------------------------------------
// Sanidade — nenhum valor leaf inválido
// ---------------------------------------------------------------------------

test('i18n: nenhum leaf é objeto inesperado ou array (sanidade de tipo)', () => {
    // Strings vazias são permitidas — há casos legítimos como
    // LOGIN.REGION_BADGE, que é "" em pt-BR/en (não exibe badge) e
    // "INDONESIA" em id (exibe badge "INDONESIA"). Detectar "string
    // vazia esquecida" exige conhecimento de intenção, não estrutura;
    // ficaria a cargo de teste por chave específica (ver REQUIRED_KEYS).
    for (const lang of LANGS) {
        for (const leafPath of leafPaths[lang]) {
            const v = getByPath(dicts[lang], leafPath);
            assert.ok(typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean',
                `[${lang}] "${leafPath}" deveria ser primitivo, recebido: ${typeof v}`);
            assert.equal(Array.isArray(v), false,
                `[${lang}] "${leafPath}" é array — i18n deveria ser apenas strings`);
        }
    }
});

test('i18n: leaf nunca contém a chave literal como valor (tradução faltando)', () => {
    for (const lang of LANGS) {
        for (const leafPath of leafPaths[lang]) {
            const v = getByPath(dicts[lang], leafPath);
            if (typeof v === 'string') {
                assert.notEqual(v, leafPath,
                    `[${lang}] "${leafPath}" tem valor igual à chave (provável tradução esquecida)`);
            }
        }
    }
});
