// @vitest-environment node
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import * as childProcesses from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Writable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { captureBrowserOwnership, settleBrowserTree, shutdownOwnedBrowser, waitForWorker, type BrowserOwnership } from '../../../scripts/trainer2/disposable-cleanup';

vi.mock('node:child_process', async original => ({ ...await original<typeof childProcesses>() }));

const artifact = resolve('artifacts/trainer2/browser-tree-fix');
const pinnedFlags = ['--disable-gpu', '--disable-background-mode', '--disable-crash-reporter'];

describe.skipIf(process.platform !== 'win32')('qualified browser tree', () => {
  for (const force of [false, true]) {
    it(force ? 'initiates real server close, covers new unmarked descendants and forces the owned tree only' : 'preserves graceful native shutdown and independently observes the whole tree absent', async () => {
      mkdirSync(artifact, { recursive: true });
      // Keep the fixture below Windows path limits; every run gets a new root.
      const profile = mkdtempSync(resolve(artifact, 'p-'));
      const priorTemp = process.env.TEMP, priorTmp = process.env.TMP;
      let server: Awaited<ReturnType<typeof chromium.launchServer>> | undefined;
      let ownership: BrowserOwnership | undefined;
      const observations: Record<string, unknown>[] = [];
      let failure: string | undefined;
      let blockedCloseRequest = false;
      let restorePipe: (() => void) | undefined;
      let latePage: Promise<void> | undefined;
      let lateClient: Awaited<ReturnType<typeof chromium.connect>> | undefined;
      const unrelated = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { windowsHide: true, stdio: 'ignore' });
      const unrelatedClose = waitForWorker(unrelated, 45_000);
      try {
        process.env.TEMP = profile; process.env.TMP = profile;
        server = await chromium.launchServer({ headless: true, timeout: 30_000, args: pinnedFlags });
        if (priorTemp === undefined) delete process.env.TEMP; else process.env.TEMP = priorTemp;
        if (priorTmp === undefined) delete process.env.TMP; else process.env.TMP = priorTmp;
        const child = server.process();
        const completion = waitForWorker(child, 30_000);
        child.on('exit', (code, signal) => observations.push({ event: 'native-exit', code, signal }));
        child.on('close', (code, signal) => observations.push({ event: 'native-close', code, signal }));
        const browser = await chromium.connect(server.wsEndpoint());
        const context = await browser.newContext();
        const page = await context.newPage();
        await page.goto('data:text/html,<button>Fixture</button>');
        await page.getByRole('button', { name: 'Fixture' }).click();
        ownership = await captureBrowserOwnership(child, profile, result => observations.push(result));
        const initialPids = new Set(ownership.processes.map(row => row.pid));
        const initialRows = observations.at(-1)!.survivors as { pid: number; command: string }[];
        expect(initialRows.some(row => row.pid !== child.pid && !row.command.includes('--user-data-dir'))).toBe(true);
        await context.close(); await browser.close();

        if (force) {
          const pipe = child.stdio[3] as Writable;
          const originalWrite = pipe.write;
          // Call the real BrowserServer.close. Suppress only its Browser.close
          // transport message, so native shutdown stalls after initiation.
          pipe.write = function (this: Writable, ...args: Parameters<Writable['write']>) {
            if (String(args[0]).includes('"method":"Browser.close"')) {
              blockedCloseRequest = true;
              const callback = args.at(-1);
              if (typeof callback === 'function') callback();
              return true;
            }
            return Reflect.apply(originalWrite, this, args);
          } as Writable['write'];
          restorePipe = () => { pipe.write = originalWrite; };
        }
        const closeServer = server;
        const result = await shutdownOwnedBrowser(server, ownership, observation => {
          observations.push(observation);
          if (force && observation.event === 'server-close-initiated') {
            latePage = (async () => {
              lateClient = await chromium.connect(closeServer.wsEndpoint());
              const lateContext = await lateClient.newContext();
              const late = await lateContext.newPage();
              await late.goto('data:text/html,late-renderer');
            })();
            // Consume a late rejection even if native teardown fails first.
            void latePage.catch(() => {});
          }
        }, { graceMs: force ? 2_000 : 5_000 });
        if (latePage) await latePage;
        expect(result.forceFallback).toBe(force);
        expect(blockedCloseRequest).toBe(force);
        const native = await completion;
        expect(native.timedOut).toBe(false);
        expect(native.error).toBeUndefined();
        if (!force) expect(native.exitCode).toBe(0);
        expect(observations.some(row => row.event === 'native-close')).toBe(true);
        expect(() => process.kill(unrelated.pid!, 0)).not.toThrow();
        expect(ownership.processes.some(row => row.pid === unrelated.pid)).toBe(false);
        if (force) {
          const terminated = observations.flatMap(row => (row.terminated as {pid: number}[] | undefined) ?? []);
          expect(terminated.some(row => row.pid !== child.pid)).toBe(true);
          expect(ownership.processes.some(row => !initialPids.has(row.pid))).toBe(true);
          expect(observations.some(row => (row.survivors as {pid: number;command: string}[] | undefined)?.some(
            process => !initialPids.has(process.pid) && !process.command.includes('--user-data-dir')))).toBe(true);
        }
        await settleBrowserTree(ownership, 'observe', row => observations.push(row));
        expect(observations.at(-1)?.survivors).toEqual([]);
        await rm(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 500 });
        expect(existsSync(profile)).toBe(false);
      } catch (error) {
        failure = error instanceof Error ? error.stack : String(error);
        throw error;
      } finally {
        restorePipe?.();
        // Native fallback has already disconnected this client on success.
        await lateClient?.close();
        if (priorTemp === undefined) delete process.env.TEMP; else process.env.TEMP = priorTemp;
        if (priorTmp === undefined) delete process.env.TMP; else process.env.TMP = priorTmp;
        // A failed browser/profile is retained, never retried by this fixture.
        unrelated.kill(); await unrelatedClose;
        writeFileSync(profile + '.json', JSON.stringify({ force, profile, ownership, observations, failure,
          retained: existsSync(profile), browserExit: server?.process().exitCode, unrelatedExit: unrelated.exitCode }, null, 2));
      }
    }, 60_000);
  }

  it('does not terminate a live process occupying a recorded old identity', async () => {
    const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { windowsHide: true, stdio: 'ignore' });
    const closed = waitForWorker(child, 15_000);
    const ownership: BrowserOwnership = {
      rootPid: child.pid!, runnerPid: process.pid, executable: process.execPath, profile: 'C:\\unused-review-profile',
      processes: [{ pid: child.pid!, parentPid: process.pid, created: '630822816000000000',
        executable: process.execPath, lastSeen: '630822816010000000' }],
    };
    const observations: Record<string, unknown>[] = [];
    try {
      await settleBrowserTree(ownership, 'terminate', row => observations.push(row));
      expect(observations.at(-1)?.survivors).toEqual([]);
      expect(observations.at(-1)?.terminated).toEqual([]);
      expect(() => process.kill(child.pid!, 0)).not.toThrow();
    } finally { child.kill(); await closed; }
  }, 20_000);

  it('rejects a root that does not own the profile before admitting descendants', async () => {
    mkdirSync(artifact, { recursive: true });
    const profile = mkdtempSync(resolve(artifact, 'p-'));
    const temp = process.env.TEMP, tmp = process.env.TMP;
    process.env.TEMP = profile; process.env.TMP = profile;
    const server = await chromium.launchServer({ headless: true, args: pinnedFlags });
    if (temp === undefined) delete process.env.TEMP; else process.env.TEMP = temp;
    if (tmp === undefined) delete process.env.TMP; else process.env.TMP = tmp;
    try {
      await expect(captureBrowserOwnership(server.process(), profile + '-other')).rejects.toThrow('does not own');
      const ownership = await captureBrowserOwnership(server.process(), profile);
      await shutdownOwnedBrowser(server, ownership);
      await rm(profile, { recursive: true, force: true });
    } catch (error) {
      writeFileSync(profile + '.json', JSON.stringify({ failure: String(error), retained: true }));
      throw error;
    }
  }, 45_000);

  it('fails authoritative absence even if a native command falsely claims success', async () => {
    const nativeSpawn = childProcesses.spawn;
    const spawnProbe = vi.spyOn(childProcesses, 'spawn').mockImplementation(() => nativeSpawn(
      process.execPath, ['-e', `console.log(JSON.stringify(${JSON.stringify({ ownership: {
        rootPid: 123, runnerPid: process.pid, executable: 'C:\\browser.exe', profile: 'C:\\profile', processes: [],
      }, survivors: [{ pid: 123 }], terminated: [], at: 'fixture' })}))`], { windowsHide: true, stdio: ['ignore','pipe','pipe'] }));
    try {
      await expect(settleBrowserTree({rootPid:123,runnerPid:process.pid,executable:'C:\\browser.exe',profile:'C:\\profile',processes:[]}, 'observe')).rejects.toThrow('survived');
    } finally { spawnProbe.mockRestore(); }
  });

  it('initiates server close after an inventory failure and preserves that first failure', async () => {
    const nativeSpawn = childProcesses.spawn;
    const ownership: BrowserOwnership = { rootPid: 123, runnerPid: process.pid,
      executable: 'C:\\browser.exe', profile: 'C:\\profile', processes: [] };
    let commands = 0;
    const probe = vi.spyOn(childProcesses, 'spawn').mockImplementation(() => nativeSpawn(process.execPath,
      ['-e', ++commands === 1 ? 'console.error("first capture failure");process.exit(7)' :
        `console.log(JSON.stringify(${JSON.stringify({ownership,survivors:[],terminated:[],at:'fixture'})}))`],
      { windowsHide:true, stdio:['ignore','pipe','pipe'] }));
    const server = { close: vi.fn(async () => {}) };
    try {
      await expect(shutdownOwnedBrowser(server, ownership)).rejects.toThrow('first capture failure');
      expect(server.close).toHaveBeenCalledOnce();
      expect(commands).toBe(2);
    } finally { probe.mockRestore(); }
  });

  it('terminates and settles a timed-out native observer, retaining partial failure evidence', async () => {
    const nativeSpawn = childProcesses.spawn;
    let commandChild: ReturnType<typeof spawn> | undefined;
    let commandClose: ReturnType<typeof waitForWorker> | undefined;
    const ownership: BrowserOwnership = { rootPid: 123, runnerPid: process.pid,
      executable: 'C:\\browser.exe', profile: 'C:\\profile', processes: [] };
    const observations: Record<string,unknown>[] = [];
    const probe = vi.spyOn(childProcesses, 'spawn').mockImplementation(() => {
      commandChild = nativeSpawn(process.execPath, ['-e', `console.log(JSON.stringify(${JSON.stringify({ownership,
        survivors:[{pid:123}],terminated:[],at:'partial'})}));setInterval(()=>{},1000)`],
      {windowsHide:true,stdio:['ignore','pipe','pipe']});
      commandClose = waitForWorker(commandChild, 5_000);
      return commandChild;
    });
    try {
      await expect(settleBrowserTree(ownership, 'observe', row => observations.push(row), 500)).rejects.toThrow('deadline');
      expect((await commandClose)?.timedOut).toBe(false);
      expect(commandChild?.stdout?.destroyed).toBe(true);
      expect(commandChild?.stderr?.destroyed).toBe(true);
      expect(observations.some(row => row.commandError === 'Cleanup command deadline exceeded')).toBe(true);
      expect(() => process.kill(commandChild!.pid!,0)).toThrow();
    } finally { probe.mockRestore(); }
  });
});
