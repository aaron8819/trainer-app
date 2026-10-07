"use client";
import { useEffect, useRef, useState } from 'react';
import { draftDocument, createDraftCommand, editDraftCommand, type DraftDocument, type DraftCommand } from '@/lib/trainer2-contracts/draft';
import { createHypertrophyPlan, repairBuilderMetadata } from '@/lib/engine/trainer2/plan-builder';
import { readSavedDocument } from '@/lib/engine/trainer2/planning';
import { control } from './DraftEditor';
import styles from './Builder.module.css';
import { PlanBuilder } from './PlanBuilder';
import { DraftReview } from './DraftReview';
import { draftEdits } from './draft-edits';
import { Progression } from './Progression';
import { progressionLabel, progressionMeaning, type SavedPlanReview, type PlanIssue } from '@/lib/engine/trainer2/plan-review';
import { validateReviewResponse, INVALID_REVIEW_MESSAGE, type SavedPlanResponse } from '@/lib/engine/trainer2/review-response';

import { activationResponse, activatePlanCommand, type ActivatePlanCommand, type InstructionCommand } from '@/lib/trainer2-contracts/activation';
import { Workout } from './Workout';
import { Instructions } from './Instructions';
import { useTrainer2Destination } from './Trainer2Shell';

type WriteCommand = DraftCommand | ActivatePlanCommand | InstructionCommand;
type Props = { accountId: string; ownershipEpoch: number; initialPlanId?: string; view?: 'program'; hostedTrial?: boolean };
export function DraftWorkbench(props: Props) { return <Workbench key={`${props.accountId}:${props.initialPlanId ?? ''}`} {...props} />; }
type Loaded = SavedPlanResponse;
function Workbench({ accountId, ownershipEpoch, initialPlanId = '', view, hostedTrial = false }: Props) {
  const recoveryKey = `trainer2-builder:${accountId}:${initialPlanId || 'new'}`;
  const [templateOpen, setTemplateOpen] = useState(!initialPlanId);
  const [recoveryReady, setRecoveryReady] = useState(false);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [form, setForm] = useState<DraftDocument | null>(null);
  const [planId, setPlanId] = useState(initialPlanId);
  const [message, setMessage] = useState(initialPlanId ? 'Loading plan…' : 'Unsaved changes');
  const [lastCommand, setLastCommand] = useState<WriteCommand | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [stale, setStale] = useState(Boolean(initialPlanId));
  const [uncertain, setUncertain] = useState(false);
  const [conflict, setConflict] = useState<DraftDocument | null>(null);
  const mounted = useRef(false);
  const [review, setReview] = useState<SavedPlanReview | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [currentPlanConflict, setCurrentPlanConflict] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState(false);
  const reviewRequest = useRef(0);
  const present = useRef(false);
  useEffect(() => {
    present.current = true;
    // This is a request counter, not a DOM ref; invalidate the latest read on cleanup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => { present.current = false; ++reviewRequest.current; };
  }, [accountId, initialPlanId]);
  const [editLocation, setEditLocation] = useState<{ occurrenceId?: string; key: number }>({ key: 0 });
  function clearDraftRecovery(id: string) {
    try { sessionStorage.removeItem(recoveryKey); sessionStorage.removeItem(`trainer2-builder:${accountId}:${id}`); } catch { /* Accepted server state remains authoritative if browser cache cleanup fails. */ }
  }
  function deviceIdentity() {
    try { const retained = sessionStorage.getItem('trainer2-device'); if (retained) return retained; const id = crypto.randomUUID(); sessionStorage.setItem('trainer2-device', id); return id; }
    catch { return crypto.randomUUID(); } // Draft checkpoint still must succeed before sending a save.
  }
  function bookmark(id: string) { const url = new URL(window.location.href); url.searchParams.set('planId', id); window.history.replaceState(null, '', url); }
  function beginRequest() { if (inFlight.current) return false; ++reviewRequest.current; setReviewBusy(false); inFlight.current = true; setBusy(true); setStale(true); return true; }
  function endRequest() { inFlight.current = false; setBusy(false); }
  async function refresh(id: string, accepted: false | 'save' | 'activate' = false, request = reviewRequest.current) {
    try {
      const response = await fetch(`/api/trainer2/drafts/${encodeURIComponent(id)}`, { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw new Error('Read failed');
      const validated = await validateReviewResponse(result, { accountId, planId: id });
      if (request !== reviewRequest.current) return;
      const intent = readSavedDocument(validated.intent);
      setLoaded(validated); setForm(structuredClone(intent)); setPlanId(id); setStale(false); bookmark(id); if (validated.state.lifecycle !== 'Draft') { clearDraftRecovery(id); }
      setMessage(validated.state.lifecycle === 'Completed' ? 'Plan complete' : validated.state.lifecycle === 'Active' ? 'Plan active' : 'Saved');
    } catch { if (request !== reviewRequest.current) return; setMessage(accepted === 'activate' ? 'Activation was accepted, but current state could not be loaded. Reload the latest version.' : accepted ? 'Your plan was saved, but could not be reloaded. Reload the latest version.' : 'Could not load this plan. Check your connection and reload.'); }
  }
  async function reload() { if (!planId || uncertain || !beginRequest()) return; try { await refresh(planId); } finally { endRequest(); } }
  useEffect(() => {
    if (mounted.current) return; mounted.current = true;
    try {
      const raw = initialPlanId && sessionStorage.getItem(`trainer2-activation:${accountId}:${initialPlanId}`) ? null : sessionStorage.getItem(recoveryKey) ?? sessionStorage.getItem(`trainer2-builder:${accountId}:new`);
      if (raw) {
        const saved = JSON.parse(raw);
        const parsed = draftDocument.safeParse(saved.form);
        const command = saved.command?.commandType === 'CreateDraft' ? createDraftCommand.safeParse(saved.command) : saved.command?.commandType === 'EditDraft' ? editDraftCommand.safeParse(saved.command) : null;
        const bound = (!initialPlanId && !saved.planId) || saved.planId === initialPlanId || (!initialPlanId && command?.success);
        if (saved.schemaVersion === 1 && parsed.success && saved.accountId === accountId && saved.ownershipEpoch === ownershipEpoch && bound) {
          setForm(parsed.data); setTemplateOpen(false); setPlanId(saved.planId || initialPlanId);
          if (command?.success && command.data.originatingAccountId === accountId && command.data.ownershipEpoch === ownershipEpoch && (!initialPlanId || command.data.target.planId === initialPlanId)) {
            setLastCommand(command.data); setUncertain(true); setStale(true); setMessage('Your save could not be confirmed. Check again to recover the original request.');
          } else if (saved.hasSavedHead || saved.planId) {
            setConflict(parsed.data); setStale(true); setMessage('Local draft recovered. Reload the saved plan, then compare your retained edits.');
          } else { setStale(false); setMessage('Local draft recovered · unsaved changes'); }
          setRecoveryReady(true); return;
        }
      }
    } catch { setMessage('Browser recovery could not be read.'); }
    setRecoveryReady(true);
    if (initialPlanId) {
      const stored = sessionStorage.getItem(`trainer2-activation:${accountId}:${initialPlanId}`);
      const pending = stored && (() => { try { return activatePlanCommand.safeParse(JSON.parse(stored)); } catch { return null; } })();
      if (pending && pending.success) { setLastCommand(pending.data); setUncertain(true); setMessage('Activation could not be confirmed. Check again to recover the original request.'); }
      // Arm the read after mount replay; initialization/identity allocation stays once-only.
      else queueMicrotask(() => { if (present.current) void reload(); });
    } else setForm(createHypertrophyPlan());
    // Bookmark is a mount input. Initial identities are allocated only in the browser.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!recoveryReady || !form || uncertain || busy || templateOpen || (loaded && loaded.state.lifecycle !== 'Draft')) return;
    if (loaded && !conflict && !stale && JSON.stringify(form) === JSON.stringify(loaded.intent)) {
      try { sessionStorage.removeItem(recoveryKey); sessionStorage.removeItem(`trainer2-builder:${accountId}:${planId}`); } catch { /* Saved state does not depend on clearing local cache. */ }
      return;
    }
    try { const recovery = JSON.stringify({ schemaVersion: 1, accountId, ownershipEpoch, form: conflict ?? form, planId, hasSavedHead: !!loaded, command: null }); sessionStorage.setItem(planId ? `trainer2-builder:${accountId}:${planId}` : recoveryKey, recovery); }
    catch { setMessage('Browser storage is unavailable. Keep this tab open until your draft is saved.'); }
  }, [recoveryReady, form, conflict, loaded, planId, uncertain, busy, stale, templateOpen, recoveryKey, accountId, ownershipEpoch]);
  async function submit(command: WriteCommand) {
    if (!beginRequest()) return;
    const request = reviewRequest.current;
    const activating = command.commandType === 'ActivatePlan';
    if (command.commandType === 'CreateDraft' || command.commandType === 'EditDraft') {
      try { const recovery = JSON.stringify({ schemaVersion: 1, accountId, ownershipEpoch, form, planId: command.target.planId, hasSavedHead: !!loaded, command }); sessionStorage.setItem(recoveryKey, recovery); sessionStorage.setItem(`trainer2-builder:${accountId}:${command.target.planId}`, recovery); }
      catch { setMessage('Could not retain a safe save retry. Enable browser storage and try again.'); setStale(false); endRequest(); return; }
    }
    setCurrentPlanConflict(null);
    setLastCommand(command); setMessage(activating ? 'Activating...' : 'Saving...');
    if (activating) {
      try { sessionStorage.setItem(`trainer2-activation:${accountId}:${command.target.planId}`, JSON.stringify(command)); }
      catch { setMessage('Could not retain a safe activation retry. Enable browser storage and try again.'); setLastCommand(null); setStale(false); endRequest(); return; }
    }
    const clearPending = () => { if (!activating) clearDraftRecovery(targetPlan); if (activating) sessionStorage.removeItem(`trainer2-activation:${accountId}:${command.target.planId}`); };
    const targetPlan = command.commandType === 'ChangeInstructions' ? loaded!.planId : command.target.planId;
    try {
      const response = await fetch(`/api/trainer2/drafts/${command.commandType === 'CreateDraft' ? 'create' : command.commandType === 'EditDraft' ? 'edit' : activating ? 'activate' : 'instructions'}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(command) });
      const result = await response.json();
      if (request !== reviewRequest.current) return;
      if (activating && result.outcome) {
        const checked = activationResponse.parse(result);
        if (checked.outcome.actionId !== command.actionId) throw new Error('Unbound activation outcome');
      }
      if (activating && result.outcome?.status === 'Accepted' && (result.outcome.actionId !== command.actionId || result.outcome.commandType !== 'ActivatePlan' || result.outcome.result?.planId !== targetPlan || result.outcome.result?.revisionId !== command.expected.planRevisionId || result.outcome.result?.lifecycle !== 'Active')) throw new Error('Invalid activation outcome');
      if (response.ok && result.outcome?.status === 'Accepted') {
        setUncertain(false); setLastCommand(null); clearPending(); setReview(null);
        const acceptedPlan = command.commandType === "ChangeInstructions" ? targetPlan : result.outcome.result.planId;
        setPlanId(acceptedPlan); bookmark(acceptedPlan);
        await refresh(acceptedPlan, activating ? 'activate' : 'save', request);
      } else if (result.outcome?.code === 'STALE_REVISION') {
        setUncertain(false); setConflict(structuredClone(form)); setLastCommand(null); clearPending();
        setMessage('This plan changed in another tab. Reload the latest version before saving.');
      } else if (result.outcome?.status === 'Rejected' || result.outcome?.status === 'Conflict') {
        setUncertain(false); setLastCommand(null);
        clearPending();
        setMessage(`Save failed (${result.outcome.code}). ${planId ? 'Reload the latest version before editing.' : 'Your plan is still here. Review it before saving again.'}`);
        if (activating && result.outcome.currentPlanId) setCurrentPlanConflict(result.outcome.currentPlanId);
        if (activating || command.commandType === 'ChangeInstructions') {
          const reasons: Record<string, string> = { STALE_REVIEW: 'The saved plan or exclusions changed. Reload and review again.', STALE_INSTRUCTIONS: 'Your exclusions changed. Reload and review again.', CURRENT_PLAN_CONFLICT: 'Another plan is active or paused. Concluding that plan is required before activating this one; plan conclusion is not available in this demo.', ALREADY_ACTIVATED: 'This plan is already active. Reload to see its current state.', PLAN_ISSUES: 'Resolve the saved plan issues, then save and review again.', UNRESOLVED_EXCLUSION: 'Resolve the exercise exclusions, then review again.' };
          setMessage(reasons[result.outcome.code] ?? 'This request could not be applied. Reload and review the current plan.');
        }
        if (!planId) setStale(false);
      } else { setUncertain(true); setMessage(activating ? 'Activation could not be confirmed. Check again.' : 'Your save could not be confirmed. Check again.'); }
    } catch { if (request === reviewRequest.current) { setUncertain(true); setMessage(activating ? 'Activation could not be confirmed. Check again.' : 'Your save could not be confirmed. Check again.'); } }
    finally { if (request === reviewRequest.current) endRequest(); }
  }
  function envelope() {
    return { schemaVersion: 1 as const, actionId: crypto.randomUUID(), originatingAccountId: accountId,
      deviceId: deviceIdentity(), ownershipEpoch, dependsOn: [] };
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
  const active = loaded?.state.lifecycle !== undefined && loaded.state.lifecycle !== 'Draft';
  useTrainer2Destination(planId || undefined, loaded ? !active : !initialPlanId || !!form);
  const locked = busy || stale || !!conflict || uncertain || active;
  const reviewCurrent = !!review && review.accountId === accountId && review.planId === loaded?.planId && review.revisionId === loaded?.revisionId && !unsaved && !locked;
  function changed(d: DraftDocument) { if (!inFlight.current) { ++reviewRequest.current; setReviewBusy(false); setForm(d); setMessage('Unsaved changes'); } }
  async function reviewSaved() {
    if (!loaded || unsaved || locked) return;
    const request = ++reviewRequest.current;
    setReviewBusy(true);
    try {
      const response = await fetch(`/api/trainer2/drafts/${encodeURIComponent(loaded.planId)}`, { cache: 'no-store' });
      const result = await response.json();
      if (request !== reviewRequest.current) return;
      if (!response.ok) throw new Error('Review unavailable');
      const validated = await validateReviewResponse(result, { accountId, planId: loaded.planId,
        snapshot: result?.revisionId === loaded.revisionId ? loaded : undefined });
      if (request !== reviewRequest.current) return;
      if (validated.revisionId !== loaded.revisionId) { setStale(true); setMessage('This plan changed in another tab. Reload the latest version before reviewing.'); return; }
      setLoaded(validated); setReview(validated.review); setReviewError(false); setMessage(validated.state.lifecycle === 'Completed' ? 'Plan complete' : validated.state.lifecycle === 'Active' ? 'Plan active' : 'Saved');
    } catch { if (request === reviewRequest.current) { setReviewError(true); setMessage(INVALID_REVIEW_MESSAGE); } }
    finally { if (request === reviewRequest.current) setReviewBusy(false); }
  }
  function activate() {
    if (!loaded || !reviewCurrent || reviewError || reviewBusy || loaded.activationBlockers.length || loaded.currentPlan) return;
    void submit({ ...envelope(), commandType: 'ActivatePlan', target: { planId: loaded.planId }, expected: { planRevisionId: loaded.revisionId }, intent: { reviewed: loaded.activation } });
  }
  function editIssue(issue: PlanIssue) {
    if (issue.location === 'editor') setEditLocation(previous => ({ occurrenceId: issue.occurrenceId, key: previous.key + 1 }));
    requestAnimationFrame(() => { const element = document.getElementById(issue.occurrenceId && !form?.builder ? `edit-${issue.occurrenceId}` : issue.location); element?.scrollIntoView({ block: 'start' }); element?.focus(); });
  }
  if (active && loaded && form && loaded.state.lifecycle !== 'Active' && loaded.state.lifecycle !== 'Completed') return <main className="min-h-screen bg-[#f6f5f1] px-4 py-8 text-slate-900"><div className="mx-auto max-w-4xl space-y-5">
    <h1 className="text-3xl font-semibold">{form.name}</h1><p role="status" className="rounded-2xl bg-[#dce7ca] p-5">Program {loaded.state.lifecycle.toLowerCase()}. Starting workouts and advancing weeks are unavailable in this state. Saved prescriptions remain inspectable. Pause/resume controls are not supported by the released application.</p>
    <DraftReview intent={form} /><a className={control} href="/trainer2/dev/drafts?view=builder">Create a new draft</a>
  </div></main>;
  if (active && loaded && form) return <main className="min-h-screen bg-[#f6f5f1] text-[#171a18]"><div className="mx-auto max-w-[1064px] space-y-5 px-[14px] py-5 min-[350px]:px-5 sm:px-7">
    <p className="text-2xl font-bold tracking-tight">Trainer<span className="ml-1 align-top text-sm font-normal">2</span></p>
    <Workout key={accountId + ':' + loaded.planId} accountId={accountId} ownershipEpoch={ownershipEpoch} planId={loaded.planId} document={form} program={view === 'program'} />
  </div></main>;
  if (initialPlanId && !loaded && !uncertain && !conflict) return <main className="min-h-screen bg-[#f6f5f1] px-5 py-8 text-[#171a18]"><div className="mx-auto max-w-4xl space-y-5">
    <h1 className="text-3xl font-semibold">Your training</h1><p role="status" className="min-h-12 rounded-2xl bg-[#dce7ca] p-5">{message}</p>
    {!busy && <button className={control} onClick={() => void reload()}>Reload latest version</button>}
  </div></main>;
  if (templateOpen && form) return <main className={styles.shell}><div className={styles.content}>
    <header className={styles.header}><p className="text-2xl font-bold">Trainer²</p><h1>Build a plan</h1><p className={styles.muted}>Start with a complete template. Customize what you need.</p></header>
    <section className={styles.template}><p className={styles.muted}>STRENGTH & HYPERTROPHY</p><h2>Five-week hypertrophy</h2><p>Four workouts per week. Four accumulation weeks, then a deload.</p>
      <div className={styles.art} aria-hidden="true">{[60,72,86,100,40].map((height,i) => <span key={i} style={{ height: height + '%', background: i === 4 ? '#83946c' : undefined }} />)}</div>
      <p>Lower A · Upper A · Lower B · Upper B</p><p className={styles.muted}>Weekly RIR 3 / 3 / 2 / 1 / 4. Deload working sets are halved, rounded up. Starting loads are unspecified.</p>
      <button className={styles.primary} onClick={() => setTemplateOpen(false)}>Customize this template</button>
    </section><p className="mt-5 text-sm">Synthetic local workspace. Saving keeps a draft; activation is a separate reviewed command.</p>
  </div></main>;
  return <main className={styles.shell}><div className={`${styles.content} space-y-5`}>
    <header className={`${styles.header} space-y-3`}><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-semibold uppercase tracking-widest text-teal-700">Trainer / Plan builder</p><p className="rounded-full bg-amber-50 px-3 py-1 text-xs text-amber-900">{hostedTrial ? 'Protected synthetic trial: plans are saved in durable database storage.' : 'Demo: plans are deleted when the demo stops.'}</p></div>
      <h1 className="sr-only">Plan builder</h1><p className={styles.muted}>Customize → Save draft → Review → Activate</p>
      {form && <label className="block"><span className="sr-only">Plan name</span><input aria-label="Plan name" className="w-full rounded border border-transparent bg-transparent py-2 text-2xl font-semibold tracking-tight hover:border-slate-200 focus:border-teal-600 sm:text-3xl" disabled={locked} value={form.name} onChange={e => changed({ ...form, name: e.target.value })} /></label>}
      {form?.builder && <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm"><span className="py-1">5 weeks · 4 workouts · lbs</span><span className="py-1 text-slate-500">4 accumulation + 1 deload</span></div>}

    </header>
    {stale && !busy && planId && !uncertain && <button className={control} onClick={() => void reload()}>Reload latest version</button>}
    {currentPlanConflict && <a className="text-teal-800 underline" href={`/trainer2/dev/drafts?planId=${encodeURIComponent(currentPlanConflict)}`}>View active plan</a>}
    {uncertain && <button className={control} disabled={busy || !lastCommand} onClick={() => lastCommand && void submit(lastCommand)}>Check again</button>}
    {conflict && <section className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-4"><p>Your submitted changes are retained below for comparison. Reload, then choose to continue from the latest plan.</p><details><summary>Your submitted plan</summary><DraftReview intent={conflict} /></details><button className={control} disabled={busy || stale || !loaded || loaded.state.lifecycle !== 'Draft'} onClick={() => { setForm(structuredClone(conflict)); setConflict(null); setMessage('Recovered edits · compare and save against the latest revision'); }}>Use retained edits on latest draft</button><button className={control} disabled={busy || stale} onClick={() => { setConflict(null); setMessage('Saved'); }}>Continue from latest plan</button></section>}
    {needsRepair && <section id="repair" tabIndex={-1} className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-4"><p>This saved plan contains obsolete override labels from an older builder. Remove those labels to continue editing. Exercise prescriptions and saved history stay intact.</p><button className={control} disabled={locked} onClick={() => { changed(repairBuilderMetadata(form!)); }}>Remove obsolete override labels</button></section>}
    {form && !active && <div id="editor" tabIndex={-1} className="scroll-mt-4"><PlanBuilder key={editLocation.key} initialOccurrenceId={editLocation.occurrenceId} document={form} disabled={locked || needsRepair} onChange={changed} /></div>}
    {form && !active && <Progression document={form} disabled={locked || needsRepair} onChange={changed} />}
    {!active && <section id="builder-review" className="space-y-3 rounded-2xl border border-[#dbded5] bg-white p-5" aria-label="Plan review">
      <button className={control} disabled={!loaded || unsaved || locked} onClick={() => void reviewSaved()}>{reviewBusy ? 'Reviewing…' : 'Review plan'}</button>
      {unsaved && <p className="text-sm text-slate-600">Save your changes before reviewing.</p>}
      {reviewError && <p role="alert" className="text-sm text-amber-800">{INVALID_REVIEW_MESSAGE}{review ? ' Previous review retained; refresh failed.' : ''}</p>}
      {review && !reviewCurrent && <p className="font-medium text-amber-800">Review outdated. Save any changes, then review the current plan.</p>}
      {review && <div className="space-y-3">
        <h2 className="text-lg font-semibold">{reviewCurrent && !reviewError ? (review.issues.length ? 'Resolve these plan issues' : 'Saved plan checks passed') : 'Previous saved plan review'}</h2>
        <p className="text-sm text-slate-600">Checks cover saved structure, prescriptions, progression intent and your current exercise exclusions.</p>
        {reviewCurrent && review.issues.map((issue, i) => <p key={i}><a className="text-sm text-teal-800 underline" href={`#${issue.location}`} onClick={e => { e.preventDefault(); editIssue(issue); }}>{issue.message}</a></p>)}
        <p className="font-medium">Progression: {review.progression ? progressionLabel : 'Not selected'}</p>
        {review.progression && <p className="text-sm">{progressionMeaning}</p>}
        <details><summary className="cursor-pointer font-medium">Workouts, weekly changes and deload</summary><DraftReview intent={review.intent} /></details>
      </div>}
      {loaded && <Instructions snapshot={loaded.activation.instructions} issues={loaded.activation.binding.restrictionIssues} document={loaded.intent} planId={loaded.planId} revisionId={loaded.revisionId} disabled={locked || unsaved || reviewBusy} onCommand={intent => { setReview(null); void submit({ ...envelope(), commandType: 'ChangeInstructions', target: {}, expected: { instructionEpoch: loaded.activation.instructions.epoch }, intent }); }} />}
      {reviewCurrent && !reviewError && loaded && <><button className={styles.primary} disabled={reviewBusy || loaded.activationBlockers.length > 0 || !!loaded.currentPlan} onClick={activate}>Activate plan</button>{loaded.currentPlan && <p role="note">Another plan is {loaded.currentPlan.lifecycle.toLowerCase()}. It must be concluded before this draft can activate; conclusion is unavailable here. <a className="underline" href={`/trainer2/dev/drafts?planId=${loaded.currentPlan.planId}`}>View current plan</a>. Your draft remains saved.</p>}{loaded.currentPlan === undefined && <p>Activation eligibility for another Active or Paused plan will be checked when submitted.</p>}<p className={styles.muted}>Activation does not start, finish or replace an open workout. The server checks the current plan again at submission.</p>{loaded.activationBlockers.length > 0 && <p>Resolve the issues above, then review again.</p>}</>}
    </section>}
    <div className={styles.bottom}><p role="status">{message}</p><button className={styles.primary} disabled={locked || !unsaved} onClick={save}>Save plan</button><button className="border px-3" onClick={() => { document.getElementById('builder-review')?.scrollIntoView({ block: 'start' }); }}>Review ↓</button></div>
  </div></main>;
}
