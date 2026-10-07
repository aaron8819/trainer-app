'use client';
import { useEffect, useRef, useState } from 'react';
import type { ExecutionRead } from '@/lib/trainer2-contracts/execution';
import { addExerciseCommand, addExerciseResponse, type AddExerciseCommand } from '@/lib/trainer2-contracts/add-exercise';
import { catalog, catalogExercise } from '@/lib/engine/trainer2/catalog';
import type { DraftDocument } from '@/lib/trainer2-contracts/draft';
import { ExercisePicker } from './ExercisePicker';
import { canonicalJson } from '@/lib/trainer2-contracts/canonical-json';
import { fetchWithRecovery } from './request-recovery';

export function AddExercise({ execution, ownershipEpoch, locked, refresh, onLock, onAdded }: {
  execution: ExecutionRead; ownershipEpoch: number; locked: boolean;
  refresh: () => Promise<ExecutionRead>; onLock?: (value: boolean) => void; onAdded?: (id: string) => void;
}) {
  const trigger = useRef<HTMLButtonElement>(null), dialog = useRef<HTMLDialogElement>(null);
  const [picker, setPicker] = useState(false), [entry, setEntry] = useState<DraftDocument['occurrences'][number]['positions'][number]['exercise'] | null>(null);
  const [sets, setSets] = useState('2'), [min, setMin] = useState('8'), [max, setMax] = useState('12'), [rir, setRir] = useState(execution.initial.occurrence.positions.flatMap(p => p.targets).find(t => t.classification === 'working')?.rir ?? ''), [weight, setWeight] = useState('');
  const configured = useRef(false);
  useEffect(() => { if (entry) { configured.current = true; dialog.current?.showModal(); } else if (configured.current) requestAnimationFrame(() => { if (!document.querySelector('dialog[open]')) trigger.current?.focus(); }); }, [entry]);
  const [pending, setPending] = useState<AddExerciseCommand | null>(null), [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(''), [ready, setReady] = useState(false);
  const alive = useRef(false), flight = useRef(false);
  const key = `trainer2-add-exercise:${execution.initial.accountId}:${execution.executionId}`;
  useEffect(() => {
    alive.current = true;
    try {
      const raw = sessionStorage.getItem(key);
      if (raw) {
        const command = addExerciseCommand.parse(JSON.parse(raw));
        if (command.originatingAccountId !== execution.initial.accountId || command.target.executionId !== execution.executionId) throw new Error('Wrong addition');
        setPending(command); setMessage('Exercise addition could not be confirmed. Check again.');
      }
      setReady(true);
    } catch { setMessage('The retained addition could not be read. Recover browser storage before continuing.'); }
    return () => { alive.current = false; };
    // Identity-scoped exact envelopes survive same-tab reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { onLock?.(!ready || busy || !!pending); return () => onLock?.(false); }, [ready, busy, pending, onLock]);
  async function submit(command: AddExerciseCommand) {
    if (flight.current) return;
    flight.current = true; setBusy(true);
    try {
      sessionStorage.setItem(key, canonicalJson(command)); setPending(command);
      const response = await fetchWithRecovery('/api/trainer2/executions/add-exercise', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: canonicalJson(command) }, () => alive.current);
      const { outcome } = addExerciseResponse.parse(await response.json());
      if (!alive.current) return;
      if (outcome.actionId !== command.actionId) throw new Error('Unbound addition');
      if (outcome.status !== 'Accepted') {
        await refresh();
        sessionStorage.removeItem(key); setPending(null); setMessage('Workout or exercise changed. Your input is retained; review before adding again.'); return;
      }
      if (!response.ok || outcome.result.executionId !== command.target.executionId) throw new Error('Unbound addition');
      const latest = await refresh();
      if (!alive.current) return;
      const fact = latest.exerciseAdditions?.find(a => a.actionId === command.actionId);
      if (!fact || fact.content.position.id !== outcome.result.positionId || fact.content.ordinal !== outcome.result.ordinal || fact.contentHash !== outcome.result.contentHash) throw new Error('Unconfirmed addition');
      sessionStorage.removeItem(key); setPending(null); setMessage('');
      if (latest.lifecycle === 'Open') onAdded?.(fact.content.position.targets[0].id);
    } catch { if (alive.current) setMessage('Exercise addition could not be confirmed. Check again with the original request.'); }
    finally { flight.current = false; if (alive.current) setBusy(false); }
  }
  function makeIntent() {
    if (entry?.kind !== 'catalogSnapshot') return {};
    const found = catalog.find(e => e.id === entry.catalogId)!;
    let startingLoad: unknown = null;
    if (entry.loadKind === 'bodyweight') startingLoad = { kind: 'bodyweight', convention: 'bodyweightOnly' };
    else if (weight !== '') startingLoad = { kind: entry.loadKind, convention: entry.convention, value: weight, unit: 'lb',
      zeroMeaning: entry.loadKind === 'addedLoad' ? 'noAddedLoad' : entry.loadKind === 'assistance' ? 'noAssistance' : found.catalogFacts?.externalZeroMeaning ?? 'validZero' };
    return { catalogId: entry.catalogId, sets: Number(sets), reps: { min: Number(min), max: Number(max), basis: entry.repBasis }, rir: rir || null, startingLoad };
  }
  function add() {
    if (!ready || locked || pending || busy || execution.lifecycle !== 'Open') return;
    const parsed = addExerciseCommand.safeParse({ schemaVersion: 1, commandType: 'AddExercise', actionId: crypto.randomUUID(), deviceId: crypto.randomUUID(),
      originatingAccountId: execution.initial.accountId, ownershipEpoch, dependsOn: [], target: { executionId: execution.executionId, },
      expected: { contentHash: execution.contentHash }, intent: makeIntent() });
    if (!parsed.success) { setMessage('Review the set count, rep range, RIR and starting weight.'); return; }
    dialog.current?.close(); setEntry(null); void submit(parsed.data);
  }
  return <>
    {picker && trigger.current && <ExercisePicker trigger={trigger.current} fallback={() => trigger.current} equipment={[]} qualifiedOnly close={() => setPicker(false)} choose={exercise => {
      if (exercise.kind !== 'catalogSnapshot') return;
      const found = catalog.find(e => e.id === exercise.catalogId); if (!found) return;
      setMin(String(found.reps.min)); setMax(String(found.reps.max)); setSets('2'); setWeight(''); setEntry(catalogExercise(found)); setPicker(false);
    }} />}
    {entry && <dialog ref={dialog} onCancel={() => setEntry(null)} aria-label="Configure added exercise" className="m-auto w-[calc(100%-1rem)] max-w-sm rounded-2xl p-4 backdrop:bg-slate-900/40">
      <form className="space-y-3" onSubmit={e => { e.preventDefault(); add(); }}>
        <h2 className="font-semibold">{entry.name}</h2>
        <label className="block text-sm">Working sets<input autoFocus className="mt-1 w-full rounded-lg border p-2" type="number" min="1" max="20" value={sets} onChange={e => setSets(e.target.value)} /></label>
        <div className="flex gap-2">{[['Minimum reps',min,setMin],['Maximum reps',max,setMax]].map(([label,value,setter]) => <label key={label as string} className="text-sm">{label as string}<input className="mt-1 w-full rounded-lg border p-2" type="number" min="1" max="1000" value={value as string} onChange={e => (setter as (s:string)=>void)(e.target.value)} /></label>)}</div>
        <label className="block text-sm">Target RIR<input className="mt-1 w-full rounded-lg border p-2" inputMode="decimal" value={rir} onChange={e => setRir(e.target.value)} /></label>
        {entry.kind === 'catalogSnapshot' && entry.loadKind !== 'bodyweight' && <label className="block text-sm">Optional starting {entry.loadKind === 'assistance' ? 'assistance' : 'weight'} (lbs)<input className="mt-1 w-full rounded-lg border p-2" inputMode="decimal" value={weight} onChange={e => setWeight(e.target.value)} /><span className="text-xs text-slate-500">{{ barbellTotal: 'Total barbell weight', perImplement: 'Weight per implement', machineAddedPlatesTotal: 'total machine plates added', machinePlatesPerArm: 'plates added per arm', smithPlatesTotal: 'total Smith plates added', machineDisplayed: 'Machine weight', bodyweightOnly: 'Bodyweight', addedExternal: 'Added weight', displayedAssistance: 'Displayed assistance' }[entry.convention]}</span></label>}
        <div className="flex gap-2"><button type="submit" className="min-h-11 rounded-lg bg-black px-4 text-white">Add exercise</button><button type="button" className="min-h-11 px-4" onClick={() => { dialog.current?.close(); setEntry(null); }}>Cancel</button></div>
        {message && <p role="status" className="text-sm">{message}</p>}
      </form>
    </dialog>}
    {execution.lifecycle === 'Open' && !pending && <button type="button" disabled={!ready || locked || busy}
      className="inline-flex min-h-11 items-center justify-center rounded-full border border-dashed border-slate-300 bg-slate-50 px-3 text-xs font-semibold text-slate-700 disabled:opacity-60" ref={trigger} onClick={() => setPicker(true)}>+ Add exercise</button>}
    {pending && <button type="button" disabled={busy} className="min-h-11 rounded-lg border px-3 py-2 text-sm" onClick={() => void submit(pending)}>Check addition again</button>}
    {message && <p role="status" className="w-full text-sm text-slate-600">{message}</p>}
  </>;
}
