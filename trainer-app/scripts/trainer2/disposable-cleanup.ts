import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { win32 } from 'node:path';

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
