import assert from 'node:assert/strict';
import { runCleanupCommand } from './disposable-cleanup';

type Command = typeof runCleanupCommand;
type Receipt = Awaited<ReturnType<Command>>;
const absent = (r: Receipt) => !r.error && r.status !== 0 && /no such (?:container|object)/i.test(r.stderr);

export async function observeContainerAbsence(container: string, record: (row: Record<string, unknown>) => void, command: Command = runCleanupCommand) {
  const result = await command('docker', ['container', 'inspect', container], 5000);
  record({ phase: 'absence', container, result, absent: absent(result) });
  assert(absent(result), 'Task container absence is unqualified');
}

// Removal completion and resource absence are independent observations. Never
// repeat a timed-out removal, and do not discard its failure when absence passes.
export async function removeOwnedContainer(container: string, owner: string, record: (row: Record<string, unknown>) => void, command: Command = runCleanupCommand) {
  const identity = await command('docker', ['container', 'inspect', '--format', '{{.Id}} {{ index .Config.Labels "trainer2.current-week.owner" }}', container], 5000);
  record({ phase: 'identity', container, result: identity });
  if (absent(identity)) return;
  assert(!identity.error && identity.status === 0, 'Cannot establish task container identity');
  const [id, label] = identity.stdout.trim().split(/\s+/);
  assert(/^[a-f0-9]{64}$/.test(id) && label === owner, 'Refusing to remove an unowned container');
  const removed = await command('docker', ['rm', '-f', id], 10000);
  record({ phase: 'removal', container, id, result: removed });
  let firstFailure: Error | undefined;
  if (removed.error || removed.status !== 0) firstFailure = new Error(removed.error ?? 'Task container removal failed');
  try { await observeContainerAbsence(id, record, command); }
  catch (error) { firstFailure ??= error as Error; }
  if (firstFailure) throw firstFailure;
}
