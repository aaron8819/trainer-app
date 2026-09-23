'use client';
import { skipSetCommand, skipSetResponse, type SkipSetCommand, type SetSkip } from '@/lib/trainer2-contracts/skip-set';
import type { ExecutionRead } from '@/lib/trainer2-contracts/execution';
import { useEffect, useRef, useState } from 'react';
import { compatibleLoggingLoad, startingPounds } from '@/lib/engine/trainer2/logging-prefill';
import { pounds, loadLabel } from './pound-display';
import { z } from 'zod';
import { performedResult, savedSetResult, resultMutationCommand, setResultResponse,
  type PerformedResult, type SavedSetResult, type SetResultCommand } from '@/lib/trainer2-contracts/set-results';
import { canonicalJson } from '@/lib/trainer2-contracts/canonical-json';
import type { DraftDocument } from '@/lib/trainer2-contracts/draft';
import { control as baseControl } from './DraftEditor';
const control = `${baseControl} min-h-11 min-w-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700`;
const fieldControl = 'h-11 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700';
const stepControl = 'h-11 w-11 shrink-0 rounded-full border border-slate-300 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-emerald-700';
const fieldLabel = 'text-xs font-medium uppercase tracking-wide text-slate-500';
const checkedNavigation = new WeakSet<Event>();

const formSchema = z.object({ reps: z.string(), basis: z.enum(['total', 'perSide', 'alternating']),
  load: z.string(), kind: z.enum(['unspecified', 'bodyweight', 'externalLoad', 'addedLoad', 'assistance']),
  unit: z.enum(['', 'kg', 'lb']), zeroMeaning: z.enum(['validZero', 'notAllowed']).optional(), convention: z.enum(['barbellTotal', 'perImplement', 'machineDisplayed']),
  rir: z.string(), reason: z.string() }).strict();
type Form = z.infer<typeof formSchema>;
const draftSchema = z.object({ form: formSchema, base: savedSetResult.nullable(), pending: z.union([resultMutationCommand, skipSetCommand]).nullable(), skipActionId: z.string().uuid().optional(), conflict: z.boolean(), carriedMeasurement: performedResult.shape.measurement.optional() }).strict();
type Draft = z.infer<typeof draftSchema>;
function formFor(r?: PerformedResult | null): Form {
  const m = r?.measurement;
  return { reps: r?.reps?.value.toString() ?? '', basis: r?.reps?.basis ?? 'total',
    load: m && 'value' in m ? pounds(m.value, m.unit) : '', kind: m?.kind ?? 'unspecified',
    unit: 'lb', zeroMeaning: m?.kind === 'externalLoad' ? m.zeroMeaning : 'validZero', convention: m?.kind === 'externalLoad' ? m.convention : 'barbellTotal',
    rir: r?.rir ?? '', reason: '' };
}
function parseForm(f: Form) {
  if (f.reps !== '' && !/^(0|[1-9][0-9]*)$/.test(f.reps)) throw new Error('Use a whole number of reps, including zero.');
  const measurement = f.kind === 'unspecified' || (f.kind !== 'bodyweight' && f.load === '') ? null : f.kind === 'bodyweight' ? { kind: f.kind, convention: 'bodyweightOnly' } :
    { kind: f.kind, value: f.load, unit: f.unit,
      convention: f.kind === 'externalLoad' ? f.convention : f.kind === 'addedLoad' ? 'addedExternal' : 'displayedAssistance',
      zeroMeaning: f.kind === 'externalLoad' ? (f.zeroMeaning ?? 'validZero') : f.kind === 'addedLoad' ? 'noAddedLoad' : 'noAssistance' };
  return performedResult.parse({ reps: f.reps === '' ? null : { value: Number(f.reps), basis: f.basis }, measurement, rir: f.rir || null });
}
export function resultLabel(r: PerformedResult | null, original = false) {
  if (!r) return 'Cleared as erroneous · no current performed result';
  return `${loadLabel(r.measurement, original)} × ${r.reps ? `${r.reps.value}${r.reps.basis === 'perSide' ? ' per side' : r.reps.basis === 'alternating' ? ' alternating' : ''}` : 'reps unspecified'} · ${r.rir === null ? 'RIR unspecified' : `${r.rir} RIR`}`;
}
export function SetResultRow({ accountId, ownershipEpoch, executionId, targetId, number, saved, refresh, readOnly = false, locked = false, onInputState, historical = false, history = [], finishVersion, retainedOnly = false, prescription, exercise, active = true, activePanel = false, onSubmission, preceding, onRecorded, firstSetLoad, skipped, refreshExecution, onReturn }: {
  skipped?: SetSkip; refreshExecution?: () => Promise<ExecutionRead>; onReturn?: () => void;
  active?: boolean; activePanel?: boolean;
  preceding?: SavedSetResult[];
  firstSetLoad?: SavedSetResult;
  onRecorded?: (record: SavedSetResult) => void;
  onSubmission?: () => (results: SavedSetResult[], skips?: SetSkip[]) => void;
  prescription?: DraftDocument['occurrences'][number]['positions'][number]['targets'][number];
  exercise?: DraftDocument['occurrences'][number]['positions'][number]['exercise'];
  accountId: string; ownershipEpoch: number; executionId: string; targetId: string; number: number;
  retainedOnly?: boolean; historical?: boolean; history?: SavedSetResult[]; finishVersion?: number; readOnly?: boolean; locked?: boolean; onInputState?: (targetId: string, blocked: boolean) => void;
  saved?: SavedSetResult; refresh: () => Promise<SavedSetResult[]>;
}) {
  const [reopening, setReopening] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null), [ready, setReady] = useState(false);
  const [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
  const [reviewed, setReviewed] = useState<{ latest: SavedSetResult | null } | null>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const currentDraft = useRef<Draft | null>(null), alive = useRef(false), flight = useRef(false);
  const key = `${historical ? 'trainer2-historical-result' : 'trainer2-result'}:${accountId}:${executionId}:${targetId}`;
  const suggestionKey = key + ':suggestion';
  const binding = (r: { executionId: string; targetId: string }) => r.executionId === executionId && r.targetId === targetId;
  function store(next: Draft | null) {
    try { if (next) sessionStorage.setItem(key, canonicalJson(next)); else sessionStorage.removeItem(key); }
    catch { setMessage('Browser storage is unavailable. Keep this page open; saving is disabled until storage works.'); return false; }
    currentDraft.current = next; setDraft(next); onInputState?.(targetId, !!next); return true;
  }
  useEffect(() => {
    alive.current = true;
    try {
      const raw = sessionStorage.getItem(key);
      if (raw) {
        const restored = draftSchema.parse(JSON.parse(raw));
        if ((restored.base && !binding(restored.base)) || (restored.pending &&
          (!binding(restored.pending.target) || restored.pending.originatingAccountId !== accountId))) throw new Error('Invalid draft');
        if (restored.form.unit !== 'lb') restored.form = { ...restored.form, load: restored.form.unit === 'kg' && restored.form.load !== '' ? pounds(restored.form.load, 'kg') : restored.form.load, unit: 'lb' };
        if (restored.base?.result && !restored.base.result.measurement && !restored.pending && !restored.conflict &&
          saved?.version === restored.base.version && canonicalJson(restored.form) === canonicalJson(formFor(restored.base.result))) {
          restored.form = initialForm();
        }
        currentDraft.current = restored; setDraft(restored);
      }
      // Convenience snapshots are not user drafts; derive suggestions from the current read.
      sessionStorage.removeItem(suggestionKey);
      setReady(true);
    } catch { setMessage('The retained result request could not be read. Keep this page open and recover browser storage before saving.'); }
    const beforeUnload = (e: BeforeUnloadEvent) => { if (currentDraft.current) { e.preventDefault(); e.returnValue = ''; } };
    const click = (e: MouseEvent) => { if (currentDraft.current && !checkedNavigation.has(e) && (e.target as Element)?.closest?.('a[href]')) {
      checkedNavigation.add(e); if (!window.confirm('Leave this workout? Your unsaved result input is retained in this tab.')) { e.preventDefault(); e.stopImmediatePropagation(); } } };
    window.addEventListener('beforeunload', beforeUnload); document.addEventListener('click', click, true);
    return () => { alive.current = false; window.removeEventListener('beforeunload', beforeUnload); document.removeEventListener('click', click, true); };
    // Execution and target identity key this row for its lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { onInputState?.(targetId, !ready || !!draft); }, [ready, draft, targetId, onInputState]);
  function cancel() { if (store(null)) { setMessage(''); setTimeout(() => editButton.current?.focus(), 0); } }
  function initialForm(): Form {
    const f = formFor(saved?.result);
    if (saved?.result?.measurement) return f;
    if (!saved) f.basis = prescription?.reps.basis ?? 'total';
    const m = prescription?.measurement;
    if (m) { f.kind = m.kind; if ('value' in m && number === 1 && !saved) f.load = startingPounds(m) ?? ''; if (m.kind === 'externalLoad') { f.convention = m.convention; f.zeroMeaning = m.zeroMeaning; } }
    else if (exercise?.kind === 'catalogSnapshot') {
      f.kind = exercise.loadKind;
      if (['barbellTotal', 'perImplement', 'machineDisplayed'].includes(exercise.convention)) f.convention = exercise.convention as Form['convention'];
    }
    if (saved) return f;
    f.reps = prescription && prescription.reps.min === prescription.reps.max ? String(prescription.reps.min) : '';
    f.rir = prescription?.rir ?? '';
    if (number === 1 && !m && prescription && exercise && firstSetLoad?.result?.measurement &&
      compatibleLoggingLoad(firstSetLoad.result.measurement, prescription, exercise)) f.load = startingPounds(firstSetLoad.result.measurement) ?? '';
    // Nearest recorded target in this position's saved order, never another exercise or an older compatible fallback.
    const candidate = preceding?.find(r => r.result), value = candidate?.result;
    const prior = value && (!value.reps || value.reps.basis === f.basis) &&
      (!value.measurement || (prescription && exercise && compatibleLoggingLoad(value.measurement, prescription, exercise))) ? candidate : undefined;
    if (prior?.result) {
      const p = formFor(prior.result);
      f.reps = p.reps; f.load = p.load; f.rir = p.rir;
      if (!prior.result.measurement && f.kind === 'bodyweight') f.kind = 'unspecified';
    }
    return f;
  }
  function initialDraft(): Draft {
    const form = initialForm(), prior = preceding?.find(r => r.result)?.result;
    const carriedMeasurement = !saved && prior?.measurement && prescription && exercise &&
      (!prior.reps || prior.reps.basis === form.basis) && compatibleLoggingLoad(prior.measurement, prescription, exercise)
      ? prior.measurement : undefined;
    return { form, ...(skipped ? { skipActionId: skipped.actionId } : {}), base: saved ?? null, pending: null, conflict: false, ...(carriedMeasurement ? { carriedMeasurement } : {}) };
  }
  function begin() { store(initialDraft()); setMessage(''); }
  function change(field: keyof Form, value: string) {
    const d = currentDraft.current ?? initialDraft(); if (d.pending || busy || readOnly || locked || !ready) return;
    store({ ...d, form: { ...d.form, [field]: value } }); setMessage('');
  }
  async function submitSkip(command: SkipSetCommand) {
    if (flight.current || !currentDraft.current || !refreshExecution) return;
    if (!store({ ...currentDraft.current, pending: command })) return;
    flight.current = true; setBusy(true); setMessage('Saving skip…');
    const confirmed = onSubmission?.();
    try {
      const response = await fetch('/api/trainer2/executions/skip-set', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: canonicalJson(command) });
      const { outcome } = skipSetResponse.parse(await response.json());
      if (!alive.current) return;
      if (outcome.actionId !== command.actionId || (outcome.status === 'Accepted' && (!response.ok || !binding(outcome.result)))) throw new Error('Unbound skip');
      if (outcome.status !== 'Accepted') {
        store({ ...currentDraft.current!, pending: null, conflict: true });
        setMessage('Skip was not accepted. Review the latest result. Your input is retained.'); return;
      }
      const value = await refreshExecution();
      if (!alive.current) return;
      if (!value.skips?.some(s => s.targetId === targetId && s.actionId === command.actionId)) throw new Error('Unconfirmed skip');
      if (store(null)) {
        setMessage('Set skipped'); setReopening(false);
        if (value.lifecycle === 'Open' && !value.results.some(r => r.targetId === targetId)) confirmed?.(value.results, value.skips);
      }
    } catch { if (alive.current) setMessage('Skip could not be confirmed. Retry with the original request.'); }
    finally { flight.current = false; if (alive.current) setBusy(false); }
  }
  function skip() {
    if (saved || skipped || flight.current || locked || readOnly || !ready || currentDraft.current?.pending) return;
    if (currentDraft.current && !window.confirm('Skip this set and discard its edited input?')) return;
    if (!currentDraft.current && !store(initialDraft())) return;
    void submitSkip(skipSetCommand.parse({ schemaVersion: 1, actionId: crypto.randomUUID(), deviceId: crypto.randomUUID(),
      originatingAccountId: accountId, ownershipEpoch, dependsOn: [], commandType: 'SkipSet', target: { executionId, targetId },
      expected: { resultVersion: 0, skipActionId: null }, intent: {} }));
  }
  async function submit(command: SetResultCommand | SkipSetCommand) {
    if (command.commandType === 'SkipSet') return submitSkip(command);
    if (flight.current || !currentDraft.current || (readOnly && !currentDraft.current.pending)) return;
    if (!store({ ...currentDraft.current, pending: command })) return;
    flight.current = true; setBusy(true); setMessage('Saving…');
    const confirmed = onSubmission?.();
    try {
      const response = await fetch(command.commandType === 'CorrectHistoricalSetResult' ? '/api/trainer2/executions/corrections' : '/api/trainer2/executions/results', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: canonicalJson(command) });
      const { outcome } = setResultResponse.parse(await response.json());
      if (!alive.current) return;
      if (outcome.actionId !== command.actionId || outcome.commandType !== command.commandType ||
        (outcome.status === 'Accepted' && (!response.ok || !binding(outcome.result) || outcome.result.version !== command.expected.resultVersion + 1 ||
          (command.commandType !== 'RecordSetResult' && outcome.result.performedSetId !== command.expected.performedSetId)))) throw new Error('Unbound outcome');
      if (outcome.status !== 'Accepted') {
        store({ ...currentDraft.current!, pending: null, conflict: true });
        setMessage('Result changed elsewhere. Review the latest value. Your input is retained.'); return;
      }
      // Acceptance can be historical. Only a fresh authoritative read updates the display.
      const results = await refresh();
      if (!alive.current) return;
      const latest = results.find(r => r.targetId === targetId);
      if (!latest || latest.version < outcome.result.version || latest.performedSetId !== outcome.result.performedSetId) throw new Error('Unconfirmed read');
      if (store(null)) {
        sessionStorage.removeItem(suggestionKey); setClearing(false);
        setMessage('Saved');
        if (command.commandType === 'RecordSetResult' && latest.version === 1 && latest.actionId === command.actionId) onRecorded?.(latest);
        if (command.commandType === 'RecordSetResult' && command.intent.result && latest.result && latest.version === outcome.result.version) confirmed?.(results);
      }
    } catch { if (alive.current) setMessage('Save could not be confirmed. Check again with the original request.'); }
    finally { flight.current = false; if (alive.current) setBusy(false); }
  }
  function save(clear = false) {
    const d = currentDraft.current; if (!d || d.pending || d.conflict || busy || readOnly || locked) return;
    if (historical && (!d.base?.result || clear)) return;
    try {
      const envelope = { schemaVersion: 1, actionId: crypto.randomUUID(), deviceId: crypto.randomUUID(), originatingAccountId: accountId,
        ownershipEpoch, dependsOn: [], target: { executionId, targetId } };
      const result = clear ? null : parseForm(d.form);
      if (!d.base && !result?.reps) { setMessage('Enter reps to log a set. Load may be left blank.'); return; }
      if (result && !d.base && d.carriedMeasurement) {
        const original = formFor({ reps: null, measurement: d.carriedMeasurement, rir: null });
        if (['load', 'kind', 'unit', 'convention', 'zeroMeaning'].every(k => d.form[k as keyof Form] === original[k as keyof Form])) result.measurement = d.carriedMeasurement;
      }
      // Preserve the original measurement if only its display changed to pounds.
      if (result && d.base?.result) {
        const original = formFor(d.base.result);
        if (['load', 'kind', 'unit', 'convention', 'zeroMeaning'].every(k => d.form[k as keyof Form] === original[k as keyof Form])) result.measurement = d.base.result.measurement;
        if (canonicalJson(result) === canonicalJson(d.base.result)) { store(null); setMessage('Results are up to date. No values changed.'); return; }
      }
      const command = resultMutationCommand.parse(d.base ? { ...envelope, commandType: historical ? 'CorrectHistoricalSetResult' : 'CorrectSetResult',
        expected: { resultVersion: d.base.version, performedSetId: d.base.performedSetId }, intent: { result, ...(clear ? { reason: d.form.reason } : {}) } } :
        { ...envelope, commandType: 'RecordSetResult', expected: { resultVersion: 0, ...(d.skipActionId ? { skipActionId: d.skipActionId } : {}) }, intent: { result } });
      void submit(command);
    } catch (error) { setMessage(error instanceof z.ZodError ? 'Enter valid actual values (reps 0–1000, nonnegative load, RIR 0–10). Load may be blank.' : String(error)); }
  }
  async function reviewLatest() {
    if (busy) return;
    setBusy(true); setMessage('Checking…');
    try {
      const results = await refresh(); if (!alive.current) return;
      const latest = results.find(r => r.targetId === targetId) ?? null;
      setReviewed({ latest }); setMessage('Review the latest result below. Your original input and expected version are still retained.');
    } catch { if (alive.current) setMessage('Could not refresh the result. Your input is retained.'); }
    finally { if (alive.current) setBusy(false); }
  }
  const compact = (!skipped || !!saved || reopening || !!draft) && !historical && !readOnly && !!prescription && (activePanel || !saved);
  const f = draft?.form ?? (compact ? initialForm() : undefined), disabled = busy || !!draft?.pending || readOnly || locked || !ready;
  function adjust(field: 'reps' | 'load', delta: number) {
    const value = f?.[field] ?? '';
    if ((value === '' && delta < 0) || (value !== '' && !/^\d+(\.\d+)?$/.test(value))) return;
    change(field, String(Math.min(field === 'reps' ? 1000 : 999999999, Math.max(0, Math.round((Number(value || 0) + delta) * 1e6) / 1e6))));
  }
  const input = (field: 'reps' | 'load' | 'rir', label: string) => <label className="grid gap-1 text-sm">{field === 'load' ? 'Weight (lb)' : field === 'reps' ? `Reps${f?.basis === 'perSide' ? ' per side' : f?.basis === 'alternating' ? ' alternating' : ''}` : 'Actual RIR (optional)'}<input autoFocus={historical && field === 'reps'} onFocus={e => e.currentTarget.select()}
    className={control} aria-label={`Set ${number} ${label}`} inputMode={field === 'reps' ? 'numeric' : 'decimal'}
    value={f![field]} onChange={e => change(field, e.target.value)} /></label>;
  // Retain recovery state by identity without rendering inactive forms.
  if (!active || (retainedOnly && !draft)) return null;
  return <div className={activePanel ? "mt-2" : "mt-3 rounded-lg bg-slate-50 p-3"} aria-label={`Set ${number} actual result`}>
    {!activePanel && <p className="text-sm font-medium">{saved ? `Saved v${saved.version}: ${resultLabel(saved.result)}` : 'Not recorded'}</p>}
    {historical && history.length > 0 && <details className="mt-2 text-sm"><summary className="min-h-11 cursor-pointer">Result history</summary><ol className="space-y-2">{[...history].sort((a, b) => a.version - b.version).map(r => <li key={r.version}><p>{r.version === 1 ? 'Original record' : 'Correction'} · v{r.version}{r.version === finishVersion ? ' · Acknowledged at finish' : ''}</p><p>{resultLabel(r.result)}</p><p>{r.recordedAt} · {r.reason ?? 'Recorded result'}</p></li>)}</ol></details>}
    {saved?.reason && <p className="text-xs text-slate-600">Correction: {saved.reason}</p>}
    {!compact && !draft && !readOnly && (!historical || !!saved?.result) && <button ref={editButton} className={control} disabled={!ready || locked} onClick={begin}>{historical ? 'Correct result' : saved ? saved.result ? 'Edit result' : 'Re-record result' : 'Enter actual result'}</button>}
    {skipped && !saved && !compact && <div className="py-3"><p className="mb-2 text-sm">Skipped · no performed result</p><button className={control} disabled={locked || readOnly} onClick={() => setReopening(true)}>Log this set</button></div>}
    {(draft || compact) && f && <fieldset disabled={disabled} className="mt-2 space-y-3">
      <legend className="sr-only">{draft?.pending ? 'Pending confirmation' : 'Set values'}{draft?.base ? ` · editing v${draft.base.version}` : ''}</legend>
      {activePanel ? <>
        <div><p className={fieldLabel}>Reps{!saved && ' (required)'}{f.basis === 'perSide' ? ' per side' : f.basis === 'alternating' ? ' alternating' : ''}</p><div className="mt-1 flex items-center gap-2">
          <button type="button" className={stepControl} aria-label="Decrease reps" onClick={() => adjust('reps', -1)}>−1</button>
          <input className={fieldControl} aria-label={`Set ${number} Actual reps`} aria-required={!saved} inputMode="numeric" value={f.reps} onFocus={e => e.currentTarget.select()} onChange={e => change('reps', e.target.value)} />
          <button type="button" className={stepControl} aria-label="Increase reps" onClick={() => adjust('reps', 1)}>+1</button>
        </div></div>
        {!['unspecified', 'bodyweight'].includes(f.kind) ? <div>
          <p className={fieldLabel}>{f.kind === 'externalLoad' ? f.convention === 'barbellTotal' ? 'Barbell total (lb)' : f.convention === 'perImplement' ? exercise?.kind === 'catalogSnapshot' && exercise.equipment.some(e => /dumbbell/i.test(e)) ? 'Per dumbbell (lb)' : 'Per implement (lb)' : 'Machine weight (lb)' : f.kind === 'addedLoad' ? 'Added load (lb)' : 'Assistance (lb)'}</p><div className="my-1 flex flex-wrap gap-1">{(f.kind === 'externalLoad' && f.convention === 'machineDisplayed' ? [-10, -5, -2.5, 2.5, 5, 10] : [-10, -5, 5, 10]).map(delta => <button type="button" key={delta} className={stepControl} aria-label={(delta < 0 ? 'Decrease' : 'Increase') + ' load by ' + Math.abs(delta) + ' lb'} onClick={() => adjust('load', delta)}>{delta < 0 ? '−' : '+'}{Math.abs(delta)}</button>)}<button className="min-h-11 px-1 text-sm" type="button" onClick={() => change('load', '')}>Clear</button></div>
          <input className={fieldControl} aria-label={`Set ${number} Actual load`} inputMode="decimal" value={f.load} onFocus={e => e.currentTarget.select()} onChange={e => change('load', e.target.value)} />

        </div> : <p className="text-sm">{f.kind === 'bodyweight' ? 'Bodyweight' : 'Load unspecified · choose a load type in Options if needed'}</p>}
        <div><p className={fieldLabel}>RIR (optional)</p><div className="my-1 flex flex-wrap items-center gap-2">{['0', '1', '2', '3', '4', '5'].map(value => <button type="button" key={value} className={stepControl + ' ' + (f.rir === value ? 'border-black bg-black text-white' : 'border-slate-300')} aria-label={value + ' RIR'} aria-pressed={f.rir === value} onClick={() => change('rir', value)}>{value}</button>)}</div><input className={fieldControl} aria-label={'Set ' + number + ' Actual RIR (optional)'} placeholder="Other" inputMode="decimal" value={f.rir} onFocus={e => e.currentTarget.select()} onChange={e => change('rir', e.target.value)} /></div>
      </> : <div className="grid grid-cols-3 gap-2">{!['unspecified', 'bodyweight'].includes(f.kind) && input('load', 'Actual load')}{input('reps', 'Actual reps')}{input('rir', 'Actual RIR (optional)')}</div>}
      <details className="text-sm"><summary className="min-h-11 cursor-pointer py-2">Options · {f.unit || (f.kind === 'bodyweight' || f.kind === 'unspecified' ? '' : 'choose unit · ')} {f.basis === 'perSide' ? 'per side · ' : f.basis === 'alternating' ? 'alternating · ' : ''}{f.kind === 'externalLoad' ? f.convention === 'barbellTotal' ? 'barbell total' : f.convention === 'perImplement' ? 'per implement' : 'machine displayed' : f.kind === 'addedLoad' ? 'added load' : f.kind === 'unspecified' ? 'choose load type' : f.kind}</summary>
        <div className="grid grid-cols-2 gap-2">
          <label>Rep basis<select className={control + ' w-full'} aria-label={`Set ${number} rep basis`} value={f.basis} onChange={e => change('basis', e.target.value)}><option value="total">Total</option><option value="perSide">Per side</option><option value="alternating">Alternating</option></select></label>
          <label>Actual load type<select className={control + ' w-full'} aria-label={`Set ${number} actual load type`} value={f.kind} onChange={e => change('kind', e.target.value)}><option value="unspecified">Unspecified</option><option value="bodyweight">Bodyweight</option><option value="externalLoad">External load</option><option value="addedLoad">Added load</option><option value="assistance">Assistance</option></select></label>
          {f.kind === 'externalLoad' && <label>Load basis<select className={control + ' w-full'} aria-label={`Set ${number} load basis`} value={f.convention} onChange={e => change('convention', e.target.value)}><option value="barbellTotal">Barbell total</option><option value="perImplement">Per implement</option><option value="machineDisplayed">Machine displayed</option></select></label>}
          {f.kind === 'externalLoad' && <label>Zero load<select className={control + ' w-full'} aria-label={`Set ${number} zero load meaning`} value={f.zeroMeaning ?? 'validZero'} onChange={e => change('zeroMeaning', e.target.value)}><option value="validZero">Valid zero</option><option value="notAllowed">Zero not allowed</option></select></label>}
        </div>
        {activePanel && saved?.result && !draft?.conflict && <button className={control + ' mt-2'} onClick={() => { if (!currentDraft.current) begin(); if (clearing) save(true); else setClearing(true); }}>{clearing ? 'Confirm clear erroneous result' : 'Clear erroneous result'}</button>}
      </details>
      {clearing && !historical && <label className="grid gap-1 text-sm">Reason for clearing<input className={control} aria-label={`Set ${number} correction reason`} maxLength={200} value={f.reason} onChange={e => change('reason', e.target.value)} /></label>}

      <div className={activePanel ? 'grid grid-cols-2 gap-2' : 'flex flex-wrap gap-2'}>
      {draft?.conflict ? <><button className={control} onClick={() => void reviewLatest()}>Review latest result</button>{reviewed && <div><p>Latest: {resultLabel(reviewed.latest?.result ?? null)} · v{reviewed.latest?.version ?? 0}</p><button className={control} onClick={() => { store({ ...draft, base: reviewed.latest, conflict: false }); setReviewed(null); setMessage('Input retained. Save only if this is your intended correction.'); }}>Use this version for my correction</button></div>}</> : <button className={activePanel ? 'min-h-11 rounded-full bg-black px-5 py-2 text-sm font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 disabled:opacity-40' : control} disabled={disabled || (!draft?.base && !saved && f.reps === '')} onClick={() => { if (!currentDraft.current) begin(); save(); }}>{busy && draft?.pending ? 'Saving…' : (draft ? draft.base : saved) ? activePanel ? 'Update set' : 'Save correction' : activePanel ? 'Log set' : 'Record set'}</button>}
      {activePanel && (saved ? <button className="min-h-11 rounded-full border border-slate-300 px-3 text-sm font-medium" onClick={onReturn}>Return to active set</button> : !skipped && <button className="min-h-11 rounded-full border border-slate-300 px-3 text-sm font-medium" onClick={skip}>Skip set</button>)}
      </div>
      {!activePanel && !historical && draft?.base?.result && !draft.conflict && <button className={control} onClick={() => { if (clearing) save(true); else setClearing(true); }}>{clearing ? 'Confirm clear erroneous result' : 'Clear erroneous result'}</button>}
      {draft && !activePanel && <button className={control} onClick={cancel}>{historical ? 'Cancel' : 'Discard input'}</button>}
    </fieldset>}
    {readOnly && draft && <p>This workout attempt is closed. Retained input cannot change it.</p>}
    {readOnly && draft && !draft.pending && <button className={control} onClick={() => store(null)}>Discard retained input</button>}
    {draft?.pending && !busy && <button className={control + ' mt-2'} onClick={() => void submit(draft.pending!)}>Retry save</button>}
    {message && !(busy && draft?.pending) && <p className="mt-2 text-sm" role="status" tabIndex={0} aria-live="polite">{message}</p>}
  </div>;
}
