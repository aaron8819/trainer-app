"use client";
import { useEffect, useRef, useState } from 'react';
import { draftDocument, editDraftCommand, type DraftDocument, type DraftCommand } from '@/lib/trainer2-contracts/draft';
import { createHypertrophyPlan, repairBuilderMetadata } from '@/lib/engine/trainer2/plan-builder';
import { readSavedDocument } from '@/lib/engine/trainer2/planning';
import { control } from './DraftEditor';
import { PlanBuilder } from './PlanBuilder';
import { DraftReview } from './DraftReview';
import { draftEdits } from './draft-edits';
import { Progression } from './Progression';
import { progressionLabel, progressionMeaning, type SavedPlanReview, type PlanIssue } from '@/lib/engine/trainer2/plan-review';
import { validateReviewResponse, INVALID_REVIEW_MESSAGE, type SavedPlanResponse } from '@/lib/engine/trainer2/review-response';

import { activationResponse, activatePlanCommand, type ActivatePlanCommand, type InstructionCommand } from '@/lib/trainer2-contracts/activation';
import { Workout } from './Workout';
import { Instructions } from './Instructions';

type WriteCommand = DraftCommand | ActivatePlanCommand | InstructionCommand;
type Props = { accountId: string; ownershipEpoch: number; initialPlanId?: string };
export function DraftWorkbench(props: Props) { return <Workbench key={`${props.accountId}:${props.initialPlanId ?? ''}`} {...props} />; }
type Loaded = SavedPlanResponse;
function Workbench({ accountId, ownershipEpoch, initialPlanId = '' }: Props) {
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
  useEffect(() => () => { ++reviewRequest.current; }, [accountId, initialPlanId]);
  const [editLocation, setEditLocation] = useState<{ occurrenceId?: string; key: number }>({ key: 0 });
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
      setLoaded(validated); setForm(structuredClone(intent)); setPlanId(id); setStale(false); bookmark(id);
      setMessage(validated.state.lifecycle === 'Completed' ? 'Plan complete' : validated.state.lifecycle === 'Active' ? 'Plan active' : 'Saved');
    } catch { if (request !== reviewRequest.current) return; setMessage(accepted === 'activate' ? 'Activation was accepted, but current state could not be loaded. Reload the latest version.' : accepted ? 'Your plan was saved, but could not be reloaded. Reload the latest version.' : 'Could not load this plan. Check your connection and reload.'); }
  }
  async function reload() { if (!planId || uncertain || !beginRequest()) return; try { await refresh(planId); } finally { endRequest(); } }
  useEffect(() => {
    if (mounted.current) return; mounted.current = true;
    if (initialPlanId) {
      const stored = sessionStorage.getItem(`trainer2-activation:${accountId}:${initialPlanId}`);
      const pending = stored && (() => { try { return activatePlanCommand.safeParse(JSON.parse(stored)); } catch { return null; } })();
      if (pending && pending.success) { setLastCommand(pending.data); setUncertain(true); setMessage('Activation could not be confirmed. Check again to recover the original request.'); }
      else void reload();
    } else setForm(createHypertrophyPlan());
    // Bookmark is a mount input. Initial identities are allocated only in the browser.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  async function submit(command: WriteCommand) {
    if (!beginRequest()) return;
    const request = reviewRequest.current;
    const activating = command.commandType === 'ActivatePlan';
    setCurrentPlanConflict(null);
    setLastCommand(command); setMessage(activating ? 'Activating...' : 'Saving...');
    if (activating) {
      try { sessionStorage.setItem(`trainer2-activation:${accountId}:${command.target.planId}`, JSON.stringify(command)); }
      catch { setMessage('Could not retain a safe activation retry. Enable browser storage and try again.'); setLastCommand(null); setStale(false); endRequest(); return; }
    }
    const clearPending = () => { if (activating) sessionStorage.removeItem(`trainer2-activation:${accountId}:${command.target.planId}`); };
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
        setUncertain(false); setConflict(structuredClone(form)); setLastCommand(null);
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
  const active = loaded?.state.lifecycle !== undefined && loaded.state.lifecycle !== 'Draft';
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
    if (!loaded || !reviewCurrent || reviewError || reviewBusy || loaded.activationBlockers.length) return;
    void submit({ ...envelope(), commandType: 'ActivatePlan', target: { planId: loaded.planId }, expected: { planRevisionId: loaded.revisionId }, intent: { reviewed: loaded.activation } });
  }
  function editIssue(issue: PlanIssue) {
    if (issue.location === 'editor') setEditLocation(previous => ({ occurrenceId: issue.occurrenceId, key: previous.key + 1 }));
    requestAnimationFrame(() => { const element = document.getElementById(issue.occurrenceId && !form?.builder ? `edit-${issue.occurrenceId}` : issue.location); element?.scrollIntoView({ block: 'start' }); element?.focus(); });
  }
  return <main className="min-h-screen bg-white text-slate-900"><div className="mx-auto max-w-5xl space-y-5 px-4 py-4 pb-28 sm:px-8 sm:pt-10">
    <header className="space-y-3"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-semibold uppercase tracking-widest text-teal-700">Trainer / Plan builder</p><p className="rounded-full bg-amber-50 px-3 py-1 text-xs text-amber-900">Demo: plans are deleted when the demo stops.</p></div>
      <h1 className="sr-only">Build your training plan</h1>
      {form && <label className="block"><span className="sr-only">Plan name</span><input aria-label="Plan name" className="w-full rounded border border-transparent bg-transparent py-2 text-2xl font-semibold tracking-tight hover:border-slate-200 focus:border-teal-600 sm:text-3xl" disabled={locked} value={form.name} onChange={e => changed({ ...form, name: e.target.value })} /></label>}
      {form?.builder && <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm"><span className="rounded-full bg-teal-50 px-3 py-1 font-medium text-teal-800">Hypertrophy</span><span className="py-1">5 weeks · 4 workouts per week</span><span className="py-1 text-slate-500">4 training weeks + 1 deload week</span></div>}
      <p className="text-sm text-slate-500">Build, save, review and activate your plan, then start your next workout.</p>
    </header>
    {stale && !busy && planId && !uncertain && <button className={control} onClick={() => void reload()}>Reload latest version</button>}
    {currentPlanConflict && <a className="text-teal-800 underline" href={`/trainer2/dev/drafts?planId=${encodeURIComponent(currentPlanConflict)}`}>View active plan</a>}
    {uncertain && <button className={control} disabled={busy || !lastCommand} onClick={() => lastCommand && void submit(lastCommand)}>Check again</button>}
    {conflict && <section className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-4"><p>Your submitted changes are retained below for comparison. Reload, then choose to continue from the latest plan.</p><details><summary>Your submitted plan</summary><DraftReview intent={conflict} /></details><button className={control} disabled={busy || stale} onClick={() => { setConflict(null); setMessage('Saved'); }}>Continue from latest plan</button></section>}
    {needsRepair && <section id="repair" tabIndex={-1} className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-4"><p>This saved plan contains obsolete override labels from an older builder. Remove those labels to continue editing. Exercise prescriptions and saved history stay intact.</p><button className={control} disabled={locked} onClick={() => { changed(repairBuilderMetadata(form!)); }}>Remove obsolete override labels</button></section>}
    {form && !active && <Progression document={form} disabled={locked || needsRepair} onChange={changed} />}
    {form && !active && <div id="editor" tabIndex={-1} className="scroll-mt-4"><PlanBuilder key={editLocation.key} initialOccurrenceId={editLocation.occurrenceId} document={form} disabled={locked || needsRepair} onChange={changed} /></div>}
    {active && loaded && <section aria-label={loaded.state.lifecycle === 'Completed' ? 'Completed plan' : 'Active plan'} className="space-y-4 rounded-xl border border-teal-300 bg-teal-50 p-4"><h2 className="text-xl font-semibold">{loaded.state.lifecycle === 'Completed' ? 'Completed plan' : 'Active plan'}</h2><p>{loaded.state.lifecycle === 'Completed' ? 'This plan is complete. Its saved schedule is preserved.' : 'This is your activated plan and its saved schedule.'}</p><Workout key={`${accountId}:${loaded.planId}`} accountId={accountId} ownershipEpoch={ownershipEpoch} planId={loaded.planId} /><p>{progressionLabel}</p><details><summary>Full plan</summary><DraftReview intent={loaded.intent} /></details></section>}
    {!active && <section className="space-y-3 rounded-xl border border-slate-200 p-4" aria-label="Plan review">
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
      {reviewCurrent && !reviewError && loaded && <><button className="rounded-xl bg-teal-700 px-5 py-3 font-semibold text-white disabled:opacity-40" disabled={reviewBusy || loaded.activationBlockers.length > 0} onClick={activate}>Activate plan</button>{loaded.activationBlockers.length > 0 && <p>Resolve the issues above, then review again.</p>}</>}
    </section>}
    <div className="fixed inset-x-0 bottom-0 z-10 border-t border-slate-200 bg-white/95 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur"><div className="mx-auto flex max-w-5xl items-center justify-between gap-4"><p role="status" className="text-sm text-slate-600">{message}</p><button className="shrink-0 rounded-xl bg-teal-700 px-6 py-3 font-semibold text-white disabled:opacity-40" disabled={locked || !unsaved} onClick={save}>Save plan</button></div></div>
  </div></main>;
}
