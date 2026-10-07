"use client";
import { EquipmentResistance, EquipmentSetupEditor } from './EquipmentSetup';

import { useEffect, useRef, useState } from 'react';
import type { DraftDocument } from '@/lib/trainer2-contracts/draft';
import { setEquipmentSetup, changeSetCount, SetCountConflict, removeBuilderRow, expandWorkoutDefaults, markOverride, newRow, resetField, restoreWeek, sharedSwapConflicts, type OverrideField, type Row } from '@/lib/engine/trainer2/plan-builder';
import { equipmentOptions, swapPrescription } from '@/lib/engine/trainer2/catalog';
import { DraftEditor, control, TargetFields } from './DraftEditor';
import { prescriptionSummary } from './prescription-summary';
import { ExercisePicker } from './ExercisePicker';
import { BuilderSheet, containSheetFocus } from './BuilderSheet';
import { PrescriptionSheet } from './PrescriptionSheet';
import styles from './Builder.module.css';
import { loadLabel } from './pound-display';
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
    const trigger = document.activeElement as HTMLElement | null;
    d.showModal();
    return () => { d.close(); requestAnimationFrame(() => { if (trigger?.isConnected && !document.querySelector('dialog[open]')) trigger.focus({ preventScroll: true }); }); };
  }, []);
  return <dialog ref={ref} onKeyDown={containSheetFocus} onCancel={cancel} aria-label="Confirm replacement" className="m-auto w-[calc(100%-2rem)] max-w-lg space-y-4 rounded-xl p-5 backdrop:bg-slate-900/40"><p>{text}</p><button type="button" className={control} onClick={confirm}>Confirm replacement</button> <button type="button" className={control} onClick={cancel}>Keep my edits</button></dialog>;
}
export function PlanBuilder({
  document: doc,
  disabled,
  onChange,
  initialOccurrenceId
}: {
  document: DraftDocument;
  disabled: boolean;
  onChange: (d: DraftDocument) => void;
  initialOccurrenceId?: string;
}) {
  const initialOccurrence = doc.occurrences.find(o => o.id === initialOccurrenceId);
  const [workoutIndex, setWorkoutIndex] = useState(() => Math.max(0, doc.builder?.workouts.findIndex(w => w.key === initialOccurrence?.workoutKey) ?? 0));
  const [weekIndex, setWeekIndex] = useState<number | null>(() => initialOccurrence && doc.builder ? doc.builder.weeks.findIndex(w => w.stageId === initialOccurrence.stageId) : null);
  const [settings, setSettings] = useState<HTMLElement | null>(null);
  const [editing, setEditing] = useState<{ key: string; trigger: HTMLElement } | null>(null);
  const [weeksOpen, setWeeksOpen] = useState(false);
  const [picker, setPicker] = useState<{
    key?: string;
    trigger: HTMLElement;
  } | null>(null);
  const editor = useRef<HTMLFieldSetElement>(null);
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
  function applyPrescription(key: string, count: number, target: Position['targets'][number], fields: OverrideField[], confirmed = false) {
    try {
      let next = fields.includes('sets') ? changeSetCount(doc, { key, occurrenceId: occurrence?.id, workoutKey: workout.key }, count, confirmed) : structuredClone(doc);
      for (const name of fields.filter(f => f !== 'sets')) {
        if (occurrence) {
          const o = next.occurrences.find(o => o.id === occurrence.id)!;
          const p = o.positions.find(p => p.id === key)!;
          markOverride(o, p.id, [name], { [name]: target[name as keyof typeof target] });
          p.targets.forEach(t => Object.assign(t, { [name]: target[name as keyof typeof target] }));
        } else {
          const r = next.builder!.workouts[workoutIndex].rows.find(r => r.key === key)!;
          Object.assign(r.prescription, { [name]: target[name as keyof typeof target] });
        }
      }
      next = expandWorkoutDefaults(next);
      onChange(next); setEditing(null);
      return null;
    } catch (error) {
      if (!(error instanceof SetCountConflict)) throw error;
      return 'Fewer sets discards individually authored prescriptions: ' + error.affected.join('; ') + '. Other work stays. Confirm the reduction or keep editing.';
    }
  }
  function setCount(key: string, count: number | null, confirmed = false) {
    try {
      onChange(changeSetCount(doc, { key, occurrenceId: occurrence?.id, workoutKey: workout.key }, count, confirmed));
    } catch (error) {
      if (!(error instanceof SetCountConflict)) throw error;
      setPending({ text: (error.independent ? 'These independent sets have no shared defaults or recorded edit history. Reducing the count discards their prescriptions: ' : 'Fewer sets removes individually edited work: ') + error.affected.join('; ') + '. Other work stays.', run: () => setCount(key, count, true) });
    }
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
    const run = () => onChange(removeBuilderRow(doc, { key, occurrenceId: occurrence?.id, workoutKey: workout.key }));
    if (affected.some(o => !o.weekOverride)) setPending({
      text: `Remove ${rows.find(r => r.key === key)!.exercise.name} from all inheriting weeks? This discards its week-only edits in ${affected.filter(o => !o.weekOverride).map(o => doc.stages.find(s => s.id === o.stageId)!.name).join(', ')}. Other exercises remain.`,
      run
    });else setPending({ text: `Remove ${rows.find(r => r.key === key)!.exercise.name} from ${scope.toLowerCase()}? Other exercises stay.`, run });
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
  return <fieldset ref={editor} disabled={disabled} className="min-w-0 space-y-4">
    <div className="flex flex-wrap justify-between gap-2"><button type="button" className="underline" onClick={e => setSettings(e.currentTarget)}>Program settings</button><button type="button" className="text-sm underline" onClick={() => setPending({
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
    {settings && <BuilderSheet title="Program settings" trigger={settings} close={() => setSettings(null)}><div className={styles.sheetBody}><p className={styles.muted}>Changes apply to this draft immediately. Weekly effort and equipment preferences keep existing exercise overrides.</p><details open><summary className="cursor-pointer text-sm">Equipment preferences · {b.equipment?.length ? b.equipment.join(', ') : 'Full gym'}</summary><p className="my-2 text-sm text-slate-600">Filters picker suggestions. Your exercises stay in place.</p><div className="flex flex-wrap gap-3">{equipmentOptions.map(e => <label className="flex min-h-11 items-center gap-2 text-sm" key={e}><input type="checkbox" disabled={b.equipment?.length === 1 && b.equipment.includes(e)} checked={!b.equipment?.length || b.equipment.includes(e)} onChange={event => update(d => {
            const available = new Set(d.builder!.equipment?.length ? d.builder!.equipment : equipmentOptions);
            if (event.target.checked) available.add(e);else available.delete(e);
            d.builder!.equipment = [...available];
          })} />{e}</label>)}</div></details>
    <details open><summary className="cursor-pointer text-sm">Edit schedule</summary><div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">{b.weeks.map((w, i) => <label key={w.stageId} className="text-sm">Week {i + 1} reps left<input type="number" min="0" max="10" className={`${control} mt-1 w-full`} value={w.rir ?? ''} onChange={e => update(d => {
            d.builder!.weeks[i].rir = e.target.value || null;
          })} /></label>)}</div><div className="mt-3 flex flex-wrap gap-2">{b.workouts.map((w, i) => <button type="button" key={w.key} disabled={!i} className={control} onClick={() => update(d => {
          const ws = d.builder!.workouts;
          [ws[i - 1], ws[i]] = [ws[i], ws[i - 1]];
          d.occurrences = d.builder!.weeks.flatMap(week => ws.map(w => d.occurrences.find(o => o.stageId === week.stageId && o.workoutKey === w.key)!));
          setWorkoutIndex(i - 1);
        })}>Move {w.name} earlier</button>)}</div></details>
    </div><footer className={styles.sheetFooter}><button type="button" className={styles.primary} onClick={() => setSettings(null)}>Done</button></footer></BuilderSheet>}
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-semibold">Workouts</h2><button type="button" className={control} onClick={() => setWeeksOpen(!weeksOpen)}>{weeksOpen ? 'Hide weeks' : 'View all 5 weeks'}</button></div>
    {weeksOpen && <section aria-label="All five weeks" className="grid gap-2 sm:grid-cols-5">{b.weeks.map((w, i) => <div key={w.stageId} className={`rounded-xl border p-3 ${w.deload ? 'border-teal-300 bg-teal-50' : 'bg-slate-50'}`}><h3 className="font-semibold">Week {i + 1}{w.deload ? ' · Deload' : ''}</h3><p className="text-sm">{w.rir} reps left</p>{w.deload && <p className="text-xs">Half sets, rounded up</p>}{b.workouts.map((workout, index) => {
          const o = doc.occurrences.find(o => o.stageId === w.stageId && o.workoutKey === workout.key)!;
          return <button key={o.id} type="button" className="mt-3 block w-full text-left text-sm" onClick={() => {
            setWorkoutIndex(index);
            setWeekIndex(i);
          }}><span className="font-medium underline">{o.name}</span>{(o.weekOverride || o.overrides || o.positions.some(p => !p.sourceKey)) && <span className="block text-teal-800">Week-only edits</span>}<span className="block text-xs text-slate-600">{o.positions.map(p => `${p.exercise.name}: ${prescriptionSummary(p.targets)}`).join('; ')}</span></button>;
        })}</div>)}</section>}
    <div className={styles.layout}><div role="tablist" aria-label="Workouts" className={styles.tabs}>{b.workouts.map((w, i) => <button type="button" role="tab" aria-selected={i === workoutIndex} key={w.key} onClick={() => setWorkoutIndex(i)} className={`rounded-xl px-2 py-3 text-sm font-medium ${i === workoutIndex ? 'bg-slate-900 text-white' : 'bg-slate-100'}`}>{w.name}</button>)}</div>
    <div><div className={styles.scope}><h2 className="font-semibold">{workout.name} · {rows.reduce((sum, row) => sum + row.sets, 0)} sets</h2><label className="text-sm font-medium">Editing <select aria-label="Edit scope" className={control} value={weekIndex ?? 'all'} onChange={e => setWeekIndex(e.target.value === 'all' ? null : Number(e.target.value))}><option value="all">Workout defaults · all weeks</option>{b.weeks.map((w, i) => <option value={i} key={w.stageId}>Week {i + 1} only</option>)}</select></label><p className="text-xs text-slate-600">{occurrence?.weekOverride ? 'Older independent workout. Restore to inherit shared defaults.' : occurrence ? 'Inherited fields follow workout defaults; only explicitly edited fields stay week-specific.' : 'Changes flow to weeks that inherit these defaults.'}</p>{occurrence && <button type="button" className="text-sm underline" onClick={() => setPending({
        text: `Restore ${occurrence.name} in week ${weekIndex! + 1}? Removes week-only additions, removals, ordering and field edits, and uses current shared defaults.`,
        run: () => onChange(restoreWeek(doc, occurrence.id))
      })}>Restore workout defaults</button>}</div>
    {pending && <ConfirmReplacement text={pending.text} confirm={() => {
      pending.run();
      setPending(null);
    }} cancel={() => setPending(null)} />}
    {notice && <p role="status" className="text-sm text-teal-800">{notice}</p>}
    <div>{rows.map((r, i) => <section key={r.key} aria-label={`Exercise ${i + 1}`} className={styles.card}>
      <p className={styles.muted}>{String(i + 1).padStart(2, '0')} · {occurrence ? (r.position?.sourceKey ? (occurrence.overrides?.fields[r.key]?.length ? 'Week-only fields: ' + occurrence.overrides.fields[r.key].join(', ') : 'Inherited workout prescription') : 'Independent week-only exercise') : 'Workout prescription'} · {r.role ?? 'Exercise'}</p>
      <h3>{r.exercise.name || 'Choose exercise'}</h3><EquipmentResistance exercise={r.exercise} />
      <p>{r.position ? prescriptionSummary(r.position.targets) : r.prescription ? `${r.sets} × ${r.prescription.reps.min}–${r.prescription.reps.max} reps · ${r.prescription.rir === null ? 'weekly RIR' : 'RIR ' + r.prescription.rir}` : 'No prescription'}</p>
      <p className={styles.muted}>{r.prescription ? loadLabel(r.prescription.measurement) : 'Load unspecified'}{r.prescription?.reps.basis === 'perSide' ? ' · reps per side' : ''}</p>
      {r.position && r.position.targets.some(t => JSON.stringify({ ...t, id: '' }) !== JSON.stringify({ ...r.position!.targets[0], id: '' })) && <p className={styles.muted}>Individual sets differ. The load above is Set 1; inspect Individual sets below for each prescription.</p>}
      {r.exercise.kind === 'catalogSnapshot' && b.equipment?.length && r.exercise.equipment.some(e => !b.equipment!.includes(e)) && <p className="text-amber-800">Outside your equipment preferences</p>}
      <div className={styles.tools}>
        <button type="button" disabled={!r.prescription} onClick={e => setEditing({ key: r.key, trigger: e.currentTarget })}>Edit</button>
        <button type="button" onClick={e => setPicker({ key: r.key, trigger: e.currentTarget })}>Replace</button>
        <button type="button" aria-label={`Move ${r.exercise.name} up`} disabled={i === 0} onClick={() => move(r.key, -1)}>↑</button>
        <button type="button" aria-label={`Move ${r.exercise.name} down`} disabled={i === rows.length - 1} onClick={() => move(r.key, 1)}>↓</button>
      </div>
      <EquipmentSetupEditor key={JSON.stringify(r.exercise)} exercise={r.exercise} apply={setup => onChange(setEquipmentSetup(doc, { key: r.key, workoutKey: workout.key, occurrenceId: occurrence?.id }, setup))} />
        <details><summary className="cursor-pointer">Role & inheritance details</summary><label className="block">Role <select className={control} value={r.role ?? 'Accessory'} onChange={e => update(d => {
        if (occurrence) { const o = d.occurrences.find(o => o.id === occurrence.id)!; const p = o.positions.find(p => p.id === r.key)!; markOverride(o, p.id, ['role']); p.role = e.target.value as Row['role']; }
        else d.builder!.workouts[workoutIndex].rows.find(row => row.key === r.key)!.role = e.target.value as Row['role'];
      })}>{roles.map(role => <option key={role}>{role}</option>)}</select></label>
      {occurrence && r.position && <details><summary className="cursor-pointer text-sm">Individual sets</summary><div className="mt-3 space-y-4">{r.position.targets.map((t, j) => <div key={t.id}><p className="text-sm font-medium">Set {j + 1}</p><TargetFields exercise={r.exercise} target={t} change={(fn, name) => update(d => {
                const o = d.occurrences.find(o => o.id === occurrence.id)!,
                  p = o.positions.find(p => p.id === r.key)!;
                fn(p.targets.find(target => target.id === t.id)!);
                if (!o.weekOverride && p.sourceKey) {
                  o.overrides ??= {
                    removed: [],
                    order: false,
                    fields: {}
                  };
                  o.overrides.targets ??= {};
                  o.overrides.targets[t.id] = [...new Set([...(o.overrides.targets[t.id] ?? []), name])];
                }
              })} />{r.position?.sourceKey && occurrence.overrides?.targets?.[t.id]?.map(name => <button key={name} type="button" className="m-1 text-sm underline" onClick={() => update(d => {
                const o = d.occurrences.find(o => o.id === occurrence.id)!;
                o.overrides!.targets![t.id] = o.overrides!.targets![t.id].filter(f => f !== name);
                if (!o.overrides!.targets![t.id].length) delete o.overrides!.targets![t.id];
              })}>Reset set {j + 1} {name}</button>)}</div>)}</div></details>}
      {r.position?.sourceKey && occurrence?.overrides?.fields[r.key] && <div className="flex flex-wrap gap-2 text-xs">{occurrence.overrides.fields[r.key].map(f => <button type="button" className="min-h-11 rounded bg-[#e7efdc] px-2 text-[#273725]" key={f} onClick={() => f === 'sets' ? setCount(r.key, null) : onChange(resetField(doc, occurrence.id, r.key, f))}>Reset {f === 'exercise' ? 'swap, reps & weight' : f} override</button>)}</div>}
      <button type="button" className={control} onClick={() => remove(r.key)}>Remove exercise</button></details>
    </section>)}</div>
    <button type="button" className={`${control} w-full border-dashed py-3`} data-add-exercise disabled={rows.length >= 20} onClick={e => setPicker({ trigger: e.currentTarget,})}>Add exercise</button>
    <p className={styles.note}>Week 5 halves inherited working sets, rounded up. Individually edited fields and sets remain explicit. Starting loads are never automatically increased.</p>
    {editing && (() => { const row = rows.find(r => r.key === editing.key); return row?.prescription ? <PrescriptionSheet key={editing.key} exercise={row.exercise} target={{ ...row.prescription, id: row.key }} sets={row.sets} scope={scope} trigger={editing.trigger} close={() => setEditing(null)} apply={(count, target, fields, confirmed) => applyPrescription(row.key, count, target, fields, confirmed)} /> : null; })()}
    </div></div>
    {picker && <ExercisePicker builder trigger={picker.trigger} fallback={() => editor.current?.querySelector<HTMLButtonElement>('button[data-add-exercise]:not(:disabled)') ?? editor.current?.querySelector<HTMLSelectElement>('select[aria-label="Edit scope"]') ?? null} current={rows.find(r => r.key === picker.key)?.exercise} equipment={b.equipment ?? []} choose={choose} close={() => setPicker(null)} />}
  </fieldset>;
}
