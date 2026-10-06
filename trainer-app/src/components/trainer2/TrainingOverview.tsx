'use client';
import { useState, type ReactNode } from 'react';
import type { DraftDocument } from '@/lib/trainer2-contracts/draft';
import type { NextWorkoutRead } from '@/lib/trainer2-contracts/execution';
import { orderedWorkoutGroups } from '@/lib/engine/trainer2/ordered-workouts';
import { effortSummary, trainingUrl, targetGroups, type WorkoutIntent } from './training-summary';
import styles from './TrainingOverview.module.css';

export function PlannedWorkout({ workout, design = false }: { workout: WorkoutIntent; design?: boolean }) {
  if (!design) return <section aria-label="Planned workout" className="space-y-3"><h3 className="text-lg font-semibold">Planned workout</h3>
    <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white px-3 sm:px-4">{workout.positions.map(p => <li key={p.id} className="py-3">
      <div className="flex flex-wrap justify-between gap-1"><h4 className="min-w-0 break-words font-semibold">{p.exercise.name}</h4><span className="text-xs text-slate-500">{p.role}</span></div>
      {targetGroups(p.targets).map(g => <p key={g.first} className="mt-1 break-words text-sm text-slate-600">{g.count} × {g.label}</p>)}
      {p.exercise.variation && <details className="mt-1"><summary className="min-h-11 cursor-pointer py-3 text-sm">Exercise details</summary><p className="break-words text-sm">{p.exercise.variation}</p></details>}
    </li>)}</ul></section>;
  return <section aria-label="Planned workout"><h3 className="sr-only">Planned workout</h3>
    <ul className={styles.prescriptions}>{workout.positions.map(p => <li key={p.id}>
      <h4>{p.exercise.name}</h4>
      {targetGroups(p.targets).map(g => <p key={g.first}>{g.count} × {g.label}</p>)}
      {p.targets.some(t => !t.measurement) && <p>Load unspecified · confirm when logging</p>}
      {p.targets.some(t => t.measurement?.kind === 'assistance') && <p>Assistance · more weight means easier</p>}
      <details><summary>Exercise details</summary><p>{p.role}{p.exercise.variation ? ` · ${p.exercise.variation}` : ''}</p></details>
    </li>)}</ul></section>;
}

export function TrainingOverview({ document, next, program = false, selectedId, onSelect, locked = false, preview, advancement }: {
  document: DraftDocument; next: NextWorkoutRead; program?: boolean; selectedId?: string; onSelect?: (id: string) => void; locked?: boolean;
  preview?: ReactNode; advancement?: ReactNode;
}) {
  const groups = orderedWorkoutGroups(document);
  const current = next.execution?.initial.planId === next.planId ? next.execution.initial.occurrence : next.occurrence;
  const currentIndex = next.week?.index ?? (current ? groups.findIndex(g => g.workouts.some(w => w.occurrence.id === current.id)) : groups.length - 1);
  const [browsedWeek, setBrowsedWeek] = useState<number | null>(null);
  const weekIndex = program ? Math.min(browsedWeek ?? currentIndex, groups.length - 1) : currentIndex;
  const group = groups[weekIndex];
  const rows = group?.workouts.map(w => next.occurrences.find(r => r.occurrenceId === w.occurrence.id)) ?? [];
  const finished = rows.filter(r => r?.status === 'Finished').length;
  const skipped = rows.filter(r => r?.status === 'Skipped').length;
  const count = group?.workouts.length ?? 0;
  const status = (o: WorkoutIntent) => o.id === next.execution?.initial.occurrence.id ? 'In progress' :
    next.occurrences.find(r => r.occurrenceId === o.id)?.status === 'Finished' ? 'Finished' :
    next.occurrences.find(r => r.occurrenceId === o.id)?.status === 'Skipped' ? 'Skipped' : 'Pending';
  return <div className={styles.screen}>
    <header className={styles.title}><p className={styles.eyebrow}>{program ? 'Program' : 'Your training'}</p>
      <h1>{program ? document.name : next.lifecycle === 'Completed' ? 'Program complete' : 'Ready when you are.'}</h1>
      <p className={styles.subtitle}>{program ? 'Your saved prescriptions, week by week.' : document.name}</p>
      <a className={styles.textLink} href={program ? trainingUrl(next.planId) : `${trainingUrl(next.planId)}&view=program`}>{program ? 'Back to training' : 'View Program'}</a>
    </header>
    <div className={program ? styles.program : styles.layout}>
      <section className={styles.stack}>
        <section className={`${styles.card} ${styles.hero}`} aria-label="Week progress">
          <div className={styles.row}><div><p className={styles.eyebrow}>{group?.deload ? 'Deload' : group?.stage.name ?? 'Training week'}</p>
            <h2>{program ? 'One clear plan.' : `Week ${currentIndex + 1} of ${groups.length}`}</h2></div>
            {program && <span className={styles.tag}>Saved · {next.lifecycle === 'Completed' ? 'Completed' : 'Active'} · read-only</span>}
          </div>
          {program ? <>
            <nav aria-label="Program weeks" className={styles.weeks}>{groups.map((g, i) => <button key={`${g.stage.id}:${i}`} type="button"
              aria-label={`Week ${i + 1}${g.deload ? ' Deload' : ''}`} aria-current={i === weekIndex ? 'page' : undefined} aria-pressed={i === weekIndex} className={i === weekIndex ? styles.selected : ''}
              onClick={() => setBrowsedWeek(i)}>W{i + 1}<small>{g.deload ? 'Deload' : effortSummary({ ...g.workouts[0].occurrence, positions: g.workouts.flatMap(w => w.occurrence.positions) }).replace('Target ', '')}</small></button>)}</nav>
            <p className={styles.support}>Browsing Week {weekIndex + 1} · {weekIndex === currentIndex ? 'Current training week' : weekIndex < currentIndex ? 'Past week' : 'Planned week'}. Browsing does not advance training.</p>
          </> : <>
            <div role="progressbar" aria-label="Resolved workout progress" aria-valuemin={0} aria-valuemax={count} aria-valuenow={finished + skipped} className={styles.progress}><span style={{ width: `${count ? (finished + skipped) / count * 100 : 0}%` }} /></div>
            <p className={styles.support}>{finished} finished · {skipped} skipped · {count - finished - skipped} remaining</p>
            <p className={styles.support}>{effortSummary(current ?? group?.workouts[0]?.occurrence)} · reps in reserve</p>
            {next.lifecycle === 'Completed' && <p>Your results and saved program remain available for review.</p>}
            {next.execution && <a className={styles.primary} href={`/trainer2/dev/executions/${next.execution.executionId}`}>Resume {next.execution.initial.occurrence.name}</a>}
            {advancement}
          </>}
        </section>
        {!program && <><div className={styles.sectionHead}><h2>This week</h2><span>Choose a workout</span></div>
          <div className={styles.choices}>{group?.workouts.map(({ occurrence: o }, i) => <article key={o.id} data-occurrence-id={o.id}>
            <button type="button" className={`${styles.choice} ${selectedId === o.id ? styles.active : ''}`} aria-pressed={selectedId === o.id}
              aria-label={`Select ${o.name}, workout ${i + 1}, ${status(o)}`} disabled={locked} onClick={() => onSelect?.(o.id)}>
              <span className={styles.number} aria-hidden="true">{status(o) === 'Finished' ? '✓' : status(o) === 'Skipped' ? '—' : String(i + 1).padStart(2, '0')}</span>
              <span className={styles.grow}><strong>{o.name}</strong><span className={styles.status}>{status(o)} · {o.positions.length} exercises · {o.positions.reduce((n, p) => n + p.targets.length, 0)} sets</span></span>
              <span aria-hidden="true">{selectedId === o.id ? '↗' : '›'}</span>
            </button>
          </article>)}</div>
          <p className={styles.note}>{next.execution ? 'An open workout is waiting. Resume it, or preview another workout.' : 'Selecting and reviewing a workout does not start it. Start when you are ready.'}</p>
        </>}
      </section>
      {program ? <section aria-label={group?.stage.name ?? 'Week workouts'}>
        <div className={styles.sectionHead}><h2>Week {weekIndex + 1} workouts</h2><span>{finished} finished · {skipped} skipped</span></div>
        <div className={styles.programGrid}>{group?.workouts.map(({ occurrence: o }) => {
          const row = next.occurrences.find(r => r.occurrenceId === o.id);
          return <details key={o.id} data-occurrence-id={o.id} className={styles.card}>
            <summary className={styles.workoutSummary}>{o.name}</summary>
            <div className={styles.cardMeta}><span className={styles.tag}>{status(o)}</span><span>{o.positions.length} exercises · {o.positions.reduce((n, p) => n + p.targets.length, 0)} sets</span></div>
            {row?.skip && <p className={styles.support}>Explicitly skipped · {new Date(row.skip.skippedAt).toLocaleDateString()}</p>}
            <PlannedWorkout workout={o} design />
            {o.id === next.execution?.initial.occurrence.id ? <a className={styles.primary} href={`/trainer2/dev/executions/${next.execution.executionId}`}>Resume workout</a> :
              row?.executionId ? <a className={styles.secondary} href={`/trainer2/dev/executions/${row.executionId}`}>View results</a> : <a className={styles.secondary} href={trainingUrl(next.planId)}>Back to current-week selection</a>}
          </details>;
        })}</div>
        <p className={styles.note}>Saved prescriptions are preserved. Build a separate draft to explore changes.</p>
        {advancement}
      </section> : <section className={`${styles.card} ${styles.preview}`} aria-label="Workout preview">{preview}</section>}
    </div>
    <nav aria-label="Trainer2 navigation" className={styles.navigation}>
      <a href={trainingUrl(next.planId)} aria-current={!program ? 'page' : undefined}>Training</a>
      <a href={`${trainingUrl(next.planId)}&view=program`} aria-current={program ? 'page' : undefined}>Program</a>
      <a href="/trainer2/dev/drafts?view=builder">Build a plan</a>
    </nav>
  </div>;
}
