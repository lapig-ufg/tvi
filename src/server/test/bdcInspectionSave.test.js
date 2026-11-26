'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {collection,campaign,point,ready} = require('./helpers/bdcFixtures');
const {identity} = require('../services/bdcSelectionService');
function fixture() {
 const selection = Object.assign(identity(campaign,point,2020,'DRY'),{state:'ready',result:ready().result});
 const appended=[];
 const app={repository:{collections:{points:collection([point]),campaign:collection([campaign]),campaignImageSelections:collection([selection])}},
  services:{logger:{info:async()=>{},warn:async()=>{},error:async()=>{}},pointsService:{appendInspection:async(...args)=>{appended.push(args);}}},controllers:{}};
 const controller=require('../controllers/points')(app);
 const ref={selectionId:selection._id,year:2020,period:'DRY',revision:1,profile:'natural',profilesViewed:['natural','false-color']};
 const request={body:{point:{_id:'p',inspection:{form:[],bdcSelections:[ref]}}},session:{user:{name:'inspector',campaign}},sessionID:'session'};
 const response={code:200,status(code){this.code=code;return this;},json(body){this.body=body;return this;},send(body){this.body=body;return this;},end(){}};
 return{app,controller,request,response,appended,ref};
}
test('controller real grava referências validadas no fluxo auditado existente',async()=>{
 const f=fixture();
 await f.controller.updatePoint(f.request,f.response);
 assert.equal(f.response.code,200);
 assert.equal(f.appended.length,1);
 assert.deepEqual(f.appended[0][2].bdcSelections,[f.ref]);
});
test('controller recusa referência cruzada antes de gravar inspeção',async()=>{
 const f=fixture();
 f.request.body.point.inspection.bdcSelections[0].selectionId='c'.repeat(64);
 await f.controller.updatePoint(f.request,f.response);
 assert.equal(f.response.code,400);
 assert.equal(f.appended.length,0);
});
test('controller exige referências usando campanha atual do banco, mesmo com sessão desatualizada',async()=>{
 const f=fixture();
 f.request.session.user.campaign={...campaign,imagerySource:undefined};
 delete f.request.body.point.inspection.bdcSelections;
 await f.controller.updatePoint(f.request,f.response);
 assert.equal(f.response.code,400);
 assert.equal(f.appended.length,0);
});
