import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID, webcrypto } from 'node:crypto';
import { SkipWorkout } from './SkipWorkout';
import { Workout } from './Workout';
import { createHypertrophyPlan } from '@/lib/engine/trainer2/plan-builder';
import type { NextWorkoutRead } from '@/lib/trainer2-contracts/execution';
import type { SkipOccurrenceCommand } from '@/lib/trainer2-contracts/skip-occurrence';

const plan = createHypertrophyPlan(), occurrence = plan.occurrences[0];
const next: NextWorkoutRead = { accountId: 'synthetic-skip', planId: randomUUID(), revisionId: randomUUID(), acceptedSequence: '2', instructionEpoch: 0,
  lifecycle: 'Active', occurrence, execution: null, occurrences: plan.occurrences.slice(0, 2).map(o => ({ occurrenceId: o.id, name: o.name, stageName: 'Week 1', status: 'Pending', skip: null })) };
const props = { next, ownershipEpoch: 0, blocked: false, refresh: vi.fn(), onLock: vi.fn() };
const key = `trainer2-skip:${next.accountId}:${next.planId}`;
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
function accepted(body: string) {
  const c: SkipOccurrenceCommand = JSON.parse(body);
  return { replayed: false, outcomeCursor: '3', outcome: { status: 'Accepted', commandType: 'SkipOccurrence', actionId: c.actionId,
    acceptedSequence: '3', result: { ...c.target, revisionId: c.expected.planRevisionId, planCompleted: false } } };
}
async function confirm() { const button = await screen.findByRole('button', { name: 'Skip workout' }); await waitFor(() => expect(button).toBeEnabled()); fireEvent.click(button); fireEvent.click(screen.getByRole('button', { name: 'Confirm skip' })); }
beforeEach(() => { sessionStorage.clear(); vi.resetAllMocks(); vi.stubGlobal('crypto', webcrypto); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('exact skip confirmation and delivery', () => {
  it('names the reviewed workout/stage; cancel writes nothing and restores focus', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch); render(<SkipWorkout {...props} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Skip workout' }));
    expect(screen.getByText(`Skip ${occurrence.name}, Week 1?`)).toBeVisible(); expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' })); expect(screen.getByRole('button', { name: 'Skip workout' })).toHaveFocus();
    expect(fetch).not.toHaveBeenCalled(); expect(sessionStorage.length).toBe(0);
  });
  it('explains final completion', async () => {
    render(<SkipWorkout {...props} next={{ ...next, occurrences: next.occurrences.slice(0, 1) }} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Skip workout' })); expect(screen.getByText(/Skipping it will finish the plan/)).toBeVisible();
  });
  it.each(['occurrence', 'revision', 'sequence'])('a refreshed %s invalidates, never replaces, the confirmation', async field => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch); const view = render(<SkipWorkout {...props} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Skip workout' }));
    view.rerender(<SkipWorkout {...props} next={{ ...next, ...(field === 'occurrence' ? { occurrence: plan.occurrences[1] } : field === 'revision' ? { revisionId: randomUUID() } : { acceptedSequence: '3' }) }} />);
    expect(screen.getByText(`Skip ${occurrence.name}, Week 1?`)).toBeVisible(); expect(screen.getByRole('button', { name: 'Confirm skip' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm skip' })); expect(fetch).not.toHaveBeenCalled();
  });
  it('blocks duplicate actions, retains exact request through reload and later next state', async () => {
    let release!: (r: Response) => void;
    const fetch = vi.fn().mockImplementation(() => new Promise<Response>(r => { release = r; })); vi.stubGlobal('fetch', fetch);
    const view = render(<SkipWorkout {...props} />); await confirm(); const body = fetch.mock.calls[0][1].body;
    expect(screen.getByRole('button', { name: 'Check skip again' })).toBeDisabled(); fireEvent.click(screen.getByRole('button', { name: 'Check skip again' })); expect(fetch).toHaveBeenCalledTimes(1);
    await act(async () => release(response({ broken: true }))); await screen.findByText(/Skip could not be confirmed/); view.unmount();
    fetch.mockImplementation((_u, init) => Promise.resolve(response(accepted(init.body)))); props.refresh.mockResolvedValue(undefined);
    render(<SkipWorkout {...props} next={{ ...next, occurrence: plan.occurrences[1], acceptedSequence: '9' }} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Check skip again' })); await screen.findByText('Workout marked skipped.');
    expect(fetch.mock.calls[1][1].body).toBe(body); expect(props.refresh).toHaveBeenCalledWith(JSON.parse(body), false); expect(sessionStorage.getItem(key)).toBeNull();
  });
  it('ignores delayed acceptance after account/plan replacement', async () => {
    let release!: (r: Response) => void; const fetch = vi.fn().mockImplementation(() => new Promise<Response>(r => { release = r; })); vi.stubGlobal('fetch', fetch);
    const view = render(<SkipWorkout {...props} key="old" />); await confirm(); const body = fetch.mock.calls[0][1].body;
    view.rerender(<SkipWorkout {...props} key="new" next={{ ...next, planId: randomUUID() }} />);
    await act(async () => release(response(accepted(body)))); expect(props.refresh).not.toHaveBeenCalled(); expect(sessionStorage.getItem(key)).toBe(body);
  });
  it.each(['action', 'plan', 'revision', 'occurrence', 'malformed', 'http'])('does not accept a %s mismatch', async kind => {
    const fetch = vi.fn().mockImplementation((_u, init) => {
      const out = accepted(init.body);
      if (kind === 'action') out.outcome.actionId = randomUUID();
      if (kind === 'plan') out.outcome.result.planId = randomUUID();
      if (kind === 'revision') out.outcome.result.revisionId = randomUUID();
      if (kind === 'occurrence') out.outcome.result.occurrenceId = randomUUID();
      return response(kind === 'malformed' ? {} : out, kind === 'http' ? 503 : 200);
    }); vi.stubGlobal('fetch', fetch); render(<SkipWorkout {...props} />); await confirm();
    await screen.findByText(/Skip could not be confirmed/); expect(props.refresh).not.toHaveBeenCalled(); expect(sessionStorage.getItem(key)).toBe(fetch.mock.calls[0][1].body);
  });
  it('requires explicit refresh and a new decision after conflict', async () => {
    const fetch = vi.fn().mockImplementation((_u, init) => response({ replayed: false, outcomeCursor: '3', outcome: { status: 'Conflict', actionId: JSON.parse(init.body).actionId, commandType: 'SkipOccurrence', code: 'STALE_SKIP_BINDING' } }, 409)); vi.stubGlobal('fetch', fetch);
    render(<SkipWorkout {...props} />); await confirm(); await screen.findByRole('button', { name: 'Refresh workout' }); expect(screen.queryByRole('button', { name: 'Skip workout' })).toBeNull();
    expect(sessionStorage.getItem(key)).toBeNull(); fireEvent.click(screen.getByRole('button', { name: 'Refresh workout' })); await screen.findByRole('button', { name: 'Skip workout' }); expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('Workout authoritative skip readback', () => {
  it('does not publish a completion read after the plan component is replaced', async () => {
    let late!: (r: Response) => void; const complete = vi.fn();
    const fetch = vi.fn().mockResolvedValueOnce(response({}, 503)).mockImplementationOnce(() => new Promise<Response>(r => { late = r; })); vi.stubGlobal('fetch', fetch);
    const view = render(<Workout accountId={next.accountId} ownershipEpoch={0} planId={next.planId} onPlanComplete={complete} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Reload workout' })); view.unmount();
    await act(async () => late(response({ ...next, acceptedSequence: '4', lifecycle: 'Completed', occurrence: null, occurrences: next.occurrences.map(o => ({ ...o, status: 'Finished' })) })));
    expect(complete).not.toHaveBeenCalled();
  });
  it('keeps Start locked while retained skip storage is unreadable', async () => {
    sessionStorage.setItem(key, 'broken'); vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(next)));
    render(<Workout accountId={next.accountId} ownershipEpoch={0} planId={next.planId} />);
    await screen.findByText(/saved skip request could not be read/);
    expect(screen.getByRole('button', { name: 'Start workout' })).toBeDisabled();
    expect(sessionStorage.getItem(key)).toBe('broken');
  });
  it('a historical skip outcome reads current completion without restoring its old next workout', async () => {
    const c: SkipOccurrenceCommand = { schemaVersion: 1, commandType: 'SkipOccurrence', actionId: randomUUID(), deviceId: randomUUID(), originatingAccountId: next.accountId, ownershipEpoch: 0, dependsOn: [],
      target: { planId: next.planId, occurrenceId: occurrence.id }, expected: { planRevisionId: next.revisionId, acceptedSequence: '2' }, intent: {} };
    sessionStorage.setItem(key, JSON.stringify(c));
    const current: NextWorkoutRead = { ...next, acceptedSequence: '9', lifecycle: 'Completed', occurrence: null,
      occurrences: next.occurrences.map((o, i) => i ? { ...o, status: 'Finished' } : { ...o, status: 'Skipped', skip: { actionId: c.actionId,
        actorAccountId: next.accountId, revisionId: next.revisionId, skippedAt: '2026-09-15T12:00:00.000Z', planCompleted: false } }) };
    const fetch = vi.fn().mockImplementation((url, init) => response(url.endsWith('/skip') ? { ...accepted(init.body), replayed: true } : current)); vi.stubGlobal('fetch', fetch);
    render(<Workout accountId={next.accountId} ownershipEpoch={0} planId={next.planId} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Check skip again' })); await screen.findByText('Workout marked skipped.');
    expect(screen.getByRole('heading', { name: 'Plan complete' })).toBeVisible(); expect(screen.queryByRole('button', { name: 'Start workout' })).toBeNull();
    expect(JSON.parse(fetch.mock.calls.find(call => call[0].endsWith('/skip'))![1].body)).toEqual(c);
  });
  it('ignores an older pending read after a newer completion read', async () => {
    let old!: (r: Response) => void;
    const completed = { ...next, acceptedSequence: '4', lifecycle: 'Completed', occurrence: null, occurrences: next.occurrences.map(o => ({ ...o, status: 'Finished' })) };
    const fetch = vi.fn().mockResolvedValueOnce(response({}, 503)).mockImplementationOnce(() => new Promise<Response>(r => { old = r; })).mockResolvedValueOnce(response(completed)); vi.stubGlobal('fetch', fetch);
    render(<Workout accountId={next.accountId} ownershipEpoch={0} planId={next.planId} />);
    const reload = await screen.findByRole('button', { name: 'Reload workout' });
    // Dispatch both reads before React replaces the recovery control.
    act(() => { fireEvent.click(reload); fireEvent.click(reload); });
    await screen.findByRole('heading', { name: 'Plan complete' }); await act(async () => old(response(next)));
    expect(screen.getByRole('heading', { name: 'Plan complete' })).toBeVisible(); expect(screen.queryByRole('button', { name: 'Start workout' })).toBeNull();
  });
  it.each(['missing fact', 'wrong action', 'foreign', 'malformed', 'failed', 'stale sequence', 'wrong consequence'])('retains recovery after %s and succeeds only with exact skip fact', async kind => {
    let command: SkipOccurrenceCommand; let valid = false;
    const fetch = vi.fn().mockImplementation((url, init) => {
      if (url.endsWith('/skip')) { command = JSON.parse(init.body); return response(accepted(init.body)); }
      if (!command) return response(next);
      const after: NextWorkoutRead = { ...next, acceptedSequence: '3', occurrence: plan.occurrences[1], occurrences: next.occurrences.map((o, i) => i ? o : { ...o, status: 'Skipped', skip: {
        actionId: command.actionId, actorAccountId: next.accountId, revisionId: next.revisionId, skippedAt: '2026-09-15T12:00:00.000Z', planCompleted: false } }) };
      if (valid) return response(after);
      if (kind === 'wrong action') after.occurrences[0].skip!.actionId = randomUUID();
      if (kind === 'foreign') after.accountId = 'other';
      if (kind === 'stale sequence') after.acceptedSequence = '2';
      if (kind === 'wrong consequence') after.occurrences[0].skip!.planCompleted = true;
      return response(kind === 'missing fact' ? next : kind === 'malformed' ? {} : after, kind === 'failed' ? 503 : 200);
    }); vi.stubGlobal('fetch', fetch);
    render(<Workout accountId={next.accountId} ownershipEpoch={0} planId={next.planId} />); await confirm();
    await screen.findByText(/Skip could not be confirmed/); expect(screen.queryByText('Workout marked skipped.')).toBeNull();
    const body = sessionStorage.getItem(key)!; expect(body).toBeTruthy(); valid = true;
    fireEvent.click(screen.getByRole('button', { name: 'Check skip again' })); await screen.findByText('Workout marked skipped.');
    expect(fetch.mock.calls.filter(c => c[0].endsWith('/skip')).map(c => c[1].body)).toEqual([body, body]);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Start workout' })).toBeEnabled());
  });
});
