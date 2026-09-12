import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createDraftCommand, editDraftCommand, type DraftDocument } from '@/lib/trainer2-contracts/draft';
import { editDocument, identities } from '@/lib/engine/trainer2/planning';
import { DraftWorkbench } from './DraftWorkbench';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState(null, '', '/'); });
it('prefills before persistence, adds recurring work, saves week overrides and reopens without identity changes', async () => {
  let doc: DraftDocument; const history = new Set<string>(); let posts = 0;
  const planId = crypto.randomUUID(), revisionId = crypto.randomUUID();
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      const raw = JSON.parse(String(init.body));
      const cmd = raw.commandType === 'CreateDraft' ? createDraftCommand.parse(raw) : editDraftCommand.parse(raw);
      doc = cmd.commandType === 'CreateDraft' ? cmd.intent : editDocument(doc, cmd, history);
      identities(doc).forEach(i => history.add(i.id)); posts++;
      return { ok: true, json: async () => ({ outcome: { status: 'Accepted', result: { planId } } }) };
    }
    return { ok: true, json: async () => ({ planId, revisionId, revisionNumber: posts, intent: doc }) };
  }));
  const button = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
  const fill = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
  const save = async () => { button('Save plan'); await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/^Saved$/)); };
  render(<DraftWorkbench accountId="test" ownershipEpoch={0} />);
  expect(screen.getAllByRole('tab')).toHaveLength(4); expect(posts).toBe(0);
  expect(screen.getByText('4 training weeks + 1 deload week')).toBeVisible();
  fill('Build Lower A · add your first exercise', 'Squat'); button('Add exercise'); await save();
  const initial = structuredClone(doc!);
  expect(initial.occurrences.filter(o => o.name === 'Lower A').map(o => o.positions[0].targets.length)).toEqual([3,3,3,3,2]);
  button('View all 5 weeks'); button('Week 2');
  fill('Reps from', '10'); button('Edit across plan'); fill('Exercise 1 name', 'Front squat'); await save();
  expect(doc!.occurrences[4].positions[0].exercise.name).toBe('Squat');
  expect(doc!.occurrences[4].positions[0].targets[0].reps.min).toBe(10);
  expect(doc!.occurrences[8].positions[0].exercise.name).toBe('Front squat');
  expect(identities(doc!)).toEqual(identities(initial));
  button('Save plan'); expect(posts).toBe(2);
  const final = structuredClone(doc!);
  cleanup(); render(<DraftWorkbench accountId="test" ownershipEpoch={0} initialPlanId={planId} />);
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/^Saved$/));
  expect(doc!).toEqual(final); expect(screen.getByLabelText('Exercise 1 name')).toHaveValue('Front squat');
  button('View all 5 weeks'); button('Week 2'); button('Restore workout defaults');
  expect(screen.getByText(/Week-only changes will be removed/)).toBeVisible(); button('Restore defaults'); await save();
  expect(doc!.occurrences[4].positions[0].exercise.name).toBe('Front squat');
  expect(doc!.occurrences[4].positions[0].id).toBe(final.occurrences[4].positions[0].id);
});
