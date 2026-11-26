'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function definition() {
    let page;
    const http = { get(url) {
        if (url === '/service/admin/points/p') return Promise.resolve({ data: { _id: 'p', campaign: 'c', lat: 0, lon: 0 } });
        if (url === '/api/campaigns/c') return Promise.resolve({ data: { _id: 'c', initialYear: 2020, finalYear: 2021, zoomLevel: 13 } });
        if (url === '/service/admin/capabilities') return Promise.resolve({ data: [{ satellite: 'sentinel', name: 's2_harmonized', year: [2020], period: ['WET'], visparam: ['default'] }] });
        throw new Error('Consulta inesperada: ' + url);
    } };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../client/services/admin-mosaic-page.js'), 'utf8'), {
        Application: { run(fn) { fn({ register(id, value) { page = value; } }, http, { all: values => Promise.all(values) }); } }
    });
    return page;
}

test('comparação administrativa recupera ponto, campanha e fontes pela URL', async () => {
    const locals = await definition().load({ pointId: 'p', campaignId: 'c', year: '2020', period: 'WET' });
    assert.equal(locals.point._id, 'p');
    assert.equal(locals.map.year, 2020);
    assert.equal(locals.period, 'WET');
    assert.equal(locals.mosaics[0].name, 's2_harmonized');
});

test('comparação recusa período e ano fora da campanha', async () => {
    await assert.rejects(async () => definition().load({ pointId: 'p', campaignId: 'c', year: '2020', period: 'invalid' }), /Período inválido/);
    await assert.rejects(async () => definition().load({ pointId: 'p', campaignId: 'c', year: '1985', period: 'WET' }), /Ano fora da campanha/);
});
