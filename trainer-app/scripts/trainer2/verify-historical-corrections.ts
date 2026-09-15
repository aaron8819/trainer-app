import { validateExecutionRead } from '../../src/lib/trainer2-contracts/execution';
import { verifyHistoricalUpgrade } from './verify-historical-upgrade';
import { commandBinding } from '../../src/lib/api/trainer2/integrity';
import { finishExecution } from '../../src/lib/api/trainer2/workout-finish';
import { reviewedResults, type FinishExecutionCommand } from '../../src/lib/trainer2-contracts/workout-finish';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Prisma, type PrismaClient } from '@prisma/client';
import type { Pool } from 'pg';
import { chromium, expect as playwrightExpect } from '@playwright/test';
import { createDraft, readDraft, ActionCollision, type ServerPrincipal } from '../../src/lib/api/trainer2/planning';
import { activatePlan } from '../../src/lib/api/trainer2/activation';
import { startOccurrence, readExecution, readNextWorkout } from '../../src/lib/api/trainer2/execution';
import { saveSetResult, correctHistoricalSetResult } from '../../src/lib/api/trainer2/set-results';
import { createHypertrophyPlan } from '../../src/lib/engine/trainer2/plan-builder';
import type { SetResultCommand, PerformedResult } from '../../src/lib/trainer2-contracts/set-results';
import type { ExecutionRead } from '../../src/lib/trainer2-contracts/execution';
const expect = playwrightExpect.configure({ timeout: 30_000 });

export async function verifyHistoricalCorrections(db: PrismaClient, reader: PrismaClient, owner: PrismaClient, admin: Pool,
  browserPrincipal: ServerPrincipal, startWeb: () => Promise<string>, restartWeb: () => Promise<string>, ownerUrl: string, runtimeUrl: string,
  command: (exe: string, args: string[], env?: NodeJS.ProcessEnv) => string) {
  const results: string[] = [], preservation: unknown[] = [];
  const pass = (s: string) => { results.push(s); console.log(`PASS ${s}`); writeFileSync(resolve('artifacts/trainer2/historical-corrections-progress.json'), JSON.stringify({ results, preservation }, null, 2)); };
  const envelope = (p: ServerPrincipal) => ({ schemaVersion: 1 as const, actionId: randomUUID(), originatingAccountId: p.accountId, deviceId: randomUUID(), ownershipEpoch: 0, dependsOn: [] });
  const account = async () => { const p = { accountId: randomUUID(), issuer: 'result-test', subject: randomUUID() }; await owner.user.create({ data: { id: p.accountId, email: `${p.subject}@trainer2.invalid` } }); await owner.trainer2AccountPrincipal.create({ data: { id: randomUUID(), ...p } }); return p; };
  const create = async (p: ServerPrincipal, independent: boolean | 'mixed' = false, optionalOnly = false, write = db, readDb = reader) => {
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
    const planId = randomUUID(); assert.equal((await createDraft(write, p, { ...envelope(p), commandType: 'CreateDraft', target: { planId }, expected: {}, intent })).outcome.status, 'Accepted');
    const h = (await readDraft(readDb, p, planId))!;
    assert.equal((await activatePlan(write, p, { ...envelope(p), commandType: 'ActivatePlan', target: { planId }, expected: { planRevisionId: h.revisionId }, intent: { reviewed: h.activation } })).outcome.status, 'Accepted');
    const start = await startOccurrence(write, p, { ...envelope(p), commandType: 'StartOccurrence', target: { planId, occurrenceId: h.intent.occurrences[0].id }, expected: { planRevisionId: h.revisionId, instructionEpoch: 0 }, intent: {} });
    assert.equal(start.outcome.status, 'Accepted'); if (start.outcome.status !== 'Accepted') throw new Error('Start failed');
    return (await readExecution(readDb, p, start.outcome.result.executionId))!;
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
  const historical = (p: ServerPrincipal, x: ExecutionRead, index = 0, result = actual(9)) => {
    const r = x.results.filter(r => r.result !== null)[index]; return { ...envelope(p), commandType: 'CorrectHistoricalSetResult' as const,
      target: { executionId: x.executionId, targetId: r.targetId }, expected: { resultVersion: r.version, performedSetId: r.performedSetId },
      intent: { result, reason: 'Correct recorded result' as const } };
  };
  const snapshot = async (p: ServerPrincipal) => {
    const tables = ['Trainer2Plan','Trainer2PlanRevision','Trainer2Execution','Trainer2ExecutionFinish','Trainer2PlanDecision'];
    const rows = Object.fromEntries(await Promise.all(tables.map(async table => [table, (await admin.query(`SELECT to_jsonb(t) row FROM "${table}" t WHERE "accountId"=$1 ORDER BY to_jsonb(t)::text`, [p.accountId])).rows])));
    rows.finishOutcomes = (await admin.query(`SELECT to_jsonb(t) row FROM "Trainer2ActionOutcome" t WHERE "accountId"=$1 AND outcome->>'commandType'='FinishExecution' ORDER BY "outcomeCursor"`,[p.accountId])).rows;
    return rows;
  };
  const preserve = async (p: ServerPrincipal, before: unknown, label: string) => { const after = await snapshot(p); assert.deepEqual(after, before); preservation.push({ label, before, after }); };
  const completed = async (p: ServerPrincipal, independent: boolean = true) => { let x = await create(p, independent);
    for (const i of [0,1,2]) accept(await saveSetResult(db,p,record(p,x,i)));
    const cleared = accept(await saveSetResult(db,p,record(p,x,3))); accept(await saveSetResult(db,p,correction(p,record(p,x,3),cleared.performedSetId,1,null)));
    x=await read(p,x); ok(await finishExecution(db,p,finish(p,x))); return read(p,x);
  };
  const upgrade = await verifyHistoricalUpgrade(admin,ownerUrl,runtimeUrl,command,async (up,upOwner) => {
    const p={accountId:randomUUID(),issuer:'upgrade',subject:randomUUID()};
    await upOwner.user.create({data:{id:p.accountId,email:`${p.subject}@trainer2.invalid`}}); await upOwner.trainer2AccountPrincipal.create({data:{id:randomUUID(),...p}});
    let x=await create(p,true,false,up,up); accept(await saveSetResult(up,p,record(p,x))); x=(await readExecution(up,p,x.executionId))!;
    ok(await finishExecution(up,p,finish(p,x))); const finished=(await readExecution(up,p,x.executionId))!;
    const open=await create(p,true,false,up,up); accept(await saveSetResult(up,p,record(p,open)));
    return async () => { ok(await correctHistoricalSetResult(up,p,historical(p,finished))); assert.deepEqual((await readExecution(up,p,finished.executionId))!.finish,finished.finish); assert.equal((await readExecution(up,p,open.executionId))!.lifecycle,'Open'); };
  }); pass('Fresh deploy/redeploy and populated accepted-base upgrade preserve Open, Finished and history without invented corrections');
  {
    const p=await account(); let x=await completed(p); const before=await snapshot(p), next=await readNextWorkout(reader,p,x.initial.planId), old=await persisted(p);
    const values: PerformedResult[] = [actual(0), {reps:null,measurement:{kind:'bodyweight',convention:'bodyweightOnly'},rir:null},
      {reps:{value:3,basis:'perSide'},measurement:{kind:'addedLoad',value:'0.00',unit:'lb',convention:'addedExternal',zeroMeaning:'noAddedLoad'},rir:'0'},
      {reps:{value:4,basis:'alternating'},measurement:{kind:'assistance',value:'0',unit:'kg',convention:'displayedAssistance',zeroMeaning:'noAssistance'},rir:'10'},
      ...(['barbellTotal','perImplement','machineDisplayed'] as const).map(convention=>({reps:null,measurement:{kind:'externalLoad' as const,value:'0.00',unit:'kg' as const,convention,zeroMeaning:'validZero' as const},rir:null}))];
    for(const [i,result] of values.entries()) {const c=historical(p,x,i%3,result);ok(await correctHistoricalSetResult(db,p,c));x=await read(p,x);await validateExecutionRead(x,p.accountId);}
    await assert.rejects(validateExecutionRead({...x,history:x.history!.slice(1)},p.accountId));
    await assert.rejects(validateExecutionRead({...x,finish:{...x.finish!,expected:{...x.finish!.expected,results:[]}}},p.accountId));
    assert.deepEqual((await persisted(p)).filter(r=>old.some(o=>o.actionId===r.actionId)),old);
    await preserve(p,before,'all measurement variants, required/optional and repeated corrections'); assert.deepEqual(await readNextWorkout(reader,p,x.initial.planId),{...next,acceptedSequence:String(BigInt(next.acceptedSequence)+BigInt(values.length))});
    assert.equal(x.lifecycle,'Finished'); assert.equal(next.lifecycle,'Completed'); pass('Required/optional, previous corrections, all load conventions, rep bases, zero and final-plan completion');
    const never=x.initial.positions.flatMap(p=>p.targets)[4].id, cleared=x.results.find(r=>r.result===null)!;
    for(const targetId of [never,cleared.targetId]) conflict(await correctHistoricalSetResult(db,p,{...historical(p,x),target:{executionId:x.executionId,targetId}}),'HISTORICAL_RESULT_REQUIRED');
    for(const bad of [null,{}, {reps:{value:-1,basis:'total'},measurement:null,rir:null}]) await assert.rejects(correctHistoricalSetResult(db,p,{...historical(p,x),intent:{result:bad,reason:'Correct recorded result'}}));
    for(const expected of [undefined,{}, {resultVersion:'1',performedSetId:randomUUID()}]) await assert.rejects(correctHistoricalSetResult(db,p,{...historical(p,x),expected}));
    conflict(await correctHistoricalSetResult(db,p,{...historical(p,x),target:{executionId:randomUUID(),targetId:x.results[0].targetId}}),'NOT_FOUND');
    conflict(await correctHistoricalSetResult(db,p,{...historical(p,x),target:{executionId:x.executionId,targetId:randomUUID()}}),'SET_NOT_FOUND');
    conflict(await correctHistoricalSetResult(db,p,{...historical(p,x),expected:{...historical(p,x).expected,performedSetId:randomUUID()}}));
    const other=await account(); await assert.rejects(correctHistoricalSetResult(db,other,historical(p,x)));
    conflict(await correctHistoricalSetResult(db,other,{...historical(p,x),...envelope(other)}),'NOT_FOUND');
    const h=await persisted(p); await preserve(p,before,'rejected corrections'); assert.equal(h.length,old.length+values.length);
    pass('Never-recorded/cleared/removal denied, malformed binding and payload, wrong account/execution/set/performed identity');
  }
  for(const mode of ['same-version','equal-value','different-sets','same-command'] as const) {
    const p=await account(), x=await completed(p), before=await snapshot(p), c=historical(p,x,0,actual(7));
    const d=mode==='same-command'?c:historical(p,x,mode==='different-sets'?1:0,mode==='equal-value'?actual(7):actual(10));
    const [a,b]=await race(p,()=>correctHistoricalSetResult(db,p,c),()=>correctHistoricalSetResult(db,p,d));ok(a);
    if(mode==='same-version'||mode==='equal-value') conflict(b); else ok(b);
    if(mode==='same-command') assert(b.replayed);
    const after=await read(p,x); assert.equal(after.history!.length,x.history!.length+(mode==='different-sets'?2:1));
    const replay=await correctHistoricalSetResult(db,p,c); assert(replay.replayed); assert.deepEqual(replay.outcome,a.outcome);
    await assert.rejects(correctHistoricalSetResult(db,p,{...c,intent:{...c.intent,result:actual(99)}}),ActionCollision);
    await preserve(p,before,mode);pass(`Controlled PostgreSQL ${mode}, historical replay and payload collision`);
  }
  for(const first of ['correction','finish'] as const) {
    const p=await account();let x=await create(p,true);accept(await saveSetResult(db,p,record(p,x)));x=await read(p,x);
    const c=historical(p,x), f=finish(p,x);
    if(first==='correction'){const[a,b]=await race(p,()=>correctHistoricalSetResult(db,p,c),()=>finishExecution(db,p,f));conflict(a,'EXECUTION_NOT_FINISHED');ok(b);}
    else {const[a,b]=await race(p,()=>finishExecution(db,p,f),()=>correctHistoricalSetResult(db,p,c));ok(a);ok(b);}
    const done=await read(p,x);assert.equal(done.lifecycle,'Finished');assert.deepEqual(done.finish!.expected,f.expected);
    await validateExecutionRead(done,p.accountId);pass(`Controlled correction versus finish: ${first} first`);
  }
  {
    const p=await account();let x=await completed(p,false); const next=await readNextWorkout(reader,p,x.initial.planId);
    const start={...envelope(p),commandType:'StartOccurrence',target:{planId:next.planId,occurrenceId:next.occurrence!.id},expected:{planRevisionId:next.revisionId,instructionEpoch:next.instructionEpoch},intent:{}};
    const[a,b]=await race(p,()=>startOccurrence(db,p,start),()=>correctHistoricalSetResult(db,p,historical(p,x)));ok(a);ok(b);
    const later=(await readNextWorkout(reader,p,x.initial.planId)).execution!; accept(await saveSetResult(db,p,record(p,later)));
    const before=await snapshot(p), laterBefore=await read(p,later);x=await read(p,x);ok(await correctHistoricalSetResult(db,p,historical(p,x)));
    await preserve(p,before,'after next workout started');assert.deepEqual(await read(p,later),laterBefore);
    ok(await finishExecution(db,p,finish(p,laterBefore)));const finishedLater=await read(p,later), beforeAgain=await snapshot(p);
    ok(await correctHistoricalSetResult(db,p,historical(p,await read(p,x))));await preserve(p,beforeAgain,'after next workout finished');assert.deepEqual(await read(p,later),finishedLater);
    pass('Correction concurrent with next start and after later execution starts/finishes preserves later snapshots/results');
  }
  {
    const p=await account(),x=await completed(p),c=historical(p,x),before=await snapshot(p),history=await persisted(p);
    await admin.query(`CREATE FUNCTION trainer2_test_correction_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."outcome"->>'commandType'='CorrectHistoricalSetResult' AND NEW."status"='Accepted' THEN RAISE EXCEPTION 'synthetic rollback'; END IF; RETURN NEW; END $$; CREATE TRIGGER trainer2_test_correction_failure BEFORE INSERT ON "Trainer2ActionOutcome" FOR EACH ROW EXECUTE FUNCTION trainer2_test_correction_failure()`);
    await assert.rejects(correctHistoricalSetResult(db,p,c));assert.deepEqual(await persisted(p),history);assert.equal(await owner.trainer2DurableAction.count({where:{actionId:c.actionId}}),0);
    await admin.query('DROP TRIGGER trainer2_test_correction_failure ON "Trainer2ActionOutcome"; DROP FUNCTION trainer2_test_correction_failure()');
    ok(await correctHistoricalSetResult(db,p,c));await preserve(p,before,'rollback then exact retry');
    for(const mutation of [record(p,x,4),correction(p,record(p,x),x.results[0].performedSetId,x.results[0].version),correction(p,record(p,x),x.results[0].performedSetId,x.results[0].version,null)]) conflict(await saveSetResult(db,p,mutation),'EXECUTION_NOT_OPEN');
    await assert.rejects(saveSetResult(db,p,historical(p,x))); await assert.rejects(correctHistoricalSetResult(db,p,record(p,x)));
    for(const sql of ['UPDATE "Trainer2SetResultRevision" SET reason=\'changed\'','DELETE FROM "Trainer2SetResultRevision"','TRUNCATE "Trainer2SetResultRevision"','ALTER TABLE "Trainer2SetResultRevision" ADD COLUMN evil text']) await assert.rejects(db.$executeRawUnsafe(sql));
    for(const mode of ['missing-outcome','stale','cleared','null','wrong-command'] as const) await assert.rejects(db.$transaction(async tx=>{
      const current=await readExecution(tx,p,x.executionId); const command=historical(p,current!); if(mode==='stale')command.expected.resultVersion--;
      if(mode==='cleared') {const r=current!.results.find(r=>r.result===null)!;command.target.targetId=r.targetId;command.expected={resultVersion:r.version,performedSetId:r.performedSetId};}
      const bound=mode==='wrong-command'?{...command,commandType:'CorrectSetResult'}:command;
      await tx.trainer2DurableAction.create({data:{accountId:p.accountId,actionId:command.actionId,...commandBinding(bound)}});
      await tx.trainer2SetResultRevision.create({data:{...command.target,accountId:p.accountId,actionId:command.actionId,performedSetId:command.expected.performedSetId,version:command.expected.resultVersion+1,result:mode==='null'?Prisma.JsonNull:command.intent.result,reason:command.intent.reason}});
    }));
    await assert.rejects(reader.trainer2SetResultRevision.create({data:{...c.target,accountId:p.accountId,actionId:randomUUID(),performedSetId:c.expected.performedSetId,version:99,result:actual()}}));
    await preserve(p,before,'direct mutation denials preserve finish outcomes and lifecycle');
    assert.equal((await persisted(p)).length,history.length+1);
    pass('Atomic rollback, ordinary command isolation, reader/runtime permissions and direct guard/outcome negative controls');
  }
  const journey=await completed(browserPrincipal),beforeJourney=await snapshot(browserPrincipal),finishEvidence=journey.finish;
  const base=await startWeb(),path=`/trainer2/dev/executions/${journey.executionId}`;
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try {
    const context=await browser.newContext({viewport:{width:1280,height:900}});const page=await context.newPage(),other=await context.newPage();
    const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));other.on('pageerror',e=>errors.push(e.message));
    // Disable only development HMR transport so synthetic full reloads cannot erase an active two-tab probe.
    await context.route('**/_next/webpack-hmr*',route=>route.abort());
    await page.goto(base+path);await expect(page.getByRole('heading',{name:'Workout finished',exact:true})).toBeVisible();
    assert.equal(await page.locator('[data-nextjs-dialog]').count(),0);assert((await page.locator('body').innerText()).length>100);
    const row=(p:typeof page)=>p.getByLabel('Set 1 actual result',{exact:true}).first();
    assert.equal(await page.getByRole('button',{name:'Correct result',exact:true}).count(),3);
    await row(page).getByRole('button',{name:'Correct result',exact:true}).click();await row(page).getByLabel('Set 1 Actual reps',{exact:true}).fill('12');
    await row(page).getByRole('button',{name:'Cancel',exact:true}).click();assert.deepEqual(await read(browserPrincipal,journey),journey);
    await row(page).getByRole('button',{name:'Correct result',exact:true}).click();await row(page).getByLabel('Set 1 Actual reps',{exact:true}).fill('12');
    await page.reload();await expect(row(page).getByLabel('Set 1 Actual reps',{exact:true})).toHaveValue('12');
    await row(page).getByRole('button',{name:'Save correction',exact:true}).click();await expect(row(page).getByText('Saved',{exact:true})).toBeVisible();
    await page.reload();await expect(row(page).getByText(/Saved v2: 12 reps/)).toBeVisible();
    await row(page).getByText('Result history',{exact:true}).click();await expect(row(page).getByText(/Original record/)).toBeVisible();await expect(row(page).getByText(/Acknowledged at finish/)).toBeVisible();
    await other.goto(base+path);await row(other).getByRole('button',{name:'Correct result',exact:true}).click();await row(other).getByLabel('Set 1 Actual reps',{exact:true}).fill('14');
    // Equal-value correction still advances the version another editor saw.
    await row(page).getByRole('button',{name:'Correct result',exact:true}).click();await row(page).getByRole('button',{name:'Save correction',exact:true}).click();await expect(row(page).getByText('Saved',{exact:true})).toBeVisible();
    await other.getByRole('button',{name:'Refresh saved results',exact:true}).click();await expect(row(other).getByText(/Saved v3/)).toBeVisible();
    await row(other).getByRole('button',{name:'Save correction',exact:true}).click();await expect(row(other).getByText(/Result changed elsewhere/)).toBeVisible();
    await expect(row(other).getByLabel('Set 1 Actual reps',{exact:true})).toHaveValue('14');
    await row(other).getByRole('button',{name:'Review latest result',exact:true}).click();await row(other).getByRole('button',{name:'Use this version for my correction',exact:true}).click();
    await row(other).getByRole('button',{name:'Save correction',exact:true}).click();await expect(row(other).getByText('Saved',{exact:true})).toBeVisible();
    await page.reload();let body='';let intercepted=false;
    await page.route('**/api/trainer2/executions/corrections',async route=>{body=route.request().postData()!;const response=await route.fetch();assert.equal(response.status(),200);intercepted=true;await route.abort();});
    await row(page).getByRole('button',{name:'Correct result',exact:true}).click();await row(page).getByLabel('Set 1 Actual reps',{exact:true}).fill('15');
    await row(page).getByRole('button',{name:'Save correction',exact:true}).click();await expect(row(page).getByRole('button',{name:'Check again',exact:true})).toBeEnabled();assert(intercepted);
    await page.unroute('**/api/trainer2/executions/corrections');
    let latest=await read(browserPrincipal,journey);ok(await correctHistoricalSetResult(db,browserPrincipal,historical(browserPrincipal,latest,latest.results.filter(r=>r.result!==null).findIndex(r=>r.targetId===JSON.parse(body).target.targetId),actual(16))));
    await page.reload();const pending=JSON.parse(body);let retry='';page.on('request',r=>{if(r.url().endsWith('/corrections'))retry=r.postData()!;});
    await row(page).getByRole('button',{name:'Check again',exact:true}).click();await expect(row(page).getByText('Saved',{exact:true})).toBeVisible();assert.equal(retry,body);
    await expect(row(page).getByText(/16 reps/).first()).toBeVisible();assert.equal(await owner.trainer2SetResultRevision.count({where:{actionId:pending.actionId}}),1);
    await page.screenshot({path:resolve('artifacts/trainer2/historical-corrections-desktop.png'),fullPage:true});
    await page.setViewportSize({width:390,height:844});await row(page).getByRole('button',{name:'Correct result',exact:true}).click();
    await page.screenshot({path:resolve('artifacts/trainer2/historical-corrections-mobile.png'),fullPage:true});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await row(page).getByRole('button',{name:'Cancel',exact:true}).click();
    latest=await read(browserPrincipal,journey);await preserve(browserPrincipal,beforeJourney,'browser cancel/correction/stale/lost-response');assert.deepEqual(latest.finish,finishEvidence);
    await other.close();const restarted=await restartWeb();await page.goto(restarted+path);await expect(page.getByRole('heading',{name:'Workout finished',exact:true})).toBeVisible();
    await expect(row(page).getByText(/16 reps/).first()).toBeVisible();assert.deepEqual(await read(browserPrincipal,journey),latest);assert.deepEqual(errors,[]);
    pass('Edge completed readback, cancel, unsaved reload, correction, equal-value stale review, collapsed history, lost response, newer-value replay, desktop/mobile emulation and process restart');
  } finally {await browser.close();}
  return {results,preservation,upgrade};
}
