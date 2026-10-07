import type { ChildProcess } from 'node:child_process';

export function isolatedLinuxJob(platform: string, env: Readonly<Record<string, string | undefined>>): boolean {
  if (platform === 'win32' && env.TRAINER2_ISOLATED_LINUX_JOB === undefined) return false;
  if (platform !== 'linux' || env.TRAINER2_ISOLATED_LINUX_JOB !== '1' ||
      env.CI !== 'true' || env.GITHUB_ACTIONS !== 'true' ||
      env.RUNNER_ENVIRONMENT !== 'github-hosted' ||
      env.GITHUB_JOB !== 'trainer2-combined-acceptance') {
    throw new Error('Fixture requires Windows ownership or explicit isolated Linux CI');
  }
  return true;
}

export interface ChildExit {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  error?: string;
}

export function observeChild(child: ChildProcess): Promise<ChildExit> {
  return new Promise(resolve => {
    child.once('close', (exitCode, signal) => resolve({ exitCode, signal }));
    child.once('error', error => resolve({ exitCode: null, signal: null, error: error.message }));
  });
}

export async function bounded<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Owned resource completion timed out')), timeoutMs);
    })]);
  } finally { clearTimeout(timer); }
}

// Call immediately after this fixture spawns its detached child. Never accept an arbitrary PID.
export function ownLinuxGroup(
  child: ChildProcess,
  signalGroup: (pid: number, signal: NodeJS.Signals | 0) => void = process.kill,
): { completion: Promise<ChildExit>; stop: () => Promise<ChildExit> } {
  if (!child.pid || child.pid <= 1) throw new Error('Spawned child identity unavailable');
  const pid = child.pid;
  const completion = observeChild(child);
  let attempted = false;
  return { completion, stop: async () => {
    if (attempted) throw new Error('Owned group shutdown already attempted');
    attempted = true;
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error('Leader already exited; refusing a potentially reused process group');
    }
    signalGroup(-pid, 'SIGTERM');
    const result = await bounded(completion, 5_000);
    if (result.error) throw new Error(result.error);
    try { signalGroup(-pid, 0); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') return result;
      throw error;
    }
    throw new Error('Owned process group remains; refusing further termination');
  } };
}
