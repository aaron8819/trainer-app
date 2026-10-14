import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { createHypertrophyPlan } from '@/lib/engine/trainer2/plan-builder';
import { WorkoutPreviewExercises } from './WorkoutPreviewExercises';

afterEach(cleanup);
it('shows prescriptions without load and expands only authored exercise details', () => {
  const workout = createHypertrophyPlan().occurrences[0];
  const first = workout.positions[0];
  const authored = { ...workout, positions: [{ ...first, targets: first.targets.map(target => ({
    ...target, measurement: { kind: 'externalLoad' as const, convention: 'perImplement' as const,
      zeroMeaning: 'notAllowed' as const, value: '123.456', unit: 'lb' as const },
  })) }] };
  const before = JSON.stringify(authored);
  const view = render(<WorkoutPreviewExercises workout={authored} />);
  expect(view.container.textContent).not.toMatch(/123\.456|lb|kg|load unspecified/i);
  expect(view.container.querySelector('summary')).toHaveTextContent(/reps/);
  fireEvent.click(screen.getByRole('button', { name: 'Expand all' }));
  expect(view.container.querySelector('details')).toHaveAttribute('open');
  expect(screen.getByRole('button', { name: 'Collapse all' })).toHaveAttribute(
    'aria-expanded', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'Collapse all' }));
  expect(view.container.querySelector('details')).not.toHaveAttribute('open');
  expect(JSON.stringify(authored)).toBe(before);
});