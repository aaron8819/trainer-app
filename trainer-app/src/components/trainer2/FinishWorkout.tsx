'use client';
import { useEffect, useRef, useState } from 'react';
import type { ExecutionRead } from '@/lib/trainer2-contracts/execution';
import { finishExecutionCommand, finishResponse, reviewedResults, unrecordedTargets, type FinishExecutionCommand } from '@/lib/trainer2-contracts/workout-finish';
import { canonicalJson } from '@/lib/trainer2-contracts/canonical-json';
import { control } from './DraftEditor';

export function FinishWorkout({ execution, ownershipEpoch, blocked, refresh, onLock }: {
  execution: ExecutionRead; ownershipEpoch: number; blocked: boolean;
  refresh: () => Promise<unknown>; onLock: (locked: boolean) => void;
}) {
  const [review, setReview] = useState<ExecutionRead | null>(null), [pending, setPending] = useState<FinishExecutionCommand | null>(null);
  const [message, setMessage] = useState(''), [busy, setBusy] = useState(false), [ready, setReady] = useState(false);
  const alive = useRef(false), flight = useRef(false);
  const accountId = execution.initial.accountId, executionId = execution.executionId;
  const key = `trainer2-finish:${accountId}:${executionId}`;
  useEffect(() => {
    alive.current = true;
    try {
      const raw = sessionStorage.getItem(key);
      if (raw) {
        const command = finishExecutionCommand.parse(JSON.parse(raw));
        if (command.originatingAccountId !== accountId || command.target.executionId !== executionId) throw new Error('Wrong finish');
        setPending(command); onLock(true); setMessage('Finish could not be confirmed. Check finish again to recover the original request.');
      }
      setReady(true);
    } catch { setMessage('The retained finish request could not be read. Recover browser storage before finishing.'); }
    return () => { alive.current = false; };
    // This component is keyed by account and execution.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  async function submit(command: FinishExecutionCommand) {
    if (flight.current) return;
    try { sessionStorage.setItem(key, canonicalJson(command)); }
    catch { setMessage('Browser storage is unavailable. Keep this page open and try again.'); return; }
    flight.current = true; setBusy(true); setPending(command); onLock(true);
    try {
      const response = await fetch('/api/trainer2/executions/finish', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: canonicalJson(command) });
      const { outcome } = finishResponse.parse(await response.json());
      if (!alive.current) return;
      if (outcome.actionId !== command.actionId || (outcome.status === 'Accepted' && (!response.ok ||
        outcome.result.executionId !== executionId || outcome.result.planId !== execution.initial.planId ||
        outcome.result.occurrenceId !== execution.initial.occurrence.id))) throw new Error('Unbound finish');
      if (outcome.status === 'Accepted') {
        // A replay is historical. Load authoritative completion before clearing delivery state.
        await refresh(); if (!alive.current) return;
        sessionStorage.removeItem(key); setPending(null); setReview(null); onLock(false); setMessage('Workout finished.');
      } else {
        sessionStorage.removeItem(key); setPending(null); setReview(null); onLock(false);
        setMessage('Finish was not accepted. Reload saved results, review them, then choose Finish workout again. Your input is retained.');
      }
    } catch { if (alive.current) setMessage('Finish could not be confirmed. Check finish again with the original request.'); }
    finally { flight.current = false; if (alive.current) setBusy(false); }
  }
  function begin() {
    if (blocked || !ready || pending || busy || execution.lifecycle !== 'Open') return;
    // Snapshot stays fixed through refresh, including same-value newer versions.
    setReview(execution); onLock(true); setMessage('');
  }
  function confirm() {
    if (!review || blocked || busy) return;
    void submit({ schemaVersion: 1, actionId: crypto.randomUUID(), deviceId: crypto.randomUUID(), originatingAccountId: accountId,
      ownershipEpoch, dependsOn: [], commandType: 'FinishExecution', target: { executionId },
      expected: reviewedResults(review), intent: { acknowledgeUnrecorded: unrecordedTargets(review).length > 0 } });
  }
  const unknown = review ? unrecordedTargets(review) : [];
  return <section className="space-y-3 rounded-xl border border-slate-300 p-4" aria-label="Finish workout">
    {message && <p role="status">{message}</p>}
    {pending ? <button className={control} disabled={busy} onClick={() => void submit(pending)}>Check finish again</button> :
      execution.lifecycle === 'Open' && (review ? <><p>{unknown.length ? `${unknown.filter(t => t.required).length} required and ${unknown.filter(t => !t.required).length} optional sets are unrecorded. They will remain unknown, not marked performed or omitted.` : 'All prescribed sets have saved results.'}</p>
        <p>Finish this workout and resolve its planned occurrence? Recorded results can later be corrected without reopening. The next workout will not start automatically.</p>
        <button className={control} disabled={blocked || busy} onClick={confirm}>{unknown.length ? 'Finish with unrecorded sets' : 'Confirm finish'}</button>
        <button className={control} disabled={busy} onClick={() => { setReview(null); onLock(false); }}>Keep working</button></> :
        <><button className="rounded-xl bg-teal-700 px-5 py-3 font-semibold text-white disabled:opacity-40" disabled={blocked || !ready} onClick={begin}>Finish workout</button>
          {blocked && <p>Save, discard, or recover pending result input before finishing.</p>}</>)}
  </section>;
}
