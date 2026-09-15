import { validateExecutionRead } from '../../src/lib/trainer2-contracts/execution';
import { verifyDiscardUpgrade } from './verify-discard-upgrade';
import { discardEmptyExecution } from '../../src/lib/api/trainer2/discard-execution';
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

export async function verifyDiscardExecution(db: PrismaClient, reader: PrismaClient, owner: PrismaClient, admin: Pool,
  browserPrincipal: ServerPrincipal, startWeb: () => Promise<string>, restartWeb: () => Promise<string>, ownerUrl: string, runtimeUrl: string,
  command: (exe: string, args: string[], env?: NodeJS.ProcessEnv) => string) {
  const results: string[] = [], preservation: unknown[] = [];
  const pass = (s: string) => { results.push(s); console.log(`PASS ${s}`); writeFileSync(resolve('artifacts/trainer2/discard-progress.json'), JSON.stringify({ results, preservation }, null, 2)); };
  const envelope = (p: ServerPrincipal) => ({ schemaVersion: 1 as const, actionId: randomUUID(), originatingAccountId: p.accountId, deviceId: randomUUID(), ownershipEpoch: 0, dependsOn: [] });
  const account = async () => { const p = { accountId: randomUUID(), issuer: 'result-test', subject: randomUUID() }; await owner.user.create({ data: { id: p.accountId, email: `${p.subject}@trainer2.invalid` } }); await owner.trainer2AccountPrincipal.create({ data: { id: randomUUID(), ...p } }); return p; };
  const starts = new Map<string, unknown>();
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
    const startCommand = { ...envelope(p), commandType: 'StartOccurrence', target: { planId, occurrenceId: h.intent.occurrences[0].id }, expected: { planRevisionId: h.revisionId, instructionEpoch: 0 }, intent: {} };
    const start = await startOccurrence(write, p, startCommand);
    assert.equal(start.outcome.status, 'Accepted'); if (start.outcome.status !== 'Accepted') throw new Error('Start failed');
    starts.set(start.outcome.result.executionId, startCommand);
    return (await readExecution(readDb, p, start.outcome.result.executionId))!;
  };
  const actual = (value = 7): PerformedResult => ({ reps: { value, basis: 'total' }, measurement: null, rir: null });
  const record = (p: ServerPrincipal, x: ExecutionRead, index = 0, result = actual()): SetResultCommand => ({ ...envelope(p), commandType: 'RecordSetResult',
    target: { executionId: x.executionId, targetId: x.initial.positions.flatMap(p => p.targets)[index].id }, expected: { resultVersion: 0 }, intent: { result } });
  const correction = (p: ServerPrincipal, c: SetResultCommand, performedSetId: string, version: number, result: PerformedResult | null = actual(8)): SetResultCommand => ({
    ...envelope(p), commandType: 'CorrectSetResult', target: c.target, expected: { resultVersion: version, performedSetId }, intent: { result, reason: result ? 'Correct typing mistake' : 'Accidentally recorded' } });
  const accept = (r: Awaited<ReturnType<typeof saveSetResult>>) => { assert.equal(r.outcome.status, 'Accepted'); if (r.outcome.status !== 'Accepted') throw new Error('Expected accepted'); return r.outcome.result; };
  const persisted = async (p: ServerPrincipal) => (await admin.query('SELECT * FROM "Trainer2SetResultRevision" WHERE "accountId"=$1 ORDER BY "targetId","version"', [p.accountId])).rows;
  async function race<T, U>(p: ServerPrincipal, first: () => Promise<T>, second: () => Promise<U>) {
    const lock = await admin.connect(); await lock.query('BEGIN');
    const pid = (await lock.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    await lock.query('SELECT "accountId" FROM "Trainer2AccountTrainingState" WHERE "accountId"=$1 FOR UPDATE', [p.accountId]);
    const waiting = async (count: number) => { const deadline = Date.now() + 8000; for (;;) {
      const r = await admin.query('WITH RECURSIVE waiting(pid) AS (SELECT pid FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid)) UNION SELECT a.pid FROM pg_stat_activity a JOIN waiting w ON w.pid=ANY(pg_blocking_pids(a.pid))) SELECT DISTINCT pid, pg_blocking_pids(pid) blockers FROM waiting', [pid]);
      if (r.rowCount! >= count) { preservation.push({ label: 'observed account lock queue', holder: pid, count, waiters: r.rows }); return; } if (Date.now() > deadline) throw new Error('Expected observed result lock queue'); await new Promise(r => setTimeout(r, 20));
    } };
    let a: Promise<T> | undefined, b: Promise<U> | undefined;
    try { a = first(); await waiting(1); b = second(); await waiting(2); await lock.query('COMMIT'); return await Promise.all([a, b]); }
    finally { await lock.query('ROLLBACK'); lock.release(); await Promise.allSettled([a, b].filter(Boolean)); }
  }
  const read = async (p: ServerPrincipal, x: ExecutionRead) => (await readExecution(reader, p, x.executionId))!;
  const finish = (p: ServerPrincipal, x: ExecutionRead, acknowledgeUnrecorded = true): FinishExecutionCommand => ({ ...envelope(p), commandType: 'FinishExecution', target: { executionId: x.executionId }, expected: reviewedResults(x), intent: { acknowledgeUnrecorded } });
  const ok = (r: { outcome: { status: string } }) => assert.equal(r.outcome.status, 'Accepted');
  const snapshot = async (p: ServerPrincipal) => {
    const tables = ['Trainer2Plan','Trainer2PlanRevision','Trainer2Execution','Trainer2ExecutionFinish','Trainer2PlanDecision'];
    const rows = Object.fromEntries(await Promise.all(tables.map(async table => [table, (await admin.query(`SELECT to_jsonb(t) row FROM "${table}" t WHERE "accountId"=$1 ORDER BY to_jsonb(t)::text`, [p.accountId])).rows])));
    rows.finishOutcomes = (await admin.query(`SELECT to_jsonb(t) row FROM "Trainer2ActionOutcome" t WHERE "accountId"=$1 AND outcome->>'commandType'='FinishExecution' ORDER BY "outcomeCursor"`,[p.accountId])).rows;
    return rows;
  };
  const discard = (p: ServerPrincipal, x: ExecutionRead) => ({ ...envelope(p), commandType: 'DiscardEmptyExecution' as const,
    target: { executionId: x.executionId, occurrenceId: x.initial.occurrence.id }, expected: reviewedResults(x), intent: {} });
  const startAgain = async (p: ServerPrincipal, x: ExecutionRead) => {
    const next = await readNextWorkout(reader,p,x.initial.planId); assert.equal(next.occurrence?.id,x.initial.occurrence.id);
    const c={...envelope(p),commandType:'StartOccurrence',target:{planId:x.initial.planId,occurrenceId:x.initial.occurrence.id},expected:{planRevisionId:x.initial.revisionId,instructionEpoch:next.instructionEpoch},intent:{}};
    const out=await startOccurrence(db,p,c); assert.equal(out.outcome.status,'Accepted'); if(out.outcome.status!=='Accepted') throw Error('start');
    starts.set(out.outcome.result.executionId,c); return (await readExecution(reader,p,out.outcome.result.executionId))!;
  };
  // The accepted schema has no discard table. This test adapter supplies only that absent read;
  // every base-compatible command and all database guards still run normally.
  const baseCompatible = (client: PrismaClient): PrismaClient => new Proxy(client, { get(target,key) {
    if(key==='trainer2ExecutionDiscard') return { findUnique: async()=>null };
    if(key==='$transaction') return (fn: (tx: PrismaClient)=>Promise<unknown>, options: unknown) => target.$transaction(tx=>fn(baseCompatible(tx as PrismaClient)), options as never);
    const value=Reflect.get(target,key); return typeof value==='function'?value.bind(target):value;
  } });
  const upgrade=await verifyDiscardUpgrade(admin,ownerUrl,runtimeUrl,command,async(up,upOwner)=>{
    const p={accountId:randomUUID(),issuer:'upgrade',subject:randomUUID()}; await upOwner.user.create({data:{id:p.accountId,email:`${p.subject}@trainer2.invalid`}});await upOwner.trainer2AccountPrincipal.create({data:{id:randomUUID(),...p}});
    const base=baseCompatible(up); let x=await create(p,true,false,base,base); accept(await saveSetResult(base,p,record(p,x)));x=(await readExecution(base,p,x.executionId))!;ok(await finishExecution(base,p,finish(p,x)));
    const empty=await create(p,true,false,base,base);
    return async()=>{ok(await discardEmptyExecution(up,p,discard(p,empty)));assert.equal((await readExecution(up,p,x.executionId))!.lifecycle,'Finished');};
  });pass('Fresh install/redeploy and populated accepted-base upgrade preserve all prior rows');
  {
    const p=await account();const prior=await create(p,true);accept(await saveSetResult(db,p,record(p,prior)));ok(await finishExecution(db,p,finish(p,await read(p,prior))));const priorFinished=await read(p,prior);let x=await create(p);const original=x, originalStart=starts.get(x.executionId)!;
    const stable=await snapshot(p);const c=discard(p,x);const out=await discardEmptyExecution(db,p,c);ok(out);
    const discarded=await read(p,x);assert.equal(discarded.lifecycle,'Discarded');assert.deepEqual(discarded.initial,original.initial);assert.equal(discarded.discard?.actorAccountId,p.accountId);await validateExecutionRead(discarded,p.accountId);
    const after=await snapshot(p);for(const table of ['Trainer2Plan','Trainer2PlanRevision','Trainer2PlanDecision','Trainer2ExecutionFinish','finishOutcomes'])assert.deepEqual(after[table],stable[table]);
    preservation.push({label:'discard preserves planning/completion and original snapshot',before:stable,after,original,discarded});
    const next=await readNextWorkout(reader,p,x.initial.planId);assert.equal(next.execution,null);assert.equal(next.occurrence?.id,x.initial.occurrence.id);
    const replay=await startOccurrence(db,p,originalStart);ok(replay);assert.equal(replay.replayed,true);assert.equal((await read(p,x)).lifecycle,'Discarded');
    for(let i=0;i<3;i++){const previous=x;x=await startAgain(p,x);assert.notEqual(x.executionId,previous.executionId);assert.notEqual(x.initial.positions[0].id,previous.initial.positions[0].id);if(i<2)ok(await discardEmptyExecution(db,p,discard(p,x)));}
    const before=await snapshot(p);assert.deepEqual((await discardEmptyExecution(db,p,c)).outcome,out.outcome);assert.equal((await startOccurrence(db,p,originalStart)).replayed,true);assert.deepEqual(await snapshot(p),before);
    assert.equal((await readNextWorkout(reader,p,x.initial.planId)).execution?.executionId,x.executionId);
    await assert.rejects(discardEmptyExecution(db,p,{...c,intent:{changed:true}}));await assert.rejects(discardEmptyExecution(db,p,{...c,expected:{...c.expected,contentHash:'b'.repeat(64)}}),ActionCollision);
    assert.equal((await saveSetResult(db,p,record(p,original))).outcome.status,'Conflict');assert.equal((await finishExecution(db,p,finish(p,original))).outcome.status,'Conflict');
    const historicalCommand={...envelope(p),commandType:'CorrectHistoricalSetResult',target:{executionId:original.executionId,targetId:original.initial.positions[0].targets[0].id},expected:{performedSetId:randomUUID(),resultVersion:1},intent:{result:actual(),reason:'Correct recorded result'}};
    assert.equal((await correctHistoricalSetResult(db,p,historicalCommand)).outcome.status,'Conflict');
    assert.deepEqual(await read(p,prior),priorFinished);
    pass('Empty discard, immutable attempt, stable next, repeated fresh identities, original start and old discard replays, stale mutations');
  }
  for(const mode of ['required','optional','zero','clear','finished'] as const){
    const p=await account();let x=await create(p,true);if(mode==='finished')ok(await finishExecution(db,p,finish(p,x)));
    else {const c=record(p,x,mode==='optional'?1:0,actual(mode==='zero'?0:7));const r=accept(await saveSetResult(db,p,c));if(mode==='clear')accept(await saveSetResult(db,p,correction(p,c,r.performedSetId,1,null)));}
    x=await read(p,x);const before=await snapshot(p),history=await persisted(p);assert.equal((await discardEmptyExecution(db,p,discard(p,x))).outcome.status,'Conflict');assert.deepEqual(await snapshot(p),before);assert.deepEqual(await persisted(p),history);
  }pass('Required/optional/zero/record-then-clear/Finished reject without erasing history');
  {
    const p=await account(),other=await account(),x=await create(p,true),c=discard(p,x);const before=await snapshot(p);
    await assert.rejects(discardEmptyExecution(db,other,c));
    assert.equal((await discardEmptyExecution(db,other,{...c,...envelope(other)})).outcome.status,'Rejected');
    for(const target of [{...c.target,executionId:randomUUID()},{...c.target,occurrenceId:randomUUID()}]) assert.notEqual((await discardEmptyExecution(db,p,{...c,...envelope(p),target})).outcome.status,'Accepted');
    for(const expected of [undefined,{}, {...c.expected,contentHash:'bad'}])await assert.rejects(discardEmptyExecution(db,p,{...c,...envelope(p),expected}));
    for(const expected of [{...c.expected,contentHash:'b'.repeat(64)},{...c.expected,results:[]},{...c.expected,results:c.expected.results.map(r=>({...r,resultVersion:1,performedSetId:randomUUID()}))}])assert.equal((await discardEmptyExecution(db,p,{...c,...envelope(p),expected})).outcome.status,'Conflict');
    assert.deepEqual(await snapshot(p),before);ok(await discardEmptyExecution(db,p,c));
  }pass('Account/occurrence/execution isolation and strict missing/malformed/stale binding; failed commands do not prevent discard');
  for(const mode of ['record','finish','start','discard'] as const)for(const discardFirst of [true,false]){
    const p=await account(),x=await create(p,true),c=discard(p,x);
    const first:()=>Promise<{outcome:{status:string};replayed:boolean}>=()=>discardEmptyExecution(db,p,c);
    const competing:()=>Promise<{outcome:{status:string};replayed:boolean}>=()=>mode==='record'?saveSetResult(db,p,record(p,x)):mode==='finish'?finishExecution(db,p,finish(p,x)):mode==='discard'?discardEmptyExecution(db,p,discard(p,x)):startOccurrence(db,p,{...(starts.get(x.executionId) as object),...envelope(p)});
    const [a,b]=await race(p,discardFirst?first:competing,discardFirst?competing:first);
    const current=await read(p,x);
    if(mode==='start'){ok(discardFirst?a:b);assert.equal(current.lifecycle,'Discarded');if(discardFirst)ok(b);else assert.equal(a.outcome.status,'Conflict');}
    else {ok(a);assert.equal(b.outcome.status,'Conflict');assert.equal(current.lifecycle,discardFirst?'Discarded':mode==='record'?'Open':mode==='finish'?'Finished':'Discarded');}
    preservation.push({label:`${mode}, discardFirst=${discardFirst}`,outcomes:[a,b],current});
  }pass('Observed PostgreSQL blocking queues: discard versus record/finish/start/discard in both orders');
  {
    const p=await account(),x=await create(p,true),c=discard(p,x);const [a,b]=await race(p,()=>discardEmptyExecution(db,p,c),()=>discardEmptyExecution(db,p,c));ok(a);ok(b);assert.equal(b.replayed,true);assert.deepEqual(a.outcome,b.outcome);
  }pass('Concurrent exact discard identity commits once and replays');
  for(const table of ['Trainer2Execution','Trainer2AccountTrainingState','Trainer2ActionOutcome']){
    const p=await account(),x=await create(p,true),c=discard(p,x),before=await snapshot(p),actions=await owner.trainer2DurableAction.count({where:{accountId:p.accountId}});
    await admin.query(`CREATE FUNCTION discard_test_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."accountId"='${p.accountId}' THEN RAISE EXCEPTION 'test rollback'; END IF; RETURN NEW; END $$; CREATE TRIGGER discard_test_fault BEFORE ${table==='Trainer2ActionOutcome'?'INSERT':'UPDATE'} ON "${table}" FOR EACH ROW EXECUTE FUNCTION discard_test_fault()`);
    try{await assert.rejects(discardEmptyExecution(db,p,c));}finally{await admin.query(`DROP TRIGGER discard_test_fault ON "${table}"; DROP FUNCTION discard_test_fault()`);}
    assert.deepEqual(await snapshot(p),before);assert.equal(await owner.trainer2ExecutionDiscard.count({where:{executionId:x.executionId}}),0);assert.equal(await owner.trainer2DurableAction.count({where:{accountId:p.accountId}}),actions);ok(await discardEmptyExecution(db,p,c));
  }pass('Injected lifecycle/sequence/outcome failures roll back discard fact, action and all domain effects');
  {
    const p=await account(),x=await create(p,true);ok(await discardEmptyExecution(db,p,discard(p,x)));
    for(const sql of ['DELETE FROM "Trainer2ExecutionDiscard"','UPDATE "Trainer2ExecutionDiscard" SET "discardedAt"=now()','TRUNCATE "Trainer2ExecutionDiscard"'])await assert.rejects(db.$executeRawUnsafe(sql));
    const fact=await owner.trainer2ExecutionDiscard.findUniqueOrThrow({where:{executionId:x.executionId}});await assert.rejects(reader.trainer2ExecutionDiscard.create({data:{...fact,expected:fact.expected as Prisma.InputJsonValue}}));
    await assert.rejects(db.trainer2Execution.update({where:{id:x.executionId},data:{lifecycle:'Open'}}));
    assert.equal((await admin.query(`SELECT count(*) FROM information_schema.role_table_grants WHERE grantee='PUBLIC' AND table_name='Trainer2ExecutionDiscard'`)).rows[0].count,'0');
  }pass('Restricted runtime/reader privileges and immutable discarded lifecycle');
  for(const mode of ['missing-outcome','wrong-binding','late-result','late-finish','fake-outcome'] as const){
    const p=await account(),x=await create(p,true),c=discard(p,x);const before=await snapshot(p),actions=await owner.trainer2DurableAction.count({where:{accountId:p.accountId}});
    await assert.rejects(db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT "accountId" FROM "Trainer2AccountTrainingState" WHERE "accountId"=${p.accountId} FOR UPDATE`;
      await tx.trainer2DurableAction.create({data:{accountId:p.accountId,actionId:c.actionId,...commandBinding(c)}});
      if(mode!=='fake-outcome')await tx.trainer2ExecutionDiscard.create({data:{executionId:x.executionId,accountId:p.accountId,occurrenceId:x.initial.occurrence.id,actionId:c.actionId,expected:mode==='wrong-binding'?{contentHash:x.contentHash,results:[]}:c.expected}});
      if(mode==='late-result'){
        const r=record(p,x);await tx.trainer2DurableAction.create({data:{accountId:p.accountId,actionId:r.actionId,...commandBinding(r)}});
        await tx.trainer2SetResultRevision.create({data:{...r.target,accountId:p.accountId,actionId:r.actionId,performedSetId:randomUUID(),version:1,result:actual()}});
      }
      if(mode==='late-finish'){
        const f=finish(p,x);await tx.trainer2DurableAction.create({data:{accountId:p.accountId,actionId:f.actionId,...commandBinding(f)}});
        await tx.trainer2ExecutionFinish.create({data:{executionId:x.executionId,accountId:p.accountId,planId:x.initial.planId,revisionId:x.initial.revisionId,occurrenceId:x.initial.occurrence.id,actionId:f.actionId,expected:f.expected,unknownTargetIds:x.initial.positions.flatMap(p=>p.targets.map(t=>t.id)).sort(),planCompleted:true,priorPlanLifecycle:'Active',endpoint:{kind:'endOfOrderedOccurrences',occurrenceIds:[x.initial.occurrence.id]},finishedAt:new Date()}});
      }
      if(mode==='fake-outcome'){
        const state=await tx.trainer2AccountTrainingState.update({where:{accountId:p.accountId},data:{acceptedSequence:{increment:1}}});
        await tx.trainer2ActionOutcome.create({data:{accountId:p.accountId,actionId:c.actionId,status:'Accepted',outcome:{status:'Accepted',actionId:c.actionId,commandType:c.commandType,acceptedSequence:state.acceptedSequence.toString(),result:{executionId:x.executionId,planId:x.initial.planId,occurrenceId:x.initial.occurrence.id}}}});
      }
    }));
    assert.deepEqual(await snapshot(p),before);assert.equal(await owner.trainer2ExecutionDiscard.count({where:{executionId:x.executionId}}),0);assert.equal(await owner.trainer2DurableAction.count({where:{accountId:p.accountId}}),actions);
  }pass('Direct-runtime missing outcome, false acceptance, wrong binding and same-transaction late result/finish are rejected atomically');
  let base=await startWeb();const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const context=await browser.newContext({viewport:{width:1280,height:900}}),page=await context.newPage();const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
    await context.route('**/_next/webpack-hmr*',route=>route.abort());
    await page.goto(base+'/trainer2/dev/drafts');assert.equal(await page.locator('[data-nextjs-dialog]').count(),0);
    await page.getByRole('button',{name:'Save plan',exact:true}).click();await expect(page.getByRole('status')).toHaveText('Saved');
    await page.getByRole('button',{name:'Review plan',exact:true}).click();await page.getByRole('button',{name:'Activate plan',exact:true}).click();await expect(page.getByRole('status').first()).toHaveText('Plan active');
    await page.getByRole('button',{name:'Start workout',exact:true}).click();await expect(page.getByRole('heading',{name:'Workout in progress',exact:true})).toBeVisible();
    const oldPath=new URL(page.url()).pathname, oldId=oldPath.split('/').at(-1)!;const old=(await readExecution(reader,browserPrincipal,oldId))!;
    const beforeCancel=await snapshot(browserPrincipal);await page.getByRole('button',{name:'Discard empty workout',exact:true}).click();
    await expect(page.getByRole('button',{name:'Cancel',exact:true})).toBeFocused();await page.getByRole('button',{name:'Cancel',exact:true}).click();
    await expect(page.getByRole('button',{name:'Discard empty workout',exact:true})).toBeFocused();assert.deepEqual(await snapshot(browserPrincipal),beforeCancel);
    await page.getByRole('button',{name:'Enter actual result'}).first().click();await page.getByLabel('Set 1 Actual reps',{exact:true}).first().fill('8');
    await expect(page.getByRole('button',{name:'Discard empty workout',exact:true})).toBeDisabled();await page.getByRole('button',{name:'Discard input',exact:true}).click();
    await page.getByRole('button',{name:'Discard empty workout',exact:true}).click();
    await page.screenshot({path:resolve('artifacts/trainer2/discard-desktop.png'),fullPage:true});await page.setViewportSize({width:390,height:844});
    await page.screenshot({path:resolve('artifacts/trainer2/discard-mobile.png'),fullPage:true});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    assert(await page.getByRole('button',{name:'Confirm discard',exact:true}).evaluate(el=>el.getBoundingClientRect().height>=44));
    await page.getByRole('group',{name:'Confirm discard'}).screenshot({path:resolve('artifacts/trainer2/discard-mobile-confirm.png')});
    let body='';await page.route('**/api/trainer2/executions/discard',async route=>{body=route.request().postData()!;const r=await route.fetch();assert.equal(r.status(),200);await route.abort();});
    await page.getByRole('button',{name:'Confirm discard',exact:true}).click();await expect(page.getByRole('button',{name:'Check discard again',exact:true})).toBeEnabled();
    assert.equal((await read(browserPrincipal,old)).lifecycle,'Discarded');await page.unroute('**/api/trainer2/executions/discard');await page.reload();
    let retry='';page.on('request',r=>{if(r.url().endsWith('/discard'))retry=r.postData()!;});await page.getByRole('button',{name:'Check discard again',exact:true}).click();
    await expect(page.getByText('Workout attempt discarded.',{exact:true})).toBeVisible();assert.equal(retry,body);assert.equal(await owner.trainer2ExecutionDiscard.count({where:{executionId:oldId}}),1);
    await page.reload();await expect(page.getByRole('button',{name:'Start workout',exact:true})).toBeVisible();
    const beforeReload=await snapshot(browserPrincipal);await page.reload();await expect(page.getByRole('heading',{name:'Workout attempt discarded',exact:true})).toBeVisible();assert.deepEqual(await snapshot(browserPrincipal),beforeReload);
    await page.getByRole('button',{name:'Start workout',exact:true}).click();await expect(page.getByRole('heading',{name:'Workout in progress',exact:true})).toBeVisible();
    const newId=new URL(page.url()).pathname.split('/').at(-1)!;assert.notEqual(newId,oldId);const fresh=(await readExecution(reader,browserPrincipal,newId))!;assert.equal(fresh.initial.occurrence.id,old.initial.occurrence.id);
    const bookmark=await context.newPage();await bookmark.goto(base+oldPath);await expect(bookmark.getByRole('heading',{name:'Workout attempt discarded',exact:true})).toBeVisible();
    await expect(bookmark.getByRole('link',{name:'Continue workout',exact:true})).toHaveAttribute('href',`/trainer2/dev/executions/${newId}`);
    for(const name of ['Enter actual result','Finish workout','Correct result','Discard empty workout'])await expect(bookmark.getByRole('button',{name,exact:true})).toHaveCount(0);
    await bookmark.screenshot({path:resolve('artifacts/trainer2/discard-bookmark.png'),fullPage:true});await bookmark.close();
    const stale=await context.newPage();await stale.goto(base+`/trainer2/dev/executions/${newId}`);await stale.getByRole('button',{name:'Discard empty workout',exact:true}).click();
    await page.getByRole('button',{name:'Enter actual result'}).first().click();await page.getByLabel('Set 1 Actual reps',{exact:true}).first().fill('0');
    let release!:()=>void;const gate=new Promise<void>(r=>{release=r;});let entered!:()=>void;const held=new Promise<void>(r=>{entered=r;});
    await page.route('**/api/trainer2/executions/results',async route=>{entered();await gate;await route.continue();});await page.getByRole('button',{name:'Record set',exact:true}).click();await held;
    await expect(page.getByRole('button',{name:'Discard empty workout',exact:true})).toBeDisabled();release();await expect(page.getByText(/Saved v1:/)).toBeVisible();await page.unroute('**/api/trainer2/executions/results');
    await stale.getByRole('button',{name:'Confirm discard',exact:true}).click();await expect(stale.getByText(/Discard was not accepted/)).toBeVisible();await expect(stale.getByRole('button',{name:'Discard empty workout',exact:true})).toBeDisabled();await stale.getByRole('button',{name:'Refresh saved results',exact:true}).click();await expect(stale.getByText(/Workouts with recorded set history/)).toBeVisible();await stale.close();
    await expect(page.getByRole('button',{name:'Discard empty workout',exact:true})).toBeDisabled();await expect(page.getByText(/Workouts with recorded set history/)).toBeVisible();
    await page.getByRole('button',{name:'Finish workout',exact:true}).click();await page.getByRole('button',{name:'Finish with unrecorded sets',exact:true}).click();await expect(page.getByRole('heading',{name:'Workout finished',exact:true})).toBeVisible();
    const persistedBefore=await snapshot(browserPrincipal),oldBefore=await read(browserPrincipal,old),newBefore=await read(browserPrincipal,fresh);base=await restartWeb();
    await page.goto(base+oldPath);await expect(page.getByRole('heading',{name:'Workout attempt discarded',exact:true})).toBeVisible();
    await page.goto(base+`/trainer2/dev/executions/${newId}`);await expect(page.getByRole('heading',{name:'Workout finished',exact:true})).toBeVisible();assert.deepEqual(await snapshot(browserPrincipal),persistedBefore);assert.deepEqual(await read(browserPrincipal,old),oldBefore);assert.deepEqual(await read(browserPrincipal,fresh),newBefore);assert.deepEqual(errors,[]);
    pass('Edge activate/start/cancel/discard/lost-response/reload/fresh start/pending result/zero record/finish, old bookmark, desktop/mobile emulation and same-DB restart');
  }finally{await browser.close();}
  return {results,preservation,upgrade};
}
