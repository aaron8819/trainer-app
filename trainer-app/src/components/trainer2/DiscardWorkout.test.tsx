import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID, webcrypto } from 'node:crypto';
import { DiscardWorkout } from './DiscardWorkout';
import type { ExecutionRead } from '@/lib/trainer2-contracts/execution';
import { reviewedResults } from '@/lib/trainer2-contracts/workout-finish';

const targetId = randomUUID(), sourceTargetId = randomUUID();
const execution = { executionId: randomUUID(), lifecycle: 'Open', contentHash: 'a'.repeat(64), results: [], history: [],
  initial: { accountId: 'finish-test', planId: randomUUID(), occurrence: { id: randomUUID(), positions: [{ targets: [{ id: sourceTargetId, required: true }] }] },
    positions: [{ targets: [{ id: targetId, sourceTargetId }] }] } } as unknown as ExecutionRead;
const props = { execution, ownershipEpoch: 0, blocked: false, refresh: vi.fn(), onLock: vi.fn() };
const response = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });
const accepted = (body: string) => { const c = JSON.parse(body); return { replayed: false, outcomeCursor: '1', outcome: { status: 'Accepted', actionId: c.actionId,
  commandType: 'DiscardEmptyExecution', acceptedSequence: '1', result: { executionId: c.target.executionId, planId: execution.initial.planId, occurrenceId: execution.initial.occurrence.id } } }; };
beforeEach(() => { sessionStorage.clear(); vi.stubGlobal('crypto', webcrypto); vi.clearAllMocks(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe('Discard empty workout decisions', () => {
  it('blocks unsaved or pending input without submitting or discarding it', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch); render(<DiscardWorkout {...props} blocked />);
    expect(await screen.findByRole('button', { name: 'Discard empty workout' })).toBeDisabled(); expect(fetch).not.toHaveBeenCalled();
    expect(screen.getByText(/Save, cancel, or recover/)).toBeVisible();
  });
  it('cancels without writes and returns keyboard focus', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch); render(<DiscardWorkout {...props} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Discard empty workout' }));
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Discard empty workout' })).toHaveFocus(); expect(fetch).not.toHaveBeenCalled();
  });
  it('retains the exact reviewed binding and requires refresh after a conflict', async () => {
    const fetch = vi.fn().mockImplementation((_u, init) => { const c = JSON.parse(init.body); return response({ replayed: false, outcomeCursor: '1', outcome: { status: 'Conflict', actionId: c.actionId, commandType: 'DiscardEmptyExecution', code: 'EXECUTION_NOT_EMPTY' } }, 409); }); vi.stubGlobal('fetch', fetch);
    const view = render(<DiscardWorkout {...props} />); fireEvent.click(await screen.findByRole('button', { name: 'Discard empty workout' }));
    view.rerender(<DiscardWorkout {...props} execution={{ ...execution, contentHash: 'b'.repeat(64) }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm discard' })); await screen.findByText(/Discard was not accepted/);
    expect(JSON.parse(fetch.mock.calls[0][1].body).expected).toEqual(reviewedResults(execution));
    expect(screen.getByRole('button', { name: 'Discard empty workout' })).toBeDisabled();
    view.rerender(<DiscardWorkout {...props} execution={{ ...execution }} />);
    expect(screen.getByRole('button', { name: 'Discard empty workout' })).toBeEnabled();
  });
  it.each([null, { reps: { value: 0, basis: 'total' }, measurement: null, rir: null }])('rejects any history including cleared and zero results', async result => {
    render(<DiscardWorkout {...props} execution={{ ...execution, history: [{ result }] as ExecutionRead['history'] }} />);
    expect(await screen.findByRole('button', { name: 'Discard empty workout' })).toBeDisabled();
  });
  it('retains malformed/lost responses and replays the identical command after reload', async () => {
    const fetch = vi.fn().mockResolvedValue(response({ broken: true })); vi.stubGlobal('fetch', fetch);
    const view = render(<DiscardWorkout {...props} />); fireEvent.click(await screen.findByRole('button', { name: 'Discard empty workout' })); fireEvent.click(screen.getByRole('button', { name: 'Confirm discard' }));
    await screen.findByText(/Discard could not be confirmed/); const body = fetch.mock.calls[0][1].body; view.unmount();
    fetch.mockImplementation((_u, init) => Promise.resolve(response(accepted(init.body)))); props.refresh.mockResolvedValue(undefined);
    render(<DiscardWorkout {...props} />); fireEvent.click(await screen.findByRole('button', { name: 'Check discard again' }));
    await screen.findByText('Workout attempt discarded.'); expect(fetch.mock.calls[1][1].body).toBe(body); expect(props.refresh).toHaveBeenCalledTimes(1);
  });
  it('ignores a valid delayed acceptance after the execution component is replaced', async () => {
    let resolve!: (r: Response) => void; const fetch = vi.fn().mockImplementation(() => new Promise<Response>(r => { resolve = r; })); vi.stubGlobal('fetch', fetch);
    const view = render(<DiscardWorkout {...props} key="one" />); fireEvent.click(await screen.findByRole('button', { name: 'Discard empty workout' })); fireEvent.click(screen.getByRole('button', { name: 'Confirm discard' }));
    const body = fetch.mock.calls[0][1].body; view.rerender(<DiscardWorkout {...props} key="two" execution={{ ...execution, executionId: randomUUID() }} />);
    resolve(response(accepted(body))); await waitFor(() => expect(screen.getByRole('button', { name: 'Discard empty workout' })).toBeEnabled());
    expect(props.refresh).not.toHaveBeenCalled(); expect(sessionStorage.getItem(`trainer2-discard:finish-test:${execution.executionId}`)).toBe(body);
  });
  it('keeps original pending command when completed readback fails', async () => {
    const fetch = vi.fn().mockImplementation((_u, init) => Promise.resolve(response(accepted(init.body)))); vi.stubGlobal('fetch', fetch); props.refresh.mockRejectedValue(new Error('Read failed'));
    render(<DiscardWorkout {...props} />); fireEvent.click(await screen.findByRole('button', { name: 'Discard empty workout' })); fireEvent.click(screen.getByRole('button', { name: 'Confirm discard' }));
    await screen.findByText(/Discard could not be confirmed/); expect(sessionStorage.getItem(`trainer2-discard:finish-test:${execution.executionId}`)).not.toBeNull();
  });
});

it.each(['executionId', 'occurrenceId', 'planId'])('retains an accepted but mismatched %s response', async field => {
  const fetch = vi.fn().mockImplementation((_u, init) => { const out = accepted(init.body); out.outcome.result[field as keyof typeof out.outcome.result] = randomUUID(); return Promise.resolve(response(out)); });
  vi.stubGlobal('fetch', fetch); render(<DiscardWorkout {...props} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Discard empty workout' })); fireEvent.click(screen.getByRole('button', { name: 'Confirm discard' }));
  await screen.findByText(/Discard could not be confirmed/); expect(props.refresh).not.toHaveBeenCalled();
  expect(sessionStorage.getItem(`trainer2-discard:finish-test:${execution.executionId}`)).toBe(fetch.mock.calls[0][1].body);
});
