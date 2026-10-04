import assert from 'node:assert/strict';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { spawnSync, spawn, type SpawnOptions } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync, existsSync, cpSync, readdirSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { createServer } from 'node:net';
import { Pool } from 'pg';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { chromium } from '@playwright/test';
import { authWebPlatformEnvironment } from './trainer2/auth-web-environment';
import { verificationSource } from './trainer2/verification-source';
import { inspectFinisherSchemaDiff } from '../src/lib/operations/finisher-schema-drift';
import { parseExactDisposableConfirmationArgs } from '../src/lib/operations/test-environment-preflight';
import { captureBrowserOwnership, cleanupSteps, ownedProcessTree, settleBrowserTree, shutdownOwnedBrowser, terminateOwnedProcesses, waitForWorker, type BrowserOwnership, type CleanupResult } from './trainer2/disposable-cleanup';
async function main() {
  assert(parseExactDisposableConfirmationArgs(process.argv.slice(2)).valid, 'Expected exactly --confirm-disposable');
  assert(process.send && process.env.TRAINER2_CURRENT_WEEK_OWNER,'Disposable worker must be supervised');
  const suffix=process.env.TRAINER2_CURRENT_WEEK_SUFFIX!;assert(/^[a-f0-9]{12}$/.test(suffix));
  const container = `trainer2-current-week-${suffix}`, database = `trainer2_disposable_current_week_${suffix}`;
  const password = randomUUID(), rolePassword = randomUUID(), accountId = randomUUID(), sessionId = randomUUID(), secret = randomBytes(32).toString('base64url');
  const artifact = resolve('artifacts/trainer2/current-week-evidence'); mkdirSync(artifact, { recursive: true });
  const source = verificationSource(), checks: string[] = [];
  let assertionsPassed=false;
  let assertionError: string | undefined, cleanup: CleanupResult[] = [], details: Record<string, unknown> = {};
  let containerCreated=false;
  const redact = (value: string) => value.replaceAll(password,'[secret]').replaceAll(rolePassword,'[secret]');
  // Written only during actual process exit, independently of assertion completion.
  process.once('exit', exitCode => {
    writeFileSync(resolve(artifact,'report.json'),JSON.stringify({runId:process.env.TRAINER2_CURRENT_WEEK_OWNER,source,...details,checks,
      assertions:{status:assertionError?'failed':assertionsPassed?'passed':'incomplete',error:assertionError},
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
  let browserOwnership: BrowserOwnership | undefined;
  let webOrigin: string | undefined, browserEndpoint: string | undefined;
  const browserExecutableName='chrome-headless-shell.exe';
  const browserProfile=resolve(artifact,`browser-profile-${suffix}`);
  assert(browserProfile.startsWith(artifact+sep),'Browser profile must stay inside task artifacts');
  let browserLog='';
  const browserLifecycle: Record<string,unknown>[] = [];
  const pendingBrowserRequests = new Map<unknown,{method:string;path:string}>();
  const ownedPids = new Set<number>();
  const processIds = new Set<number>();
  const track = (pid: number) => {ownedPids.add(pid);processIds.add(pid);};
  const capture = (pid: number,marker?:string) => { const pids=ownedProcessTree(pid,marker);pids.forEach(track);return pids; };
  const terminations: Record<string,unknown>[] = [];
  const recordBrowserTree = (result: Record<string,unknown>) => {
    terminations.push({at:new Date().toISOString(),...result});
    if(result.ownership){
      browserOwnership=result.ownership as BrowserOwnership;
      if(process.connected)process.send?.({kind:'browser-ownership',runId:process.env.TRAINER2_CURRENT_WEEK_OWNER,ownership:browserOwnership},()=>{});
    }
  };
  const terminate = async (pids: number[],timeoutMs?:number) => {await terminateOwnedProcesses(pids,result=>terminations.push({at:new Date().toISOString(),...result}),timeoutMs);pids.forEach(pid=>ownedPids.delete(pid));};
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
    command('docker',['run','--pull=never','--rm','-d','--name',container,'--label',`trainer2.current-week.owner=${process.env.TRAINER2_CURRENT_WEEK_OWNER}`,'-e',`POSTGRES_PASSWORD=${password}`,'-e',`POSTGRES_DB=${database}`,'-p','127.0.0.1::5432','postgres:17-alpine']);
    containerCreated=true;
    for(let i=0;i<60;i++){ if(spawnSync('docker',['exec',container,'pg_isready','-U','postgres'],{ windowsHide:true,timeout:5_000 }).status===0) break; await new Promise(r=>setTimeout(r,500)); }
    const port = command('docker',['port',container,'5432/tcp']).trim().split(':').at(-1)!;
    const url = (role: string) => `postgresql://${role}:${role==='postgres'?password:rolePassword}@127.0.0.1:${port}/${database}`;
    const migrationEnvironment:NodeJS.ProcessEnv={ ...authWebPlatformEnvironment(process.env), NODE_ENV:'test', DATABASE_URL:url('postgres'), DIRECT_URL:url('postgres') };
    const prior=resolve(artifact,'released-base'); mkdirSync(resolve(prior,'prisma/migrations'),{recursive:true});
    cpSync('prisma.config.ts',resolve(prior,'prisma.config.ts')); cpSync('prisma/schema.prisma',resolve(prior,'prisma/schema.prisma'));
    for(const name of readdirSync('prisma/migrations').filter(n=>n<'20261004010000_trainer2_current_week_selection'||n==='migration_lock.toml'))
      cpSync(resolve('prisma/migrations',name),resolve(prior,'prisma/migrations',name),{recursive:true});
    command(process.execPath,[resolve('node_modules/prisma/build/index.js'),'migrate','deploy','--config',resolve(prior,'prisma.config.ts')],migrationEnvironment);
    const schemaDiff=(connection:string,schema:string)=>inspectFinisherSchemaDiff(command(process.execPath,[resolve('node_modules/prisma/build/index.js'),'migrate','diff','--from-config-datasource','--to-schema',schema,'--script'],{...authWebPlatformEnvironment(process.env),NODE_ENV:'test',DATABASE_URL:connection,DIRECT_URL:connection}));
    const candidateDrift=schemaDiff(url('postgres'),'prisma/schema.prisma');
    details.schemaDrift=candidateDrift;
    pass('Released-base forward migration chain in disposable PostgreSQL');
    admin=new Pool({ connectionString:url('postgres') });
    await admin.query(`BEGIN; ${readFileSync('prisma/trainer2-runtime-grants.sql','utf8').split('\n').filter(l=>!l.includes('trainer2_current_week_eligible')).join('\n')} COMMIT;`);
    for(const role of ['trainer2_draft_runtime','trainer2_draft_reader','trainer2_identity_runtime']) await admin.query(`ALTER ROLE ${role} LOGIN PASSWORD '${rolePassword}'`);
    await admin.query('INSERT INTO "User" ("id","email") VALUES ($1,$2)',[accountId,`${suffix}@trainer2.invalid`]);
    await admin.query('INSERT INTO "Trainer2Owner" ("id","accountId","passcodeVerifier") VALUES (1,$1,$2)',[accountId,'synthetic-disabled']);
    await admin.query('INSERT INTO "Trainer2DeviceSession" ("id","ownerId","tokenHash","createdAt","renewedAt","expiresAt","absoluteExpiresAt","epoch") VALUES ($1,1,$2,now(),now(),now()+interval \'1 day\',now()+interval \'2 days\',0)',[sessionId,createHash('sha256').update(secret).digest('hex')]);
    process.env.TRAINER2_OWNER_USER_ID=accountId;
    runtime=new PrismaClient({ adapter:new PrismaPg({ connectionString:url('trainer2_draft_runtime') }) });
    reader=new PrismaClient({ adapter:new PrismaPg({ connectionString:url('trainer2_draft_reader') }) });
    const db=runtime, readDb=reader, principal={ accountId,sessionId };

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
    const launch=()=>{server=spawn(process.execPath,[resolve('node_modules/next/dist/bin/next'),'dev','--webpack','--hostname','127.0.0.1','--port',String(webPort)],{env:webEnv,windowsHide:true,stdio:'pipe'});serverCompletion=waitForWorker(server,20*60_000);if(server.pid)track(server.pid);server.stdout?.on('data',v=>serverLog+=v);server.stderr?.on('data',v=>serverLog+=v);};
    const waitWeb=async()=>{for(let i=0;i<120;i++){try{if((await fetch(base+'/trainer2/auth',{signal:AbortSignal.timeout(2_000)})).ok)return;}catch{}assert(server?.exitCode===null);await new Promise(r=>setTimeout(r,500));}throw new Error('Task web did not start');};
    launch();await waitWeb();
    // Use Playwright's locally installed, revision-pinned headless browser.
    // Its launcher owns the debugging pipes and internal disposable profile.
    mkdirSync(browserProfile);
    const priorTemp=process.env.TEMP,priorTmp=process.env.TMP;
    try {
      process.env.TEMP=browserProfile;process.env.TMP=browserProfile;
      browserServer=await chromium.launchServer({headless:true,timeout:30_000,
        args:['--disable-gpu','--disable-background-mode','--disable-crash-reporter'],
        env:authWebPlatformEnvironment(process.env)});
    } finally {
      if(priorTemp===undefined)delete process.env.TEMP;else process.env.TEMP=priorTemp;
      if(priorTmp===undefined)delete process.env.TMP;else process.env.TMP=priorTmp;
    }
    browserProcess=browserServer.process();
    assert.equal(browserProcess.spawnfile.split(/[\\/]/).at(-1),browserExecutableName,'Expected the pinned headless browser');
    details={...details,browserExecutable:browserProcess.spawnfile,browserExecutableName};
    if(browserProcess.pid)track(browserProcess.pid);
    browserLifecycle.push({event:'launched',at:new Date().toISOString(),pid:browserProcess.pid});
    browserProcess.on('exit',(exitCode,signal)=>browserLifecycle.push({event:'exit',at:new Date().toISOString(),exitCode,signal}));
    browserProcess.on('close',(exitCode,signal)=>browserLifecycle.push({event:'close',at:new Date().toISOString(),exitCode,signal}));
    browserProcess.on('error',error=>browserLifecycle.push({event:'error',at:new Date().toISOString(),error:error.message}));
    browserCompletion=waitForWorker(browserProcess,20*60_000);
    browserProcess.stdout?.on('data',v=>browserLog+=v);browserProcess.stderr?.on('data',v=>browserLog+=v);
    browserOwnership=await captureBrowserOwnership(browserProcess,browserProfile,recordBrowserTree);
    browserEndpoint=browserServer.wsEndpoint();
    browser=await chromium.connect(browserEndpoint,{timeout:30_000});const context=await browser.newContext({viewport:{width:1360,height:1000},hasTouch:true,reducedMotion:'reduce'});browserContext=context;
    context.on('request',request=>pendingBrowserRequests.set(request,{method:request.method(),path:new URL(request.url()).pathname}));
    context.on('requestfinished',request=>pendingBrowserRequests.delete(request));
    context.on('requestfailed',request=>pendingBrowserRequests.delete(request));
    await context.addCookies([{name:'__Host-trainer2-session',value:`${sessionId}.${secret}`,domain:'127.0.0.1',path:'/',secure:true,httpOnly:true,sameSite:'Strict'}]);
    const { verifyCurrentWeek } = await import('./trainer2/verify-current-week');
    details.currentWeek = await verifyCurrentWeek({ db, reader: readDb, admin, principal, context, base, artifact, pass,
      upgrade: async()=>{
        command(process.execPath,[resolve('node_modules/prisma/build/index.js'),'migrate','deploy'],migrationEnvironment);
        command(process.execPath,[resolve('node_modules/prisma/build/index.js'),'migrate','deploy'],migrationEnvironment);
        const upgradedDrift=schemaDiff(url('postgres'),'prisma/schema.prisma');
        assert.deepEqual(upgradedDrift,candidateDrift,'Current-week migration changed model/schema drift');
        details.upgradedSchemaDrift=upgradedDrift;
        await admin!.query('GRANT EXECUTE ON FUNCTION trainer2_current_week_eligible(text,uuid,jsonb,text) TO trainer2_draft_runtime');
      },
      restart: async () => { await stopWeb(); launch(); await waitWeb(); } });
    const sourceAfter = verificationSource();
    assert.equal(sourceAfter.manifestHash, source.manifestHash, 'Source changed during qualification');
    details.sourceAfter = sourceAfter;
    assertionsPassed = true;
  } catch (error) {
    assertionError=redact(error instanceof Error?error.message:String(error));
    details={...details,firstFailure:{at:new Date().toISOString(),completedGroups:checks.length,pendingBrowserRequests:[...pendingBrowserRequests.values()],stack:redact(error instanceof Error?error.stack??error.message:String(error))}};
    console.error(`ASSERTIONS FAILED: ${assertionError}`);
  } finally {
    cleanup.push(...await cleanupSteps([
      {name:'server log',run:()=>writeFileSync(resolve(artifact,'server.log'),redact(serverLog))},
      {name:'browser context',run:()=>browserContext?.close()},
      // Disconnect the client before native shutdown. Each close remains
      // independent so a failed context cannot skip the server close.
      {name:'browser connection',run:()=>browser?.close()},
      {name:'browser shutdown',run:async()=>{
        if(!browserServer)return;
        browserLifecycle.push({event:'shutdown-requested',at:new Date().toISOString()});
        if(!browserOwnership){
          await browserServer.close();
          throw new Error('Browser ownership capture failed; tree absence is unqualified');
        }
        const shutdown=await shutdownOwnedBrowser(browserServer,browserOwnership,recordBrowserTree);
        details={...details,browserShutdown:shutdown};
        browserLifecycle.push({event:'shutdown-completed',at:new Date().toISOString()});
      }},
      // A stalled graceful close cannot prevent explicit process termination or
      // any subsequent resource cleanup. Capture children before graceful exit.
      {name:'browser process tree',timeoutMs:60_000,run:async()=>{
        if(!browserProcess)return;
        const child=browserProcess;
        // Allow profile/database writers to finish before the force fallback.
        let graceTimer: ReturnType<typeof setTimeout> | undefined;
        const graceful=await Promise.race([browserCompletion,new Promise<undefined>(resolveGrace=>{graceTimer=setTimeout(()=>resolveGrace(undefined),5_000);})]);
        clearTimeout(graceTimer);
        assert(browserOwnership,'Missing qualified browser ownership');
        details={...details,browserShutdown:{...(details.browserShutdown as object??{}),childCompletion:graceful??null,capturedPids:browserOwnership.processes.map(p=>p.pid)}};
        await settleBrowserTree(browserOwnership,'terminate',recordBrowserTree);
        ownedPids.delete(child.pid!);
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
  details={...details,terminations,browserOwnership};
  details={...details,runtime:{node:process.version,arch:process.arch,platform:process.platform},browserLifecycle,browserNativeState:{exitCode:browserProcess?.exitCode,signalCode:browserProcess?.signalCode,killed:browserProcess?.killed,stdio:browserProcess?.stdio.map(s=>s?{destroyed:s.destroyed}:null)},services:{container,browserPid:browserProcess?.pid,ownedProcessIds:[...processIds],webOrigin,browserEndpoint,browserProfile,nextClosures}};
  console.log(`WORKER COMPLETE exitCode=${exitCode}`);
  // Teardown outcomes and verified process/container absence are recorded above.
  // Timed-out library promises must not retain this disposable runner indefinitely.
  process.exit(exitCode);
}

async function supervise() {
  assert(parseExactDisposableConfirmationArgs(process.argv.slice(2)).valid,'Expected exactly --confirm-disposable');
  const owner=randomUUID(),suffix=randomUUID().replaceAll('-','').slice(0,12);
  const artifact=resolve('artifacts/trainer2/current-week-evidence');mkdirSync(artifact,{recursive:true});
  const reportFile=resolve(artifact,'report.json'),profile=resolve(artifact,`browser-profile-${suffix}`),container=`trainer2-current-week-${suffix}`;
  assert(profile.startsWith(artifact+sep));
  const source=verificationSource();
  const workerOptions: SpawnOptions={
    env:{...authWebPlatformEnvironment(process.env),NODE_ENV:'test',TRAINER2_CURRENT_WEEK_CHILD:'1',TRAINER2_CURRENT_WEEK_OWNER:owner,TRAINER2_CURRENT_WEEK_SUFFIX:suffix},
    windowsHide:true,stdio:['inherit','inherit','inherit','ipc'],
  };
  const worker=spawn(process.execPath,[...process.execArgv,...process.argv.slice(1)],workerOptions);
  let browserOwnership: BrowserOwnership | undefined;
  worker.on('message',(message: {kind?:string;runId?:string;ownership?:BrowserOwnership})=>{
    const captured=message.ownership;
    if(message.kind==='browser-ownership'&&message.runId===owner&&captured?.profile===profile&&captured.runnerPid===worker.pid){browserOwnership=captured;}
  });
  const completion=await waitForWorker(worker,20*60_000);
  let report: Record<string,unknown>={source,checks:[],assertions:{status:'incomplete'}};
  if(existsSync(reportFile)){
    const candidate=JSON.parse(readFileSync(reportFile,'utf8'));
    if(candidate.runId===owner&&candidate.source?.commit===source.commit&&candidate.source?.tree===source.tree&&candidate.source?.manifestHash===source.manifestHash)report=candidate;
  }
  browserOwnership??=report.browserOwnership as BrowserOwnership|undefined;
  // A Windows browser driver can retain mapped profile handles until its Node
  // worker exits. Cleanup belongs to this controller after observed close.
  const controllerTerminations: Record<string,unknown>[] = [];
  const recordTermination=(result:Record<string,unknown>)=>controllerTerminations.push({at:new Date().toISOString(),...result});
  const cleanup=await cleanupSteps([
    {name:'worker process tree',timeoutMs:60_000,run:async()=>{if(completion.timedOut&&worker.pid)await terminateOwnedProcesses(ownedProcessTree(worker.pid),recordTermination);}},
    {name:'orphan browser processes',timeoutMs:60_000,run:async()=>{
      if(!browserOwnership){assert(!existsSync(profile),'Missing browser ownership receipt; refusing unqualified orphan cleanup');return;}
      await settleBrowserTree(browserOwnership,'terminate',recordTermination);
      await settleBrowserTree(browserOwnership,'observe',recordTermination);
    }},
    {name:'task PostgreSQL absence',timeoutMs:20_000,run:()=>{
      const inspect=spawnSync('docker',['container','inspect','--format','{{ index .Config.Labels "trainer2.current-week.owner" }}',container],{encoding:'utf8',windowsHide:true,timeout:5_000});
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
  report.worker={pid:worker.pid,status:completion.timedOut?'timed-out':'completed',...completion};report.cleanup=[...(report.cleanup as CleanupResult[]??[]),...cleanup];
  report.controllerPid=process.pid;
  report.controllerTerminations=controllerTerminations;
  report.retainedArtifacts={browserProfile:existsSync(profile)?profile:null};
  const failed=completion.timedOut||completion.exitCode!==0||cleanup.some(r=>r.status!=='passed')||(report.assertions as {status:string}).status!=='passed';
  for(const result of cleanup)console.log(`CONTROLLER CLEANUP ${result.status}: ${result.name}${result.error?`: ${result.error}`:''}`);
  process.once('exit',exitCode=>writeFileSync(reportFile,JSON.stringify({...report,runner:{status:'completed',exitCode}},null,2)));
  console.log(`RUNNER COMPLETE exitCode=${failed?1:0}`);process.exit(failed?1:0);
}
void (process.env.TRAINER2_CURRENT_WEEK_CHILD==='1'?main():supervise()).catch(e=>{console.error(e instanceof Error?e.message:'Current-week verification failed');process.exitCode=1;});
