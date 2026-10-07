import { parseExactDisposableConfirmationArgs, validateDisposableDatabaseTargets } from '../src/lib/operations/test-environment-preflight';

import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { authWebPlatformEnvironment } from './trainer2/auth-web-environment';
import { cleanupSteps, ownedProcessTree, terminateOwnedProcesses, waitForWorker } from './trainer2/disposable-cleanup';
async function main() {
  if (!parseExactDisposableConfirmationArgs(process.argv.slice(2)).valid ||
    !validateDisposableDatabaseTargets({ environment: process.env, confirmed: true, requiredTargets: [] }).valid)
    throw new Error('Expected --confirm-disposable with no inherited database target');
  if (process.env.TRAINER2_EQUIPMENT_WORKER !== '1') {
    const artifact=resolve('artifacts/equipment-cleanup',`controller-${Date.now()}`);mkdirSync(artifact,{recursive:true});
    const child=spawn(process.execPath,[resolve('node_modules/tsx/dist/cli.mjs'),resolve('scripts/test-trainer2-equipment-recording.ts'),'--confirm-disposable'],
      {windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...authWebPlatformEnvironment(process.env),NODE_ENV:'test',TRAINER2_EQUIPMENT_WORKER:'1'}});
    const completion=waitForWorker(child,12*60_000);
    let log='';child.stdout!.on('data',v=>{log+=v;process.stdout.write(v);});child.stderr!.on('data',v=>{log+=v;process.stderr.write(v);});
    let captured:number[]=[];let captureError:unknown;
    try{captured=ownedProcessTree(child.pid!,undefined,row=>writeFileSync(resolve(artifact,'worker-ownership.json'),JSON.stringify(row,null,2)));}catch(error){captureError=String(error);}
    writeFileSync(resolve(artifact,'ownership-capture.json'),JSON.stringify({captured,error:captureError},null,2));
    const initialResult=await completion;let result=initialResult;
    const cleanup=await cleanupSteps([
      {name:'worker tree',timeoutMs:30_000,run:()=>terminateOwnedProcesses(captured)},
      {name:'worker pipes',run:()=>{for(const stream of child.stdio)stream?.destroy();}},
      {name:'worker completion',timeoutMs:5_000,run:async()=>{if(result.timedOut)result=await waitForWorker(child,4000);if(result.timedOut||result.error||result.exitCode===null)throw new Error('Worker completion unobserved');}},
    ]);
    writeFileSync(resolve(artifact,'worker.log'),log);
    writeFileSync(resolve(artifact,'worker-exit.json'),JSON.stringify({initialResult,observedCompletion:result},null,2));
    writeFileSync(resolve(artifact,'controller-cleanup.json'),JSON.stringify(cleanup,null,2));
    const fixturePath=log.match(/^EVIDENCE (.+)$/m)?.[1];
    const fixtureExit=fixturePath?JSON.parse(readFileSync(resolve(fixturePath,'fixture-worker-exit.json'),'utf8')):undefined;
    writeFileSync(resolve(artifact,'fixture-worker-exit.json'),JSON.stringify(fixtureExit??{error:'Fixture worker exit receipt unavailable'},null,2));
    process.exitCode=fixtureExit?.exitCode===0&&!captureError&&!initialResult.timedOut&&result.exitCode===0&&!result.timedOut&&!result.error&&cleanup.every(r=>r.status==='passed')?0:1;
    process.once('exit',exitCode=>writeFileSync(resolve(artifact,'controller-exit.json'),JSON.stringify({exitCode})));
    console.log('CONTROLLER EVIDENCE '+artifact);
    return;
  }
  const { runHomeProgramFixture } = await import('./trainer2/home-program-fixture');
  const { equipmentFixturePlan, equipmentJourney } = await import('./trainer2/equipment-journey');
  await runHomeProgramFixture(false, false, equipmentJourney, equipmentFixturePlan());
}
void main().catch(e => { console.error(e instanceof Error ? e.message : 'Equipment recording verification failed'); process.exitCode = 1; });
