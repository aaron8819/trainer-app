import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createHypertrophyPlan } from '@/lib/engine/trainer2/plan-builder';
import { PrescriptionSheet } from './PrescriptionSheet';
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute('open', ''); } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute('open'); } });
});
afterEach(cleanup);
it('preserves an exact kg prescription when only reps change', () => {
  const p = createHypertrophyPlan().occurrences[0].positions[0];
  const target = { ...p.targets[0], measurement: { kind: 'externalLoad' as const, value: '61.234567', unit: 'kg' as const, convention: 'barbellTotal' as const, zeroMeaning: 'notAllowed' as const } };
  const apply = vi.fn();
  render(<PrescriptionSheet exercise={p.exercise} target={target} sets={3} scope="All weeks" trigger={document.createElement('button')} close={vi.fn()} apply={apply} />);
  expect(document.body.textContent).not.toMatch(/\bkg\b/);
  expect(screen.queryByRole('combobox', { name: 'Unit' })).toBeNull();
  fireEvent.change(screen.getByLabelText('Reps from'), { target: { value: '7' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply changes' }));
  expect(apply.mock.calls[0][1].measurement).toEqual(target.measurement);
  expect(apply.mock.calls[0][2]).toEqual(['reps']);
});
it('authors a changed starting load in lbs with the catalog convention', () => {
  const p = createHypertrophyPlan().occurrences[0].positions[0]; const apply = vi.fn();
  render(<PrescriptionSheet exercise={p.exercise} target={p.targets[0]} sets={3} scope="Week 2 only" trigger={document.createElement('button')} close={vi.fn()} apply={apply} />);
  fireEvent.change(screen.getByLabelText('Optional starting load · lbs'), { target: { value: '135.25' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply changes' }));
  expect(apply.mock.calls[0][1].measurement).toMatchObject({ value: '135.25', unit: 'lb', convention: 'barbellTotal' });
  expect(apply.mock.calls[0][2]).toEqual(['measurement']);
});
it('validates before applying, and cancellation never applies local fields', () => {
  const p = createHypertrophyPlan().occurrences[0].positions[0]; const apply = vi.fn(), close = vi.fn();
  render(<PrescriptionSheet exercise={p.exercise} target={p.targets[0]} sets={3} scope="All weeks" trigger={document.createElement('button')} close={close} apply={apply} />);
  fireEvent.change(screen.getByLabelText('Reps from'), { target: { value: '999' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply changes' }));
  expect(screen.getByRole('alert')).toBeVisible(); expect(apply).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel edits' }));
  expect(close).toHaveBeenCalledOnce(); expect(apply).not.toHaveBeenCalled();
});
it('retains valid-zero meaning when changing an existing legacy catalog load', () => {
  const p = createHypertrophyPlan().occurrences[0].positions[0]; const apply = vi.fn();
  const exercise = { ...p.exercise }; if (exercise.kind === 'catalogSnapshot') delete exercise.catalogFacts;
  const target = { ...p.targets[0], measurement: { kind: 'externalLoad' as const, value: '10', unit: 'kg' as const, convention: 'barbellTotal' as const, zeroMeaning: 'validZero' as const } };
  render(<PrescriptionSheet exercise={exercise} target={target} sets={3} scope="All weeks" trigger={document.createElement('button')} close={vi.fn()} apply={apply} />);
  fireEvent.change(screen.getByLabelText('Optional starting load · lbs'), { target: { value: '0' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply changes' }));
  expect(apply.mock.calls[0][1].measurement).toMatchObject({ value: '0', unit: 'lb', zeroMeaning: 'validZero' });
});
it('keeps local inputs while a destructive reduction waits for confirmation', () => {
  const p = createHypertrophyPlan().occurrences[0].positions[0];
  const apply = vi.fn().mockReturnValueOnce('Set 3 has individual edits.').mockReturnValueOnce(null);
  render(<PrescriptionSheet exercise={p.exercise} target={p.targets[0]} sets={3} scope="Week 2 only" trigger={document.createElement('button')} close={vi.fn()} apply={apply} />);
  fireEvent.change(screen.getByLabelText('Sets'), { target: { value: '2' } });
  fireEvent.change(screen.getByLabelText('Optional starting load · lbs'), { target: { value: '141.25' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply changes' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Set 3 has individual edits.');
  expect(screen.getByLabelText('Optional starting load · lbs')).toHaveValue(141.25);
  fireEvent.click(screen.getByRole('button', { name: 'Confirm reduction' }));
  expect(apply.mock.calls[1][3]).toBe(true);
  expect(apply.mock.calls[1][1].measurement.value).toBe('141.25');
});
