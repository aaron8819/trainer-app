import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ExercisePicker } from './ExercisePicker';

afterEach(() => { cleanup(); vi.restoreAllMocks(); document.body.replaceChildren(); });
it.each(['connected', 'removed', 'disabled'])('restores focus after unmount with a %s invoking control', async state => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute('open', ''); } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute('open'); } });
  const trigger = document.createElement('button'), fallback = document.createElement('button');
  trigger.textContent = 'Add'; fallback.textContent = 'Nearby editor control'; document.body.append(trigger, fallback);
  trigger.focus();
  const view = render(<ExercisePicker trigger={trigger} fallback={() => fallback} equipment={[]} choose={() => undefined} close={() => undefined} />);
  if (state === 'removed') trigger.remove();
  if (state === 'disabled') trigger.disabled = true;
  view.unmount();
  await waitFor(() => expect(document.activeElement).toBe(state === 'connected' ? trigger : fallback));
});

it('shows distinct reviewed recording subtitles and useful unavailable copy before selection', () => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: function (this: HTMLDialogElement) { this.setAttribute('open', ''); },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value: function (this: HTMLDialogElement) { this.removeAttribute('open'); },
  });
  const trigger = document.createElement('button');
  document.body.append(trigger);
  const choose = vi.fn();
  render(<ExercisePicker builder trigger={trigger} fallback={() => trigger}
    equipment={[]} choose={choose} close={() => undefined} />);
  fireEvent.change(screen.getByLabelText('Search exercises'), { target: { value: 'high row' } });
  expect(screen.getByText('Machine · Stack setting · Total reps')).toBeVisible();
  expect(screen.getByText('Machine · Plates per arm · Total reps')).toBeVisible();
  expect(screen.getByText('Machine · Combined plates · Total reps')).toBeVisible();
  expect(screen.getByText('Machine · Plates per arm · Reps per arm')).toBeVisible();
  expect(screen.queryByText(/measurementProfile|repBasis|loadConvention/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /^Single-Arm Iso-Lateral High Row/ }));
  expect(choose.mock.calls[0][0].catalogId).toBe('t2:single-arm-iso-lateral-high-row');
});
