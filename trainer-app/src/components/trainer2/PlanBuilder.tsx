"use client";

import { useEffect, useRef, useState } from 'react';
import type { DraftDocument } from '@/lib/trainer2-contracts/draft';
import { expandWorkoutDefaults, markOverride, newRow, resetField, restoreWeek, sharedSwapConflicts, type OverrideField, type Row } from '@/lib/engine/trainer2/plan-builder';
import { equipmentOptions, swapPrescription } from '@/lib/engine/trainer2/catalog';
import { DraftEditor, control, TargetFields } from './DraftEditor';
import { ExercisePicker } from './ExercisePicker';
type Position = DraftDocument['occurrences'][number]['positions'][number];
const roles = ['Main lift', 'Secondary lift', 'Accessory', 'Calves', 'Core'] as const;
function ConfirmReplacement({
  text,
  confirm,
  cancel
}: {
  text: string;
  confirm: () => void;
  cancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current!;
    d.showModal();
    return () => d.close();
  }, []);
  return <dialog ref={ref} onCancel={cancel} aria-label="Confirm replacement" className="m-auto w-[calc(100%-2rem)] max-w-lg space-y-4 rounded-xl p-5 backdrop:bg-slate-900/40"><p>{text}</p><button type="button" className={control} onClick={confirm}>Confirm replacement</button> <button type="button" className={control} onClick={cancel}>Keep my edits</button></dialog>;
}
export function PlanBuilder({
  document: doc,
  disabled,
  onChange
}: {
  document: DraftDocument;
  disabled: boolean;
  onChange: (d: DraftDocument) => void;
}) {
  const [workoutIndex, setWorkoutIndex] = useState(0);
  const [weekIndex, setWeekIndex] = useState<number | null>(null);
  const [weeksOpen, setWeeksOpen] = useState(false);
  const [picker, setPicker] = useState<{
    key?: string;
  } | null>(null);
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState<{
    text: string;
    run: () => void;
  } | null>(null);
  if (!doc.builder) return <DraftEditor document={doc} disabled={disabled} onChange={onChange} />;
  const b = doc.builder,
    workout = b.workouts[workoutIndex];
  const occurrence = weekIndex === null ? undefined : doc.occurrences.find(o => o.stageId === b.weeks[weekIndex].stageId && o.workoutKey === workout.key)!;
  const rows = occurrence ? occurrence.positions.map(p => ({
    key: p.id,
    exercise: p.exercise,
    role: p.role,
    sets: p.targets.length,
    prescription: p.targets[0],
    position: p
  })) : workout.rows.map(r => ({
    ...r,
    position: undefined as Position | undefined
  }));
  const scope = weekIndex === null ? 'All weeks' : `Week ${weekIndex + 1} only`;
  function update(fn: (d: DraftDocument) => void) {
    if (disabled) return;
    const next = structuredClone(doc);
    fn(next);
    onChange(expandWorkoutDefaults(next));
  }
  function field(key: string, name: OverrideField, value: unknown, confirmed = false) {
    const cut = name === 'sets' ? doc.occurrences.filter(o => occurrence ? o.id === occurrence.id : o.workoutKey === workout.key && !o.weekOverride && !o.overrides?.fields[o.positions.find(p => p.sourceKey === key)?.id ?? '']?.includes('sets')).flatMap(o => o.positions.filter(p => occurrence ? p.id === key : p.sourceKey === key).flatMap(p => p.targets.slice(occurrence ? Number(value) : b.weeks.find(w => w.stageId === o.stageId)?.deload ? Math.max(1, Math.ceil(Number(value) / 2)) : Number(value)).filter(t => o.overrides?.targets?.[t.id]).map(t => ({
      occurrenceId: o.id,
      targetId: t.id
    })))) : [];
    if (cut.length && !confirmed) {
      setPending({
        text: 'Fewer sets removes ' + cut.length + ' individually edited sets. Other work stays.',
        run: () => field(key, name, value, true)
      });
      return;
    }
    update(d => {
      for (const c of cut) delete d.occurrences.find(o => o.id === c.occurrenceId)!.overrides!.targets![c.targetId];
      if (occurrence) {
        const o = d.occurrences.find(o => o.id === occurrence.id)!,
          p = o.positions.find(p => p.id === key)!;
        markOverride(o, p.id, [name], name !== 'sets' && name !== 'role' && name !== 'exercise' ? {
          [name]: value
        } : undefined);
        if (name === 'role') p.role = value as Row['role'];else if (name === 'sets') {
          const count = Math.max(1, Math.min(20, Number(value)));
          while (p.targets.length < count) p.targets.push({
            ...structuredClone(p.targets.at(-1) ?? newRow('').prescription),
            id: crypto.randomUUID()
          });
          p.targets.splice(count);
        } else p.targets.forEach(t => Object.assign(t, {
          [name]: value
        }));
      } else {
        const r = d.builder!.workouts[workoutIndex].rows.find(r => r.key === key)!;
        if (name === 'sets') r.sets = Math.max(1, Math.min(20, Number(value)));else if (name === 'role') r.role = value as Row['role'];else Object.assign(r.prescription, {
          [name]: value
        });
      }
    });
  }
  function choose(exercise: Position['exercise'], confirmed = false) {
    const selected = rows.find(r => r.key === picker?.key);
    const conflicts = !occurrence && selected ? sharedSwapConflicts(doc, selected.key, exercise) : [];
    if (conflicts.length && !confirmed) {
      setPicker(null);
      setPending({
        text: 'This swap replaces incompatible week-only rep conventions or weight values in ' + conflicts.map(c => doc.stages.find(s => s.id === doc.occurrences.find(o => o.id === c.occurrenceId)!.stageId)!.name).join(', ') + '. Other overrides stay. Confirm to clear those fields.',
        run: () => choose(exercise, true)
      });
      return;
    }
    update(d => {
      for (const conflict of conflicts) {
        const o = d.occurrences.find(o => o.id === conflict.occurrenceId)!;
        o.overrides!.fields[conflict.positionId] = (o.overrides!.fields[conflict.positionId] ?? []).filter(f => !conflict.fields.includes(f));
        for (const field of conflict.fields) {
          if (field === 'reps' || field === 'measurement') delete o.overrides?.values?.[conflict.positionId]?.[field];
        }
        if (!o.overrides!.fields[conflict.positionId]?.length) delete o.overrides!.fields[conflict.positionId];
        for (const t of o.positions.find(p => p.id === conflict.positionId)!.targets) if (o.overrides?.targets?.[t.id]) {
          o.overrides.targets[t.id] = o.overrides.targets[t.id].filter(f => !conflict.fields.includes(f));
          if (!o.overrides.targets[t.id].length) delete o.overrides.targets[t.id];
        }
      }
      if (occurrence) {
        const o = d.occurrences.find(o => o.id === occurrence.id)!;
        if (selected) {
          const p = o.positions.find(p => p.id === selected.key)!;
          const priorRepOverrides = p.targets.filter(t => o.overrides?.targets?.[t.id]?.includes('reps') && JSON.stringify(swapPrescription(p.exercise, exercise, t).reps) === JSON.stringify(t.reps)).map(t => t.id);
          const source = workout.rows.find(r => r.key === p.sourceKey);
          const base = swapPrescription(p.exercise, exercise, { ...(source?.prescription ?? p.targets[0] ?? newRow('').prescription), ...o.overrides?.values?.[p.id] });
          markOverride(o, p.id, ['exercise', 'reps', 'measurement']);
          p.targets = p.targets.map(t => ({
            ...swapPrescription(p.exercise, exercise, t),
            id: t.id
          }));
          p.exercise = exercise;
          markOverride(o, p.id, ['exercise', 'reps', 'measurement'], {
            reps: base.reps,
            measurement: base.measurement
          });
          if (o.overrides) for (const targetId of priorRepOverrides) {
            o.overrides.targets ??= {};
            o.overrides.targets[targetId] = [...new Set([...(o.overrides.targets[targetId] ?? []), 'reps' as const])];
          }
        } else {
          const row = newRow(exercise.name);
          const prescription = swapPrescription(row.exercise, exercise, row.prescription);
          o.positions.push({
            id: crypto.randomUUID(),
            exercise,
            role: 'Accessory',
            targets: Array.from({
              length: b.weeks[weekIndex!].deload ? 2 : 3
            }, () => ({
              ...structuredClone(prescription),
              rir: b.weeks[weekIndex!].rir,
              id: crypto.randomUUID()
            }))
          });
        }
      } else {
        const w = d.builder!.workouts[workoutIndex];
        if (selected) {
          const r = w.rows.find(r => r.key === selected.key)!;
          r.prescription = swapPrescription(r.exercise, exercise, r.prescription);
          r.exercise = exercise;
        } else {
          const r = newRow(exercise.name);
          r.prescription = swapPrescription(r.exercise, exercise, r.prescription);
          r.exercise = exercise;
          r.role = 'Accessory';
          w.rows.push(r);
        }
      }
    });
    setPicker(null);
    const reps = selected?.prescription && swapPrescription(selected.exercise, exercise, selected.prescription).reps;
    setNotice(selected && reps ? `${exercise.name} selected for ${scope.toLowerCase()}. Sets retained; weight cleared. ${reps.min}–${reps.max} reps ${reps.basis === 'perSide' ? 'per side' : reps.basis === 'alternating' ? 'alternating' : 'total'}.` : `${exercise.name} added.`);
  }
  function remove(key: string) {
    const affected = !occurrence ? doc.occurrences.filter(o => o.workoutKey === workout.key && o.positions.some(p => p.sourceKey === key && (o.weekOverride || o.overrides?.fields[p.id] || p.targets.some(t => o.overrides?.targets?.[t.id])))) : [];
    const run = () => update(d => {
      if (occurrence) {
        const o = d.occurrences.find(o => o.id === occurrence.id)!,
          p = o.positions.find(p => p.id === key)!;
        if (!o.weekOverride) {
          o.overrides ??= {
            removed: [],
            order: false,
            fields: {}
          };
          if (p.sourceKey) o.overrides.removed.push(p.sourceKey);
          delete o.overrides.fields[p.id];
          if (o.overrides.values) delete o.overrides.values[p.id];
          for (const t of p.targets) if (o.overrides.targets) delete o.overrides.targets[t.id];
        }
        o.positions = o.positions.filter(p => p.id !== key);
      } else {
        d.builder!.workouts[workoutIndex].rows = d.builder!.workouts[workoutIndex].rows.filter(r => r.key !== key);
        for (const o of d.occurrences.filter(o => o.workoutKey === workout.key && !o.weekOverride)) {
          for (const p of o.positions.filter(p => p.sourceKey === key)) if (o.overrides) {
            delete o.overrides.fields[p.id];
            for (const t of p.targets) if (o.overrides.targets) delete o.overrides.targets[t.id];
          }
          if (o.overrides) o.overrides.removed = o.overrides.removed.filter(k => k !== key);
        }
      }
    });
    if (affected.some(o => !o.weekOverride)) setPending({
      text: `Remove ${rows.find(r => r.key === key)!.exercise.name} from all inheriting weeks? This discards its week-only edits in ${affected.filter(o => !o.weekOverride).map(o => doc.stages.find(s => s.id === o.stageId)!.name).join(', ')}. Other exercises remain.`,
      run
    });else run();
  }
  function move(key: string, direction: number) {
    update(d => {
      if (occurrence) {
        const o = d.occurrences.find(o => o.id === occurrence.id)!;
        if (!o.weekOverride) {
          o.overrides ??= { removed: [], order: false, fields: {} };
          o.overrides.order = true;
        }
        const i = o.positions.findIndex(p => p.id === key);
        [o.positions[i], o.positions[i + direction]] = [o.positions[i + direction], o.positions[i]];
      } else {
        const rs = d.builder!.workouts[workoutIndex].rows,
          i = rs.findIndex(r => r.key === key);
        [rs[i], rs[i + direction]] = [rs[i + direction], rs[i]];
      }
    });
  }
  return <fieldset disabled={disabled} className="min-w-0 space-y-4">
    <div className="flex flex-wrap justify-between gap-2"><p className="text-sm text-slate-600">Here’s your plan. Change what you want.</p><button type="button" className="text-sm underline" onClick={() => setPending({
        text: 'Start blank replaces all exercises and week-only edits in this plan. The five-week schedule stays. Save to keep the replacement.',
        run: () => update(d => {
          d.builder!.workouts.forEach(w => {
            w.rows = [];
          });
          d.occurrences.forEach(o => {
            o.positions = [];
            o.weekOverride = false;
            delete o.overrides;
          });
        })
      })}>Start blank</button></div>
    <details><summary className="cursor-pointer text-sm">Equipment preferences · {b.equipment?.length ? b.equipment.join(', ') : 'Full gym'}</summary><p className="my-2 text-sm text-slate-600">Filters picker suggestions. Your exercises stay in place.</p><div className="flex flex-wrap gap-3">{equipmentOptions.map(e => <label className="flex min-h-11 items-center gap-2 text-sm" key={e}><input type="checkbox" disabled={b.equipment?.length === 1 && b.equipment.includes(e)} checked={!b.equipment?.length || b.equipment.includes(e)} onChange={event => update(d => {
            const available = new Set(d.builder!.equipment?.length ? d.builder!.equipment : equipmentOptions);
            if (event.target.checked) available.add(e);else available.delete(e);
            d.builder!.equipment = [...available];
          })} />{e}</label>)}</div></details>
    <details><summary className="cursor-pointer text-sm">Edit schedule</summary><div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">{b.weeks.map((w, i) => <label key={w.stageId} className="text-sm">Week {i + 1} reps left<input type="number" min="0" max="10" className={`${control} mt-1 w-full`} value={w.rir ?? ''} onChange={e => update(d => {
            d.builder!.weeks[i].rir = e.target.value || null;
          })} /></label>)}</div><div className="mt-3 flex flex-wrap gap-2">{b.workouts.map((w, i) => <button type="button" key={w.key} disabled={!i} className={control} onClick={() => update(d => {
          const ws = d.builder!.workouts;
          [ws[i - 1], ws[i]] = [ws[i], ws[i - 1]];
          d.occurrences = d.builder!.weeks.flatMap(week => ws.map(w => d.occurrences.find(o => o.stageId === week.stageId && o.workoutKey === w.key)!));
          setWorkoutIndex(i - 1);
        })}>Move {w.name} earlier</button>)}</div></details>
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-semibold">Workouts</h2><button type="button" className={control} onClick={() => setWeeksOpen(!weeksOpen)}>{weeksOpen ? 'Hide weeks' : 'View all 5 weeks'}</button></div>
    {weeksOpen && <section aria-label="All five weeks" className="grid gap-2 sm:grid-cols-5">{b.weeks.map((w, i) => <div key={w.stageId} className={`rounded-xl border p-3 ${w.deload ? 'border-teal-300 bg-teal-50' : 'bg-slate-50'}`}><h3 className="font-semibold">Week {i + 1}{w.deload ? ' · Deload' : ''}</h3><p className="text-sm">{w.rir} reps left</p>{w.deload && <p className="text-xs">Half sets, rounded up</p>}{b.workouts.map((workout, index) => {
          const o = doc.occurrences.find(o => o.stageId === w.stageId && o.workoutKey === workout.key)!;
          return <button key={o.id} type="button" className="mt-3 block w-full text-left text-sm" onClick={() => {
            setWorkoutIndex(index);
            setWeekIndex(i);
          }}><span className="font-medium underline">{o.name}</span>{(o.weekOverride || o.overrides || o.positions.some(p => !p.sourceKey)) && <span className="block text-teal-800">Week-only edits</span>}<span className="block text-xs text-slate-600">{o.positions.map(p => `${p.exercise.name}: ${p.targets.length} × ${p.targets[0]?.reps.min}–${p.targets[0]?.reps.max} · ${p.targets[0]?.rir ?? '–'} left`).join('; ')}</span></button>;
        })}</div>)}</section>}
    <div role="tablist" aria-label="Workouts" className="grid grid-cols-4 gap-2">{b.workouts.map((w, i) => <button type="button" role="tab" aria-selected={i === workoutIndex} key={w.key} onClick={() => setWorkoutIndex(i)} className={`rounded-xl px-2 py-3 text-sm font-medium ${i === workoutIndex ? 'bg-slate-900 text-white' : 'bg-slate-100'}`}>{w.name}</button>)}</div>
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 p-3"><label className="text-sm font-medium">Editing <select aria-label="Edit scope" className={control} value={weekIndex ?? 'all'} onChange={e => setWeekIndex(e.target.value === 'all' ? null : Number(e.target.value))}><option value="all">All weeks</option>{b.weeks.map((w, i) => <option value={i} key={w.stageId}>Week {i + 1} only</option>)}</select></label><p className="text-xs text-slate-600">{occurrence?.weekOverride ? 'Older independent workout. Restore to inherit shared defaults.' : 'Only explicitly edited fields stay week-specific.'}</p>{occurrence && <button type="button" className="text-sm underline" onClick={() => setPending({
        text: `Restore ${occurrence.name} in week ${weekIndex! + 1}? Removes week-only additions, removals, ordering and field edits, and uses current shared defaults.`,
        run: () => onChange(restoreWeek(doc, occurrence.id))
      })}>Restore workout defaults</button>}</div>
    {pending && <ConfirmReplacement text={pending.text} confirm={() => {
      pending.run();
      setPending(null);
    }} cancel={() => setPending(null)} />}
    {notice && <p role="status" className="text-sm text-teal-800">{notice}</p>}
    <div className="space-y-3">{rows.map((r, i) => <section key={r.key} aria-label={`Exercise ${i + 1}`} className="space-y-3 rounded-xl border border-slate-200 p-3">
      <div className="flex items-start justify-between gap-2"><div><p className="text-xs font-medium text-slate-500">{r.role ?? 'Exercise'}</p><button type="button" className="text-left font-semibold underline-offset-4 hover:underline" onClick={() => setPicker({
              key: r.key
            })}>{r.exercise.name || 'Choose exercise'}</button><p className="text-xs text-slate-500">{r.exercise.variation}{r.prescription?.reps.basis === 'perSide' ? ' · Reps per side' : ''}</p>{r.exercise.kind === 'catalogSnapshot' && b.equipment?.length && r.exercise.equipment.some(e => !b.equipment!.includes(e)) && <p className="text-xs text-amber-800">Outside your equipment preferences</p>}</div><button type="button" className={control} onClick={() => setPicker({
            key: r.key
          })}>Swap</button></div>
      {r.prescription && <div className="grid grid-cols-3 gap-2"><label className="text-xs">Sets<input aria-label={`Exercise ${i + 1} sets`} className={`${control} mt-1 w-full`} type="number" min="1" max="20" value={r.sets} onChange={e => field(r.key, 'sets', e.target.value)} /></label>{(['min', 'max'] as const).map(bound => <label key={bound} className="text-xs">Reps {bound === 'min' ? 'from' : 'to'}<input aria-label={`Exercise ${i + 1} reps ${bound}`} className={`${control} mt-1 w-full`} type="number" min="1" max="1000" value={r.prescription.reps[bound]} onChange={e => field(r.key, 'reps', {
              ...r.prescription.reps,
              [bound]: Number(e.target.value)
            })} /></label>)}</div>}
      <details><summary className="cursor-pointer text-sm text-slate-600">Effort, role & optional details</summary><div className="mt-3 space-y-3"><label className="text-sm">Role <select className={control} value={r.role ?? 'Accessory'} onChange={e => field(r.key, 'role', e.target.value)}>{roles.map(role => <option key={role}>{role}</option>)}</select></label>{r.prescription && <><p className="text-xs text-slate-600">Reps left defaults: {b.weeks.map(w => w.rir).join(' / ')}. Leave shared effort unspecified to use this pattern.</p><TargetFields exercise={r.exercise} target={{
                ...r.prescription,
                id: r.key
              }} change={(fn, name) => {
                const t = {
                  ...structuredClone(r.prescription),
                  id: r.key
                };
                fn(t);
                field(r.key, name, t[name]);
              }} /></>}{r.position && r.position.targets.some(t => JSON.stringify({
              ...t,
              id: ''
            }) !== JSON.stringify({
              ...r.position!.targets[0],
              id: ''
            })) && <p className="text-sm">Individual sets differ. The fields show the first set; each field you change applies to every set. Other details stay unchanged.</p>}</div></details>
      {occurrence && r.position && <details><summary className="cursor-pointer text-sm">Individual sets</summary><div className="mt-3 space-y-4">{r.position.targets.map((t, j) => <div key={t.id}><p className="text-sm font-medium">Set {j + 1}</p><TargetFields exercise={r.exercise} target={t} change={(fn, name) => update(d => {
                const o = d.occurrences.find(o => o.id === occurrence.id)!,
                  p = o.positions.find(p => p.id === r.key)!;
                fn(p.targets.find(target => target.id === t.id)!);
                if (!o.weekOverride) {
                  o.overrides ??= {
                    removed: [],
                    order: false,
                    fields: {}
                  };
                  o.overrides.targets ??= {};
                  o.overrides.targets[t.id] = [...new Set([...(o.overrides.targets[t.id] ?? []), name])];
                }
              })} />{occurrence.overrides?.targets?.[t.id]?.map(name => <button key={name} type="button" className="m-1 text-sm underline" onClick={() => update(d => {
                const o = d.occurrences.find(o => o.id === occurrence.id)!;
                o.overrides!.targets![t.id] = o.overrides!.targets![t.id].filter(f => f !== name);
                if (!o.overrides!.targets![t.id].length) delete o.overrides!.targets![t.id];
              })}>Reset set {j + 1} {name}</button>)}</div>)}</div></details>}
      {occurrence?.overrides?.fields[r.key] && <div className="flex flex-wrap gap-2 text-xs">{occurrence.overrides.fields[r.key].map(f => <button type="button" className="min-h-9 rounded bg-teal-50 px-2 text-teal-900" key={f} onClick={() => onChange(resetField(doc, occurrence.id, r.key, f))}>Reset {f === 'exercise' ? 'swap, reps & weight' : f} override</button>)}</div>}
      <div className="flex flex-wrap gap-2"><button type="button" className={`${control} text-xs`} disabled={i === 0} onClick={() => move(r.key, -1)}>Move up</button><button type="button" className={`${control} text-xs`} disabled={i === rows.length - 1} onClick={() => move(r.key, 1)}>Move down</button><button type="button" className={`${control} text-xs`} onClick={() => remove(r.key)}>Remove exercise</button></div>
    </section>)}</div>
    <button type="button" className={`${control} w-full border-dashed py-3`} disabled={rows.length >= 20} onClick={() => setPicker({})}>Add exercise</button>
    {picker && <ExercisePicker current={rows.find(r => r.key === picker.key)?.exercise} equipment={b.equipment ?? []} choose={choose} close={() => setPicker(null)} />}
  </fieldset>;
}
