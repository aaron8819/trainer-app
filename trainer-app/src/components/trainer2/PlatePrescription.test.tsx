import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { catalog, catalogExercise, swapPrescription } from '@/lib/engine/trainer2/catalog';
import { createHypertrophyPlan, expandWorkoutDefaults } from '@/lib/engine/trainer2/plan-builder';
import { createDraftCommand, draftDocument } from '@/lib/trainer2-contracts/draft';
import { PrescriptionSheet } from './PrescriptionSheet';
import { DraftEditor } from './DraftEditor';

const variants = ['t2:chest-supported-machine-row-plates-per-arm', 't2:chest-supported-machine-high-row-plates-per-arm', 't2:smith-machine-bulgarian-split-squat-plates-added'];
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute('open', ''); } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute('open'); } });
});
afterEach(cleanup);

it.each(variants.flatMap(id => ['advanced', 'starting'].flatMap(path => ['0', '42.5'].map(value => ({ id, path, value })))))('$id $path authors and serializes $value lb with its qualified contract', ({ id, path, value }) => {
  let doc = createHypertrophyPlan();
  const row = doc.builder!.workouts[0].rows[0];
  const exercise = catalogExercise(catalog.find(entry => entry.id === id)!);
  row.prescription = swapPrescription(row.exercise, exercise, row.prescription);
  row.exercise = exercise;
  doc = expandWorkoutDefaults(doc);
  const position = doc.occurrences[0].positions[0];
  expect(position.targets[0].measurement).toBeNull();
  const apply = vi.fn();
  const view = render(<PrescriptionSheet exercise={exercise} target={position.targets[0]} sets={3} scope="All weeks" trigger={document.createElement('button')} close={vi.fn()} apply={apply} />);
  if (path === 'advanced') {
    fireEvent.click(screen.getByText('Advanced prescription details'));
    fireEvent.change(screen.getByLabelText('Measurement kind'), { target: { value: 'externalLoad' } });
    expect(screen.getByLabelText('Zero meaning')).toHaveValue('validZero');
    expect(screen.getByLabelText('Convention')).toHaveValue(exercise.kind === 'catalogSnapshot' ? exercise.convention : '');
    fireEvent.change(screen.getByLabelText('Load or assistance · lb'), { target: { value } });
  } else fireEvent.change(screen.getByLabelText('Optional starting load · lbs'), { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply changes' }));
  expect(apply).toHaveBeenCalledOnce();
  const expected = { kind: 'externalLoad', value, unit: 'lb', convention: exercise.kind === 'catalogSnapshot' ? exercise.convention : '', zeroMeaning: 'validZero' };
  expect(apply.mock.calls[0][1].measurement).toEqual(expected);
  doc.builder!.workouts[0].rows[0].prescription.measurement = apply.mock.calls[0][1].measurement;
  doc = expandWorkoutDefaults(doc);
  const command = createDraftCommand.parse({ schemaVersion: 1, actionId: crypto.randomUUID(), deviceId: crypto.randomUUID(), originatingAccountId: crypto.randomUUID(), ownershipEpoch: 0, dependsOn: [], commandType: 'CreateDraft', target: { planId: crypto.randomUUID() }, expected: {}, intent: doc });
  const reopened = draftDocument.parse(JSON.parse(JSON.stringify(command.intent)));
  expect(reopened.occurrences[0].positions[0].exercise).toEqual(exercise);
  expect(reopened.occurrences[0].positions[0].targets.every(t => JSON.stringify(t.measurement) === JSON.stringify(expected))).toBe(true);
  view.unmount();
  const unchanged = vi.fn();
  render(<PrescriptionSheet exercise={exercise} target={reopened.occurrences[0].positions[0].targets[0]} sets={3} scope="All weeks" trigger={document.createElement('button')} close={vi.fn()} apply={unchanged} />);
  expect(screen.getByLabelText('Optional starting load · lbs')).toHaveValue(Number(value));
  fireEvent.click(screen.getByRole('button', { name: 'Apply changes' }));
  expect(unchanged.mock.calls[0][1].measurement).toEqual(expected);
});

it.each(variants)('retained DraftEditor initializes the snapshot contract for %s', id => {
  const doc = createHypertrophyPlan(); delete doc.builder;
  doc.occurrences = [doc.occurrences[0]];
  const p = doc.occurrences[0].positions[0]; doc.occurrences[0].positions = [p]; p.targets = [p.targets[0]];
  p.exercise = catalogExercise(catalog.find(entry => entry.id === id)!);
  p.targets[0].reps.basis = p.exercise.kind === 'catalogSnapshot' ? p.exercise.repBasis : 'total';
  const change = vi.fn();
  render(<DraftEditor document={doc} disabled={false} onChange={change} />);
  fireEvent.change(screen.getByLabelText('Measurement kind'), { target: { value: 'externalLoad' } });
  expect(change.mock.calls[0][0].occurrences[0].positions[0].targets[0].measurement).toMatchObject({ unit: 'lb', zeroMeaning: 'validZero', convention: p.exercise.kind === 'catalogSnapshot' ? p.exercise.convention : '' });
});

it('notAllowed catalog definitions still reject zero in the sheet and server document contract', () => {
  const doc = createHypertrophyPlan(), p = doc.occurrences[0].positions[0]; delete doc.builder;
  p.exercise = catalogExercise(catalog.find(entry => entry.catalogFacts?.externalZeroMeaning === 'notAllowed' && entry.convention === 'barbellTotal')!);
  expect(p.exercise.kind === 'catalogSnapshot' && p.exercise.catalogFacts?.externalZeroMeaning).toBe('notAllowed');
  const apply = vi.fn();
  render(<PrescriptionSheet exercise={p.exercise} target={p.targets[0]} sets={3} scope="All weeks" trigger={document.createElement('button')} close={vi.fn()} apply={apply} />);
  fireEvent.click(screen.getByText('Advanced prescription details'));
  fireEvent.change(screen.getByLabelText('Measurement kind'), { target: { value: 'externalLoad' } });
  expect(screen.getByLabelText('Zero meaning')).toHaveValue('notAllowed');
  fireEvent.change(screen.getByLabelText('Load or assistance · lb'), { target: { value: '0' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply changes' }));
  expect(apply).not.toHaveBeenCalled(); expect(screen.getByRole('alert')).toBeVisible();
  p.targets[0].measurement = { kind: 'externalLoad', value: '0', unit: 'lb', convention: 'barbellTotal', zeroMeaning: 'notAllowed' };
  expect(draftDocument.safeParse(doc).success).toBe(false);
  p.targets[0].measurement.zeroMeaning = 'validZero';
  expect(draftDocument.safeParse(doc).success).toBe(false);
});
