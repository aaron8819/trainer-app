'use client';
import { useEffect, useRef, useState } from 'react';
import type { NextWorkoutRead } from '@/lib/trainer2-contracts/execution';
import { skipOccurrenceCommand, skipResponse, type SkipOccurrenceCommand } from '@/lib/trainer2-contracts/skip-occurrence';
import { canonicalJson } from '@/lib/trainer2-contracts/canonical-json';
import { control } from './DraftEditor';

export function SkipWorkout({ next, ownershipEpoch, blocked, refresh, onLock }: {
  next: NextWorkoutRead; ownershipEpoch: number; blocked: boolean;
  refresh: (command?: SkipOccurrenceCommand, planCompleted?: boolean) => Promise<void>; onLock: (locked: boolean) => void;
}) {
  const [review, setReview] = useState<NextWorkoutRead | null>(null);
  const [pending, setPending] = useState<SkipOccurrenceCommand | null>(null);
  const [message, setMessage] = useState(''), [busy, setBusy] = useState(false), [ready, setReady] = useState(false);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null), cancel = useRef<HTMLButtonElement>(null), wasReview = useRef(false);
  const alive = useRef(false), flight = useRef(false);
  const key = `trainer2-skip:${next.accountId}:${next.planId}`;
  const stale = !!review && (review.acceptedSequence !== next.acceptedSequence || review.revisionId !== next.revisionId ||
    review.occurrence?.id !== next.occurrence?.id || next.lifecycle !== 'Active' || !!next.execution);
  useEffect(() => { if (review) cancel.current?.focus(); else if (wasReview.current) trigger.current?.focus(); wasReview.current = !!review; }, [review]);
  useEffect(() => {
    alive.current = true;
    try {
      const raw = sessionStorage.getItem(key);
      if (raw) {
        const command = skipOccurrenceCommand.parse(JSON.parse(raw));
        if (command.originatingAccountId !== next.accountId || command.target.planId !== next.planId) throw new Error('Wrong skip');
        setPending(command); onLock(true); setMessage('Skip could not be confirmed. Check skip again to recover the original request.');
      }
      if (!raw) onLock(false);
      setReady(true);
    } catch { onLock(true); setMessage('The saved skip request could not be read. Recover browser storage before continuing.'); }
    return () => { alive.current = false; };
    // The parent retains this component through next-occurrence changes, keyed by account/plan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  async function submit(command: SkipOccurrenceCommand) {
    if (flight.current) return;
    try { sessionStorage.setItem(key, canonicalJson(command)); }
    catch { setMessage('Browser storage is unavailable. Keep this page open and try again.'); return; }
    flight.current = true; setBusy(true); setPending(command); onLock(true);
    try {
      const response = await fetch('/api/trainer2/occurrences/skip', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: canonicalJson(command) });
      const { outcome } = skipResponse.parse(await response.json());
      if (!alive.current) return;
      if (outcome.actionId !== command.actionId || (outcome.status === 'Accepted' && (!response.ok ||
        outcome.result.planId !== command.target.planId || outcome.result.revisionId !== command.expected.planRevisionId ||
        outcome.result.occurrenceId !== command.target.occurrenceId || BigInt(outcome.acceptedSequence) !== BigInt(command.expected.acceptedSequence) + BigInt(1)))) throw new Error('Unbound skip');
      if (outcome.status === 'Accepted') {
        // Historical acceptance never supplies present plan state. The parent validates
        // current readback AND the exact immutable skip before publishing it.
        await refresh(command, outcome.result.planCompleted); if (!alive.current) return;
        sessionStorage.removeItem(key); setPending(null); setReview(null); onLock(false); setMessage('Workout marked skipped.');
      } else {
        sessionStorage.removeItem(key); setPending(null); setReview(null); onLock(false); setNeedsRefresh(true);
        setMessage('The workout changed. Refresh and make a new skip decision.');
      }
    } catch { if (alive.current) setMessage('Skip could not be confirmed. Check skip again with the original request.'); }
    finally { flight.current = false; if (alive.current) setBusy(false); }
  }
  function confirm() {
    if (!review?.occurrence || stale || blocked || busy) return;
    void submit({ schemaVersion: 1, commandType: 'SkipOccurrence', actionId: crypto.randomUUID(), deviceId: crypto.randomUUID(),
      originatingAccountId: review.accountId, ownershipEpoch, dependsOn: [], target: { planId: review.planId, occurrenceId: review.occurrence.id },
      expected: { planRevisionId: review.revisionId, acceptedSequence: review.acceptedSequence }, intent: {} });
  }
  const eligible = next.lifecycle === 'Active' && !!next.occurrence && !next.execution;
  const reviewedOccurrence = review?.occurrences.find(o => o.occurrenceId === review.occurrence?.id);
  return <section aria-label="Skip workout" className="space-y-3">
    {message && <p role="status">{message}</p>}
    {pending ? <button className={`${control} min-h-11`} disabled={busy} onClick={() => void submit(pending)}>Check skip again</button> : review ?
      <div role="group" aria-label="Confirm skip" className="space-y-3 rounded-xl border border-slate-300 p-4">
        <p>Skip {reviewedOccurrence?.name}, {reviewedOccurrence?.stageName} · Workout {review.occurrences.findIndex(o => o.occurrenceId === reviewedOccurrence?.occurrenceId) + 1} of {review.occurrences.length}?</p>
        <p>It will be marked skipped and the plan will move on.{review.occurrences.filter(o => o.status === 'Pending').length === 1 ? ' This is the final workout. Skipping it will finish the plan.' : ''}</p>
        {stale && <p role="status">The next workout changed. Cancel and review the current workout.</p>}
        <button className={`${control} min-h-11`} disabled={blocked || busy || stale} onClick={confirm}>Confirm skip</button>
        <button ref={cancel} className={`${control} min-h-11`} disabled={busy} onClick={() => { setReview(null); onLock(false); }}>Cancel</button>
      </div> : needsRefresh ? <button className={`${control} min-h-11`} onClick={async () => {
        try { await refresh(); if (alive.current) { setNeedsRefresh(false); setMessage(''); } } catch { /* keep recovery visible */ }
      }}>Refresh workout</button> : eligible && <button ref={trigger} className={`${control} min-h-11`} disabled={!ready || blocked || busy} onClick={() => {
        setReview(next); onLock(true); setMessage('');
      }}>Skip workout</button>}
  </section>;
}
