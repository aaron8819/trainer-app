'use client';
import { useEffect, useRef, useState } from 'react';
import type { ExecutionRead } from '@/lib/trainer2-contracts/execution';
import type { SavedSetResult } from '@/lib/trainer2-contracts/set-results';
import { SetResultRow, resultLabel } from './SetResultRow';
import { targetLabel } from './training-summary';
import { loadLabel } from './pound-display';
import { RestBar } from './RestBar';
import { readRest, recordRest, restKey, type RestState } from './rest-state';

export function ActiveWorkout({ execution, ownershipEpoch, locked, onInputState, inputStates, refresh }: {
  execution: ExecutionRead; ownershipEpoch: number; locked: boolean;
  inputStates: Record<string, boolean>;
  onInputState: (id: string, blocked: boolean) => void;
  refresh: () => Promise<SavedSetResult[]>;
}) {
  const sets = execution.initial.positions.flatMap(owned => {
    const position = execution.initial.occurrence.positions.find(p => p.id === owned.sourcePositionId)!;
    return owned.targets.map((target, index) => ({ id: target.id, positionId: owned.id, position,
      target: position.targets.find(t => t.id === target.sourceTargetId)!, number: index + 1 }));
  });
  const firstUnrecorded = (results: SavedSetResult[]) => sets.find(s => !results.some(r => r.targetId === s.id && r.result))?.id ?? null;
  const [selected, setSelected] = useState<string | null>(() => firstUnrecorded(execution.results));
  const selection = useRef({ id: selected, epoch: 0 });
  const latestResults = useRef(execution.results);
  useEffect(() => { latestResults.current = execution.results; }, [execution.results]);
  const key = `trainer2-active-set:${execution.initial.accountId}:${execution.executionId}`;
  const timerKey = restKey(execution.initial.accountId, execution.executionId);
  const [rest, setRest] = useState<RestState | null>(null);
  const panel = useRef<HTMLElement>(null), heading = useRef<HTMLHeadingElement>(null);
  const movement = useRef(false);
  function select(id: string | null, move = false) {
    selection.current = { id, epoch: selection.current.epoch + 1 };
    movement.current = move; setSelected(id);
    if (move && id === selected) reveal();
    try { sessionStorage.setItem(key, JSON.stringify(id)); } catch { /* Convenience state only. */ }
  }
  function reveal() {
    const element = panel.current; if (!element) return;
    const rect = element.getBoundingClientRect(), viewport = window.visualViewport;
    const top = (viewport?.offsetTop ?? 0) + 16, bottom = (viewport?.height ?? window.innerHeight) + (viewport?.offsetTop ?? 0) - 72;
    // Focus the heading, never a numeric input: moving sets must not open the keyboard.
    heading.current?.focus({ preventScroll: true });
    if (rect.top < top || rect.top > bottom - 100 || (rect.bottom > bottom && rect.height < bottom - top)) {
      window.scrollBy({ top: rect.top - top, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    }
  }
  useEffect(() => { if (movement.current) { movement.current = false; reveal(); } }, [selected]);
  useEffect(() => {
    try {
      const retained: unknown = JSON.parse(sessionStorage.getItem(key) ?? 'null');
      if (typeof retained === 'string' && sets.some(s => s.id === retained)) select(retained);
      setRest(readRest(localStorage.getItem(timerKey)));
    } catch { /* Invalid convenience storage does not block logging. */ }
    // Parent keys this controller by execution.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  function recorded(record: SavedSetResult) {
    const source = sets.find(s => s.id === record.targetId); if (!source) return;
    let prior = rest;
    try { prior = readRest(localStorage.getItem(timerKey)) ?? prior; } catch { /* In-memory fallback. */ }
    const next = recordRest(prior, record, source.position.role === 'Main lift');
    try { localStorage.setItem(timerKey, JSON.stringify(next)); } catch { /* Advisory only. */ }
    setRest(next);
  }
  const active = sets.find(s => s.id === selected);
  const count = sets.filter(s => execution.results.some(r => r.targetId === s.id && r.result)).length;
  const prior = active && execution.previous?.find(p => p.positionId === active.position.id);
  function onSubmission(id: string) {
    const start = selection.current;
    return (results: SavedSetResult[]) => {
      if (selection.current.id !== id || selection.current.epoch !== start.epoch) return;
      const current = new Map(results.map(r => [r.targetId, r]));
      for (const r of latestResults.current) if (r.version > (current.get(r.targetId)?.version ?? 0)) current.set(r.targetId, r);
      if (current.get(id)?.version !== results.find(r => r.targetId === id)?.version) return;
      const index = sets.findIndex(s => s.id === id);
      select([...sets.slice(index + 1), ...sets.slice(0, index)].find(s => !current.get(s.id)?.result)?.id ?? null, true);
    };
  }
  // Group consecutive saved roles only. No sorting or inferred exercise identity.
  const groups: { id: string; role: string; positions: typeof execution.initial.positions }[] = [];
  for (const owned of execution.initial.positions) {
    const role = sets.find(s => s.positionId === owned.id)?.position.role ?? 'Exercises';
    if (groups.at(-1)?.role === role) groups.at(-1)!.positions.push(owned);
    else groups.push({ id: owned.id, role, positions: [owned] });
  }
  return <>
    <section ref={panel} aria-label="Active set" className="scroll-mt-4 rounded-2xl border border-slate-200 bg-white p-3 sm:p-4">
      <div className="mb-3"><p className="text-xs font-medium text-slate-600">{count} of {sets.length} sets recorded</p><progress className="mt-1 h-1 w-full accent-emerald-700" value={count} max={sets.length} aria-label="Recorded set progress" /></div>
      <RestBar storageKey={timerKey} state={rest} onChange={setRest} />
      <div aria-live="polite" aria-atomic="true"><h3 ref={heading} tabIndex={-1} className="text-lg font-semibold outline-none">{active?.position.exercise.name ?? (count === sets.length ? 'Ready to finish' : 'Choose your next set')}</h3>
      {active && <p className="text-xs text-slate-500">{active.position.role ?? 'Exercise'} · Set {active.number} of {active.position.targets.length}</p>}</div>
      {active && <>
        <p className="mt-1 text-sm text-slate-600">Starting target · {targetLabel(active.target)}</p>
        <details key={active.positionId} className="mt-1 text-sm"><summary className="min-h-11 cursor-pointer py-3 text-xs font-medium text-emerald-800">History</summary>
          {active.target.measurement && 'unit' in active.target.measurement && active.target.measurement.unit === 'kg' && <p>Original prescription: {active.target.measurement.value} kg</p>}
          {prior ? <><p>Previous · {prior.workoutName} · {new Date(prior.finishedAt).toLocaleDateString()}</p><p className="text-xs">Exercise comparison; no matching set assumed.</p><ul className="space-y-1">{prior.results.map(r => <li key={r.targetId}>{resultLabel(r.result)}{r.result?.measurement && 'unit' in r.result.measurement && r.result.measurement.unit === 'kg' && <span className="block text-xs">{loadLabel(r.result.measurement, true)}</span>}</li>)}</ul><a className="inline-block min-h-11 py-2 underline" href={`/trainer2/dev/executions/${prior.executionId}`}>View source workout</a></> : <p>No comparable previous performance.</p>}
        </details>
      </>}
      {sets.map(s => <SetResultRow key={s.id} active={selected === s.id} activePanel accountId={execution.initial.accountId} ownershipEpoch={ownershipEpoch} executionId={execution.executionId}
        targetId={s.id} number={s.number} saved={execution.results.find(r => r.targetId === s.id)} prescription={s.target} exercise={s.position.exercise}
        preceding={sets.filter(p => p.positionId === s.positionId && p.number < s.number).reverse().flatMap(p => execution.results.filter(r => r.targetId === p.id))}
        locked={locked} onInputState={onInputState} refresh={refresh} onRecorded={recorded} onSubmission={() => onSubmission(s.id)} />)}
    </section>
    <section aria-label="Exercise queue" className="space-y-2"><div className="flex justify-between gap-2"><h3 className="font-semibold">Exercise queue</h3><span className="text-sm text-slate-500">{sets.length - count} unrecorded</span></div>
      {groups.map(group => <details key={group.id} open className="space-y-2"><summary className="min-h-11 cursor-pointer py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">{group.role}</summary>
        {group.positions.map(owned => {
          const items = sets.filter(s => s.positionId === owned.id), position = items[0].position;
          const recordedCount = items.filter(s => execution.results.some(r => r.targetId === s.id && r.result)).length;
          return <div key={owned.id} className={`rounded-xl border p-3 ${active?.positionId === owned.id ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200 bg-white'}`}>
            <button className="flex min-h-11 w-full items-center justify-between gap-3 text-left" onClick={() => select(items.find(s => !execution.results.some(r => r.targetId === s.id && r.result))?.id ?? items[0].id, true)}><span className="font-medium">{position.exercise.name}</span><span className="shrink-0 text-xs">{recordedCount}/{items.length} recorded</span></button>
            <details open><summary className="min-h-11 cursor-pointer py-3 text-xs text-slate-600">Sets</summary><div className="flex flex-wrap gap-2">{items.map(s => {
              const saved = execution.results.find(r => r.targetId === s.id);
              return <button key={s.id} aria-label={`${position.exercise.name}, set ${s.number}, ${saved?.result ? 'recorded' : 'unrecorded'}${inputStates[s.id] ? ', retained input' : ''}`} aria-pressed={selected === s.id}
                className={`min-h-11 rounded-lg border px-3 py-2 text-left text-sm ${selected === s.id ? 'border-emerald-800 bg-emerald-800 text-white' : saved?.result ? 'border-emerald-200 text-emerald-800' : 'border-slate-300'}`} onClick={() => select(s.id, true)}>Set {s.number}{saved?.result ? ' · ' + resultLabel(saved.result) : ''}{inputStates[s.id] ? ' •' : ''}</button>;
            })}</div></details>
          </div>;
        })}
      </details>)}
    </section>
  </>;
}
