"use client";
import { useEffect, useRef, useState } from 'react';
import { draftDocument, editDraftCommand, type DraftDocument, type DraftCommand } from '@/lib/trainer2-contracts/draft';
import { createHypertrophyPlan, repairBuilderMetadata } from '@/lib/engine/trainer2/plan-builder';
import { readSavedDocument } from '@/lib/engine/trainer2/planning';
import { control } from './DraftEditor';
import { PlanBuilder } from './PlanBuilder';
import { DraftReview } from './DraftReview';
import { draftEdits } from './draft-edits';

type Loaded = { planId: string; revisionId: string; revisionNumber: number; intent: DraftDocument; activationBlockers: string[] };
export function DraftWorkbench({ accountId, ownershipEpoch, initialPlanId = '' }: { accountId: string; ownershipEpoch: number; initialPlanId?: string }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [form, setForm] = useState<DraftDocument | null>(null);
  const [planId, setPlanId] = useState(initialPlanId);
  const [message, setMessage] = useState(initialPlanId ? 'Loading plan…' : 'Unsaved changes');
  const [lastCommand, setLastCommand] = useState<DraftCommand | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [stale, setStale] = useState(Boolean(initialPlanId));
  const [uncertain, setUncertain] = useState(false);
  const [conflict, setConflict] = useState<DraftDocument | null>(null);
  const mounted = useRef(false);
  function bookmark(id: string) { const url = new URL(window.location.href); url.searchParams.set('planId', id); window.history.replaceState(null, '', url); }
  function beginRequest() { if (inFlight.current) return false; inFlight.current = true; setBusy(true); setStale(true); return true; }
  function endRequest() { inFlight.current = false; setBusy(false); }
  async function refresh(id: string, accepted = false) {
    try {
      const response = await fetch(`/api/trainer2/drafts/${encodeURIComponent(id)}`, { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw new Error('Read failed');
      const intent = readSavedDocument(result.intent);
      setLoaded({ ...result, intent }); setForm(structuredClone(intent)); setPlanId(id); setStale(false); bookmark(id);
      setMessage('Saved');
    } catch { setMessage(accepted ? 'Your plan was saved, but could not be reloaded. Reload the latest version.' : 'Could not load this plan. Check your connection and reload.'); }
  }
  async function reload() { if (!planId || uncertain || !beginRequest()) return; try { await refresh(planId); } finally { endRequest(); } }
  useEffect(() => {
    if (mounted.current) return; mounted.current = true;
    if (initialPlanId) void reload(); else setForm(createHypertrophyPlan());
    // Bookmark is a mount input. Initial identities are allocated only in the browser.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  async function submit(command: DraftCommand) {
    if (!beginRequest()) return;
    setLastCommand(command); setMessage('Saving…');
    try {
      const response = await fetch(`/api/trainer2/drafts/${command.commandType === 'CreateDraft' ? 'create' : 'edit'}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(command) });
      const result = await response.json();
      if (response.ok && result.outcome?.status === 'Accepted') {
        setUncertain(false); setLastCommand(null);
        setPlanId(result.outcome.result.planId); bookmark(result.outcome.result.planId);
        await refresh(result.outcome.result.planId, true);
      } else if (result.outcome?.code === 'STALE_REVISION') {
        setUncertain(false); setConflict(structuredClone(form)); setLastCommand(null);
        setMessage('This plan changed in another tab. Reload the latest version before saving.');
      } else if (result.outcome?.status === 'Rejected' || result.outcome?.status === 'Conflict') {
        setUncertain(false); setLastCommand(null);
        setMessage(`Save failed (${result.outcome.code}). ${planId ? 'Reload the latest version before editing.' : 'Your plan is still here. Review it before saving again.'}`);
        if (!planId) setStale(false);
      } else { setUncertain(true); setMessage('Your save could not be confirmed. Check again.'); }
    } catch { setUncertain(true); setMessage('Your save could not be confirmed. Check again.'); }
    finally { endRequest(); }
  }
  function envelope() {
    return { schemaVersion: 1 as const, actionId: crypto.randomUUID(), originatingAccountId: accountId,
      deviceId: sessionStorage.getItem('trainer2-device') ?? (() => { const id = crypto.randomUUID(); sessionStorage.setItem('trainer2-device', id); return id; })(), ownershipEpoch, dependsOn: [] };
  }
  function save() {
    if (inFlight.current || stale || conflict || uncertain || !form) return;
    const parsed = draftDocument.safeParse(form);
    if (!parsed.success) { setMessage('Check the plan: use a valid rep range, 1–20 sets, and 0–10 reps left. Complete any optional weight details you entered.'); return; }
    if (!loaded) { void submit({ ...envelope(), commandType: 'CreateDraft', target: { planId: crypto.randomUUID() }, expected: {}, intent: parsed.data }); return; }
    const operations = draftEdits(loaded.intent, parsed.data);
    if (!operations.length) { setMessage('Saved'); return; }
    const command = editDraftCommand.safeParse({ ...envelope(), commandType: 'EditDraft', target: { planId: loaded.planId }, expected: { planRevisionId: loaded.revisionId }, intent: { operations } });
    if (!command.success) { setMessage('Too many changes for one save. Save a smaller group of edits.'); return; }
    void submit(command.data);
  }
  const unsaved = !!form && (!loaded || JSON.stringify(form) !== JSON.stringify(loaded.intent));
  const needsRepair = !!form && JSON.stringify(repairBuilderMetadata(form)) !== JSON.stringify(form);
  const locked = busy || stale || !!conflict || uncertain;
  return <main className="min-h-screen bg-white text-slate-900"><div className="mx-auto max-w-5xl space-y-5 px-4 py-4 pb-28 sm:px-8 sm:py-10">
    <header className="space-y-3"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-semibold uppercase tracking-widest text-teal-700">Trainer / Plan builder</p><p className="rounded-full bg-amber-50 px-3 py-1 text-xs text-amber-900">Demo: plans are deleted when the demo stops.</p></div>
      <h1 className="sr-only">Build your training plan</h1>
      {form && <label className="block"><span className="sr-only">Plan name</span><input aria-label="Plan name" className="w-full rounded border border-transparent bg-transparent py-2 text-2xl font-semibold tracking-tight hover:border-slate-200 focus:border-teal-600 sm:text-3xl" disabled={locked} value={form.name} onChange={e => { if (!inFlight.current) { setForm({ ...form, name: e.target.value }); setMessage('Unsaved changes'); } }} /></label>}
      {form?.builder && <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm"><span className="rounded-full bg-teal-50 px-3 py-1 font-medium text-teal-800">Hypertrophy</span><span className="py-1">5 weeks · 4 workouts per week</span><span className="py-1 text-slate-500">4 training weeks + 1 deload week</span></div>}
      <p className="text-sm text-slate-500">Plan editing only. Starting workouts is coming later.</p>
    </header>
    {stale && !busy && planId && !uncertain && <button className={control} onClick={() => void reload()}>Reload latest version</button>}
    {uncertain && <button className={control} disabled={busy || !lastCommand} onClick={() => lastCommand && void submit(lastCommand)}>Check again</button>}
    {conflict && <section className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-4"><p>Your submitted changes are retained below for comparison. Reload, then choose to continue from the latest plan.</p><details><summary>Your submitted plan</summary><DraftReview intent={conflict} /></details><button className={control} disabled={busy || stale} onClick={() => { setConflict(null); setMessage('Saved'); }}>Continue from latest plan</button></section>}
    {needsRepair && <section className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-4"><p>This saved plan contains obsolete override labels from an older builder. Remove those labels to continue editing. Exercise prescriptions and saved history stay intact.</p><button className={control} disabled={locked} onClick={() => { setForm(repairBuilderMetadata(form!)); setMessage('Unsaved changes'); }}>Remove obsolete override labels</button></section>}
    {form && <PlanBuilder document={form} disabled={locked || needsRepair} onChange={d => { if (!inFlight.current) { setForm(d); setMessage('Unsaved changes'); } }} />}
    {loaded && <details className="rounded-xl border border-slate-200 p-4"><summary className="cursor-pointer font-medium">Review saved plan</summary><div className="mt-4"><DraftReview intent={loaded.intent} /></div></details>}
    <div className="fixed inset-x-0 bottom-0 z-10 border-t border-slate-200 bg-white/95 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur"><div className="mx-auto flex max-w-5xl items-center justify-between gap-4"><p role="status" className="text-sm text-slate-600">{message}</p><button className="shrink-0 rounded-xl bg-teal-700 px-6 py-3 font-semibold text-white disabled:opacity-40" disabled={locked || !unsaved} onClick={save}>Save plan</button></div></div>
  </div></main>;
}
