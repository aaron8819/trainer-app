import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { catalog, catalogExercise } from '@/lib/engine/trainer2/catalog';
import { EquipmentResistance, EquipmentSetupEditor } from './EquipmentSetup';
import { createHypertrophyPlan, expandWorkoutDefaults } from '@/lib/engine/trainer2/plan-builder';
import { PlanBuilder } from './PlanBuilder';
import { readSavedDocument, validateWorkoutDefaults } from '@/lib/engine/trainer2/planning';

afterEach(cleanup);
function hack() {
  const exercise = catalogExercise(catalog.find(e => e.id === 't2:hack-squat-plates-added')!);
  if (exercise.kind !== 'catalogSnapshot') throw Error('Missing snapshot');
  return exercise;
}
it('requires equipment identification and captures 105 separately without giving other hacks a default', () => {
  const exercise = hack(), apply = vi.fn();
  render(<EquipmentSetupEditor exercise={exercise} apply={apply} />);
  expect(screen.getByLabelText('Starting resistance · lb')).toHaveValue('');
  fireEvent.change(screen.getByLabelText('Starting resistance · lb'), { target: { value: '105' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply equipment details' }));
  expect(apply).not.toHaveBeenCalled(); expect(screen.getByRole('alert')).toHaveTextContent('Identify the equipment');
  fireEvent.change(screen.getByLabelText('Equipment identifier'), { target: { value: 'Gym hack machine A' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply equipment details' }));
  expect(apply).toHaveBeenCalledWith({ label: 'Gym hack machine A', startingResistance: { value: '105', unit: 'lb' } });
  expect(hack()).not.toHaveProperty('equipmentSetup');
});
it('keeps an unchanged equipment resistance exact when its display converts kg to lb', () => {
  const exercise = hack(), apply = vi.fn();
  exercise.equipmentSetup = { label: 'Specific machine', startingResistance: { value: '47.627198', unit: 'kg' } };
  render(<><EquipmentSetupEditor exercise={exercise} apply={apply} /><EquipmentResistance exercise={exercise} /></>);
  fireEvent.change(screen.getByLabelText('Equipment identifier'), { target: { value: 'Renamed specific machine' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply equipment details' }));
  expect(apply.mock.calls[0][0].startingResistance).toEqual(exercise.equipmentSetup.startingResistance);
  expect(screen.getByText(/separate from added plates/)).toBeVisible();
});
it('Builder equipment edits propagate to plan snapshots without adding to the zero plates prescription', () => {
  let doc = createHypertrophyPlan(); const row = doc.builder!.workouts[0].rows[0];
  row.exercise = hack(); row.prescription.measurement = { kind: 'externalLoad', value: '0.000000', unit: 'lb', convention: 'machineAddedPlatesTotal', zeroMeaning: 'validZero' };
  doc = expandWorkoutDefaults(doc);
  const change = vi.fn(); render(<PlanBuilder document={doc} disabled={false} onChange={change} />);
  fireEvent.change(screen.getByLabelText('Equipment identifier'), { target: { value: 'Specific 105 lb hack' } });
  fireEvent.change(screen.getByLabelText('Starting resistance · lb'), { target: { value: '105' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply equipment details' }));
  const next = change.mock.calls[0][0];
  expect(() => validateWorkoutDefaults(next)).not.toThrow();
  expect(readSavedDocument(next)).toEqual(next);
  expect(next.occurrences[0].positions[0].exercise.equipmentSetup.startingResistance.value).toBe('105');
  expect(next.occurrences[0].positions[0].targets[0].measurement.value).toBe('0.000000');
});
