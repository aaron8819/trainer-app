import { randomUUID, webcrypto } from 'node:crypto';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { catalog, catalogExercise } from '@/lib/engine/trainer2/catalog';
import { recordSetResultCommand } from '@/lib/trainer2-contracts/set-results';
import type { SavedSetResult } from '@/lib/trainer2-contracts/set-results';
import { SetResultRow } from './SetResultRow';

const exercise = catalogExercise(catalog.find(e => e.id === 't2:push-up')!);
const props = {
  accountId: 'synthetic-rir-defaults', ownershipEpoch: 0, executionId: randomUUID(),
  targetId: randomUUID(), number: 1, activePanel: true, exercise, refresh: vi.fn(),
};
const prescription = {
  id: props.targetId, classification: 'working' as const, required: true,
  reps: { min: 8, max: 8, basis: 'total' as const },
  measurement: { kind: 'bodyweight' as const, convention: 'bodyweightOnly' as const },
  rir: '2', restSeconds: null,
};
const saved: SavedSetResult = {
  executionId: props.executionId, targetId: props.targetId, performedSetId: randomUUID(),
  version: 1, actionId: randomUUID(), reason: null, recordedAt: '2026-10-13T00:00:00Z',
  result: { reps: { value: 8, basis: 'total' },
    measurement: prescription.measurement, rir: '4' },
};

beforeEach(() => {
  sessionStorage.clear();
  vi.stubGlobal('crypto', webcrypto);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function ready(): Promise<void> {
  await waitFor(() => expect(screen.getByRole('button', { name: 'Log set' })).toBeEnabled());
}
function expectBlank(): void {
  expect(screen.getAllByRole('button', { name: /^[0-5] RIR$/ })
    .every(button => button.getAttribute('aria-pressed') === 'false')).toBe(true);
}
function captureSave(): ReturnType<typeof vi.fn> {
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    if (!url || typeof init.body !== 'string') throw new Error('Expected result command');
    return new Response(JSON.stringify({ malformed: true }));
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

describe('effective prescribed RIR defaults', () => {
  it.each(['2', '0.000000', '3.500000', '7'])('preserves exact prescribed RIR %s on logging',
    async rir => {
      const fetch = captureSave();
      render(<SetResultRow {...props} prescription={{ ...prescription, rir }} />);
      await ready();
      if (Number(rir) <= 5 && Number.isInteger(Number(rir))) {
        expect(screen.getByRole('button', { name: `${Number(rir)} RIR` }))
          .toHaveAttribute('aria-pressed', 'true');
      } else {
        expect(screen.getByText(`RIR: ${rir} · outside picker presets`)).toBeVisible();
      }
      fireEvent.click(screen.getByRole('button', { name: 'Log set' }));
      await screen.findByRole('button', { name: 'Retry save' });
      const request = fetch.mock.calls[0][1] as RequestInit;
      expect(recordSetResultCommand.parse(JSON.parse(String(request.body))).intent.result.rir)
        .toBe(rir);
    });

  it('leaves absent RIR blank even with ranged reps and previous effort', async () => {
    render(<SetResultRow {...props} prescription={{ ...prescription, rir: null,
      reps: { ...prescription.reps, max: 12 } }} preceding={[saved]} firstSetLoad={saved} />);
    await ready();
    expectBlank();
  });

  it('refreshes untouched current targets without borrowing preceding-set RIR', async () => {
    const view = render(<SetResultRow {...props} prescription={prescription} />);
    await ready();
    expect(screen.getByRole('button', { name: '2 RIR' })).toHaveAttribute('aria-pressed', 'true');
    view.rerender(<SetResultRow {...props} prescription={{ ...prescription, rir: '3' }}
      preceding={[saved]} />);
    expect(screen.getByRole('button', { name: '3 RIR' })).toHaveAttribute('aria-pressed', 'true');
    expect(sessionStorage.getItem(
      `trainer2-result:${props.accountId}:${props.executionId}:${props.targetId}`)).toBeNull();
  });

  it.each(['adjust', 'clear'] as const)('retains a user %s across target refresh and remount',
    async choice => {
      const view = render(<SetResultRow {...props} prescription={prescription} />);
      await ready();
      const selection = choice === 'clear' ? '2 RIR' : '1 RIR';
      fireEvent.click(screen.getByRole('button', { name: selection }));
      view.rerender(<SetResultRow {...props} prescription={{ ...prescription, rir: '5' }} />);
      if (choice === 'clear') expectBlank();
      else expect(screen.getByRole('button', { name: '1 RIR' }))
        .toHaveAttribute('aria-pressed', 'true');
      view.unmount();
      render(<SetResultRow {...props} prescription={{ ...prescription, rir: '5' }} />);
      await ready();
      if (choice === 'clear') expectBlank();
      else expect(screen.getByRole('button', { name: '1 RIR' }))
        .toHaveAttribute('aria-pressed', 'true');
    });

  it('isolates defaults and edits across set, exercise and session identities', async () => {
    const view = render(<SetResultRow key="first" {...props} prescription={prescription} />);
    await ready();
    fireEvent.click(screen.getByRole('button', { name: '1 RIR' }));
    const secondId = randomUUID();
    view.rerender(<SetResultRow key="second" {...props} targetId={secondId} number={2}
      prescription={{ ...prescription, id: secondId, rir: '3' }} preceding={[saved]} />);
    await ready();
    expect(screen.getByRole('button', { name: '3 RIR' })).toHaveAttribute('aria-pressed', 'true');
    const nextId = randomUUID();
    view.rerender(<SetResultRow key="exercise" {...props} targetId={nextId} sessionAdded
      exercise={catalogExercise(catalog.find(e => e.id === 't2:bodyweight-glute-bridge')!)}
      prescription={{ ...prescription, id: nextId, rir: '0' }} />);
    await ready();
    expect(screen.getByRole('button', { name: '0 RIR' })).toHaveAttribute('aria-pressed', 'true');
    view.rerender(<SetResultRow key="session" {...props} executionId={randomUUID()}
      prescription={{ ...prescription, rir: '5' }} />);
    await ready();
    expect(screen.getByRole('button', { name: '5 RIR' })).toHaveAttribute('aria-pressed', 'true');
    view.rerender(<SetResultRow key="first" {...props} prescription={prescription} />);
    await ready();
    expect(screen.getByRole('button', { name: '1 RIR' })).toHaveAttribute('aria-pressed', 'true');
  });

  it.each(['4', null])('preserves logged RIR %s when editing and reopening', async rir => {
    const actual = { ...saved, result: { ...saved.result!, rir } };
    const view = render(<SetResultRow {...props} prescription={prescription} saved={actual} />);
    await screen.findByRole('button', { name: 'Update set' });
    if (rir === null) expectBlank();
    else expect(screen.getByRole('button', { name: '4 RIR' }))
      .toHaveAttribute('aria-pressed', 'true');
    fireEvent.change(screen.getByLabelText('Set 1 Actual reps'), { target: { value: '9' } });
    view.unmount();
    render(<SetResultRow {...props} prescription={{ ...prescription, rir: '5' }} saved={actual} />);
    await screen.findByRole('button', { name: 'Update set' });
    expect(screen.getByLabelText('Set 1 Actual reps')).toHaveValue('9');
    if (rir === null) expectBlank();
    else expect(screen.getByRole('button', { name: '4 RIR' }))
      .toHaveAttribute('aria-pressed', 'true');
  });

  it('reopens skipped work with its target and keeps cleared logged effort unspecified', async () => {
    const skipped = { executionId: props.executionId, targetId: props.targetId,
      actionId: randomUUID(), skippedAt: saved.recordedAt };
    const view = render(
      <SetResultRow {...props} prescription={prescription} skipped={skipped} />
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Log this set' }));
    await ready();
    expect(screen.getByRole('button', { name: '2 RIR' })).toHaveAttribute('aria-pressed', 'true');
    view.unmount();
    render(<SetResultRow {...props} prescription={prescription}
      saved={{ ...saved, result: null }} />);
    await screen.findByRole('button', { name: 'Update set' });
    expectBlank();
  });
});
