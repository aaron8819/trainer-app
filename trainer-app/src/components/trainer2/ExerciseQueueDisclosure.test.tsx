import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { ExerciseQueueDisclosure } from './ExerciseQueueDisclosure';

afterEach(cleanup);

it('collapses completed work and preserves reopening across unrelated renders', () => {
  const view = render(<ExerciseQueueDisclosure unresolved="a">Sets</ExerciseQueueDisclosure>);
  expect(screen.getByText('Sets')).toBeVisible();
  view.rerender(<ExerciseQueueDisclosure unresolved="">Sets</ExerciseQueueDisclosure>);
  expect(screen.getByText('Sets')).not.toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Show sets' }));
  view.rerender(<ExerciseQueueDisclosure unresolved="">Sets updated</ExerciseQueueDisclosure>);
  expect(screen.getByText('Sets updated')).toBeVisible();
});

it('reveals added or cleared unresolved targets without remounting children', () => {
  const view = render(<ExerciseQueueDisclosure unresolved=""> <input aria-label="Retained" />
    </ExerciseQueueDisclosure>);
  const input = screen.getByLabelText('Retained');
  fireEvent.change(input, { target: { value: '12' } });
  view.rerender(<ExerciseQueueDisclosure unresolved="added"> <input aria-label="Retained" />
    </ExerciseQueueDisclosure>);
  expect(input).toBeVisible();
  expect(input).toHaveValue('12');
  fireEvent.click(screen.getByRole('button', { name: 'Hide sets' }));
  view.rerender(<ExerciseQueueDisclosure unresolved="added,cleared"> <input aria-label="Retained" />
    </ExerciseQueueDisclosure>);
  expect(input).toBeVisible();
});

it('keeps duplicate exercise occurrences independent', () => {
  render(<><ExerciseQueueDisclosure unresolved="">First occurrence</ExerciseQueueDisclosure>
    <ExerciseQueueDisclosure unresolved="">Second occurrence</ExerciseQueueDisclosure></>);
  fireEvent.click(screen.getAllByRole('button', { name: 'Show sets' })[0]);
  expect(screen.getByText('First occurrence')).toBeVisible();
  expect(screen.getByText('Second occurrence')).not.toBeVisible();
});
