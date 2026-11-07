'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const core = require(path.join(__dirname, '..', '..', 'client', 'services', 'wayback-grid-core'));

const RELEASES_INDEX = {
    100: { itemURL: 'https://w/tile/100/{level}/{row}/{col}' },
    200: { itemURL: 'https://w/tile/200/{level}/{row}/{col}' },
    300: { itemURL: 'https://w/tile/300/{level}/{row}/{col}' }
};

const POINT = {
    bounds: [[1, 2], [3, 4]],
    waybackImages: [
        { releaseNum: 200, releaseDate: '2022-03-02', captureDate: '2022-01-15' },
        { releaseNum: 100, releaseDate: '2018-06-06', captureDate: null },
        { releaseNum: 300, releaseDate: '2024-01-11', captureDate: '2023-12-01' }
    ]
};

test('buildGrid: ordena por data de exibição, marca datas aproximadas e monta URL Leaflet', () => {
    const grid = core.buildGrid(POINT, {}, RELEASES_INDEX);
    assert.deepEqual(grid.map(g => g.releaseNum), [100, 200, 300]);
    assert.deepEqual(grid.map(g => g.date), ['2018-06-06', '2022-01-15', '2023-12-01']);
    assert.deepEqual(grid.map(g => g.approximateDate), [true, false, false]);
    assert.deepEqual(grid.map(g => g.year), [2018, 2022, 2023]);
    assert.deepEqual(grid.map(g => g.index), [0, 1, 2]);
    assert.equal(grid[0].url, 'https://w/tile/100/{z}/{y}/{x}');
    assert.deepEqual(grid[0].bounds, POINT.bounds);
});

test('buildGrid: filtra por initialYear/finalYear da campanha', () => {
    const grid = core.buildGrid(POINT, { initialYear: 2020, finalYear: 2022 }, RELEASES_INDEX);
    assert.deepEqual(grid.map(g => g.releaseNum), [200]);
    assert.deepEqual(grid.map(g => g.index), [0], 'índices recomputados após filtro');
});

test('buildGrid: grade vazia para ponto sem waybackImages', () => {
    assert.deepEqual(core.buildGrid({}, {}, RELEASES_INDEX), []);
    assert.deepEqual(core.buildGrid({ waybackImages: [] }, {}, RELEASES_INDEX), []);
});

test('buildInitialAnswers: uma caixa cobrindo toda a série, com classe padrão', () => {
    const grid = core.buildGrid(POINT, {}, RELEASES_INDEX);
    assert.deepEqual(core.buildInitialAnswers(grid, 'Pastagem'), [{
        initialDate: '2018-06-06', finalDate: '2023-12-01', landUse: 'Pastagem', pixelBorder: false
    }]);
    assert.deepEqual(core.buildInitialAnswers([], 'Pastagem'), []);
});

test('optionDates: datas a partir de um limite', () => {
    const grid = core.buildGrid(POINT, {}, RELEASES_INDEX);
    assert.deepEqual(core.optionDates(grid, '2018-06-06'),
        ['2018-06-06', '2022-01-15', '2023-12-01']);
    assert.deepEqual(core.optionDates(grid, '2022-01-16'), ['2023-12-01']);
});

test('expandAnswersToForm: expande intervalos consolidados em uma entrada por release', () => {
    const grid = core.buildGrid(POINT, {}, RELEASES_INDEX);
    const answers = [
        { initialDate: '2018-06-06', finalDate: '2022-01-15', landUse: 'Vegetação Nativa', pixelBorder: false },
        { initialDate: '2023-12-01', finalDate: '2023-12-01', landUse: 'Pastagem', pixelBorder: true }
    ];
    assert.deepEqual(core.expandAnswersToForm(answers, grid), [
        { releaseNum: 100, captureDate: '2018-06-06', landUse: 'Vegetação Nativa', pixelBorder: false },
        { releaseNum: 200, captureDate: '2022-01-15', landUse: 'Vegetação Nativa', pixelBorder: false },
        { releaseNum: 300, captureDate: '2023-12-01', landUse: 'Pastagem', pixelBorder: true }
    ]);
});

test('formatDateBR: converte ISO para dd/mm/aaaa por manipulação de string (sem Date, imune a fuso)', () => {
    assert.equal(core.formatDateBR('2012-09-22'), '22/09/2012');
    assert.equal(core.formatDateBR('2020-01-30'), '30/01/2020');
});

test('formatDateBR: entradas não-ISO retornam null (caller decide o fallback legado)', () => {
    assert.equal(core.formatDateBR('00/00/2020'), null);
    assert.equal(core.formatDateBR('21/09/2012'), null);
    assert.equal(core.formatDateBR(''), null);
    assert.equal(core.formatDateBR(null), null);
    assert.equal(core.formatDateBR(undefined), null);
});

const GRID_DUP = [
    { date: '2008-09-07', index: 0 },
    { date: '2008-09-07', index: 1 },
    { date: '2012-09-22', index: 2 },
    { date: '2012-09-22', index: 3 },
    { date: '2012-09-22', index: 4 },
    { date: '2025-10-12', index: 5 }
];

test('optionEntries: deduplica datas e rotula com a posição global das células (faixa ou única)', () => {
    assert.deepEqual(core.optionEntries(GRID_DUP, null), [
        { value: '2008-09-07', label: '2008-09-07 (1-2)' },
        { value: '2012-09-22', label: '2012-09-22 (3-5)' },
        { value: '2025-10-12', label: '2025-10-12 (6)' }
    ]);
});

test('optionEntries: filtro por data limite preserva a numeração global das células', () => {
    assert.deepEqual(core.optionEntries(GRID_DUP, '2012-09-22'), [
        { value: '2012-09-22', label: '2012-09-22 (3-5)' },
        { value: '2025-10-12', label: '2025-10-12 (6)' }
    ]);
});

test('optionEntries: grade vazia ou ausente retorna lista vazia', () => {
    assert.deepEqual(core.optionEntries([], null), []);
    assert.deepEqual(core.optionEntries(null, null), []);
});

test('expandAnswersToForm: célula fora de qualquer intervalo sai com landUse null (barrado pelo guard/form)', () => {
    const grid = core.buildGrid(POINT, {}, RELEASES_INDEX);
    const answers = [{ initialDate: '2018-06-06', finalDate: '2018-06-06', landUse: 'Pastagem', pixelBorder: false }];
    const form = core.expandAnswersToForm(answers, grid);
    assert.equal(form[1].landUse, null);
    assert.equal(form[2].landUse, null);
});
