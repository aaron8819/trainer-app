import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium, expect } from '@playwright/test';
import { createHypertrophyPlan } from '../../src/lib/engine/trainer2/plan-builder';
import { verificationSource } from '../../scripts/trainer2/verification-source';

async function main() {
  const [base, confirmation] = process.argv.slice(2);
  const ready = JSON.parse(readFileSync('artifacts/trainer2/training-ui-evidence/demo-ready.json', 'utf8'));
  assert(confirmation === '--confirm-synthetic-trial' && /^http:\/\/127\.0\.0\.1:\d+$/.test(base) && new URL(ready.url).origin === base);
  const source = verificationSource(), accountId = ready.next.accountId, planId = randomUUID();
  const get = async (path: string) => { const r = await fetch(base + path); assert(r.ok); return r.json(); };
  const post = async (path: string, data: object) => {
    const r = await fetch(base + path, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({ schemaVersion: 1, actionId: randomUUID(), deviceId: randomUUID(), originatingAccountId: accountId, ownershipEpoch: 0, dependsOn: [], ...data }) });
    const body = await r.json(); assert.equal(r.status, 200, JSON.stringify(body)); return body.outcome.result;
  };
  // Resolve only this task's synthetic verification plan before making an independent fixture.
  for (;;) {
    const next = await get('/api/trainer2/plans/' + ready.planId + '/next');
    if (!next.occurrence) break;
    const started = next.execution ?? await post('/api/trainer2/executions/start', { commandType: 'StartOccurrence', target: { planId: ready.planId, occurrenceId: next.occurrence.id }, expected: { planRevisionId: next.revisionId, instructionEpoch: next.instructionEpoch }, intent: {} });
    const execution = await get('/api/trainer2/executions/' + started.executionId);
    await post('/api/trainer2/executions/finish', { commandType: 'FinishExecution', target: { executionId: execution.executionId }, expected: { contentHash: execution.contentHash, results: execution.initial.positions.flatMap((p:any)=>p.targets.map((t:any)=>({targetId:t.id,resultVersion:0,performedSetId:null}))).sort((a:any,b:any)=>a.targetId.localeCompare(b.targetId)) }, intent: { acknowledgeUnrecorded: true } });
  }
  const template = createHypertrophyPlan(), target = template.occurrences[0].positions[0].targets[0];
  const stages = [{ id: randomUUID(), name: 'Week 1' }, { id: randomUUID(), name: 'Final block' }];
  const external = { kind: 'externalLoad' as const, value: '0', unit: 'kg' as const, convention: 'barbellTotal' as const, zeroMeaning: 'validZero' as const };
  const positions = [
    { id: randomUUID(), role: 'Main lift', exercise: template.occurrences[0].positions[0].exercise, targets: [{ ...target, id: randomUUID(), rir: '1', measurement: external }, { ...target, id: randomUUID(), reps: { min: 10, max: 12, basis: 'total' }, rir: '4', measurement: { ...external, unit: 'lb' } }] },
    { id: randomUUID(), exercise: { kind: 'authoredDescription', name: template.occurrences[0].positions[0].exercise.name, variation: '' }, targets: [{ ...target, id: randomUUID(), measurement: { kind: 'bodyweight', convention: 'bodyweightOnly' } }] },
    { id: randomUUID(), exercise: { kind: 'authoredDescription', name: 'Synthetic assistance', variation: '' }, targets: [{ ...target, id: randomUUID(), reps: { min: 6, max: 8, basis: 'perSide' }, measurement: { kind: 'assistance', convention: 'displayedAssistance', value: '0', unit: 'lb', zeroMeaning: 'noAssistance' } }] },
  ];
  const occurrences = [0, 1, 2].map(i => ({ id: randomUUID(), stageId: stages[i === 2 ? 1 : 0].id, name: 'Duplicate workout', positions: i === 0 ? positions : [{ id: randomUUID(), exercise: { kind: 'authoredDescription', name: 'Unmatched custom exercise', variation: '' }, targets: [{ ...target, id: randomUUID() }] }] }));
  const intent = { schemaVersion: 1, name: 'SYNTHETIC independent controls', endpoint: 'endOfOrderedOccurrences', progression: template.progression, stages, occurrences };
  await post('/api/trainer2/drafts/create', { commandType: 'CreateDraft', target: { planId }, expected: {}, intent });
  const draft = await get(`/api/trainer2/drafts/${planId}`);
  await post('/api/trainer2/drafts/activate', { commandType: 'ActivatePlan', target: { planId }, expected: { planRevisionId: draft.revisionId }, intent: { reviewed: draft.activation } });

  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('dialog',d=>void d.accept());
  try {
    await page.goto(base+'/trainer2/dev/drafts?planId='+planId);
    await page.getByRole('button',{name:'Start workout',exact:true}).click();await expect(page).toHaveURL(/executions\//);
    const executionId=page.url().split('/').at(-1)!;
    const panel=page.getByRole('region',{name:'Active set',exact:true});
    const queue=page.getByRole('region',{name:'Exercise queue'});
    await expect(panel).toContainText('1 RIR'); await expect(panel.getByLabel(/load unit$/)).toHaveValue('kg');
    for (let i=0;i<4;i++) {
      if(i===1){await expect(panel).toContainText('10–12 reps');await expect(panel).toContainText('4 RIR');await expect(panel.getByLabel(/load unit$/)).toHaveValue('lb');}
      if(i===2) await expect(panel).toContainText('No comparable previous performance');
      await panel.getByLabel(/Actual reps/).fill(i===2?'0':'6');
      const load=panel.getByLabel(/Actual load$/);if(await load.count())await load.fill(i===1?'45':'0');
      await panel.getByRole('button',{name:'Log set',exact:true}).click();await expect(panel).toContainText((i+1)+' of 4 sets recorded');
    }
    await expect(panel).toContainText('Ready to finish');
    const read=await get('/api/trainer2/executions/'+executionId);
    const results=read.initial.positions.flatMap((p:any)=>p.targets.map((t:any)=>read.results.find((r:any)=>r.targetId===t.id).result));
    assert.equal(results[0].measurement.unit,'kg');assert.equal(results[0].measurement.value,'0');assert.equal(results[1].measurement.unit,'lb');assert.equal(results[2].measurement.kind,'bodyweight');assert.equal(results[2].reps.value,0);assert.equal(results[3].measurement.kind,'assistance');assert.equal(results[3].reps.basis,'perSide');
    await queue.getByRole('button',{name:/, set 1, recorded/}).last().click();await panel.getByRole('button',{name:'Edit result'}).click();await panel.locator('summary').last().click();await panel.getByLabel(/actual load type$/).selectOption('addedLoad');await panel.getByLabel(/rep basis$/).selectOption('alternating');await panel.getByLabel(/correction reason/).fill('Added load control');await panel.getByRole('button',{name:'Save correction'}).click();await expect(panel).toContainText('Ready to finish');
    const changed=await get('/api/trainer2/executions/'+executionId);assert.equal(changed.results.find((r:any)=>r.targetId===read.initial.positions[2].targets[0].id).result.measurement.kind,'addedLoad');
    await page.getByRole('button',{name:'Finish workout',exact:true}).click();await page.getByRole('button',{name:'Confirm finish'}).click();await expect(page).toHaveURL(/planId=/);
    writeFileSync('artifacts/trainer2/active-set-evidence/controls.json',JSON.stringify({source:verificationSource(),executionId,read,changed,passes:['Saved independent order and duplicate exercise names','Different rep/RIR prescriptions and kg/lb','Bodyweight and explicit zero','Assistance per-side and added-load alternating correction','Absent authored-description history','All-recorded finish']},null,2));
  } finally {await browser.close();}
}
void main().catch(e=>{console.error(e);process.exitCode=1;});
