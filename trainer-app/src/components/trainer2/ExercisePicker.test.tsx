import { cleanup, render, waitFor } from '@testing-library/react';
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
