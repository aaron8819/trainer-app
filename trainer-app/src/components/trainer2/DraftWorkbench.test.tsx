import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHypertrophyPlan } from '@/lib/engine/trainer2/plan-builder';
import { DraftWorkbench } from './DraftWorkbench';
const plan = createHypertrophyPlan();
const state = (name = plan.name, revisionNumber = 1) => ({ planId: '00000000-0000-4000-8000-000000000001', revisionId: `00000000-0000-4000-8000-00000000000${revisionNumber + 1}`, revisionNumber, intent: { ...plan, name }, activationBlockers: [] });
const json = (body: unknown, ok = true) => ({ ok, json: async () => body });
const acceptance = () => json({ outcome: { status: 'Accepted', result: { planId: state().planId } } });
const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
const mount = () => render(<DraftWorkbench accountId="account-a" ownershipEpoch={0} />);
const saved = () => waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/^Saved$/));
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
