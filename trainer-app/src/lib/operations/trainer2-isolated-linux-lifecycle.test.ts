import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { isolatedLinuxJob, ownLinuxGroup, bounded } from '../../../scripts/trainer2/isolated-linux-lifecycle';

const env = { TRAINER2_ISOLATED_LINUX_JOB: '1', CI: 'true', GITHUB_ACTIONS: 'true',
  RUNNER_ENVIRONMENT: 'github-hosted', GITHUB_JOB: 'trainer2-combined-acceptance' };
function child(): ChildProcess {
  return Object.assign(new EventEmitter(), { pid: 12345, exitCode: null, signalCode: null }) as unknown as ChildProcess;
}
describe('isolated Linux fixture lifecycle (synthetic only)', () => {
  it('requires explicit hosted Linux job and preserves Windows default', () => {
    expect(isolatedLinuxJob('win32', {})).toBe(false);
    expect(isolatedLinuxJob('linux', env)).toBe(true);
    for (const key of Object.keys(env)) {
      expect(() => isolatedLinuxJob('linux', { ...env, [key]: undefined })).toThrow();
    }
    expect(() => isolatedLinuxJob('win32', env)).toThrow();
  });
  it('signals only its freshly spawned group once and observes actual close', async () => {
    const worker = child(); const calls: Array<[number, string | number]> = [];
    const owned = ownLinuxGroup(worker, (pid, signal) => {
      calls.push([pid, signal]);
      if (signal === 'SIGTERM') queueMicrotask(() => worker.emit('close', 0, null));
      else throw Object.assign(new Error('absent'), { code: 'ESRCH' });
    });
    expect(await owned.stop()).toEqual({ exitCode: 0, signal: null });
    expect(calls).toEqual([[-12345, 'SIGTERM'], [-12345, 0]]);
    await expect(owned.stop()).rejects.toThrow('already attempted');
  });
  it('refuses signaling an exited leader', async () => {
    const worker = child(); Object.defineProperty(worker, 'exitCode', { value: 1 });
    const owned = ownLinuxGroup(worker, () => { throw new Error('must not signal'); });
    await expect(owned.stop()).rejects.toThrow('Leader already exited');
  });
  it('does not escalate when the owned group remains', async () => {
    const worker = child(); const calls: Array<string | number> = [];
    const owned = ownLinuxGroup(worker, (_, signal) => {
      calls.push(signal); if (signal === 'SIGTERM') worker.emit('close', 0, null);
    });
    await expect(owned.stop()).rejects.toThrow('group remains');
    expect(calls).toEqual(['SIGTERM', 0]);
  });
  it('bounds unresolved completion without process operations', async () => {
    await expect(bounded(new Promise(() => {}), 1)).rejects.toThrow('timed out');
  });
});
