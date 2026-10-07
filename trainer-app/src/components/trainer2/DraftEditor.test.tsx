import { reviewActivation } from '@/lib/api/trainer2/instructions';
import { emptyInstructions } from '@/lib/trainer2-contracts/activation';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createDraftCommand, editDraftCommand, type DraftDocument } from '@/lib/trainer2-contracts/draft';
import { editDocument, identities } from '@/lib/engine/trainer2/planning';
import { DraftWorkbench } from './DraftWorkbench';
import { PlanBuilder } from './PlanBuilder';
import { createHypertrophyPlan } from '@/lib/engine/trainer2/plan-builder';
import { draftDocument } from '@/lib/trainer2-contracts/draft';
import { webcrypto } from 'node:crypto';
import { canonicalJson, integrityHash } from '@/lib/api/trainer2/integrity';
import { reviewPlan, REVIEW_POLICY } from '@/lib/engine/trainer2/plan-review';
import { TargetFields } from './DraftEditor';
import { loadLabel } from './pound-display';
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute('open', ''); } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute('open'); } });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState(null, '', '/'); });
it('advanced fields display legacy masses in lb and preserve meaning when the load is edited', () => {
  const measurements = [
    { kind: 'externalLoad' as const, convention: 'barbellTotal' as const, zeroMeaning: 'notAllowed' as const },
    { kind: 'externalLoad' as const, convention: 'perImplement' as const, zeroMeaning: 'notAllowed' as const },
    { kind: 'externalLoad' as const, convention: 'machinePlatesPerArm' as const, zeroMeaning: 'validZero' as const },
    { kind: 'externalLoad' as const, convention: 'smithPlatesTotal' as const, zeroMeaning: 'validZero' as const },
    { kind: 'addedLoad' as const, convention: 'addedExternal' as const, zeroMeaning: 'noAddedLoad' as const },
    { kind: 'assistance' as const, convention: 'displayedAssistance' as const, zeroMeaning: 'noAssistance' as const },
  ];
  for (const measurement of measurements) {
    const target = { ...createHypertrophyPlan().occurrences[0].positions[0].targets[0],
      measurement: { ...measurement, value: '60.123456', unit: 'kg' as const } };
    const original = structuredClone(target); const change = vi.fn();
    const view = render(<TargetFields target={target} change={change} />);
    expect(screen.getByLabelText('Load or assistance · lb')).toHaveValue('132.55');
    expect(view.container.textContent).not.toMatch(/\bkg\b/);
    expect(screen.queryByRole('combobox', { name: 'Unit' })).toBeNull();
    expect(loadLabel(target.measurement)).toContain('132.55 lb');
    fireEvent.change(screen.getByLabelText('Load or assistance · lb'), { target: { value: '132.5' } });
    expect(target).toEqual(original);
    change.mock.calls[0][0](target);
    expect(target.measurement).toEqual({ ...original.measurement, value: '132.5', unit: 'lb' });
    view.unmount();
  }
});
it('advanced fields initialize all numeric measurement kinds in lb', () => {
  for (const kind of ['externalLoad', 'addedLoad', 'assistance']) {
    const target = { ...createHypertrophyPlan().occurrences[0].positions[0].targets[0], measurement: null };
    const change = vi.fn(); const view = render(<TargetFields target={target} change={change} />);
    fireEvent.change(screen.getByLabelText('Measurement kind'), { target: { value: kind } });
    change.mock.calls[0][0](target);
    expect(target.measurement).toMatchObject({ kind, unit: 'lb' }); view.unmount();
  }
});
it('reorders older independent workouts without inventing field provenance', () => {
  const doc = createHypertrophyPlan(); doc.occurrences[0].weekOverride = true;
  const changed = vi.fn(); render(<PlanBuilder document={doc} disabled={false} onChange={changed} />);
  fireEvent.change(screen.getByLabelText('Edit scope'), { target: { value: '0' } });
  fireEvent.click(screen.getByRole('button', { name: `Move ${doc.occurrences[0].positions[0].exercise.name} down` }));
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
  expect(posts).toBe(0);
  button('Customize this template');
  expect(screen.getAllByRole('tab')).toHaveLength(4); expect(posts).toBe(0);
  expect(screen.getByText('4 accumulation + 1 deload')).toBeVisible();
  expect(screen.getByRole('heading', {name:'Barbell Back Squat'})).toBeVisible(); await save();
  const initial = structuredClone(doc!);
  expect(initial.occurrences.filter(o => o.name === 'Lower A').map(o => o.positions[0].targets.length)).toEqual([3,3,3,3,2]);
  const openFirstPrescription = () => fireEvent.click(within(screen.getByRole('region', { name: 'Exercise 1' })).getByRole('button', { name: 'Edit' }));
  const editFirstReps = (value: string) => { openFirstPrescription(); fill('Reps from', value); button('Apply changes'); };
  fill('Edit scope','1'); editFirstReps('7');
  fill('Edit scope','all'); editFirstReps('8'); await save();
  expect(doc!.occurrences[4].positions[0].targets[0].reps.min).toBe(7);
  expect(doc!.occurrences[8].positions[0].targets[0].reps.min).toBe(8);
  expect(identities(doc!)).toEqual(identities(initial));
  button('Save plan'); expect(posts).toBe(2);
  const final = structuredClone(doc!);
  cleanup(); render(<DraftWorkbench accountId="test" ownershipEpoch={0} initialPlanId={planId} />);
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/^Saved$/));
  expect(doc!).toEqual(final); openFirstPrescription(); expect(screen.getByLabelText('Reps from')).toHaveValue(8); button('Cancel edits');
  fill('Edit scope','1'); fireEvent.click(within(screen.getByRole('region', { name: 'Exercise 1' })).getByText('Role & inheritance details')); button('Reset reps override');await save();
  expect(doc!.occurrences[4].positions[0].targets[0].reps.min).toBe(8);
  expect(doc!.occurrences[4].positions[0].id).toBe(final.occurrences[4].positions[0].id);
}, 20000);
