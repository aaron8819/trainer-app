'use client';
import { useEffect, useState, useRef } from 'react';
import type { z } from 'zod';
import { amendmentPreview, amendmentResponse, amendPendingExerciseCommand, type AmendPendingExerciseCommand } from '@/lib/trainer2-contracts/plan-exercise-amendment';
import type { NextWorkoutRead } from '@/lib/trainer2-contracts/execution';
import { canonicalJson } from '@/lib/trainer2-contracts/canonical-json';
import { control } from './DraftEditor';
export function PendingExerciseAmendment({ next, ownershipEpoch, refresh, onLock }: {
  next: NextWorkoutRead; ownershipEpoch: number; refresh: () => Promise<NextWorkoutRead>; onLock: (locked: boolean) => void;
}) {
  const [preview, setPreview] = useState<z.infer<typeof amendmentPreview> | null>(null);
  const [pending, setPending] = useState<AmendPendingExerciseCommand | null>(null);
  const [busy, setBusy] = useState(false), [ready, setReady] = useState(false), [message, setMessage] = useState('');
  const key = `trainer2-amendment:${next.accountId}:${next.planId}`;
  const generation = useRef(0), inFlight = useRef(false);
  useEffect(() => {
    generation.current++; setReady(false); setPending(null); setPreview(null);
    try {
      const stored = sessionStorage.getItem(key);
      if (stored) {
        const value = amendPendingExerciseCommand.parse(JSON.parse(stored));
        if (value.originatingAccountId !== next.accountId || value.target.planId !== next.planId) throw new Error('Wrong account');
        setPending(value); setMessage('An exercise update needs confirmation. Check the original request before continuing.');
      }
      setReady(true);
    } catch { setMessage('Stored update could not be recovered. Keep this tab open and reload before editing.'); }
      return () => { generation.current++; };
  }, [key, next.accountId, next.planId]);
  useEffect(() => { onLock(!ready || busy || !!pending); }, [ready, busy, pending, onLock]);
  async function review() {
    if (inFlight.current) return; inFlight.current = true; const token = generation.current;
    setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/trainer2/plans/amend-exercise-preview', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId: next.planId, intent: { catalogId: 't2:45-degree-back-extension', positions: next.amendmentCandidates } }) });
      if (!response.ok) throw new Error('Preview unavailable');
      const value = amendmentPreview.parse(await response.json());
      if (value.planId !== next.planId || value.expected.planRevisionId !== next.revisionId) throw new Error('Unbound preview');
      if (token === generation.current) setPreview(value);
    } catch { if (token === generation.current) { setMessage('The pending workouts changed. Reload and review again.'); await refresh(); } }
    finally { inFlight.current = false; if (token === generation.current) setBusy(false); }
  }
  async function submit(command: AmendPendingExerciseCommand) {
    if (inFlight.current) return; inFlight.current = true; const token = generation.current;
    setBusy(true); setMessage('Saving exercise update…');
    try {
      sessionStorage.setItem(key, canonicalJson(command)); setPending(command);
      const response = await fetch('/api/trainer2/plans/amend-exercise', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: canonicalJson(command) });
      const value = amendmentResponse.parse(await response.json());
      if (value.outcome.actionId !== command.actionId || (value.outcome.status === 'Accepted' && (!response.ok || value.outcome.result.planId !== next.planId || value.outcome.result.contentHash !== command.expected.effectiveHash || value.outcome.result.version !== command.expected.amendmentVersion + 1))) throw new Error('Unbound outcome');
      // Refresh before unlocking START; delayed/rejected reads cannot expose old prescriptions.
      if (token !== generation.current) return;
      const readback = await refresh();
      if (token !== generation.current) return;
      if (value.outcome.status === 'Accepted' && (BigInt(readback.acceptedSequence) < BigInt(value.outcome.acceptedSequence) || (readback.amendment?.version ?? 0) < value.outcome.result.version ||
        (readback.amendment?.version === value.outcome.result.version && (readback.amendment.contentHash !== value.outcome.result.contentHash || readback.amendment.actionId !== command.actionId)))) throw new Error('Unconfirmed readback');
      sessionStorage.removeItem(key); setPending(null); setPreview(null);
      setMessage(value.outcome.status === 'Accepted' ? 'Pending back extensions updated. Completed and started workouts are unchanged.' : 'The workout state changed. Review the remaining pending workouts again.');
    } catch { if (token === generation.current) setMessage('Update could not be confirmed. Check again to recover the same request.'); }
    finally { inFlight.current = false; if (token === generation.current) setBusy(false); }
  }
  if (!next.amendmentCandidates?.length && !pending && !message) return null;
  return <section className="rounded-xl border border-teal-200 bg-teal-50 p-4" aria-label="Pending exercise update">
    <h2 className="font-semibold">Bodyweight or added plates</h2>
    <p className="text-sm">Use 45-Degree Back Extension in pending workouts. Log 0 lb for bodyweight, or the total weight of plates held. Saved results and started workouts stay unchanged.</p>
    {message && <p role="status">{message}</p>}
    {pending ? <button className={control} disabled={busy} onClick={() => void submit(pending)}>Check exercise update</button> : preview ? <>
      <p>{preview.content.replacements.length} pending exercise positions. Sets, reps, effort and rest stay the same; added weight starts unspecified.</p>
      <button className={control} disabled={!ready || busy} onClick={() => void submit({ schemaVersion: 1, commandType: 'AmendPendingExercise',
        actionId: crypto.randomUUID(), deviceId: crypto.randomUUID(), originatingAccountId: next.accountId, ownershipEpoch, dependsOn: [],
        target: { planId: next.planId }, expected: preview.expected,
        intent: { catalogId: 't2:45-degree-back-extension', positions: preview.content.replacements.map(p => ({ occurrenceId: p.occurrenceId, positionId: p.positionId })) } })}>Confirm pending exercise update</button>
      <button className={control} disabled={busy} onClick={() => setPreview(null)}>Cancel</button>
    </> : !!next.amendmentCandidates?.length && <button className={control} disabled={!ready || busy} onClick={() => void review()}>Review pending back extensions</button>}
  </section>;
}
