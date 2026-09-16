'use client';
import { useEffect, useRef, useState } from 'react';
import type { ExecutionRead } from '@/lib/trainer2-contracts/execution';
import type { SavedSetResult } from '@/lib/trainer2-contracts/set-results';
import { SetResultRow, resultLabel } from './SetResultRow';
import { targetLabel } from './training-summary';

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
  function select(id: string | null) {
    selection.current = { id, epoch: selection.current.epoch + 1 };
    setSelected(id);
    try { sessionStorage.setItem(key, JSON.stringify(id)); } catch { /* Selection is convenience state; result storage remains guarded. */ }
  }
  useEffect(() => {
    try {
      const retained: unknown = JSON.parse(sessionStorage.getItem(key) ?? 'null');
      if (typeof retained === 'string' && sets.some(s => s.id === retained)) select(retained);
    } catch { /* Invalid selection falls back to the first unrecorded identity. */ }
    // The parent keys this controller by execution; identities never change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const active = sets.find(s => s.id === selected);
  const recorded = sets.filter(s => execution.results.some(r => r.targetId === s.id && r.result)).length;
  const prior = active && execution.previous?.find(p => p.positionId === active.position.id);
  const units = [...new Set(execution.results.flatMap(r => r.result?.measurement && 'unit' in r.result.measurement ? [r.result.measurement.unit] : []))];
  function onSubmission(id: string) {
    const start = selection.current;
    return (results: SavedSetResult[]) => {
      if (selection.current.id !== id || selection.current.epoch !== start.epoch) return;
      const current = new Map(results.map(r => [r.targetId, r]));
      for (const r of latestResults.current) {
        if (r.version > (current.get(r.targetId)?.version ?? 0)) current.set(r.targetId, r);
      }
      // Another confirmed read may already know a newer correction than this response.
      if (current.get(id)?.version !== results.find(r => r.targetId === id)?.version) return;
      const index = sets.findIndex(s => s.id === id);
      const following = [...sets.slice(index + 1), ...sets.slice(0, index)];
      select(following.find(s => !current.get(s.id)?.result)?.id ?? null);
    };
  }
  return <>
    <section aria-label="Active set" className="rounded-2xl border border-slate-200 bg-white p-3 sm:p-5">
      <div className="mb-3"><p className="text-sm font-medium text-slate-600">{recorded} of {sets.length} sets recorded</p><progress className="mt-2 h-2 w-full accent-teal-700" value={recorded} max={sets.length} aria-label="Recorded set progress" /></div>
      {active ? <>
        <p className="text-xs font-semibold uppercase tracking-wide text-teal-700">{active.position.role ?? 'Exercise'} · Set {active.number} of {active.position.targets.length}</p>
        <h3 className="mt-1 text-xl font-semibold">{active.position.exercise.name}</h3>
        <p className="mt-2 text-sm text-slate-600">Starting target · {targetLabel(active.target)}</p>
        <aside className="mt-3 text-sm text-slate-600">{prior ? <>
          <p>Previous · {prior.workoutName} · {new Date(prior.finishedAt).toLocaleDateString()}</p>
          <p className="text-xs">Exercise comparison · {resultLabel(prior.results[0].result)}{prior.results.length > 1 ? ` · +${prior.results.length - 1} in history` : ''}</p>
          <details key={active.positionId} className="mt-1"><summary className="min-h-11 cursor-pointer py-2 font-medium text-teal-800">History</summary><p className="text-xs">Exercise-level comparison; no matching set is assumed.</p><ul className="space-y-1">{prior.results.map(r => <li key={r.targetId}>{resultLabel(r.result)}</li>)}</ul><a className="inline-block min-h-11 py-2 underline" href={`/trainer2/dev/executions/${prior.executionId}`}>View source workout</a></details>
        </> : <p>No comparable previous performance.</p>}</aside>
      </> : <div><h3 className="text-xl font-semibold">{recorded === sets.length ? 'Ready to finish' : 'Choose your next set'}</h3><p className="mt-2 text-sm">{recorded === sets.length ? 'All sets are recorded. Review the queue or finish the workout below.' : 'Select an unrecorded set from the queue to continue.'}</p></div>}
      {sets.map(s => <SetResultRow key={s.id} active={selected === s.id} activePanel accountId={execution.initial.accountId} ownershipEpoch={ownershipEpoch} executionId={execution.executionId}
        targetId={s.id} number={s.number} saved={execution.results.find(r => r.targetId === s.id)} prescription={s.target} exercise={s.position.exercise} unitHint={units.length === 1 ? units[0] : undefined}
        locked={locked} onInputState={onInputState} refresh={refresh} onSubmission={() => onSubmission(s.id)} />)}
    </section>
    <section aria-label="Exercise queue" className="space-y-2"><div className="flex justify-between gap-2"><h3 className="font-semibold">Exercise queue</h3><span className="text-sm text-slate-500">{sets.length - recorded} unrecorded</span></div>
      {execution.initial.positions.map((owned, index) => {
        const items = sets.filter(s => s.positionId === owned.id), position = items[0].position;
        const count = items.filter(s => execution.results.some(r => r.targetId === s.id && r.result)).length;
        const isActive = active?.positionId === owned.id;
        const previousPosition = execution.initial.positions[index - 1];
        const previousRole = previousPosition && sets.find(s => s.positionId === previousPosition.id)?.position.role;
        return <div key={owned.id}>
          {(index === 0 || previousRole !== position.role) && <h4 className="pb-2 pt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">{position.role ?? 'Exercises'}</h4>}
          <div className={`rounded-xl border p-3 ${isActive ? 'border-teal-500 bg-teal-50' : 'border-slate-200 bg-white'}`}>
            <button className="flex min-h-11 w-full items-center justify-between gap-3 text-left" onClick={() => select(items.find(s => !execution.results.some(r => r.targetId === s.id && r.result))?.id ?? items[0].id)}><span className="font-medium">{position.exercise.name}</span><span className="shrink-0 text-xs">{isActive ? 'Active · ' : count === items.length ? 'Complete · ' : ''}{count}/{items.length}</span></button>
            <div className="flex flex-wrap gap-2">{items.map(s => {
              const saved = execution.results.find(r => r.targetId === s.id);
              return <button key={s.id} aria-label={`${position.exercise.name}, set ${s.number}, ${saved?.result ? 'recorded' : 'unrecorded'}${inputStates[s.id] ? ', retained input' : ''}`} aria-pressed={selected === s.id}
                className={`min-h-11 min-w-11 rounded-lg border px-3 text-sm ${selected === s.id ? 'border-teal-800 bg-teal-800 text-white' : saved?.result ? 'border-teal-200 text-teal-800' : 'border-slate-300'}`} onClick={() => select(s.id)}>{s.number}{saved?.result ? ' ✓' : ''}{inputStates[s.id] ? ' •' : ''}</button>;
            })}</div>
          </div>
        </div>;
      })}
      <p className="text-xs text-slate-500">✓ Recorded · • Input needs attention. Selecting another set preserves input.</p>
    </section>
  </>;
}
