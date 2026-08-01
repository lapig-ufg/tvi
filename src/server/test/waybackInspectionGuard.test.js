'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const guard = require(path.join(__dirname, '..', 'services', 'waybackInspectionGuard'));

const wbCampaign = { _id: 'c1', imageType: 'wayback' };
const lsCampaign = { _id: 'c2', imageType: 'landsat' };
const legacyCampaign = { _id: 'c3' }; // campanhas antigas sem imageType

test('aceita payload wayback válido em campanha wayback', () => {
    const r = guard.validate(wbCampaign, { form: [
        { releaseNum: 100, captureDate: '2018-06-06', landUse: 'Pastagem', pixelBorder: false },
        { releaseNum: 200, captureDate: '2022-01-15', landUse: 'Agricultura', pixelBorder: true }
    ] });
    assert.equal(r.ok, true);
});

test('rejeita payload por ano em campanha wayback', () => {
    const r = guard.validate(wbCampaign, { form: [
        { initialYear: 1985, finalYear: 2024, landUse: 'Pastagem' }
    ] });
    assert.equal(r.ok, false);
});

test('rejeita form vazio em campanha wayback', () => {
    assert.equal(guard.validate(wbCampaign, { form: [] }).ok, false);
    assert.equal(guard.validate(wbCampaign, {}).ok, false);
});

test('rejeita entrada wayback incompleta (sem captureDate ou landUse)', () => {
    assert.equal(guard.validate(wbCampaign, { form: [{ releaseNum: 100, landUse: 'Pastagem' }] }).ok, false);
    assert.equal(guard.validate(wbCampaign, { form: [{ releaseNum: 100, captureDate: '2018-06-06', landUse: '' }] }).ok, false);
});

test('rejeita payload wayback em campanha não-wayback', () => {
    const r = guard.validate(lsCampaign, { form: [
        { releaseNum: 100, captureDate: '2018-06-06', landUse: 'Pastagem' }
    ] });
    assert.equal(r.ok, false);
});

test('não interfere no payload por ano em campanha não-wayback (inclusive legada)', () => {
    const yearForm = { form: [{ initialYear: 1985, finalYear: 2024, landUse: 'Pastagem' }] };
    assert.equal(guard.validate(lsCampaign, yearForm).ok, true);
    assert.equal(guard.validate(legacyCampaign, yearForm).ok, true);
    // Também não valida conteúdo do payload por ano (fora do escopo do guard):
    assert.equal(guard.validate(lsCampaign, { form: [] }).ok, true);
    assert.equal(guard.validate(legacyCampaign, {}).ok, true);
});
