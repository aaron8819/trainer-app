import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { cleanupSteps, ownedProcessTree, processAlive, terminateOwnedProcesses, waitForWorker } from '../../../scripts/trainer2/disposable-cleanup';

describe('Trainer2 disposable cleanup', () => {
  it.skipIf(process.platform!=='win32')('discovers an orphan after its task root exits', async () => {
    const child=spawn(process.execPath,['-e',`const {spawn}=require('node:child_process'); const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',detached:true,windowsHide:true});child.unref();process.stdout.write(String(child.pid)+'\\n',()=>process.exit(0));`],{windowsHide:true,stdio:['ignore','pipe','pipe']});
    const completion=waitForWorker(child,5_000);
    const orphan=await new Promise<number>((resolve,reject)=>{child.stdout.once('data',v=>resolve(Number(String(v).trim())));child.once('error',reject);});
    try {
      expect((await completion).exitCode).toBe(0);
      expect(processAlive(orphan)).toBe(true);
      expect(ownedProcessTree(child.pid!)).toContain(orphan);
      await terminateOwnedProcesses([orphan]);expect(processAlive(orphan)).toBe(false);
    }finally{await terminateOwnedProcesses([child.pid!,orphan]);}
  },15_000);
  it('returns a worker spawn failure without an unhandled error or pending wait', async () => {
    const child=spawn(process.execPath+'-trainer2-missing',[],{windowsHide:true,stdio:'ignore'});
    expect(await waitForWorker(child,5_000)).toMatchObject({exitCode:null,timedOut:false,error:expect.stringContaining('ENOENT')});
  });
  it('observes actual worker exit and preserves a failed exit code', async () => {
    const child=spawn(process.execPath,['-e','process.exit(7)'],{windowsHide:true,stdio:'ignore'});
    try {
      expect(await waitForWorker(child,5_000)).toEqual({exitCode:7,signal:null,timedOut:false});
      expect(processAlive(child.pid!)).toBe(false);
    } finally {await terminateOwnedProcesses([child.pid!]);}
  }, 10_000);
  it('continues after stalled, failed and late-rejecting cleanup without claiming success', async () => {
    const reached: string[] = [];
    const results = await cleanupSteps([
      { name: 'stalled browser', timeoutMs: 20, run: () => new Promise(() => {}) },
      { name: 'failed client', run: () => { throw new Error('disconnect failed'); } },
      { name: 'late rejection', timeoutMs: 20, run: () => new Promise((_, reject) => setTimeout(() => reject(new Error('late')), 40)) },
      { name: 'server', run: () => { reached.push('server'); } },
      { name: 'postgres', run: () => { reached.push('postgres'); } },
    ]);
    expect(results.map(r => r.status)).toEqual(['timed-out', 'failed', 'timed-out', 'passed', 'passed']);
    expect(reached).toEqual(['server', 'postgres']);
    await new Promise(resolve => setTimeout(resolve, 50));
  });

  it('terminates an actual task-owned root and child even after stalled cleanup', async () => {
    const child = spawn(process.execPath, ['-e', `const {spawn}=require('node:child_process'); const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'}); console.log(child.pid); setInterval(()=>{},1000);`], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const descendant = await new Promise<number>((resolve, reject) => {
      child.stdout.once('data', data => resolve(Number(String(data).trim())));
      child.once('error', reject);
    });
    const pids = [child.pid!, descendant];
    try {
      expect(ownedProcessTree(child.pid!)).toEqual(expect.arrayContaining(pids));
      expect((await waitForWorker(child,20)).timedOut).toBe(true);
      const results = await cleanupSteps([
        { name: 'stalled graceful close', timeoutMs: 20, run: () => new Promise(() => {}) },
        { name: 'owned process termination', timeoutMs: 20_000, run: () => terminateOwnedProcesses(pids) },
      ]);
      expect(results.map(r => r.status)).toEqual(['timed-out', 'passed']);
      expect(pids.some(processAlive)).toBe(false);
    } finally { await terminateOwnedProcesses(pids); }
  }, 30_000);
});
