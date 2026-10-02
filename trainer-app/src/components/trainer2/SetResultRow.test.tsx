import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID, webcrypto } from 'node:crypto';
import { SetResultRow } from './SetResultRow';
import { catalog, catalogExercise } from '@/lib/engine/trainer2/catalog';
import { performedResult, recordSetResultCommand, resultMutationCommand, historicalCorrectionCommand, type SavedSetResult } from '@/lib/trainer2-contracts/set-results';

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

describe('Accepted addition load prefill', () => {
  const external = { kind: 'externalLoad' as const, convention: 'machineDisplayed' as const, zeroMeaning: 'validZero' as const, value: '10', unit: 'kg' as const };
  const assistance = { kind: 'assistance' as const, convention: 'displayedAssistance' as const, zeroMeaning: 'noAssistance' as const, value: '10', unit: 'kg' as const };
  const added = { kind: 'addedLoad' as const, convention: 'addedExternal' as const, zeroMeaning: 'noAddedLoad' as const, value: '10', unit: 'kg' as const };
  const dumbbell = { ...external, convention: 'perImplement' as const, zeroMeaning: 'notAllowed' as const };
  const cases = [
    { id: 't2:leg-press', measurement: external, display: '22.05' },
    { id: 't2:leg-press', measurement: { ...external, value: '0.00' }, display: '0' },
    { id: 't2:leg-press', measurement: { ...external, value: '42.5', unit: 'lb' as const }, display: '42.5' },
    { id: 't2:machine-assisted-pull-up', measurement: assistance, display: '22.05' },
    { id: 't2:machine-assisted-pull-up', measurement: { ...assistance, value: '0.00' }, display: '0' },
    { id: 't2:weighted-pull-up', measurement: added, display: '22.05' },
    { id: 't2:weighted-pull-up', measurement: { ...added, value: '0.00' }, display: '0' },
    { id: 't2:concentration-curl', measurement: dumbbell, display: '22.05' },
  ];
  it.each(cases)('logs untouched $id $measurement.value $measurement.unit through bounded display conversion', async ({ id, measurement, display }) => {
    const exercise = catalogExercise(catalog.find(e => e.id === id)!);
    if (exercise.kind !== 'catalogSnapshot') throw new Error('Expected catalog snapshot');
    const prescription = { id: props.targetId, classification: 'working' as const, required: true,
      reps: { min: 8, max: 8, basis: exercise.repBasis }, measurement, rir: '2', restSeconds: '120' };
    const before = JSON.stringify(prescription);
    let submitted = '';
    vi.stubGlobal('fetch', vi.fn((_url, init) => { submitted = init.body; return response(accepted(submitted)); }));
    render(<SetResultRow {...props} activePanel sessionAdded authoredLoad exercise={exercise} prescription={prescription}
      refresh={async () => [{ ...saved, actionId: JSON.parse(submitted).actionId, result: JSON.parse(submitted).intent.result }]} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Log set' })).toBeEnabled());
    expect(screen.getByLabelText('Set 1 Actual load', { exact: true })).toHaveValue(display);
    fireEvent.click(screen.getByRole('button', { name: 'Log set' }));
    await screen.findByText('Saved');
    expect(recordSetResultCommand.parse(JSON.parse(submitted)).intent.result.measurement).toEqual(measurement);
    expect(JSON.stringify(prescription)).toBe(before);
  });
  it('records an edited explicit load in pounds instead of restoring its original kg value', async () => {
    const exercise = catalogExercise(catalog.find(e => e.id === 't2:leg-press')!);
    const prescription = { id: props.targetId, classification: 'working' as const, required: true,
      reps: { min: 8, max: 8, basis: 'total' as const }, measurement: external, rir: '2', restSeconds: '120' };
    let submitted = '';
    vi.stubGlobal('fetch', vi.fn((_url, init) => { submitted = init.body; return response(accepted(submitted)); }));
    render(<SetResultRow {...props} activePanel sessionAdded authoredLoad exercise={exercise} prescription={prescription}
      refresh={async () => [{ ...saved, actionId: JSON.parse(submitted).actionId, result: JSON.parse(submitted).intent.result }]} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Log set' })).toBeEnabled());
    fireEvent.change(screen.getByLabelText('Set 1 Actual load', { exact: true }), { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Log set' })); await screen.findByText('Saved');
    expect(JSON.parse(submitted).intent.result.measurement).toEqual({ ...external, value: '25', unit: 'lb' });
  });
  it.each(cases.filter(c => c.measurement.unit === 'kg'))('keeps the existing nearest-five history suggestion for $id $measurement.value', async ({ id, measurement }) => {
    const exercise = catalogExercise(catalog.find(e => e.id === id)!);
    if (exercise.kind !== 'catalogSnapshot') throw new Error('Expected catalog snapshot');
    const prescription = { id: props.targetId, classification: 'working' as const, required: true,
      reps: { min: 8, max: 8, basis: exercise.repBasis }, measurement: null, rir: '2', restSeconds: '120' };
    const historical = { ...saved, result: { reps: { value: 8, basis: exercise.repBasis }, measurement, rir: '2' } };
    let submitted = '';
    vi.stubGlobal('fetch', vi.fn((_url, init) => { submitted = init.body; return response(accepted(submitted)); }));
    render(<SetResultRow {...props} activePanel sessionAdded exercise={exercise} prescription={prescription} firstSetLoad={historical}
      refresh={async () => [{ ...saved, actionId: JSON.parse(submitted).actionId, result: JSON.parse(submitted).intent.result }]} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Log set' })).toBeEnabled());
    const value = measurement.value === '0.00' ? '0' : '20';
    expect(screen.getByLabelText('Set 1 Actual load', { exact: true })).toHaveValue(value);
    fireEvent.click(screen.getByRole('button', { name: 'Log set' })); await screen.findByText('Saved');
    expect(JSON.parse(submitted).intent.result.measurement).toEqual({ ...measurement, value, unit: 'lb' });
  });
  it('logs an explicit bodyweight target without inventing a numeric load', async () => {
    const exercise = catalogExercise(catalog.find(e => e.loadKind === 'bodyweight')!);
    if (exercise.kind !== 'catalogSnapshot') throw new Error('Expected catalog snapshot');
    const measurement = { kind: 'bodyweight' as const, convention: 'bodyweightOnly' as const };
    const prescription = { id: props.targetId, classification: 'working' as const, required: true,
      reps: { min: 8, max: 8, basis: exercise.repBasis }, measurement, rir: '2', restSeconds: '120' };
    let submitted = '';
    vi.stubGlobal('fetch', vi.fn((_url, init) => { submitted = init.body; return response(accepted(submitted)); }));
    render(<SetResultRow {...props} activePanel sessionAdded authoredLoad exercise={exercise} prescription={prescription}
      refresh={async () => [{ ...saved, actionId: JSON.parse(submitted).actionId, result: JSON.parse(submitted).intent.result }]} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Log set' })).toBeEnabled());
    expect(screen.queryByLabelText('Set 1 Actual load', { exact: true })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Log set' })); await screen.findByText('Saved');
    expect(JSON.parse(submitted).intent.result.measurement).toEqual(measurement);
  });
});

it('records newly qualified per-side dumbbell work with its captured policy and fixed options', async () => {
  const exercise = catalogExercise(catalog.find(e => e.id === 't2:concentration-curl')!);
  const prescription = { id: props.targetId, classification: 'working' as const, required: true,
    reps: { min: 8, max: 15, basis: 'perSide' as const }, measurement: null, rir: '2', restSeconds: null };
  let submitted = '';
  const fetch = vi.fn().mockImplementation((_url, init) => { submitted = init.body; return response(accepted(submitted)); });
  vi.stubGlobal('fetch', fetch);
  render(<SetResultRow {...props} activePanel exercise={exercise} prescription={prescription}
    refresh={async () => [{ ...saved, actionId: JSON.parse(submitted).actionId, result: JSON.parse(submitted).intent.result }]} />);
  await screen.findByLabelText('Set 1 Actual reps');
  for (const label of ['rep basis', 'actual load type', 'load basis', 'zero load meaning']) {
    expect(screen.getByLabelText('Set 1 ' + label, { exact: true })).toBeDisabled();
  }
  expect(screen.getByLabelText('Set 1 rep basis')).toHaveValue('perSide');
  expect(screen.getByLabelText('Set 1 load basis')).toHaveValue('perImplement');
  expect(screen.getByLabelText('Set 1 zero load meaning')).toHaveValue('notAllowed');
  fireEvent.change(screen.getByLabelText('Set 1 Actual reps'), { target: { value: '8' } });
  fireEvent.change(screen.getByLabelText('Set 1 Actual load', { exact: true }), { target: { value: '25' } });
  fireEvent.click(screen.getByRole('button', { name: 'Log set' }));
  await screen.findByText('Saved');
  expect(JSON.parse(submitted).intent.result).toEqual({ reps: { value: 8, basis: 'perSide' },
    measurement: { kind: 'externalLoad', value: '25', unit: 'lb', convention: 'perImplement', zeroMeaning: 'notAllowed' }, rir: '2' });
});
describe('Performed result input and recovery', () => {
  it('recovers a transient save without manual retry or a new action and advances once', async () => {
    let submitted = '';
    const fetch = vi.fn().mockImplementationOnce((_u, init) => { submitted = init.body; return response({}, 503); })
      .mockImplementationOnce((_u, init) => { expect(init.body).toBe(submitted); return response(accepted(init.body)); });
    vi.stubGlobal('fetch', fetch);
    const onRecorded = vi.fn(), advance = vi.fn();
    render(<SetResultRow {...props} refresh={vi.fn().mockImplementation(() => [{ ...saved, actionId: JSON.parse(submitted).actionId }])} onRecorded={onRecorded} onSubmission={() => advance} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Enter actual result' }));
    fireEvent.change(screen.getByLabelText('Set 1 Actual reps'), { target: { value: '8' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record set' }));
    await screen.findByText('Saved'); expect(fetch).toHaveBeenCalledTimes(2);
    expect(onRecorded).toHaveBeenCalledTimes(1); expect(advance).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Retry save' })).toBeNull();
  });
  it('validates zero, unspecified, precise load and shapes without deriving targets', () => {
    expect(performedResult.parse(result)).toEqual(result);
    expect(performedResult.parse({ reps: null, measurement: { kind: 'assistance', value: '0.00', unit: 'lb', convention: 'displayedAssistance', zeroMeaning: 'noAssistance' }, rir: null }).measurement).toMatchObject({ value: '0.00' });
    for (const r of [{ reps: null, measurement: null, rir: null }, { ...result, rir: '-1' }, { ...result, rir: '11' },
      { ...result, reps: { value: 1.5, basis: 'total' } }, { ...result, reps: { value: -1, basis: 'total' } },
      { ...result, reps: { value: 1, basis: 'duration' } }, { ...result, duration: 20 }]) expect(performedResult.safeParse(r).success).toBe(false);
  });
  it('requires reps in a new record even with load or RIR, while accepting zero reps without load', () => {
    const command = { schemaVersion: 1, actionId: randomUUID(), deviceId: randomUUID(), originatingAccountId: props.accountId,
      ownershipEpoch: 0, dependsOn: [], commandType: 'RecordSetResult', target: { executionId: props.executionId, targetId: props.targetId },
      expected: { resultVersion: 0 }, intent: { result } };
    expect(recordSetResultCommand.safeParse(command).success).toBe(true);
    expect(recordSetResultCommand.safeParse({ ...command, intent: { result: { ...result, reps: null } } }).success).toBe(false);
    expect(recordSetResultCommand.safeParse({ ...command, intent: { result: { ...result, reps: null, measurement: { kind: 'bodyweight', convention: 'bodyweightOnly' } } } }).success).toBe(false);
  });
  it('keeps original expected version and draft through background refresh, then requires explicit conflict recovery', async () => {
    const latest = { ...saved, version: 3 }; const refresh = vi.fn().mockResolvedValue([latest]);
    const fetch = vi.fn().mockImplementation((_url, init) => { const c = JSON.parse(init.body); return Promise.resolve(response({ replayed: false, outcomeCursor: '2', outcome: {
      status: 'Conflict', actionId: c.actionId, commandType: c.commandType, code: 'STALE_SET_RESULT' } }, 409)); }); vi.stubGlobal('fetch', fetch);
    const view = render(<SetResultRow {...props} saved={saved} refresh={refresh} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit result' }));
    fireEvent.change(screen.getByLabelText('Set 1 Actual reps'), { target: { value: '9' } });
    view.rerender(<SetResultRow {...props} saved={latest} refresh={refresh} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save correction' }));
    await screen.findByRole('button', { name: 'Review latest result' });
    expect(JSON.parse(fetch.mock.calls[0][1].body).expected.resultVersion).toBe(1);
    expect(screen.getByLabelText('Set 1 Actual reps')).toHaveValue('9');
    fireEvent.click(screen.getByRole('button', { name: 'Review latest result' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Use latest result for my correction' }));
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
    expect(screen.queryByRole('button', { name: 'Retry save' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Check saved results' })).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1); const body = fetch.mock.calls[0][1].body;
    finish(response({ malformed: true })); await waitFor(() => expect(screen.getByRole('button', { name: 'Retry save' })).toBeEnabled());
    view.unmount(); fetch.mockResolvedValueOnce(response(accepted(body)));
    render(<SetResultRow {...props} refresh={refresh} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Retry save' }));
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
    fireEvent.change(screen.getByLabelText('Set 1 Actual reps'), { target: { value: '1' } });
    view.rerender(<SetResultRow {...props} historical saved={latest} refresh={refresh} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save correction' }));
    await screen.findByText(/Result changed elsewhere/);
    expect(fetch.mock.calls[0][0]).toBe('/api/trainer2/executions/corrections');
    expect(JSON.parse(fetch.mock.calls[0][1].body).expected.resultVersion).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: 'Review latest result' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Use latest result for my correction' }));
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
    fireEvent.change(screen.getByLabelText('Set 1 Actual reps'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save correction' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Retry save' })).toBeEnabled());
    expect(screen.queryByText('Saved')).toBeNull();
    const body = fetch.mock.calls[0][1].body; view.unmount();
    fetch.mockResolvedValueOnce(response(accepted(body, 2)));
    render(<SetResultRow {...props} historical saved={{ ...saved, version: 5 }} refresh={refresh} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Retry save' }));
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
it('keeps compact catalog suggestions unrecorded and uses pounds without a picker', async () => {
  const position = createHypertrophyPlan().occurrences[0].positions[0];
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch); const blocked = vi.fn();
  render(<SetResultRow {...props} prescription={position.targets[0]} exercise={position.exercise} refresh={vi.fn()} onInputState={blocked} />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Record set' })).toBeDisabled());
  expect(screen.getByLabelText('Set 1 Actual load')).toHaveValue('');
  expect(screen.getByLabelText('Set 1 Actual reps')).toHaveValue('');
  expect(screen.queryByLabelText('Set 1 load unit')).toBeNull();
  expect(screen.getByLabelText('Set 1 actual load type')).toHaveValue('externalLoad');
  expect(fetch).not.toHaveBeenCalled(); expect(sessionStorage.length).toBe(0);
  expect(blocked).toHaveBeenLastCalledWith(props.targetId, false);
  fireEvent.change(screen.getByLabelText('Set 1 Actual reps'), { target: { value: '0' } });
  expect(screen.getByRole('button', { name: 'Record set' })).toBeEnabled();
  expect(blocked).toHaveBeenLastCalledWith(props.targetId, true);
  expect(JSON.parse(sessionStorage.getItem(`trainer2-result:${props.accountId}:${props.executionId}:${props.targetId}`)!).form.reps).toBe('0');
});
it('adds exact 2.5 lb steps only for machine-displayed loads', async () => {
  const position = createHypertrophyPlan().occurrences[0].positions[0];
  const prescription = { ...position.targets[0], measurement: { kind: 'externalLoad' as const, value: '40', unit: 'lb' as const,
    convention: 'machineDisplayed' as const, zeroMeaning: 'validZero' as const } };
  render(<SetResultRow {...props} activePanel prescription={prescription} exercise={position.exercise} refresh={vi.fn()} />);
  const load = await screen.findByLabelText('Set 1 Actual load');
  expect(load).toHaveValue('40');
  fireEvent.click(screen.getByRole('button', { name: 'Increase load by 2.5 lb' }));
  expect(load).toHaveValue('42.5');
  fireEvent.click(screen.getByRole('button', { name: 'Decrease load by 2.5 lb' }));
  expect(load).toHaveValue('40');
});
it('defaults a saved sparse machine result to machine-displayed controls without inventing a weight', async () => {
  const position = createHypertrophyPlan().occurrences.flatMap(o => o.positions).find(p => p.exercise.name === 'Machine Crunch')!;
  const sparse = { ...saved, result: { reps: null, measurement: null, rir: '3' } };
  render(<SetResultRow {...props} activePanel saved={sparse} prescription={{ ...position.targets[0], measurement: null }} exercise={position.exercise} refresh={vi.fn()} />);
  expect(await screen.findByText('Machine weight (lb)')).toBeVisible();
  expect(screen.getByLabelText('Set 1 Actual load')).toHaveValue('');
  expect(screen.getByLabelText('Set 1 actual load type')).toHaveValue('externalLoad');
  expect(screen.getByLabelText('Set 1 load basis')).toHaveValue('machineDisplayed');
  expect(screen.getByRole('button', { name: 'Increase load by 2.5 lb' })).toBeVisible();
});
it('updates an untouched retained sparse correction to the catalog machine controls', async () => {
  const position = createHypertrophyPlan().occurrences.flatMap(o => o.positions).find(p => p.exercise.name === 'Machine Crunch')!;
  const sparse = { ...saved, result: { reps: null, measurement: null, rir: '3' } };
  sessionStorage.setItem(`trainer2-result:${props.accountId}:${props.executionId}:${props.targetId}`, JSON.stringify({
    form: { reps: '', basis: 'total', load: '', kind: 'unspecified', unit: 'lb', zeroMeaning: 'validZero', convention: 'barbellTotal', rir: '3', reason: '' },
    base: sparse, pending: null, conflict: false,
  }));
  render(<SetResultRow {...props} activePanel saved={sparse} prescription={{ ...position.targets[0], measurement: null }} exercise={position.exercise} refresh={vi.fn()} />);
  expect(await screen.findByText('Machine weight (lb)')).toBeVisible();
  expect(screen.getByLabelText('Set 1 Actual load')).toHaveValue('');
});
it('does not guess a custom exercise load convention or a catalog unit', async () => {
  const position = createHypertrophyPlan().occurrences[0].positions[0];
  render(<SetResultRow {...props} prescription={position.targets[0]} exercise={{ kind: 'authoredDescription', name: 'Barbell squat', variation: '' }} refresh={vi.fn()} />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Record set' })).toBeDisabled());
  expect(screen.getByLabelText('Set 1 actual load type')).toHaveValue('unspecified');
  expect(screen.queryByLabelText('Set 1 Actual load')).toBeNull();
});

import { pounds, loadLabel } from './pound-display';
describe('Pounds and stable logging suggestions', () => {
  const position = createHypertrophyPlan().occurrences[0].positions[0];
  const prescription = { ...position.targets[0], reps: { min: 8, max: 8, basis: 'total' as const }, rir: '2',
    measurement: { kind: 'externalLoad' as const, value: '20', unit: 'kg' as const, convention: 'barbellTotal' as const, zeroMeaning: 'validZero' as const } };
  const ui = { ...props, activePanel: true, prescription, exercise: position.exercise };
  it('converts mass to two decimals while retaining bodyweight, zero and unspecified meaning', () => {
    expect(pounds('20', 'kg')).toBe('44.09'); expect(pounds('0', 'kg')).toBe('0');
    expect(pounds('140.125', 'lb')).toBe('140.125');
    expect(loadLabel(null)).toBe('load unspecified');
    expect(loadLabel({ kind: 'bodyweight', convention: 'bodyweightOnly' })).toBe('bodyweight');
    expect(loadLabel({ kind: 'assistance', convention: 'displayedAssistance', zeroMeaning: 'noAssistance', value: '20', unit: 'kg' }, true)).toBe('44.09 lb assistance (recorded 20 kg)');
  });
  it('refreshes untouched suggestions when preceding saves arrive, including remount', async () => {
    const blocked = vi.fn(), fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const view = render(<SetResultRow {...ui} refresh={vi.fn()} onInputState={blocked} />);
    await waitFor(() => expect(blocked).toHaveBeenLastCalledWith(props.targetId, false));
    expect(screen.getByLabelText('Set 1 Actual load')).toHaveValue('45');
    expect(screen.getByLabelText('Set 1 Actual reps')).toHaveValue('8');
    expect(screen.getByLabelText('Set 1 Actual RIR (optional)')).toHaveValue('2');
    const preceding = [{ ...saved, result: { reps: { value: 5, basis: 'total' as const }, measurement: prescription.measurement, rir: '0' } }];
    view.rerender(<SetResultRow {...ui} preceding={preceding} refresh={vi.fn()} onInputState={blocked} />);
    expect(screen.getByLabelText('Set 1 Actual reps')).toHaveValue('5');
    view.unmount(); render(<SetResultRow {...ui} preceding={preceding} refresh={vi.fn()} />);
    expect(await screen.findByLabelText('Set 1 Actual reps')).toHaveValue('5');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('uses compatible preceding actuals, preserves missing fields, and does not use incompatible load conventions', async () => {
    const prior = { ...saved, result: { reps: null, measurement: null, rir: null } };
    const view = render(<SetResultRow {...ui} preceding={[prior]} refresh={vi.fn()} />);
    await screen.findByRole('button', { name: 'Log set' });
    expect(screen.getByLabelText('Set 1 Actual reps')).toHaveValue('');
    expect(screen.getByLabelText('Set 1 Actual load')).toHaveValue('');
    expect(screen.getByLabelText('Set 1 Actual RIR (optional)')).toHaveValue('');
    view.unmount(); sessionStorage.clear();
    render(<SetResultRow {...ui} preceding={[{ ...saved, result: { ...result, measurement: { ...prescription.measurement, convention: 'perImplement' } } }]} refresh={vi.fn()} />);
    expect(await screen.findByLabelText('Set 1 Actual load')).toHaveValue('45');
    expect(screen.getByLabelText('Set 1 Actual reps')).toHaveValue('8');
  });
  it('leaves ranged reps and absent mass blank; untouched saved kg creates no correction and rep-only correction retains kg bytes', async () => {
    const kg = { ...saved, result: { reps: { value: 8, basis: 'total' as const }, measurement: { ...prescription.measurement, value: '20.000000' }, rir: '2' } };
    const fetch = vi.fn().mockImplementation((_url, init) => Promise.resolve(response(accepted(init.body, 2)))); vi.stubGlobal('fetch', fetch);
    const view = render(<SetResultRow {...ui} saved={kg} refresh={vi.fn().mockResolvedValue([{ ...kg, version: 2 }])} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Update set' }));
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Set 1 Actual reps'), { target: { value: '9' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update set' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetch.mock.calls[0][1].body).intent.result.measurement).toEqual(kg.result.measurement);
    view.unmount(); sessionStorage.clear();
    render(<SetResultRow {...ui} prescription={{ ...prescription, reps: { ...prescription.reps, max: 12 }, measurement: null }} refresh={vi.fn()} />);
    expect(await screen.findByLabelText('Set 1 Actual load')).toHaveValue('');
    expect(screen.getByLabelText('Set 1 Actual reps')).toHaveValue('');
  });
});
it('upgrades retained unitless mass drafts to pounds without losing typed values or original binding', async () => {
  const position = createHypertrophyPlan().occurrences[0].positions[0];
  sessionStorage.setItem(`trainer2-result:${props.accountId}:${props.executionId}:${props.targetId}`, JSON.stringify({
    form: { reps: '8', basis: 'total', load: '140', kind: 'externalLoad', unit: '', zeroMeaning: 'validZero', convention: 'barbellTotal', rir: '', reason: '' },
    base: null, pending: null, conflict: false,
  }));
  const fetch = vi.fn().mockResolvedValue(response({ malformed: true })); vi.stubGlobal('fetch', fetch);
  render(<SetResultRow {...props} activePanel prescription={position.targets[0]} exercise={position.exercise} refresh={vi.fn()} />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Log set' })).toBeEnabled());
  expect(screen.getByLabelText('Set 1 Actual load')).toHaveValue('140');
  fireEvent.click(screen.getByRole('button', { name: 'Log set' }));
  expect(JSON.parse(fetch.mock.calls[0][1].body).intent.result.measurement).toMatchObject({ value: '140', unit: 'lb', kind: 'externalLoad' });
  await screen.findByRole('button', { name: 'Retry save' });
});

import { startingPounds, sameLoggingExercise, compatibleLoggingLoad } from '@/lib/engine/trainer2/logging-prefill';
describe('Logger correction regressions', () => {
  const p = createHypertrophyPlan().occurrences[0].positions[0];
  const m = { kind: 'externalLoad' as const, value: '60', unit: 'kg' as const, convention: 'barbellTotal' as const, zeroMeaning: 'validZero' as const };
  const target = { ...p.targets[0], measurement: m, reps: { min: 8, max: 8, basis: 'total' as const }, rir: '3' };
  const ui = { ...props, activePanel: true, prescription: target, exercise: p.exercise, refresh: vi.fn() };
  const prior = { ...saved, result: { reps: { value: 9, basis: 'total' as const }, measurement: { ...m, value: '137.125', unit: 'lb' as const }, rir: '0' } };
  it('rounds only initial suggestions, including positive ties and zero', () => {
    expect(startingPounds(m)).toBe('130');
    expect(startingPounds({ ...m, value: '132.5', unit: 'lb' })).toBe('135');
    expect(startingPounds({ ...m, value: '0' })).toBe('0');
    expect(startingPounds({ kind: 'bodyweight', convention: 'bodyweightOnly' })).toBeNull();
    expect(sameLoggingExercise(p.exercise, { kind: 'authoredDescription', name: p.exercise.name, variation: '' })).toBe(false);
    if (p.exercise.kind === 'catalogSnapshot') {
      expect(sameLoggingExercise(p.exercise, { ...p.exercise, name: 'Display rename' })).toBe(true);
      expect(sameLoggingExercise(p.exercise, { ...p.exercise, equipment: ['Different machine'] })).toBe(false);
    }
    expect(compatibleLoggingLoad({ ...m, convention: 'perImplement' }, target, p.exercise)).toBe(false);
  });
  it('updates an untouched pre-mounted form but preserves deliberate clearing and typing', async () => {
    const view = render(<SetResultRow {...ui} number={2} preceding={[]} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Log set' })).toBeEnabled());
    expect(screen.getByLabelText('Set 2 Actual load')).toHaveValue('');
    view.rerender(<SetResultRow {...ui} number={2} preceding={[prior]} />);
    expect(screen.getByLabelText('Set 2 Actual load')).toHaveValue('137.125');
    expect(screen.getByLabelText('Set 2 Actual reps')).toHaveValue('9');
    fireEvent.change(screen.getByLabelText('Set 2 Actual load'), { target: { value: '' } });
    view.rerender(<SetResultRow {...ui} number={2} preceding={[{ ...prior, version: 2, result: { ...prior.result, rir: '4' } }]} />);
    expect(screen.getByLabelText('Set 2 Actual load')).toHaveValue('');
    expect(screen.getByLabelText('Set 2 Actual RIR (optional)')).toHaveValue('0');
  });
  it('refreshes saved values/action over an old untouched suggestion, but keeps a stale user draft', async () => {
    const view = render(<SetResultRow {...ui} />);
    await screen.findByRole('button', { name: 'Log set' });
    expect(screen.getByLabelText('Set 1 Actual load')).toHaveValue('130');
    view.rerender(<SetResultRow {...ui} saved={{ ...saved, result: { measurement: null, reps: null, rir: '3' } }} />);
    expect(screen.getByRole('button', { name: 'Update set' })).toBeEnabled();
    expect(screen.getByLabelText('Set 1 Actual reps')).toHaveValue('');
    expect(screen.getByLabelText('Set 1 Actual load')).toHaveValue('');
    fireEvent.change(screen.getByLabelText('Set 1 Actual reps'), { target: { value: '11' } });
    view.rerender(<SetResultRow {...ui} saved={{ ...prior, version: 2 }} />);
    expect(screen.getByLabelText('Set 1 Actual reps')).toHaveValue('11');
  });
  it('prefers prescription over history; history only supplies first-set weight; blank decrement is not zero', async () => {
    const view = render(<SetResultRow {...ui} firstSetLoad={prior} />);
    await screen.findByRole('button', { name: 'Log set' });
    expect(screen.getByLabelText('Set 1 Actual load')).toHaveValue('130');
    view.rerender(<SetResultRow {...ui} prescription={{ ...target, measurement: null, reps: { ...target.reps, max: 10 } }} firstSetLoad={prior} />);
    expect(screen.getByLabelText('Set 1 Actual load')).toHaveValue('135');
    expect(screen.getByLabelText('Set 1 Actual reps')).toHaveValue('');
    expect(screen.getByLabelText('Set 1 Actual RIR (optional)')).toHaveValue('3');
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    fireEvent.click(screen.getByRole('button', { name: 'Decrease load by 10 lb' }));
    expect(screen.getByLabelText('Set 1 Actual load')).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: '4 RIR' }));
    expect(screen.getByLabelText('Set 1 Actual RIR (optional)')).toHaveValue('4');
    fireEvent.click(screen.getByRole('button', { name: 'Decrease RIR by 0.5' }));
    expect(screen.getByLabelText('Set 1 Actual RIR (optional)')).toHaveValue('3.5');
    fireEvent.click(screen.getByRole('button', { name: 'Increase RIR by 0.5' }));
    expect(screen.getByLabelText('Set 1 Actual RIR (optional)')).toHaveValue('4');
    fireEvent.click(screen.getByRole('button', { name: '0 RIR' }));
    fireEvent.click(screen.getByRole('button', { name: 'Decrease RIR by 0.5' }));
    expect(screen.getByLabelText('Set 1 Actual RIR (optional)')).toHaveValue('0');
  });
  it('does not skip an incompatible preceding result for an older compatible result', async () => {
    render(<SetResultRow {...ui} number={3} preceding={[{ ...prior, result: { ...prior.result, measurement: { ...m, convention: 'perImplement' } } }, prior]} />);
    expect(await screen.findByLabelText('Set 3 Actual load')).toHaveValue('');
  });
  it('keeps exact kg actuals internally when carrying forward and changing only reps', async () => {
    const kg = { ...prior, result: { ...prior.result, measurement: { ...m, value: '60.123456' } } };
    const fetch = vi.fn().mockResolvedValue(response({ malformed: true })); vi.stubGlobal('fetch', fetch);
    render(<SetResultRow {...ui} number={2} preceding={[kg]} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Log set' })).toBeEnabled());
    fireEvent.change(screen.getByLabelText('Set 2 Actual reps'), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Log set' }));
    expect(JSON.parse(fetch.mock.calls[0][1].body).intent.result.measurement).toEqual(kg.result.measurement);
  });
  it('confirms edited input before skipping, preserves cancellation and retries the exact skip', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const fetch = vi.fn().mockRejectedValue(new Error('uncertain')); vi.stubGlobal('fetch', fetch);
    render(<SetResultRow {...ui} refreshExecution={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Skip set' })).toBeEnabled());
    fireEvent.change(screen.getByLabelText('Set 1 Actual reps'), { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Skip set' }));
    expect(fetch).not.toHaveBeenCalled(); expect(screen.getByLabelText('Set 1 Actual reps')).toHaveValue('12');
    confirm.mockReturnValue(true); fireEvent.click(screen.getByRole('button', { name: 'Skip set' }));
    await screen.findByText(/Skip could not be confirmed/);
    const command = JSON.parse(fetch.mock.calls[0][1].body);
    expect(command.commandType).toBe('SkipSet'); expect(command.intent).toEqual({});
    expect(command.target).toEqual({ executionId: props.executionId, targetId: props.targetId });
    fireEvent.click(screen.getByRole('button', { name: 'Retry save' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(fetch.mock.calls[1][1].body).toBe(fetch.mock.calls[0][1].body); confirm.mockRestore();
  });
  it('requires explicit reopening, binds the skip event, and never offers skip on recorded sets', async () => {
    const skipped = { executionId: props.executionId, targetId: props.targetId, actionId: randomUUID(), skippedAt: new Date().toISOString() };
    const fetch = vi.fn().mockRejectedValue(new Error('uncertain')); vi.stubGlobal('fetch', fetch);
    const view = render(<SetResultRow {...ui} skipped={skipped} />);
    expect(screen.queryByRole('button', { name: 'Log set' })).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: 'Log this set' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Log set' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Log set' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetch.mock.calls[0][1].body).expected.skipActionId).toBe(skipped.actionId);
    view.unmount(); sessionStorage.clear(); render(<SetResultRow {...ui} saved={saved} />);
    expect(screen.queryByRole('button', { name: 'Skip set' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Return to active set' })).toBeVisible();
  });
  it('allows absent correction reasons, rejects blank provided reasons and keeps clear reason mandatory', () => {
    const c = { schemaVersion: 1, actionId: randomUUID(), deviceId: randomUUID(), originatingAccountId: props.accountId, ownershipEpoch: 0, dependsOn: [], target: { executionId: props.executionId, targetId: props.targetId }, expected: { resultVersion: 1, performedSetId: saved.performedSetId } };
    for (const commandType of ['CorrectSetResult', 'CorrectHistoricalSetResult']) {
      expect(resultMutationCommand.safeParse({ ...c, commandType, intent: { result } }).success).toBe(true);
      expect(resultMutationCommand.safeParse({ ...c, commandType, intent: { result, reason: '' } }).success).toBe(false);
      expect(resultMutationCommand.safeParse({ ...c, commandType, intent: { result: null } }).success).toBe(false);
    }
    expect(resultMutationCommand.safeParse({ ...c, commandType: 'CorrectSetResult', intent: { result: null, reason: 'Erroneous entry' } }).success).toBe(true);
  });
});
