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
const mount = () => render(<DraftWorkbench accountId="account-a" ownershipEpoch={0} />);
const saved = () => waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/^Saved$/));
const reviewed = (name = plan.name, revisionNumber = 1) => {
  const s = rawState(name, revisionNumber);
  const issues = reviewPlan(s.intent);
  const contentHash = integrityHash(canonicalJson(s.intent));
  const binding = { accountId: 'account-a', planId: s.planId, revisionId: s.revisionId, contentHash,
    progression: s.intent.progression ?? null, progressionHash: integrityHash(canonicalJson(s.intent.progression ?? null)), policyVersion: REVIEW_POLICY };
  return { ...s, contentHash, activationBlockers: ['ACTIVATION_NOT_IMPLEMENTED', ...issues.map(i => i.code)],
    review: { ...binding, intent: s.intent, issues, status: issues.length ? 'issues' : 'validDraft', digest: integrityHash(canonicalJson(binding)) } };
};
const state = reviewed;
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState(null, '', '/'); });
describe('builder save recovery', () => {
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
