import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID, webcrypto } from 'node:crypto';
import { mergeExecutionRead, Workout, WorkoutPrescription } from './Workout';
import { ExerciseSwapHistory } from './ExerciseSwapHistory';
import { AddSet } from './AddSet';
import { replacementContent } from '@/lib/engine/trainer2/exercise-swap';
import { catalog } from '@/lib/engine/trainer2/catalog';
import { createHypertrophyPlan } from '@/lib/engine/trainer2/plan-builder';

const accountId = 'synthetic-workout-account';
const planId = randomUUID(), revisionId = randomUUID();
const occurrence = createHypertrophyPlan().occurrences[0];
const next = { acceptedSequence: '2', occurrences: [{ occurrenceId: occurrence.id, name: occurrence.name, stageName: 'Week 1', status: 'Pending', skip: null }], accountId, planId, revisionId, instructionEpoch: 0, lifecycle: 'Active' as const, occurrence, execution: null };
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
beforeEach(() => { vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true }))); vi.stubGlobal('scrollBy', vi.fn()); localStorage.clear(); sessionStorage.clear(); vi.stubGlobal('crypto', webcrypto); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe('Add set recovery', () => {
  it('retains an uncertain exact addition across reload and recovers after closure', async () => {
    const x = activeFixture(), positionId = x.initial.positions[0].id;
    const refresh = vi.fn(), onAdded = vi.fn();
    const fetch = vi.fn().mockResolvedValue(response({ malformed: true })); vi.stubGlobal('fetch',fetch);
    const view = render(<AddSet execution={x} positionId={positionId} ownershipEpoch={0} locked={false} refresh={refresh} onAdded={onAdded} />);
    await waitFor(() => expect(screen.getByRole('button',{name:'+ Add set'})).toBeEnabled());
    fireEvent.click(screen.getByRole('button',{name:'+ Add set'}));
    await waitFor(() => expect(screen.getByRole('button',{name:'Check addition again'})).toBeEnabled());
    const body = fetch.mock.calls[0][1].body, command = JSON.parse(body), targetId = randomUUID();
    view.unmount();
    fetch.mockResolvedValue(response({replayed:true,outcomeCursor:'1',outcome:{status:'Accepted',actionId:command.actionId,commandType:'AddSet',acceptedSequence:'1',result:{executionId:x.executionId,positionId,targetId,ordinal:3,contentHash:'b'.repeat(64)}}}));
    const closed = {...x,lifecycle:'Finished' as const,additions:[{actionId:command.actionId,contentHash:'b'.repeat(64),content:{target:{id:targetId},ordinal:3}}]} as ExecutionRead;
    refresh.mockResolvedValue(closed);
    render(<AddSet execution={closed} positionId={positionId} ownershipEpoch={0} locked refresh={refresh} onAdded={onAdded} />);
    fireEvent.click(await screen.findByRole('button',{name:'Check addition again'}));
    await waitFor(() => expect(screen.queryByRole('button',{name:'Check addition again'})).toBeNull());
    expect(fetch.mock.calls[1][1].body).toBe(body);expect(onAdded).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(`trainer2-add-set:${accountId}:${x.executionId}:${positionId}`)).toBeNull();
  });
  it('does not announce or select an addition until authoritative readback confirms it', async () => {
    const x=activeFixture(),positionId=x.initial.positions[0].id,onAdded=vi.fn();
    const fetch=vi.fn().mockImplementation((_url,init)=>{const c=JSON.parse(init.body);return Promise.resolve(response({replayed:false,outcomeCursor:'1',outcome:{status:'Accepted',actionId:c.actionId,commandType:'AddSet',acceptedSequence:'1',result:{executionId:x.executionId,positionId,targetId:randomUUID(),ordinal:3,contentHash:'b'.repeat(64)}}}));});
    vi.stubGlobal('fetch',fetch);
    render(<AddSet execution={x} positionId={positionId} ownershipEpoch={0} locked={false} refresh={async()=>x} onAdded={onAdded} />);
    await waitFor(()=>expect(screen.getByRole('button',{name:'+ Add set'})).toBeEnabled());fireEvent.click(screen.getByRole('button',{name:'+ Add set'}));
    await waitFor(()=>expect(screen.getByRole('button',{name:'Check addition again'})).toBeEnabled());expect(onAdded).not.toHaveBeenCalled();
  });
});
describe('Workout start consumer', () => {
  it.each(['foreign', 'duplicate', 'missing recommendation'])('fails closed on %s eligibility in the read response', async variant => {
    const eligibleOccurrenceIds = variant === 'foreign' ? [occurrence.id, randomUUID()] : variant === 'duplicate' ? [occurrence.id, occurrence.id] : [];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ ...next, eligibleOccurrenceIds })));
    render(<Workout accountId={accountId} ownershipEpoch={0} planId={planId} />);
    await screen.findByRole('button', { name: 'Reload workout' });
    expect(screen.queryByRole('button', { name: 'Start workout' })).not.toBeInTheDocument();
  });
  it('selects a later same-name workout without writing and starts its exact UUID', async () => {
    const document = createHypertrophyPlan(); document.occurrences[1].name = document.occurrences[0].name;
    const value = { ...next, occurrence: document.occurrences[0], eligibleOccurrenceIds: document.occurrences.slice(0, 4).map(o => o.id),
      occurrences: document.occurrences.map(o => ({ occurrenceId: o.id, name: o.name, stageName: 'Week', status: 'Pending', skip: null })) };
    const fetch = vi.fn().mockResolvedValueOnce(response(value)).mockResolvedValueOnce(response({ invalid: true })); vi.stubGlobal('fetch', fetch);
    const { container } = render(<Workout accountId={accountId} ownershipEpoch={0} planId={planId} document={document} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Start workout' })).toBeEnabled());
    const card = container.querySelector(`[data-occurrence-id="${document.occurrences[1].id}"]`)!;
    fireEvent.click(within(card as HTMLElement).getByRole('button'));
    expect(within(card as HTMLElement).getByRole('button')).toHaveAttribute('aria-pressed', 'true'); expect(fetch).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Start workout' }));
    await screen.findByRole('button', { name: 'Check again' });
    expect(JSON.parse(fetch.mock.calls[1][1].body).target).toEqual({ planId, occurrenceId: document.occurrences[1].id });
  });
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
    first.unmount(); fetch.mockResolvedValueOnce(response(next)).mockResolvedValueOnce(response({ error: 'temporary' }, 503));
    render(<Workout accountId={accountId} ownershipEpoch={0} planId={planId} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Check again' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(4)); expect(fetch.mock.calls[2][1]).toEqual({ cache: 'no-store' }); expect(fetch.mock.calls[3][1].body).toBe(command);
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
import { TrainingOverview, PlannedWorkout } from './TrainingOverview';
import { effortSummary, targetGroups } from './training-summary';

it('shows program position and mixed effort without treating skipped work as performed', () => {
  const document = createHypertrophyPlan();
  const selected = document.occurrences[4];
  selected.positions[0].targets[0].rir = '0';
  const read = { ...next, occurrence: selected, occurrences: document.occurrences.map((o, i) => ({ occurrenceId: o.id, name: o.name, stageName: document.stages.find(s => s.id === o.stageId)!.name, status: i < 3 ? 'Finished' as const : i === 3 ? 'Skipped' as const : 'Pending' as const, skip: null })) };
  render(<TrainingOverview document={document} next={read} />);
  expect(screen.getByRole('heading', { name: 'Week 2 of 5' })).toBeVisible();
  expect(screen.getByText(/Target 0–3 RIR/)).toBeVisible();
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
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
  const document = createHypertrophyPlan(); delete document.builder; document.occurrences.forEach(o => { delete o.workoutKey; delete o.weekOverride; delete o.overrides; o.positions.forEach(p => { delete p.sourceKey; }); });
  document.stages = document.stages.slice(0, 2); document.occurrences = [document.occurrences[0], document.occurrences[4]];
  const read = { ...next, lifecycle: 'Completed' as const, occurrence: null, occurrences: document.occurrences.map((o, i) => ({ occurrenceId: o.id, name: 'Same name', stageName: 'Same stage', status: i ? 'Skipped' as const : 'Finished' as const, skip: null })) };
  render(<TrainingOverview document={document} next={read} program />);
  expect(screen.getByText(/Saved.*Completed.*read-only/)).toBeVisible();
  expect(screen.getByRole('heading', { name: 'Week 2 workouts' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: /^Week 1/ }));
  fireEvent.click(screen.getByText(document.occurrences[0].name, { selector: 'summary' }));
  expect(screen.getByText('Finished')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: /^Week 2/ }));
  fireEvent.click(screen.getByText(document.occurrences[1].name, { selector: 'summary' }));
  expect(screen.getByText('Skipped')).toBeVisible();
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
  return { contentHash: 'a'.repeat(64), executionId: randomUUID(), lifecycle: 'Open', results: [], initial: { accountId, occurrence: workout,
    positions: workout.positions.map(p => ({ id: randomUUID(), sourcePositionId: p.id, targets: p.targets.map(t => ({ id: randomUUID(), sourceTargetId: t.id })) })) } } as unknown as ExecutionRead;
}
function swappedFixture() {
  const value = activeFixture(), positionId = value.initial.positions[0].id;
  const entry = catalog.find(e => e.name === 'Front Squat')!;
  value.swaps = [{ executionId: value.executionId, positionId, version: 1, actionId: randomUUID(),
    previousActionId: null, instructionEpoch: 0, contentHash: 'b'.repeat(64),
    content: replacementContent(value, positionId, entry), recordedAt: '2026-09-30T15:00:00.000Z' }];
  return value;
}
describe('Exercise swap presentation', () => {
  it.each(['result', 'skip'] as const)('hides Swap after a resolved %s while retaining History', kind => {
    const value = activeFixture(), targetId = value.initial.positions[0].targets[0].id;
    if (kind === 'result') value.history = [{ targetId } as SavedSetResult];
    else value.skips = [{ targetId } as NonNullable<ExecutionRead['skips']>[number]];
    render(<ActiveHarness value={value} read={async () => value.results} />);
    expect(screen.queryByRole('button', { name: 'Swap', hidden: false })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'History' })).toBeVisible();
  });
  it('shows the original and replacement in the queue without changing START', () => {
    const value = swappedFixture(), original = value.initial.occurrence.positions[0].exercise.name;
    render(<ActiveHarness value={value} read={async () => []} />);
    expect(screen.getByText(`${original} → Front Squat · Swapped for today`)).toBeVisible();
    expect(value.initial.occurrence.positions[0].exercise.name).toBe(original);
    const swap = screen.getByRole('button', { name: 'Swap' }), history = screen.getByRole('button', { name: 'History' });
    for (const button of [swap, history]) expect(button).toHaveClass('min-h-11', 'min-w-20', 'px-3', 'text-xs');
  });
  it('retains every swap and restore in review history, ordered by version', () => {
    const value = swappedFixture(), first = value.swaps![0], original = value.initial.occurrence.positions[0].exercise.name;
    const restore = { ...first, version: 2, actionId: randomUUID(), previousActionId: first.actionId,
      content: replacementContent(value, first.positionId, null), recordedAt: '2026-09-30T15:01:00.000Z' };
    value.swaps = [restore, first];
    render(<ExerciseSwapHistory execution={value} />);
    fireEvent.click(screen.getByText('Exercise swap history'));
    expect(screen.getByText(`Originally ${original}`)).toBeInTheDocument();
    const rows = screen.getAllByRole('listitem');
    expect(rows[1]).toHaveTextContent(`${original} → Front Squat · Swapped for today`);
    expect(rows[2]).toHaveTextContent(`Front Squat → ${original} · Returned to original`);
    expect(rows[2]).toHaveTextContent(restore.recordedAt);
  });
  it('labels a restored queue position and omits swap history for untouched workouts', () => {
    const value = swappedFixture(), first = value.swaps![0], original = value.initial.occurrence.positions[0].exercise.name;
    value.swaps!.push({ ...first, version: 2, actionId: randomUUID(), previousActionId: first.actionId,
      content: replacementContent(value, first.positionId, null) });
    const view = render(<ActiveHarness value={value} read={async () => []} />);
    expect(screen.getByText(`Returned to original: ${original}`)).toBeVisible();
    expect(screen.queryByText(/Swapped for today/)).not.toBeInTheDocument();
    view.unmount();
    render(<ExerciseSwapHistory execution={activeFixture()} />);
    expect(screen.queryByText('Exercise swap history')).not.toBeInTheDocument();
  });
});
function ActiveHarness({ value, read }: { value: ExecutionRead; read: () => Promise<SavedSetResult[]> }) {
  const [execution, setExecution] = useState(value);
  const [inputs, setInputs] = useState<Record<string, boolean>>({});
  const input = useCallback((id: string, blocked: boolean) => setInputs(v => v[id] === blocked ? v : { ...v, [id]: blocked }), []);
  return <ActiveWorkout refreshExecution={async () => execution} execution={execution} ownershipEpoch={0} locked={false} inputStates={inputs} onInputState={input} refresh={async () => { const results = await read(); setExecution(v => ({ ...v, results })); return results; }} />;
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
    await waitFor(() => expect(screen.getByRole('button', { name: 'Log set' })).toBeDisabled());
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
    await waitFor(() => expect(screen.getByRole('button', { name: 'Log set' })).toBeDisabled());
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
    expect(screen.getByText('2/4 resolved')).toBeVisible();
  });
  it.each([false, true])('does not pull selection back after a late response (return to original: %s)', async (returnToOriginal) => {
    const value = activeFixture(), results: SavedSetResult[] = [], transport = activeTransport(results);
    let reply!: () => void;
    vi.stubGlobal('fetch', vi.fn().mockImplementation((...args) => new Promise<Response>(resolve => { reply = () => resolve(transport(...args)); })));
    render(<ActiveHarness value={value} read={async () => [...results]} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Log set' })).toBeDisabled());
    fireEvent.change(screen.getByLabelText('Set 1 Actual reps'), { target: { value: '8' } });
    fireEvent.click(screen.getByRole('button', { name: 'Log set' }));
    fireEvent.click(screen.getAllByRole('button', { name: /, set 2, unrecorded/ })[1]);
    fireEvent.change(screen.getByLabelText('Set 2 Actual reps'), { target: { value: '11' } });
    if (returnToOriginal) fireEvent.click(screen.getAllByRole('button', { name: /, set 1, unrecorded/ })[0]);
    reply();
    await screen.findByText('1/4 resolved');
    if (returnToOriginal) expect(screen.getByRole('button', { name: /, set 1, recorded/ })).toHaveAttribute('aria-pressed', 'true');
    else expect(screen.getByLabelText('Set 2 Actual reps')).toHaveValue('11');
    expect(results[0].targetId).toBe(value.initial.positions[0].targets[0].id);
  });
  it('adjusts explicit zero and units without saving, with optional RIR distinct from RPE', async () => {
    const value = activeFixture();
    render(<ActiveHarness value={value} read={async () => []} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Log set' })).toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Increase load by 5 lb' }));
    expect(screen.getByLabelText('Set 1 Actual load')).toHaveValue('5');
    fireEvent.click(screen.getByRole('button', { name: 'Decrease load by 5 lb' }));
    expect(screen.getByLabelText('Set 1 Actual load')).toHaveValue('0');
    fireEvent.click(screen.getByRole('button', { name: '0 RIR' }));
    expect(screen.getByLabelText('Set 1 Actual RIR (optional)')).toHaveValue('0');
    fireEvent.change(screen.getByLabelText('Set 1 Actual RIR (optional)'), { target: { value: '' } });
    expect(screen.getByLabelText('Set 1 Actual RIR (optional)')).toHaveValue('');
    expect(screen.getByText('0/4 resolved')).toBeVisible();
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
  await waitFor(() => expect(screen.getByRole('button', { name: 'Finish workout' })).toBeEnabled(), { timeout: 5000 });
  fireEvent.change(screen.getByLabelText('Set 1 Actual reps'), { target: { value: '8' } });
  expect(screen.getAllByRole('region', { name: 'Active set' })).toHaveLength(1);
  expect(screen.getAllByLabelText(/Actual reps/)).toHaveLength(1);
  expect(screen.getByRole('button', { name: 'Finish workout' })).toBeDisabled();
});

import { recordRest, restRemaining, readRest } from './rest-state';
it('starts full rest at confirmation and preserves the deadline through retries, dismissal and corrections', () => {
  const record = { executionId: randomUUID(), targetId: randomUUID(), performedSetId: randomUUID(), actionId: randomUUID(), version: 1, reason: null,
    recordedAt: '2026-09-16T00:00:00.000Z', result: { reps: { value: 8, basis: 'total' as const }, measurement: null, rir: null } };
  const start = Date.parse(record.recordedAt), confirmed = start + 59000, timer = recordRest(null, record, true, confirmed)!;
  expect(restRemaining(timer, confirmed)).toBe(180); expect(restRemaining(timer, confirmed + 60000)).toBe(120); expect(restRemaining(timer, confirmed + 190000)).toBe(0);
  expect(recordRest(timer, record, true)).toBe(timer);
  const dismissed = { ...timer, deadline: start };
  expect(recordRest(readRest(JSON.stringify(dismissed)), record, true)).toEqual(dismissed);
  expect(recordRest(timer, { ...record, version: 2, actionId: randomUUID() }, true)).toBe(timer);
  const newer = { ...record, actionId: randomUUID(), recordedAt: new Date(start + 10000).toISOString() };
  const next = recordRest(timer, newer, false, confirmed + 10000)!; expect(restRemaining(next, confirmed + 10000)).toBe(120);
  expect(restRemaining(next, confirmed + 9750)).toBe(120); // Previous UI tick, before confirmation.
  expect(restRemaining(timer, confirmed - 250)).toBe(180);
  expect(restRemaining(next, confirmed + 11000)).toBe(119);
  expect(recordRest(next, { ...record, actionId: randomUUID() }, true)?.deadline).toBe(next.deadline);
  expect(readRest('{"version":1}')).toBeNull();
});

import { RestBar } from './RestBar';
import { MuscleTags } from './MuscleTags';
it('exposes timer adjustments without disclosure and clamps below zero without changing event identity', async () => {
  const now = Date.now();
  const state = { version: 1 as const, deadline: now + 10000, duration: 180000, recordedAt: now, actionId: 'event', seen: ['event'] };
  const change = vi.fn();
  // Use a real record-derived state to retain the persisted rest-state contract.
  const record = { executionId: randomUUID(), targetId: randomUUID(), performedSetId: randomUUID(), actionId: randomUUID(), version: 1, reason: null,
    recordedAt: new Date(now).toISOString(), result: { reps: null, measurement: null, rir: null } };
  const timer = { ...recordRest(null, record, true)!, deadline: state.deadline };
  render(<RestBar state={timer} storageKey="timer-test" onChange={change} />);
  fireEvent.click(await screen.findByRole('button', { name: '+30 seconds' }));
  expect(change.mock.calls[0][0].deadline).toBe(timer.deadline + 30000);
  fireEvent.click(screen.getByRole('button', { name: '−30 seconds' }));
  const adjusted = change.mock.calls[1][0];
  expect(restRemaining(adjusted, Date.now())).toBe(0);
  expect(adjusted.seen).toEqual(timer.seen);
  expect(readRest(localStorage.getItem('timer-test'))).toEqual(adjusted);
  localStorage.removeItem('timer-test');
});
it('resolves V1 muscle metadata by catalog identity and omits custom descriptions', () => {
  const exercise = createHypertrophyPlan().occurrences[0].positions[0].exercise;
  const view = render(<MuscleTags exercise={exercise} />);
  expect(screen.getByLabelText('Primary muscle: Quads')).toBeVisible();
  expect(screen.getByLabelText('Secondary muscle: Hamstrings')).toBeVisible();
  view.rerender(<MuscleTags exercise={{ kind: 'authoredDescription', name: exercise.name, variation: '' }} />);
  expect(view.container).toBeEmptyDOMElement();
});
it('returns from a recorded-set edit without discarding input for either target', async () => {
  const value = activeFixture();
  const recorded: SavedSetResult = { executionId: value.executionId, targetId: value.initial.positions[0].targets[0].id, performedSetId: randomUUID(), actionId: randomUUID(), version: 1, reason: null,
    recordedAt: new Date().toISOString(), result: { reps: { value: 8, basis: 'total' }, measurement: null, rir: '0' } };
  value.results = [recorded];
  render(<ActiveHarness value={value} read={async () => [recorded]} />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Log set' })).toBeEnabled());
  fireEvent.change(screen.getByLabelText('Set 2 Actual reps'), { target: { value: '11' } });
  fireEvent.click(screen.getByRole('button', { name: /, set 1, recorded/ }));
  expect(screen.getByText('EDIT SAVED SET')).toBeVisible();
  fireEvent.change(screen.getByLabelText('Set 1 Actual reps'), { target: { value: '9' } });
  fireEvent.click(screen.getByRole('button', { name: 'Return to active set' }));
  expect(screen.getByLabelText('Set 2 Actual reps')).toHaveValue('11');
  fireEvent.click(screen.getByRole('button', { name: /, set 1, recorded/ }));
  expect(screen.getByLabelText('Set 1 Actual reps')).toHaveValue('9');
});

it('keeps legacy sparse results compact in the exercise queue', () => {
  const value = activeFixture();
  value.results = [{ executionId: value.executionId, targetId: value.initial.positions[0].targets[0].id, performedSetId: randomUUID(), actionId: randomUUID(), version: 1, reason: null,
    recordedAt: new Date().toISOString(), result: { reps: null, measurement: null, rir: '3' } }];
  render(<ActiveHarness value={value} read={async () => value.results} />);
  expect(screen.getByRole('button', { name: /, set 1, recorded/ })).toHaveTextContent(/1· 3 RIR/);
  expect(screen.getByRole('button', { name: /, set 1, recorded/ })).not.toHaveTextContent('unspecified');
});

it('offers Finish in the ready card for a mix of logged and explicitly skipped sets', async () => {
  const value = activeFixture();
  const targets = value.initial.positions.flatMap(p => p.targets);
  value.results = targets.slice(0, -1).map(t => ({ executionId: value.executionId, targetId: t.id,
    performedSetId: randomUUID(), version: 1, actionId: randomUUID(), recordedAt: new Date().toISOString(),
    reason: null, result: { reps: { value: 8, basis: 'total' }, measurement: null, rir: '3' } }));
  value.skips = [{ executionId: value.executionId, targetId: targets.at(-1)!.id, actionId: randomUUID(), skippedAt: new Date().toISOString() }];
  render(<ActiveHarness value={value} read={vi.fn()} />);
  const finish = await screen.findByRole('button', { name: 'Finish workout' });
  await waitFor(() => expect(finish).toBeEnabled());
  expect(screen.getByRole('heading', { name: 'Ready to finish' })).toBeVisible();
  expect(finish).toHaveAttribute('form', `trainer2-finish-form-${value.executionId}`);
  expect(screen.queryByText('To log')).toBeNull();
});

it.each([-180, 200])('aligns the active card beneath the sticky timer regardless of its top %i and falls back after dismissal', async (timerTop) => {
  const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const top = this.getAttribute('aria-label') === 'Rest timer' ? timerTop : -100;
    return { top, bottom: top + 72, height: 72, left: 0, right: 390, width: 390, x: 0, y: top, toJSON: () => ({}) };
  });
  const scroll = vi.spyOn(window, 'scrollBy').mockImplementation(() => {});
  try {
    const value = activeFixture(), results: SavedSetResult[] = [];
    vi.stubGlobal('fetch', activeTransport(results));
    render(<ActiveHarness value={value} read={async () => [...results]} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Log set' })).toBeDisabled());
    fireEvent.change(screen.getByLabelText('Set 1 Actual reps'), { target: { value: '8' } });
    fireEvent.click(screen.getByRole('button', { name: 'Log set' }));
    await screen.findByLabelText('Set 2 Actual reps');
    expect(screen.getByLabelText('Rest timer')).toBeVisible();
    expect(scroll).toHaveBeenLastCalledWith(expect.objectContaining({ top: -192 }));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss rest timer' }));
    await waitFor(() => expect(screen.queryByLabelText('Rest timer')).toBeNull());
    fireEvent.click(screen.getAllByRole('button', { name: /, set 1, unrecorded/ }).at(-1)!);
    expect(scroll).toHaveBeenLastCalledWith(expect.objectContaining({ top: -116 }));
  } finally { rect.mockRestore(); scroll.mockRestore(); }
});

it('older execution reads cannot drop accepted additions or restore an obsolete assignment', () => {
  const old=activeFixture(),current=structuredClone(old);
  current.additions=[{actionId:randomUUID()}] as ExecutionRead['additions'];
  expect(mergeExecutionRead(current,old)).toBe(current);
  const swapped=swappedFixture(),unswapped={...swapped,swaps:[]};
  expect(mergeExecutionRead(swapped,unswapped)).toBe(swapped);
});

it('keeps finished and skipped current-week selection read-only and never offers Start for them', async () => {
  const document = createHypertrophyPlan(), finishedId = randomUUID();
  const rows = document.occurrences.map((o, i) => ({ occurrenceId: o.id, name: o.name, stageName: 'Week', status: i === 0 ? 'Finished' : i === 1 ? 'Skipped' : 'Pending', skip: i === 1 ? {actionId:randomUUID(),actorAccountId:accountId,revisionId,skippedAt:'2026-10-04T12:00:00.000Z',planCompleted:false} : null, ...(i === 0 ? {executionId: finishedId} : {}) }));
  const value = {...next, occurrence: document.occurrences[2], occurrences: rows, eligibleOccurrenceIds: document.occurrences.slice(2,4).map(o=>o.id),
    week: {index:0, firstOccurrenceId:document.occurrences[0].id, occurrenceIds:document.occurrences.slice(0,4).map(o=>o.id),ready:false,final:false}};
  const fetch = vi.fn().mockResolvedValue(response(value)); vi.stubGlobal('fetch',fetch);
  render(<Workout accountId={accountId} ownershipEpoch={0} planId={planId} document={document} />);
  await waitFor(()=>expect(screen.getByRole('button',{name:'Start workout'})).toBeEnabled());
  fireEvent.click(screen.getByRole('button',{name:/Select Lower A, workout 1/}));
  expect(screen.getByRole('link',{name:'View results'})).toHaveAttribute('href',`/trainer2/dev/executions/${finishedId}`);
  expect(screen.queryByRole('button',{name:'Start workout'})).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:/Select Upper A, workout 2/}));
  expect(screen.getByText(/Explicitly skipped. The saved prescription/)).toBeVisible();
  expect(screen.getByRole('region',{name:'Planned workout'})).toHaveTextContent(document.occurrences[1].positions[0].exercise.name);
  expect(screen.queryByRole('button',{name:'Start workout'})).toBeNull();expect(fetch).toHaveBeenCalledTimes(1);
});

it('renders long names, zero RIR and assistance semantics from exact targets in designed prescriptions', () => {
  const workout=structuredClone(occurrence), name='Rear foot elevated split squat with an unusually long authored exercise name';
  workout.positions=[workout.positions[0]];workout.positions[0].exercise.name=name;
  workout.positions[0].targets=[{...workout.positions[0].targets[0],rir:'0',reps:{min:8,max:12,basis:'perSide'},measurement:{kind:'assistance',value:'40',unit:'lb',convention:'displayedAssistance',zeroMeaning:'noAssistance'}}];
  render(<PlannedWorkout workout={workout} design />);
  expect(screen.getByRole('heading',{name})).toBeVisible();expect(screen.getByText(/8.*12 reps per side.*0 RIR.*40 lb assistance/)).toBeVisible();
  expect(screen.getByText(/more weight means easier/)).toBeVisible();
});
