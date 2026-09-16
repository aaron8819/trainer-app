import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID, webcrypto } from 'node:crypto';
import { Workout, WorkoutPrescription } from './Workout';
import { createHypertrophyPlan } from '@/lib/engine/trainer2/plan-builder';

const accountId = 'synthetic-workout-account';
const planId = randomUUID(), revisionId = randomUUID();
const occurrence = createHypertrophyPlan().occurrences[0];
const next = { acceptedSequence: '2', occurrences: [{ occurrenceId: occurrence.id, name: occurrence.name, stageName: 'Week 1', status: 'Pending', skip: null }], accountId, planId, revisionId, instructionEpoch: 0, lifecycle: 'Active' as const, occurrence, execution: null };
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
beforeEach(() => { sessionStorage.clear(); vi.stubGlobal('crypto', webcrypto); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe('Workout start consumer', () => {
  it('only reads on mount and previews without starting', async () => {
    const fetch = vi.fn().mockResolvedValue(response(next)); vi.stubGlobal('fetch', fetch);
    render(<Workout accountId={accountId} ownershipEpoch={0} planId={planId} />);
    await screen.findByRole('button', { name: 'Start workout' }); expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][1]).toEqual({ cache: 'no-store' });
  });
  it('rejects a malformed next response instead of reporting a false endpoint', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ ...next, occurrence: null })));
    render(<Workout accountId={accountId} ownershipEpoch={0} planId={planId} />);
    await screen.findByRole('button', { name: 'Reload workout' });
    expect(screen.queryByText('Plan complete')).not.toBeInTheDocument();
  });
  it('retains the exact uncertain command across remount and blocks repeated clicks', async () => {
    let finish!: (v: Response) => void;
    const fetch = vi.fn().mockResolvedValueOnce(response(next)).mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; })); vi.stubGlobal('fetch', fetch);
    const first = render(<Workout accountId={accountId} ownershipEpoch={0} planId={planId} />);
    const startButton = await screen.findByRole('button', { name: 'Start workout' }); await waitFor(() => expect(startButton).toBeEnabled()); fireEvent.click(startButton);
    const check = await screen.findByRole('button', { name: 'Check again' }); fireEvent.click(check); expect(fetch).toHaveBeenCalledTimes(2);
    const command = fetch.mock.calls[1][1].body;
    finish(response({ invalid: 'response' })); await waitFor(() => expect(check).not.toBeDisabled());
    expect(sessionStorage.getItem(`trainer2-start:${accountId}:${planId}`)).toBe(command);
    first.unmount(); fetch.mockResolvedValueOnce(response({ error: 'temporary' }, 503));
    render(<Workout accountId={accountId} ownershipEpoch={0} planId={planId} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Check again' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3)); expect(fetch.mock.calls[2][1].body).toBe(command);
    expect(screen.queryByText('Workout in progress')).not.toBeInTheDocument();
  });
  it('ignores delayed response after switching plans', async () => {
    let finish!: (v: Response) => void;
    const fetch = vi.fn().mockResolvedValueOnce(response(next)).mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; })); vi.stubGlobal('fetch', fetch);
    const view = render(<Workout key={planId} accountId={accountId} ownershipEpoch={0} planId={planId} />);
    const startButton = await screen.findByRole('button', { name: 'Start workout' }); await waitFor(() => expect(startButton).toBeEnabled()); fireEvent.click(startButton);
    const other = randomUUID(); fetch.mockResolvedValueOnce(response({ ...next, planId: other, occurrence: { ...occurrence, name: 'Other workout' } }));
    view.rerender(<Workout key={other} accountId={accountId} ownershipEpoch={0} planId={other} />);
    await screen.findByRole('heading', { name: 'Other workout' });
    finish(response({ outcome: { status: 'Accepted' } })); await waitFor(() => expect(screen.queryByText(/could not be confirmed/)).not.toBeInTheDocument());
    expect(sessionStorage.getItem(`trainer2-start:${accountId}:${planId}`)).not.toBeNull();
  });
  it('renders valid zero, optional per-side work and unspecified values distinctly', () => {
    const workout = structuredClone(occurrence); workout.positions = [workout.positions[0]];
    workout.positions[0].targets = [{ ...workout.positions[0].targets[0], required: false, classification: 'optionalFinisher',
      reps: { min: 5, max: 8, basis: 'perSide' }, measurement: { kind: 'addedLoad', value: '0.00', unit: 'lb', convention: 'addedExternal', zeroMeaning: 'noAddedLoad' }, rir: '0', restSeconds: null }];
    render(<WorkoutPrescription workout={workout} />);
    expect(screen.getByText(/0.00 lb added/)).toBeInTheDocument(); expect(screen.getByText(/per side/)).toBeInTheDocument(); expect(screen.getByText(/Optional/)).toBeInTheDocument(); expect(screen.queryByText(/Rest unspecified/)).not.toBeInTheDocument();
  });
});
import { TrainingOverview } from './TrainingOverview';
import { effortSummary, targetGroups } from './training-summary';

it('shows program position and mixed effort without treating skipped work as performed', () => {
  const document = createHypertrophyPlan();
  const selected = document.occurrences[4];
  selected.positions[0].targets[0].rir = '0';
  const read = { ...next, occurrence: selected, occurrences: document.occurrences.map((o, i) => ({ occurrenceId: o.id, name: o.name, stageName: document.stages.find(s => s.id === o.stageId)!.name, status: i < 3 ? 'Finished' as const : i === 3 ? 'Skipped' as const : 'Pending' as const, skip: null })) };
  render(<TrainingOverview document={document} next={read} />);
  expect(screen.getByText('Week 2 of 5 · Accumulation')).toBeVisible();
  expect(screen.getByText(/Target 0–3 RIR/)).toBeVisible();
  expect(screen.getByRole('heading', { name: /0 of 4 workouts completed · 0 skipped/ })).toBeVisible();
  expect(screen.getAllByRole('article')).toHaveLength(4);
  expect(screen.getByRole('link', { name: 'View Program' })).toHaveAttribute('href', expect.stringContaining('view=program'));
});
it('does not collapse unlike targets, units, roles, zero or per-side counts', () => {
  const target = occurrence.positions[0].targets[0];
  const copy = { ...target, id: randomUUID() };
  expect(targetGroups([target, copy])).toHaveLength(1);
  for (const changed of [{ ...copy, rir: '0' }, { ...copy, required: false }, { ...copy, classification: 'rampUp' as const }, { ...copy, restSeconds: '0' }, { ...copy, reps: { ...copy.reps, basis: 'perSide' as const } }, { ...copy, measurement: { kind: 'externalLoad' as const, value: '0', unit: 'lb' as const, convention: 'barbellTotal' as const, zeroMeaning: 'validZero' as const } }]) expect(targetGroups([target, changed])).toHaveLength(2);
  expect(effortSummary({ ...occurrence, positions: [{ ...occurrence.positions[0], targets: [{ ...target, rir: null }] }] })).toBe('Effort not prescribed');
});
it('supports independent workouts and truthful final completion with skipped work', () => {
  const document = createHypertrophyPlan(); delete document.builder;
  document.stages = document.stages.slice(0, 2); document.occurrences = [document.occurrences[0], document.occurrences[4]];
  const read = { ...next, lifecycle: 'Completed' as const, occurrence: null, occurrences: document.occurrences.map((o, i) => ({ occurrenceId: o.id, name: 'Same name', stageName: 'Same stage', status: i ? 'Skipped' as const : 'Finished' as const, skip: null })) };
  render(<TrainingOverview document={document} next={read} program />);
  expect(screen.getAllByText(/1 workouts completed · 1 skipped/).length).toBeGreaterThan(0);
  expect(screen.getAllByRole('article')).toHaveLength(2);
  expect(screen.queryByRole('button', { name: 'Start workout' })).toBeNull();
});

import { useCallback, useState } from 'react';
import { ActiveWorkout } from './ActiveWorkout';
import type { ExecutionRead } from '@/lib/trainer2-contracts/execution';
import type { SavedSetResult } from '@/lib/trainer2-contracts/set-results';
function activeFixture() {
  const workout = structuredClone(occurrence);
  workout.positions = workout.positions.slice(0, 2);
  workout.positions.forEach(p => { p.targets = p.targets.slice(0, 2); });
  workout.positions[1].exercise.name = workout.positions[0].exercise.name;
  workout.positions[1].role = 'Accessory';
  workout.positions[0].targets[1].rir = '0';
  return { executionId: randomUUID(), lifecycle: 'Open', results: [], initial: { accountId, occurrence: workout,
    positions: workout.positions.map(p => ({ id: randomUUID(), sourcePositionId: p.id, targets: p.targets.map(t => ({ id: randomUUID(), sourceTargetId: t.id })) })) } } as unknown as ExecutionRead;
}
function ActiveHarness({ value, read }: { value: ExecutionRead; read: () => Promise<SavedSetResult[]> }) {
  const [execution, setExecution] = useState(value);
  const [inputs, setInputs] = useState<Record<string, boolean>>({});
  const input = useCallback((id: string, blocked: boolean) => setInputs(v => v[id] === blocked ? v : { ...v, [id]: blocked }), []);
  return <ActiveWorkout execution={execution} ownershipEpoch={0} locked={false} inputStates={inputs} onInputState={input} refresh={async () => { const results = await read(); setExecution(v => ({ ...v, results })); return results; }} />;
}
function activeTransport(results: SavedSetResult[]) {
  return vi.fn().mockImplementation((_url, init) => {
    const c = JSON.parse(init.body);
    const saved = { executionId: c.target.executionId, targetId: c.target.targetId, performedSetId: c.expected.performedSetId ?? randomUUID(), version: c.expected.resultVersion + 1,
      actionId: c.actionId, recordedAt: new Date().toISOString(), reason: c.intent.reason ?? null, result: c.intent.result };
    results.push(saved);
    return response({ replayed: false, outcomeCursor: '1', outcome: { status: 'Accepted', actionId: c.actionId, commandType: c.commandType, acceptedSequence: '1', result: { executionId: saved.executionId, targetId: saved.targetId, performedSetId: saved.performedSetId, version: saved.version } } });
  });
}
describe('Single active set and queue', () => {
  it('renders one editor, preserves drafts by identity, and restores selection on remount', async () => {
    const value = activeFixture(), read = vi.fn().mockResolvedValue([]);
    const view = render(<ActiveHarness value={value} read={read} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Log set' })).toBeEnabled());
    expect(screen.getAllByLabelText(/Actual reps/)).toHaveLength(1);
    fireEvent.change(screen.getByLabelText('Set 1 Actual reps'), { target: { value: '7' } });
    const chips = screen.getAllByRole('button', { name: /, set 2, unrecorded/ });
    fireEvent.click(chips[0]);
    expect(screen.getByText(/Starting target.*0 RIR/)).toBeVisible();
    fireEvent.change(screen.getByLabelText('Set 2 Actual reps'), { target: { value: '0' } });
    fireEvent.click(screen.getAllByRole('button', { name: /, set 1, unrecorded/ })[0]);
    expect(screen.getByLabelText('Set 1 Actual reps')).toHaveValue('7');
    view.unmount();
    render(<ActiveHarness value={value} read={read} />);
    await waitFor(() => expect(screen.getByLabelText('Set 1 Actual reps')).toHaveValue('7'));
    fireEvent.click(screen.getAllByRole('button', { name: /, set 2, unrecorded/ })[0]);
    expect(screen.getByLabelText('Set 2 Actual reps')).toHaveValue('0');
    expect(read).not.toHaveBeenCalled();
  });
  it('advances only after confirmed readback, across duplicate-name exercise identities', async () => {
    const value = activeFixture(), results: SavedSetResult[] = [];
    const fetch = activeTransport(results); vi.stubGlobal('fetch', fetch);
    let confirm!: (v: SavedSetResult[]) => void;
    const read = vi.fn().mockImplementationOnce(() => new Promise<SavedSetResult[]>(r => { confirm = r; })).mockImplementation(() => Promise.resolve([...results]));
    render(<ActiveHarness value={value} read={read} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Log set' })).toBeEnabled());
    fireEvent.change(screen.getByLabelText('Set 1 Actual reps'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Log set' }));
    await waitFor(() => expect(read).toHaveBeenCalled());
    expect(screen.getByLabelText('Set 1 Actual reps')).toBeInTheDocument();
    confirm([...results]);
    await screen.findByLabelText('Set 2 Actual reps');
    fireEvent.change(screen.getByLabelText('Set 2 Actual reps'), { target: { value: '8' } });
    fireEvent.click(screen.getByRole('button', { name: 'Log set' }));
    await screen.findByText('Accessory · Set 1 of 2');
    expect(results.map(r => r.targetId)).toEqual(value.initial.positions[0].targets.map(t => t.id));
    expect(screen.getByText('2 of 4 sets recorded')).toBeVisible();
  });
  it.each([false, true])('does not pull selection back after a late response (return to original: %s)', async (returnToOriginal) => {
    const value = activeFixture(), results: SavedSetResult[] = [], transport = activeTransport(results);
    let reply!: () => void;
    vi.stubGlobal('fetch', vi.fn().mockImplementation((...args) => new Promise<Response>(resolve => { reply = () => resolve(transport(...args)); })));
    render(<ActiveHarness value={value} read={async () => [...results]} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Log set' })).toBeEnabled());
    fireEvent.change(screen.getByLabelText('Set 1 Actual reps'), { target: { value: '8' } });
    fireEvent.click(screen.getByRole('button', { name: 'Log set' }));
    fireEvent.click(screen.getAllByRole('button', { name: /, set 2, unrecorded/ })[1]);
    fireEvent.change(screen.getByLabelText('Set 2 Actual reps'), { target: { value: '11' } });
    if (returnToOriginal) fireEvent.click(screen.getAllByRole('button', { name: /, set 1, unrecorded/ })[0]);
    reply();
    await screen.findByText('1 of 4 sets recorded');
    if (returnToOriginal) expect(screen.getByRole('button', { name: /, set 1, recorded/ })).toHaveAttribute('aria-pressed', 'true');
    else expect(screen.getByLabelText('Set 2 Actual reps')).toHaveValue('11');
    expect(results[0].targetId).toBe(value.initial.positions[0].targets[0].id);
  });
  it('adjusts explicit zero and units without saving, with optional RIR distinct from RPE', async () => {
    const value = activeFixture();
    render(<ActiveHarness value={value} read={async () => []} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Log set' })).toBeEnabled());
    fireEvent.change(screen.getByLabelText('Set 1 load unit'), { target: { value: 'kg' } });
    fireEvent.click(screen.getByRole('button', { name: 'Increase load by 2.5 kg' }));
    expect(screen.getByLabelText('Set 1 Actual load')).toHaveValue('2.5');
    fireEvent.click(screen.getByRole('button', { name: 'Decrease load by 2.5 kg' }));
    expect(screen.getByLabelText('Set 1 Actual load')).toHaveValue('0');
    fireEvent.click(screen.getByRole('button', { name: '0 RIR' }));
    expect(screen.getByLabelText('Set 1 Actual RIR (optional)')).toHaveValue('0');
    fireEvent.change(screen.getByLabelText('Set 1 Actual RIR (optional)'), { target: { value: '' } });
    expect(screen.getByLabelText('Set 1 Actual RIR (optional)')).toHaveValue('');
    expect(screen.getByText('0 of 4 sets recorded')).toBeVisible();
  });
});


import { createHash } from 'node:crypto';
import { canonicalJson } from '@/lib/trainer2-contracts/canonical-json';
it('integrates one active panel with finish controls across input-state updates', async () => {
  const value = { ...activeFixture(), finish: null }, document = createHypertrophyPlan();
  const digest = (v: unknown) => createHash('sha256').update(canonicalJson(v)).digest('hex');
  const instructions = { version: 1, restrictions: [], exceptions: [] };
  value.initial = { ...value.initial, schemaVersion: 1, kind: 'START', provenance: 'VERIFIED_START', policyVersion: 'trainer2-start-v1',
    executionId: value.executionId, planId, revisionId, sourceContentHash: 'a'.repeat(64), startedAt: new Date().toISOString(),
    stage: { id: value.initial.occurrence.stageId, name: 'Week 1' }, progression: document.progression,
    instructions: { epoch: 0, revisionId: null, contentHash: digest(instructions), document: instructions } } as ExecutionRead['initial'];
  value.contentHash = digest(value.initial);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(value)));
  render(<Workout accountId={accountId} ownershipEpoch={0} executionId={value.executionId} />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Finish workout' })).toBeEnabled());
  fireEvent.change(screen.getByLabelText('Set 1 Actual reps'), { target: { value: '8' } });
  expect(screen.getAllByRole('region', { name: 'Active set' })).toHaveLength(1);
  expect(screen.getAllByLabelText(/Actual reps/)).toHaveLength(1);
  expect(screen.getByRole('button', { name: 'Finish workout' })).toBeDisabled();
});
