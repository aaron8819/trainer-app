import { reviewActivation } from '@/lib/api/trainer2/instructions';
import { emptyInstructions } from '@/lib/trainer2-contracts/activation';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHypertrophyPlan } from '@/lib/engine/trainer2/plan-builder';
import { DraftWorkbench } from './DraftWorkbench';
import { reviewPlan, REVIEW_POLICY } from '@/lib/engine/trainer2/plan-review';
import { canonicalJson, integrityHash } from '@/lib/api/trainer2/integrity';
import { webcrypto } from 'node:crypto';
beforeEach(() => vi.stubGlobal('crypto', webcrypto));
const plan = createHypertrophyPlan();
const rawState = (name = plan.name, revisionNumber = 1) => ({ planId: '00000000-0000-4000-8000-000000000001', revisionId: `00000000-0000-4000-8000-00000000000${revisionNumber + 1}`, revisionNumber, intent: { ...plan, name }, activationBlockers: [] });
const json = (body: unknown, ok = true) => ({ ok, json: async () => body });
const acceptance = () => json({ outcome: { status: 'Accepted', result: { planId: state().planId } } });
const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
const mount = () => { const result = render(<DraftWorkbench accountId="account-a" ownershipEpoch={0} />); const customize = screen.queryByRole('button', { name: 'Customize this template' }); if (customize) fireEvent.click(customize); return result; };
const saved = () => waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/^Saved$/));
const reviewed = (name = plan.name, revisionNumber = 1) => {
  const s = rawState(name, revisionNumber);
  const issues = reviewPlan(s.intent);
  const contentHash = integrityHash(canonicalJson(s.intent));
  const binding = { accountId: 'account-a', planId: s.planId, revisionId: s.revisionId, contentHash,
    progression: s.intent.progression ?? null, progressionHash: integrityHash(canonicalJson(s.intent.progression ?? null)), policyVersion: REVIEW_POLICY };
  const result = { ...s, contentHash, activationBlockers: issues.map(i => i.code),
    review: { ...binding, intent: s.intent, issues, status: issues.length ? 'issues' : 'validDraft', digest: integrityHash(canonicalJson(binding)) } };
  const instructions = { epoch: 0, revisionId: null, document: emptyInstructions(), contentHash: integrityHash(canonicalJson(emptyInstructions())) };
  return { ...result, state: { lifecycle: "Draft" as const, initialApprovedRevisionId: null as string | null }, activation: reviewActivation(result.review as import("@/lib/engine/trainer2/plan-review").SavedPlanReview, instructions) };
};
const state = reviewed;
afterEach(() => { cleanup(); sessionStorage.clear(); vi.unstubAllGlobals(); window.history.replaceState(null, '', '/'); });
describe('builder save recovery', () => {
  it('recovers an unsaved template draft after a remount', async () => {
    const view = mount();
    fireEvent.change(screen.getByLabelText('Plan name'), { target: { value: 'Retained local draft' } });
    view.unmount();
    mount();
    expect(screen.getByLabelText('Plan name')).toHaveValue('Retained local draft');
    expect(screen.getByRole('status')).toHaveTextContent('Local draft recovered');
  });
  it('keeps draft inputs and sends no save when its retry checkpoint cannot be stored', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher); mount();
    const storage = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('storage unavailable'); });
    click('Save plan');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Could not retain a safe save retry'));
    expect(screen.getByLabelText('Plan name')).toBeEnabled(); expect(fetcher).not.toHaveBeenCalled();
    storage.mockRestore();
  });
  it('recovers the identical pending save after reload before its outcome is known', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('lost response'));
    vi.stubGlobal('fetch', fetcher);
    const view = mount(); click('Save plan');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('could not be confirmed'));
    const original = fetcher.mock.calls[0][1].body;
    const target = JSON.parse(original).target.planId;
    view.unmount();
    render(<DraftWorkbench accountId="account-a" ownershipEpoch={0} initialPlanId={target} />);
    expect(screen.getByRole('status')).toHaveTextContent('recover the original request');
    click('Check again');
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    expect(fetcher.mock.calls[1][1].body).toBe(original);
  });
  it('shows the existing current-plan admission conflict before activation', async () => {
    const current = { planId: '00000000-0000-4000-8000-000000000099', lifecycle: 'Active' };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(acceptance()).mockResolvedValue(json({ ...state(), currentPlan: current })));
    mount(); click('Save plan'); await saved(); click('Review plan');
    await screen.findByRole('heading', { name: 'Saved plan checks passed' });
    expect(screen.getByRole('button', { name: 'Activate plan' })).toBeDisabled();
    expect(screen.getByRole('note')).toHaveTextContent('Another plan is active');
    expect(screen.getByRole('link', { name: 'View current plan' })).toHaveAttribute('href', `/trainer2/dev/drafts?planId=${current.planId}`);
  });
  it('shows current completed lifecycle when reopening an activated plan', async () => {
    const s = state();
    const fetcher = vi.fn().mockResolvedValueOnce(json({ ...s, state: { lifecycle: 'Completed', initialApprovedRevisionId: s.revisionId } }))
      .mockResolvedValue(json({ acceptedSequence: '3', occurrences: s.intent.occurrences.map(o => ({ occurrenceId: o.id, name: o.name, stageName: 'Week 1', status: 'Finished', skip: null })), accountId: 'account-a', planId: s.planId, revisionId: s.revisionId, instructionEpoch: 0, lifecycle: 'Completed', occurrence: null, execution: null }));
    vi.stubGlobal('fetch', fetcher);
    render(<DraftWorkbench accountId="account-a" ownershipEpoch={0} initialPlanId={s.planId} />);
    await screen.findByText('Program complete');
    expect(screen.queryByRole('heading', { name: 'Active plan' })).toBeNull();
    await screen.findByText('Program complete. Saved workouts remain available for review.');
    expect(screen.queryByRole('button', { name: 'Activate plan' })).toBeNull();
  });
  it.each(['non-OK', 'network'])('retains accepted bookmark after %s refresh failure; retries only GET', async failure => {
    const fetcher = vi.fn().mockResolvedValueOnce(acceptance());
    if (failure === 'non-OK') fetcher.mockResolvedValueOnce(json({}, false)); else fetcher.mockRejectedValueOnce(new Error('offline'));
    fetcher.mockResolvedValueOnce(json(state())); vi.stubGlobal('fetch', fetcher); mount(); click('Save plan');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('was saved, but could not be reloaded'));
    expect(new URL(window.location.href).searchParams.get('planId')).toBe(state().planId);
    expect(screen.getByLabelText('Plan name')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Check again' })).toBeNull();
    click('Reload latest version'); await saved();
    expect(fetcher.mock.calls.map(c => c[1]?.method ?? 'GET')).toEqual(['POST', 'GET', 'GET']);
  });
  it.each(['lost response', 'server error'])('freezes new mutations for %s and retries the byte-identical envelope', async failure => {
    const fetcher = vi.fn();
    if (failure === 'lost response') fetcher.mockRejectedValueOnce(new Error('lost')); else fetcher.mockResolvedValueOnce(json({ error: 'failed' }, false));
    fetcher.mockResolvedValueOnce(acceptance()).mockResolvedValueOnce(json(state('Newer server head', 3)));
    vi.stubGlobal('fetch', fetcher); mount(); click('Save plan');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('could not be confirmed'));
    expect(screen.getByRole('button', { name: 'Save plan' })).toBeDisabled(); expect(screen.getByLabelText('Plan name')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Reload latest version' })).toBeNull();
    click('Check again'); await saved();
    expect(fetcher.mock.calls[0][1].body).toBe(fetcher.mock.calls[1][1].body);
    expect(screen.getByLabelText('Plan name')).toHaveValue('Newer server head');
  });
  it('locks inputs and synchronous overlapping requests throughout POST and GET', async () => {
    let deliver!: (v: unknown) => void;
    const fetcher = vi.fn().mockImplementation(() => new Promise(resolve => { deliver = resolve; }));
    vi.stubGlobal('fetch', fetcher); mount(); click('Save plan'); click('Save plan');
    expect(fetcher).toHaveBeenCalledTimes(1); expect(screen.getByLabelText('Plan name')).toBeDisabled();
    await act(async () => deliver(acceptance()));
    expect(fetcher).toHaveBeenCalledTimes(2); expect(screen.getByLabelText('Plan name')).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Plan name'), { target: { value: 'Must not apply' } });
    expect(screen.getByLabelText('Plan name')).toHaveValue(plan.name);
    await act(async () => deliver(json(state()))); await saved();
  });
  it('retains conflicting input and requires reload plus deliberate continuation', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(acceptance()).mockResolvedValueOnce(json(state()))
      .mockResolvedValueOnce(json({ outcome: { status: 'Conflict', code: 'STALE_REVISION' } })).mockResolvedValueOnce(json(state('Other tab', 2)));
    vi.stubGlobal('fetch', fetcher); mount(); click('Save plan'); await saved();
    fireEvent.change(screen.getByLabelText('Plan name'), { target: { value: 'My losing edit' } }); click('Save plan');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('changed in another tab'));
    expect(screen.getByLabelText('Plan name')).toHaveValue('My losing edit');
    click('Reload latest version'); await saved();
    expect(screen.getByLabelText('Plan name')).toBeDisabled();
    fireEvent.click(screen.getByText('Your submitted plan'));
    expect(screen.getByRole('heading', { name: 'My losing edit' })).toBeVisible();
    click('Continue from latest plan'); expect(screen.getByLabelText('Plan name')).toBeEnabled();
    expect(screen.getByLabelText('Plan name')).toHaveValue('Other tab');
  });
});
describe('saved revision review', () => {
  it('rechecks request generation after asynchronous binding validation and preserves pending input', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(acceptance()).mockResolvedValue(json(reviewed())));
    mount(); click('Save plan'); await saved();
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const entered = new Promise<void>(resolve => { started = resolve; });
    vi.stubGlobal('crypto', { subtle: { digest: async (...args: Parameters<typeof webcrypto.subtle.digest>) => {
      started(); await gate; return webcrypto.subtle.digest(...args);
    } } });
    click('Review plan'); await entered;
    fireEvent.change(screen.getByLabelText('Plan name'), { target: { value: 'Pending input survives' } });
    await act(async () => { release(); });
    expect(screen.queryByRole('heading', { name: 'Saved plan checks passed' })).toBeNull();
    expect(screen.getByLabelText('Plan name')).toHaveValue('Pending input survives');
    expect(screen.getByRole('button', { name: 'Review plan' })).toBeDisabled();
  });
  it('rejects malformed refreshes, retains the prior valid review with accurate status, and permits a valid retry', async () => {
    const bad = reviewed(); delete (bad.review as Record<string, unknown>).accountId;
    const fetcher = vi.fn().mockResolvedValueOnce(acceptance()).mockResolvedValueOnce(json(reviewed()))
      .mockResolvedValueOnce(json(reviewed())).mockResolvedValueOnce(json(bad)).mockResolvedValueOnce(json(reviewed()));
    vi.stubGlobal('fetch', fetcher); mount(); click('Save plan'); await saved(); click('Review plan');
    await screen.findByRole('heading', { name: 'Saved plan checks passed' });
    click('Review plan'); await screen.findByRole('alert');
    expect(screen.getByRole('alert')).toHaveTextContent('Previous review retained; refresh failed.');
    expect(screen.queryByRole('heading', { name: 'Saved plan checks passed' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Previous saved plan review' })).toBeVisible();
    expect(screen.getByLabelText('Plan name')).toHaveValue(plan.name);
    click('Review plan'); await screen.findByRole('heading', { name: 'Saved plan checks passed' });
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('ignores an older malformed response after a newer valid review', async () => {
    let deliver!: (v: unknown) => void;
    const fetcher = vi.fn().mockResolvedValueOnce(acceptance()).mockResolvedValueOnce(json(reviewed()))
      .mockImplementationOnce(() => new Promise(resolve => { deliver = resolve; })).mockResolvedValueOnce(json(reviewed()));
    vi.stubGlobal('fetch', fetcher); mount(); click('Save plan'); await saved(); click('Review plan'); click('Reviewing…');
    await screen.findByRole('heading', { name: 'Saved plan checks passed' });
    await act(async () => deliver(json({ review: {} })));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Saved plan checks passed' })).toBeVisible();
  });
  it('requires confirmed save, invalidates on edit and rejects delayed review after a new saved revision', async () => {
    let deliver!: (v: unknown) => void;
    const fetcher = vi.fn().mockResolvedValueOnce(acceptance()).mockResolvedValueOnce(json(reviewed()))
      .mockResolvedValueOnce(json(reviewed())).mockImplementationOnce(() => new Promise(resolve => { deliver = resolve; }))
      .mockResolvedValueOnce(acceptance()).mockResolvedValueOnce(json(reviewed('Changed', 2)))
      .mockResolvedValueOnce(json(reviewed('Changed', 2)));
    vi.stubGlobal('fetch', fetcher); mount();
    expect(screen.getByRole('button', { name: 'Review plan' })).toBeDisabled();
    click('Save plan'); await saved(); click('Review plan');
    await screen.findByRole('heading', { name: 'Saved plan checks passed' });
    click('Review plan');
    fireEvent.change(screen.getByLabelText('Plan name'), { target: { value: 'Changed' } });
    expect(screen.getByText(/Review outdated/)).toBeVisible();
    click('Save plan'); await saved(); click('Review plan');
    await screen.findByRole('heading', { name: 'Saved plan checks passed' });
    await act(async () => deliver(json(reviewed())));
    expect(screen.queryByText(/Review outdated/)).toBeNull();
    expect(screen.getByLabelText('Plan name')).toHaveValue('Changed');
  });
  it('a changed remote head requires reload, and a late older review cannot replace a newer response', async () => {
    let deliver!: (v: unknown) => void;
    const fetcher = vi.fn().mockResolvedValueOnce(acceptance()).mockResolvedValueOnce(json(reviewed()))
      .mockImplementationOnce(() => new Promise(resolve => { deliver = resolve; }))
      .mockResolvedValueOnce(json(reviewed())).mockResolvedValueOnce(json(reviewed('Remote', 2)));
    vi.stubGlobal('fetch', fetcher); mount(); click('Save plan'); await saved(); click('Review plan'); click('Reviewing…');
    await screen.findByRole('heading', { name: 'Saved plan checks passed' });
    await act(async () => deliver(json(reviewed('Stale remote response', 3))));
    expect(screen.getByRole('status')).toHaveTextContent(/^Saved$/);
    click('Review plan');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('changed in another tab'));
    expect(screen.queryByRole('heading', { name: 'Saved plan checks passed' })).toBeNull();
  });
});

describe('exact reviewed activation', () => {
  const activeState = () => { const s = state(); return { ...s, state: { lifecycle: 'Active', initialApprovedRevisionId: s.revisionId } }; };
  const acceptedActivation = (body: string) => {
    const c = JSON.parse(body);
    return { replayed: false, outcomeCursor: '2', outcome: { status: 'Accepted', actionId: c.actionId, commandType: 'ActivatePlan', acceptedSequence: '2', result: { planId: c.target.planId, revisionId: c.expected.planRevisionId, decisionId: crypto.randomUUID(), lifecycle: 'Active' } } };
  };
  it('retains the complete envelope for uncertain and malformed outcomes; reads current active state after replay', async () => {
    const bodies: string[] = []; let posts = 0;
    const fetcher = vi.fn().mockResolvedValueOnce(acceptance()).mockResolvedValueOnce(json(state())).mockResolvedValueOnce(json(state()))
      .mockImplementation(async (_url: string, init?: RequestInit) => {
        if (_url.endsWith('/next')) return json({ acceptedSequence: '2', lifecycle: 'Active', occurrences: state().intent.occurrences.map(o => ({ occurrenceId: o.id, name: o.name, stageName: 'Week 1', status: 'Pending', skip: null })), accountId: 'account-a', planId: state().planId, revisionId: state().revisionId, instructionEpoch: 0, occurrence: state().intent.occurrences[0], execution: null });
        if (init?.method !== 'POST') return json(activeState());
        bodies.push(String(init.body)); posts++;
        if (posts === 1) return json({ outcome: { status: 'Accepted', result: { planId: state().planId } } });
        return json({ ...acceptedActivation(String(init.body)), replayed: true });
      });
    vi.stubGlobal('fetch', fetcher); mount(); click('Save plan'); await saved(); click('Review plan');
    await screen.findByRole('heading', { name: 'Saved plan checks passed' }); click('Activate plan');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Activation could not be confirmed'));
    expect(screen.getByRole('button', { name: 'Save plan' })).toBeDisabled();
    click('Check again'); await screen.findByRole('link', { name: 'View Program' });
    expect(bodies[0]).toBe(bodies[1]); expect(screen.queryByRole('button', { name: 'Save plan' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Activate plan' })).toBeNull();
    expect(sessionStorage.getItem(`trainer2-activation:account-a:${state().planId}`)).toBeNull();
  }, 20000);
  it('does not apply a delayed activation success or change the bookmark after switching plans', async () => {
    let deliver!: (v: unknown) => void; let submitted = '';
    const next = state('Other bookmarked plan'); next.planId = next.review.planId = '00000000-0000-4000-8000-000000000009';
    const { accountId, planId, revisionId, contentHash, progression, progressionHash, policyVersion } = next.review;
    next.review.digest = integrityHash(canonicalJson({ accountId, planId, revisionId, contentHash, progression, progressionHash, policyVersion }));
    next.activation = reviewActivation(next.review as import('@/lib/engine/trainer2/plan-review').SavedPlanReview, next.activation.instructions);
    const fetcher = vi.fn().mockResolvedValueOnce(acceptance()).mockResolvedValueOnce(json(state())).mockResolvedValueOnce(json(state()))
      .mockImplementationOnce((_url: string, init: RequestInit) => { submitted = String(init.body); return new Promise(resolve => { deliver = resolve; }); })
      .mockResolvedValueOnce(json(next));
    vi.stubGlobal('fetch', fetcher); const view = mount(); click('Save plan'); await saved(); click('Review plan');
    await screen.findByRole('heading', { name: 'Saved plan checks passed' }); click('Activate plan');
    view.rerender(<DraftWorkbench accountId="account-a" ownershipEpoch={0} initialPlanId={next.planId} />); await saved();
    await act(async () => deliver(json(acceptedActivation(submitted))));
    expect(screen.getByLabelText('Plan name')).toHaveValue('Other bookmarked plan');
    expect(new URL(window.location.href).searchParams.get('planId')).toBe(next.planId);
    expect(screen.queryByRole('heading', { name: 'Active plan' })).toBeNull();
    expect(sessionStorage.getItem(`trainer2-activation:account-a:${state().planId}`)).toBe(submitted);
  }, 20000);
});

it('shows saved paused state without requesting an unsupported ReadNext or displaying activation', async () => {
  const s=state();vi.stubGlobal('fetch',vi.fn().mockResolvedValue(json({...s,state:{lifecycle:'Paused',initialApprovedRevisionId:s.revisionId}})));
  render(<DraftWorkbench accountId="account-a" ownershipEpoch={0} initialPlanId={s.planId} />);
  await screen.findByText(/Program paused/);expect(screen.queryByRole('button',{name:'Start workout'})).toBeNull();
  expect(screen.queryByRole('button',{name:'Activate plan'})).toBeNull();expect(fetch).toHaveBeenCalledTimes(1);
});
