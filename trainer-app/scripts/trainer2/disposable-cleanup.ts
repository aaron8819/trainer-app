import { spawnSync, type ChildProcess } from 'node:child_process';

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
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    try {
      await Promise.race([
        Promise.resolve().then(step.run),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => { timedOut = true; reject(new Error('Cleanup deadline exceeded')); }, step.timeoutMs ?? 10_000);
        }),
      ]);
      results.push({ name: step.name, status: 'passed' });
    } catch (error) {
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
  return [...owned].filter(value=>value!==pid||processAlive(pid));
}

export async function terminateOwnedProcesses(pids: number[]): Promise<void> {
  // Validate the whole captured tree before terminating anything.
  for (const pid of pids) {
    if (pid === process.pid || !Number.isSafeInteger(pid) || pid <= 0) throw new Error('Invalid task-owned process');
  }
  if (process.platform === 'win32' && pids.length) {
    // Native Node SIGKILL can block on an exiting browser process on Windows.
    // Discard inherited output handles and bound the OS termination command.
    const killed=spawnSync('taskkill.exe',[...pids.flatMap(pid=>['/PID',String(pid)]),'/F'],{stdio:'ignore',windowsHide:true,timeout:15_000});
    if(killed.error)throw new Error(`Task process termination failed: ${killed.error.message}`);
    // taskkill may return nonzero for an already-exited member; verify absence.
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
