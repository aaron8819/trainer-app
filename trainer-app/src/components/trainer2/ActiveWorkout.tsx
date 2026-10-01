'use client';
import { canonicalJson } from '@/lib/trainer2-contracts/canonical-json';
import { AddSet } from './AddSet';
import { executionPositions } from '@/lib/engine/trainer2/execution-targets';
import { finishFormId } from './FinishWorkout';
import { currentAssignment, effectiveOccurrence } from '@/lib/engine/trainer2/exercise-swap';
import { SwapExercise } from './SwapExercise';
import { startingPounds } from '@/lib/engine/trainer2/logging-prefill';
import { useEffect, useRef, useState } from 'react';
import type { ExecutionRead } from '@/lib/trainer2-contracts/execution';
import type { SavedSetResult } from '@/lib/trainer2-contracts/set-results';
import type { SetSkip } from '@/lib/trainer2-contracts/skip-set';
import { SetResultRow } from './SetResultRow';
import { targetLabel } from './training-summary';
import { loadLabel, pounds } from './pound-display';
import { MuscleTags } from './MuscleTags';
import { RestBar } from './RestBar';
import { readRest, recordRest, restKey, type RestState } from './rest-state';

function queueResultLabel(result: NonNullable<SavedSetResult['result']>) {
  const load = result.measurement ? loadLabel(result.measurement).replace(/ lb (?:barbell total|per implement|machine displayed)/, ' lb') : null;
  const reps = result.reps ? `${result.reps.value}${result.reps.basis === 'perSide' ? '/side' : result.reps.basis === 'alternating' ? ' alt' : ''} reps` : null;
  return [load, reps, result.rir === null ? null : `${result.rir} RIR`].filter(Boolean).join(' · ');
}

export function ActiveWorkout({ execution, ownershipEpoch, locked, onInputState, inputStates, refresh, refreshExecution, onSwapLock }: {
  onSwapLock?: (locked: boolean) => void;
  execution: ExecutionRead; ownershipEpoch: number; locked: boolean;
  inputStates: Record<string, boolean>;
  onInputState: (id: string, blocked: boolean) => void;
  refreshExecution: () => Promise<ExecutionRead>;
  refresh: () => Promise<SavedSetResult[]>;
}) {
  const [swapActive, setSwapActive] = useState(false), [additionActive, setAdditionActive] = useState(false);
  const swapLocks = useRef<Record<string, boolean>>({});
  const lockCallbacks = useRef<Record<string, (value: boolean) => void>>({});
  for (const key of execution.initial.positions.flatMap(p => [p.id, `add:${p.id}`])) if (!lockCallbacks.current[key]) lockCallbacks.current[key] = value => {
    swapLocks.current[key] = value; const any = Object.values(swapLocks.current).some(Boolean); setSwapActive(any); setAdditionActive(Object.entries(swapLocks.current).some(([key,value]) => key.startsWith('add:') && value)); onSwapLock?.(any);
  };
  const sets = executionPositions(execution).flatMap(owned => {
    const position = effectiveOccurrence(execution).positions.find(p => p.id === owned.sourcePositionId)!;
    return owned.targets.map((target, index) => ({ id: target.id, positionId: owned.id, position,
      target: position.targets.find(t => t.id === target.displayTargetId)!, number: index + 1 }));
  });
  const firstUnrecorded = (results: SavedSetResult[]) => sets.find(s => !results.some(r => r.targetId === s.id && r.result) && (!execution.skips?.some(k => k.targetId === s.id) || results.some(r => r.targetId === s.id)))?.id ?? null;
  const [selected, setSelected] = useState<string | null>(() => firstUnrecorded(execution.results));
  const selection = useRef({ id: selected, epoch: 0 });
  const latestResults = useRef(execution.results);
  useEffect(() => { latestResults.current = execution.results; }, [execution.results]);
  const key = `trainer2-active-set:${execution.initial.accountId}:${execution.executionId}`;
  const timerKey = restKey(execution.initial.accountId, execution.executionId);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [inputEpoch, setInputEpoch] = useState(0);
  const [rest, setRest] = useState<RestState | null>(null);
  const panel = useRef<HTMLElement>(null), heading = useRef<HTMLHeadingElement>(null), timer = useRef<HTMLDivElement>(null);
  const movement = useRef(false);
  function select(id: string | null, move = false) {
    selection.current = { id, epoch: selection.current.epoch + 1 };
    movement.current = move; setHistoryOpen(false); setSelected(id);
    if (move && id === selected) reveal();
    try { sessionStorage.setItem(key, JSON.stringify(id)); } catch { /* Convenience state only. */ }
  }
  function reveal() {
    const element = panel.current; if (!element) return;
    // Include the visible, non-sticky timer in deliberate reveals. Expired or
    // dismissed timers render no child, so the card remains the fallback.
    const rect = (timer.current?.firstElementChild ?? element).getBoundingClientRect(), viewport = window.visualViewport;
    const top = (viewport?.offsetTop ?? 0) + 16;
    // Focus the heading, never a numeric input: moving sets must not open the keyboard.
    heading.current?.focus({ preventScroll: true });
    if (Math.abs(rect.top - top) > 1) {
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
  const skippedCount = sets.filter(s => execution.skips?.some(k => k.targetId === s.id) && !execution.results.some(r => r.targetId === s.id)).length;
  const prior = active && execution.previous?.find(p => p.positionId === active.position.id);
  const historyMeanings = [...new Set(prior?.results.flatMap(r => { const m = r.result?.measurement; return m && 'value' in m ? [loadLabel(m).split(' lb ')[1]] : []; }) ?? [])];
  function onSubmission(id: string) {
    const start = selection.current;
    return (results: SavedSetResult[], skips: SetSkip[] = execution.skips ?? []) => {
      if (selection.current.id !== id || selection.current.epoch !== start.epoch) return;
      const current = new Map(results.map(r => [r.targetId, r]));
      for (const r of latestResults.current) if (r.version > (current.get(r.targetId)?.version ?? 0)) current.set(r.targetId, r);
      if (current.get(id)?.version !== results.find(r => r.targetId === id)?.version) return;
      const index = sets.findIndex(s => s.id === id);
      select([...sets.slice(index + 1), ...sets.slice(0, index)].find(s => !current.get(s.id)?.result && (!skips.some(k => k.targetId === s.id) || current.has(s.id)))?.id ?? null, true);
    };
  }
  // Group consecutive saved roles only. No sorting or inferred exercise identity.
  const groups: { id: string; role: string; positions: ReturnType<typeof executionPositions> }[] = [];
  for (const owned of executionPositions(execution)) {
    const role = sets.find(s => s.positionId === owned.id)?.position.role ?? 'Exercises';
    if (groups.at(-1)?.role === role) groups.at(-1)!.positions.push(owned);
    else groups.push({ id: owned.id, role, positions: [owned] });
  }
  return <>
    <div ref={timer}><RestBar storageKey={timerKey} state={rest} onChange={setRest} /></div>
    <section ref={panel} aria-label="Active set" style={{ overflowAnchor: 'none' }} className="scroll-mt-4 relative rounded-2xl border border-slate-200 bg-white p-3 sm:p-4">
      <div className="mb-3"><div className="flex justify-between text-xs text-slate-500"><span className="font-semibold tracking-wide">ACTIVE SET</span><span>{count + skippedCount}/{sets.length} resolved</span></div><div role="progressbar" aria-valuenow={count + skippedCount} aria-valuemin={0} aria-valuemax={sets.length} aria-label="Resolved set progress" className="mt-2 h-1 overflow-hidden rounded-full bg-slate-100"><div className="h-full bg-black" style={{ width: `${(count + skippedCount) / sets.length * 100}%` }} /></div></div>
      <div className="flex items-start justify-between gap-3"><div><h3 ref={heading} tabIndex={-1} className="text-lg font-semibold outline-none">{active?.position.exercise.name ?? (count + skippedCount === sets.length ? 'Ready to finish' : 'Choose your next set')}</h3>
      {active && <p className="text-xs text-slate-500">{active.position.role ?? 'Exercise'} · Set {active.number} of {active.position.targets.length}</p>}</div><div className="flex items-start gap-2">      {execution.initial.positions.map(p => <span key={p.id} hidden={active?.positionId !== p.id}><SwapExercise execution={execution} positionId={p.id} ownershipEpoch={ownershipEpoch} locked={locked || additionActive}
        refresh={refreshExecution} onLock={lockCallbacks.current[p.id]} onChanged={() => { setInputEpoch(e => e+1); setHistoryOpen(false); setTimeout(reveal, 0); }} /></span>)}
{active && <button type="button" aria-expanded={historyOpen} className="min-h-11 min-w-20 shrink-0 rounded-full border border-slate-200 px-3 text-xs font-semibold" onClick={() => setHistoryOpen(v => !v)}>History</button>}</div></div>
      {!active && count + skippedCount === sets.length && <button type="submit" form={finishFormId(execution.executionId)}
        disabled={locked || sets.some(s => inputStates[s.id] !== false)}
        className="mt-3 min-h-11 rounded-xl bg-black px-5 py-3 font-semibold text-white disabled:opacity-40">Finish workout</button>}
      {active && <>
        <p className="mt-1 h-4 text-xs font-semibold text-amber-800">{execution.results.some(r => r.targetId === active.id) ? `Editing recorded set ${active.number}` : ''}</p>
        <p className="mt-1 text-sm text-slate-600">{execution.additions?.some(a => a.content.target.id === active.id) ? 'Session target' : 'Starting target'} · {targetLabel({ ...active.target, measurement: null })}{active.target.measurement && <> · {startingPounds(active.target.measurement) === null ? 'Bodyweight' : `${startingPounds(active.target.measurement)} lb suggested from prescription`}</>}{!active.target.measurement && active.number === 1 && execution.firstSetLoads?.some(h => h.positionId === active.position.id) && ' · Last time'}</p>
        <div key={active.positionId} hidden={!historyOpen} className="mt-2 rounded-lg border border-slate-200 p-3 text-sm">
          {prior ? <><p className="mb-2 text-xs text-slate-600">Previous · {prior.workoutName} · {new Date(prior.finishedAt).toLocaleDateString()}</p>
            {historyMeanings.length > 0 && <p className="mb-1 text-xs text-slate-500">{historyMeanings.join(' · ')}</p>}
            <table className="w-full text-left text-sm tabular-nums"><caption className="sr-only">Previous exercise results</caption><thead className="border-b text-xs text-slate-500"><tr>{['Set', 'Weight', 'Reps', 'RIR'].map(label => <th key={label} scope="col" className="py-1 pr-2 font-medium">{label}</th>)}</tr></thead>
              <tbody>{prior.results.map((r, index) => {
                const m = r.result?.measurement, reps = r.result?.reps;
                return <tr key={r.targetId} className="border-b border-slate-100 align-top"><th scope="row" className="py-2 pr-2 font-normal">{index + 1}</th><td className="py-2 pr-2">{m && 'value' in m ? `${pounds(m.value, m.unit)} lb` : m?.kind === 'bodyweight' ? 'Bodyweight' : '—'}{historyMeanings.length > 1 && m && 'value' in m && <span className="block text-[11px] text-slate-500">{loadLabel(m).split(' lb ')[1]}</span>}</td><td className="py-2 pr-2">{reps?.value ?? '—'}{reps && reps.basis !== 'total' && <span className="block text-[11px] text-slate-500">{reps.basis === 'perSide' ? 'per side' : 'alternating'}</span>}</td><td className="py-2">{r.result?.rir ?? '—'}</td></tr>;
              })}</tbody></table>
            <a className="inline-block min-h-11 py-2 underline" href={`/trainer2/dev/executions/${prior.executionId}`}>View source workout</a></> : <p>No previous exercise results.</p>}

        </div>
      </>}
      {sets.map(s => <SetResultRow sessionAdded={execution.additions?.some(a => a.content.target.id === s.id)} key={`${s.id}:${currentAssignment(execution, s.positionId).version}:${inputEpoch}`} assignment={currentAssignment(execution, s.positionId)} active={selected === s.id} activePanel accountId={execution.initial.accountId} ownershipEpoch={ownershipEpoch} executionId={execution.executionId}
        targetId={s.id} number={s.number} saved={execution.results.find(r => r.targetId === s.id)} prescription={s.target} exercise={s.position.exercise}
        firstSetLoad={execution.firstSetLoads?.find(h => h.positionId === s.position.id)?.result}
        preceding={sets.filter(p => p.positionId === s.positionId && p.number < s.number).reverse().flatMap(p => execution.results.filter(r => r.targetId === p.id && (!r.assignment || canonicalJson(r.assignment) === canonicalJson(currentAssignment(execution, s.positionId)))))}
        skipped={execution.skips?.find(k => k.targetId === s.id)} refreshExecution={refreshExecution} onReturn={() => select(firstUnrecorded(execution.results), true)}
        locked={locked || swapActive} onInputState={onInputState} refresh={refresh} onRecorded={recorded} onSubmission={() => onSubmission(s.id)} />)}
    </section>
    <section aria-label="Exercise queue" className="mt-4 space-y-3 border-t border-slate-100 pt-4"><div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1"><h3 className="font-semibold">Exercise queue</h3><span className="text-xs tabular-nums text-slate-500">{count} logged · {skippedCount} skipped · {sets.length - count - skippedCount} remaining</span></div>
      {groups.map(group => <details key={group.id} open className="space-y-2"><summary className="min-h-10 cursor-pointer py-2 text-xs font-semibold uppercase tracking-wider text-slate-500">{group.role}</summary>
        {group.positions.map(owned => {
          const items = sets.filter(s => s.positionId === owned.id), position = items[0].position;
          const original = execution.initial.occurrence.positions.find(p => p.id === owned.sourcePositionId)!;
          const assignment = currentAssignment(execution, owned.id);
          const swap = execution.swaps?.find(s => s.positionId === owned.id && s.version === assignment.version);
          const recordedCount = items.filter(s => execution.results.some(r => r.targetId === s.id && r.result)).length;
          return <div key={owned.id} className={`rounded-xl border bg-white p-3 ${active?.positionId === owned.id ? 'border-slate-400 border-l-4 border-l-slate-900 shadow-sm' : 'border-slate-200'}`}>
            <button className="flex min-h-11 w-full items-center justify-between gap-3 text-left hover:text-slate-700 focus-visible:rounded-md" onClick={() => select(items.find(s => !execution.results.some(r => r.targetId === s.id && r.result) && (!execution.skips?.some(k => k.targetId === s.id) || execution.results.some(r => r.targetId === s.id)))?.id ?? items[0].id, true)}><span className="font-semibold">{position.exercise.name}</span><span className="shrink-0 text-xs tabular-nums text-slate-500">{recordedCount}/{items.length} logged</span></button>
            {swap && <p className="mb-2 text-xs text-slate-600">{swap.content.restoreOriginal ? `Returned to original: ${original.exercise.name}` : `${original.exercise.name} → ${position.exercise.name} · Swapped for today`}</p>}
            <MuscleTags exercise={position.exercise} />
            <div className="mt-2 flex flex-wrap gap-1.5">{items.map(s => {
              const skipped = execution.skips?.some(k => k.targetId === s.id) && !execution.results.some(r => r.targetId === s.id);
              const saved = execution.results.find(r => r.targetId === s.id);
              return <button key={s.id} aria-label={`${position.exercise.name}, set ${s.number}, ${saved?.result ? 'recorded' : skipped ? 'skipped' : 'unrecorded'}${inputStates[s.id] ? ', retained input' : ''}`} aria-pressed={selected === s.id}
                className={`min-h-11 rounded-lg border px-3 py-2 text-left text-sm tabular-nums transition-colors ${selected === s.id ? 'border-black bg-black font-medium text-white' : saved?.result ? 'border-emerald-200 bg-emerald-50/40 text-emerald-900 hover:bg-emerald-50' : skipped ? 'border-dashed border-slate-400 text-slate-600 hover:bg-slate-50' : 'border-slate-300 text-slate-700 hover:bg-slate-50'}`} onClick={() => select(s.id, true)}><span className="font-semibold">{s.number}</span><span className="ml-1.5">{saved?.result ? '· ' + queueResultLabel(saved.result) : skipped ? '· Skipped' : <span aria-hidden="true" className="inline-block h-3 w-3 rounded-full border-2 border-current align-middle" />}</span>{inputStates[s.id] ? ' •' : ''}</button>;
            })}<AddSet execution={execution} positionId={owned.id} ownershipEpoch={ownershipEpoch} locked={locked || swapActive}
              refresh={refreshExecution} onLock={lockCallbacks.current[`add:${owned.id}`]} onAdded={id => select(id, true)} /></div>
          </div>;
        })}
      </details>)}
    </section>
  </>;
}
