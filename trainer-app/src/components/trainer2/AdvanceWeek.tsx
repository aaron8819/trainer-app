'use client';
import { useEffect, useRef, useState } from 'react';
import type { NextWorkoutRead } from '@/lib/trainer2-contracts/execution';
import { advanceWeekCommand, advanceWeekResponse, type AdvanceWeekCommand } from '@/lib/trainer2-contracts/advance-week';
import { canonicalJson } from '@/lib/trainer2-contracts/canonical-json';
import { control } from './DraftEditor';

export function AdvanceWeek({ next, ownershipEpoch, blocked, refresh, onLock }: {
  next: NextWorkoutRead; ownershipEpoch: number; blocked: boolean;
  refresh: () => Promise<NextWorkoutRead>; onLock: (locked: boolean) => void;
}) {
  const [pending, setPending] = useState<AdvanceWeekCommand | null>(null);
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const alive = useRef(false), flight = useRef(false);
  const key = `trainer2-advance:${next.accountId}:${next.planId}`;
  useEffect(() => {
    alive.current = true;
    try {
      const raw = sessionStorage.getItem(key);
      if (raw) {
        const command = advanceWeekCommand.parse(JSON.parse(raw));
        if (command.originatingAccountId !== next.accountId || command.target.planId !== next.planId) throw new Error('Wrong advancement');
        setPending(command); onLock(true); setMessage('Continue could not be confirmed. Check again to recover the original request.');
      } else onLock(false);
      setReady(true);
    } catch { onLock(true); setMessage('The saved continue request could not be read. Recover browser storage before continuing.'); }
    return () => { alive.current = false; };
    // The parent keys this component by account and plan, retaining pending identity across reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  async function submit(command: AdvanceWeekCommand) {
    if (flight.current) return;
    try { sessionStorage.setItem(key, canonicalJson(command)); }
    catch { setMessage('Browser storage is unavailable. Keep this page open and try again.'); return; }
    flight.current = true; setBusy(true); setPending(command); onLock(true);
    try {
      const response = await fetch('/api/trainer2/weeks/advance', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: canonicalJson(command) });
      const { outcome } = advanceWeekResponse.parse(await response.json());
      if (!alive.current) return;
      if (outcome.actionId !== command.actionId) throw new Error('Unbound advancement');
      if (outcome.status === 'Accepted') {
        const result = outcome.result;
        if (!response.ok || result.planId !== command.target.planId || result.revisionId !== command.expected.planRevisionId ||
          result.fromWeek !== command.expected.weekIndex || result.toWeek !== result.fromWeek + (result.planCompleted ? 0 : 1) ||
          BigInt(outcome.acceptedSequence) !== BigInt(command.expected.acceptedSequence) + BigInt(1)) throw new Error('Unbound advancement');
        const value = await refresh();
        if (!value.week || value.revisionId !== result.revisionId || BigInt(value.acceptedSequence) < BigInt(outcome.acceptedSequence) ||
          value.week.index < result.toWeek || (result.planCompleted && value.lifecycle !== 'Completed')) throw new Error('Advancement readback unavailable');
        setMessage(result.planCompleted ? 'Program complete.' : 'Next week ready.');
      } else {
        await refresh(); setMessage('The week changed. Review the current week before continuing.');
      }
      if (!alive.current) return;
      sessionStorage.removeItem(key); setPending(null); onLock(false);
    } catch { if (alive.current) setMessage('Continue could not be confirmed. Check again with the original request.'); }
    finally { flight.current = false; if (alive.current) setBusy(false); }
  }
  function continueWeek() {
    if (!next.week || !next.week.ready || next.execution || next.lifecycle !== 'Active' || blocked || !ready || busy) return;
    void submit({ schemaVersion: 1, commandType: 'AdvanceWeek', actionId: crypto.randomUUID(), deviceId: crypto.randomUUID(),
      originatingAccountId: next.accountId, ownershipEpoch, dependsOn: [], target: { planId: next.planId },
      expected: { planRevisionId: next.revisionId, acceptedSequence: next.acceptedSequence, weekIndex: next.week.index, firstOccurrenceId: next.week.firstOccurrenceId }, intent: {} });
  }
  return <section aria-label="Continue program" className="space-y-3">
    {message && <p role="status">{message}</p>}
    {pending ? <button className={`${control} min-h-11`} disabled={busy} onClick={() => void submit(pending)}>Check continue again</button> :
      next.week?.ready && next.lifecycle === 'Active' && <><p>All workouts in this week are completed or skipped. Your completed week remains available for review.</p>
        <button className={`${control} min-h-11`} disabled={!ready || blocked || busy || !!next.execution} onClick={continueWeek}>{next.week.final ? 'Complete program' : 'Continue to next week'}</button></>}
  </section>;
}
