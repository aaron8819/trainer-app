"use client";
import { useState } from 'react';
import type { DraftDocument } from '@/lib/trainer2-contracts/draft';
import type { OverrideField } from '@/lib/engine/trainer2/plan-builder';
import { TargetFields } from './DraftEditor';
import { BuilderSheet } from './BuilderSheet';
import { pounds, loadLabel } from './pound-display';
import styles from './Builder.module.css';
type Target = DraftDocument['occurrences'][number]['positions'][number]['targets'][number];
type Exercise = DraftDocument['occurrences'][number]['positions'][number]['exercise'];
export function PrescriptionSheet({ exercise, target, sets, scope, trigger, close, apply }: {
  exercise: Exercise; target: Target; sets: number; scope: string; trigger: HTMLElement; close: () => void;
  apply: (count: number, target: Target, fields: OverrideField[], confirmed?: boolean) => string | null | void;
}) {
  const [draft, setDraft] = useState(() => structuredClone(target));
  const [count, setCount] = useState(String(sets));
  const [fields, setFields] = useState<OverrideField[]>([]);
  const [error, setError] = useState('');
  const [confirmation, setConfirmation] = useState<string | null>(null);
  function change(fn: (t: Target) => void, field: OverrideField) {
    setConfirmation(null);
    setDraft(previous => { const next = structuredClone(previous); fn(next); return next; });
    setFields(previous => [...new Set([...previous, field])]);
  }
  const measurement = draft.measurement;
  const fixed = exercise.kind === 'catalogSnapshot' ? exercise : undefined;
  const load = measurement && measurement.kind !== 'bodyweight' ? pounds(measurement.value, measurement.unit) : '';
  function startingLoad(value: string) {
    change(t => {
      if (!value) { t.measurement = null; return; }
      if (!fixed || fixed.loadKind === 'bodyweight') return;
      if (fixed.loadKind === 'externalLoad') t.measurement = { kind: 'externalLoad', value, unit: 'lb', convention: fixed.convention as 'barbellTotal' | 'perImplement' | 'machineDisplayed' | 'machinePlatesPerArm' | 'smithPlatesTotal', zeroMeaning: fixed.catalogFacts?.externalZeroMeaning ?? (t.measurement?.kind === 'externalLoad' ? t.measurement.zeroMeaning : 'notAllowed') };
      else if (fixed.loadKind === 'addedLoad') t.measurement = { kind: 'addedLoad', value, unit: 'lb', convention: 'addedExternal', zeroMeaning: 'noAddedLoad' };
      else t.measurement = { kind: 'assistance', value, unit: 'lb', convention: 'displayedAssistance', zeroMeaning: 'noAssistance' };
    }, 'measurement');
  }
  function submit() {
    if (!/^\d+$/.test(count) || Number(count) < 1 || Number(count) > 20 || !Number.isInteger(draft.reps.min) || !Number.isInteger(draft.reps.max) || draft.reps.min < 1 || draft.reps.max < draft.reps.min || draft.reps.max > 1000 || (draft.rir !== null && (!/^\d+(\.\d+)?$/.test(draft.rir) || Number(draft.rir) > 10))) {
      setError('Use 1–20 sets, a valid rep range, and RIR from 0–10 or blank.'); return;
    }
    if (measurement && measurement.kind !== 'bodyweight' && (!/^\d+(\.\d+)?$/.test(measurement.value) || (measurement.kind === 'externalLoad' && measurement.zeroMeaning === 'notAllowed' && Number(measurement.value) === 0))) { setError('Enter a valid starting load, or leave it blank. This exercise may require a value above zero.'); return; }
    const warning = apply(Number(count), draft, [...fields, ...(Number(count) !== sets ? ['sets' as const] : [])], Boolean(confirmation));
    if (warning) setConfirmation(warning);
  }
  return <BuilderSheet title="Edit prescription" trigger={trigger} close={close}>
    <div className={styles.sheetBody}>
      <div><h3 className="text-lg font-semibold">{exercise.name}</h3><p className={styles.muted}>{scope}. Only changed fields apply to every set; other individual set details stay.</p></div>
      <label>Sets<input autoFocus className={styles.numeric} inputMode="numeric" type="number" min="1" max="20" value={count} onChange={e => { setCount(e.target.value); setConfirmation(null); }} /></label>
      <div className={styles.fields}>{(['min','max'] as const).map(bound => <label key={bound}>Reps {bound === 'min' ? 'from' : 'to'}<input className={styles.numeric} inputMode="numeric" type="number" min="1" max="1000" value={draft.reps[bound] || ''} onChange={e => change(t => { t.reps[bound] = Number(e.target.value); }, 'reps')} /></label>)}</div>
      <p className={styles.muted}>Count reps {draft.reps.basis === 'perSide' ? 'per side' : draft.reps.basis === 'alternating' ? 'alternating' : 'in total'}.</p>
      <label>RIR · reps left (blank = {scope === 'All weeks' ? 'weekly default' : 'unspecified override'})<input className={styles.numeric} inputMode="decimal" type="number" min="0" max="10" step="any" value={draft.rir ?? ''} onChange={e => change(t => { t.rir = e.target.value || null; }, 'rir')} /></label>
      <div className="flex flex-wrap gap-2">{[0,1,2,3,4,5].map(value => <button type="button" aria-pressed={draft.rir === String(value)} className="min-w-11 border px-3" key={value} onClick={() => change(t => { t.rir = String(value); }, 'rir')}>{value}</button>)}</div>
      {fixed && fixed.loadKind !== 'bodyweight' && <><label>Optional starting {fixed.loadKind === 'assistance' ? 'assistance' : 'load'} · lbs<input className={styles.numeric} inputMode="decimal" type="number" min="0" step="any" value={load} onChange={e => startingLoad(e.target.value)} /></label><p className={styles.muted}>{fixed.loadKind === 'assistance' ? 'Displayed assistance; more lbs = easier. Zero means no assistance.' : fixed.loadKind === 'addedLoad' ? 'Added external load; zero means no added load.' : fixed.convention === 'perImplement' ? 'Lbs per implement (each dumbbell), not the combined pair.' : fixed.convention === 'barbellTotal' ? 'Total barbell weight, including the bar.' : 'The machine’s displayed weight.'} Blank means unspecified. Starting loads are planned targets, never performed results or automatic increases.</p></>}
      {measurement?.kind === 'bodyweight' && <p>Bodyweight only; no numeric starting load.</p>}
      {measurement && measurement.kind !== 'bodyweight' && measurement.unit === 'kg' && <p className={styles.muted}>{loadLabel(measurement, true)}. Original kg value stays exact unless you change the load.</p>}
      <details><summary className="min-h-11 cursor-pointer py-3">Advanced prescription details</summary><TargetFields exercise={exercise} target={draft} change={change} /></details>
      {error && <p role="alert">{error}</p>}
      {confirmation && <div role="alert" className="rounded-xl bg-amber-50 p-4"><p>{confirmation}</p><button type="button" className="mt-2 border px-3" onClick={() => setConfirmation(null)}>Keep editing</button></div>}
    </div>
    <footer className={styles.sheetFooter}><button type="button" onClick={close}>Cancel edits</button><button type="button" className={styles.primary} onClick={submit}>{confirmation ? 'Confirm reduction' : 'Apply changes'}</button></footer>
  </BuilderSheet>;
}
