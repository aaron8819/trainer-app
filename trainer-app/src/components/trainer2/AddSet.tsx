'use client';
import { useEffect, useRef, useState } from 'react';
import type { ExecutionRead } from '@/lib/trainer2-contracts/execution';
import { addSetCommand, addSetResponse, type AddSetCommand } from '@/lib/trainer2-contracts/add-set';
import { currentAssignment } from '@/lib/engine/trainer2/exercise-swap';
import { canonicalJson } from '@/lib/trainer2-contracts/canonical-json';
import { fetchWithRecovery } from './request-recovery';

export function AddSet({ execution, positionId, ownershipEpoch, locked, refresh, onLock, onAdded }: {
  execution: ExecutionRead; positionId: string; ownershipEpoch: number; locked: boolean;
  refresh: () => Promise<ExecutionRead>; onLock?: (value: boolean) => void; onAdded?: (id: string) => void;
}) {
  const [pending, setPending] = useState<AddSetCommand | null>(null), [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(''), [ready, setReady] = useState(false);
  const alive = useRef(false), flight = useRef(false);
  const key = `trainer2-add-set:${execution.initial.accountId}:${execution.executionId}:${positionId}`;
  useEffect(() => {
    alive.current = true;
    try {
      const raw = sessionStorage.getItem(key);
      if (raw) {
        const command = addSetCommand.parse(JSON.parse(raw));
        if (command.originatingAccountId !== execution.initial.accountId || command.target.executionId !== execution.executionId || command.target.positionId !== positionId) throw new Error('Wrong addition');
        setPending(command); setMessage('Set addition could not be confirmed. Check again.');
      }
      setReady(true);
    } catch { setMessage('The retained addition could not be read. Recover browser storage before continuing.'); }
    return () => { alive.current = false; };
    // Identity-scoped exact envelopes survive same-tab reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { onLock?.(!ready || busy || !!pending); return () => onLock?.(false); }, [ready, busy, pending, onLock]);
  async function submit(command: AddSetCommand) {
    if (flight.current) return;
    flight.current = true; setBusy(true);
    try {
      sessionStorage.setItem(key, canonicalJson(command)); setPending(command);
      const response = await fetchWithRecovery('/api/trainer2/executions/add-set', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: canonicalJson(command) }, () => alive.current);
      const { outcome } = addSetResponse.parse(await response.json());
      if (!alive.current) return;
      if (outcome.actionId !== command.actionId) throw new Error('Unbound addition');
      if (outcome.status !== 'Accepted') {
        await refresh();
        sessionStorage.removeItem(key); setPending(null); setMessage('Workout or exercise changed. Your input is retained; review before adding again.'); return;
      }
      if (!response.ok || outcome.result.executionId !== command.target.executionId || outcome.result.positionId !== positionId) throw new Error('Unbound addition');
      const latest = await refresh();
      if (!alive.current) return;
      const fact = latest.additions?.find(a => a.actionId === command.actionId);
      if (!fact || fact.content.target.id !== outcome.result.targetId || fact.content.ordinal !== outcome.result.ordinal || fact.contentHash !== outcome.result.contentHash) throw new Error('Unconfirmed addition');
      sessionStorage.removeItem(key); setPending(null); setMessage('');
      if (latest.lifecycle === 'Open') onAdded?.(fact.content.target.id);
    } catch { if (alive.current) setMessage('Set addition could not be confirmed. Check again with the original request.'); }
    finally { flight.current = false; if (alive.current) setBusy(false); }
  }
  function add() {
    if (!ready || locked || pending || busy || execution.lifecycle !== 'Open') return;
    void submit(addSetCommand.parse({ schemaVersion: 1, commandType: 'AddSet', actionId: crypto.randomUUID(), deviceId: crypto.randomUUID(),
      originatingAccountId: execution.initial.accountId, ownershipEpoch, dependsOn: [], target: { executionId: execution.executionId, positionId },
      expected: { contentHash: execution.contentHash, assignment: currentAssignment(execution, positionId) }, intent: {} }));
  }
  return <>
    {execution.lifecycle === 'Open' && !pending && <button type="button" disabled={!ready || locked || busy}
      className="inline-flex min-h-11 items-center justify-center rounded-full border border-dashed border-slate-300 bg-slate-50 px-3 text-xs font-semibold text-slate-700 disabled:opacity-60" onClick={add}>+ Add set</button>}
    {pending && <button type="button" disabled={busy} className="min-h-11 rounded-lg border px-3 py-2 text-sm" onClick={() => void submit(pending)}>Check addition again</button>}
    {message && <p role="status" className="w-full text-sm text-slate-600">{message}</p>}
  </>;
}
