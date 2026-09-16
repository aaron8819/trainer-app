import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID, webcrypto } from 'node:crypto';
import { SetResultRow } from './SetResultRow';
import { performedResult, resultMutationCommand, historicalCorrectionCommand, type SavedSetResult } from '@/lib/trainer2-contracts/set-results';

const props = { accountId: 'synthetic-results', ownershipEpoch: 0, executionId: randomUUID(), targetId: randomUUID(), number: 1 };
const result = { reps: { value: 0, basis: 'perSide' as const }, measurement: null, rir: '0' };
const saved: SavedSetResult = { executionId: props.executionId, targetId: props.targetId, performedSetId: randomUUID(), version: 1,
  result, reason: null, actionId: randomUUID(), recordedAt: new Date().toISOString() };
const response = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });
const accepted = (body: string, version = 1) => { const c = resultMutationCommand.parse(JSON.parse(body)); return {
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


describe('Historical corrections', () => {
  it('only offers correction for an existing non-null result and cancels without a command', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const view = render(<SetResultRow {...props} historical refresh={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Correct result' })).toBeNull();
    view.rerender(<SetResultRow {...props} historical saved={{ ...saved, result: null }} refresh={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Correct result' })).toBeNull();
    view.rerender(<SetResultRow {...props} historical saved={saved} history={[saved]} finishVersion={1} refresh={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Correct result' }));
    expect(screen.getByLabelText('Set 1 Actual reps')).toHaveValue('0');
    expect(screen.queryByLabelText('Set 1 correction reason')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Clear erroneous result' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(fetch).not.toHaveBeenCalled(); expect(sessionStorage.length).toBe(0);
    expect(screen.getByText('Result history').closest('details')?.open).toBe(false);
    expect(screen.getByText(/Acknowledged at finish/)).toBeInTheDocument();
  });
  it('freezes equal-value versions across refresh and requires explicit stale review', async () => {
    const latest = { ...saved, version: 2 };
    const refresh = vi.fn().mockResolvedValue([latest]);
    const fetch = vi.fn().mockImplementation((_url, init) => { const c = JSON.parse(init.body); return Promise.resolve(response({ replayed: false, outcomeCursor: '2', outcome: {
      status: 'Conflict', actionId: c.actionId, commandType: c.commandType, code: 'STALE_SET_RESULT' } }, 409)); }); vi.stubGlobal('fetch', fetch);
    const view = render(<SetResultRow {...props} historical saved={saved} refresh={refresh} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Correct result' }));
    fireEvent.change(screen.getByLabelText('Set 1 Actual reps'), { target: { value: 'bad' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save correction' })); expect(fetch).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Set 1 Actual reps')).toHaveValue('bad');
    fireEvent.change(screen.getByLabelText('Set 1 Actual reps'), { target: { value: '0' } });
    view.rerender(<SetResultRow {...props} historical saved={latest} refresh={refresh} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save correction' }));
    await screen.findByText(/Result changed elsewhere/);
    expect(fetch.mock.calls[0][0]).toBe('/api/trainer2/executions/corrections');
    expect(JSON.parse(fetch.mock.calls[0][1].body).expected.resultVersion).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: 'Review latest result' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Use this version for my correction' }));
    expect(fetch).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Save correction' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(JSON.parse(fetch.mock.calls[1][1].body).expected.resultVersion).toBe(2);
  });
  it.each(['lost', 'malformed', 'mismatched'])('retains %s responses across reload and retries the exact historical command', async mode => {
    const fetch = vi.fn().mockImplementationOnce((_url, init) => {
      if (mode === 'lost') return Promise.reject(new Error('lost'));
      return Promise.resolve(response(mode === 'malformed' ? {} : { ...accepted(init.body, 2), outcome: { ...accepted(init.body, 2).outcome, actionId: randomUUID() } }));
    }); vi.stubGlobal('fetch', fetch);
    const refresh = vi.fn().mockResolvedValue([{ ...saved, version: 5 }]);
    const view = render(<SetResultRow {...props} historical saved={saved} refresh={refresh} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Correct result' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save correction' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Check again' })).toBeEnabled());
    expect(screen.queryByText('Saved')).toBeNull();
    const body = fetch.mock.calls[0][1].body; view.unmount();
    fetch.mockResolvedValueOnce(response(accepted(body, 2)));
    render(<SetResultRow {...props} historical saved={{ ...saved, version: 5 }} refresh={refresh} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Check again' }));
    await screen.findByText('Saved'); expect(fetch.mock.calls[1][1].body).toBe(body);
    expect(screen.getByText(/^Saved v5/)).toBeInTheDocument();
  });
  it('requires exact identity/version and a supported non-null historical result', () => {
    const command = { schemaVersion: 1, actionId: randomUUID(), deviceId: randomUUID(), originatingAccountId: props.accountId,
      ownershipEpoch: 0, dependsOn: [], commandType: 'CorrectHistoricalSetResult', target: { executionId: props.executionId, targetId: props.targetId },
      expected: { resultVersion: 1, performedSetId: saved.performedSetId }, intent: { result, reason: 'Correct recorded result' } };
    expect(historicalCorrectionCommand.safeParse(command).success).toBe(true);
    for (const expected of [undefined, {}, { ...command.expected, resultVersion: 0 }, { ...command.expected, resultVersion: '1' }, { ...command.expected, performedSetId: 'wrong' }])
      expect(historicalCorrectionCommand.safeParse({ ...command, expected }).success).toBe(false);
    for (const bad of [null, {}, { ...result, reps: { value: -1, basis: 'total' } }])
      expect(historicalCorrectionCommand.safeParse({ ...command, intent: { ...command.intent, result: bad } }).success).toBe(false);
  });
});
import { createHypertrophyPlan } from '@/lib/engine/trainer2/plan-builder';
it('keeps compact catalog defaults unrecorded and reuses only a known unit', async () => {
  const position = createHypertrophyPlan().occurrences[0].positions[0];
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch); const blocked = vi.fn();
  render(<SetResultRow {...props} prescription={position.targets[0]} exercise={position.exercise} unitHint="lb" refresh={vi.fn()} onInputState={blocked} />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Record set' })).toBeEnabled());
  expect(screen.getByLabelText('Set 1 Actual load')).toHaveValue('');
  expect(screen.getByLabelText('Set 1 Actual reps')).toHaveValue('');
  expect(screen.getByLabelText('Set 1 load unit')).toHaveValue('lb');
  expect(screen.getByLabelText('Set 1 actual load type')).toHaveValue('externalLoad');
  expect(fetch).not.toHaveBeenCalled(); expect(sessionStorage.length).toBe(0);
  expect(blocked).toHaveBeenLastCalledWith(props.targetId, false);
  fireEvent.change(screen.getByLabelText('Set 1 Actual reps'), { target: { value: '0' } });
  expect(blocked).toHaveBeenLastCalledWith(props.targetId, true);
  expect(JSON.parse(sessionStorage.getItem(`trainer2-result:${props.accountId}:${props.executionId}:${props.targetId}`)!).form.reps).toBe('0');
});
it('does not guess a custom exercise load convention or a catalog unit', async () => {
  const position = createHypertrophyPlan().occurrences[0].positions[0];
  render(<SetResultRow {...props} prescription={position.targets[0]} exercise={{ kind: 'authoredDescription', name: 'Barbell squat', variation: '' }} refresh={vi.fn()} />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Record set' })).toBeEnabled());
  expect(screen.getByLabelText('Set 1 actual load type')).toHaveValue('unspecified');
  expect(screen.queryByLabelText('Set 1 Actual load')).toBeNull();
});
