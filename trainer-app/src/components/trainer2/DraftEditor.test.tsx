import { reviewActivation } from '@/lib/api/trainer2/instructions';
import { emptyInstructions } from '@/lib/trainer2-contracts/activation';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createDraftCommand, editDraftCommand, type DraftDocument } from '@/lib/trainer2-contracts/draft';
import { editDocument, identities } from '@/lib/engine/trainer2/planning';
import { DraftWorkbench } from './DraftWorkbench';
import { PlanBuilder } from './PlanBuilder';
import { createHypertrophyPlan } from '@/lib/engine/trainer2/plan-builder';
import { draftDocument } from '@/lib/trainer2-contracts/draft';
import { webcrypto } from 'node:crypto';
import { canonicalJson, integrityHash } from '@/lib/api/trainer2/integrity';
import { reviewPlan, REVIEW_POLICY } from '@/lib/engine/trainer2/plan-review';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState(null, '', '/'); });
it('reorders older independent workouts without inventing field provenance', () => {
  const doc = createHypertrophyPlan(); doc.occurrences[0].weekOverride = true;
  const changed = vi.fn(); render(<PlanBuilder document={doc} disabled={false} onChange={changed} />);
  fireEvent.change(screen.getByLabelText('Edit scope'), { target: { value: '0' } });
  fireEvent.click(screen.getAllByRole('button', { name: 'Move down' })[0]);
  const result = draftDocument.parse(changed.mock.calls[0][0]);
  expect(result.occurrences[0].weekOverride).toBe(true);
  expect(result.occurrences[0].overrides).toBeUndefined();
  expect(result.occurrences[0].positions[1].id).toBe(doc.occurrences[0].positions[0].id);
});
it('prefills before persistence, adds recurring work, saves week overrides and reopens without identity changes', async () => {
  vi.stubGlobal('crypto', webcrypto);
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
    const issues = reviewPlan(doc);
    const binding = { accountId: 'test', planId, revisionId, contentHash: integrityHash(canonicalJson(doc)),
      progression: doc.progression ?? null, progressionHash: integrityHash(canonicalJson(doc.progression ?? null)), policyVersion: REVIEW_POLICY } as const;
    const review = { ...binding, intent: doc, issues, status: issues.length ? 'issues' as const : 'validDraft' as const, digest: integrityHash(canonicalJson(binding)) };
    const activation = reviewActivation(review, { epoch: 0, revisionId: null, document: emptyInstructions(), contentHash: integrityHash(canonicalJson(emptyInstructions())) });
    return { ok: true, json: async () => ({ state: { lifecycle: 'Draft', initialApprovedRevisionId: null }, activation, planId, revisionId, revisionNumber: posts, intent: doc, contentHash: binding.contentHash,
      activationBlockers: issues.map(i => i.code),
      review: { ...binding, intent: doc, issues, status: issues.length ? 'issues' : 'validDraft', digest: integrityHash(canonicalJson(binding)) } }) };
  }));
  const button = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
  const fill = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
  const save = async () => { button('Save plan'); await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/^Saved$/)); };
  render(<DraftWorkbench accountId="test" ownershipEpoch={0} />);
  expect(screen.getAllByRole('tab')).toHaveLength(4); expect(posts).toBe(0);
  expect(screen.getByText('4 training weeks + 1 deload week')).toBeVisible();
  expect(screen.getByRole('button', {name:'Barbell Back Squat'})).toBeVisible(); await save();
  const initial = structuredClone(doc!);
  expect(initial.occurrences.filter(o => o.name === 'Lower A').map(o => o.positions[0].targets.length)).toEqual([3,3,3,3,2]);
  fill('Edit scope','1'); fill('Exercise 1 reps min','7');
  fill('Edit scope','all'); fill('Exercise 1 reps min','8'); await save();
  expect(doc!.occurrences[4].positions[0].targets[0].reps.min).toBe(7);
  expect(doc!.occurrences[8].positions[0].targets[0].reps.min).toBe(8);
  expect(identities(doc!)).toEqual(identities(initial));
  button('Save plan'); expect(posts).toBe(2);
  const final = structuredClone(doc!);
  cleanup(); render(<DraftWorkbench accountId="test" ownershipEpoch={0} initialPlanId={planId} />);
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/^Saved$/));
  expect(doc!).toEqual(final); expect(screen.getByLabelText('Exercise 1 reps min')).toHaveValue(8);
  fill('Edit scope','1');button('Reset reps override');await save();
  expect(doc!.occurrences[4].positions[0].targets[0].reps.min).toBe(8);
  expect(doc!.occurrences[4].positions[0].id).toBe(final.occurrences[4].positions[0].id);
}, 20000);
