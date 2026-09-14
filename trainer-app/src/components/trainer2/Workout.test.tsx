import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID, webcrypto } from 'node:crypto';
import { Workout, WorkoutPrescription } from './Workout';
import { createHypertrophyPlan } from '@/lib/engine/trainer2/plan-builder';

const accountId = 'synthetic-workout-account';
const planId = randomUUID(), revisionId = randomUUID();
const occurrence = createHypertrophyPlan().occurrences[0];
const next = { accountId, planId, revisionId, instructionEpoch: 0, occurrence, execution: null };
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
  it('retains the exact uncertain command across remount and blocks repeated clicks', async () => {
    let finish!: (v: Response) => void;
    const fetch = vi.fn().mockResolvedValueOnce(response(next)).mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; })); vi.stubGlobal('fetch', fetch);
    const first = render(<Workout accountId={accountId} ownershipEpoch={0} planId={planId} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Start workout' }));
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
    fireEvent.click(await screen.findByRole('button', { name: 'Start workout' }));
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
    expect(screen.getByText(/0.00 lb added/)).toBeInTheDocument(); expect(screen.getByText(/per side/)).toBeInTheDocument(); expect(screen.getByText(/Optional/)).toBeInTheDocument(); expect(screen.getByText(/Rest unspecified/)).toBeInTheDocument();
  });
});
