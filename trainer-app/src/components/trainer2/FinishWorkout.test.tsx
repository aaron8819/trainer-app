import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID, webcrypto } from 'node:crypto';
import { FinishWorkout } from './FinishWorkout';
import type { ExecutionRead } from '@/lib/trainer2-contracts/execution';
import { reviewedResults } from '@/lib/trainer2-contracts/workout-finish';

const targetId = randomUUID(), sourceTargetId = randomUUID();
const execution = { executionId: randomUUID(), lifecycle: 'Open', contentHash: 'a'.repeat(64), results: [],
  initial: { accountId: 'finish-test', planId: randomUUID(), occurrence: { id: randomUUID(), positions: [{ targets: [{ id: sourceTargetId, required: true }] }] },
    positions: [{ targets: [{ id: targetId, sourceTargetId }] }] } } as unknown as ExecutionRead;
const props = { execution, ownershipEpoch: 0, blocked: false, refresh: vi.fn(), onLock: vi.fn() };
const response = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });
const accepted = (body: string) => { const c = JSON.parse(body); return { replayed: false, outcomeCursor: '1', outcome: { status: 'Accepted', actionId: c.actionId,
  commandType: 'FinishExecution', acceptedSequence: '1', result: { executionId: c.target.executionId, planId: execution.initial.planId, occurrenceId: execution.initial.occurrence.id, planCompleted: true } } }; };
beforeEach(() => { sessionStorage.clear(); vi.stubGlobal('crypto', webcrypto); vi.clearAllMocks(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe('Finish workout decisions', () => {
  it('blocks unsaved or pending input without submitting or discarding it', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch); render(<FinishWorkout {...props} blocked />);
    expect(await screen.findByRole('button', { name: 'Finish workout' })).toBeDisabled(); expect(fetch).not.toHaveBeenCalled();
    expect(screen.getByText(/Save, discard, or recover/)).toBeVisible();
  });
  it('freezes reviewed versions across background refresh and requires explicit retry after conflict', async () => {
    const fetch = vi.fn().mockImplementation((_u, init) => { const c = JSON.parse(init.body); return response({ replayed: false, outcomeCursor: '1', outcome: { status: 'Conflict', actionId: c.actionId, commandType: 'FinishExecution', code: 'STALE_FINISH_RESULTS' } }, 409); }); vi.stubGlobal('fetch', fetch);
    const view = render(<FinishWorkout {...props} />); fireEvent.click(await screen.findByRole('button', { name: 'Finish workout' }));
    const changed = { ...execution, results: [{ executionId: execution.executionId, targetId, performedSetId: randomUUID(), version: 3,
      actionId: randomUUID(), recordedAt: new Date().toISOString(), reason: 'Same value again', result: { reps: { value: 8, basis: 'total' as const }, measurement: null, rir: null } }] };
    view.rerender(<FinishWorkout {...props} execution={changed} />);
    fireEvent.click(screen.getByRole('button', { name: 'Finish with unrecorded sets' }));
    await screen.findByText(/Finish was not accepted/); expect(JSON.parse(fetch.mock.calls[0][1].body).expected).toEqual(reviewedResults(execution));
    expect(fetch).toHaveBeenCalledTimes(1); fireEvent.click(screen.getByRole('button', { name: 'Finish workout' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm finish' })); await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(JSON.parse(fetch.mock.calls[1][1].body).expected.results[0].resultVersion).toBe(3);
  });
  it('retains malformed/lost responses and replays the identical command after reload', async () => {
    const fetch = vi.fn().mockResolvedValue(response({ broken: true })); vi.stubGlobal('fetch', fetch);
    const view = render(<FinishWorkout {...props} />); fireEvent.click(await screen.findByRole('button', { name: 'Finish workout' })); fireEvent.click(screen.getByRole('button', { name: 'Finish with unrecorded sets' }));
    await screen.findByText(/Finish could not be confirmed/); const body = fetch.mock.calls[0][1].body; view.unmount();
    fetch.mockImplementation((_u, init) => Promise.resolve(response(accepted(init.body)))); props.refresh.mockResolvedValue(undefined);
    render(<FinishWorkout {...props} />); fireEvent.click(await screen.findByRole('button', { name: 'Check finish again' }));
    await screen.findByText('Workout finished.'); expect(fetch.mock.calls[1][1].body).toBe(body); expect(props.refresh).toHaveBeenCalledTimes(1);
  });
  it('ignores a valid delayed acceptance after the execution component is replaced', async () => {
    let resolve!: (r: Response) => void; const fetch = vi.fn().mockImplementation(() => new Promise<Response>(r => { resolve = r; })); vi.stubGlobal('fetch', fetch);
    const view = render(<FinishWorkout {...props} key="one" />); fireEvent.click(await screen.findByRole('button', { name: 'Finish workout' })); fireEvent.click(screen.getByRole('button', { name: 'Finish with unrecorded sets' }));
    const body = fetch.mock.calls[0][1].body; view.rerender(<FinishWorkout {...props} key="two" execution={{ ...execution, executionId: randomUUID() }} />);
    resolve(response(accepted(body))); await waitFor(() => expect(screen.getByRole('button', { name: 'Finish workout' })).toBeEnabled());
    expect(props.refresh).not.toHaveBeenCalled(); expect(sessionStorage.getItem(`trainer2-finish:finish-test:${execution.executionId}`)).toBe(body);
  });
  it('keeps original pending command when completed readback fails', async () => {
    const fetch = vi.fn().mockImplementation((_u, init) => Promise.resolve(response(accepted(init.body)))); vi.stubGlobal('fetch', fetch); props.refresh.mockRejectedValue(new Error('Read failed'));
    render(<FinishWorkout {...props} />); fireEvent.click(await screen.findByRole('button', { name: 'Finish workout' })); fireEvent.click(screen.getByRole('button', { name: 'Finish with unrecorded sets' }));
    await screen.findByText(/Finish could not be confirmed/); expect(sessionStorage.getItem(`trainer2-finish:finish-test:${execution.executionId}`)).not.toBeNull();
  });
});
