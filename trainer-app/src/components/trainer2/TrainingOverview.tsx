'use client';
import { useState } from 'react';
import type { DraftDocument } from '@/lib/trainer2-contracts/draft';
import type { NextWorkoutRead } from '@/lib/trainer2-contracts/execution';
import { orderedWorkoutGroups } from '@/lib/engine/trainer2/ordered-workouts';
import { effortSummary, trainingUrl, targetGroups, type WorkoutIntent } from './training-summary';

export function PlannedWorkout({ workout }: { workout: WorkoutIntent }) {
  return <section aria-label="Planned workout" className="space-y-3"><h3 className="text-lg font-semibold">Planned workout</h3>
    <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white px-3 sm:px-4">{workout.positions.map(p => <li key={p.id} className="py-3">
      <div className="flex flex-wrap justify-between gap-1"><h4 className="min-w-0 break-words font-semibold">{p.exercise.name}</h4><span className="text-xs text-slate-500">{p.role}</span></div>
      {targetGroups(p.targets).map(g => <p key={g.first} className="mt-1 break-words text-sm text-slate-600">{g.count} × {g.label}</p>)}
      {p.exercise.variation && <details className="mt-1"><summary className="min-h-11 cursor-pointer py-3 text-sm">Exercise details</summary><p className="break-words text-sm">{p.exercise.variation}</p></details>}
    </li>)}</ul></section>;
}

export function TrainingOverview({ document, next, program = false, selectedId, onSelect, locked = false }: {
  document: DraftDocument; next: NextWorkoutRead; program?: boolean; selectedId?: string; onSelect?: (id: string) => void; locked?: boolean;
}) {
  const groups = orderedWorkoutGroups(document);
  const current = next.execution?.initial.planId === next.planId ? next.execution.initial.occurrence : next.occurrence;
  const currentIndex = next.week?.index ?? (current ? groups.findIndex(g => g.workouts.some(w => w.occurrence.id === current.id)) : groups.length - 1);
  const [browsedWeek, setBrowsedWeek] = useState<number | null>(null);
  const weekIndex = program ? Math.min(browsedWeek ?? currentIndex, groups.length - 1) : currentIndex;
  const group = groups[weekIndex];
  const completed = next.occurrences.filter(o => o.status === 'Finished').length;
  const skipped = next.occurrences.filter(o => o.status === 'Skipped').length;
  return <div className="min-w-0 space-y-5">
    <header className="space-y-2"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-semibold uppercase tracking-widest text-teal-700">{program ? 'Program' : 'Training'}</p>
      <a className="inline-flex min-h-11 items-center text-sm font-semibold text-teal-800 underline" href={program ? trainingUrl(next.planId) : `${trainingUrl(next.planId)}&view=program`}>{program ? 'Back to training' : 'View Program'}</a></div>
      <h1 className="break-words text-2xl font-semibold tracking-tight sm:text-3xl">{document.name}</h1>
      <p className="text-lg font-medium">{next.lifecycle === 'Completed' ? 'Program complete' : `Week ${currentIndex + 1} of ${groups.length}`}{current && document.builder && next.lifecycle !== 'Completed' ? ` · ${groups[currentIndex].deload ? 'Deload' : 'Accumulation'}` : ''}</p>
      {current && <p className="text-teal-800">{effortSummary(current)}<span className="text-sm text-slate-500"> · reps in reserve</span></p>}
      {next.lifecycle === 'Completed' && <p>{completed} workouts completed · {skipped} skipped. Your results and saved program remain available below.</p>}
    </header>
    {program && <nav aria-label="Program weeks" className="flex flex-wrap gap-2">{groups.map((g, i) => <button key={g.workouts[0].occurrence.id} type="button" aria-current={i === weekIndex ? 'page' : undefined}
      className={`min-h-11 min-w-11 rounded-lg border px-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 ${i === weekIndex ? 'border-teal-700 bg-teal-50 text-teal-900' : 'border-slate-300 bg-white'}`}
      onClick={() => setBrowsedWeek(i)}>Week {i + 1}{g.deload ? ' · Deload' : ''}</button>)}</nav>}
    {group && <section className="space-y-3" aria-label={group.stage.name}>
      <h2 className="font-semibold">{group.stage.name} <span className="font-normal text-slate-500">· {group.workouts.filter(w => next.occurrences.find(r => r.occurrenceId === w.occurrence.id)?.status === 'Finished').length} of {group.workouts.length} workouts completed · {group.workouts.filter(w => next.occurrences.find(r => r.occurrenceId === w.occurrence.id)?.status === 'Skipped').length} skipped</span></h2>
      <div className="grid grid-cols-1 items-start gap-3 md:grid-cols-2">{group.workouts.map(({ occurrence: o }, i) => {
        const row = next.occurrences.find(r => r.occurrenceId === o.id);
        const status = o.id === next.execution?.initial.occurrence.id ? 'In progress' : row?.status === 'Finished' ? 'Completed' : row?.status === 'Skipped' ? 'Skipped' : 'Pending';
        const eligible = (next.eligibleOccurrenceIds ?? [next.occurrence?.id]).includes(o.id);
        const selected = selectedId === o.id;
        return <article key={o.id} data-occurrence-id={o.id} className={`min-w-0 rounded-xl border p-3 sm:p-4 ${selected || status === 'In progress' ? 'border-teal-600 bg-teal-50' : 'border-slate-200 bg-white'}`}>
          <p className="text-xs font-semibold uppercase text-slate-600">Workout {i + 1} · {status}</p><h3 className="mt-1 break-words font-semibold">{o.name}</h3>
          <p className="mt-1 text-sm text-slate-600">{o.positions.length} {o.positions.length === 1 ? 'exercise' : 'exercises'} · {o.positions.reduce((n, p) => n + p.targets.length, 0)} sets</p>
          {o.id === next.occurrence?.id && status === 'Pending' && <p className="mt-1 text-xs text-teal-800">Recommended next</p>}
          {status === 'In progress' && next.execution && <a className="inline-flex min-h-11 items-center text-sm font-semibold text-teal-800 underline" href={`/trainer2/dev/executions/${next.execution.executionId}`}>Resume workout</a>}
          {row?.executionId && <a className="inline-flex min-h-11 items-center text-sm text-teal-800 underline" href={`/trainer2/dev/executions/${row.executionId}`}>View results</a>}
          {!program && eligible && status === 'Pending' && onSelect && <button type="button" aria-pressed={selected} disabled={locked}
            className="mt-2 min-h-11 w-full rounded-lg border border-teal-700 px-3 text-sm font-semibold text-teal-900 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700"
            onClick={() => onSelect(o.id)}>{selected ? 'Selected workout' : `Select ${o.name}`}</button>}
          {(program || status === 'Skipped') && <details className="mt-2"><summary className="min-h-11 cursor-pointer py-3 text-sm font-medium">Review prescriptions</summary>
            {row?.skip && <p className="mb-3 text-sm">Explicitly skipped · {new Date(row.skip.skippedAt).toLocaleDateString()}</p>}<PlannedWorkout workout={o} /></details>}
        </article>;
      })}</div>
    </section>}
  </div>;
}
