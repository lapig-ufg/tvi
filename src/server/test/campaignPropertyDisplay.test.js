/**
 * Colunas do ponto exibidas por idioma (services/campaignPropertyDisplay.js):
 * validação estrita do cadastro e resolução leniente para a entrega ao
 * cliente.
 *
 * Execução:
 *   cd src/server && npm test
 *   ou
 *   node --test src/server/test/campaignPropertyDisplay.test.js
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const display = require(path.join(__dirname, '..', 'services', 'campaignPropertyDisplay'));

const VAZIO = { default: [], 'pt-BR': [], en: [], id: [] };

test('constantes congeladas: listas e limites', () => {
    assert.deepEqual(display.LISTS, ['default', 'pt-BR', 'en', 'id']);
    assert.deepEqual(display.LIMITS, { items: 30, keyLength: 100, labelLength: 60 });
    assert.ok(Object.isFrozen(display.LISTS));
    assert.ok(Object.isFrozen(display.LIMITS));
});

test('emptyPropertyDisplay devolve um objeto novo a cada chamada', () => {
    const primeiro = display.emptyPropertyDisplay();
    assert.deepEqual(primeiro, VAZIO);
    primeiro.id.push({ key: 'x', label: '' });
    assert.deepEqual(display.emptyPropertyDisplay(), VAZIO);
});

test('vazio, nulo e objeto vazio viram as quatro listas vazias', () => {
    [undefined, null, '', {}].forEach((valor) => {
        assert.deepEqual(display.parsePropertyDisplayInput(valor), { value: VAZIO }, String(valor));
    });
    assert.deepEqual(display.parsePropertyDisplayInput({ en: null, id: undefined }), { value: VAZIO });
});

test('configuração da Indonésia é aceita, com trim e rótulo vazio padronizado', () => {
    const entrada = {
        id: [{ key: 'Kel_Desa' }, { key: ' Kec_Dist ', label: '' }, { key: 'Satuan_BL', label: ' Bentuklahan ' }],
        en: [{ key: 'Village' }, { key: 'Landform', label: null }]
    };
    assert.deepEqual(display.parsePropertyDisplayInput(entrada).value, {
        default: [], 'pt-BR': [],
        en: [{ key: 'Village', label: '' }, { key: 'Landform', label: '' }],
        id: [{ key: 'Kel_Desa', label: '' }, { key: 'Kec_Dist', label: '' }, { key: 'Satuan_BL', label: 'Bentuklahan' }]
    });
});

test('rejeita lista desconhecida, lista não array, excesso de itens, coluna e rótulo inválidos e coluna repetida', () => {
    const trinta = Array.from({ length: 30 }, (_, i) => ({ key: `c${i}` }));
    assert.ok(display.parsePropertyDisplayInput({ id: trinta }).value, '30 colunas são aceitas');
    [
        ['x', /^propertyDisplay must be an object$/],
        [[], /^propertyDisplay must be an object$/],
        [{ es: [] }, /^propertyDisplay\.es is not a supported list$/],
        [{ en: 'Village' }, /^propertyDisplay\.en must be an array$/],
        [{ id: trinta.concat([{ key: 'c30' }]) }, /^propertyDisplay\.id accepts at most 30 columns$/],
        [{ id: ['Kel_Desa'] }, /^propertyDisplay\.id has an invalid column$/],
        [{ id: [{ key: '   ' }] }, /^propertyDisplay\.id has an invalid column$/],
        [{ id: [{ key: 5 }] }, /^propertyDisplay\.id has an invalid column$/],
        [{ id: [{ key: 'a'.repeat(101) }] }, /^propertyDisplay\.id has an invalid column$/],
        [{ 'pt-BR': [{ key: 'A', label: 'b'.repeat(61) }] }, /^propertyDisplay\.pt-BR has an invalid label$/],
        [{ default: [{ key: 'A', label: 7 }] }, /^propertyDisplay\.default has an invalid label$/],
        [{ en: [{ key: 'Village' }, { key: ' Village ' }] }, /^propertyDisplay\.en repeats column Village$/]
    ].forEach(([entrada, erro]) => {
        const resultado = display.parsePropertyDisplayInput(entrada);
        assert.equal(resultado.value, undefined, JSON.stringify(entrada));
        assert.match(resultado.error, erro, JSON.stringify(entrada));
    });
    assert.ok(display.parsePropertyDisplayInput({ id: [{ key: 'a'.repeat(100), label: 'b'.repeat(60) }] }).value,
        'limites exatos são aceitos');
});

test('resolvePropertyDisplay descarta itens inválidos e repetidos sem lançar', () => {
    assert.deepEqual(display.resolvePropertyDisplay({}), VAZIO);
    assert.deepEqual(display.resolvePropertyDisplay(null), VAZIO);
    assert.deepEqual(display.resolvePropertyDisplay({ propertyDisplay: 'x' }), VAZIO);
    assert.deepEqual(display.resolvePropertyDisplay({ propertyDisplay: { es: [{ key: 'A' }], en: 'x' } }), VAZIO);
    assert.deepEqual(
        display.resolvePropertyDisplay({ propertyDisplay: { id: [{ key: '' }, { key: ' A ', label: 9 }, { key: 'A' }, 5, { key: 'B', label: ' b ' }] } }),
        Object.assign({}, VAZIO, { id: [{ key: 'A', label: '' }, { key: 'B', label: 'b' }] }));
    const quarenta = Array.from({ length: 40 }, (_, i) => ({ key: `c${i}` }));
    assert.equal(display.resolvePropertyDisplay({ propertyDisplay: { en: quarenta } }).en.length, 30);
});
