'use client';
import { startingPounds } from '@/lib/engine/trainer2/logging-prefill';
import { useEffect, useRef, useState } from 'react';
import type { ExecutionRead } from '@/lib/trainer2-contracts/execution';
import type { SavedSetResult } from '@/lib/trainer2-contracts/set-results';
import type { SetSkip } from '@/lib/trainer2-contracts/skip-set';
import { SetResultRow, resultLabel } from './SetResultRow';
import { targetLabel } from './training-summary';
import { loadLabel, pounds } from './pound-display';
import { MuscleTags } from './MuscleTags';
import { RestBar } from './RestBar';
import { readRest, recordRest, restKey, type RestState } from './rest-state';

export function ActiveWorkout({ execution, ownershipEpoch, locked, onInputState, inputStates, refresh, refreshExecution }: {
  execution: ExecutionRead; ownershipEpoch: number; locked: boolean;
  inputStates: Record<string, boolean>;
  onInputState: (id: string, blocked: boolean) => void;
  refreshExecution: () => Promise<ExecutionRead>;
  refresh: () => Promise<SavedSetResult[]>;
}) {
  const sets = execution.initial.positions.flatMap(owned => {
    const position = execution.initial.occurrence.positions.find(p => p.id === owned.sourcePositionId)!;
    return owned.targets.map((target, index) => ({ id: target.id, positionId: owned.id, position,
      target: position.targets.find(t => t.id === target.sourceTargetId)!, number: index + 1 }));
  });
  const firstUnrecorded = (results: SavedSetResult[]) => sets.find(s => !results.some(r => r.targetId === s.id && r.result) && (!execution.skips?.some(k => k.targetId === s.id) || results.some(r => r.targetId === s.id)))?.id ?? null;
  const [selected, setSelected] = useState<string | null>(() => firstUnrecorded(execution.results));
  const selection = useRef({ id: selected, epoch: 0 });
  const latestResults = useRef(execution.results);
  useEffect(() => { latestResults.current = execution.results; }, [execution.results]);
  const key = `trainer2-active-set:${execution.initial.accountId}:${execution.executionId}`;
  const timerKey = restKey(execution.initial.accountId, execution.executionId);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [rest, setRest] = useState<RestState | null>(null);
  const panel = useRef<HTMLElement>(null), heading = useRef<HTMLHeadingElement>(null);
  const movement = useRef(false);
  function select(id: string | null, move = false) {
    selection.current = { id, epoch: selection.current.epoch + 1 };
    movement.current = move; setHistoryOpen(false); setSelected(id);
    if (move && id === selected) reveal();
    try { sessionStorage.setItem(key, JSON.stringify(id)); } catch { /* Convenience state only. */ }
  }
  function reveal() {
    const element = panel.current; if (!element) return;
    const rect = element.getBoundingClientRect(), viewport = window.visualViewport;
    const timerVisible = Boolean(document.querySelector('[aria-label="Rest timer"]'));
    const top = (viewport?.offsetTop ?? 0) + (timerVisible ? 88 : 16), bottom = (viewport?.height ?? window.innerHeight) + (viewport?.offsetTop ?? 0) - 72;
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
  const groups: { id: string; role: string; positions: typeof execution.initial.positions }[] = [];
  for (const owned of execution.initial.positions) {
    const role = sets.find(s => s.positionId === owned.id)?.position.role ?? 'Exercises';
    if (groups.at(-1)?.role === role) groups.at(-1)!.positions.push(owned);
    else groups.push({ id: owned.id, role, positions: [owned] });
  }
  return <>
    <RestBar storageKey={timerKey} state={rest} onChange={setRest} />
    <section ref={panel} aria-label="Active set" style={{ overflowAnchor: 'none' }} className="scroll-mt-24 relative rounded-2xl border border-slate-200 bg-white p-3 sm:p-4">
      <div className="mb-3"><div className="flex justify-between text-xs text-slate-500"><span className="font-semibold tracking-wide">ACTIVE SET</span><span>{count + skippedCount}/{sets.length} resolved</span></div><div role="progressbar" aria-valuenow={count + skippedCount} aria-valuemin={0} aria-valuemax={sets.length} aria-label="Resolved set progress" className="mt-2 h-1 overflow-hidden rounded-full bg-slate-100"><div className="h-full bg-black" style={{ width: `${(count + skippedCount) / sets.length * 100}%` }} /></div></div>
      <div className="flex items-start justify-between gap-3"><div><h3 ref={heading} tabIndex={-1} className="text-lg font-semibold outline-none">{active?.position.exercise.name ?? (count + skippedCount === sets.length ? 'Ready to finish' : 'Choose your next set')}</h3>
      {active && <p className="text-xs text-slate-500">{active.position.role ?? 'Exercise'} · Set {active.number} of {active.position.targets.length}</p>}</div>{active && <button type="button" aria-expanded={historyOpen} className="min-h-9 shrink-0 rounded-full border border-slate-200 px-3 text-xs font-semibold" onClick={() => setHistoryOpen(v => !v)}>History</button>}</div>
      {active && <>
        <p className="mt-1 h-4 text-xs font-semibold text-amber-800">{execution.results.some(r => r.targetId === active.id) ? `Editing recorded set ${active.number}` : ''}</p>
        <p className="mt-1 text-sm text-slate-600">Starting target · {targetLabel({ ...active.target, measurement: null })}{active.target.measurement && <> · {startingPounds(active.target.measurement) === null ? 'Bodyweight' : `${startingPounds(active.target.measurement)} lb suggested from prescription`}</>}{!active.target.measurement && active.number === 1 && execution.firstSetLoads?.some(h => h.positionId === active.position.id) && ' · Last time'}</p>
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
      {sets.map(s => <SetResultRow key={s.id} active={selected === s.id} activePanel accountId={execution.initial.accountId} ownershipEpoch={ownershipEpoch} executionId={execution.executionId}
        targetId={s.id} number={s.number} saved={execution.results.find(r => r.targetId === s.id)} prescription={s.target} exercise={s.position.exercise}
        firstSetLoad={execution.firstSetLoads?.find(h => h.positionId === s.position.id)?.result}
        preceding={sets.filter(p => p.positionId === s.positionId && p.number < s.number).reverse().flatMap(p => execution.results.filter(r => r.targetId === p.id))}
        skipped={execution.skips?.find(k => k.targetId === s.id)} refreshExecution={refreshExecution} onReturn={() => select(firstUnrecorded(execution.results), true)}
        locked={locked} onInputState={onInputState} refresh={refresh} onRecorded={recorded} onSubmission={() => onSubmission(s.id)} />)}
    </section>
    <section aria-label="Exercise queue" className="mt-4 space-y-3 border-t border-slate-100 pt-4"><div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1"><h3 className="font-semibold">Exercise queue</h3><span className="text-xs tabular-nums text-slate-500">{count} logged · {skippedCount} skipped · {sets.length - count - skippedCount} remaining</span></div>
      {groups.map(group => <details key={group.id} open className="space-y-2"><summary className="min-h-10 cursor-pointer py-2 text-xs font-semibold uppercase tracking-wider text-slate-500">{group.role}</summary>
        {group.positions.map(owned => {
          const items = sets.filter(s => s.positionId === owned.id), position = items[0].position;
          const recordedCount = items.filter(s => execution.results.some(r => r.targetId === s.id && r.result)).length;
          return <div key={owned.id} className={`rounded-2xl border bg-white p-3 shadow-sm ${active?.positionId === owned.id ? 'border-slate-400 ring-1 ring-slate-100' : 'border-slate-200'}`}>
            <button className="flex min-h-11 w-full items-center justify-between gap-3 text-left hover:text-slate-700 focus-visible:rounded-md" onClick={() => select(items.find(s => !execution.results.some(r => r.targetId === s.id && r.result) && (!execution.skips?.some(k => k.targetId === s.id) || execution.results.some(r => r.targetId === s.id)))?.id ?? items[0].id, true)}><span className="font-semibold">{position.exercise.name}</span><span className="shrink-0 text-xs tabular-nums text-slate-500">{recordedCount}/{items.length} recorded</span></button>
            <MuscleTags exercise={position.exercise} />
            <div className="mt-2 flex flex-wrap gap-1.5">{items.map(s => {
              const skipped = execution.skips?.some(k => k.targetId === s.id) && !execution.results.some(r => r.targetId === s.id);
              const saved = execution.results.find(r => r.targetId === s.id);
              return <button key={s.id} aria-label={`${position.exercise.name}, set ${s.number}, ${saved?.result ? 'recorded' : skipped ? 'skipped' : 'unrecorded'}${inputStates[s.id] ? ', retained input' : ''}`} aria-pressed={selected === s.id}
                className={`min-h-11 rounded-lg border px-3 py-2 text-left text-sm tabular-nums transition-colors ${selected === s.id ? 'border-black bg-black font-medium text-white' : saved?.result ? 'border-emerald-200 bg-emerald-50/40 text-emerald-900 hover:bg-emerald-50' : skipped ? 'border-dashed border-slate-400 text-slate-600 hover:bg-slate-50' : 'border-slate-300 text-slate-700 hover:bg-slate-50'}`} onClick={() => select(s.id, true)}>{s.number}{saved?.result ? ' · ' + resultLabel(saved.result).replace(/ lb (?:barbell total|per implement|machine displayed) × /, ' lb × ') : skipped ? ' · Skipped' : ' · Unrecorded'}{inputStates[s.id] ? ' •' : ''}</button>;
            })}</div>
          </div>;
        })}
      </details>)}
    </section>
  </>;
}
