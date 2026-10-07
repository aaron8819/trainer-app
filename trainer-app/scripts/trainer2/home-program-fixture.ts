import type { DraftDocument } from '../../src/lib/trainer2-contracts/draft';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'node:net';
import { Pool } from 'pg';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { chromium, expect as baseExpect } from '@playwright/test';
import { createDraft, readDraft } from '../../src/lib/api/trainer2/planning';
import { activatePlan } from '../../src/lib/api/trainer2/activation';
import { readNextWorkout, startOccurrence, readExecution } from '../../src/lib/api/trainer2/execution';
import { skipOccurrence } from '../../src/lib/api/trainer2/skip-occurrence';
import { finishExecution } from '../../src/lib/api/trainer2/workout-finish';
import { advanceWeek } from '../../src/lib/api/trainer2/advance-week';
import { reviewedResults } from '../../src/lib/trainer2-contracts/workout-finish';
import { createHypertrophyPlan } from '../../src/lib/engine/trainer2/plan-builder';
import { saveSetResult } from '../../src/lib/api/trainer2/set-results';
import { executionPositions } from '../../src/lib/engine/trainer2/execution-targets';
import { expandWorkoutDefaults } from '../../src/lib/engine/trainer2/plan-builder';
import { makeVerifier } from '../../src/lib/api/trainer2/sessions';
import { authWebPlatformEnvironment } from './auth-web-environment';
import { verificationSource } from './verification-source';
import { captureBrowserOwnership, shutdownOwnedBrowser, cleanupSteps, runCleanupCommand, ownedProcessTree, terminateOwnedProcesses, waitForWorker, type BrowserOwnership } from './disposable-cleanup';
import { observeWebReadiness } from './web-readiness';
import { randomBytes } from 'node:crypto';

const expect=baseExpect.configure({timeout:30_000});

// Separate disposable fixture per invocation. Uses released owners, never configured targets.
export async function runHomeProgramFixture(preview: boolean, surfacesOnly = false, loggerJourney?: (context: { page: import('@playwright/test').Page; base: string; home: string; artifact: string; accountId: string; planId: string; executionId: string; pass: (value: string) => void; db: PrismaClient; reader: PrismaClient; principal: { accountId: string; sessionId: string } }) => Promise<void>, equipmentDraft?: DraftDocument) {
  const suffix=randomUUID().slice(0,8), container=`trainer2-home-program-${suffix}`, database=`trainer2_disposable_${suffix}`;
  const artifact=resolve(`artifacts/trainer2/${loggerJourney?'logger':'home-program'}-${preview?'preview':surfacesOnly?'surfaces':'verify'}-${suffix}`); mkdirSync(artifact,{recursive:true});
  const password=randomUUID(), accountId=randomUUID(), sessionId=randomUUID(), secret=randomBytes(32).toString('base64url'), principal={accountId,sessionId};
  const ownerLabel=randomUUID(), source=verificationSource(), checks:string[]=[], cleanup:unknown[]=[];
  let server:ChildProcess|undefined, browser:Awaited<ReturnType<typeof chromium.launch>>|undefined, admin:Pool|undefined, db:PrismaClient|undefined, reader:PrismaClient|undefined, created=false;
  let serverCompletion: ReturnType<typeof waitForWorker> | undefined, browserCompletion: ReturnType<typeof waitForWorker> | undefined;
  let serverPids: number[] = [];
  const recordProcessTree = (row: Record<string, unknown>) => writeFileSync(resolve(artifact, 'process-tree.jsonl'), JSON.stringify(row) + '\n', { flag: 'a' });
  let browserServer: Awaited<ReturnType<typeof chromium.launchServer>> | undefined, browserOwnership: BrowserOwnership | undefined;
  const recordBrowserTree = (row: Record<string, unknown>) => writeFileSync(resolve(artifact, 'browser-tree.jsonl'), JSON.stringify(row) + '\n', { flag: 'a' });
  writeFileSync(resolve(artifact,'source.json'),JSON.stringify(source,null,2));
  if(equipmentDraft)process.once('exit',exitCode=>writeFileSync(resolve(artifact,'fixture-worker-exit.json'),JSON.stringify({pid:process.pid,exitCode})));
  let serverLog='', base='', home='';let releaseRead=()=>{};let failure:unknown;
  const nativeBin=process.platform==='win32'&&existsSync('C:/Program Files/PostgreSQL/17/bin/pg_ctl.exe')?'C:/Program Files/PostgreSQL/17/bin':null;
  const nativeData=resolve(artifact,'postgres-data');let nativeStarted=false;
  const pass=(s:string)=>{checks.push(s);writeFileSync(resolve(artifact,'checks.json'),JSON.stringify({source,checks},null,2));console.log('PASS '+s);};
  const command=(exe:string,args:string[],env:NodeJS.ProcessEnv={...authWebPlatformEnvironment(process.env),NODE_ENV:'test'})=>{const out=spawnSync(exe,args,{env,windowsHide:true,encoding:'utf8',timeout:120_000,maxBuffer:5_000_000});assert.equal(out.status,0,`Fixture command failed: ${exe} ${args[0]}: ${out.error?.message??out.stderr.replaceAll(password,'[fixture-secret]')}`);return out.stdout.trim();};
  const accepted=<T>(r:{outcome:{status:string;result?:T}}):T=>{assert.equal(r.outcome.status,'Accepted');return r.outcome.result!;};
  const envelope=()=>({schemaVersion:1,actionId:randomUUID(),deviceId:randomUUID(),originatingAccountId:accountId,ownershipEpoch:0,dependsOn:[]});
  try {
    let port:string;
    if(nativeBin){
      port=String(await new Promise<number>((res,rej)=>{const probe=createServer();probe.once('error',rej);probe.listen(0,'127.0.0.1',()=>{const a=probe.address();assert(a&&typeof a!=='string');probe.close(e=>e?rej(e):res(a.port));});}));
      const passwordFile=resolve(artifact,'postgres-password.tmp');writeFileSync(passwordFile,password,{mode:0o600});
      try{command(resolve(nativeBin,'initdb.exe'),['-D',nativeData,'-U','postgres','--pwfile',passwordFile,'--auth-host=scram-sha-256','--auth-local=scram-sha-256','--encoding=UTF8','--locale=C']);}finally{unlinkSync(passwordFile);}
      nativeStarted=true;
      // PostgreSQL must not inherit captured pipes on Windows: descendants keep them open.
      const started=spawnSync(resolve(nativeBin,'pg_ctl.exe'),['-D',nativeData,'-l',resolve(artifact,'postgres.log'),'-o',`-h 127.0.0.1 -p ${port} -c timezone=UTC`,'-w','start'],{windowsHide:true,stdio:'ignore',timeout:90_000,env:{...authWebPlatformEnvironment(process.env),NODE_ENV:'test'}});
      assert.equal(started.status,0,'Native fixture PostgreSQL did not start; see postgres.log');
      const bootstrap=new Pool({connectionString:`postgresql://postgres:${password}@127.0.0.1:${port}/postgres`});
      try{await bootstrap.query(`CREATE DATABASE "${database}"`);}finally{await bootstrap.end();}
    }else{
      command('docker',['run','--pull=never','--rm','-d','--name',container,'--label',`trainer2.home-program.owner=${ownerLabel}`,'-e',`POSTGRES_PASSWORD=${password}`,'-e',`POSTGRES_DB=${database}`,'-p','127.0.0.1::5432','postgres:17-alpine']);created=true;
      for(let i=0;i<60;i++){if(spawnSync('docker',['exec',container,'pg_isready','-U','postgres'],{windowsHide:true}).status===0)break;await new Promise(r=>setTimeout(r,500));}
      port=command('docker',['port',container,'5432/tcp']).split(':').at(-1)!;
    }
    const url=(role:string)=>`postgresql://${role}:${password}@127.0.0.1:${port}/${database}`;
    command(process.execPath,[resolve('node_modules/prisma/build/index.js'),'migrate','deploy'],{...authWebPlatformEnvironment(process.env),DATABASE_URL:url('postgres'),DIRECT_URL:url('postgres'),NODE_ENV:'test'});
    admin=new Pool({connectionString:url('postgres')});
    // Match released Docker UTC: this adapter emits UTC timestamps without an offset.
    assert(['UTC','Etc/UTC'].includes((await admin.query("SELECT current_setting('TimeZone') AS timezone")).rows[0].timezone));
    await admin.query('BEGIN;'+readFileSync('prisma/trainer2-runtime-grants.sql','utf8')+'COMMIT;');
    for(const role of ['trainer2_identity_runtime','trainer2_draft_reader','trainer2_draft_runtime'])await admin.query(`ALTER ROLE ${role} LOGIN PASSWORD '${password}'`);
    await admin.query('INSERT INTO "User" ("id","email") VALUES ($1,$2)',[accountId,`${suffix}@trainer2.invalid`]);
    await admin.query('INSERT INTO "Trainer2Owner" ("id","accountId","passcodeVerifier") VALUES (1,$1,$2)',[accountId,await makeVerifier('trainer2-local-review')]);
    await admin.query('INSERT INTO "Trainer2DeviceSession" ("id","ownerId","tokenHash","createdAt","renewedAt","expiresAt","absoluteExpiresAt","epoch") VALUES ($1,1,$2,now(),now(),now()+interval \'1 day\',now()+interval \'2 days\',0)',[sessionId,createHash('sha256').update(secret).digest('hex')]);
    process.env.TRAINER2_OWNER_USER_ID=accountId;
    db=new PrismaClient({adapter:new PrismaPg({connectionString:url('trainer2_draft_runtime')})});
    reader=new PrismaClient({adapter:new PrismaPg({connectionString:url('trainer2_draft_reader')})});
    let intent=equipmentDraft ?? createHypertrophyPlan(); intent.name='Five-week hypertrophy · synthetic review';
    if (loggerJourney && !equipmentDraft) {
      const row = intent.builder!.workouts[3].rows[0];
      row.prescription.measurement = { kind: 'externalLoad', value: '60', unit: 'kg', convention: 'perImplement', zeroMeaning: 'validZero' };
      intent.builder!.workouts[1].rows[0].exercise = row.exercise;
      intent = expandWorkoutDefaults(intent);
    }
    // Keep template identity/inheritance valid; a separate authored plan exercises long names.
    const planId=randomUUID();accepted(await createDraft(db,principal,{...envelope(),commandType:'CreateDraft',target:{planId},expected:{},intent}));
    const head=(await readDraft(reader,principal,planId))!;if (!equipmentDraft) accepted(await activatePlan(db,principal,{...envelope(),commandType:'ActivatePlan',target:{planId},expected:{planRevisionId:head.revisionId},intent:{reviewed:head.activation}}));
    const start=async(index:number)=>accepted(await startOccurrence(db!,principal,{...envelope(),commandType:'StartOccurrence',target:{planId,occurrenceId:intent.occurrences[index].id},expected:{planRevisionId:head.revisionId,instructionEpoch:0},intent:{}}));
    const finish=async(id:string)=>accepted(await finishExecution(db!,principal,{...envelope(),commandType:'FinishExecution',target:{executionId:id},expected:reviewedResults((await readExecution(reader!,principal,id))!),intent:{acknowledgeUnrecorded:true}}));
    const skip=async(index:number)=>accepted(await skipOccurrence(db!,principal,{...envelope(),commandType:'SkipOccurrence',target:{planId,occurrenceId:intent.occurrences[index].id},expected:{planRevisionId:head.revisionId,acceptedSequence:(await readNextWorkout(reader!,principal,planId)).acceptedSequence},intent:{}}));
    const advance=async()=>{const next=await readNextWorkout(reader!,principal,planId);return accepted(await advanceWeek(db!,principal,{...envelope(),commandType:'AdvanceWeek',target:{planId},expected:{planRevisionId:head.revisionId,acceptedSequence:next.acceptedSequence,weekIndex:next.week.index,firstOccurrenceId:next.week.firstOccurrenceId},intent:{}}));};
    let open: { executionId: string } | null = null;
    if (!equipmentDraft) {
      const first=await start(0);await finish(first.executionId);
      if (loggerJourney) {
        const prior = await start(1), read = (await readExecution(reader!, principal, prior.executionId))!;
        for (const target of executionPositions(read)[0].targets) accepted(await saveSetResult(db!, principal, { ...envelope(), commandType: 'RecordSetResult', target: { executionId: prior.executionId, targetId: target.id }, expected: { resultVersion: 0 }, intent: { result: { reps: { value: 10, basis: 'total' }, measurement: { kind: 'externalLoad', value: '60.123456', unit: 'kg', convention: 'perImplement', zeroMeaning: 'validZero' }, rir: '3' } } }));
        await finish(prior.executionId);
      } else await skip(1);
      open = preview || loggerJourney ? await start(3) : null;
    }
    const webPort=await new Promise<number>((res,rej)=>{const probe=createServer();probe.once('error',rej);probe.listen(0,'127.0.0.1',()=>{const a=probe.address();assert(a&&typeof a!=='string');probe.close(e=>e?rej(e):res(a.port));});});
    base=`http://127.0.0.1:${webPort}`;home=`${base}/trainer2/dev/drafts?planId=${planId}`;
    const readinessKey=randomBytes(32).toString('hex');
    server=spawn(process.execPath,[resolve('node_modules/next/dist/bin/next'),'dev','--webpack','--hostname','127.0.0.1','--port',String(webPort)],{windowsHide:true,stdio:'pipe',env:{...authWebPlatformEnvironment(process.env),NODE_ENV:'development',TRAINER2_LOCAL_DRAFTS:'enabled',TRAINER2_OWNER_USER_ID:accountId,TRAINER2_APP_ORIGIN:base,TRAINER2_IDENTITY_CONNECTION_STRING:url('trainer2_identity_runtime'),TRAINER2_READ_CONNECTION_STRING:url('trainer2_draft_reader'),TRAINER2_WRITE_CONNECTION_STRING:url('trainer2_draft_runtime'),TRAINER2_READINESS_KEY:readinessKey,NODE_OPTIONS:`--require="${resolve('scripts/trainer2/web-readiness-preload.cjs').replaceAll('\\','/')}"`}});
    serverCompletion = waitForWorker(server, 20 * 60_000);
    serverPids = ownedProcessTree(server.pid!,undefined,recordProcessTree);
    writeFileSync(resolve(artifact, 'resources.json'), JSON.stringify({ serverPid: server.pid, base, nativeData, nativePort: port }, null, 2));
    server.stdout?.on('data',d=>serverLog+=d);server.stderr?.on('data',d=>serverLog+=d);
    await observeWebReadiness(base,server,row=>writeFileSync(resolve(artifact,'readiness.jsonl'),JSON.stringify(row)+'\n',{flag:'a'}),{key:readinessKey});
    if(preview){
      const stopFile=resolve(artifact,'stop-preview');
      const coordinates={home,stopFile,launcherPid:process.pid,auth:`${base}/trainer2/auth`,passcode:'trainer2-local-review',databaseRuntime:nativeBin?'native PostgreSQL 17':'Docker PostgreSQL 17',container:created?container:null,nativeData:nativeBin?nativeData:null,serverPid:server.pid,accountId,planId,source};
      writeFileSync(resolve(artifact,'preview.json'),JSON.stringify(coordinates,null,2));
      console.log(`PREVIEW READY ${home}\nSign in at ${base}/trainer2/auth with synthetic passcode trainer2-local-review, then open Home.\nRetained preview: Enter or a stop-preview marker stops its own services; restart command creates fresh synthetic data.`);
      await new Promise<void>(res=>{
        const finish=()=>{clearInterval(timer);process.stdin.pause();res();};
        const timer=setInterval(()=>{if(existsSync(stopFile))finish();},500);
        process.once('SIGINT',finish);process.once('SIGTERM',finish);process.stdin.once('data',finish);process.stdin.resume();
      });
      return;
    }
    if (equipmentDraft && process.platform === 'win32') {
      // Use the existing qualified Windows teardown for this task's browser.
      browserServer = await chromium.launchServer({ headless: true, env: authWebPlatformEnvironment(process.env) });
      const child = browserServer.process();
      browserCompletion = waitForWorker(child, 20 * 60_000);
      const profile = child.spawnargs.find(arg => arg.startsWith('--user-data-dir='))?.slice('--user-data-dir='.length);
      assert(profile, 'Task browser profile is missing');
      browserOwnership = await captureBrowserOwnership(child, profile, recordBrowserTree);
      browser = await chromium.connect(browserServer.wsEndpoint());
    } else browser=await chromium.launch({headless:true,env:authWebPlatformEnvironment(process.env)});
    const context=await browser.newContext({viewport:{width:1280,height:900},reducedMotion:'reduce'});
    await context.addCookies([{name:'__Host-trainer2-session',value:`${sessionId}.${secret}`,domain:'127.0.0.1',path:'/',httpOnly:true,secure:true,sameSite:'Strict'}]);
    const page=await context.newPage(), errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(30_000);
    if (loggerJourney) {
      try { await loggerJourney({ page, base, home, artifact, accountId, planId, executionId: open?.executionId ?? '', pass, db: db!, reader: reader!, principal }); }
      catch (error) { await page.screenshot({ path: resolve(artifact, 'failed-page.png'), fullPage: true }).catch(() => {}); writeFileSync(resolve(artifact, 'failed-dom.txt'), await page.locator('body').innerText().catch(() => 'Unavailable')); throw error; }
      assert.deepEqual(errors, []);
      assert.equal(verificationSource().manifestHash, source.manifestHash, 'Source changed during verification');
      writeFileSync(resolve(artifact, 'report.json'), JSON.stringify({ source, checks, errors, home }, null, 2));
      console.log('EVIDENCE ' + artifact);
      return;
    }
    if(!surfacesOnly){
    await page.goto(home); await expect(page.getByRole('button',{name:'Start workout',exact:true})).toBeEnabled();
    let posts=0;page.on('request',r=>{if(r.method()==='POST')posts++;});
    await page.locator(`[data-occurrence-id="${intent.occurrences[2].id}"] button`).click();assert.equal(posts,0);
    const planned=page.getByRole('region',{name:'Planned workout'});for(const p of intent.occurrences[2].positions)await expect(planned.getByRole('heading',{name:p.exercise.name,exact:true})).toBeVisible();
    await expect(planned).toContainText('3 × 8–12 reps · 3 RIR');pass('Read-only selection and exact saved Lower B preview');
    for(const width of [1280,390,320]){
      await page.setViewportSize({width,height:844});await page.screenshot({path:resolve(artifact,`home-${width}.png`),fullPage:true});
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      await page.getByRole('link',{name:'View Program',exact:true}).click();await page.getByRole('button',{name:/^Week 5/}).click();
      await page.locator('[data-occurrence-id] summary').first().click();await expect(page.getByText(/Browsing Week 5/)).toBeVisible();
      assert.equal(posts,0);assert.equal((await readNextWorkout(reader,principal,planId)).week.index,0);
      await page.screenshot({path:resolve(artifact,`program-${width}.png`),fullPage:true});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      await page.getByRole('link',{name:'Back to training',exact:true}).click();await expect(page.getByRole('button',{name:'Start workout',exact:true})).toBeEnabled();
    }pass('Desktop, 390px and 320px Home/Program; week browsing never advances');
    await page.locator(`[data-occurrence-id="${intent.occurrences[0].id}"] button`).click();await expect(page.getByRole('link',{name:'View results',exact:true})).toBeVisible();
    await page.locator(`[data-occurrence-id="${intent.occurrences[1].id}"] button`).click();await expect(page.getByText(/Explicitly skipped. The saved prescription/)).toBeVisible();assert.equal(posts,0);pass('Finished and skipped workouts stay inspectable without writes');
    await page.locator(`[data-occurrence-id="${intent.occurrences[2].id}"] button`).click();
    await page.getByRole('button',{name:'Start workout',exact:true}).click();await page.waitForURL('**/trainer2/dev/executions/*');
    let next=await readNextWorkout(reader,principal,planId);assert.equal(next.execution?.initial.occurrence.id,intent.occurrences[2].id);
    await page.goto(home);await expect(page.getByRole('link',{name:`Resume ${intent.occurrences[2].name}`,exact:true})).toBeVisible();
    await page.locator(`[data-occurrence-id="${intent.occurrences[3].id}"] button`).click();await expect(page.getByRole('button',{name:'Start workout',exact:true})).toBeDisabled();
    await page.screenshot({path:resolve(artifact,'open-workout-320.png'),fullPage:true});pass('Explicit Start creates exact execution; authoritative Resume survives other selection');
    await finish(next.execution!.executionId);await skip(3);await page.reload();await expect(page.getByRole('button',{name:'Continue to next week',exact:true})).toBeEnabled();
    await page.screenshot({path:resolve(artifact,'completed-week-320.png'),fullPage:true});await page.getByRole('button',{name:'Continue to next week',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Week 2 of 5',exact:true})).toBeVisible();pass('Completed week remains visible; explicit advancement uses released server command');
    // Lost accepted Start response: retain exact envelope, reload in same tab, replay it.
    let original='';await page.route('**/api/trainer2/executions/start',async route=>{original=route.request().postData()!;await route.fetch();await route.abort();});
    await page.getByRole('button',{name:'Start workout',exact:true}).click();await expect(page.getByRole('button',{name:'Check again',exact:true})).toBeEnabled();
    await page.screenshot({path:resolve(artifact,'pending-recovery-320.png'),fullPage:true});await page.unroute('**/api/trainer2/executions/start');await page.reload();
    const recovered=page.waitForRequest(r=>r.method()==='POST'&&r.url().endsWith('/executions/start'));
    await page.getByRole('button',{name:'Check again',exact:true}).click();assert.equal((await recovered).postData(),original);await page.waitForURL('**/trainer2/dev/executions/*');pass('Lost accepted Start survives same-tab reload and replays original identity');
    next=await readNextWorkout(reader,principal,planId);await finish(next.execution!.executionId);for(let i=5;i<8;i++)await skip(i);await advance();
    for(let week=2;week<4;week++){for(let i=week*4;i<week*4+4;i++)await skip(i);await advance();}
    for(let i=16;i<20;i++)await skip(i);await page.goto(home);await expect(page.getByRole('button',{name:'Complete program',exact:true})).toBeEnabled();await page.screenshot({path:resolve(artifact,'final-week-320.png'),fullPage:true});
    await page.getByRole('button',{name:'Complete program',exact:true}).click();await expect(page.getByRole('heading',{name:'Program complete',exact:true})).toBeVisible();pass('Final week requires explicit completion and retains saved review');
    await page.route('**/api/trainer2/plans/*/next',route=>route.fulfill({status:503,contentType:'application/json',body:'{"error":"fixture"}'}));await page.reload();await expect(page.getByRole('button',{name:'Reload workout',exact:true})).toBeVisible();await page.screenshot({path:resolve(artifact,'error-320.png'),fullPage:true});await page.unroute('**/api/trainer2/plans/*/next');await page.getByRole('button',{name:'Reload workout',exact:true}).click();await expect(page.getByRole('heading',{name:'Program complete',exact:true})).toBeVisible();pass('Error is recoverable without generating a new action');
    }else{
      // Resolve setup through the released owner; the core journey has separate evidence.
      for(let week=0;week<5;week++){for(let i=week===0?2:week*4;i<week*4+4;i++)await skip(i);await advance();}
      await page.setViewportSize({width:320,height:844});
    }
    // A separately accepted authored program exercises long names and load semantics.
    const longIntent=structuredClone(intent);delete longIntent.builder;longIntent.name='Long-name prescription fixture';
    longIntent.occurrences=[longIntent.occurrences[0]];longIntent.stages=[longIntent.stages[0]];
    const longWorkout=longIntent.occurrences[0];
    // Identifiers are globally owned; a second authored plan needs fresh identities.
    longIntent.stages[0].id=randomUUID();longWorkout.id=randomUUID();longWorkout.stageId=longIntent.stages[0].id;
    delete longWorkout.workoutKey;delete longWorkout.weekOverride;delete longWorkout.overrides;
    longWorkout.positions.forEach(p=>{p.id=randomUUID();delete p.sourceKey;p.targets.forEach(t=>{t.id=randomUUID();});});
    const longName='Rear-foot-elevated Bulgarian split squat with an exceptionally long authored exercise name';
    longWorkout.positions[0].exercise={kind:'authoredDescription',name:longName,variation:'Per-side counts stay explicit. Assistance is not added load.'};
    longWorkout.positions[0].targets.forEach(t=>{t.rir='0';t.reps={min:8,max:12,basis:'perSide'};t.measurement={kind:'assistance',value:'40',unit:'lb',convention:'displayedAssistance',zeroMeaning:'noAssistance'};});
    const longId=randomUUID();accepted(await createDraft(db,principal,{...envelope(),commandType:'CreateDraft',target:{planId:longId},expected:{},intent:longIntent}));
    const longHead=(await readDraft(reader,principal,longId))!;accepted(await activatePlan(db,principal,{...envelope(),commandType:'ActivatePlan',target:{planId:longId},expected:{planRevisionId:longHead.revisionId},intent:{reviewed:longHead.activation}}));
    console.log('SETUP Accepted long-name authored program');
    const held=new Promise<void>(r=>{releaseRead=r;});
    await page.route(`${base}/api/trainer2/plans/${longId}/next`,async route=>{
      await held;try{await route.continue();}catch(error){
        // Navigation may already handle a canceled read; retain unexpected fixture errors.
        if(!(error instanceof Error&&error.message.includes('Route is already handled')))errors.push(String(error));
      }
    });
    await page.goto(`${base}/trainer2/dev/drafts?planId=${longId}`,{waitUntil:'domcontentloaded'});
    await expect(page.getByText('Loading workout…', {exact:true})).toBeVisible();await page.screenshot({path:resolve(artifact,'loading-320.png'),fullPage:true});releaseRead();await page.unrouteAll({behavior:'wait'});
    await expect(page.getByRole('button',{name:'Start workout',exact:true})).toBeEnabled();
    for(const width of [390,320]){await page.setViewportSize({width,height:844});await expect(page.getByRole('heading',{name:longName,exact:true})).toBeVisible();
      await expect(page.getByText(/8–12 reps per side.*0 RIR.*40 lb assistance/)).toBeVisible();
      await page.screenshot({path:resolve(artifact,`long-name-${width}.png`),fullPage:true});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
    await page.getByRole('link',{name:'View Program',exact:true}).focus();await page.keyboard.press('Tab');
    assert(await page.evaluate(()=>getComputedStyle(document.activeElement!).outlineStyle!=='none'));
    await page.getByRole('link',{name:'View Program',exact:true}).click();await page.locator('[data-occurrence-id] summary').first().click();await page.keyboard.press('End');
    const readClearance=()=>page.evaluate(()=>{const card=document.querySelector('[data-occurrence-id]')!,nav=document.querySelector('nav[aria-label="Trainer2 navigation"]')!;return {cardBottom:card.getBoundingClientRect().bottom,navTop:nav.getBoundingClientRect().top,scrollY,viewportHeight:innerHeight,scrollHeight:document.documentElement.scrollHeight,focus:document.activeElement?.tagName};});
    try{await expect.poll(async()=>{const r=await readClearance();return r.cardBottom<r.navTop;}).toBe(true);}finally{
      writeFileSync(resolve(artifact,'clearance.json'),JSON.stringify(await readClearance(),null,2));
      await page.screenshot({path:resolve(artifact,'program-final-card-320.png'),fullPage:false});
    }
    pass('Long authored names, per-side reps, zero RIR, assistance, loading, visible keyboard focus and final-card clearance');
    assert.deepEqual(errors,[]);assert.equal(verificationSource().manifestHash,source.manifestHash,'Source changed during fixture verification');writeFileSync(resolve(artifact,'report.json'),JSON.stringify({source,mode:surfacesOnly?'surfaces':'full',checks,errors,home},null,2));
    console.log('EVIDENCE '+artifact);
  } catch(error){
    failure=error;writeFileSync(resolve(artifact,'failure.json'),JSON.stringify({message:error instanceof Error?error.message:String(error),stack:error instanceof Error?error.stack:undefined,checks},null,2));throw error;
  } finally {
    // Always release an intercepted read, including when a loading assertion fails.
    releaseRead();
    cleanup.push(...await cleanupSteps([
      {name:'browser connection', run:()=>browser?.close()},
      {name:'browser',timeoutMs:35_000,run:async()=>{
        if (browserServer && browserOwnership) await shutdownOwnedBrowser(browserServer, browserOwnership, recordBrowserTree, { timeoutMs: 30_000 });
        else await browser?.close();
      }},
      {name:'browser worker completion',timeoutMs:5_000,run:async()=>{if(browserCompletion){const result=await browserCompletion;writeFileSync(resolve(artifact,'browser-worker-exit.json'),JSON.stringify(result,null,2));assert(!result.timedOut&&!result.error&&result.exitCode===0,'Browser worker did not exit successfully');}}},
      {name:'Next process tree',timeoutMs:30_000,run:async()=>{if(!serverPids.length&&server?.pid&&server.exitCode===null)serverPids=ownedProcessTree(server.pid,resolve('node_modules/next/dist/bin/next'));if(serverPids.length)await terminateOwnedProcesses(serverPids,recordProcessTree);}},
      {name:'Next pipes',run:()=>{for(const stream of server?.stdio??[])stream?.destroy();}},
      {name:'Next worker completion',timeoutMs:5_000,run:async()=>{if(serverCompletion){const result=await serverCompletion;writeFileSync(resolve(artifact,'server-worker-exit.json'),JSON.stringify(result,null,2));assert(!result.timedOut&&!result.error&&result.exitCode!==null,'Next worker exit unobserved');}}},
      {name:'runtime client',run:()=>db?.$disconnect()}, {name:'read client',run:()=>reader?.$disconnect()}, {name:'admin pool',run:()=>admin?.end()},
      {name:'native fixture cluster',timeoutMs:15_000,run:async()=>{if(nativeStarted&&nativeBin){const r=await runCleanupCommand(resolve(nativeBin,'pg_ctl.exe'),['-D',nativeData,'-m','fast','-w','stop'],12_000);recordProcessTree({event:'cluster-stop',...r,stdout:r.stdout.replaceAll(password,'[fixture-secret]'),stderr:r.stderr.replaceAll(password,'[fixture-secret]')});assert.equal(r.status,0);assert.equal(spawnSync(resolve(nativeBin,'pg_ctl.exe'),['-D',nativeData,'status'],{windowsHide:true}).status,3);}}},
      {name:'fixture container',timeoutMs:15_000,run:async()=>{if(created){const inspection=command('docker',['inspect','--format','{{ index .Config.Labels "trainer2.home-program.owner" }}',container]);assert.equal(inspection,ownerLabel);const r=await runCleanupCommand('docker',['rm','-f',container],10_000);assert.equal(r.status,0);assert.equal(spawnSync('docker',['inspect',container],{windowsHide:true}).status,1);}}},
    ]));
    writeFileSync(resolve(artifact,'assertions.json'),JSON.stringify({status:failure?'failed':'passed',checks,error:failure?String(failure):undefined},null,2));
    writeFileSync(resolve(artifact,'cleanup.json'),JSON.stringify(cleanup,null,2));writeFileSync(resolve(artifact,'server.log'),serverLog.replaceAll(password,'[fixture-secret]'));
    console.log('Fixture cleanup '+JSON.stringify(cleanup));if(!failure)assert(cleanup.every(r=>(r as {status:string}).status==='passed'));
  }
}
