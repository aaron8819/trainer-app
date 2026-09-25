import { commandBinding } from '../../src/lib/api/trainer2/integrity';
import { finishExecution } from '../../src/lib/api/trainer2/workout-finish';
import { reviewedResults, type FinishExecutionCommand } from '../../src/lib/trainer2-contracts/workout-finish';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Prisma, PrismaClient } from '@prisma/client';
import type { Pool } from 'pg';
import { chromium, expect as playwrightExpect } from '@playwright/test';
import { createDraft, readDraft, ActionCollision, type ServerPrincipal } from '../../src/lib/api/trainer2/planning';
import { activatePlan } from '../../src/lib/api/trainer2/activation';
import { startOccurrence, readExecution, readNextWorkout } from '../../src/lib/api/trainer2/execution';
import { saveSetResult } from '../../src/lib/api/trainer2/set-results';
import { createHypertrophyPlan } from '../../src/lib/engine/trainer2/plan-builder';
import type { SetResultCommand, PerformedResult } from '../../src/lib/trainer2-contracts/set-results';
import type { ExecutionRead } from '../../src/lib/trainer2-contracts/execution';
const expect = playwrightExpect.configure({ timeout: 30_000 });

export async function verifyWorkoutFinish(db: PrismaClient, reader: PrismaClient, owner: PrismaClient, admin: Pool,
  browserPrincipal: ServerPrincipal, startWeb: () => Promise<string>, restartWeb: () => Promise<string>, upgrade: (accountId: string) => Promise<unknown>) {
  const results: string[] = [], preservation: unknown[] = [];
  const pass = (s: string) => { results.push(s); console.log(`PASS ${s}`); writeFileSync(resolve('artifacts/trainer2/workout-finish-progress.json'), JSON.stringify({ results, preservation }, null, 2)); };
  const envelope = (p: ServerPrincipal) => ({ schemaVersion: 1 as const, actionId: randomUUID(), originatingAccountId: p.accountId, deviceId: randomUUID(), ownershipEpoch: 0, dependsOn: [] });
  const account = async () => { const p = { accountId: randomUUID(), sessionId: randomUUID(), issuer: 'result-test', subject: randomUUID() }; await owner.user.create({ data: { id: p.accountId, email: `${p.subject}@trainer2.invalid` } }); await owner.trainer2AccountPrincipal.create({ data: { id: randomUUID(), ...p } }); return p; };
  const create = async (p: ServerPrincipal, independent: boolean | 'mixed' = false, optionalOnly = false) => {
    let intent = createHypertrophyPlan();
    if (independent) {
      const stageId = randomUUID(); const positions = Array.from({ length: 6 }, (_, i) => ({ id: randomUUID(), exercise: { kind: 'authoredDescription' as const, name: i === 1 ? 'Alpha' : 'Zulu', variation: 'Synthetic' },
        targets: [{ id: randomUUID(), required: !optionalOnly && i % 2 === 0, classification: (['preparation', 'rampUp', 'working', 'optionalFinisher'] as const)[i % 4],
          reps: { min: 3, max: 6, basis: (['total', 'perSide', 'alternating'] as const)[i % 3] },
          measurement: i === 0 ? null : i === 1 ? { kind: 'bodyweight' as const, convention: 'bodyweightOnly' as const } : i === 2 ? { kind: 'addedLoad' as const, value: '0.00', unit: 'lb' as const, convention: 'addedExternal' as const, zeroMeaning: 'noAddedLoad' as const } : i === 3 ? { kind: 'assistance' as const, value: '2.00', unit: 'kg' as const, convention: 'displayedAssistance' as const, zeroMeaning: 'noAssistance' as const } : { kind: 'externalLoad' as const, value: '1.0', unit: 'kg' as const, convention: i === 4 ? 'perImplement' as const : 'machineDisplayed' as const, zeroMeaning: 'validZero' as const }, rir: i === 0 ? null : '0', restSeconds: null }] }));
      intent = { schemaVersion: 1, name: 'Mixed independent workout', endpoint: 'endOfOrderedOccurrences', progression: intent.progression,
        stages: [{ id: stageId, name: 'Synthetic stage' }], occurrences: [{ id: randomUUID(), stageId, name: 'Mixed sets', positions }] };
    }
    if (independent === 'mixed') {
      const template = createHypertrophyPlan();
      const first = template.occurrences[0];
      // Saved mixed order crosses stages; identical labels cannot select identities.
      intent = { schemaVersion: 1, name: 'Mixed copied prescriptions', endpoint: template.endpoint, progression: template.progression,
        stages: [...template.stages, ...intent.stages], occurrences: [first, ...intent.occurrences, ...template.occurrences.slice(1)].map(o => ({
          id: o.id, stageId: o.stageId, name: o.name, positions: o.positions.map(p => ({ id: p.id, exercise: p.exercise, ...(p.role ? { role: p.role } : {}), targets: p.targets })) })) };
      intent.occurrences = intent.occurrences.map(o => ({ ...o, name: 'Same workout name' }));
    }
    const planId = randomUUID(); assert.equal((await createDraft(db, p, { ...envelope(p), commandType: 'CreateDraft', target: { planId }, expected: {}, intent })).outcome.status, 'Accepted');
    const h = (await readDraft(reader, p, planId))!;
    assert.equal((await activatePlan(db, p, { ...envelope(p), commandType: 'ActivatePlan', target: { planId }, expected: { planRevisionId: h.revisionId }, intent: { reviewed: h.activation } })).outcome.status, 'Accepted');
    const start = await startOccurrence(db, p, { ...envelope(p), commandType: 'StartOccurrence', target: { planId, occurrenceId: h.intent.occurrences[0].id }, expected: { planRevisionId: h.revisionId, instructionEpoch: 0 }, intent: {} });
    assert.equal(start.outcome.status, 'Accepted'); if (start.outcome.status !== 'Accepted') throw new Error('Start failed');
    return (await readExecution(reader, p, start.outcome.result.executionId))!;
  };
  const actual = (value = 7): PerformedResult => ({ reps: { value, basis: 'total' }, measurement: null, rir: null });
  const record = (p: ServerPrincipal, x: ExecutionRead, index = 0, result = actual()): SetResultCommand => ({ ...envelope(p), commandType: 'RecordSetResult',
    target: { executionId: x.executionId, targetId: x.initial.positions.flatMap(p => p.targets)[index].id }, expected: { resultVersion: 0 }, intent: { result } });
  const correction = (p: ServerPrincipal, c: SetResultCommand, performedSetId: string, version: number, result: PerformedResult | null = actual(8)): SetResultCommand => ({
    ...envelope(p), commandType: 'CorrectSetResult', target: c.target, expected: { resultVersion: version, performedSetId }, intent: { result, reason: result ? 'Correct typing mistake' : 'Accidentally recorded' } });
  const accept = (r: Awaited<ReturnType<typeof saveSetResult>>) => { assert.equal(r.outcome.status, 'Accepted'); if (r.outcome.status !== 'Accepted') throw new Error('Expected accepted'); return r.outcome.result; };
  const conflict = (r: { outcome: { status: string; code?: string } }, code = 'STALE_SET_RESULT') => { assert.notEqual(r.outcome.status, 'Accepted'); assert.equal(r.outcome.code, code); };
  const persisted = async (p: ServerPrincipal) => (await admin.query('SELECT * FROM "Trainer2SetResultRevision" WHERE "accountId"=$1 ORDER BY "targetId","version"', [p.accountId])).rows;
  async function race<T, U>(p: ServerPrincipal, first: () => Promise<T>, second: () => Promise<U>) {
    const lock = await admin.connect(); await lock.query('BEGIN');
    const pid = (await lock.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    await lock.query('SELECT "accountId" FROM "Trainer2AccountTrainingState" WHERE "accountId"=$1 FOR UPDATE', [p.accountId]);
    const waiting = async (count: number) => { const deadline = Date.now() + 8000; for (;;) {
      const r = await admin.query('WITH RECURSIVE waiting(pid) AS (SELECT pid FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid)) UNION SELECT a.pid FROM pg_stat_activity a JOIN waiting w ON w.pid=ANY(pg_blocking_pids(a.pid))) SELECT DISTINCT pid FROM waiting', [pid]);
      if (r.rowCount! >= count) return; if (Date.now() > deadline) throw new Error('Expected observed result lock queue'); await new Promise(r => setTimeout(r, 20));
    } };
    let a: Promise<T> | undefined, b: Promise<U> | undefined;
    try { a = first(); await waiting(1); b = second(); await waiting(2); await lock.query('COMMIT'); return await Promise.all([a, b]); }
    finally { await lock.query('ROLLBACK'); lock.release(); await Promise.allSettled([a, b].filter(Boolean)); }
  }
  const read = async (p: ServerPrincipal, x: ExecutionRead) => (await readExecution(reader, p, x.executionId))!;
  const finish = (p: ServerPrincipal, x: ExecutionRead, acknowledgeUnrecorded = true): FinishExecutionCommand => ({ ...envelope(p), commandType: 'FinishExecution', target: { executionId: x.executionId }, expected: reviewedResults(x), intent: { acknowledgeUnrecorded } });
  const ok = (r: { outcome: { status: string } }) => assert.equal(r.outcome.status, 'Accepted');
  const fact = async (p: ServerPrincipal, x: ExecutionRead, before: unknown) => {
    const rows = (await admin.query('SELECT * FROM "Trainer2Execution" WHERE id=$1', [x.executionId])).rows;
    assert.equal(rows[0].lifecycle, 'Finished'); assert.deepEqual(rows[0].initialPrescription, x.initial);
    assert.deepEqual(await persisted(p), before);
    assert.equal((await admin.query('SELECT count(*) FROM "Trainer2ExecutionFinish" WHERE "executionId"=$1', [x.executionId])).rows[0].count, '1');
    preservation.push({ executionId: x.executionId, contentHash: rows[0].contentHash, resultsUnchanged: true });
  };
  const up = await account(); const ux = await create(up, true); accept(await saveSetResult(db, up, record(up, ux))); await upgrade(up.accountId);
  pass('Fresh chain and populated accepted-base upgrade: twelve tables unchanged, existing results and Open workout finishable');
  for (const independent of [false, true, 'mixed'] as const) {
    const p = await account(); let x = await create(p, independent, independent === true); const planId = x.initial.planId;
    const originalPlan = (await owner.trainer2PlanRevision.findUniqueOrThrow({ where: { id: x.initial.revisionId } })).document as { occurrences: { id: string }[] };
    // All-required-recorded case, optional entries deliberately absent in the independent fixture.
    for (const [i, t] of x.initial.positions.flatMap(p => p.targets).entries()) {
      const source = x.initial.occurrence.positions.flatMap(p => p.targets).find(s => s.id === t.sourceTargetId)!;
      if (source.required) accept(await saveSetResult(db, p, record(p, x, i)));
    }
    x = await read(p, x); const before = await persisted(p); const c = finish(p, x);
    ok(await finishExecution(db, p, c)); await fact(p, x, before);
    assert.equal((await read(p, x)).finish!.unknownTargetIds.length, x.initial.positions.flatMap(p => p.targets).length - x.results.length);
    const replay = await finishExecution(db, p, c); ok(replay); assert(replay.replayed);
    await assert.rejects(finishExecution(db, p, { ...c, intent: { acknowledgeUnrecorded: false } }), ActionCollision);
    conflict(await finishExecution(db, p, finish(p, x)), 'ALREADY_FINISHED');
    for (const o of originalPlan.occurrences.slice(1)) {
      const n = await readNextWorkout(reader, p, planId); assert.equal(n.occurrence?.id, o.id);
      const start = await startOccurrence(db, p, { ...envelope(p), commandType: 'StartOccurrence', target: { planId, occurrenceId: o.id }, expected: { planRevisionId: n.revisionId, instructionEpoch: n.instructionEpoch }, intent: {} }); ok(start);
      if (start.outcome.status !== 'Accepted') throw new Error('Start');
      x = (await readExecution(reader, p, start.outcome.result.executionId))!;
      ok(await finishExecution(db, p, finish(p, x)));
    }
    const end = await readNextWorkout(reader, p, planId); assert.equal(end.lifecycle, 'Completed'); assert.equal(end.occurrence, null); assert.equal(end.execution, null);
    assert.equal((await admin.query('SELECT lifecycle FROM "Trainer2Plan" WHERE id=$1', [planId])).rows[0].lifecycle, 'Completed');
    // Old successful commands remain replayable after final closure.
    ok(await finishExecution(db, p, c)); assert.equal((await readNextWorkout(reader, p, planId)).lifecycle, 'Completed');
    pass(`${independent === 'mixed' ? 'Mixed duplicate-name stages' : independent ? 'Independent optional-only' : 'Template stage'} ordering, finish/readback/start-next, endpoint closure and historical replay`);
  }
  for (const kind of ['record', 'correct', 'clear', 're-record'] as const) for (const first of ['result', 'finish'] as const) {
    const p = await account(); let x = await create(p, true); let mutation = record(p, x);
    if (kind !== 'record') {
      const r = accept(await saveSetResult(db, p, mutation));
      if (kind === 're-record') { const cleared = accept(await saveSetResult(db, p, correction(p, mutation, r.performedSetId, 1, null))); mutation = correction(p, mutation, cleared.performedSetId, 2); }
      else mutation = correction(p, mutation, r.performedSetId, 1, kind === 'clear' ? null : actual(7));
    }
    x = await read(p, x); const c = finish(p, x), history = await persisted(p);
    if (first === 'result') {
      const [a,b] = await race(p, () => saveSetResult(db,p,mutation), () => finishExecution(db,p,c)); ok(a); conflict(b,'STALE_FINISH_RESULTS');
      assert.equal((await read(p,x)).lifecycle,'Open'); ok(await finishExecution(db,p,finish(p,await read(p,x))));
    } else {
      const [a,b] = await race(p, () => finishExecution(db,p,c), () => saveSetResult(db,p,mutation)); ok(a); conflict(b,'EXECUTION_NOT_OPEN'); await fact(p,x,history);
    }
    pass(`Controlled PostgreSQL ${kind} versus finish: ${first} wins, valid serial outcome`);
  }
  for (const identical of [true,false]) {
    const p = await account(), x = await create(p,true), c = finish(p,x);
    const [a,b] = await race(p,()=>finishExecution(db,p,c),()=>finishExecution(db,p,identical ? c : finish(p,x))); ok(a);
    if (identical) { ok(b); assert(b.replayed); } else conflict(b,'ALREADY_FINISHED');
    await fact(p,x,[]); pass(`Controlled concurrent ${identical ? 'identical' : 'distinct'} finishes`);
  }
  for (const first of ['finish','start']) {
    const p=await account(), x=await create(p), planId=x.initial.planId;
    const h=(await readDraft(reader,p,planId))!; const nextId=h.intent.occurrences[1].id;
    const c={...envelope(p),commandType:'StartOccurrence',target:{planId,occurrenceId:nextId},expected:{planRevisionId:h.revisionId,instructionEpoch:0},intent:{}};
    if(first==='finish') {const [a,b]=await race(p,()=>finishExecution(db,p,finish(p,x)),()=>startOccurrence(db,p,c));ok(a);ok(b);}
    else {const [a,b]=await race(p,()=>startOccurrence(db,p,c),()=>finishExecution(db,p,finish(p,x)));conflict(a,'OCCURRENCE_NOT_NEXT');ok(b);}
    const open=(await admin.query(`SELECT "occurrenceId" FROM "Trainer2Execution" WHERE "accountId"=$1 AND lifecycle='Open'`,[p.accountId])).rows;
    assert.deepEqual(open.map(r=>r.occurrenceId),first==='finish'?[nextId]:[]); pass(`Controlled finish versus next-start: ${first} wins`);
  }
  {
    const p=await account(); let x=await create(p,true); const c=finish(p,x,false);
    conflict(await finishExecution(db,p,c),'UNRECORDED_ACKNOWLEDGEMENT_REQUIRED'); assert.equal((await read(p,x)).lifecycle,'Open');
    const r=accept(await saveSetResult(db,p,record(p,x))); accept(await saveSetResult(db,p,correction(p,record(p,x),r.performedSetId,1,null)));
    x=await read(p,x); const clearFinish=finish(p,x); const before=await persisted(p);
    await assert.rejects(finishExecution(db,{...p,accountId:(await account()).accountId},clearFinish));
    conflict(await finishExecution(db,p,{...finish(p,x),target:{executionId:randomUUID()}}),'NOT_FOUND');
    conflict(await finishExecution(db,p,{...finish(p,x),expected:{...reviewedResults(x),results:[]}}),'STALE_FINISH_RESULTS');
    await assert.rejects(finishExecution(db,p,{...finish(p,x),expected:undefined}));
    await admin.query(`CREATE FUNCTION trainer2_test_finish_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."outcome"->>'commandType'='FinishExecution' AND NEW."status"='Accepted' THEN RAISE EXCEPTION 'synthetic rollback'; END IF; RETURN NEW; END $$; CREATE TRIGGER trainer2_test_finish_failure BEFORE INSERT ON "Trainer2ActionOutcome" FOR EACH ROW EXECUTE FUNCTION trainer2_test_finish_failure()`);
    await assert.rejects(finishExecution(db,p,clearFinish));
    assert.equal((await read(p,x)).lifecycle,'Open'); assert.equal(await owner.trainer2ExecutionFinish.count({where:{executionId:x.executionId}}),0); assert.deepEqual(await persisted(p),before);
    assert.equal(await owner.trainer2DurableAction.count({where:{actionId:clearFinish.actionId}}),0);
    await admin.query('DROP TRIGGER trainer2_test_finish_failure ON "Trainer2ActionOutcome"; DROP FUNCTION trainer2_test_finish_failure()');
    ok(await finishExecution(db,p,clearFinish)); await fact(p,x,before); assert.equal((await read(p,x)).finish!.unknownTargetIds.length,6);
    await assert.rejects(db.trainer2Execution.update({where:{id:x.executionId},data:{lifecycle:'Open'}}));
    await assert.rejects(reader.trainer2ExecutionFinish.create({data:(await owner.trainer2ExecutionFinish.findUniqueOrThrow({where:{executionId:x.executionId}})) as Prisma.Trainer2ExecutionFinishCreateInput}));
    await assert.rejects(db.$executeRawUnsafe(`UPDATE "Trainer2Execution" SET "contentHash"='bad' WHERE id=$1`,x.executionId));
    await assert.rejects(db.$executeRawUnsafe('DELETE FROM "Trainer2ExecutionFinish" WHERE "executionId"=$1',x.executionId));
    assert.equal((await admin.query(`SELECT count(*) FROM information_schema.role_table_grants WHERE grantee='PUBLIC' AND table_name='Trainer2ExecutionFinish'`)).rows[0].count,'0');
    pass('Missing/cleared work, exact acknowledgement, ownership, missing binding, atomic rollback and restricted mutation denials');
  }
  {
    const p=await account(), x=await create(p,true), c=finish(p,x);
    const data={executionId:x.executionId,accountId:p.accountId,planId:x.initial.planId,revisionId:x.initial.revisionId,
      occurrenceId:x.initial.occurrence.id,actionId:c.actionId,expected:c.expected,
      unknownTargetIds:x.initial.positions.flatMap(p=>p.targets.map(t=>t.id)).sort(),planCompleted:true,priorPlanLifecycle:'Active',
      endpoint:{kind:'endOfOrderedOccurrences',occurrenceIds:[x.initial.occurrence.id]},finishedAt:new Date()};
    // Direct restricted-role writes must not commit without the linked outcome or bypass the reviewed state.
    for(const mode of ['missing-outcome','stale-binding','late-result']) {
      await assert.rejects(db.$transaction(async tx=>{
        await tx.trainer2DurableAction.create({data:{accountId:p.accountId,actionId:c.actionId,...commandBinding(c)}});
        await tx.trainer2ExecutionFinish.create({data:mode==='stale-binding'?{...data,expected:{...data.expected,results:[]}}:data});
        if(mode==='late-result') {
          const rc=record(p,x);await tx.trainer2DurableAction.create({data:{accountId:p.accountId,actionId:rc.actionId,...commandBinding(rc)}});
          await tx.trainer2SetResultRevision.create({data:{...rc.target,accountId:p.accountId,performedSetId:randomUUID(),version:1,actionId:rc.actionId,result:actual()}});
        }
      }));
      assert.equal((await read(p,x)).lifecycle,'Open');assert.equal(await owner.trainer2ExecutionFinish.count({where:{executionId:x.executionId}}),0);
    }
    await assert.rejects(db.trainer2Execution.update({where:{id:x.executionId},data:{lifecycle:'Finished'}}));
    await assert.rejects(db.trainer2Plan.update({where:{id:x.initial.planId},data:{lifecycle:'Completed'}}));
    pass('Direct runtime finish/outcome, binding, late-result and lifecycle bypass attempts roll back');
  }
  const bx=await create(browserPrincipal,true); const base=await startWeb();
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try {
    const context=await browser.newContext({viewport:{width:1280,height:1000}});const page=await context.newPage(); const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
    const path=`/trainer2/dev/executions/${bx.executionId}`;await page.goto(base+path);
    await expect(page.getByRole('heading',{name:'Workout in progress',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Enter actual result'}).first().click();
    await page.getByLabel('Set 1 Actual reps',{exact:true}).first().fill('9');
    await expect(page.getByRole('button',{name:'Finish workout',exact:true})).toBeDisabled();
    await page.getByRole('button',{name:'Record set',exact:true}).click();await expect(page.getByText('Saved v1:',{exact:false})).toBeVisible();
    await page.getByRole('button',{name:'Finish workout',exact:true}).click();
    await expect(page.getByText(/required and .* optional sets are unrecorded/)).toBeVisible();
    // Drop a committed finish response; reload must retain and replay the exact command.
    let dropped=false;
    await page.route('**/api/trainer2/executions/finish',async route=>{await route.fetch();dropped=true;await route.abort();});
    await page.getByRole('button',{name:'Finish with unrecorded sets',exact:true}).click();
    await expect(page.getByText(/Finish could not be confirmed/)).toBeVisible(); assert(dropped);
    await page.unroute('**/api/trainer2/executions/finish');await page.reload();
    await page.getByRole('button',{name:'Check finish again'}).click();
    await expect(page.getByRole('heading',{name:'Workout finished',exact:true})).toBeVisible();
    await expect(page.getByRole('heading',{name:'Plan complete',exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'Enter actual result'})).toHaveCount(0);
    await page.screenshot({path:resolve('artifacts/trainer2/workout-finish-desktop.png'),fullPage:true});
    await page.setViewportSize({width:390,height:844});await page.screenshot({path:resolve('artifacts/trainer2/workout-finish-mobile.png'),fullPage:true});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    // A second plan exercises the actual explicit next-start button after a partial finish.
    const journey=await create(browserPrincipal);
    await page.goto(base+`/trainer2/dev/executions/${journey.executionId}`);
    await page.getByRole('button',{name:'Finish workout',exact:true}).click();
    await page.getByRole('button',{name:'Finish with unrecorded sets',exact:true}).click();
    await expect(page.getByRole('button',{name:'Start workout',exact:true})).toBeVisible();
    const expectedNext=(await readNextWorkout(reader,browserPrincipal,journey.initial.planId)).occurrence!.id;
    await page.getByRole('button',{name:'Start workout',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Workout in progress',exact:true})).toBeVisible();
    const current=(await admin.query(`SELECT "occurrenceId" FROM "Trainer2Execution" WHERE "accountId"=$1 AND lifecycle='Open'`,[browserPrincipal.accountId])).rows;
    assert.deepEqual(current.map(r=>r.occurrenceId),[expectedNext]);
    const before=await read(browserPrincipal,bx);const restarted=await restartWeb();await page.goto(restarted+path);
    await expect(page.getByRole('heading',{name:'Workout finished',exact:true})).toBeVisible();assert.deepEqual(await read(browserPrincipal,bx),before);assert.deepEqual(errors,[]);
    pass('Real browser input guard, partial finish, committed lost-response recovery, completed bookmark, desktop/mobile and same-DB process restart');
  } finally {await browser.close();}
  return {results,preservation};
}
