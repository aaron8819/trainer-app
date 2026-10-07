// @vitest-environment node
import { spawn } from 'node:child_process';
import * as childProcesses from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { browserProcessesForProfile, ownedProcessTree, terminateOwnedProcesses, waitForWorker, waitForWorkerAfterCleanup, cleanupSteps } from '../../../scripts/trainer2/disposable-cleanup';

vi.mock('node:child_process', async original=>({...await original<typeof childProcesses>()}));

describe('generation-qualified disposable cleanup', () => {
  it('continues after connection failure, stalled and late-rejecting cleanup', async () => {
    const reached: string[] = [];
    const results = await cleanupSteps([
      { name: 'connection', run: () => { throw new Error('connection failed'); } },
      { name: 'close', timeoutMs: 20, run: () => new Promise(() => {}) },
      { name: 'late', timeoutMs: 20, run: () => new Promise((_, reject) => setTimeout(() => reject(new Error('late')), 50)) },
      { name: 'server', run: () => { reached.push('server'); } },
      { name: 'database', run: () => { reached.push('database'); } },
    ]);
    expect(results.map(r => r.status)).toEqual(['failed','timed-out','timed-out','passed','passed']);
    expect(reached).toEqual(['server','database']);
    await new Promise(r => setTimeout(r, 60));
  });
  it('rejects numeric PIDs without a captured identity', async () => {
    await expect(terminateOwnedProcesses([2147483647])).rejects.toThrow('captured process identity');
  });
  it.skipIf(process.platform!=='win32')('retains sanitized failed OS diagnostics and continues cleanup',async()=>{
    const probe=vi.spyOn(childProcesses,'spawnSync').mockReturnValue({pid:123,status:null,signal:'SIGTERM',stdout:'private inventory command line',stderr:'postgresql://user:secret@localhost/db',error:new Error('observer failed'),output:[]} as ReturnType<typeof childProcesses.spawnSync>);
    try{
      const results=await cleanupSteps([
        {name:'inventory',run:()=>ownedProcessTree(2147483646)},
        {name:'remaining resource',run:()=>undefined},
      ]);
      expect(results[0]).toMatchObject({status:'failed',diagnostics:{status:null,signal:'SIGTERM',error:'observer failed',stdoutBytes:30}});
      expect(results[0].error).not.toContain('private inventory');expect(results[0].error).not.toContain('secret@');
      expect(results[0].diagnostics).toMatchObject({startedAt:expect.any(String),elapsedMs:expect.any(Number)});
      expect(results[1].status).toBe('passed');
    }finally{probe.mockRestore();}
  });
  it('observes actual worker completion and preserves failed exits', async () => {
    const child = spawn(process.execPath, ['-e','process.exit(7)'], { windowsHide:true, stdio:'ignore' });
    expect(await waitForWorker(child, 5000)).toEqual({exitCode:7,signal:null,timedOut:false});
  });
  it('keeps a timed-out worker failed while observing its later actual completion',async()=>{
    const child=spawn(process.execPath,['-e','setTimeout(()=>process.exit(3),100)'],{windowsHide:true,stdio:'ignore'});
    const first=await waitForWorker(child,20);expect(first.timedOut).toBe(true);
    const later=await waitForWorker(child,5000);expect(later).toEqual({exitCode:3,signal:null,timedOut:false});
    expect(first.timedOut).toBe(true);expect(await waitForWorker(child,20)).toEqual(later);
  });
  it('records spawn failure', async () => {
    const child = spawn(process.execPath+'-missing', [], {windowsHide:true,stdio:'ignore'});
    expect(await waitForWorker(child,5000)).toMatchObject({timedOut:false,error:expect.stringContaining('ENOENT')});
  });
  it.skipIf(process.platform!=='win32')('captures late descendants and preserves an unrelated process', async () => {
    const unrelated = spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{windowsHide:true,stdio:'ignore'});
    const child = spawn(process.execPath,['-e',`setTimeout(()=>{const c=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true});console.log(c.pid)},4000);setInterval(()=>{},1000)`],{windowsHide:true,stdio:['ignore','pipe','pipe']});
    const completion = waitForWorker(child,30000);
    const unrelatedCompletion = waitForWorker(unrelated,30000);
    const descendant = new Promise<number>(r=>child.stdout.once('data',v=>r(Number(String(v).trim()))));
    let captured: number[] = [], unrelatedPids: number[] = [];
    try {
      captured = ownedProcessTree(child.pid!);
      unrelatedPids=ownedProcessTree(unrelated.pid!);
      const latePid = await descendant;
      await terminateOwnedProcesses(captured);
      expect((await completion).timedOut).toBe(false);
      expect(()=>process.kill(latePid,0)).toThrow();
      expect(()=>process.kill(unrelated.pid!,0)).not.toThrow();
      await terminateOwnedProcesses(unrelatedPids);
      expect((await unrelatedCompletion).timedOut).toBe(false);
    } finally {
      if(captured.length) await terminateOwnedProcesses(captured);
      if(unrelatedPids.length) await terminateOwnedProcesses(unrelatedPids);
      child.kill(); unrelated.kill();
    }
  },45000);
  it('does not let a blocking OS operation report success after its deadline', async () => {
    const results = await cleanupSteps([
      { name: 'blocking operation', timeoutMs: 20, run: () => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 40) },
      { name: 'remaining cleanup', run: () => undefined },
    ]);
    expect(results.map(result => result.status)).toEqual(['timed-out', 'passed']);
  });
  it('selects profile-owned orphans without admitting a reused PID or adjacent profile', () => {
    const profile = 'C:\\task with spaces\\browser-profile-123';
    expect(browserProcessesForProfile([
      { pid: 10, name: 'node.exe', command: 'node unrelated.js' },
      { pid: 11, name: 'msedge.exe', command: `msedge --user-data-dir="${profile}\\playwright_chromiumdev_profile-new" --type=renderer` },
      { pid: 12, name: 'msedge.exe', command: `msedge --user-data-dir="${profile}-other"` },
      { pid: 13, name: 'powershell.exe', command: `echo --user-data-dir="${profile}"` },
      { pid: 14, name: 'msedge.exe' },
    ], profile)).toEqual([11]);
    expect(browserProcessesForProfile([{pid:15,name:'chrome-headless-shell.exe',command:`browser --user-data-dir="${profile}\\inner"`}],profile,'chrome-headless-shell.exe')).toEqual([15]);
    expect(browserProcessesForProfile([{pid:15,name:'chrome-headless-shell.exe',command:`browser --user-data-dir="${profile}\\inner"`}],profile)).toEqual([]);
    expect(() => browserProcessesForProfile([],profile,'unrelated.exe')).toThrow('Unsupported');
    expect(() => browserProcessesForProfile([], 'relative-profile')).toThrow('absolute');
  });
  it.skipIf(process.platform!=='win32')('retains qualified orphan identities after the captured root exits',async()=>{
    const child=spawn(process.execPath,['-e',`const {spawn}=require('node:child_process');const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{windowsHide:true,stdio:'ignore',detached:true});c.unref();console.log(c.pid);process.stdin.once('data',()=>process.exit(0));`],{windowsHide:true,stdio:['pipe','pipe','pipe']});
    const completion=waitForWorker(child,30000);let captured:number[]=[];
    try{
      const orphan=await new Promise<number>(r=>child.stdout.once('data',v=>r(Number(String(v).trim()))));
      captured=ownedProcessTree(child.pid!);expect(captured).toContain(orphan);
      child.stdin.write('exit');expect((await completion).exitCode).toBe(0);
      expect(ownedProcessTree(child.pid!)).toContain(orphan);
      await terminateOwnedProcesses(captured);expect(()=>process.kill(orphan,0)).toThrow();
    }finally{if(captured.length)await terminateOwnedProcesses(captured);child.kill();}
  },45000);

  it.skipIf(process.platform!=='win32')('bounds a worker left alive after cleanup and then observes qualified completion',async()=>{
    const child=spawn(process.execPath,['-e',"console.log('cleanup');setInterval(()=>{},1000)"],{windowsHide:true,stdio:['ignore','pipe','pipe']});
    const cleanupDone=new Promise<void>(resolve=>child.stdout.once('data',()=>resolve()));
    const captured=ownedProcessTree(child.pid!);
    try{
      const first=await waitForWorkerAfterCleanup(child,cleanupDone,15000,20);
      expect(first).toMatchObject({timedOut:true,error:'Worker did not finish after cleanup'});
      await terminateOwnedProcesses(captured);
      const closed=await waitForWorker(child,5000);expect(closed.timedOut).toBe(false);expect(closed.exitCode).toBe(1);
      expect(first.timedOut).toBe(true);
    }finally{await terminateOwnedProcesses(captured);}
  },30000);

});
