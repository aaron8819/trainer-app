import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { verificationSource } from '../../scripts/trainer2/verification-source';
async function main() {
  assert(['--confirm-synthetic-trial', '--verify-existing'].includes(process.argv[2]));
  const dir = 'artifacts/trainer2/training-ui-evidence/';
  const ready = JSON.parse(readFileSync(dir + 'demo-ready.json','utf8'));
  const controls = JSON.parse(readFileSync(dir + 'controls.json','utf8'));
  const base = new URL(ready.url).origin; assert(/^http:\/\/127\.0\.0\.1:\d+$/.test(base));
  const get = async (path: string) => { const r = await fetch(base+path); assert(r.ok); return r.json(); };
  const before = await get('/api/trainer2/executions/'+controls.executionId);
  if (process.argv[2] === '--verify-existing') {
    assert.deepEqual(before.previous, []);
    writeFileSync(dir+'history-context-final-read.json',JSON.stringify({source:verificationSource(),verifiedAt:new Date().toISOString(),executionId:before.executionId,results:before.results,previous:before.previous,passed:'Final read-only confirmation: current lb results exclude previous kg evidence.'},null,2));
    console.log('PASS final current-unit compatibility read'); return;
  }
  const next = await get('/api/trainer2/plans/'+ready.planId+'/next');
  const targetId = before.initial.positions[0].targets[0].id;
  const saved = before.results.find((r: { targetId: string }) => r.targetId === targetId);
  assert.equal(saved.result.measurement.unit,'kg'); assert(before.previous.some((p: { results: { result: { measurement: { unit: string } } }[] }) => p.results.some(r => r.result.measurement.unit==='kg')));
  const command = { schemaVersion:1, actionId:randomUUID(), deviceId:randomUUID(), originatingAccountId:before.initial.accountId, ownershipEpoch:0, dependsOn:[], commandType:'CorrectHistoricalSetResult', target:{executionId:before.executionId,targetId}, expected:{resultVersion:saved.version,performedSetId:saved.performedSetId}, intent:{result:{...saved.result,measurement:{...saved.result.measurement,unit:'lb'}},reason:'Correct recorded result'} };
  const response = await fetch(base+'/api/trainer2/executions/corrections',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify(command)});
  assert.equal(response.status,200); const outcome=await response.json(); assert.equal(outcome.outcome.status,'Accepted');
  const after=await get('/api/trainer2/executions/'+controls.executionId);
  assert.deepEqual(after.initial,before.initial); assert.deepEqual(after.finish,before.finish); assert.deepEqual(after.previous,[]);
  const afterNext=await get('/api/trainer2/plans/'+ready.planId+'/next');
  assert.deepEqual(afterNext.occurrence,next.occurrence); assert.deepEqual(afterNext.occurrences,next.occurrences);
  writeFileSync(dir+'history-context.json',JSON.stringify({source:verificationSource(),verifiedAt:new Date().toISOString(),executionId:before.executionId,previousBefore:before.previous,previousAfter:after.previous,command,outcome,preserved:['initial prescription','finish fact','evaluation-plan position/status'],passed:'Changing the current exercise results to lb excludes prior kg results through real authorized PostgreSQL readback.'},null,2));
  console.log('PASS recorded-unit compatibility; evaluation plan position unchanged');
}
void main().catch(e=>{console.error(e);process.exitCode=1;});
