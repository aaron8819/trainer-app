import { executionPositions } from '../src/lib/engine/trainer2/execution-targets';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { spawnSync, spawn, type SpawnOptions } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { createServer } from 'node:net';
import { Pool } from 'pg';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { chromium } from '@playwright/test';
import { createDraft, readDraft } from '../src/lib/api/trainer2/planning';
import { activatePlan } from '../src/lib/api/trainer2/activation';
import { startOccurrence, readExecution } from '../src/lib/api/trainer2/execution';
import { previewExerciseSwap, swapExercise } from '../src/lib/api/trainer2/exercise-swap';
import { addSet } from '../src/lib/api/trainer2/add-set';
import { addExercise } from '../src/lib/api/trainer2/add-exercise';
import { correctHistoricalSetResult, saveSetResult } from '../src/lib/api/trainer2/set-results';
import { skipSet } from '../src/lib/api/trainer2/skip-set';
import { acceptCommand } from '../src/lib/api/trainer2/command';
import { readdirSync } from 'node:fs';
import { finishExecution } from '../src/lib/api/trainer2/workout-finish';
import { reviewedResults } from '../src/lib/trainer2-contracts/workout-finish';
import { validateExecutionRead, type ExecutionRead } from '../src/lib/trainer2-contracts/execution';
import { catalog, catalogExercise } from '../src/lib/engine/trainer2/catalog';
import { canonicalJson, commandBinding } from '../src/lib/api/trainer2/integrity';
import { currentAssignment, effectiveOccurrence } from '../src/lib/engine/trainer2/exercise-swap';
import { authWebPlatformEnvironment } from './trainer2/auth-web-environment';
import { verificationSource } from './trainer2/verification-source';
import { inspectFinisherSchemaDiff } from '../src/lib/operations/finisher-schema-drift';
import { parseExactDisposableConfirmationArgs } from '../src/lib/operations/test-environment-preflight';
import { cleanupSteps, ownedBrowserProcesses, ownedProcessTree, terminateOwnedProcesses, waitForWorker, type CleanupResult } from './trainer2/disposable-cleanup';


async function main() {
  assert(parseExactDisposableConfirmationArgs(process.argv.slice(2)).valid, 'Expected exactly --confirm-disposable');
  assert(process.send && process.env.TRAINER2_ADD_EXERCISE_OWNER,'Disposable worker must be supervised');
  const suffix=process.env.TRAINER2_ADD_EXERCISE_SUFFIX!;assert(/^[a-f0-9]{12}$/.test(suffix));
  const container = `trainer2-add-exercise-${suffix}`, database = `trainer2_disposable_add_exercise_${suffix}`;
  const password = randomUUID(), rolePassword = randomUUID(), accountId = randomUUID(), sessionId = randomUUID(), secret = randomBytes(32).toString('base64url');
  const artifact = resolve('artifacts/trainer2/add-exercise-evidence'); mkdirSync(artifact, { recursive: true });
  const source = verificationSource(), checks: string[] = [];
  let assertionError: string | undefined, cleanup: CleanupResult[] = [], details: Record<string, unknown> = {};
  let containerCreated=false;
  const redact = (value: string) => value.replaceAll(password,'[secret]').replaceAll(rolePassword,'[secret]');
  // Written only during actual process exit, independently of assertion completion.
  process.once('exit', exitCode => {
    writeFileSync(resolve(artifact,'report.json'),JSON.stringify({runId:process.env.TRAINER2_ADD_EXERCISE_OWNER,source,...details,checks,
      assertions:{status:assertionError?'failed':checks.length===24?'passed':'incomplete',error:assertionError},
      cleanup,worker:{status:'completed',exitCode},runner:{status:'pending-controller'}},null,2));
  });
  const command = (exe: string, args: string[], env?: NodeJS.ProcessEnv) => {
    const out = spawnSync(exe,args,{ env, encoding:'utf8', windowsHide:true, maxBuffer:10_000_000, timeout:120_000 });
    if (out.status !== 0) throw new Error(redact(`Disposable command failed: ${exe} ${args.filter(a => !a.includes('postgresql:')).join(' ')}\n${out.error?.message??out.stderr}`));
    return out.stdout;
  };
  const pass = (name: string) => { checks.push(name); console.log(`PASS ${name}`); };
  let admin: Pool | undefined, runtime: PrismaClient | undefined, reader: PrismaClient | undefined, server: ReturnType<typeof spawn> | undefined;
  let serverLog='';
  let serverCompletion: ReturnType<typeof waitForWorker> | undefined;
  const nextClosures: Awaited<ReturnType<typeof waitForWorker>>[] = [];
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let browserProcess: ReturnType<typeof spawn> | undefined;
  let browserServer: Awaited<ReturnType<typeof chromium.launchServer>> | undefined;
  let browserCompletion: ReturnType<typeof waitForWorker> | undefined;
  let browserContext: Awaited<ReturnType<NonNullable<typeof browser>['newContext']>> | undefined;
  let browserPids: number[] = [];
  let webOrigin: string | undefined, browserEndpoint: string | undefined;
  const browserProfile=resolve(artifact,`browser-profile-${suffix}`);
  assert(browserProfile.startsWith(artifact+sep),'Browser profile must stay inside task artifacts');
  let browserLog='';
  const browserLifecycle: Record<string,unknown>[] = [];
  const pendingBrowserRequests = new Map<unknown,{method:string;path:string}>();
  const ownedPids = new Set<number>();
  const processIds = new Set<number>();
  const track = (pid: number) => {ownedPids.add(pid);processIds.add(pid);};
  const capture = (pid: number,marker?:string) => { const pids=ownedProcessTree(pid,marker);pids.forEach(track);return pids; };
  const terminate = async (pids: number[]) => {await terminateOwnedProcesses(pids);pids.forEach(pid=>ownedPids.delete(pid));};
  const stopWeb = async () => {
    const child=server;
    if(child?.pid){
      await terminate(capture(child.pid));
      for(const stream of child.stdio)stream?.destroy();
      const closed=await cleanupSteps([{name:'Next child close',timeoutMs:5_000,run:async()=>{
        const result=await serverCompletion;assert(result&&!result.timedOut&&!result.error,'Next child close was not observed');nextClosures.push(result);
      }}]);
      assert(closed.every(result=>result.status==='passed'),'Next child close deadline exceeded');
      ownedPids.delete(child.pid);
    }
    server=undefined;
  };
  try {
    command('docker',['run','--pull=never','--rm','-d','--name',container,'--label',`trainer2.add-exercise.owner=${process.env.TRAINER2_ADD_EXERCISE_OWNER}`,'-e',`POSTGRES_PASSWORD=${password}`,'-e',`POSTGRES_DB=${database}`,'-p','127.0.0.1::5432','postgres:17-alpine']);
    containerCreated=true;
    for(let i=0;i<60;i++){ if(spawnSync('docker',['exec',container,'pg_isready','-U','postgres'],{ windowsHide:true,timeout:5_000 }).status===0) break; await new Promise(r=>setTimeout(r,500)); }
    const port = command('docker',['port',container,'5432/tcp']).trim().split(':').at(-1)!;
    const url = (role: string) => `postgresql://${role}:${role==='postgres'?password:rolePassword}@127.0.0.1:${port}/${database}`;
    command(process.execPath,[resolve('node_modules/prisma/build/index.js'),'migrate','deploy'],{ ...authWebPlatformEnvironment(process.env), NODE_ENV:'test', DATABASE_URL:url('postgres'), DIRECT_URL:url('postgres') });
    const schemaDiff=(connection:string,schema:string)=>inspectFinisherSchemaDiff(command(process.execPath,[resolve('node_modules/prisma/build/index.js'),'migrate','diff','--from-config-datasource','--to-schema',schema,'--script'],{...authWebPlatformEnvironment(process.env),NODE_ENV:'test',DATABASE_URL:connection,DIRECT_URL:connection}));
    const candidateDrift=schemaDiff(url('postgres'),'prisma/schema.prisma');
    pass('Fresh forward migration chain');
    admin=new Pool({ connectionString:url('postgres') });
    await admin.query(`BEGIN; ${readFileSync('prisma/trainer2-runtime-grants.sql','utf8')} COMMIT;`);
    for(const role of ['trainer2_draft_runtime','trainer2_draft_reader','trainer2_identity_runtime']) await admin.query(`ALTER ROLE ${role} LOGIN PASSWORD '${rolePassword}'`);
    await admin.query('INSERT INTO "User" ("id","email") VALUES ($1,$2)',[accountId,`${suffix}@trainer2.invalid`]);
    await admin.query('INSERT INTO "Trainer2Owner" ("id","accountId","passcodeVerifier") VALUES (1,$1,$2)',[accountId,'synthetic-disabled']);
    await admin.query('INSERT INTO "Trainer2DeviceSession" ("id","ownerId","tokenHash","createdAt","renewedAt","expiresAt","absoluteExpiresAt","epoch") VALUES ($1,1,$2,now(),now(),now()+interval \'1 day\',now()+interval \'2 days\',0)',[sessionId,createHash('sha256').update(secret).digest('hex')]);
    process.env.TRAINER2_OWNER_USER_ID=accountId;
    runtime=new PrismaClient({ adapter:new PrismaPg({ connectionString:url('trainer2_draft_runtime') }) });
    reader=new PrismaClient({ adapter:new PrismaPg({ connectionString:url('trainer2_draft_reader') }) });
    const db=runtime, readDb=reader, principal={ accountId,sessionId };
    const envelope=()=>({ schemaVersion:1,actionId:randomUUID(),deviceId:randomUUID(),originatingAccountId:accountId,ownershipEpoch:0,dependsOn:[] });
    const stageId=randomUUID(), planId=randomUUID();
    const targets=()=>Array.from({length:2},()=>({ id:randomUUID(),classification:'working' as const,required:true,reps:{min:6,max:10,basis:'total' as const},measurement:{kind:'externalLoad' as const,value:'60.00',unit:'kg' as const,convention:'barbellTotal' as const,zeroMeaning:'validZero' as const},rir:'2',restSeconds:'180' }));
    const intent={ schemaVersion:1 as const,name:'Synthetic swap trial',endpoint:'endOfOrderedOccurrences' as const,progression:{version:1 as const,mode:'plannedPrescriptions' as const,scope:'wholePlan' as const,parameters:{}},stages:[{id:stageId,name:'Trial'}],
      occurrences:Array.from({length:24},(_,i)=>({id:randomUUID(),stageId,name:`Trial ${i+1}`,positions:Array.from({length:3},()=>({id:randomUUID(),role:'Main lift' as const,exercise:catalogExercise(catalog.find(e=>e.id==='t2:barbell-back-squat')!),targets:targets()}))})) };
    for (const [index,catalogId,measurement] of [
      [0,'t2:barbell-back-squat',{kind:'externalLoad',value:'0.00',unit:'kg',convention:'barbellTotal',zeroMeaning:'validZero'}],
      [1,'t2:push-up',{kind:'bodyweight',convention:'bodyweightOnly'}],
      [2,'t2:machine-assisted-pull-up',{kind:'assistance',value:'0.00',unit:'lb',convention:'displayedAssistance',zeroMeaning:'noAssistance'}],
    ] as const) {
      const entry=catalog.find(e=>e.id===catalogId);assert(entry,`Missing fixture catalog ${catalogId}`);
      const p=intent.occurrences[1].positions[index];p.exercise=catalogExercise(entry);
      for(const t of p.targets){Object.assign(t,{measurement,reps:{min:6,max:10,basis:entry.repBasis}});}
    }
    assert.equal((await createDraft(db,principal,{...envelope(),commandType:'CreateDraft',target:{planId},expected:{},intent})).outcome.status,'Accepted');
    const plan=(await readDraft(readDb,principal,planId))!;
    assert.equal((await activatePlan(db,principal,{...envelope(),commandType:'ActivatePlan',target:{planId},expected:{planRevisionId:plan.revisionId},intent:{reviewed:plan.activation}})).outcome.status,'Accepted');
    const originalPlan=canonicalJson((await readDraft(readDb,principal,planId))!.intent);
    let next=0;
    const read=async(id:string)=>validateExecutionRead(await readExecution(readDb,principal,id),accountId,id);
    const start=async()=>{const r=await startOccurrence(db,principal,{...envelope(),commandType:'StartOccurrence',target:{planId,occurrenceId:intent.occurrences[next++].id},expected:{planRevisionId:plan.revisionId,instructionEpoch:0},intent:{}});assert.equal(r.outcome.status,'Accepted');assert(r.outcome.status==='Accepted');return read(r.outcome.result.executionId);};
    const finish=(x:ExecutionRead)=>({...envelope(),commandType:'FinishExecution',target:{executionId:x.executionId},expected:reviewedResults(x),intent:{acknowledgeUnrecorded:true}});
    const close=async(x:ExecutionRead)=>assert.equal((await finishExecution(db,principal,finish(await read(x.executionId)))).outcome.status,'Accepted');
    const swap=async(x:ExecutionRead,position=0,restoreOriginal=false)=>{
      const intent=restoreOriginal?{restoreOriginal:true as const}:{restoreOriginal:false as const,catalogId:'t2:leg-press'};
      const p=await readDb.$transaction(async tx=>{await tx.$executeRaw`SET TRANSACTION READ ONLY`;return previewExerciseSwap(tx,principal,{executionId:x.executionId,positionId:x.initial.positions[position].id,intent});});
      return {...envelope(),commandType:'SwapExercise' as const,target:{executionId:x.executionId,positionId:x.initial.positions[position].id},expected:{contentHash:p.contentHash,assignment:p.assignment,instructionEpoch:p.instructionEpoch,effectiveHash:p.effectiveHash},intent};
    };
    const log=(x:ExecutionRead,position=0)=>({...envelope(),commandType:'RecordSetResult',target:{executionId:x.executionId,targetId:x.initial.positions[position].targets[0].id},expected:{resultVersion:0,assignment:currentAssignment(x,x.initial.positions[position].id)},intent:{result:{reps:{value:8,basis:'total'},measurement:null,rir:'2'}}});
    const skip=(x:ExecutionRead)=>({...envelope(),commandType:'SkipSet',target:{executionId:x.executionId,targetId:x.initial.positions[0].targets[0].id},expected:{resultVersion:0,skipActionId:null,assignment:currentAssignment(x,x.initial.positions[0].id)},intent:{}});
    const addition=(x:ExecutionRead,position=0)=>({...envelope(),commandType:'AddSet',target:{executionId:x.executionId,positionId:x.initial.positions[position].id},expected:{contentHash:x.contentHash,assignment:currentAssignment(x,x.initial.positions[position].id)},intent:{}});
    const add=async(x:ExecutionRead,position=0)=>{const c=addition(x,position),r=await addSet(db,principal,c);assert(r.outcome.status==='Accepted');return {command:c,fact:(await read(x.executionId)).additions!.find(a=>a.actionId===c.actionId)!};};
    const record=(x:ExecutionRead,id:string,position=0,measurement:unknown=null)=>({...log(x,position),target:{executionId:x.executionId,targetId:id},intent:{result:{reps:{value:8,basis:'total'},measurement,rir:'2'}}});
    let exerciseTrial=await start(); const frozen=canonicalJson(exerciseTrial.initial);
    const exerciseCommand=(x:ExecutionRead)=>({...envelope(),commandType:'AddExercise',target:{executionId:x.executionId},expected:{contentHash:x.contentHash},
      intent:{catalogId:'t2:leg-press',sets:2,reps:{min:8,max:12,basis:'total'},rir:'2',startingLoad:{kind:'externalLoad',value:'0.00',unit:'lb',convention:'machineDisplayed',zeroMeaning:'validZero'}}});
    const ec=exerciseCommand(exerciseTrial),er=await addExercise(db,principal,ec);assert(er.outcome.status==='Accepted');
    assert.equal((await addExercise(db,principal,{...exerciseCommand(exerciseTrial),intent:{...ec.intent,catalogId:'t2:unqualified-entry'}})).outcome.status,'Rejected');
    assert.equal((await addExercise(db,principal,{...exerciseCommand(exerciseTrial),intent:{...ec.intent,startingLoad:{kind:'bodyweight',convention:'bodyweightOnly'}}})).outcome.status,'Rejected');
    assert.equal((await addExercise(db,principal,ec)).replayed,true);
    await assert.rejects(()=>addExercise(db,principal,{...ec,intent:{...ec.intent,sets:3}}),/ACTION_ID_COLLISION/);
    const pair=await Promise.all([addExercise(db,principal,exerciseCommand(exerciseTrial)),addExercise(db,principal,exerciseCommand(exerciseTrial))]);assert(pair.every(r=>r.outcome.status==='Accepted'));
    exerciseTrial=await read(exerciseTrial.executionId);assert.equal(exerciseTrial.exerciseAdditions!.length,3);
    assert.deepEqual(exerciseTrial.exerciseAdditions!.map(a=>a.content.ordinal),[4,5,6]);
    assert.equal(canonicalJson(exerciseTrial.initial),frozen);assert.equal(new Set(executionPositions(exerciseTrial).flatMap(p=>[p.id,...p.targets.map(t=>t.id)])).size,18);
    const ep=exerciseTrial.exerciseAdditions![0].content.position;
    assert.equal((await finishExecution(db,principal,finish({...exerciseTrial,exerciseAdditions:[]}))).outcome.status,'Conflict');
    assert.equal((await addSet(db,principal,{...envelope(),commandType:'AddSet',target:{executionId:exerciseTrial.executionId,positionId:ep.id},expected:{contentHash:exerciseTrial.contentHash,assignment:currentAssignment(exerciseTrial,ep.id)},intent:{}})).outcome.status,'Accepted');
    const previewAdded=await previewExerciseSwap(readDb,principal,{executionId:exerciseTrial.executionId,positionId:ep.id,intent:{restoreOriginal:false,catalogId:'t2:push-up'}});
    assert.equal((await swapExercise(db,principal,{...envelope(),commandType:'SwapExercise',target:{executionId:exerciseTrial.executionId,positionId:ep.id},expected:{contentHash:previewAdded.contentHash,assignment:previewAdded.assignment,instructionEpoch:previewAdded.instructionEpoch,effectiveHash:previewAdded.effectiveHash},intent:{restoreOriginal:false,catalogId:'t2:push-up'}})).outcome.status,'Accepted');
    const restoreAdded=await previewExerciseSwap(readDb,principal,{executionId:exerciseTrial.executionId,positionId:ep.id,intent:{restoreOriginal:true}});
    assert.equal((await swapExercise(db,principal,{...envelope(),commandType:'SwapExercise',target:{executionId:exerciseTrial.executionId,positionId:ep.id},expected:{contentHash:restoreAdded.contentHash,assignment:restoreAdded.assignment,instructionEpoch:restoreAdded.instructionEpoch,effectiveHash:restoreAdded.effectiveHash},intent:{restoreOriginal:true}})).outcome.status,'Accepted');
    exerciseTrial=await read(exerciseTrial.executionId);assert.deepEqual(effectiveOccurrence(exerciseTrial).positions[3].targets[0],ep.targets[0]);
    const perform={...envelope(),commandType:'RecordSetResult',target:{executionId:exerciseTrial.executionId,targetId:ep.targets[0].id},expected:{resultVersion:0,assignment:currentAssignment(exerciseTrial,ep.id)},intent:{result:{reps:{value:8,basis:'total'},measurement:ec.intent.startingLoad,rir:'2'}}};
    assert.equal((await saveSetResult(db,principal,perform)).outcome.status,'Accepted');
    await assert.rejects(()=>previewExerciseSwap(readDb,principal,{executionId:exerciseTrial.executionId,positionId:ep.id,intent:{restoreOriginal:true}}),/EXERCISE_ALREADY_TOUCHED/);
    let savedAdded=(await read(exerciseTrial.executionId)).results.find(r=>r.targetId===ep.targets[0].id)!;
    const correction=(result:unknown,reason:string)=>({...envelope(),commandType:'CorrectSetResult',target:perform.target,expected:{resultVersion:savedAdded.version,performedSetId:savedAdded.performedSetId},intent:{result,reason}});
    assert.equal((await saveSetResult(db,principal,correction({...perform.intent.result,rir:'1'},'Synthetic correction'))).outcome.status,'Accepted');
    savedAdded=(await read(exerciseTrial.executionId)).results.find(r=>r.targetId===ep.targets[0].id)!;
    assert.equal((await saveSetResult(db,principal,correction(null,'Synthetic clear'))).outcome.status,'Accepted');
    savedAdded=(await read(exerciseTrial.executionId)).results.find(r=>r.targetId===ep.targets[0].id)!;
    await assert.rejects(()=>previewExerciseSwap(readDb,principal,{executionId:exerciseTrial.executionId,positionId:ep.id,intent:{restoreOriginal:true}}),/EXERCISE_ALREADY_TOUCHED/);
    assert.equal((await saveSetResult(db,principal,correction(perform.intent.result,'Synthetic re-record'))).outcome.status,'Accepted');
    const addedSkip={...envelope(),commandType:'SkipSet',target:{executionId:exerciseTrial.executionId,targetId:ep.targets[1].id},expected:{resultVersion:0,skipActionId:null,assignment:currentAssignment(exerciseTrial,ep.id)},intent:{}};
    assert.equal((await skipSet(db,principal,addedSkip)).outcome.status,'Accepted');
    assert.equal((await saveSetResult(db,principal,{...perform,...envelope(),target:addedSkip.target,expected:{...perform.expected,skipActionId:addedSkip.actionId}})).outcome.status,'Accepted');
    await close(exerciseTrial);assert.equal((await addExercise(db,principal,ec)).replayed,true);assert.equal((await addExercise(db,principal,exerciseCommand(exerciseTrial))).outcome.status,'Conflict');
    savedAdded=(await read(exerciseTrial.executionId)).results.find(r=>r.targetId===ep.targets[0].id)!;
    assert.equal((await correctHistoricalSetResult(db,principal,{...correction({...perform.intent.result,rir:'0'},'Synthetic historical correction'),commandType:'CorrectHistoricalSetResult'})).outcome.status,'Accepted');
    assert.equal(canonicalJson((await readDraft(readDb,principal,planId))!.intent),originalPlan);
    pass('Exercise addition duplicate/replay/concurrency/finish/Add set/swap/restore/performed-lock/closure and immutable plan');
    let x=await start(); const initial=canonicalJson(x.initial), c=addition(x);
    const first=await addSet(db,principal,c); assert(first.outcome.status==='Accepted');
    assert.equal((await addSet(db,principal,c)).replayed,true);
    await assert.rejects(()=>addSet(db,principal,{...c,intent:{changed:true}}));
    await assert.rejects(()=>addSet(db,principal,{...c,deviceId:randomUUID()}),/ACTION_ID_COLLISION/);
    x=await read(x.executionId);const a=x.additions![0];
    assert.equal(a.content.ordinal,3);assert.equal(a.content.target.classification,'working');assert.equal(a.content.target.required,true);
    assert.deepEqual({...a.content.target,id:x.initial.occurrence.positions[0].targets[1].id},x.initial.occurrence.positions[0].targets[1]);
    assert.equal(canonicalJson(x.initial),initial);assert.equal(x.results.length,0);assert.equal(effectiveOccurrence(x).positions[0].targets.length,3);
    pass('Append before logging, copied exact decimal targets, durable execution identity, replay and changed-envelope collision');
    assert.equal((await swapExercise(db,principal,await swap(x))).outcome.status,'Accepted');x=await read(x.executionId);
    assert.equal(effectiveOccurrence(x).positions[0].targets.length,3);assert.equal(effectiveOccurrence(x).positions[0].targets[2].id,a.content.target.id);
    const afterSwap=await add(x); x=await read(x.executionId);assert.equal(afterSwap.fact.content.target.measurement,null);
    assert.equal(afterSwap.fact.content.exercise.name,'Leg Press');
    assert.equal((await swapExercise(db,principal,await swap(x,0,true))).outcome.status,'Accepted');x=await read(x.executionId);
    assert.equal(effectiveOccurrence(x).positions[0].targets[2].measurement?.kind,'externalLoad');
    assert.equal(effectiveOccurrence(x).positions[0].targets[3].measurement,null);
    assert.deepEqual(x.additions![0],a);const restored=canonicalJson(effectiveOccurrence(x));
    assert.equal((await swapExercise(db,principal,await swap(x))).outcome.status,'Accepted');x=await read(x.executionId);
    assert.equal((await swapExercise(db,principal,await swap(x,0,true))).outcome.status,'Accepted');x=await read(x.executionId);
    assert.equal(canonicalJson(effectiveOccurrence(x)),restored);
    pass('Untouched additions allow swap/restore, include all current sets and retain immutable addition facts without target drift');
    assert.equal((await saveSetResult(db,principal,record(x,a.content.target.id))).outcome.status,'Accepted');x=await read(x.executionId);
    let saved=x.results.find(r=>r.targetId===a.content.target.id)!;
    const correct=(result:unknown,reason?:string)=>({...envelope(),commandType:'CorrectSetResult',target:{executionId:x.executionId,targetId:saved.targetId},expected:{resultVersion:saved.version,performedSetId:saved.performedSetId},intent:{result,...(reason?{reason}:{})}});
    assert.equal((await saveSetResult(db,principal,correct({...saved.result,reps:{value:9,basis:'total'}}))).outcome.status,'Accepted');x=await read(x.executionId);saved=x.results.find(r=>r.targetId===saved.targetId)!;
    assert.equal((await saveSetResult(db,principal,correct(null,'Synthetic accidental entry'))).outcome.status,'Accepted');x=await read(x.executionId);saved=x.results.find(r=>r.targetId===saved.targetId)!;
    await assert.rejects(()=>swap(x),/EXERCISE_ALREADY_TOUCHED/);
    assert.equal((await saveSetResult(db,principal,correct({reps:{value:10,basis:'total'},measurement:null,rir:'1'}))).outcome.status,'Accepted');x=await read(x.executionId);
    const skipAdded={...skip(x),target:{executionId:x.executionId,targetId:afterSwap.fact.content.target.id},expected:{resultVersion:0,skipActionId:null,assignment:currentAssignment(x,x.initial.positions[0].id)}};
    assert.equal((await skipSet(db,principal,skipAdded)).outcome.status,'Accepted');x=await read(x.executionId);
    assert.equal((await saveSetResult(db,principal,{...record(x,skipAdded.target.targetId),expected:{resultVersion:0,skipActionId:skipAdded.actionId,assignment:currentAssignment(x,x.initial.positions[0].id)}})).outcome.status,'Accepted');
    await close(x);x=await read(x.executionId);saved=x.results.find(r=>r.targetId===a.content.target.id)!;
    assert.equal((await correctHistoricalSetResult(db,principal,{...correct({...saved.result,reps:{value:11,basis:'total'}}),commandType:'CorrectHistoricalSetResult'})).outcome.status,'Accepted');
    assert.equal((await addSet(db,principal,c)).replayed,true);assert.equal((await addSet(db,principal,addition(x))).outcome.status,'Conflict');
    pass('Added results log/correct/clear/re-record, skip then log, historical correction and exact replay after closure');
    x=await start();
    for(let position=0;position<3;position++){const added=await add(x,position);assert.deepEqual(added.fact.content.target.measurement,x.initial.occurrence.positions[position].targets[1].measurement);}
    pass('Valid external zero in kg, bodyweight and zero-assistance target meaning copied without normalization');
    await saveSetResult(db,principal,log(x));await add(x);
    x=await read(x.executionId);for(const p of x.initial.positions)for(const t of p.targets)if(!x.results.some(r=>r.targetId===t.id))assert.equal((await skipSet(db,principal,{...skip(x),target:{executionId:x.executionId,targetId:t.id},expected:{resultVersion:0,skipActionId:null,assignment:currentAssignment(x,p.id)}})).outcome.status,'Accepted');
    await add(await read(x.executionId));await close(x);pass('Addition after partial logging and after all planned sets resolve');
    async function race(first:()=>Promise<{outcome:{status:string}}>,second:()=>Promise<{outcome:{status:string}}>) {
      const lock=await admin!.connect();await lock.query('BEGIN');await lock.query('SELECT "accountId" FROM "Trainer2AccountTrainingState" WHERE "accountId"=$1 FOR UPDATE',[accountId]);
      const wait=async(n:number)=>{for(let i=0;i<200;i++){const q=await admin!.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'");if(q.rows[0].n>=n)return;await new Promise(r=>setTimeout(r,20));}throw new Error('Expected blocked race');};
      try{const a=first();await wait(1);const b=second();await wait(2);await lock.query('COMMIT');return Promise.all([a,b]);}finally{await lock.query('ROLLBACK');lock.release();}
    }
    for(const kind of ['finish','swap','add'])for(const reverse of [false,true]) {
      x=await start();const c=addition(x),other=kind==='finish'?finish(x):kind==='swap'?await swap(x):addition(x);
      const a=()=>addSet(db,principal,c),b=()=>kind==='finish'?finishExecution(db,principal,other):kind==='swap'?swapExercise(db,principal,other):addSet(db,principal,other);
      const results=await race(reverse?b:a,reverse?a:b);assert.equal(results[0].outcome.status,'Accepted');assert.equal(results[1].outcome.status,kind==='add'?'Accepted':'Conflict');
      const latest=await read(x.executionId);if(kind==='add'){assert.deepEqual(latest.additions!.map(a=>a.content.ordinal),[3,4]);assert.equal(new Set(latest.additions!.map(a=>a.content.target.id)).size,2);}
      if(latest.lifecycle==='Open')await close(latest);pass(`Observed account-lock ${kind} race ${reverse?'other first':'addition first'}`);
    }
    for (const reverse of [false,true]) {
      x=await start();const ac=exerciseCommand(x),fc=finish(x);
      const outcomes=await race(reverse?()=>finishExecution(db,principal,fc):()=>addExercise(db,principal,ac),reverse?()=>addExercise(db,principal,ac):()=>finishExecution(db,principal,fc));
      assert.equal(outcomes[0].outcome.status,'Accepted');assert.equal(outcomes[1].outcome.status,'Conflict');
      const latest=await read(x.executionId);if(latest.lifecycle==='Open')await close(latest);
      pass(`Observed account-lock Add exercise/finish race ${reverse?'finish first':'addition first'}`);
    }
    assert.equal(canonicalJson((await readDraft(readDb,principal,planId))!.intent),originalPlan);pass('Accepted plan, original targets and future workouts preserved');
    await assert.rejects(()=>readDb.$executeRaw`INSERT INTO "Trainer2SetAddition" DEFAULT VALUES`);
    await assert.rejects(()=>db.$executeRaw`UPDATE "Trainer2SetAddition" SET "ordinal"=99`);
    await assert.rejects(()=>db.$executeRaw`DELETE FROM "Trainer2SetAddition"`);
    x=await start();await assert.rejects(()=>addSet(db,{accountId:randomUUID(),sessionId},addition(x)),/ACCOUNT_MISMATCH|UNAUTHORIZED/);
    const invalid=addition(x);
    await assert.rejects(()=>db.$transaction(async tx=>{
      await tx.trainer2DurableAction.create({data:{accountId,actionId:invalid.actionId,...commandBinding(invalid)}});
      const content={...a.content,target:{...a.content.target,id:randomUUID()},ordinal:99};const canonicalContent=canonicalJson(content),hash=createHash('sha256').update(canonicalContent).digest('hex');
      await tx.$executeRaw`INSERT INTO "Trainer2SetAddition" ("accountId","executionId","positionId","targetId","ordinal","actionId","content","canonicalContent","contentHash") VALUES (${accountId},${x.executionId}::uuid,${invalid.target.positionId}::uuid,${content.target.id}::uuid,99,${invalid.actionId}::uuid,${JSON.stringify(content)}::jsonb,${canonicalContent},${hash})`;
    }),/TRAINER2_ADDITION_SOURCE/);
    assert.equal((await read(x.executionId)).additions!.length,0);
    assert.equal((await saveSetResult(db,principal,record(x,randomUUID()))).outcome.status,'Rejected');
    const targetId=randomUUID(),validCommand=addition(x),position=x.initial.occurrence.positions[0];
    const validContent={policyVersion:'trainer2-add-set-v1',positionId:validCommand.target.positionId,ordinal:3,target:{...position.targets[1],id:targetId},exercise:position.exercise,assignment:validCommand.expected.assignment};
    const canonicalContent=canonicalJson(validContent),hash=createHash('sha256').update(canonicalContent).digest('hex');
    await assert.rejects(()=>db.$transaction(async tx=>{
      await tx.trainer2DurableAction.create({data:{accountId,actionId:validCommand.actionId,...commandBinding(validCommand)}});
      await tx.$executeRaw`INSERT INTO "Trainer2SetAddition" ("accountId","executionId","positionId","targetId","ordinal","actionId","content","canonicalContent","contentHash") VALUES (${accountId},${x.executionId}::uuid,${validCommand.target.positionId}::uuid,${targetId}::uuid,3,${validCommand.actionId}::uuid,${JSON.stringify(validContent)}::jsonb,${canonicalContent},${hash})`;
    }),/TRAINER2_ADDITION_OUTCOME/);
    assert.equal((await read(x.executionId)).additions!.length,0);
    pass('Restricted roles, immutable additions, wrong-account and invalid direct insertion/target membership rejection');
    const upgradeName=`${database}_upgrade`;assert(/^trainer2_disposable_add_exercise_[a-f0-9]+_upgrade$/.test(upgradeName));
    await admin.query(`CREATE DATABASE "${upgradeName}"`);
    const upgradeUrl=(role:string)=>url(role).replace(`/${database}`,`/${upgradeName}`);
    const upgradeAdmin=new Pool({connectionString:upgradeUrl('postgres')}),upgradeDb=new PrismaClient({adapter:new PrismaPg({connectionString:upgradeUrl('trainer2_draft_runtime')})});
    try {
      for(const name of readdirSync('prisma/migrations').filter(n=>/^\d/.test(n)&&n<'20261001010000_trainer2_add_set').sort())await upgradeAdmin.query(readFileSync(`prisma/migrations/${name}/migration.sql`,'utf8'));
      const grants=readFileSync('prisma/trainer2-runtime-grants.sql','utf8'),boundary=grants.indexOf('-- Incremental Add set grants');assert(boundary>0);
      await upgradeAdmin.query(grants.slice(0,boundary).replace(/^CREATE ROLE .*;\r?\n/gm,''));
      await upgradeAdmin.query('INSERT INTO "User" ("id","email") VALUES ($1,$2)',[accountId,`${suffix}-upgrade@trainer2.invalid`]);
      await upgradeAdmin.query('INSERT INTO "Trainer2Owner" ("id","accountId","passcodeVerifier") VALUES (1,$1,$2)',[accountId,'synthetic-disabled']);
      await upgradeAdmin.query(`INSERT INTO "Trainer2DeviceSession" ("id","ownerId","tokenHash","createdAt","renewedAt","expiresAt","absoluteExpiresAt","epoch") VALUES ($1,1,$2,now(),now(),now()+interval '1 day',now()+interval '2 days',0)`,[sessionId,createHash('sha256').update(secret).digest('hex')]);
      const upgradePlan=randomUUID(),upgradeIntent={...intent,occurrences:intent.occurrences.slice(0,1)};
      assert.equal((await createDraft(upgradeDb,principal,{...envelope(),commandType:'CreateDraft',target:{planId:upgradePlan},expected:{},intent:upgradeIntent})).outcome.status,'Accepted');
      const head=(await readDraft(upgradeDb,principal,upgradePlan))!;
      assert.equal((await activatePlan(upgradeDb,principal,{...envelope(),commandType:'ActivatePlan',target:{planId:upgradePlan},expected:{planRevisionId:head.revisionId},intent:{reviewed:head.activation}})).outcome.status,'Accepted');
      const started=await startOccurrence(upgradeDb,principal,{...envelope(),commandType:'StartOccurrence',target:{planId:upgradePlan,occurrenceId:upgradeIntent.occurrences[0].id},expected:{planRevisionId:head.revisionId,instructionEpoch:0},intent:{}});assert(started.outcome.status==='Accepted');
      const upgradeId=started.outcome.result.executionId,startRow=(await upgradeAdmin.query('SELECT * FROM "Trainer2Execution" WHERE "id"=$1',[upgradeId])).rows[0];
      const targetId=startRow.initialPrescription.positions[0].targets[0].id,performedSetId=randomUUID(),assignment={positionId:startRow.initialPrescription.positions[0].id,version:0,actionId:null,contentHash:startRow.contentHash};
      const legacyCommand={...envelope(),commandType:'RecordSetResult',target:{executionId:upgradeId,targetId},expected:{resultVersion:0,assignment},intent:{result:{reps:{value:8,basis:'total'},measurement:{kind:'externalLoad',value:'12.50',unit:'lb',convention:'barbellTotal',zeroMeaning:'validZero'},rir:'2'}}};
      await acceptCommand(upgradeDb,principal,legacyCommand,legacyCommand,async tx=>{
        await tx.$executeRaw`INSERT INTO "Trainer2SetResultRevision" ("accountId","executionId","targetId","performedSetId","version","actionId","result","assignment") VALUES (${accountId},${upgradeId}::uuid,${targetId}::uuid,${performedSetId}::uuid,1,${legacyCommand.actionId}::uuid,${JSON.stringify(legacyCommand.intent.result)}::jsonb,${JSON.stringify(assignment)}::jsonb)`;
        return {...legacyCommand.target,performedSetId,version:1};
      });
      const baselineSchema=resolve(artifact,'baseline-schema.prisma');writeFileSync(baselineSchema,command('git',['show','7affad657eb041c56ee6b3fe50aad1dde9bba5d0:trainer-app/prisma/schema.prisma']));
      const baselineDrift=schemaDiff(upgradeUrl('postgres'),baselineSchema);
      const addedForeignKeys=['Trainer2SetAddition','Trainer2ExerciseAddition'].flatMap(table=>['accountId_executionId','accountId_actionId'].map(key=>`unexpected-statement:ALTER TABLE \"${table}\" DROP CONSTRAINT \"${table}_${key}_fkey\"`));
      assert.deepEqual(candidateDrift.issues,[...baselineDrift.issues,...addedForeignKeys].sort());
      assert.deepEqual(candidateDrift.intentionalDatabaseOnlyExtensions,baselineDrift.intentionalDatabaseOnlyExtensions);
      pass('Schema drift equals baseline plus declared addition account foreign keys; protected finisher extensions unchanged');
      const before=(await upgradeAdmin.query('SELECT to_jsonb(r) AS row FROM "Trainer2SetResultRevision" r')).rows;
      // Model existing Supabase projects: named API defaults survive PUBLIC
      // revocation, and service_role bypasses RLS. Defaults apply in this DB only.
      for(const role of ['anon','authenticated','service_role'])await upgradeAdmin.query(`CREATE ROLE ${role} NOLOGIN ${role==='service_role'?'BYPASSRLS':'NOBYPASSRLS'}`);
      await upgradeAdmin.query('GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role');
      await upgradeAdmin.query('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated,service_role,PUBLIC');
      await upgradeAdmin.query('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon,authenticated,service_role,PUBLIC');
      await upgradeAdmin.query(readFileSync('prisma/migrations/20261001010000_trainer2_add_set/migration.sql','utf8'));
      const helpers=['trainer2_execution_positions(uuid)','trainer2_effective_targets(uuid,uuid)','trainer2_restored_addition_target(uuid,uuid)','trainer2_addition_guard()','trainer2_addition_seal()'];
      assert.equal((await upgradeAdmin.query("SELECT rolbypassrls FROM pg_roles WHERE rolname='service_role'")).rows[0].rolbypassrls,true);
      for(const role of ['anon','authenticated','service_role']) {
        assert.equal((await upgradeAdmin.query(`SELECT has_table_privilege($1,'"Trainer2SetAddition"','SELECT') AS allowed`,[role])).rows[0].allowed,true);
        for(const helper of helpers)assert.equal((await upgradeAdmin.query("SELECT has_function_privilege($1,$2,'EXECUTE') AS allowed",[role,helper])).rows[0].allowed,true);
      }
      await upgradeAdmin.query('SET ROLE service_role');
      try {assert.equal((await upgradeAdmin.query('SELECT count(*)::int AS n FROM "Trainer2SetAddition"')).rows[0].n,0);}finally{await upgradeAdmin.query('RESET ROLE');}
      await upgradeAdmin.query(readFileSync('prisma/migrations/20261002010000_trainer2_add_exercise/migration.sql','utf8'));
      await upgradeAdmin.query(grants.slice(boundary));
      for (const role of ['anon','authenticated','service_role']) {
        for (const privilege of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) assert.equal((await upgradeAdmin.query(`SELECT has_table_privilege($1,'"Trainer2ExerciseAddition"',$2) AS allowed`,[role,privilege])).rows[0].allowed,false);
        for (const helper of ['trainer2_original_positions(uuid)','trainer2_base_positions(uuid)','trainer2_exercise_addition_guard()','trainer2_exercise_addition_seal()']) assert.equal((await upgradeAdmin.query(`SELECT has_function_privilege($1,$2,'EXECUTE') AS allowed`,[role,helper])).rows[0].allowed,false);
      }

      for(const role of ['anon','authenticated','service_role']) {
        for(const privilege of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'])assert.equal((await upgradeAdmin.query(`SELECT has_table_privilege($1,'"Trainer2SetAddition"',$2) AS allowed`,[role,privilege])).rows[0].allowed,false);
        for(const helper of helpers)assert.equal((await upgradeAdmin.query("SELECT has_function_privilege($1,$2,'EXECUTE') AS allowed",[role,helper])).rows[0].allowed,false);
        const roleClient=await upgradeAdmin.connect();await roleClient.query(`SET ROLE ${role}`);
        try {
          await assert.rejects(()=>roleClient.query('SELECT * FROM "Trainer2SetAddition"'),/permission denied/);
          await assert.rejects(()=>roleClient.query('INSERT INTO "Trainer2SetAddition" DEFAULT VALUES'),/permission denied/);
          for(const helper of helpers)await assert.rejects(()=>roleClient.query(`SELECT public.${helper.replace(/uuid/g,"NULL::uuid")}`),/permission denied/);
        } finally {try{await roleClient.query('RESET ROLE');}finally{roleClient.release();}}
      }
      // PUBLIC is a pseudo-role: inspect effective ACL entries rather than
      // querying has_*_privilege with a nonexistent login named "PUBLIC".
      assert.equal((await upgradeAdmin.query(`SELECT count(*)::int AS n FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE c.oid='"Trainer2SetAddition"'::regclass AND a.grantee=0`)).rows[0].n,0);
      for(const helper of helpers)assert.equal((await upgradeAdmin.query("SELECT count(*)::int AS n FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid=$1::regprocedure AND a.grantee=0",[helper])).rows[0].n,0);
      for(const role of ['trainer2_draft_reader','trainer2_draft_runtime','trainer2_identity_runtime']) {
        assert.equal((await upgradeAdmin.query(`SELECT has_table_privilege($1,'"Trainer2SetAddition"','SELECT') AS allowed`,[role])).rows[0].allowed,role!=='trainer2_identity_runtime');
        assert.equal((await upgradeAdmin.query(`SELECT has_table_privilege($1,'"Trainer2SetAddition"','INSERT') AS allowed`,[role])).rows[0].allowed,role==='trainer2_draft_runtime');
        for(const privilege of ['UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'])assert.equal((await upgradeAdmin.query(`SELECT has_table_privilege($1,'"Trainer2SetAddition"',$2) AS allowed`,[role,privilege])).rows[0].allowed,false);
        for(const [index,helper] of helpers.entries())assert.equal((await upgradeAdmin.query("SELECT has_function_privilege($1,$2,'EXECUTE') AS allowed",[role,helper])).rows[0].allowed,index<3 && role!=='trainer2_identity_runtime');
      }
      assert.deepEqual((await upgradeAdmin.query('SELECT to_jsonb(r) AS row FROM "Trainer2SetResultRevision" r')).rows,before);
      assert.deepEqual((await upgradeAdmin.query('SELECT * FROM "Trainer2Execution" WHERE "id"=$1',[upgradeId])).rows[0],startRow);
      const upgraded=await validateExecutionRead(await readExecution(upgradeDb,principal,upgradeId),accountId,upgradeId);
      assert.equal(upgraded.additions!.length,0);assert.equal((await addSet(upgradeDb,principal,addition(upgraded))).outcome.status,'Accepted');
      for(const role of ['trainer2_draft_reader','trainer2_draft_runtime']) {
        await upgradeAdmin.query(`SET ROLE ${role}`);
        try {
          assert.equal((await upgradeAdmin.query('SELECT count(*)::int AS n FROM "Trainer2SetAddition"')).rows[0].n,1);
          await upgradeAdmin.query('SELECT trainer2_execution_positions($1::uuid),trainer2_effective_targets($1::uuid,$2::uuid),trainer2_restored_addition_target($1::uuid,$2::uuid)',[upgradeId,upgraded.initial.positions[0].id]);
        }finally{await upgradeAdmin.query('RESET ROLE');}
      }
      assert.deepEqual((await upgradeAdmin.query('SELECT to_jsonb(r) AS row FROM "Trainer2SetResultRevision" r')).rows,before);
      pass('Populated baseline upgrade: Supabase default ACLs revoked including BYPASSRLS role/all helpers/PUBLIC; restricted operations preserve START and saved evidence');
    } finally {
      const results=await cleanupSteps([{name:'upgrade runtime',run:()=>upgradeDb.$disconnect()},{name:'upgrade pool',run:()=>upgradeAdmin.end()}]);
      cleanup.push(...results);assert(results.every(r=>r.status==='passed'),'Upgrade cleanup failed');
    }
    // Windows can reserve otherwise-unused ports (EACCES). Ask the OS for an
    // available loopback port instead of sampling its excluded ranges.
    const webPort=await new Promise<number>((resolvePort,reject)=>{
      const probe=createServer();probe.once('error',reject);
      probe.listen(0,'127.0.0.1',()=>{const address=probe.address();assert(address&&typeof address!=='string');
        probe.close(error=>error?reject(error):resolvePort(address.port));});
    });
    const base=`http://127.0.0.1:${webPort}`;webOrigin=base;
    const webEnv:NodeJS.ProcessEnv={...authWebPlatformEnvironment(process.env),NODE_ENV:'development',TRAINER2_LOCAL_DRAFTS:'enabled',TRAINER2_OWNER_USER_ID:accountId,TRAINER2_APP_ORIGIN:base,
      TRAINER2_IDENTITY_CONNECTION_STRING:url('trainer2_identity_runtime'),TRAINER2_READ_CONNECTION_STRING:url('trainer2_draft_reader'),TRAINER2_WRITE_CONNECTION_STRING:url('trainer2_draft_runtime')};
    const launch=()=>{server=spawn(process.execPath,[resolve('node_modules/next/dist/bin/next'),'dev','--hostname','127.0.0.1','--port',String(webPort)],{env:webEnv,windowsHide:true,stdio:'pipe'});serverCompletion=waitForWorker(server,20*60_000);if(server.pid)track(server.pid);server.stdout?.on('data',v=>serverLog+=v);server.stderr?.on('data',v=>serverLog+=v);};
    const waitWeb=async()=>{for(let i=0;i<120;i++){try{if((await fetch(base+'/trainer2/auth',{signal:AbortSignal.timeout(2_000)})).ok)return;}catch{}assert(server?.exitCode===null);await new Promise(r=>setTimeout(r,500));}throw new Error('Task web did not start');};
    launch();await waitWeb();
    const systemDrive=process.env.SYSTEMDRIVE??'C:';
    const edge=[process.env.PROGRAMFILES,process.env['PROGRAMFILES(X86)'],process.env.LOCALAPPDATA,`${systemDrive}/Program Files`,`${systemDrive}/Program Files (x86)`]
      .filter((root):root is string=>Boolean(root)).map(root=>resolve(root,'Microsoft/Edge/Application/msedge.exe')).find(existsSync);
    assert(edge,'Installed Edge is required; no browser download or existing profile is used');
    // Keep Playwright's profile and artifact directories under this new task
    // resource. Its standard Edge launcher owns the debugging pipes and exit.
    mkdirSync(browserProfile);
    const priorTemp=process.env.TEMP,priorTmp=process.env.TMP;
    try {
      process.env.TEMP=browserProfile;process.env.TMP=browserProfile;
      browserServer=await chromium.launchServer({executablePath:edge,headless:true,timeout:30_000,
        args:['--disable-gpu','--disable-background-mode','--disable-crash-reporter'],
        env:authWebPlatformEnvironment(process.env)});
    } finally {
      if(priorTemp===undefined)delete process.env.TEMP;else process.env.TEMP=priorTemp;
      if(priorTmp===undefined)delete process.env.TMP;else process.env.TMP=priorTmp;
    }
    browserProcess=browserServer.process();
    if(browserProcess.pid)track(browserProcess.pid);
    browserLifecycle.push({event:'launched',at:new Date().toISOString(),pid:browserProcess.pid});
    browserProcess.on('exit',(exitCode,signal)=>browserLifecycle.push({event:'exit',at:new Date().toISOString(),exitCode,signal}));
    browserProcess.on('close',(exitCode,signal)=>browserLifecycle.push({event:'close',at:new Date().toISOString(),exitCode,signal}));
    browserProcess.on('error',error=>browserLifecycle.push({event:'error',at:new Date().toISOString(),error:error.message}));
    browserCompletion=waitForWorker(browserProcess,20*60_000);
    browserProcess.stdout?.on('data',v=>browserLog+=v);browserProcess.stderr?.on('data',v=>browserLog+=v);
    browserEndpoint=browserServer.wsEndpoint();
    browser=await chromium.connect(browserEndpoint,{timeout:30_000});const context=await browser.newContext({viewport:{width:1360,height:1000},reducedMotion:'reduce'});browserContext=context;
    context.on('request',request=>pendingBrowserRequests.set(request,{method:request.method(),path:new URL(request.url()).pathname}));
    context.on('requestfinished',request=>pendingBrowserRequests.delete(request));
    context.on('requestfailed',request=>pendingBrowserRequests.delete(request));
    await context.addCookies([{name:'__Host-trainer2-session',value:`${sessionId}.${secret}`,domain:'127.0.0.1',path:'/',secure:true,httpOnly:true,sameSite:'Strict'}]);
    // Accept original kg bytes through the real command owner, then log the
    // untouched pounds prefill through the browser and independently read DB.
    await close(x);
    const kgTrial=await start(),kgCommand=exerciseCommand(kgTrial);
    kgCommand.intent.reps={min:8,max:8,basis:'total'};
    kgCommand.intent.startingLoad={...kgCommand.intent.startingLoad,value:'10',unit:'kg'};
    assert.equal((await addExercise(db,principal,kgCommand)).outcome.status,'Accepted');
    const kgAccepted=await read(kgTrial.executionId),kgFact=kgAccepted.exerciseAdditions!.find(a=>a.actionId===kgCommand.actionId)!;
    const kgPage=await context.newPage();await kgPage.goto(base+`/trainer2/dev/executions/${kgTrial.executionId}`);
    await kgPage.getByRole('region',{name:'Exercise queue'}).getByRole('button',{name:/Leg Press.*set 1, unrecorded/}).click();
    const kgCard=kgPage.getByRole('region',{name:'Active set',exact:true});
    assert.equal(await kgCard.getByLabel('Set 1 Actual load',{exact:true}).inputValue(),'22.05');
    await kgCard.getByRole('button',{name:'Log set',exact:true}).click();
    await kgCard.getByLabel('Set 2 Actual reps').waitFor();
    assert.equal(await kgCard.getByLabel('Set 2 Actual load',{exact:true}).inputValue(),'22.05');
    const kgLogged=await read(kgTrial.executionId);
    assert.deepEqual(kgLogged.results.find(r=>r.targetId===kgFact.content.position.targets[0].id)!.result!.measurement,kgCommand.intent.startingLoad);
    assert.deepEqual(kgLogged.exerciseAdditions!.find(a=>a.actionId===kgCommand.actionId),kgFact);
    assert.equal(kgLogged.contentHash,kgAccepted.contentHash);
    const kgStored=await admin.query('SELECT "result" FROM "Trainer2SetResultRevision" WHERE "executionId"=$1',[kgTrial.executionId]);
    assert.deepEqual(kgStored.rows[0].result.measurement,kgCommand.intent.startingLoad);
    await kgPage.close();
    await close(kgLogged);x=await start();
    const page=await context.newPage();const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(base+`/trainer2/dev/executions/${x.executionId}`);const card=page.getByRole('region',{name:'Active set',exact:true}),queue=page.getByRole('region',{name:'Exercise queue'});
    await card.getByLabel('Set 1 Actual reps').fill('8');await card.getByRole('button',{name:'Log set',exact:true}).click();await card.getByLabel('Set 2 Actual reps').waitFor();
    const timerKey=`trainer2-rest:${accountId}:${x.executionId}`,deadline=await page.evaluate(k=>localStorage.getItem(k),timerKey);assert(deadline);
    await card.getByLabel('Set 2 Actual reps').fill('13');
    await queue.getByRole('button',{name:'+ Add exercise',exact:true}).click();
    const picker=page.getByRole('dialog',{name:'Add exercise',exact:true});
    await picker.getByLabel('Search exercises').fill('leg press');
    await picker.getByRole('button',{name:/^Leg Press/}).click();
    const config=page.getByRole('dialog',{name:'Configure added exercise'});
    assert.equal(await config.getByLabel('Working sets').inputValue(),'2');
    await config.getByRole('button',{name:'Cancel',exact:true}).click();
    assert.equal(await card.getByLabel('Set 2 Actual reps').inputValue(),'13');
    await queue.getByRole('button',{name:'+ Add exercise',exact:true}).click();
    await picker.getByLabel('Search exercises').fill('leg press');await picker.getByRole('button',{name:/^Leg Press/}).click();
    await config.getByLabel('Optional starting weight (lbs)').fill('42.5');
    await config.getByRole('button',{name:'Add exercise',exact:true}).click();
    await card.getByRole('heading',{name:'Leg Press',exact:true}).waitFor();
    assert.equal(await page.evaluate(k=>localStorage.getItem(k),timerKey),deadline);
    assert.equal((await read(x.executionId)).exerciseAdditions!.length,1);
    assert.equal(await card.getByLabel('Set 1 Actual load',{exact:true}).inputValue(),'42.5');
    await page.screenshot({path:resolve(artifact,'desktop-add-exercise.png')});
    await queue.getByRole('button',{name:/set 2, unrecorded/}).first().click();
    assert.equal(await card.getByLabel('Set 2 Actual reps').inputValue(),'13');
    await page.setViewportSize({width:390,height:844});
    await queue.getByRole('button',{name:'+ Add exercise',exact:true}).click();
    await picker.getByLabel('Search exercises').fill('leg press');await picker.getByRole('button',{name:/^Leg Press/}).click();
    await page.screenshot({path:resolve(artifact,'mobile-add-exercise-form.png')});
    const lostExercise:unknown[]=[];
    await page.route('**/api/trainer2/executions/add-exercise',async route=>{lostExercise.push(route.request().postDataJSON());try{await route.fetch();await route.abort('failed');}catch{}});

    await config.getByRole('button',{name:'Add exercise',exact:true}).click();
    await queue.getByRole('button',{name:'Check addition again',exact:true}).waitFor();
    await page.reload();await page.unroute('**/api/trainer2/executions/add-exercise');
    await queue.getByRole('button',{name:'Check addition again',exact:true}).click();
    await queue.getByRole('button',{name:'Check addition again',exact:true}).waitFor({state:'hidden'});
    assert(lostExercise.length>0&&lostExercise.every(v=>canonicalJson(v)===canonicalJson(lostExercise[0])));
    await queue.getByRole('button',{name:/Leg Press.*occurrence 2/}).waitFor();
    assert.equal((await read(x.executionId)).exerciseAdditions!.length,2);
    await queue.getByRole('button',{name:/set 2, unrecorded/}).first().click();
    await card.getByLabel('Set 2 Actual reps').fill('13');
    pass('Desktop/mobile qualified picker, defaults, cancel/retained input, authored load, duplicate queue, selection and unchanged timer');

    await queue.getByRole('button',{name:'+ Add set',exact:true}).first().click();await card.getByLabel('Set 3 Actual reps').waitFor();
    assert.equal(await card.getByLabel('Set 3 Actual reps').inputValue(),'8');
    assert.equal(await page.evaluate(k=>localStorage.getItem(k),timerKey),deadline);
    await queue.getByRole('button',{name:/set 2, unrecorded/}).first().click();assert.equal(await card.getByLabel('Set 2 Actual reps').inputValue(),'13');
    pass('New set selected, nearest same-position actual prefill, other typed input and timer deadline preserved');
    const lost:unknown[]=[];await page.route('**/api/trainer2/executions/add-set',async route=>{lost.push(route.request().postDataJSON());try{await route.fetch();await route.abort('failed');}catch{/* Reload may invalidate an in-flight intercepted response. */}});
    await queue.getByRole('button',{name:'+ Add set',exact:true}).first().click();await queue.getByRole('button',{name:'Check addition again'}).waitFor();
    await page.reload();await page.unroute('**/api/trainer2/executions/add-set');await queue.getByRole('button',{name:'Check addition again'}).click();await card.getByLabel('Set 4 Actual reps').waitFor();
    assert(lost.every(v=>canonicalJson(v)===canonicalJson(lost[0])));assert.equal((await read(x.executionId)).additions!.length,2);
    assert.equal(await page.evaluate(k=>localStorage.getItem(k),timerKey),deadline);
    await page.screenshot({path:resolve(artifact,'desktop-add-set.png')});await page.setViewportSize({width:390,height:844});await page.screenshot({path:resolve(artifact,'mobile-add-set.png')});await queue.screenshot({path:resolve(artifact,'mobile-queue.png')});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    assert.equal(await queue.getByRole('button',{name:'+ Add set',exact:true}).count(),5);
    pass('Lost response, exact retry across reload, duplicate positions, desktop/mobile chip layout without overflow');
    await queue.getByRole('button',{name:'+ Add set',exact:true}).nth(1).click();await card.getByLabel('Set 3 Actual reps').waitFor();
    await card.getByRole('button',{name:'Swap',exact:true}).click();const dialog=page.getByRole('dialog');
    await dialog.getByLabel('Search library').fill('Leg Press');await dialog.getByRole('button',{name:'Leg Press Machine',exact:true}).click();await dialog.getByRole('button',{name:'Confirm swap'}).click();
    await card.getByRole('heading',{name:'Leg Press',exact:true}).waitFor();assert.equal((await read(x.executionId)).additions!.length,3);
    await card.getByRole('button',{name:'Swap',exact:true}).click();await dialog.getByRole('button',{name:'Return to original',exact:true}).click();await dialog.getByRole('button',{name:'Confirm swap'}).click();
    await card.getByRole('heading',{name:'Barbell Back Squat',exact:true}).waitFor();assert.equal(await page.evaluate(k=>localStorage.getItem(k),timerKey),deadline);
    await queue.getByRole('button',{name:/set 4, unrecorded/}).click();
    pass('Browser swap and restore after untouched addition include every set and preserve timer');
    await card.getByLabel('Set 4 Actual reps').fill('9');await card.getByRole('button',{name:'Log set',exact:true}).click();
    await card.getByLabel('Set 1 Actual reps').waitFor();
    await stopWeb();launch();await waitWeb();
    const restartedPage=await context.newPage();restartedPage.on('pageerror',e=>errors.push(e.message));await restartedPage.setViewportSize({width:390,height:844});
    await restartedPage.goto(base+`/trainer2/dev/executions/${x.executionId}`,{waitUntil:'domcontentloaded'});assert.equal((await read(x.executionId)).results.filter(r=>r.result).length,2);
    await close(x);await restartedPage.reload();await restartedPage.getByRole('heading',{name:'Workout finished',exact:true}).waitFor();assert.equal(await restartedPage.getByText('Added during workout',{exact:true}).count(),7);
    assert.equal(await restartedPage.getByRole('button',{name:'+ Add set',exact:true}).count(),0);assert.deepEqual(errors,[]);
    await restartedPage.screenshot({path:resolve(artifact,'mobile-completed.png')});pass('Application restart, completed addition readback/history and closed-workout controls');
    const sourceAfter=verificationSource();assert.equal(sourceAfter.manifestHash,source.manifestHash);
    details={sourceAfter,candidateDrift,kgLogging:{acceptedMeasurement:kgCommand.intent.startingLoad,
      prefillPounds:'22.05',persistedMeasurement:kgStored.rows[0].result.measurement,
      acceptedAdditionHash:kgFact.contentHash,acceptedStartHash:kgAccepted.contentHash},
      postgres:(await admin.query('SELECT version()')).rows[0]};
    assert.equal(checks.length,24,'Expected all 24 assertion groups');
  } catch (error) {
    assertionError=redact(error instanceof Error?error.message:String(error));
    details={...details,firstFailure:{at:new Date().toISOString(),completedGroups:checks.length,pendingBrowserRequests:[...pendingBrowserRequests.values()],stack:redact(error instanceof Error?error.stack??error.message:String(error))}};
    console.error(`ASSERTIONS FAILED: ${assertionError}`);
  } finally {
    cleanup.push(...await cleanupSteps([
      {name:'server log',run:()=>writeFileSync(resolve(artifact,'server.log'),redact(serverLog))},
      {name:'browser shutdown',run:async()=>{
        if(browserProcess?.pid)browserPids=ownedBrowserProcesses(browserProfile);
        await browserContext?.close();
        // The installed Playwright launcher closes its native browser child
        // and internal profile; the controller removes our outer resource.
        await browserServer?.close();
      }},
      // Release the client transport independently of native server shutdown.
      {name:'browser connection',run:()=>browser?.close()},
      // A stalled graceful close cannot prevent explicit process termination or
      // any subsequent resource cleanup. Capture children before graceful exit.
      {name:'browser process tree',timeoutMs:60_000,run:async()=>{
        if(!browserProcess)return;
        const child=browserProcess;
        // Allow profile/database writers to finish before the force fallback.
        let graceTimer: ReturnType<typeof setTimeout> | undefined;
        const graceful=await Promise.race([browserCompletion,new Promise<undefined>(resolveGrace=>{graceTimer=setTimeout(()=>resolveGrace(undefined),5_000);})]);
        clearTimeout(graceTimer);
        details={...details,browserShutdown:{gracefulClose:graceful??null,capturedPids:browserPids}};
        // A closed child's PID can already belong to another process. Only
        // current Edge processes using this task profile may be terminated.
        await terminate(ownedBrowserProcesses(browserProfile));
        browserPids.forEach(pid=>ownedPids.delete(pid));ownedPids.delete(child.pid!);
      }},
      // Keep release and close observation independent of termination failure.
      {name:'browser pipes',run:()=>{for(const stream of browserProcess?.stdio??[])stream?.destroy();}},
      {name:'browser child close',timeoutMs:5_000,run:async()=>{
        if(!browserProcess)return;
        const result=await browserCompletion;assert(result&&!result.timedOut&&!result.error,'Browser child close was not observed');
        details={...details,browserShutdown:{...(details.browserShutdown as object??{}),observedClose:result}};
      }},
      {name:'browser log',run:()=>writeFileSync(resolve(artifact,'browser.log'),redact(browserLog))},
      {name:'Next process tree',timeoutMs:60_000,run:stopWeb},
      {name:'runtime client',run:()=>runtime?.$disconnect()},
      {name:'reader client',run:()=>reader?.$disconnect()},
      {name:'administrative pool',run:()=>admin?.end()},
      {name:'PostgreSQL container',timeoutMs:20_000,run:()=>{
        if(!containerCreated)return;
        const out=spawnSync('docker',['rm','-f',container],{windowsHide:true,encoding:'utf8',timeout:10_000});
        if(out.status!==0 && !out.stderr.includes('No such container'))throw new Error(out.error?.message??out.stderr);
        const inspect=spawnSync('docker',['container','inspect',container],{windowsHide:true,encoding:'utf8',timeout:5_000});
        assert(inspect.status!==0 && inspect.stderr.includes('No such container'),'Task PostgreSQL container survived or absence could not be verified');
      }},
      {name:'owned process survivor check',run:()=>assert.equal(ownedPids.size,0,'Task processes did not complete cleanup')},
    ]));
    cleanup=cleanup.map(r=>({...r,...(r.error?{error:redact(r.error)}:{})}));
    for(const result of cleanup)console.log(`CLEANUP ${result.status}: ${result.name}${result.error?`: ${result.error}`:''}`);
  }
  const exitCode=assertionError||cleanup.some(r=>r.status!=='passed')?1:0;
  details={...details,runtime:{node:process.version,arch:process.arch,platform:process.platform},browserLifecycle,browserNativeState:{exitCode:browserProcess?.exitCode,signalCode:browserProcess?.signalCode,killed:browserProcess?.killed,stdio:browserProcess?.stdio.map(s=>s?{destroyed:s.destroyed}:null)},services:{container,browserPid:browserProcess?.pid,ownedProcessIds:[...processIds],webOrigin,browserEndpoint,browserProfile,nextClosures}};
  console.log(`WORKER COMPLETE exitCode=${exitCode}`);
  // Teardown outcomes and verified process/container absence are recorded above.
  // Timed-out library promises must not retain this disposable runner indefinitely.
  process.exit(exitCode);
}

async function supervise() {
  assert(parseExactDisposableConfirmationArgs(process.argv.slice(2)).valid,'Expected exactly --confirm-disposable');
  const owner=randomUUID(),suffix=randomUUID().replaceAll('-','').slice(0,12);
  const artifact=resolve('artifacts/trainer2/add-exercise-evidence');mkdirSync(artifact,{recursive:true});
  const reportFile=resolve(artifact,'report.json'),profile=resolve(artifact,`browser-profile-${suffix}`),container=`trainer2-add-exercise-${suffix}`;
  assert(profile.startsWith(artifact+sep));
  const source=verificationSource();
  const workerOptions: SpawnOptions={
    env:{...authWebPlatformEnvironment(process.env),NODE_ENV:'test',TRAINER2_ADD_EXERCISE_CHILD:'1',TRAINER2_ADD_EXERCISE_OWNER:owner,TRAINER2_ADD_EXERCISE_SUFFIX:suffix},
    windowsHide:true,stdio:['inherit','inherit','inherit','ipc'],
  };
  const worker=spawn(process.execPath,[...process.execArgv,...process.argv.slice(1)],workerOptions);
  const completion=await waitForWorker(worker,20*60_000);
  let report: Record<string,unknown>={source,checks:[],assertions:{status:'incomplete'}};
  if(existsSync(reportFile)){
    const candidate=JSON.parse(readFileSync(reportFile,'utf8'));
    if(candidate.runId===owner&&candidate.source?.commit===source.commit&&candidate.source?.tree===source.tree&&candidate.source?.manifestHash===source.manifestHash)report=candidate;
  }
  // A Windows browser driver can retain mapped profile handles until its Node
  // worker exits. Cleanup belongs to this controller after observed close.
  const cleanup=await cleanupSteps([
    {name:'worker process tree',timeoutMs:60_000,run:async()=>{if(completion.timedOut&&worker.pid)await terminateOwnedProcesses(ownedProcessTree(worker.pid));}},
    {name:'orphan browser processes',timeoutMs:60_000,run:async()=>{
      await terminateOwnedProcesses(ownedBrowserProcesses(profile));
      assert.equal(ownedBrowserProcesses(profile).length,0,'Task browser processes survived cleanup');
    }},
    {name:'task PostgreSQL absence',timeoutMs:20_000,run:()=>{
      const inspect=spawnSync('docker',['container','inspect','--format','{{ index .Config.Labels "trainer2.add-exercise.owner" }}',container],{encoding:'utf8',windowsHide:true,timeout:5_000});
      if(inspect.status!==0){assert(inspect.stderr.includes('No such container'),'Cannot verify task container absence');return;}
      assert.equal(inspect.stdout.trim(),owner,'Refusing to remove an unowned container');
      const removed=spawnSync('docker',['rm','-f',container],{encoding:'utf8',windowsHide:true,timeout:10_000});assert.equal(removed.status,0,'Task container removal failed');
      const after=spawnSync('docker',['container','inspect',container],{encoding:'utf8',windowsHide:true,timeout:5_000});assert(after.status!==0&&after.stderr.includes('No such container'),'Task container survived');
    }},
    {name:'browser profile after worker exit',timeoutMs:30_000,run:async()=>{
      await rm(profile,{recursive:true,force:true,maxRetries:8,retryDelay:500});
      assert(!existsSync(profile),'Task browser profile survived cleanup');
    }},
  ]);
  report.worker={status:completion.timedOut?'timed-out':'completed',...completion};report.cleanup=[...(report.cleanup as CleanupResult[]??[]),...cleanup];
  report.retainedArtifacts={browserProfile:existsSync(profile)?profile:null};
  const failed=completion.timedOut||completion.exitCode!==0||cleanup.some(r=>r.status!=='passed')||(report.assertions as {status:string}).status!=='passed';
  for(const result of cleanup)console.log(`CONTROLLER CLEANUP ${result.status}: ${result.name}${result.error?`: ${result.error}`:''}`);
  process.once('exit',exitCode=>writeFileSync(reportFile,JSON.stringify({...report,runner:{status:'completed',exitCode}},null,2)));
  console.log(`RUNNER COMPLETE exitCode=${failed?1:0}`);process.exit(failed?1:0);
}
void (process.env.TRAINER2_ADD_EXERCISE_CHILD==='1'?main():supervise()).catch(e=>{console.error(e instanceof Error?e.message:'Add set verification failed');process.exitCode=1;});
