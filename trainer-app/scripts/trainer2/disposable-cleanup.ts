import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { join, resolve, win32 } from 'node:path';

type CleanupCommandResult = {
  pid?: number; status: number | null; signal: NodeJS.Signals | null;
  stdout: string; stderr: string; startedAt: string; closedAt?: string; error?: string;
};

// Keep the event loop available for the browser's exit/close and pipe handlers.
// A synchronous OS poll prevents the parent observing child completion promptly.
export async function runCleanupCommand(file: string, args: string[], timeoutMs: number, env?: NodeJS.ProcessEnv, onLine?: (line:string)=>void): Promise<CleanupCommandResult> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('Invalid cleanup command deadline');
  const startedAt = new Date().toISOString();
  const deadline = Date.now() + timeoutMs;
  // A PowerShell 7 caller can supply its incompatible module search path to
  // Windows PowerShell. Pin native modules for the native process observer.
  const commandEnv = process.platform === 'win32' && win32.basename(file).toLowerCase() === 'powershell.exe'
    ? { ...(env ?? process.env), PSModulePath: join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/Modules') }
    : env;
  const child = spawn(file, args, { env: commandEnv, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '', pendingLine = '';
  let outputError: string | undefined;
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  child.stdout.on('data', value => {
    stdout += value;
    if(onLine){
      pendingLine += value;
      const lines=pendingLine.split(/\r?\n/);pendingLine=lines.pop()!;
      for(const line of lines.filter(Boolean))try{onLine(line);}catch(error){outputError ??= String(error);}
    }
  });
  child.stderr.on('data', value => { stderr += value; });
  return new Promise(resolve => {
    let settled = false;
    const finish = (status: number | null, signal: NodeJS.Signals | null, error?: string, closedAt?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ pid: child.pid, status, signal, stdout, stderr, startedAt, closedAt,
        error: error ?? outputError ?? (Date.now() > deadline ? 'Cleanup command deadline exceeded' : undefined) });
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
  if (result.status !== 0 || result.error) throw commandFailure('Task browser inventory', result);
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
  let last: BrowserTreeObservation | undefined;
  const consume = (line: string) => {
    last = JSON.parse(line) as BrowserTreeObservation;
    ownership.processes = last.ownership.processes;
    // Deliver native progress while the observer is alive. The caller can close
    // original pipes after termination is requested, unblocking kernel teardown.
    record?.({ mode, ...last, commandPending: true });
  };
  const command = await runCleanupCommand('powershell.exe', ['-NoProfile', '-NonInteractive', '-File',
    resolve('scripts/trainer2/browser-tree.ps1'), '-Mode', mode, '-OwnershipBase64', seed,
    '-DeadlineUnixMs', String(Date.now() + timeoutMs - 100)], timeoutMs, undefined, consume);
  if(last)record?.({mode,...last,commandPid:command.pid,commandStartedAt:command.startedAt,
    commandClosedAt:command.closedAt,commandStatus:command.status,commandError:command.error});
  if (command.error || command.status !== 0) {
    const failure = commandFailure(`Qualified process tree ${mode}`, command);
    record?.({ mode, diagnostics: (failure as Error & { diagnostics: unknown }).diagnostics });
    throw failure;
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

// A native launcher can observe Windows browser exit independently of Node's
// direct browser child handle. Its creation receipt supplies the exact parent.
export async function captureNativeBrowserOwnership(input: Pick<BrowserOwnership, 'rootPid' | 'runnerPid' | 'executable' | 'profile'>, record?: CleanupRecorder): Promise<BrowserOwnership> {
  browserProcessesForProfile([], input.profile, win32.basename(input.executable));
  const ownership: BrowserOwnership = { ...input, processes: [] };
  await browserTreeCommand(ownership, 'capture', 10_000, record);
  return ownership;
}

export async function settleBrowserTree(ownership: BrowserOwnership, mode: 'observe' | 'terminate', record?: CleanupRecorder, timeoutMs = 10_000) {
  return browserTreeCommand(ownership, mode, timeoutMs, record);
}

// Shared by the real disposable runner and the short fallback fixture. Capture
// before requesting server close, keep the original grace/total bounds, and
// await both authoritative tree absence and the actual server-close operation.
export async function shutdownOwnedBrowser(server: { close: () => Promise<void>; process?:()=>ChildProcess }, ownership: BrowserOwnership,
  record?: CleanupRecorder, options: { timeoutMs?: number; graceMs?: number } = {}) {
  const deadline = Date.now() + (options.timeoutMs ?? 10_000);
  let captureError: unknown;
  try { await browserTreeCommand(ownership, 'capture', deadline - Date.now(), record); }
  catch (error) { captureError = error; record?.({ event: 'ownership-refresh-failed', error: String(error) }); }
  let closeError: unknown;
  const closing = Promise.resolve().then(() => server.close()).then(() => true, error => { closeError = error; return false; });
  record?.({ event: 'server-close-initiated' });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let graceful: boolean;
  try {
    graceful = await Promise.race([closing, new Promise<boolean>(resolveGrace => {
      timer = setTimeout(() => resolveGrace(false), Math.max(0, Math.min(options.graceMs ?? 5_000, deadline - Date.now())));
    })]);
  } finally { clearTimeout(timer); }
  record?.({ event: 'grace-completed', graceful });
  const disposePipes=()=>{for(const stream of server.process?.().stdio??[])stream?.destroy();};
  const progress=(row:Record<string,unknown>)=>{
    record?.(row);
    const requested=[...((row.terminated as BrowserProcessIdentity[]|undefined)??[]),...((row.pendingTermination as BrowserProcessIdentity[]|undefined)??[])];
    if(requested.some(process=>process.pid===ownership.rootPid))disposePipes();
  };
  // Native observation remains authoritative even after original pipes close.
  try { await settleBrowserTree(ownership, graceful ? 'observe' : 'terminate', progress, Math.max(101, deadline - Date.now() - 1000)); }
  catch (error) { throw captureError ?? error; }
  finally { disposePipes(); }
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

type WorkerCompletion = {exitCode:number|null;signal:NodeJS.Signals|null;timedOut:boolean;error?:string};
const workerClosures = new WeakMap<ChildProcess, WorkerCompletion>();
export async function waitForWorker(child: ChildProcess, timeoutMs: number): Promise<WorkerCompletion> {
  const observed=workerClosures.get(child);if(observed)return observed;
  return new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null; timedOut: boolean; error?: string }>(resolve => {
    const closed = (exitCode: number | null, signal: NodeJS.Signals | null) => {
      workerClosures.set(child,{exitCode,signal,timedOut:false});
      clearTimeout(timer);
      child.off('error',failed);
      resolve({ exitCode, signal, timedOut: false });
    };
    const failed=(error: Error)=>{clearTimeout(timer);child.off('close',closed);resolve({exitCode:null,signal:null,timedOut:false,error:error.message});};
    const timer = setTimeout(() => {
      // Keep observing actual close after the deadline for bounded recovery.
      // Consume a late spawn/termination error while the caller cleans up.
      resolve({ exitCode: null, signal: null, timedOut: true });
    }, timeoutMs);
    child.once('close', closed);
    child.once('error',failed);
  });
}

// Cleanup completion starts a short exit grace period; an open connection cannot
// silently keep a failed disposable worker alive for the whole journey budget.
export async function waitForWorkerAfterCleanup(child: ChildProcess, cleanupCompleted: Promise<void>, timeoutMs: number, graceMs = 5_000): Promise<WorkerCompletion> {
  const completion=waitForWorker(child,timeoutMs);
  const first=await Promise.race([
    completion.then(result=>({kind:'closed' as const,result})),
    cleanupCompleted.then(()=>({kind:'cleanup' as const})),
  ]);
  if(first.kind==='closed')return first.result;
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{
    return await Promise.race([completion,new Promise<WorkerCompletion>(resolve=>{
      timer=setTimeout(()=>resolve({exitCode:null,signal:null,timedOut:true,error:'Worker did not finish after cleanup'}),graceMs);
    })]);
  }finally{clearTimeout(timer);}
}

export type CleanupStep = { name: string; run: () => unknown | Promise<unknown>; timeoutMs?: number };
export type CleanupResult = { name: string; status: 'passed' | 'failed' | 'timed-out'; error?: string; diagnostics?: unknown };

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
      results.push({ name: step.name, status: timedOut ? 'timed-out' : 'failed', error: error instanceof Error ? error.message : String(error), diagnostics: error instanceof Error && 'diagnostics' in error ? error.diagnostics : undefined });
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


// Numeric PIDs are only lookup keys for receipts captured while a direct child
// is alive. An exited creator PID alone can never establish orphan ownership.
const capturedTrees = new Map<number, BrowserOwnership>();
export function ownedProcessTree(pid: number, rootMarker?: string, record?: CleanupRecorder): number[] {
  if (process.platform !== 'win32') throw new Error('Qualified native ownership requires Windows');
  if (!Number.isSafeInteger(pid) || pid <= 0 || pid === process.pid) throw new Error('Invalid task-owned process');
  const previous = capturedTrees.get(pid);
  const ownership: BrowserOwnership = previous ?? { rootPid: pid, runnerPid: process.pid,
    executable: '', profile: '', processes: [] };
  // Bootstrap only a current direct child, using CIM creation time and then a
  // generation-bound native handle. Capture mode also checks creator lifetime.
  if (!previous) {
    const startedAt = new Date().toISOString();
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `$ErrorActionPreference='Stop'; Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}" | Select-Object ExecutablePath,CommandLine | ConvertTo-Json -Compress`],
      { encoding: 'utf8', windowsHide: true, timeout: 10_000, env: nativeObserverEnvironment() });
    if (result.status !== 0 || result.error) throw commandFailure('Task root inventory', { ...result, startedAt, closedAt:new Date().toISOString(), stdout: result.stdout ?? '', stderr: result.stderr ?? '', error: result.error?.message });
    const root = JSON.parse(result.stdout || 'null');
    if (!root?.ExecutablePath || (rootMarker && !root.CommandLine?.toLowerCase().includes(rootMarker.toLowerCase()))) throw new Error('Task root identity unavailable or changed');
    ownership.executable = root.ExecutablePath;
  }
  const startedAt = new Date().toISOString();
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', resolve('scripts/trainer2/browser-tree.ps1'),
    '-Mode', previous ? 'inventory' : 'capture', '-OwnershipBase64', Buffer.from(JSON.stringify(ownership)).toString('base64'),
    '-DeadlineUnixMs', String(Date.now() + 9_000)], { encoding: 'utf8', windowsHide: true, timeout: 10_000, env: nativeObserverEnvironment() });
  if (result.status !== 0 || result.error) throw commandFailure('Task tree inventory', { ...result, startedAt, closedAt:new Date().toISOString(), stdout: result.stdout ?? '', stderr: result.stderr ?? '', error: result.error?.message });
  const last = JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1)!) as BrowserTreeObservation;
  record?.({mode:'process-capture',...last,commandStatus:result.status,commandSignal:result.signal,elapsedMs:Date.now()-Date.parse(startedAt)});
  for (const row of last.ownership.processes) capturedTrees.set(row.pid, last.ownership);
  return last.survivors.map(row => row.pid);
}
function nativeObserverEnvironment() {
  return { ...process.env, PSModulePath: join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/Modules') };
}
function commandFailure(label: string, command: CleanupCommandResult): Error {
  // Process inventories contain arbitrary command lines. Retain OS diagnostics,
  // never raw inventory stdout or inherited environment/credentials.
  const diagnostics = { status: command.status, signal: command.signal, error: command.error,
    startedAt: command.startedAt, closedAt: command.closedAt, elapsedMs: Date.now() - Date.parse(command.startedAt), stdoutBytes: Buffer.byteLength(command.stdout),
    stderr: command.stderr.replace(/(postgres(?:ql)?:\/\/)[^\s]+/gi, '$1[redacted]').slice(0, 4000) };
  return Object.assign(new Error(`${label} failed: ${JSON.stringify(diagnostics)}`), { diagnostics });
}
export async function terminateOwnedProcesses(pids: number[], record?: CleanupRecorder, timeoutMs = 20_000): Promise<void> {
  if(!Number.isFinite(timeoutMs)||timeoutMs<=0)throw new Error('Invalid termination deadline');
  const trees = new Set<BrowserOwnership>();
  for (const pid of pids) {
    const tree = capturedTrees.get(pid);
    if (!tree || pid === process.pid) throw new Error('Missing captured process identity; refusing numeric PID termination');
    trees.add(tree);
  }
  const deadline = Date.now() + timeoutMs;
  for (const tree of trees) await settleBrowserTree(tree, 'terminate', record, deadline - Date.now());
}
