import assert from 'node:assert/strict';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { spawnSync, spawn } from 'node:child_process';
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { chromium } from '@playwright/test';
import { createDraft, readDraft } from '../src/lib/api/trainer2/planning';
import { activatePlan } from '../src/lib/api/trainer2/activation';
import { startOccurrence, readExecution } from '../src/lib/api/trainer2/execution';
import { previewExerciseSwap, swapExercise } from '../src/lib/api/trainer2/exercise-swap';
import { saveSetResult } from '../src/lib/api/trainer2/set-results';
import { skipSet } from '../src/lib/api/trainer2/skip-set';
import { acceptCommand } from '../src/lib/api/trainer2/command';
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
import { verifyCatalogCoverage } from './trainer2/verify-catalog-coverage';

async function main() {
  assert(parseExactDisposableConfirmationArgs(process.argv.slice(2)).valid, 'Expected exactly --confirm-disposable');
  const suffix = randomUUID().replaceAll('-', '').slice(0,12), container = `trainer2-swap-${suffix}`, database = `trainer2_disposable_swap_${suffix}`;
  const password = randomUUID(), rolePassword = randomUUID(), accountId = randomUUID(), sessionId = randomUUID(), secret = randomBytes(32).toString('base64url');
  const artifact = resolve('artifacts/trainer2/swap-evidence'); mkdirSync(artifact, { recursive: true });
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
    let x=await start();const initial=canonicalJson(x.initial), c=await swap(x);
    const before=(await admin.query('SELECT count(*) FROM "Trainer2DurableAction"')).rows[0];await swap(x);assert.deepEqual((await admin.query('SELECT count(*) FROM "Trainer2DurableAction"')).rows[0],before);pass('Preview writes nothing');
    assert.equal((await swapExercise(db,principal,c)).outcome.status,'Accepted');assert.equal((await swapExercise(db,principal,c)).replayed,true);
    await assert.rejects(()=>swapExercise(db,principal,{...c,intent:{restoreOriginal:true}}),/ACTION_ID_COLLISION/);
    x=await read(x.executionId);assert.equal(canonicalJson(x.initial),initial);assert.equal(effectiveOccurrence(x).positions[0].exercise.name,'Leg Press');assert.equal(effectiveOccurrence(x).positions[0].targets[0].measurement,null);
    assert.equal((await swapExercise(db,principal,await swap(x,0,true))).outcome.status,'Accepted');x=await read(x.executionId);assert.deepEqual(effectiveOccurrence(x).positions[0],x.initial.occurrence.positions[0]);
    assert.equal((await swapExercise(db,principal,await swap(x))).outcome.status,'Accepted');x=await read(x.executionId);pass('Repeat, restore original load, no target drift, immutable START and exact retry');
    const result=await saveSetResult(db,principal,log(x));assert(result.outcome.status==='Accepted');const saved=(await read(x.executionId)).results[0];
    assert.equal(saved.assignment?.version,3);
    const correction={...envelope(),commandType:'CorrectSetResult',target:{executionId:x.executionId,targetId:saved.targetId},expected:{resultVersion:1,performedSetId:saved.performedSetId},intent:{result:null,reason:'Synthetic accidental entry'}};
    assert.equal((await saveSetResult(db,principal,correction)).outcome.status,'Accepted');assert.deepEqual((await read(x.executionId)).results[0].assignment,saved.assignment);
    await assert.rejects(async()=>swap(await read(x.executionId)),/EXERCISE_ALREADY_TOUCHED/);await close(x);
    assert.equal((await swapExercise(db,principal,c)).replayed,true);pass('Clearing retains assignment and locks swaps; retries recover after finish');
    async function race(first:()=>Promise<{outcome:{status:string}}>,second:()=>Promise<{outcome:{status:string}}>) {
      const lock=await admin!.connect();await lock.query('BEGIN');await lock.query('SELECT "accountId" FROM "Trainer2AccountTrainingState" WHERE "accountId"=$1 FOR UPDATE',[accountId]);
      const wait=async(n:number)=>{for(let i=0;i<200;i++){const q=await admin!.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'");if(q.rows[0].n>=n)return;await new Promise(r=>setTimeout(r,20));}throw new Error('Expected blocked race');};
      try {const a=first();await wait(1);const b=second();await wait(2);await lock.query('COMMIT');return Promise.all([a,b]);}finally{await lock.query('ROLLBACK');lock.release();}
    }
    for(const kind of ['log','skip','finish','same-position','independent-position']) for(const reverse of [false,true]) {
      const e=await start(), swapCommand=await swap(e), other=kind==='log'?log(e):kind==='skip'?skip(e):kind==='finish'?finish(e):await swap(e,kind==='independent-position'?1:0);
      const a=()=>swapExercise(db,principal,swapCommand), b=()=>kind==='log'?saveSetResult(db,principal,other):kind==='skip'?skipSet(db,principal,other):kind==='finish'?finishExecution(db,principal,other):swapExercise(db,principal,other);
      const outcomes=await race(reverse?b:a,reverse?a:b);
      assert.equal(outcomes[0].outcome.status,'Accepted');assert.equal(outcomes[1].outcome.status,kind==='independent-position'?'Accepted':'Conflict');
      if((await read(e.executionId)).lifecycle==='Open') await close(e);
      pass(`Controlled PostgreSQL ${kind} race ${reverse?'other first':'swap first'}`);
    }
    assert.equal(canonicalJson((await readDraft(readDb,principal,planId))!.intent),originalPlan);pass('Accepted plan and future occurrences unchanged');
    await assert.rejects(()=>readDb.$executeRaw`DELETE FROM "Trainer2ExerciseSwap"`);await assert.rejects(()=>db.$executeRaw`UPDATE "Trainer2ExerciseSwap" SET "version"=99`);
    await assert.rejects(async()=>swapExercise(db,{accountId:randomUUID(),sessionId},await swap(await start())),/ACCOUNT_MISMATCH|UNAUTHORIZED/);pass('Restricted reader, append-only runtime and cross-account denial');
    // Direct fabricated revisions cannot bypass the trusted command owner.
    const openFixture=(await db.trainer2Execution.findFirstOrThrow({where:{accountId,lifecycle:'Open'}})).id;
    const invalid=await swap(await read(openFixture));
    await assert.rejects(()=>db.$transaction(async tx=>{
      await tx.trainer2DurableAction.create({data:{accountId,actionId:invalid.actionId,...commandBinding(invalid)}});
      const p=await previewExerciseSwap(tx,principal,{...invalid.target,intent:invalid.intent});
      await tx.$executeRaw`INSERT INTO "Trainer2ExerciseSwap" ("accountId","executionId","positionId","version","actionId","instructionEpoch","contentHash","content","canonicalContent")
      VALUES (${accountId},${openFixture}::uuid,${invalid.target.positionId}::uuid,99,${invalid.actionId}::uuid,0,${p.effectiveHash},${JSON.stringify(p.content)}::jsonb,${canonicalJson(p.content)})`;
    }),/TRAINER2_SWAP_SOURCE/);pass('Direct fabricated noncontiguous revision rolls back');
    // Apply the additive migration to populated pre-swap evidence, without inventing assignments.
    const upgradeName=`${database}_upgrade`;
    assert(/^trainer2_disposable_swap_[a-f0-9]+_upgrade$/.test(upgradeName));await admin.query(`CREATE DATABASE "${upgradeName}"`);
    const upgradeUrl=(role:string)=>url(role).replace(`/${database}`,`/${upgradeName}`);
    const upgradeAdmin=new Pool({connectionString:upgradeUrl('postgres')});
    const upgradeDb=new PrismaClient({adapter:new PrismaPg({connectionString:upgradeUrl('trainer2_draft_runtime')})});
    try {
      for(const name of readdirSync('prisma/migrations').filter(n=>/^\d/.test(n)&&n!=='20260930010000_trainer2_exercise_swap').sort())
        await upgradeAdmin.query(readFileSync(`prisma/migrations/${name}/migration.sql`,'utf8'));
      const grants=readFileSync('prisma/trainer2-runtime-grants.sql','utf8');
      const boundary=grants.indexOf('GRANT SELECT ON "Trainer2ExerciseSwap"');assert(boundary>0);
      await upgradeAdmin.query(grants.slice(0,boundary).replace(/^CREATE ROLE .*;\r?\n/gm,''));
      await upgradeAdmin.query('INSERT INTO "User" ("id","email") VALUES ($1,$2)',[accountId,`${suffix}-upgrade@trainer2.invalid`]);
      await upgradeAdmin.query('INSERT INTO "Trainer2Owner" ("id","accountId","passcodeVerifier") VALUES (1,$1,$2)',[accountId,'synthetic-disabled']);
      await upgradeAdmin.query('INSERT INTO "Trainer2DeviceSession" ("id","ownerId","tokenHash","createdAt","renewedAt","expiresAt","absoluteExpiresAt","epoch") VALUES ($1,1,$2,now(),now(),now()+interval \'1 day\',now()+interval \'2 days\',0)',[sessionId,createHash('sha256').update(secret).digest('hex')]);
      const upgradePlan=randomUUID(), upgradeIntent={...intent,occurrences:intent.occurrences.slice(0,1)};
      assert.equal((await createDraft(upgradeDb,principal,{...envelope(),commandType:'CreateDraft',target:{planId:upgradePlan},expected:{},intent:upgradeIntent})).outcome.status,'Accepted');
      const head=(await readDraft(upgradeDb,principal,upgradePlan))!;
      assert.equal((await activatePlan(upgradeDb,principal,{...envelope(),commandType:'ActivatePlan',target:{planId:upgradePlan},expected:{planRevisionId:head.revisionId},intent:{reviewed:head.activation}})).outcome.status,'Accepted');
      const started=await startOccurrence(upgradeDb,principal,{...envelope(),commandType:'StartOccurrence',target:{planId:upgradePlan,occurrenceId:upgradeIntent.occurrences[0].id},expected:{planRevisionId:head.revisionId,instructionEpoch:0},intent:{}});
      assert(started.outcome.status==='Accepted');const upgradeId=started.outcome.result.executionId;
      const startRow=(await upgradeAdmin.query('SELECT * FROM "Trainer2Execution" WHERE "id"=$1',[upgradeId])).rows[0];
      const targetId=startRow.initialPrescription.positions[0].targets[0].id, performedSetId=randomUUID();
      const legacyCommand={...envelope(),commandType:'RecordSetResult',target:{executionId:upgradeId,targetId},expected:{resultVersion:0},intent:{result:{reps:{value:8,basis:'total'},measurement:{kind:'externalLoad',value:'12.50',unit:'lb',convention:'barbellTotal',zeroMeaning:'validZero'},rir:'2'}}};
      await acceptCommand(upgradeDb,principal,legacyCommand,legacyCommand,async tx=>{
        await tx.$executeRaw`INSERT INTO "Trainer2SetResultRevision" ("accountId","executionId","targetId","performedSetId","version","actionId","result") VALUES (${accountId},${upgradeId}::uuid,${targetId}::uuid,${performedSetId}::uuid,1,${legacyCommand.actionId}::uuid,${JSON.stringify(legacyCommand.intent.result)}::jsonb)`;
        return {...legacyCommand.target,performedSetId,version:1};
      });
      const baselineSchema=resolve(artifact,'baseline-schema.prisma');
      writeFileSync(baselineSchema,command('git',['show','252d63b8e22267c78bec6445d13329192e319191:trainer-app/prisma/schema.prisma']));
      const baselineDrift=schemaDiff(upgradeUrl('postgres'),baselineSchema);
      const expectedSwapDrops=['Trainer2ExerciseSwap_accountId_executionId_fkey','Trainer2ExerciseSwap_accountId_actionId_fkey'].map(name=>`unexpected-statement:ALTER TABLE \"Trainer2ExerciseSwap\" DROP CONSTRAINT \"${name}\"`);
      assert.deepEqual(candidateDrift.issues,[...baselineDrift.issues,...expectedSwapDrops].sort());
      assert.deepEqual(candidateDrift.intentionalDatabaseOnlyExtensions,baselineDrift.intentionalDatabaseOnlyExtensions);
      writeFileSync(resolve(artifact,'schema-drift.json'),JSON.stringify({baseline:baselineDrift,candidate:candidateDrift,expectedSwapDrops},null,2));
      pass('Schema drift matches baseline plus the two intentional swap account foreign keys; protected finisher extensions unchanged');
      const before=(await upgradeAdmin.query('SELECT to_jsonb(r) AS row FROM "Trainer2SetResultRevision" r')).rows;
      await upgradeAdmin.query(readFileSync('prisma/migrations/20260930010000_trainer2_exercise_swap/migration.sql','utf8'));
      await upgradeAdmin.query(grants.slice(boundary));
      assert.deepEqual((await upgradeAdmin.query('SELECT to_jsonb(r)-\'assignment\' AS row FROM "Trainer2SetResultRevision" r')).rows,before);
      assert.deepEqual((await upgradeAdmin.query('SELECT * FROM "Trainer2Execution" WHERE "id"=$1',[upgradeId])).rows[0],startRow);
      const upgraded=await validateExecutionRead(await readExecution(upgradeDb,principal,upgradeId),accountId,upgradeId);assert.equal(upgraded.results[0].assignment,undefined);
      const correction={...envelope(),commandType:'CorrectSetResult',target:{executionId:upgradeId,targetId},expected:{resultVersion:1,performedSetId},intent:{result:{reps:{value:9,basis:'total'},measurement:null,rir:null}}};
      assert.equal((await saveSetResult(upgradeDb,principal,correction)).outcome.status,'Accepted');assert.equal((await readExecution(upgradeDb,principal,upgradeId))?.results[0].assignment,undefined);
      pass('Populated baseline upgrade preserves original prescription, historical bytes and version-zero corrections');
    } finally {await upgradeDb.$disconnect();await upgradeAdmin.end();}
    // Browser uses a task-owned synthetic owner session, never existing cookies/settings.
    const webPort=42000+Math.floor(Math.random()*10000),base=`http://127.0.0.1:${webPort}`;
    const webEnv: NodeJS.ProcessEnv={...authWebPlatformEnvironment(process.env),NODE_ENV:'development',TRAINER2_LOCAL_DRAFTS:'enabled',TRAINER2_OWNER_USER_ID:accountId,TRAINER2_APP_ORIGIN:base,
      TRAINER2_IDENTITY_CONNECTION_STRING:url('trainer2_identity_runtime'),TRAINER2_READ_CONNECTION_STRING:url('trainer2_draft_reader'),TRAINER2_WRITE_CONNECTION_STRING:url('trainer2_draft_runtime')};
    const launch=()=>{server=spawn(process.execPath,[resolve('node_modules/next/dist/bin/next'),'dev','--hostname','127.0.0.1','--port',String(webPort)],{env:webEnv,windowsHide:true,stdio:'pipe'});server!.stdout?.on('data',v=>serverLog+=v);server!.stderr?.on('data',v=>serverLog+=v);};
    launch();for(let i=0;i<120;i++){try{if((await fetch(base+'/trainer2/auth')).ok)break;}catch{}assert(server?.exitCode===null,'Task web exited');await new Promise(r=>setTimeout(r,500));}
    browser=await chromium.launch({channel:'msedge',headless:true});const context=await browser.newContext({viewport:{width:1360,height:1000},reducedMotion:'reduce'});
    await context.addCookies([{name:'__Host-trainer2-session',value:`${sessionId}.${secret}`,domain:'127.0.0.1',path:'/',secure:true,httpOnly:true,sameSite:'Strict'}]);
    const page=await context.newPage();const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
    const open=(await db.trainer2Execution.findFirstOrThrow({where:{accountId,lifecycle:'Open'}})).id;
    await page.goto(base+`/trainer2/dev/executions/${open}`);const card=page.getByRole('region',{name:'Active set',exact:true});await card.getByRole('button',{name:'Swap',exact:true}).click();
    const dialog=page.getByRole('dialog');await dialog.getByLabel('Search library').fill('Leg Press');await dialog.getByRole('button',{name:'Leg Press Machine',exact:true}).click();await dialog.getByRole('button',{name:'Confirm swap'}).waitFor();
    await page.screenshot({path:resolve(artifact,'desktop-preview.png')});await page.setViewportSize({width:390,height:844});await page.screenshot({path:resolve(artifact,'mobile-preview.png')});
    await dialog.getByRole('button',{name:'Close',exact:true}).click();assert.equal((await read(open)).swaps?.length,0);
    await card.getByRole('button',{name:'Swap',exact:true}).click();await dialog.getByRole('button',{name:'Leg Press Machine',exact:true}).click();await dialog.getByRole('button',{name:'Confirm swap'}).click();await page.getByRole('heading',{name:'Leg Press',exact:true}).waitFor();
    await page.reload();await page.getByRole('heading',{name:'Leg Press',exact:true}).waitFor();await page.screenshot({path:resolve(artifact,'mobile-confirmed.png')});
    // Start advisory rest on a different position, then change the untouched first slot.
    await page.getByRole('region',{name:'Exercise queue'}).getByRole('button',{name:/Barbell Back Squat, set 1, unrecorded/}).first().click();
    await card.getByLabel('Set 1 Actual reps').fill('8');await card.getByRole('button',{name:'Log set',exact:true}).click();await card.getByLabel('Set 2 Actual reps').waitFor();
    await page.getByRole('region',{name:'Exercise queue'}).getByRole('button',{name:/Leg Press, set 1, unrecorded/}).click();
    const deadline=await page.evaluate(()=>Object.entries(localStorage).find(([k])=>k.startsWith('trainer2-rest:'))?.[1]);assert(deadline);
    await card.getByLabel('Set 1 Actual reps').fill('9');
    await card.getByRole('button',{name:'Swap',exact:true}).click();await dialog.getByRole('button',{name:'Return to original',exact:true}).click();
    await dialog.getByRole('button',{name:'Close',exact:true}).click();assert.equal(await card.getByLabel('Set 1 Actual reps').inputValue(),'9');
    await card.getByRole('button',{name:'Swap',exact:true}).click();await dialog.getByRole('button',{name:'Return to original',exact:true}).click();
    const lost:unknown[]=[];await page.route('**/api/trainer2/executions/swap-exercise',async route=>{lost.push(route.request().postDataJSON());try { await route.fetch(); await route.abort('failed'); } catch { /* Reload can already handle an aborted intercepted request. */ }});
    page.once('dialog',d=>d.accept());await dialog.getByRole('button',{name:'Confirm swap'}).click();await dialog.getByRole('button',{name:'Check swap again',exact:true}).waitFor();
    await page.reload();await page.unroute('**/api/trainer2/executions/swap-exercise');
    // Inputs are locked while pending. Simulate a later retained draft arriving from another controller.
    await page.evaluate(()=>{
      const discard=Object.entries(sessionStorage).find(([k])=>k.startsWith('trainer2-swap:')&&k.endsWith(':discard'));
      if(!discard) throw new Error('Missing authorized discard snapshot');
      const [draftKey,raw]=Object.entries(JSON.parse(discard[1]) as Record<string,string>)[0];
      const draft=JSON.parse(raw);draft.form.reps='11';sessionStorage.setItem(draftKey,JSON.stringify(draft));
    });
    await card.getByRole('button',{name:'Check swap again',exact:true}).click();await page.getByRole('heading',{name:'Barbell Back Squat',exact:true}).waitFor();
    assert.equal(await card.getByLabel('Set 1 Actual reps').inputValue(),'11','Input edited after confirmation must survive recovery');
    assert(lost.length>=1);assert(lost.every(v=>canonicalJson(v)===canonicalJson(lost[0])));assert.equal((await read(open)).swaps?.length,2);
    assert.equal(await page.evaluate(()=>Object.entries(localStorage).find(([k])=>k.startsWith('trainer2-rest:'))?.[1]),deadline);pass('Unsaved cancel/discard, lost response exact recovery across reload, unchanged rest deadline');
    await card.getByRole('button',{name:'Review latest result',exact:true}).click();
    await card.getByRole('button',{name:'Use Barbell Back Squat for my retained input',exact:true}).click();
    await card.getByLabel('Set 1 Actual reps').fill('10');
    assert.equal((await swapExercise(db,principal,await swap(await read(open)))).outcome.status,'Accepted');
    await card.getByRole('button',{name:'Log set',exact:true}).click();await card.getByRole('button',{name:'Review latest result',exact:true}).waitFor();
    await card.getByRole('button',{name:'Review latest result',exact:true}).click();await page.getByRole('heading',{name:'Leg Press',exact:true}).waitFor();
    assert.equal(await card.getByLabel('Set 1 Actual reps').inputValue(),'10');
    await card.getByRole('button',{name:'Review latest result',exact:true}).click();await card.getByRole('button',{name:'Use Leg Press for my retained input',exact:true}).click();
    await card.getByRole('button',{name:'Log set',exact:true}).click();await card.getByLabel('Set 2 Actual reps').waitFor();
    const remote=await read(open);assert.equal(remote.results.find(r=>r.targetId===remote.initial.positions[0].targets[0].id)?.assignment?.version,3);
    pass('Remote change conflicts, retains stale input and requires explicit exercise reconciliation');
    await stopWeb();launch();await new Promise(r=>setTimeout(r,2000));await page.reload();await page.getByRole('heading',{name:'Leg Press',exact:true}).waitFor();assert.deepEqual(errors,[]);pass('Desktop/mobile preview, cancel, confirm, reload, application restart');
    await verifyCatalogCoverage(db, readDb, principal, page, base, artifact, pass);
    writeFileSync(resolve(artifact,'server.log'),serverLog.replaceAll(password,'[secret]').replaceAll(rolePassword,'[secret]'));
    const sourceAfter=verificationSource();assert.equal(sourceAfter.manifestHash,source.manifestHash,'Verification source changed during the run');
    writeFileSync(resolve(artifact,'report.json'),JSON.stringify({source,checks,sourceAfter,postgres:(await admin.query('SELECT version()')).rows[0]},null,2));
  } finally {
    writeFileSync(resolve(artifact,'server.log'),serverLog.replaceAll(password,'[secret]').replaceAll(rolePassword,'[secret]'));
    await browser?.close();await stopWeb();await runtime?.$disconnect();await reader?.$disconnect();await admin?.end();
    spawnSync('docker',['rm','-f',container],{windowsHide:true});
  }
}
void main().catch(e=>{console.error(e instanceof Error?e.message:'Swap verification failed');process.exitCode=1;});
