import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { resolve, win32 } from 'node:path';

type CleanupCommandResult = {
  pid?: number; status: number | null; signal: NodeJS.Signals | null;
  stdout: string; stderr: string; startedAt: string; closedAt?: string; error?: string;
};

// Keep the event loop available for the browser's exit/close and pipe handlers.
// A synchronous OS poll prevents the parent observing child completion promptly.
async function runCleanupCommand(file: string, args: string[], timeoutMs: number): Promise<CleanupCommandResult> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('Invalid cleanup command deadline');
  const startedAt = new Date().toISOString();
  const deadline = Date.now() + timeoutMs;
  const child = spawn(file, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  child.stdout.on('data', value => { stdout += value; });
  child.stderr.on('data', value => { stderr += value; });
  return new Promise(resolve => {
    let settled = false;
    const finish = (status: number | null, signal: NodeJS.Signals | null, error?: string, closedAt?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ pid: child.pid, status, signal, stdout, stderr, startedAt, closedAt,
        error: error ?? (Date.now() > deadline ? 'Cleanup command deadline exceeded' : undefined) });
    };
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch (error) { stderr += String(error); }
      child.stdout.destroy(); child.stderr.destroy(); child.unref();
      finish(null, null, 'Cleanup command deadline exceeded');
    }, Math.max(0, deadline - Date.now()));
    // Retain an error listener to consume a late termination error after timeout.
    child.on('error', error => finish(null, null, error.message));
    child.once('close', (status, signal) => finish(status, signal, undefined, new Date().toISOString()));
  });
}

export function browserProcessesForProfile(rows: { pid: number; name: string; command?: string }[], profile: string, executableName = 'msedge.exe'): number[] {
  if (!win32.isAbsolute(profile)) throw new Error('Browser profile must be absolute');
  if (!['msedge.exe', 'chrome.exe', 'chrome-headless-shell.exe'].includes(executableName.toLowerCase())) throw new Error('Unsupported owned browser executable');
  const expected = win32.normalize(profile).toLowerCase();
  return rows.filter(row => {
    if (row.name.toLowerCase() !== executableName.toLowerCase()) return false;
    const argument = row.command?.match(/--user-data-dir=(?:"([^"]+)"|([^\s]+))/i);
    if (!argument) return false;
    const actual = win32.normalize(argument[1] ?? argument[2]).toLowerCase();
    return actual === expected || actual.startsWith(expected + win32.sep);
  }).map(row => row.pid);
}

export async function ownedBrowserProcesses(profile: string, options: { executableName?: string; timeoutMs?: number } = {}): Promise<number[]> {
  const executableName = options.executableName ?? 'msedge.exe';
  const timeoutMs = options.timeoutMs ?? 10_000;
  browserProcessesForProfile([], profile, executableName);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('Invalid browser inventory deadline');
  const result = await runCleanupCommand('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Get-CimInstance Win32_Process | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress'], Math.min(10_000, timeoutMs));
  if (result.status !== 0 || result.error) throw new Error(`Unable to inventory task browser processes: ${result.error ?? result.stderr}`);
  const rows = JSON.parse(result.stdout) as { ProcessId: number; Name: string; CommandLine?: string }[];
  return browserProcessesForProfile(rows.map(row => ({ pid: row.ProcessId, name: row.Name, command: row.CommandLine })), profile,executableName);
}

export type BrowserProcessIdentity = {
  pid: number; parentPid: number; created: string; executable: string; lastSeen: string;
};
export type BrowserOwnership = {
  rootPid: number; runnerPid: number; executable: string; profile: string;
  processes: BrowserProcessIdentity[];
};
type BrowserTreeObservation = {
  ownership: BrowserOwnership; survivors: BrowserProcessIdentity[];
  terminated: BrowserProcessIdentity[]; at: string;
};
type CleanupRecorder = (result: Record<string, unknown>) => void;

// The native observer keeps validated process handles through termination and
// discovers descendants by parent identity, not by a child's profile argument.
async function browserTreeCommand(ownership: BrowserOwnership, mode: 'capture' | 'observe' | 'terminate', timeoutMs: number, record?: CleanupRecorder) {
  if (process.platform !== 'win32') throw new Error('Qualified browser teardown requires Windows');
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 100) throw new Error('Browser tree deadline exceeded');
  const seed = Buffer.from(JSON.stringify(ownership)).toString('base64');
  const command = await runCleanupCommand('powershell.exe', ['-NoProfile', '-NonInteractive', '-File',
    resolve('scripts/trainer2/browser-tree.ps1'), '-Mode', mode, '-OwnershipBase64', seed,
    '-DeadlineUnixMs', String(Date.now() + timeoutMs - 100)], timeoutMs);
  let last: BrowserTreeObservation | undefined;
  for (const line of command.stdout.trim().split(/\r?\n/).filter(Boolean)) {
    last = JSON.parse(line) as BrowserTreeObservation;
    ownership.processes = last.ownership.processes;
    record?.({ mode, ...last, commandPid: command.pid, commandStartedAt: command.startedAt,
      commandClosedAt: command.closedAt, commandStatus: command.status, commandError: command.error });
  }
  if (command.error || command.status !== 0) {
    record?.({ mode, command });
    throw new Error(`Qualified browser tree ${mode} failed: ${command.error ?? command.stderr}`);
  }
  if (!last) throw new Error('Browser tree returned no authoritative observation');
  if (mode !== 'capture' && last.survivors.length) throw new Error('Qualified browser tree survived shutdown');
  return last;
}

export async function captureBrowserOwnership(child: ChildProcess, profile: string, record?: CleanupRecorder): Promise<BrowserOwnership> {
  browserProcessesForProfile([], profile, win32.basename(child.spawnfile));
  if (!child.pid || child.exitCode !== null || !win32.isAbsolute(child.spawnfile)) throw new Error('Launched browser root is unavailable');
  const ownership: BrowserOwnership = { rootPid: child.pid, runnerPid: process.pid,
    executable: child.spawnfile, profile, processes: [] };
  await browserTreeCommand(ownership, 'capture', 10_000, record);
  return ownership;
}

export async function settleBrowserTree(ownership: BrowserOwnership, mode: 'observe' | 'terminate', record?: CleanupRecorder, timeoutMs = 10_000) {
  return browserTreeCommand(ownership, mode, timeoutMs, record);
}

// Shared by the real disposable runner and the short fallback fixture. Capture
// before requesting server close, keep the original grace/total bounds, and
// await both authoritative tree absence and the actual server-close operation.
export async function shutdownOwnedBrowser(server: { close: () => Promise<void> }, ownership: BrowserOwnership,
  record?: CleanupRecorder, options: { timeoutMs?: number; graceMs?: number } = {}) {
  const deadline = Date.now() + (options.timeoutMs ?? 10_000);
  let captureError: unknown;
  try { await browserTreeCommand(ownership, 'capture', deadline - Date.now(), record); }
  catch (error) { captureError = error; record?.({ event: 'ownership-refresh-failed', error: String(error) }); }
  let closeError: unknown;
  const closing = server.close().then(() => true, error => { closeError = error; return false; });
  record?.({ event: 'server-close-initiated' });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let graceful: boolean;
  try {
    graceful = await Promise.race([closing, new Promise<boolean>(resolveGrace => {
      timer = setTimeout(() => resolveGrace(false), Math.max(0, Math.min(options.graceMs ?? 5_000, deadline - Date.now())));
    })]);
  } finally { clearTimeout(timer); }
  record?.({ event: 'grace-completed', graceful });
  // Observation after graceful close also checks captured, unmarked orphans.
  try { await settleBrowserTree(ownership, graceful ? 'observe' : 'terminate', record, Math.min(5_000, deadline - Date.now())); }
  catch (error) { throw captureError ?? error; }
  try {
    await Promise.race([closing, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Browser server close did not settle')), Math.max(0, deadline - Date.now()));
    })]);
  } finally { clearTimeout(timer); }
  if (captureError) throw captureError;
  if (closeError) throw closeError;
  if (Date.now() > deadline) throw new Error('Browser shutdown deadline exceeded');
  return { gracefulServerClose: graceful, forceFallback: !graceful };
}

export async function waitForWorker(child: ChildProcess, timeoutMs: number) {
  return new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null; timedOut: boolean; error?: string }>(resolve => {
    const closed = (exitCode: number | null, signal: NodeJS.Signals | null) => {
      clearTimeout(timer);
      child.off('error',failed);
      resolve({ exitCode, signal, timedOut: false });
    };
    const failed=(error: Error)=>{clearTimeout(timer);child.off('close',closed);resolve({exitCode:null,signal:null,timedOut:false,error:error.message});};
    const timer = setTimeout(() => {
      child.off('close', closed);
      // Consume a late spawn/termination error while the caller cleans up.
      resolve({ exitCode: null, signal: null, timedOut: true });
    }, timeoutMs);
    child.once('close', closed);
    child.once('error',failed);
  });
}

export type CleanupStep = { name: string; run: () => unknown | Promise<unknown>; timeoutMs?: number };
export type CleanupResult = { name: string; status: 'passed' | 'failed' | 'timed-out'; error?: string };

// Every step gets its own deadline. A rejected or stalled resource never blocks
// cleanup of the remaining resources. The caller still fails the runner.
export async function cleanupSteps(steps: CleanupStep[]): Promise<CleanupResult[]> {
  const results: CleanupResult[] = [];
  for (const step of steps) {
    const deadline = Date.now() + (step.timeoutMs ?? 10_000);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    try {
      await Promise.race([
        Promise.resolve().then(step.run),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => { timedOut = true; reject(new Error('Cleanup deadline exceeded')); }, step.timeoutMs ?? 10_000);
        }),
      ]);
      // Synchronous OS commands can delay the timer callback. They must not
      // win the race after the actual deadline and falsely report success.
      if (Date.now() > deadline) { timedOut = true; throw new Error('Cleanup deadline exceeded'); }
      results.push({ name: step.name, status: 'passed' });
    } catch (error) {
      timedOut ||= Date.now() > deadline;
      results.push({ name: step.name, status: timedOut ? 'timed-out' : 'failed', error: error instanceof Error ? error.message : String(error) });
    } finally {
      clearTimeout(timer);
    }
  }
  return results;
}

export function processAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
    throw error;
  }
}


// Capture descendants before killing the root: after reparenting, ownership
// cannot safely be inferred from the executable name or a shared port.
export function ownedProcessTree(pid: number, rootMarker?: string): number[] {
  if (!Number.isSafeInteger(pid) || pid <= 0 || pid === process.pid) throw new Error('Invalid task-owned process');
  const result = process.platform === 'win32'
    ? spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress'], { encoding: 'utf8', windowsHide: true, timeout: 10_000 })
    : spawnSync('ps', ['-eo', 'pid=,ppid='], { encoding: 'utf8', timeout: 10_000 });
  if (result.status !== 0) throw new Error('Unable to inventory task-owned child processes');
  const rows: { pid: number; parent: number; command?: string }[] = process.platform === 'win32'
    ? JSON.parse(result.stdout).map((p: { ProcessId: number; ParentProcessId: number; CommandLine?: string }) => ({ pid: p.ProcessId, parent: p.ParentProcessId, command:p.CommandLine }))
    : result.stdout.trim().split('\n').map(line => { const [child, parent] = line.trim().split(/\s+/).map(Number); return { pid: child, parent }; });
  const owned = new Set([pid]);
  const root=rows.find(row=>row.pid===pid);
  if(rootMarker&&process.platform==='win32'&&root&&!root.command?.toLowerCase().includes(rootMarker.toLowerCase()))throw new Error('Task root identity changed; refusing process termination');
  for (let changed = true; changed;) {
    changed = false;
    for (const row of rows) if (owned.has(row.parent) && !owned.has(row.pid)) { owned.add(row.pid); changed = true; }
  }
  if (owned.has(process.pid)) throw new Error('Refusing to terminate runner ancestors');
  // Windows keeps the creator PID on an orphan. Even when the root has already
  // exited, late browser/crash-handler children must still be discovered.
  // Node's Windows kill(pid, 0) can report ESRCH for an Edge process that CIM
  // still inventories and whose ChildProcess has not emitted exit. Keep the
  // inventoried root: dropping it leaves the browser and profile writers alive.
  return rows.filter(row => owned.has(row.pid)).map(row => row.pid);
}

export async function terminateOwnedProcesses(pids: number[], record?: (result: Record<string, unknown>) => void, timeoutMs = 20_000): Promise<void> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('Invalid termination deadline');
  const terminationDeadline = Date.now() + timeoutMs;
  // Validate the whole captured tree before terminating anything.
  for (const pid of pids) {
    if (pid === process.pid || !Number.isSafeInteger(pid) || pid <= 0) throw new Error('Invalid task-owned process');
  }
  if (process.platform === 'win32' && pids.length) {
    // Native Node SIGKILL can block on an exiting browser process on Windows.
    // Discard inherited output handles and bound the OS termination command.
    const killed = await runCleanupCommand('taskkill.exe', [...pids.flatMap(pid => ['/PID', String(pid)]), '/F'], Math.min(15_000, timeoutMs));
    record?.({ pids, ...killed });
    if (killed.error) throw new Error(`Task process termination failed: ${killed.error}`);
    // taskkill may return nonzero for an already-exited member; verify absence.
    // Do not use kill(pid, 0) here: on Windows it can miss a still-inventoried
    // Edge child. Query the OS inventory independently and fail closed.
    const absenceDeadline=Math.min(terminationDeadline,Date.now()+5_000);
    const remaining=absenceDeadline-Date.now();
    if(remaining<=0)throw new Error(`Task process absence deadline exceeded: ${pids.join(',')}`);
    // One observer retains the original five-second poll. Repeated PowerShell
    // startup can consume the last poll's remaining time before it inventories.
    const observer=`$ErrorActionPreference='Stop'; $owned=@(${pids.join(',')}); $deadline=[DateTimeOffset]::FromUnixTimeMilliseconds(${absenceDeadline}).UtcDateTime;
do { $survivors=@(Get-CimInstance Win32_Process | Where-Object { $owned -contains $_.ProcessId } | Select-Object ProcessId,ParentProcessId,Name,CreationDate); @{at=[DateTime]::UtcNow.ToString('o');survivors=$survivors} | ConvertTo-Json -Compress -Depth 5; if(!$survivors.Count){break}; if([DateTime]::UtcNow -lt $deadline){Start-Sleep -Milliseconds 50} } while([DateTime]::UtcNow -lt $deadline)`;
    const inventory = await runCleanupCommand('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', observer], remaining);
    let last: { at: string; survivors: { ProcessId: number }[] } | undefined;
    for (const line of inventory.stdout.trim().split(/\r?\n/).filter(Boolean)) {
      try { last = JSON.parse(line) as typeof last; }
      catch (error) {
        record?.({ pids, observer: inventory });
        throw new Error(`Task process absence inventory was malformed: ${String(error)}`);
      }
      record?.({ pids, ...last, observerPid: inventory.pid, observerStartedAt: inventory.startedAt,
        observerClosedAt: inventory.closedAt, observerStatus: inventory.status, observerError: inventory.error });
    }
    if (inventory.status !== 0 || inventory.error) {
      record?.({ pids, observer: inventory });
      throw new Error(`Task process absence inventory failed: ${inventory.error ?? inventory.stderr}`);
    }
    if (!last) throw new Error('Task process absence inventory returned no observations');
    if (last.survivors.length) throw new Error(`Task-owned processes survived OS termination: ${last.survivors.map(row => row.ProcessId).join(',')}`);
    return;
  } else for (const pid of pids) {
    if (!processAlive(pid)) continue;
    try { process.kill(pid, 'SIGKILL'); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    }
  }
  const live=()=>pids.filter(processAlive);
  const deadline = Date.now() + 5_000;
  while (live().length && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
  const survivors = live();
  if (survivors.length) throw new Error(`Task-owned processes survived: ${survivors.join(',')}`);
}
