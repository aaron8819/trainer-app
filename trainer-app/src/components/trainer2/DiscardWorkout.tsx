'use client';
import { useEffect, useRef, useState } from 'react';
import type { ExecutionRead } from '@/lib/trainer2-contracts/execution';
import { reviewedResults } from '@/lib/trainer2-contracts/workout-finish';
import { discardExecutionCommand, discardResponse, type DiscardExecutionCommand } from '@/lib/trainer2-contracts/discard-execution';
import { canonicalJson } from '@/lib/trainer2-contracts/canonical-json';
import { control } from './DraftEditor';

export function DiscardWorkout({ execution, ownershipEpoch, blocked, refresh, checkResults, onLock }: {
  execution: ExecutionRead; ownershipEpoch: number; blocked: boolean;
  checkResults?: () => Promise<unknown>; refresh: () => Promise<unknown>; onLock: (locked: boolean) => void;
}) {
  const [review, setReview] = useState<ExecutionRead | null>(null), [pending, setPending] = useState<DiscardExecutionCommand | null>(null);
  const [needsCheck, setNeedsCheck] = useState(false);
  const [message, setMessage] = useState(''), [busy, setBusy] = useState(false), [ready, setReady] = useState(false);
  const [staleView, setStaleView] = useState<ExecutionRead | null>(null);
  const wasReview = useRef(false);
  const trigger = useRef<HTMLButtonElement>(null), cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (review) cancel.current?.focus(); else if (wasReview.current) trigger.current?.focus(); wasReview.current = !!review; }, [review]);
  const alive = useRef(false), flight = useRef(false);
  const accountId = execution.initial.accountId, executionId = execution.executionId;
  const key = `trainer2-discard:${accountId}:${executionId}`;
  useEffect(() => {
    alive.current = true;
    try {
      const raw = sessionStorage.getItem(key);
      if (raw) {
        const command = discardExecutionCommand.parse(JSON.parse(raw));
        if (command.originatingAccountId !== accountId || command.target.executionId !== executionId || command.target.occurrenceId !== execution.initial.occurrence.id) throw new Error('Wrong discard');
        setPending(command); onLock(true); setMessage('Discard could not be confirmed. Check discard again to recover the original request.');
      }
      setReady(true);
    } catch { onLock(true); setMessage('The retained discard request could not be read. Recover browser storage before discarding.'); }
    return () => { alive.current = false; };
    // This component is keyed by account and execution.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  async function submit(command: DiscardExecutionCommand) {
    if (flight.current) return;
    try { sessionStorage.setItem(key, canonicalJson(command)); }
    catch { setMessage('Browser storage is unavailable. Keep this page open and try again.'); return; }
    flight.current = true; setBusy(true); setPending(command); onLock(true);
    try {
      const response = await fetch('/api/trainer2/executions/discard', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: canonicalJson(command) });
      const { outcome } = discardResponse.parse(await response.json());
      if (!alive.current) return;
      if (outcome.actionId !== command.actionId || (outcome.status === 'Accepted' && (!response.ok ||
        outcome.result.executionId !== executionId || outcome.result.planId !== execution.initial.planId ||
        outcome.result.occurrenceId !== execution.initial.occurrence.id))) throw new Error('Unbound discard');
      if (outcome.status === 'Accepted') {
        // A replay is historical. Load authoritative discard before clearing delivery state.
        await refresh(); if (!alive.current) return;
        sessionStorage.removeItem(key); setPending(null); setReview(null); onLock(false); setMessage('Workout attempt discarded.');
      } else {
        sessionStorage.removeItem(key); setPending(null); setReview(null); onLock(false); setStaleView(execution);
        setNeedsCheck(true); setMessage('Discard was not accepted. Refresh saved results and make a new discard decision. Your input is retained.');
      }
    } catch { if (alive.current) setMessage('Discard could not be confirmed. Check discard again with the original request.'); }
    finally { flight.current = false; if (alive.current) setBusy(false); }
  }
  function begin() {
    if (blocked || !ready || pending || busy || execution.lifecycle !== 'Open' || !empty || staleView === execution) return;
    // Snapshot stays fixed through refresh, including same-value newer versions.
    setReview(execution); onLock(true); setMessage('');
  }
  function confirm() {
    if (!review || blocked || busy) return;
    void submit({ schemaVersion: 1, actionId: crypto.randomUUID(), deviceId: crypto.randomUUID(), originatingAccountId: accountId,
      ownershipEpoch, dependsOn: [], commandType: 'DiscardEmptyExecution', target: { executionId, occurrenceId: review.initial.occurrence.id },
      expected: reviewedResults(review), intent: {} });
  }
  const empty = !execution.exerciseAdditions?.length && !execution.additions?.length && !execution.skips?.length && execution.history?.length === 0 && execution.results.length === 0;
  if ((execution.lifecycle !== 'Open' || !empty) && !pending && !message) return null;
  return <details open={pending || review || message ? true : undefined}><summary className="min-h-11 cursor-pointer py-3 text-sm">Workout menu</summary><section className="space-y-3 rounded-xl border border-slate-300 p-4" aria-label="Discard empty workout">
    {message && <p role="status">{message}</p>}
    {needsCheck && checkResults && <button className={control} disabled={busy} onClick={async () => {
      setBusy(true); setMessage('Checking…');
      try { await checkResults(); setNeedsCheck(false); setMessage('Results are up to date. Review them before making a new decision.'); }
      catch { setMessage('Could not check saved results. Try again when connected.'); }
      finally { setBusy(false); }
    }}>Review latest values</button>}
    {pending ? <button className={`${control} min-h-11`} disabled={busy} onClick={() => void submit(pending)}>Check discard again</button> :
      execution.lifecycle === 'Open' && (review ? <div role="group" aria-label="Confirm discard">
        <p>This removes this workout attempt. The workout will still be next in your plan.</p>
        <p>The attempted start and audit history stay saved.</p>
        <button className={`${control} min-h-11`} disabled={blocked || busy} onClick={confirm}>Confirm discard</button>
        <button ref={cancel} className={`${control} min-h-11`} disabled={busy} onClick={() => { setReview(null); onLock(false); }}>Cancel</button>
      </div> : <><button ref={trigger} className={`${control} min-h-11`} disabled={blocked || !ready || !empty || staleView === execution} onClick={begin}>Discard empty workout</button>
        {!empty ? <p>Workouts with logged or skipped set history cannot be discarded, even after a result is cleared.</p> : blocked && <p>Save, cancel, or recover result input before discarding.</p>}</>)}
  </section></details>;
}
