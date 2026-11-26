'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {buildInspectionTable} = require('../services/inspectionTable');
test('tabela de supervisão conserva referências por inspetor sem compartilhar objetos', () => {
 const refs=[{selectionId:'abc',year:2020,period:'DRY',revision:1,profile:'rgb',profilesViewed:['rgb']}];
 const point={userName:['Ana','João'],inspection:[{form:[],bdcSelections:refs},{form:[]}]};
 const result=buildInspectionTable(point);
 assert.deepEqual(result.inspections[0].bdcSelections,refs);
 assert.equal(result.inspections[1].bdcSelections,undefined);
 result.inspections[0].bdcSelections[0].profilesViewed.push('ndvi');
 assert.deepEqual(refs[0].profilesViewed,['rgb']);
});
