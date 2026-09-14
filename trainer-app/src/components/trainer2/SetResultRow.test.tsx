import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID, webcrypto } from 'node:crypto';
import { SetResultRow } from './SetResultRow';
import { performedResult, setResultCommand, type SavedSetResult } from '@/lib/trainer2-contracts/set-results';

const props = { accountId: 'synthetic-results', ownershipEpoch: 0, executionId: randomUUID(), targetId: randomUUID(), number: 1 };
const result = { reps: { value: 0, basis: 'perSide' as const }, measurement: null, rir: '0' };
const saved: SavedSetResult = { executionId: props.executionId, targetId: props.targetId, performedSetId: randomUUID(), version: 1,
  result, reason: null, actionId: randomUUID(), recordedAt: new Date().toISOString() };
const response = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });
const accepted = (body: string, version = 1) => { const c = setResultCommand.parse(JSON.parse(body)); return {
  replayed: false, outcomeCursor: '1', outcome: { status: 'Accepted', actionId: c.actionId, commandType: c.commandType,
    acceptedSequence: '1', result: { ...c.target, version, performedSetId: saved.performedSetId } } }; };
beforeEach(() => { sessionStorage.clear(); vi.stubGlobal('crypto', webcrypto); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe('Performed result input and recovery', () => {
  it('validates zero, unspecified, precise load and shapes without deriving targets', () => {
    expect(performedResult.parse(result)).toEqual(result);
    expect(performedResult.parse({ reps: null, measurement: { kind: 'assistance', value: '0.00', unit: 'lb', convention: 'displayedAssistance', zeroMeaning: 'noAssistance' }, rir: null }).measurement).toMatchObject({ value: '0.00' });
    for (const r of [{ reps: null, measurement: null, rir: null }, { ...result, rir: '-1' }, { ...result, rir: '11' },
      { ...result, reps: { value: 1.5, basis: 'total' } }, { ...result, reps: { value: -1, basis: 'total' } },
      { ...result, reps: { value: 1, basis: 'duration' } }, { ...result, duration: 20 }]) expect(performedResult.safeParse(r).success).toBe(false);
  });
  it('keeps original expected version and draft through background refresh, then requires explicit conflict recovery', async () => {
    const latest = { ...saved, version: 3 }; const refresh = vi.fn().mockResolvedValue([latest]);
    const fetch = vi.fn().mockImplementation((_url, init) => { const c = JSON.parse(init.body); return Promise.resolve(response({ replayed: false, outcomeCursor: '2', outcome: {
      status: 'Conflict', actionId: c.actionId, commandType: c.commandType, code: 'STALE_SET_RESULT' } }, 409)); }); vi.stubGlobal('fetch', fetch);
    const view = render(<SetResultRow {...props} saved={saved} refresh={refresh} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit result' }));
    fireEvent.change(screen.getByLabelText('Set 1 Actual reps'), { target: { value: '9' } });
    fireEvent.change(screen.getByLabelText('Set 1 correction reason'), { target: { value: 'Typo' } });
    view.rerender(<SetResultRow {...props} saved={latest} refresh={refresh} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save correction' }));
    await screen.findByRole('button', { name: 'Review latest result' });
    expect(JSON.parse(fetch.mock.calls[0][1].body).expected.resultVersion).toBe(1);
    expect(screen.getByLabelText('Set 1 Actual reps')).toHaveValue('9');
    fireEvent.click(screen.getByRole('button', { name: 'Review latest result' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Use this version for my correction' }));
    expect(fetch).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Save correction' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(JSON.parse(fetch.mock.calls[1][1].body).expected.resultVersion).toBe(3);
  });
  it('blocks double submits, retains malformed/lost-response command through remount, and reads current state on replay', async () => {
    let finish!: (v: Response) => void;
    const fetch = vi.fn().mockImplementationOnce(() => new Promise<Response>(r => { finish = r; })); vi.stubGlobal('fetch', fetch);
    const refresh = vi.fn().mockResolvedValue([{ ...saved, version: 4 }]);
    const view = render(<SetResultRow {...props} refresh={refresh} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Enter actual result' }));
    expect(screen.getByLabelText('Set 1 Actual reps')).toHaveValue('');
    fireEvent.change(screen.getByLabelText('Set 1 Actual reps'), { target: { value: '0' } });
    const button = screen.getByRole('button', { name: 'Record set' }); fireEvent.click(button); fireEvent.click(button);
    expect(fetch).toHaveBeenCalledTimes(1); const body = fetch.mock.calls[0][1].body;
    finish(response({ malformed: true })); await waitFor(() => expect(screen.getByRole('button', { name: 'Check again' })).toBeEnabled());
    view.unmount(); fetch.mockResolvedValueOnce(response(accepted(body)));
    render(<SetResultRow {...props} refresh={refresh} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Check again' }));
    await screen.findByText('Saved'); expect(fetch.mock.calls[1][1].body).toBe(body); expect(refresh).toHaveBeenCalledTimes(1);
    expect(sessionStorage.length).toBe(0);
  });
  it('retains the old command and ignores a valid late success after switching executions', async () => {
    let finish!: (v: Response) => void;
    const fetch = vi.fn().mockImplementation(() => new Promise<Response>(r => { finish = r; })); vi.stubGlobal('fetch', fetch);
    const refresh = vi.fn(); const view = render(<SetResultRow key="first" {...props} refresh={refresh} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Enter actual result' }));
    fireEvent.change(screen.getByLabelText('Set 1 Actual reps'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record set' })); const body = fetch.mock.calls[0][1].body;
    view.rerender(<SetResultRow key="second" {...props} executionId={randomUUID()} refresh={refresh} />);
    finish(response(accepted(body))); await waitFor(() => expect(screen.getByText('Not recorded')).toBeInTheDocument());
    expect(refresh).not.toHaveBeenCalled(); expect(sessionStorage.length).toBe(1);
  });
});
