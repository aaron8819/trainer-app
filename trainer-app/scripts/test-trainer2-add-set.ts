import assert from 'node:assert/strict';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { spawnSync, spawn } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { chromium } from '@playwright/test';
import { createDraft, readDraft } from '../src/lib/api/trainer2/planning';
import { activatePlan } from '../src/lib/api/trainer2/activation';
import { startOccurrence, readExecution } from '../src/lib/api/trainer2/execution';
import { previewExerciseSwap, swapExercise } from '../src/lib/api/trainer2/exercise-swap';
import { addSet } from '../src/lib/api/trainer2/add-set';
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


async function main() {
  assert(parseExactDisposableConfirmationArgs(process.argv.slice(2)).valid, 'Expected exactly --confirm-disposable');
  const suffix = randomUUID().replaceAll('-', '').slice(0,12), container = `trainer2-add-set-${suffix}`, database = `trainer2_disposable_add_set_${suffix}`;
  const password = randomUUID(), rolePassword = randomUUID(), accountId = randomUUID(), sessionId = randomUUID(), secret = randomBytes(32).toString('base64url');
  const artifact = resolve('artifacts/trainer2/add-set-evidence'); mkdirSync(artifact, { recursive: true });
  const source = verificationSource(), checks: string[] = [];
  const command = (exe: string, args: string[], env?: NodeJS.ProcessEnv) => {
    const out = spawnSync(exe,args,{ env, encoding:'utf8', windowsHide:true, maxBuffer:10_000_000 });
    if (out.status !== 0) throw new Error(`Disposable command failed: ${exe} ${args.filter(a => !a.includes('postgresql:')).join(' ')}\n${out.stderr.replaceAll(password,'[secret]').replaceAll(rolePassword,'[secret]')}`);
    return out.stdout;
  };
  const pass = (name: string) => { checks.push(name); console.log(`PASS ${name}`); };
  let admin: Pool | undefined, runtime: PrismaClient | undefined, reader: PrismaClient | undefined, server: ReturnType<typeof spawn> | undefined;
  let serverLog='';
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  const stopWeb = async () => { if (server?.pid && server.exitCode === null) {
    spawnSync('taskkill',['/PID',String(server.pid),'/T','/F'],{ windowsHide:true });
    for(let i=0;server.exitCode===null && i<50;i++) await new Promise(r=>setTimeout(r,100));
    assert(server.exitCode!==null,'Task server failed to stop');
  } server=undefined; };
  try {
    command('docker',['run','--pull=never','--rm','-d','--name',container,'-e',`POSTGRES_PASSWORD=${password}`,'-e',`POSTGRES_DB=${database}`,'-p','127.0.0.1::5432','postgres:17-alpine']);
    for(let i=0;i<60;i++){ if(spawnSync('docker',['exec',container,'pg_isready','-U','postgres'],{ windowsHide:true }).status===0) break; await new Promise(r=>setTimeout(r,500)); }
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
    const upgradeName=`${database}_upgrade`;assert(/^trainer2_disposable_add_set_[a-f0-9]+_upgrade$/.test(upgradeName));
    await admin.query(`CREATE DATABASE "${upgradeName}"`);
    const upgradeUrl=(role:string)=>url(role).replace(`/${database}`,`/${upgradeName}`);
    const upgradeAdmin=new Pool({connectionString:upgradeUrl('postgres')}),upgradeDb=new PrismaClient({adapter:new PrismaPg({connectionString:upgradeUrl('trainer2_draft_runtime')})});
    try {
      for(const name of readdirSync('prisma/migrations').filter(n=>/^\d/.test(n)&&n!=='20261001010000_trainer2_add_set').sort())await upgradeAdmin.query(readFileSync(`prisma/migrations/${name}/migration.sql`,'utf8'));
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
      const addedForeignKeys=['Trainer2SetAddition_accountId_executionId_fkey','Trainer2SetAddition_accountId_actionId_fkey'].map(name=>`unexpected-statement:ALTER TABLE \"Trainer2SetAddition\" DROP CONSTRAINT \"${name}\"`);
      assert.deepEqual(candidateDrift.issues,[...baselineDrift.issues,...addedForeignKeys].sort());
      assert.deepEqual(candidateDrift.intentionalDatabaseOnlyExtensions,baselineDrift.intentionalDatabaseOnlyExtensions);
      pass('Schema drift equals baseline plus declared addition account foreign keys; protected finisher extensions unchanged');
      const before=(await upgradeAdmin.query('SELECT to_jsonb(r) AS row FROM "Trainer2SetResultRevision" r')).rows;
      await upgradeAdmin.query(readFileSync('prisma/migrations/20261001010000_trainer2_add_set/migration.sql','utf8'));await upgradeAdmin.query(grants.slice(boundary));
      assert.deepEqual((await upgradeAdmin.query('SELECT to_jsonb(r) AS row FROM "Trainer2SetResultRevision" r')).rows,before);
      assert.deepEqual((await upgradeAdmin.query('SELECT * FROM "Trainer2Execution" WHERE "id"=$1',[upgradeId])).rows[0],startRow);
      const upgraded=await validateExecutionRead(await readExecution(upgradeDb,principal,upgradeId),accountId,upgradeId);
      assert.equal(upgraded.additions!.length,0);assert.equal((await addSet(upgradeDb,principal,addition(upgraded))).outcome.status,'Accepted');
      assert.deepEqual((await upgradeAdmin.query('SELECT to_jsonb(r) AS row FROM "Trainer2SetResultRevision" r')).rows,before);
      pass('Populated baseline upgrade preserves START and existing evidence; addition works after incremental grants');
    } finally {await upgradeDb.$disconnect();await upgradeAdmin.end();}
    const webPort=42000+Math.floor(Math.random()*10000),base=`http://127.0.0.1:${webPort}`;
    const webEnv:NodeJS.ProcessEnv={...authWebPlatformEnvironment(process.env),NODE_ENV:'development',TRAINER2_LOCAL_DRAFTS:'enabled',TRAINER2_OWNER_USER_ID:accountId,TRAINER2_APP_ORIGIN:base,
      TRAINER2_IDENTITY_CONNECTION_STRING:url('trainer2_identity_runtime'),TRAINER2_READ_CONNECTION_STRING:url('trainer2_draft_reader'),TRAINER2_WRITE_CONNECTION_STRING:url('trainer2_draft_runtime')};
    const launch=()=>{server=spawn(process.execPath,[resolve('node_modules/next/dist/bin/next'),'dev','--hostname','127.0.0.1','--port',String(webPort)],{env:webEnv,windowsHide:true,stdio:'pipe'});server.stdout?.on('data',v=>serverLog+=v);server.stderr?.on('data',v=>serverLog+=v);};
    const waitWeb=async()=>{for(let i=0;i<120;i++){try{if((await fetch(base+'/trainer2/auth')).ok)return;}catch{}assert(server?.exitCode===null);await new Promise(r=>setTimeout(r,500));}throw new Error('Task web did not start');};
    launch();await waitWeb();browser=await chromium.launch({channel:'msedge',headless:true});const context=await browser.newContext({viewport:{width:1360,height:1000},reducedMotion:'reduce'});
    await context.addCookies([{name:'__Host-trainer2-session',value:`${sessionId}.${secret}`,domain:'127.0.0.1',path:'/',secure:true,httpOnly:true,sameSite:'Strict'}]);
    const page=await context.newPage();const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(base+`/trainer2/dev/executions/${x.executionId}`);const card=page.getByRole('region',{name:'Active set',exact:true}),queue=page.getByRole('region',{name:'Exercise queue'});
    await card.getByLabel('Set 1 Actual reps').fill('8');await card.getByRole('button',{name:'Log set',exact:true}).click();await card.getByLabel('Set 2 Actual reps').waitFor();
    const timerKey=`trainer2-rest:${accountId}:${x.executionId}`,deadline=await page.evaluate(k=>localStorage.getItem(k),timerKey);assert(deadline);
    await card.getByLabel('Set 2 Actual reps').fill('13');
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
    assert.equal(await queue.getByRole('button',{name:'+ Add set',exact:true}).count(),3);
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
    await stopWeb();launch();await waitWeb();await page.goto(base+`/trainer2/dev/executions/${x.executionId}`,{waitUntil:'domcontentloaded'});assert.equal((await read(x.executionId)).results.filter(r=>r.result).length,2);
    await close(x);await page.reload();await page.getByRole('heading',{name:'Workout finished',exact:true}).waitFor();assert.equal(await page.getByText('Added during workout',{exact:true}).count(),3);
    assert.equal(await page.getByRole('button',{name:'+ Add set',exact:true}).count(),0);assert.deepEqual(errors,[]);
    await page.screenshot({path:resolve(artifact,'mobile-completed.png')});pass('Application restart, completed addition readback/history and closed-workout controls');
    const sourceAfter=verificationSource();assert.equal(sourceAfter.manifestHash,source.manifestHash);
    writeFileSync(resolve(artifact,'report.json'),JSON.stringify({source,sourceAfter,checks,candidateDrift,postgres:(await admin.query('SELECT version()')).rows[0]},null,2));
  } finally {
    writeFileSync(resolve(artifact,'server.log'),serverLog.replaceAll(password,'[secret]').replaceAll(rolePassword,'[secret]'));
    await browser?.close();await stopWeb();await runtime?.$disconnect();await reader?.$disconnect();await admin?.end();
    spawnSync('docker',['rm','-f',container],{windowsHide:true});
  }
}
void main().catch(e=>{console.error(e instanceof Error?e.message:'Add set verification failed');process.exitCode=1;});
