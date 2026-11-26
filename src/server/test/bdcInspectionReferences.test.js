'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {validate} = require('../services/bdcInspectionReferences');
const {collection} = require('./helpers/bdcFixtures');
test('referências históricas são validadas pelo ponto e preservam revisão original', async () => {
 const id='a'.repeat(64);
 const row={_id:id,campaignId:'c',pointId:'p',state:'ready',year:2020,period:'DRY',revision:1,profiles:['natural'],result:{complete:true,best_local_id:'scene',rows:[{id:'scene',eligible:true,profiles:['natural']}]}};
 const col=collection([row]);
 const refs=[{selectionId:id,year:2020,period:'DRY',revision:1,profile:'natural'}];
 assert.deepEqual(await validate(col,{_id:'c',imagerySource:'bdc',bdcConfig:{selectionRevision:2}},{_id:'p'},refs),refs);
 await assert.rejects(validate(col,{_id:'c',imagerySource:'bdc'},{_id:'other'},refs));
 await assert.rejects(validate(col,{_id:'c',imagerySource:'bdc'},{_id:'p'},[...refs,...refs]));
});

test('perfis vistos são validados e preservados sem aceitar prévia ou campos arbitrários', async () => {
 const id = 'b'.repeat(64);
 const row = { _id:id, campaignId:'c', pointId:'p', state:'ready', year:2020, period:'DRY', revision:1,
  profiles:['natural','false'], result:{complete:true,best_local_id:'scene',rows:[{id:'scene',eligible:true,profiles:['natural','false']}]}};
 const col = collection([row]);
 const ref = {selectionId:id,year:2020,period:'DRY',revision:1,profile:'false',profilesViewed:['natural','false','natural'],url:'https://evil'};
 const saved = await validate(col,{_id:'c',imagerySource:'bdc'},{_id:'p'},[ref]);
 assert.deepEqual(saved[0].profilesViewed,['natural','false']);
 assert.equal(saved[0].url,undefined);
 await assert.rejects(validate(col,{_id:'c',imagerySource:'bdc'},{_id:'p'},[{...ref,profilesViewed:['unknown']}]));
 col.docs.get(id).kind='preview';
 await assert.rejects(validate(col,{_id:'c',imagerySource:'bdc'},{_id:'p'},[ref]));
});
