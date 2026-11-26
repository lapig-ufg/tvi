'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { identity, create } = require('../services/bdcSelectionService');
const { collection, campaign, point, ready } = require('./helpers/bdcFixtures');

test('identidade preserva revisão e diferencia coordenadas', () => {
 const a = identity(campaign, point, 2020, 'DRY');
 assert.equal(a.params.end, '2020-10-30');
 assert.notEqual(a._id, identity(campaign, { ...point, lon: -48 }, 2020, 'DRY')._id);
 assert.notEqual(a._id, identity({ ...campaign, bdcConfig: { ...campaign.bdcConfig, selectionRevision: 2 } }, point, 2020, 'DRY')._id);
 assert.throws(() => identity(campaign, point, 2019, 'DRY'));
 assert.throws(() => identity(campaign, { ...point, campaign: 'other' }, 2020, 'DRY'));
});

test('consulta inexistente não cria seleção nem trabalho remoto', async () => {
 const col = collection();
 const service = create(col, { createJob: () => assert.fail('consulta não cria trabalho') });
 assert.equal(await service.resolve(campaign, point, 2020, 'DRY', false), null);
 assert.equal(col.docs.size, 0);
});

test('solicitações concorrentes compartilham identidade e resultado pronto não é recalculado', async () => {
 const col = collection(); let calls = 0;
 const service = create(col, { async createJob() { calls++; return ready(); } });
 const selections = await Promise.all([service.resolve(campaign, point, 2020, 'DRY', true), service.resolve(campaign, point, 2020, 'DRY', true)]);
 assert.equal(selections[0]._id, selections[1]._id);
 const before = calls;
 assert.equal((await service.resolve(campaign, point, 2020, 'DRY', true)).state, 'ready');
 assert.equal(calls, before);
 assert.equal(col.docs.size, 1);
});

test('retentativa exige intenção explícita e preserva job idempotente', async () => {
 const col = collection(); const calls = [];
 const tiles = { async createJob(params) { calls.push(params); return calls.length === 1 ?
  { id: 'b'.repeat(64), state: 'failed', error: { code: 'read_failed', retryable: true } } : ready(); } };
 const service = create(col, tiles);
 const failed = await service.resolve(campaign, point, 2020, 'DRY', true);
 assert.equal(failed.state, 'failed');
 await service.resolve(campaign, point, 2020, 'DRY', true);
 assert.equal(calls.length, 1);
 assert.equal((await service.resolve(campaign, point, 2020, 'DRY', true, true)).state, 'ready');
 assert.equal(calls[1].retry, true);
 assert.equal(calls[0].idempotency_key, calls[1].idempotency_key);
});

for (const mutation of [value => { value.id = '../evil'; }, value => { value.result.eligible = 2; },
 value => { value.result.best_local_id = 'absent'; }, value => { value.result.complete = false; }]) {
 test('contrato remoto incompleto não publica seleção oficial', async () => {
  const invalid = ready(); mutation(invalid);
  const col = collection();
  const service = create(col, { async createJob() { return invalid; } });
  await assert.rejects(service.resolve(campaign, point, 2020, 'DRY', true), { status: 502 });
  assert.notEqual([...col.docs.values()][0].state, 'ready');
 });
}

test('adições concorrentes de composição preservam todos os perfis históricos', async () => {
 const initial = { ...identity(campaign, point, 2020, 'DRY'), state: 'ready', profiles: ['natural'], result: ready().result };
 const col = collection([initial]);
 const service = create(col, { createJob: () => assert.fail('seleção pronta não recalcula') });
 const withProfiles = profiles => ({ ...campaign, bdcConfig: { ...campaign.bdcConfig, profiles } });
 await Promise.all([
  service.resolve(withProfiles(['natural', 'false-color']), point, 2020, 'DRY', false),
  service.resolve(withProfiles(['natural', 'ndvi']), point, 2020, 'DRY', false)
 ]);
 assert.deepEqual((await col.findOne({ _id: initial._id })).profiles.slice().sort(), ['false-color', 'natural', 'ndvi']);
});

test('resposta failed anterior à retentativa não sobrescreve trabalho reiniciado', async () => {
 const jobId = 'b'.repeat(64);
 const initial = { ...identity(campaign, point, 2020, 'DRY'), state: 'running', jobId };
 const col = collection([initial]);
 let releaseOld, oldStarted;
 const started = new Promise(resolve => { oldStarted = resolve; });
 const delayed = new Promise(resolve => { releaseOld = resolve; });
 const failed = { id: jobId, state: 'failed', error: { code: 'read_failed', retryable: true } };
 let getCalls = 0;
 const service = create(col, {
  getJob() { if (++getCalls === 1) { oldStarted(); return delayed; } return Promise.resolve(failed); },
  async createJob() { return { id: jobId, state: 'pending' }; }
 });
 const oldRequest = service.resolve(campaign, point, 2020, 'DRY', false);
 await started;
 assert.equal((await service.resolve(campaign, point, 2020, 'DRY', false)).state, 'failed');
 assert.equal((await service.resolve(campaign, point, 2020, 'DRY', true, true)).state, 'pending');
 releaseOld(failed);
 await oldRequest;
 assert.equal((await col.findOne({ _id: initial._id })).state, 'pending');
});
