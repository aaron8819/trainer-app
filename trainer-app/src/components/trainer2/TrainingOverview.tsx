import type { DraftDocument } from '@/lib/trainer2-contracts/draft';
import type { NextWorkoutRead } from '@/lib/trainer2-contracts/execution';
import { effortSummary, trainingUrl, targetGroups, type WorkoutIntent } from './training-summary';

export function PlannedWorkout({ workout }: { workout: WorkoutIntent }) {
  return <section aria-label="Planned workout" className="space-y-3"><h3 className="text-lg font-semibold">Planned workout</h3>
    <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white px-4">{workout.positions.map(p => <li key={p.id} className="py-3">
      <div className="flex flex-wrap justify-between gap-1"><h4 className="font-semibold">{p.exercise.name}{p.exercise.variation && ` · ${p.exercise.variation}`}</h4><span className="text-xs text-slate-500">{p.role}</span></div>
      {targetGroups(p.targets).map(g => <p key={g.first} className="mt-1 text-sm text-slate-600">{g.count} × {g.label}</p>)}
    </li>)}</ul></section>;
}

export function TrainingOverview({ document, next, program = false }: { document: DraftDocument; next: NextWorkoutRead; program?: boolean }) {
  const current = next.execution?.initial.planId === next.planId ? next.execution.initial.occurrence : next.occurrence;
  const stageId = current?.stageId ?? document.occurrences.at(-1)?.stageId;
  const week = document.stages.findIndex(s => s.id === stageId) + 1;
  const metadata = document.builder?.weeks.find(w => w.stageId === stageId);
  const stages = program ? document.stages : document.stages.filter(s => s.id === stageId);
  const completed = next.occurrences.filter(o => o.status === 'Finished').length;
  const skipped = next.occurrences.filter(o => o.status === 'Skipped').length;
  return <div className="space-y-5">
    <header className="space-y-2"><div className="flex items-center justify-between gap-3"><p className="text-sm font-semibold uppercase tracking-widest text-teal-700">{program ? 'Program' : 'Training'}</p>
      <a className="inline-flex min-h-11 items-center text-sm font-semibold text-teal-800 underline" href={program ? trainingUrl(next.planId) : `${trainingUrl(next.planId)}&view=program`}>{program ? 'Back to training' : 'View Program'}</a></div>
      <h1 className="text-3xl font-semibold tracking-tight">{document.name}</h1>
      <p className="text-lg font-medium">{next.lifecycle === 'Completed' ? 'Program complete' : `Week ${week} of ${document.stages.length}`}{metadata && next.lifecycle !== 'Completed' ? ` · ${metadata.deload ? 'Deload' : 'Accumulation'}` : ''}</p>
      {current && <p className="text-teal-800">{effortSummary(current)}<span className="text-sm text-slate-500"> · reps in reserve</span></p>}
      {next.lifecycle === 'Completed' && <p>{completed} workouts completed · {skipped} skipped. Your results and saved program remain available below.</p>}
    </header>
    {stages.map(stage => {
      const occurrences = document.occurrences.filter(o => o.stageId === stage.id);
      const rows = occurrences.map(o => next.occurrences.find(r => r.occurrenceId === o.id));
      return <section key={stage.id} className="space-y-3" aria-label={stage.name}>
        <h2 className="font-semibold">{stage.name} <span className="font-normal text-slate-500">· {rows.filter(r => r?.status === 'Finished').length} of {rows.length} workouts completed · {rows.filter(r => r?.status === 'Skipped').length} skipped</span></h2>
        <div className="grid grid-cols-2 gap-3">{occurrences.map((o, i) => {
          const row = next.occurrences.find(r => r.occurrenceId === o.id);
          const status = o.id === next.execution?.initial.occurrence.id ? 'In progress' : row?.status === 'Finished' ? 'Completed' : row?.status === 'Skipped' ? 'Skipped' : o.id === next.occurrence?.id ? 'Next' : 'Later';
          return <article key={o.id} className={`rounded-xl border p-4 ${status === 'Next' || status === 'In progress' ? 'border-teal-500 bg-teal-50' : 'border-slate-200 bg-white'}`}>
            <p className="text-xs font-semibold uppercase text-slate-500">Workout {i + 1} · {status}</p><h3 className="mt-1 font-semibold">{o.name}</h3>
            {row?.executionId && <a className="inline-flex min-h-11 items-center text-sm text-teal-800 underline" href={`/trainer2/dev/executions/${row.executionId}`}>View results</a>}
            {program && <details className="mt-2"><summary className="min-h-11 cursor-pointer text-sm">Prescriptions</summary><PlannedWorkout workout={o} /></details>}
          </article>;
        })}</div>
      </section>;
    })}
  </div>;
}
