import { cleanup, render, screen } from '@testing-library/react';
import { afterEach } from 'vitest';
import { PlannedWorkout } from './TrainingOverview';
import { WorkoutPrescription } from './Workout';
import { createHypertrophyPlan } from '@/lib/engine/trainer2/plan-builder';
import { describe, expect, it } from 'vitest';
import { catalog, catalogExercise } from '@/lib/engine/trainer2/catalog';
import { exerciseTitle } from './exercise-title';

afterEach(cleanup);

const affected = catalog.filter(e => [
  ' (Plates Added)', ' (Plates per Arm)', ' (Stack)',
].some(suffix => e.name.endsWith(suffix)));

describe('Trainer2 exercise title presentation', () => {
  it('cleans the nine reviewed titles without changing snapshots or conventions', () => {
    expect(affected).toHaveLength(9);
    for (const entry of affected) {
      const snapshot = catalogExercise(entry);
      const before = structuredClone(snapshot);
      const expected = entry.name.slice(0, entry.name.lastIndexOf(' ('));
      expect(exerciseTitle(entry)).toBe(expected);
      expect(exerciseTitle(snapshot)).toBe(expected);
      expect(snapshot).toEqual(before);
      expect(snapshot.name).toBe(entry.name);
    }
  });
  it('preserves meaningful distinctions, authored names and unknown snapshots', () => {
    for (const name of ['Dumbbell Row', 'Assisted Pull-Up', 'Smith-Machine Bulgarian Split Squat',
      'Custom Row (Stack)', 'Hack Squat (Plates Added)']) {
      expect(exerciseTitle({ kind: 'authoredDescription', name })).toBe(name);
      expect(exerciseTitle({ kind: 'catalogSnapshot', catalogId: 'unknown', name })).toBe(name);
    }
    expect(exerciseTitle({ catalogId: 't2:hack-squat-plates-added',
      name: 'Hack Squat (Different Machine)' })).toBe('Hack Squat (Different Machine)');
  });
});


it('renders clean plan and logger headings while retaining variation as details', () => {
  const workout = structuredClone(createHypertrophyPlan().occurrences[0]);
  workout.positions = [workout.positions[0]];
  workout.positions[0].exercise = catalogExercise(
    catalog.find(e => e.id === 't2:hack-squat-plates-added')!
  );
  const before = structuredClone(workout);
  const view = render(<PlannedWorkout workout={workout} />);
  expect(screen.getByRole('heading', { name: /^Hack Squat$/ })).toBeVisible();
  view.rerender(<WorkoutPrescription workout={workout} resultRow={() => null} />);
  expect(screen.getByRole('heading', { name: /^Hack Squat$/ })).toBeVisible();
  expect(screen.getByText(workout.positions[0].exercise.variation)).toBeVisible();
  expect(workout).toEqual(before);
});
