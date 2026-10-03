// @vitest-environment node
import { spawn } from 'node:child_process';
import * as childProcesses from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { browserProcessesForProfile, cleanupSteps, ownedProcessTree, processAlive, terminateOwnedProcesses, waitForWorker } from '../../../scripts/trainer2/disposable-cleanup';

vi.mock('node:child_process', async importOriginal => ({ ...await importOriginal<typeof childProcesses>() }));

describe('Trainer2 disposable cleanup', () => {
  it.skipIf(process.platform !== 'win32')('rejects surviving OS processes even when taskkill and the Node probe claim success', async () => {
    const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { windowsHide: true, stdio: 'ignore' });
    const nativeSpawn = childProcesses.spawnSync;
    const nativeKill = process.kill.bind(process);
    const spawnProbe = vi.spyOn(childProcesses, 'spawnSync').mockImplementation(((file: string, ...args: unknown[]) => {
      if (file === 'taskkill.exe') return { status: 0, signal: null, stdout: 'pretend success', stderr: '', pid: 0, output: [] };
      return Reflect.apply(nativeSpawn, childProcesses, [file, ...args]);
    }) as typeof childProcesses.spawnSync);
    const killProbe = vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
      if (pid === child.pid && signal === 0) throw Object.assign(new Error('Missed by native probe'), { code: 'ESRCH' });
      return nativeKill(pid, signal);
    });
    const receipts: Record<string, unknown>[] = [];
    try {
      await expect(terminateOwnedProcesses([child.pid!], result => receipts.push(result))).rejects.toThrow('survived OS termination');
      expect(receipts[0]).toMatchObject({ status: 0, stdout: 'pretend success' });
      expect(receipts[1]).toMatchObject({ survivors: [expect.objectContaining({ ProcessId: child.pid })] });
    } finally {
      spawnProbe.mockRestore(); killProbe.mockRestore();
      await terminateOwnedProcesses([child.pid!]);
    }
  }, 30_000);
  it('selects profile-owned orphans without admitting a reused PID or adjacent profile', () => {
    const profile = 'C:\\task with spaces\\browser-profile-123';
    expect(browserProcessesForProfile([
      { pid: 10, name: 'node.exe', command: 'node unrelated.js' },
      { pid: 11, name: 'msedge.exe', command: `msedge --user-data-dir="${profile}\\playwright_chromiumdev_profile-new" --type=renderer` },
      { pid: 12, name: 'msedge.exe', command: `msedge --user-data-dir="${profile}-other"` },
      { pid: 13, name: 'powershell.exe', command: `echo --user-data-dir="${profile}"` },
      { pid: 14, name: 'msedge.exe' },
    ], profile)).toEqual([11]);
    expect(() => browserProcessesForProfile([], 'relative-profile')).toThrow('absolute');
  });
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
      const nativeKill = process.kill.bind(process);
      const probe = vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
        if (pid === child.pid && signal === 0) throw Object.assign(new Error('Native probe misses root'), { code: 'ESRCH' });
        return nativeKill(pid, signal);
      });
      try {
        expect(ownedProcessTree(child.pid!)).toEqual(expect.arrayContaining(pids));
      } finally { probe.mockRestore(); }
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
