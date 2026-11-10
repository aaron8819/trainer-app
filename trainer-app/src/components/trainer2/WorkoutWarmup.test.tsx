import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createHypertrophyPlan } from '@/lib/engine/trainer2/plan-builder';
import { WorkoutWarmup } from './WorkoutWarmup';
import { WorkoutPreviewExercises } from './WorkoutPreviewExercises';
import { PlanBuilder } from './PlanBuilder';

afterEach(cleanup);

it('authors and clears a workout warm-up across weeks, explicitly outside exercise scope', () => {
  const document = createHypertrophyPlan();
  const onChange = vi.fn();
  const view = render(<PlanBuilder document={document} disabled={false} onChange={onChange}
    initialOccurrenceId={document.occurrences[16].id} />);
  fireEvent.change(screen.getByRole('textbox', { name: /Warm-up/ }), {
    target: { value: 'Supported Cossack squats' },
  });
  const updated = onChange.mock.calls[0][0];
  expect(updated.occurrences.filter((o: { warmup?: string }) => o.warmup)).toHaveLength(5);
  expect(document.occurrences.every(o => !o.warmup)).toBe(true);
  view.rerender(<PlanBuilder document={updated} disabled={false} onChange={onChange} />);
  fireEvent.change(screen.getByRole('textbox', { name: /Warm-up/ }), { target: { value: '' } });
  expect(onChange.mock.calls[1][0].occurrences.every((o: { warmup?: string }) => !o.warmup))
    .toBe(true);
});

it('leaves workouts without a warm-up unchanged', () => {
  const view = render(<WorkoutWarmup />);
  expect(view.container).toBeEmptyDOMElement();
});

it('shows plain text before exercises with no inputs or logging controls', () => {
  const workout = createHypertrophyPlan().occurrences[0];
  workout.warmup = 'Supported Cossack squats\n<script>example</script>';
  const view = render(<WorkoutPreviewExercises workout={workout} />);
  const warmup = screen.getByRole('region', { name: 'Warm-up' });
  expect(warmup).toHaveTextContent('Supported Cossack squats');
  expect(warmup).toHaveTextContent('No logging needed');
  expect(warmup.compareDocumentPosition(screen.getByRole('heading', { name: 'Exercises' }))
    & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(warmup.querySelector('input,button,script')).toBeNull();
  expect(view.container.querySelectorAll('ol > li')).toHaveLength(workout.positions.length);
});
