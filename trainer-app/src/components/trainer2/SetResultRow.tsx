'use client';
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { performedResult, savedSetResult, resultMutationCommand, setResultResponse,
  type PerformedResult, type SavedSetResult, type SetResultCommand } from '@/lib/trainer2-contracts/set-results';
import { canonicalJson } from '@/lib/trainer2-contracts/canonical-json';
import { control as baseControl } from './DraftEditor';
const control = `${baseControl} min-h-11 min-w-0`;
const checkedNavigation = new WeakSet<Event>();

const formSchema = z.object({ reps: z.string(), basis: z.enum(['total', 'perSide', 'alternating']),
  load: z.string(), kind: z.enum(['unspecified', 'bodyweight', 'externalLoad', 'addedLoad', 'assistance']),
  unit: z.enum(['kg', 'lb']), convention: z.enum(['barbellTotal', 'perImplement', 'machineDisplayed']),
  rir: z.string(), reason: z.string() }).strict();
type Form = z.infer<typeof formSchema>;
const draftSchema = z.object({ form: formSchema, base: savedSetResult.nullable(), pending: resultMutationCommand.nullable(), conflict: z.boolean() }).strict();
type Draft = z.infer<typeof draftSchema>;
function formFor(r?: PerformedResult | null): Form {
  const m = r?.measurement;
  return { reps: r?.reps?.value.toString() ?? '', basis: r?.reps?.basis ?? 'total',
    load: m && 'value' in m ? m.value : '', kind: m?.kind ?? 'unspecified',
    unit: m && 'unit' in m ? m.unit : 'kg', convention: m?.kind === 'externalLoad' ? m.convention : 'barbellTotal',
    rir: r?.rir ?? '', reason: '' };
}
function parseForm(f: Form) {
  if (f.reps !== '' && !/^(0|[1-9][0-9]*)$/.test(f.reps)) throw new Error('Use a whole number of reps, including zero.');
  const measurement = f.kind === 'unspecified' ? null : f.kind === 'bodyweight' ? { kind: f.kind, convention: 'bodyweightOnly' } :
    { kind: f.kind, value: f.load, unit: f.unit,
      convention: f.kind === 'externalLoad' ? f.convention : f.kind === 'addedLoad' ? 'addedExternal' : 'displayedAssistance',
      zeroMeaning: f.kind === 'externalLoad' ? 'validZero' : f.kind === 'addedLoad' ? 'noAddedLoad' : 'noAssistance' };
  return performedResult.parse({ reps: f.reps === '' ? null : { value: Number(f.reps), basis: f.basis }, measurement, rir: f.rir || null });
}
export function resultLabel(r: PerformedResult | null) {
  if (!r) return 'Cleared as erroneous · no current performed result';
  const m = r.measurement;
  const load = !m ? 'load unspecified' : m.kind === 'bodyweight' ? 'bodyweight' :
    `${m.value} ${m.unit} ${m.kind === 'assistance' ? 'assistance' : m.kind === 'addedLoad' ? 'added' : m.convention === 'perImplement' ? 'per implement' : m.convention === 'barbellTotal' ? 'barbell total' : 'machine displayed'}`;
  return `${r.reps ? `${r.reps.value} reps ${r.reps.basis === 'perSide' ? 'per side' : r.reps.basis}` : 'reps unspecified'} · ${load} · ${r.rir === null ? 'effort unspecified' : `${r.rir} RIR`}`;
}
export function SetResultRow({ accountId, ownershipEpoch, executionId, targetId, number, saved, refresh, readOnly = false, locked = false, onInputState, historical = false, history = [], finishVersion, retainedOnly = false }: {
  accountId: string; ownershipEpoch: number; executionId: string; targetId: string; number: number;
  retainedOnly?: boolean; historical?: boolean; history?: SavedSetResult[]; finishVersion?: number; readOnly?: boolean; locked?: boolean; onInputState?: (targetId: string, blocked: boolean) => void;
  saved?: SavedSetResult; refresh: () => Promise<SavedSetResult[]>;
}) {
  const [draft, setDraft] = useState<Draft | null>(null), [ready, setReady] = useState(false);
  const [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
  const [reviewed, setReviewed] = useState<{ latest: SavedSetResult | null } | null>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const currentDraft = useRef<Draft | null>(null), alive = useRef(false), flight = useRef(false);
  const key = `${historical ? 'trainer2-historical-result' : 'trainer2-result'}:${accountId}:${executionId}:${targetId}`;
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
        currentDraft.current = restored; setDraft(restored);
      }
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
  function begin() { store({ form: formFor(saved?.result), base: saved ?? null, pending: null, conflict: false }); setMessage(''); }
  function change(field: keyof Form, value: string) {
    const d = currentDraft.current; if (!d || d.pending || busy) return;
    store({ ...d, form: { ...d.form, [field]: value } }); setMessage('');
  }
  async function submit(command: SetResultCommand) {
    if (flight.current || !currentDraft.current || (readOnly && !currentDraft.current.pending)) return;
    if (!store({ ...currentDraft.current, pending: command })) return;
    flight.current = true; setBusy(true); setMessage('Saving…');
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
      if (store(null)) setMessage('Saved');
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
      const command = resultMutationCommand.parse(d.base ? { ...envelope, commandType: historical ? 'CorrectHistoricalSetResult' : 'CorrectSetResult',
        expected: { resultVersion: d.base.version, performedSetId: d.base.performedSetId }, intent: { result, reason: historical ? 'Correct recorded result' : d.form.reason } } :
        { ...envelope, commandType: 'RecordSetResult', expected: { resultVersion: 0 }, intent: { result } });
      void submit(command);
    } catch (error) { setMessage(error instanceof z.ZodError ? 'Enter valid actual values (reps 0–1000, nonnegative load, RIR 0–10) and a reason for ongoing corrections. Blank fields stay unspecified.' : String(error)); }
  }
  async function reviewLatest() {
    if (busy) return;
    setBusy(true);
    try {
      const results = await refresh(); if (!alive.current) return;
      const latest = results.find(r => r.targetId === targetId) ?? null;
      setReviewed({ latest }); setMessage('Review the latest result below. Your original input and expected version are still retained.');
    } catch { if (alive.current) setMessage('Could not refresh the result. Your input is retained.'); }
    finally { if (alive.current) setBusy(false); }
  }
  const f = draft?.form, disabled = busy || !!draft?.pending || readOnly || locked;
  const input = (field: 'reps' | 'load' | 'rir', label: string) => <label className="grid gap-1 text-sm">{label}<input autoFocus={historical && field === 'reps'}
    className={control} aria-label={`Set ${number} ${label}`} inputMode={field === 'reps' ? 'numeric' : 'decimal'}
    value={f![field]} onChange={e => change(field, e.target.value)} /></label>;
  if (retainedOnly && !draft) return null;
  return <div className="mt-3 rounded-lg bg-slate-50 p-3" aria-label={`Set ${number} actual result`}>
    <p className="text-sm font-medium">{saved ? `Saved v${saved.version}: ${resultLabel(saved.result)}` : 'Not recorded'}</p>
    {historical && history.length > 0 && <details className="mt-2 text-sm"><summary className="min-h-11 cursor-pointer">Result history</summary><ol className="space-y-2">{[...history].sort((a, b) => a.version - b.version).map(r => <li key={r.version}><p>{r.version === 1 ? 'Original record' : 'Correction'} · v{r.version}{r.version === finishVersion ? ' · Acknowledged at finish' : ''}</p><p>{resultLabel(r.result)}</p><p>{r.recordedAt} · {r.reason ?? 'Recorded result'}</p></li>)}</ol></details>}
    {saved?.reason && <p className="text-xs text-slate-600">Correction: {saved.reason}</p>}
    {!draft && !readOnly && (!historical || !!saved?.result) && <button ref={editButton} className={control} disabled={!ready || locked} onClick={begin}>{historical ? 'Correct result' : saved ? saved.result ? 'Edit result' : 'Re-record result' : 'Enter actual result'}</button>}
    {draft && f && <fieldset disabled={disabled} className="mt-2 space-y-3">
      <legend className="text-sm font-semibold">{draft.pending ? 'Pending confirmation' : 'Unsaved input'}{draft.base ? ` · editing v${draft.base.version}` : ''}</legend>
      <div className="grid grid-cols-2 gap-3">{input('reps', 'Actual reps')}<label className="grid gap-1 text-sm">Rep basis<select className={control} aria-label={`Set ${number} rep basis`} value={f.basis} onChange={e => change('basis', e.target.value)}><option value="total">Total</option><option value="perSide">Per side</option><option value="alternating">Alternating</option></select></label></div>
      <label className="grid gap-1 text-sm">Actual load type<select className={control} aria-label={`Set ${number} actual load type`} value={f.kind} onChange={e => change('kind', e.target.value)}><option value="unspecified">Unspecified</option><option value="bodyweight">Bodyweight</option><option value="externalLoad">External load</option><option value="addedLoad">Added load</option><option value="assistance">Assistance</option></select></label>
      {!['unspecified', 'bodyweight'].includes(f.kind) && <div className="grid grid-cols-2 gap-3">{input('load', 'Actual load')}<label className="grid gap-1 text-sm">Unit<select className={control} aria-label={`Set ${number} load unit`} value={f.unit} onChange={e => change('unit', e.target.value)}><option>kg</option><option>lb</option></select></label></div>}
      {f.kind === 'externalLoad' && <label className="grid gap-1 text-sm">Load basis<select className={control} aria-label={`Set ${number} load basis`} value={f.convention} onChange={e => change('convention', e.target.value)}><option value="barbellTotal">Barbell total</option><option value="perImplement">Per implement</option><option value="machineDisplayed">Machine displayed</option></select></label>}
      {input('rir', 'Actual RIR (optional)')}
      {draft.base && !historical && <label className="grid gap-1 text-sm">Correction reason<input className={control} aria-label={`Set ${number} correction reason`} maxLength={200} value={f.reason} onChange={e => change('reason', e.target.value)} /></label>}
      <p className="text-xs text-slate-600">Blank values are unspecified. Per side records the stated count per side; separate left/right counts and duration are not supported.</p>
      {draft.conflict ? <><button className={control} onClick={() => void reviewLatest()}>Review latest result</button>{reviewed && <div><p>Latest: {resultLabel(reviewed.latest?.result ?? null)} · v{reviewed.latest?.version ?? 0}</p><button className={control} onClick={() => { store({ ...draft, base: reviewed.latest, conflict: false }); setReviewed(null); setMessage('Input retained. Save only if this is your intended correction.'); }}>Use this version for my correction</button></div>}</> : <button className={control} onClick={() => save()}>{draft.base ? 'Save correction' : 'Record set'}</button>}
      {!historical && draft.base?.result && !draft.conflict && <button className={control} onClick={() => save(true)}>Clear erroneous result</button>}
      <button className={control} onClick={cancel}>{historical ? 'Cancel' : 'Discard input'}</button>
    </fieldset>}
    {readOnly && draft && <p>Workout finished. Retained input cannot change this completed workout.</p>}
    {readOnly && draft && !draft.pending && <button className={control} onClick={() => store(null)}>Discard retained input</button>}
    {draft?.pending && <button className={control} disabled={busy} onClick={() => void submit(draft.pending!)}>Check again</button>}
    {message && <p role="status" className="mt-2 text-sm">{message}</p>}
  </div>;
}
