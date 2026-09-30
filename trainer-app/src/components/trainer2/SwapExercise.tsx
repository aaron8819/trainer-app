'use client';
import { useEffect, useRef, useState } from 'react';
import type { ExecutionRead } from '@/lib/trainer2-contracts/execution';
import { swapExerciseCommand, swapPreview, swapResponse, type SwapExerciseCommand } from '@/lib/trainer2-contracts/exercise-swap';
import { currentAssignment, swapEligible, effectiveOccurrence } from '@/lib/engine/trainer2/exercise-swap';
import { library, matchesCatalogSearch } from '@/lib/engine/trainer2/catalog';
import { canonicalJson } from '@/lib/trainer2-contracts/canonical-json';
import { targetLabel } from './training-summary';
import { fetchWithRecovery } from './request-recovery';

const control = 'min-h-11 rounded-full border border-slate-300 px-4 py-2 text-sm disabled:opacity-40';
export function SwapExercise({ execution, positionId, ownershipEpoch, locked, refresh, onLock, onChanged }: {
  execution: ExecutionRead; positionId: string; ownershipEpoch: number; locked: boolean;
  refresh: () => Promise<ExecutionRead>; onLock: (locked: boolean) => void; onChanged: () => void;
}) {
  const [open, setOpen] = useState(false), [query, setQuery] = useState(''), [equipment, setEquipment] = useState('');
  const [preview, setPreview] = useState<ReturnType<typeof swapPreview.parse> | null>(null);
  const [pending, setPending] = useState<SwapExerciseCommand | null>(null), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const dialog = useRef<HTMLDialogElement>(null), trigger = useRef<HTMLButtonElement>(null), alive = useRef(true), request = useRef(0), flight = useRef(false);
  const key = `trainer2-swap:${execution.initial.accountId}:${execution.executionId}:${positionId}`;
  const discardKey = `${key}:discard`;
  const [unreadablePending, setUnreadablePending] = useState(false);
  const owned = execution.initial.positions.find(p => p.id === positionId)!;
  const original = execution.initial.occurrence.positions.find(p => p.id === owned.sourcePositionId)!;
  const effective = effectiveOccurrence(execution).positions.find(p => p.id === original.id)!;
  const metadata = library.find(e => effective.exercise.kind === 'catalogSnapshot' && e.catalogId === effective.exercise.catalogId);
  const equipmentOptions = [...new Set(library.flatMap(e => e.equipment))].sort();
  const score = (entry: typeof library[number]) => metadata ? entry.movementPatterns.filter(m => metadata.movementPatterns.includes(m)).length * 100 +
    entry.primaryMuscles.filter(m => metadata.primaryMuscles.includes(m)).length * 10 + entry.secondaryMuscles.filter(m => metadata.secondaryMuscles.includes(m)).length * 2 +
    entry.equipment.filter(m => metadata.equipment.includes(m)).length : 0;
  const entries = library.filter(e => matchesCatalogSearch(e, query) && (!equipment || e.equipment.includes(equipment)))
    .sort((a,b) => score(b)-score(a) || a.name.localeCompare(b.name) || a.catalogId.localeCompare(b.catalogId));
  useEffect(() => {
    alive.current = true;
    try { const raw = sessionStorage.getItem(key); if (raw) {
      const saved = swapExerciseCommand.parse(JSON.parse(raw));
      if (saved.originatingAccountId !== execution.initial.accountId || saved.target.executionId !== execution.executionId || saved.target.positionId !== positionId) throw new Error('Invalid pending swap');
      setPending(saved); setMessage('Exercise change could not be confirmed. Check again.');
    } } catch { setUnreadablePending(true); setMessage('The retained exercise change could not be read. Reload to recover it.'); }
    return () => { alive.current = false; };
    // Identity scopes this controller; retained exact envelopes survive reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { onLock(open || !!pending || busy || unreadablePending); return () => onLock(false); }, [open, pending, busy, unreadablePending, onLock]);
  useEffect(() => { if (open && !dialog.current?.open) dialog.current?.showModal(); }, [open]);
  function close() { ++request.current; setOpen(false); setBusy(false); setPreview(null); dialog.current?.close(); trigger.current?.focus(); }
  async function choose(intent: SwapExerciseCommand['intent']) {
    const token = ++request.current; setBusy(true); setMessage(''); setPreview(null);
    try {
      const response = await fetch('/api/trainer2/executions/swap-exercise-preview', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: canonicalJson({ executionId: execution.executionId, positionId, intent }) });
      if (!response.ok) throw new Error('Preview unavailable');
      const value = swapPreview.parse(await response.json());
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonicalJson(value.content)))),b=>b.toString(16).padStart(2,'0')).join('');
      if (value.executionId !== execution.executionId || value.assignment.positionId !== positionId || value.content.positionId !== positionId ||
        value.contentHash !== execution.contentHash || value.effectiveHash !== digest || value.content.restoreOriginal !== intent.restoreOriginal ||
        (!intent.restoreOriginal && (value.content.exercise.kind !== 'catalogSnapshot' || value.content.exercise.catalogId !== intent.catalogId)) ||
        canonicalJson(value.assignment) !== canonicalJson(currentAssignment(execution, positionId))) throw new Error('Stale preview');
      if (alive.current && token === request.current) setPreview(value);
    } catch { if (alive.current && token === request.current) setMessage('Exercise changed or is unavailable. Review the workout before trying again.'); }
    finally { if (alive.current && token === request.current) setBusy(false); }
  }
  async function submit(command: SwapExerciseCommand) {
    if (flight.current) return;
    flight.current = true; setBusy(true);
    try {
      sessionStorage.setItem(key, canonicalJson(command)); setPending(command);
      const response = await fetchWithRecovery('/api/trainer2/executions/swap-exercise', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: canonicalJson(command) }, () => alive.current);
      const { outcome } = swapResponse.parse(await response.json());
      if (!alive.current) return;
      if (outcome.actionId !== command.actionId) throw new Error('Unbound exercise change');
      if (outcome.status !== 'Accepted') {
        sessionStorage.removeItem(key); sessionStorage.removeItem(discardKey); setPending(null); setPreview(null);
        await refresh(); setMessage('Exercise changed on another device—review before logging.'); return;
      }
      if (!response.ok || outcome.result.executionId !== execution.executionId || outcome.result.positionId !== positionId ||
        outcome.result.version !== command.expected.assignment.version + 1 || outcome.result.contentHash !== command.expected.effectiveHash) throw new Error('Unbound exercise change');
      const latest = await refresh();
      if (!alive.current) return;
      if (!latest.swaps?.some(s => s.actionId === command.actionId && s.positionId === positionId && s.version === outcome.result.version && s.contentHash === outcome.result.contentHash)) throw new Error('Unconfirmed change');
      // Confirmation authorizes only the exact input reviewed then. Later edits survive recovery.
      const authorized = JSON.parse(sessionStorage.getItem(discardKey) ?? '{}') as Record<string, string>;
      for (const target of owned.targets) {
        const draftKey = `trainer2-result:${execution.initial.accountId}:${execution.executionId}:${target.id}`;
        const raw = sessionStorage.getItem(draftKey);
        if (raw && raw === authorized[draftKey] && !JSON.parse(raw).pending) sessionStorage.removeItem(draftKey);
      }
      sessionStorage.removeItem(discardKey);
      sessionStorage.removeItem(key); setPending(null); close(); onChanged();
      if (currentAssignment(latest, positionId).version > outcome.result.version)
        setMessage('Exercise changed on another device—review before logging.');
    } catch { if (alive.current) setMessage('Exercise change could not be confirmed. Check again with the original request.'); }
    finally { flight.current = false; if (alive.current) setBusy(false); }
  }
  function confirm() {
    if (!preview || busy || pending || locked) return;
    // Inspect every position draft, including hidden sets, before authorizing discard.
    let edited = false;
    const authorized: Record<string, string> = {};
    try { for (const target of owned.targets) {
      const raw = sessionStorage.getItem(`trainer2-result:${execution.initial.accountId}:${execution.executionId}:${target.id}`);
      if (raw) { const draft = JSON.parse(raw); if (draft.pending) { setMessage('Resolve the pending set save or skip before swapping.'); return; } edited = true; authorized[`trainer2-result:${execution.initial.accountId}:${execution.executionId}:${target.id}`] = raw; }
    } } catch { setMessage('Retained input could not be checked. Reload before swapping.'); return; }
    if (edited && !window.confirm('Discard this exercise’s unsaved input and swap?')) return;
    try { sessionStorage.setItem(discardKey, JSON.stringify(authorized)); } catch { setMessage('Input could not be retained. Try again.'); return; }
    const intent: SwapExerciseCommand['intent'] = preview.content.restoreOriginal ? { restoreOriginal: true } :
      { restoreOriginal: false, catalogId: preview.content.exercise.kind === 'catalogSnapshot' ? preview.content.exercise.catalogId : '' };
    void submit(swapExerciseCommand.parse({ schemaVersion: 1, actionId: crypto.randomUUID(), deviceId: crypto.randomUUID(), originatingAccountId: execution.initial.accountId,
      ownershipEpoch, dependsOn: [], commandType: 'SwapExercise', target: { executionId: execution.executionId, positionId }, intent,
      expected: { contentHash: preview.contentHash, assignment: preview.assignment, instructionEpoch: preview.instructionEpoch, effectiveHash: preview.effectiveHash } }));
  }
  function showPicker() {
    try { for (const target of owned.targets) {
      const raw = sessionStorage.getItem(`trainer2-result:${execution.initial.accountId}:${execution.executionId}:${target.id}`);
      if (raw && JSON.parse(raw).pending) { setMessage('Resolve the pending set save or skip before swapping.'); return; }
    } } catch { setMessage('Retained input could not be checked. Reload before swapping.'); return; }
    setOpen(true); setMessage('');
  }
  return <>
    {swapEligible(execution, positionId) && <button ref={trigger} className="min-h-11 min-w-20 shrink-0 rounded-full border border-slate-200 px-3 text-xs font-semibold disabled:opacity-40" disabled={locked || busy || !!pending || unreadablePending} onClick={showPicker}>Swap</button>}
    {pending && <button className={control} disabled={busy} onClick={() => void submit(pending)}>Check swap again</button>}
    {!open && message && <p role="status">{message}</p>}
    {open && <dialog ref={dialog} aria-labelledby={`swap-title-${positionId}`} onCancel={e => { e.preventDefault(); if (!pending) close(); }} className="m-auto max-h-[90dvh] w-[min(96vw,640px)] overflow-y-auto rounded-2xl p-4 backdrop:bg-black/40">
      <div className="flex items-center justify-between"><h2 id={`swap-title-${positionId}`} className="text-lg font-semibold">Swap exercise</h2><button className={control} disabled={!!pending} onClick={close}>Close</button></div>
      <p className="my-2 text-sm">Today only · replaces {original.exercise.name}</p>
      <label className="block text-sm">Search library<input autoFocus className="my-2 min-h-11 w-full rounded-lg border p-2" value={query} onChange={e => setQuery(e.target.value)} /></label>
      <label className="block text-sm">Equipment<select className="my-2 min-h-11 w-full rounded-lg border p-2" value={equipment} onChange={e => setEquipment(e.target.value)}><option value="">All equipment</option>{equipmentOptions.map(e => <option key={e}>{e}</option>)}</select></label>
      {currentAssignment(execution, positionId).version > 0 && <button className={control} disabled={busy || !!pending} onClick={() => void choose({ restoreOriginal: true })}>Return to original</button>}
      <h3 className="my-2 font-semibold">{query ? 'Library results' : 'Similar exercises first'}</h3>
      <ul className="max-h-64 overflow-y-auto">{entries.map(e => <li key={e.catalogId} className="border-b py-2"><button className="min-h-11 w-full text-left disabled:text-slate-500" disabled={!e.selectable || busy || !!pending} onClick={() => void choose({ restoreOriginal: false, catalogId: e.catalogId })}>{e.name}<span className="block text-xs">{e.equipment.join(' · ')}{!e.selectable && ` · ${e.unavailableReason}`}</span></button></li>)}</ul>
      {preview && <section className="my-3 rounded-lg border p-3"><h3 className="font-semibold">Preview · {preview.content.exercise.name}</h3>{preview.targetsChanged && <p>Rep targets change for this exercise.</p>}<ol>{preview.content.targets.map((t,i) => <li key={t.id} className="text-sm">Set {i+1} · {targetLabel(t)}</li>)}</ol><p className="text-sm">{preview.suggestedLoad === null ? 'Weight left blank for manual entry.' : `${preview.suggestedLoad} lb suggested`}</p><p className="text-sm">{original.role ?? 'Exercise'} · rest {original.role === 'Main lift' ? 180 : 120} seconds. Current timer continues.</p><button className={`${control} mt-3 bg-black text-white`} disabled={busy || !!pending} onClick={confirm}>Confirm swap</button></section>}
      {message && <p role="status" className="my-2">{message}</p>}
      {pending && <button className={control} disabled={busy} onClick={() => void submit(pending)}>Check swap again</button>}
    </dialog>}
  </>;
}
