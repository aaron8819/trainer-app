// Local synthetic preparation using the existing browser/HTTP command boundary.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import { chromium, expect } from '@playwright/test';
import { createHypertrophyPlan } from '../../src/lib/engine/trainer2/plan-builder';
import { reviewedResults } from '../../src/lib/trainer2-contracts/workout-finish';
async function main() {
 const [base,confirmation]=process.argv.slice(2);assert(confirmation==='--confirm-synthetic-trial'&&/^http:\/\/127\.0\.0\.1:\d+$/.test(base));
 const dir='artifacts/trainer2/prefill-evidence/';mkdirSync(dir,{recursive:true});
 const template=createHypertrophyPlan(),stageId=randomUUID();
 const mass=(value:string,unit:'kg'|'lb'='kg',convention='barbellTotal')=>({kind:'externalLoad',value,unit,convention,zeroMeaning:'validZero'});
 const positions=()=>[template.occurrences[0].positions[0],template.occurrences[0].positions[1],template.occurrences[2].positions.at(-1)!,template.occurrences[0].positions[2]].map((p,i)=>({...p,id:randomUUID(),sourceKey:undefined,targets:[0,1,2].map(()=>({...p.targets[0],id:randomUUID(),measurement:i===0?mass('60'):null,reps:{min:8,max:10,basis:p.targets[0].reps.basis},rir:'3'}))}));
 const occurrences=['Eligible corrected history','Newer incompatible history','Skipped control','Prefill practice','Finish navigation'].map(name=>({id:randomUUID(),stageId,name,positions:positions()}));
 occurrences[0].positions[1].targets[0].classification='rampUp';
 const intent={schemaVersion:1,name:'SYNTHETIC logger prefill and corrections',endpoint:'endOfOrderedOccurrences',progression:template.progression,stages:[{id:stageId,name:'Synthetic week'}],occurrences};
 const browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage();
 try{
 await page.goto(base+'/trainer2/dev/drafts');await expect(page.getByRole('button',{name:'Save plan',exact:true})).toBeEnabled();
 await page.route('**/api/trainer2/drafts/create',route=>{const c=route.request().postDataJSON();c.intent=intent;return route.continue({postData:JSON.stringify(c)})});
 const saving=page.waitForResponse(r=>r.url().endsWith('/drafts/create')&&r.request().method()==='POST');await page.getByRole('button',{name:'Save plan',exact:true}).click();const response=await saving;assert.equal(response.status(),200,await response.text());
 const command=response.request().postDataJSON(),created=await response.json(),planId=created.outcome.result.planId,accountId=command.originatingAccountId;
 const envelope=()=>({schemaVersion:1,actionId:randomUUID(),deviceId:randomUUID(),originatingAccountId:accountId,ownershipEpoch:0,dependsOn:[]});
 const get=async(path:string)=>{const r=await fetch(base+path);assert(r.ok);return r.json()};
 const post=async(path:string,c:object)=>{const r=await fetch(base+path,{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({...envelope(),...c})});const data=await r.json();assert.equal(r.status,200,JSON.stringify(data));return data.outcome.result};
 const draft=await get('/api/trainer2/drafts/'+planId);await post('/api/trainer2/drafts/activate',{commandType:'ActivatePlan',target:{planId},expected:{planRevisionId:draft.revisionId},intent:{reviewed:draft.activation}});
 const completed=[];
 for(let i=0;i<2;i++){
 const next=await get('/api/trainer2/plans/'+planId+'/next');const started=await post('/api/trainer2/executions/start',{commandType:'StartOccurrence',target:{planId,occurrenceId:next.occurrence.id},expected:{planRevisionId:next.revisionId,instructionEpoch:next.instructionEpoch},intent:{}});
 let ex=await get('/api/trainer2/executions/'+started.executionId);
 for(const positionIndex of [0,1,3])for(const setIndex of [2,1,0]){
 const p=ex.initial.occurrence.positions[positionIndex];
 // Newer RDL and every leg-curl result use a deliberately incompatible load basis.
 const convention=positionIndex===3||i===1&&positionIndex===1?'perImplement':p.exercise.convention;
 const measurement=mass(positionIndex===1?(setIndex===0?'999':setIndex===1?'60':'75'):'45','kg',convention);
 await post('/api/trainer2/executions/results',{commandType:'RecordSetResult',target:{executionId:ex.executionId,targetId:ex.initial.positions[positionIndex].targets[setIndex].id},expected:{resultVersion:0},intent:{result:{measurement,reps:positionIndex===1&&setIndex===1?null:{value:7,basis:p.targets[setIndex].reps.basis},rir:'2'}}});
 }
 ex=await get('/api/trainer2/executions/'+ex.executionId);await post('/api/trainer2/executions/finish',{commandType:'FinishExecution',target:{executionId:ex.executionId},expected:reviewedResults(ex),intent:{acknowledgeUnrecorded:true}});
 if(i===0){const r=ex.results.find((r:any)=>r.targetId===ex.initial.positions[1].targets[1].id);await post('/api/trainer2/executions/corrections',{commandType:'CorrectHistoricalSetResult',target:{executionId:ex.executionId,targetId:r.targetId},expected:{resultVersion:r.version,performedSetId:r.performedSetId},intent:{result:{...r.result,measurement:{...r.result.measurement,value:'62.5'}}}})}
 completed.push(await get('/api/trainer2/executions/'+ex.executionId));
 }
 let next=await get('/api/trainer2/plans/'+planId+'/next');await post('/api/trainer2/occurrences/skip',{commandType:'SkipOccurrence',target:{planId,occurrenceId:next.occurrence.id},expected:{planRevisionId:next.revisionId,acceptedSequence:next.acceptedSequence},intent:{}});
 next=await get('/api/trainer2/plans/'+planId+'/next');
 const url=base+'/trainer2/dev/drafts?planId='+planId;await page.goto(url);await expect(page.getByRole('button',{name:'Start workout',exact:true})).toBeEnabled();
 writeFileSync(dir+'ready.json',JSON.stringify({url,base,planId,accountId,next,completed},null,2));console.log(url);
 }finally{await browser.close()}
}
main().catch(e=>{console.error(e);process.exitCode=1});
