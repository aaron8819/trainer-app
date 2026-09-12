"use client";
import { useState } from 'react';
import type { DraftDocument } from '@/lib/trainer2-contracts/draft';
import { expandWorkoutDefaults, newRow, restoreWeek, type Row } from '@/lib/engine/trainer2/plan-builder';
import { DraftEditor, control, TargetFields } from './DraftEditor';

type Target = DraftDocument['occurrences'][number]['positions'][number]['targets'][number];
function NumberField({ label, value, min = 1, max = 1000, change }: { label: string; value: number; min?: number; max?: number; change: (v: number) => void }) {
  return <label className="grid min-w-0 gap-1 text-sm text-slate-600">{label}<input className={`${control} w-full min-w-0`} type="number" min={min} max={max} value={value || ''} onChange={e => change(Number(e.target.value))} /></label>;
}
function Prescription({ sets, target, changeSets, change, weeklyDefaults = false }: { weeklyDefaults?: boolean; sets: number; target: Omit<Target, 'id'>; changeSets: (v: number) => void; change: (fn: (t: Omit<Target, 'id'>) => void) => void }) {
  return <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
    <NumberField label="Sets" value={sets} max={20} change={changeSets} />
    <NumberField label="Reps from" value={target.reps.min} change={v => change(t => { t.reps.min = v; })} />
    <NumberField label="Reps to" value={target.reps.max} change={v => change(t => { t.reps.max = v; })} />
    <label className="grid gap-1 text-sm text-slate-600">Reps left<select className={`${control} w-full`} value={target.rir ?? ''} onChange={e => change(t => { t.rir = e.target.value || null; })}>
      <option value="">{weeklyDefaults ? "Weekly targets" : "Unspecified"}</option>{Array.from({ length: 11 }, (_, i) => <option key={i} value={i}>{i} reps left</option>)}
      {target.rir && !Array.from({ length: 11 }, (_, i) => String(i)).includes(target.rir) && <option value={target.rir}>{target.rir} reps left</option>}
    </select></label>
  </div>;
}
export function PlanBuilder({ document: doc, disabled, onChange }: { document: DraftDocument; disabled: boolean; onChange: (d: DraftDocument) => void }) {
  const [workoutIndex, setWorkoutIndex] = useState(0);
  const [weekIndex, setWeekIndex] = useState<number | null>(null);
  const [weeksOpen, setWeeksOpen] = useState(false);
  const [exerciseName, setExerciseName] = useState('');
  const [restorePending, setRestorePending] = useState(false);
  if (!doc.builder) return <DraftEditor document={doc} disabled={disabled} onChange={onChange} />;
  const b = doc.builder;
  const workout = b.workouts[workoutIndex];
  const occurrence = weekIndex === null ? null : doc.occurrences.find(o => o.stageId === b.weeks[weekIndex].stageId && o.workoutKey === workout.key)!;
  const choices = [...new Set(doc.occurrences.flatMap(o => o.positions.map(p => p.exercise.name)))].filter(Boolean);
  function update(fn: (d: DraftDocument) => void, expand = true) {
    if (disabled) return;
    const next = structuredClone(doc); fn(next); onChange(expand ? expandWorkoutDefaults(next) : next);
  }
  function sharedRow(key: string, fn: (r: Row) => void) { update(d => fn(d.builder!.workouts[workoutIndex].rows.find(r => r.key === key)!)); }
  function weekEdit(fn: (o: NonNullable<typeof occurrence>) => void) {
    update(d => { const o = d.occurrences.find(o => o.id === occurrence!.id)!; o.weekOverride = true; fn(o); }, false);
  }
  function add() {
    if (!exerciseName.trim()) return;
    const row = newRow(exerciseName.trim());
    if (occurrence) weekEdit(o => { o.positions.push({ id: crypto.randomUUID(), exercise: row.exercise, targets: Array.from({ length: b.weeks[weekIndex!].deload ? 2 : 3 }, () => ({ ...structuredClone(row.prescription), id: crypto.randomUUID(), rir: b.weeks[weekIndex!].rir })) }); });
    else update(d => { d.builder!.workouts[workoutIndex].rows.push(row); });
    setExerciseName('');
  }
  function changeScope(index: number | null) { setWeekIndex(index); setRestorePending(false); }
  return <fieldset disabled={disabled} className="min-w-0 space-y-4">
    <details><summary className="cursor-pointer text-sm font-medium">Edit schedule</summary><div className="mt-3 space-y-3 rounded-xl border p-4"><p className="text-sm text-slate-600">Five weeks, four ordered workouts each week. Drag-free ordering: move a workout earlier or later. No weekdays are assigned.</p>{b.workouts.map((w, i) => <div key={w.key} className="flex flex-wrap items-center gap-2"><span className="flex-1">{w.name}</span><button type="button" className={control} disabled={i === 0} onClick={() => update(d => { const ws = d.builder!.workouts; [ws[i - 1], ws[i]] = [ws[i], ws[i - 1]]; d.occurrences = d.builder!.weeks.flatMap(week => ws.map(w => d.occurrences.find(o => o.stageId === week.stageId && o.workoutKey === w.key)!)); setWorkoutIndex(i - 1); })}>Earlier</button><button type="button" className={control} disabled={i === 3} onClick={() => update(d => { const ws = d.builder!.workouts; [ws[i], ws[i + 1]] = [ws[i + 1], ws[i]]; d.occurrences = d.builder!.weeks.flatMap(week => ws.map(w => d.occurrences.find(o => o.stageId === week.stageId && o.workoutKey === w.key)!)); setWorkoutIndex(i + 1); })}>Later</button></div>)}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">{b.weeks.map((w, i) => <label key={w.stageId} className="text-sm">Week {i + 1} reps left<input type="number" min="0" max="10" className={`${control} mt-1 w-full`} value={w.rir ?? ''} onChange={e => update(d => { d.builder!.weeks[i].rir = e.target.value || null; })} /></label>)}</div>
    </div></details>
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-semibold">Workouts</h2><button type="button" className={control} onClick={() => setWeeksOpen(!weeksOpen)}>{weeksOpen ? 'Hide weeks' : 'View all 5 weeks'}</button></div>
    {weeksOpen && <section aria-label="All five weeks" className="grid gap-2 sm:grid-cols-5">{b.weeks.map((w, i) => <div key={w.stageId} className={`rounded-xl border p-3 ${w.deload ? 'border-teal-300 bg-teal-50' : 'border-slate-200 bg-slate-50'}`}>
      <button type="button" className="font-semibold underline underline-offset-4" onClick={() => changeScope(i)}>Week {i + 1}{w.deload ? ' · Deload' : ''}</button>
      <p className="mt-1 text-sm">{w.rir} reps left</p><p className="text-xs text-slate-600">{w.deload ? 'Half sets, rounded up' : 'Working sets'}</p>
      {b.workouts.map(workout => { const o = doc.occurrences.find(o => o.stageId === w.stageId && o.workoutKey === workout.key)!; return <button key={o.id} type="button" className="mt-3 block w-full text-left text-sm" onClick={() => { setWorkoutIndex(b.workouts.indexOf(workout)); changeScope(i); }}><span className="font-medium">{o.name}</span><span className="block text-xs text-slate-600">{o.positions.length ? o.positions.map(p => `${p.exercise.name}: ${p.targets.length} × ${p.targets[0]?.reps.min ?? "–"}–${p.targets[0]?.reps.max ?? "–"}${p.targets[0]?.rir !== null ? ` · ${p.targets[0]?.rir} left` : ''}`).join('; ') : 'Add exercises'}{o.weekOverride ? ' · Week-only edits' : ''}</span></button>; })}
    </div>)}</section>}
    <div role="tablist" aria-label="Workouts" className="grid grid-cols-4 gap-2">{b.workouts.map((w, i) => <button type="button" role="tab" aria-selected={i === workoutIndex} key={w.key} onClick={() => { setWorkoutIndex(i); setRestorePending(false); }} className={`rounded-xl px-2 py-3 text-sm font-medium sm:px-4 sm:text-base ${i === workoutIndex ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700'}`}>{w.name}</button>)}</div>
    <div className="rounded-xl bg-slate-50 p-4"><div className="flex flex-wrap items-center justify-between gap-3"><p className="font-medium">{weekIndex === null ? 'Editing across the plan' : `Editing week ${weekIndex + 1} only${b.weeks[weekIndex].deload ? ' · Deload' : ''}`}</p>{weekIndex !== null && <button type="button" className={control} onClick={() => changeScope(null)}>Edit across plan</button>}</div>
      <p className="mt-1 text-sm text-slate-600">{weekIndex === null ? 'Updates all weeks; workouts with week-only edits stay unchanged.' : 'Changes here apply only to this workout in this week. Shared edits will leave this workout unchanged.'}</p>
      {occurrence?.weekOverride && <button type="button" className="mt-3 text-sm underline" onClick={() => setRestorePending(true)}>Restore workout defaults</button>}
      {restorePending && occurrence && <div className="mt-3 space-y-2"><p className="text-sm">Replace week {weekIndex! + 1}’s {occurrence.name} ({occurrence.positions.length} exercises, {occurrence.positions.reduce((n, p) => n + p.targets.length, 0)} sets) with the current shared workout and weekly targets? Week-only changes will be removed.</p><button type="button" className={control} onClick={() => { onChange(restoreWeek(doc, occurrence.id)); setRestorePending(false); }}>Restore defaults</button> <button type="button" className={control} onClick={() => setRestorePending(false)}>Keep week edits</button></div>}
    </div>
    <details className="text-sm text-slate-600"><summary className="cursor-pointer">What does “reps left” mean?</summary><p className="mt-2">Finish the set when you could still do this many more good reps. Weekly targets start easier, build effort, then ease off for the deload. Adjust them to suit your plan.</p></details>
    <div className="space-y-3">{!occurrence ? workout.rows.map((r, i) => <section key={r.key} aria-label={`Exercise ${i + 1}`} className="space-y-4 rounded-xl border border-slate-200 p-4">
      <label className="block text-sm font-medium">Exercise<input aria-label={`Exercise ${i + 1} name`} list="plan-exercises" className={`${control} mt-1 w-full`} value={r.exercise.name} onChange={e => sharedRow(r.key, r => { r.exercise.name = e.target.value; })} /></label>
      <Prescription weeklyDefaults sets={r.sets} target={r.prescription} changeSets={v => sharedRow(r.key, r => { r.sets = Math.max(1, Math.min(20, v)); })} change={fn => sharedRow(r.key, r => fn(r.prescription))} />
      <details><summary className="cursor-pointer text-sm text-slate-600">Advanced · weight, rest and set details</summary><div className="mt-3"><TargetFields target={{ ...r.prescription, id: r.key }} change={fn => sharedRow(r.key, r => { const t = { ...r.prescription, id: r.key }; fn(t); const { id: ignored, ...value } = t; void ignored; r.prescription = value; })} /></div></details>
      <div className="flex flex-wrap gap-2 text-sm"><button type="button" className={control} disabled={i === 0} onClick={() => update(d => { const rows = d.builder!.workouts[workoutIndex].rows; [rows[i - 1], rows[i]] = [rows[i], rows[i - 1]]; })}>Move up</button><button type="button" className={control} disabled={i === workout.rows.length - 1} onClick={() => update(d => { const rows = d.builder!.workouts[workoutIndex].rows; [rows[i], rows[i + 1]] = [rows[i + 1], rows[i]]; })}>Move down</button><button type="button" className={control} onClick={() => update(d => { d.builder!.workouts[workoutIndex].rows.splice(i, 1); })}>Remove exercise</button></div>
    </section>) : occurrence.positions.map((p, i) => <section key={p.id} aria-label={`Exercise ${i + 1}`} className="space-y-4 rounded-xl border border-slate-200 p-4">
      <label className="block text-sm font-medium">Exercise<input aria-label={`Exercise ${i + 1} name`} className={`${control} mt-1 w-full`} list="plan-exercises" value={p.exercise.name} onChange={e => weekEdit(o => { o.positions[i].exercise.name = e.target.value; })} /></label>
      {p.targets[0] && <Prescription sets={p.targets.length} target={p.targets[0]} changeSets={v => weekEdit(o => { const targets = o.positions[i].targets; const count = Math.max(1, Math.min(20, v)); while (targets.length < count) targets.push({ ...structuredClone(targets[targets.length - 1]), id: crypto.randomUUID() }); targets.splice(count); })} change={fn => weekEdit(o => o.positions[i].targets.forEach(fn))} />}
      {p.targets.some(t => JSON.stringify({ ...t, id: "" }) !== JSON.stringify({ ...p.targets[0], id: "" })) && <p className="text-sm text-slate-600">Individual sets differ. The fields above show the first set; changing them applies to every set. Review each set below.</p>}
      <details><summary className="cursor-pointer text-sm text-slate-600">Advanced · edit individual sets</summary><div className="mt-3 space-y-4">{p.targets.map((t, j) => <div key={t.id}><p className="mb-2 font-medium">Set {j + 1}</p><TargetFields target={t} change={fn => weekEdit(o => fn(o.positions[i].targets[j]))} /></div>)}</div></details>
      <div className="flex flex-wrap gap-2 text-sm"><button type="button" className={control} disabled={i === 0} onClick={() => weekEdit(o => { [o.positions[i - 1], o.positions[i]] = [o.positions[i], o.positions[i - 1]]; })}>Move up</button><button type="button" className={control} disabled={i === occurrence.positions.length - 1} onClick={() => weekEdit(o => { [o.positions[i], o.positions[i + 1]] = [o.positions[i + 1], o.positions[i]]; })}>Move down</button><button type="button" className={control} onClick={() => weekEdit(o => { o.positions.splice(i, 1); })}>Remove exercise</button></div>
    </section>)}</div>
    <div className="rounded-xl border border-dashed border-slate-300 p-5"><label className="block text-sm font-medium" htmlFor="add-exercise">{!(occurrence?.positions.length ?? workout.rows.length) ? `Build ${workout.name} · add your first exercise` : 'Add another exercise'}</label><p className="mt-1 text-sm text-slate-500">Choose an exercise already in this plan, or enter a new name.</p><div className="mt-3 flex flex-col gap-2 sm:flex-row"><input id="add-exercise" list="plan-exercises" className={`${control} min-w-0 flex-1`} placeholder="e.g. Squat" value={exerciseName} onChange={e => setExerciseName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} /><button type="button" className={control} disabled={!exerciseName.trim()} onClick={add}>Add exercise</button></div><datalist id="plan-exercises">{choices.map(name => <option key={name} value={name} />)}</datalist></div>

  </fieldset>;
}
