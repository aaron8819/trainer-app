import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { expect as baseExpect } from '@playwright/test';
import type { PrismaClient } from '@prisma/client';
import type { Page } from '@playwright/test';
import { readDraft, createDraft, editDraft } from '../../src/lib/api/trainer2/planning';
import { activatePlan } from '../../src/lib/api/trainer2/activation';
import { readNextWorkout, startOccurrence, readExecution } from '../../src/lib/api/trainer2/execution';
import { finishExecution } from '../../src/lib/api/trainer2/workout-finish';
import { advanceWeek } from '../../src/lib/api/trainer2/advance-week';
import { addExercise } from '../../src/lib/api/trainer2/add-exercise';
import { addSet } from '../../src/lib/api/trainer2/add-set';
import { previewExerciseSwap, swapExercise } from '../../src/lib/api/trainer2/exercise-swap';
import { currentAssignment } from '../../src/lib/engine/trainer2/exercise-swap';
import { reviewedResults } from '../../src/lib/trainer2-contracts/workout-finish';
import { executionPositions } from '../../src/lib/engine/trainer2/execution-targets';
import { catalog } from '../../src/lib/engine/trainer2/catalog';
import program from '../../src/lib/engine/trainer2/program-catalog.json';
import { pounds } from '../../src/components/trainer2/pound-display';
import type { DraftDocument } from '../../src/lib/trainer2-contracts/draft';
import type { ExecutionRead } from '../../src/lib/trainer2-contracts/execution';
import { canonicalJson } from '../../src/lib/trainer2-contracts/canonical-json';
const expect = baseExpect.configure({ timeout: 30_000 });
export async function programSupportJourney({ page, base, artifact, planId: fixturePlan, db, reader, principal, pass }: {
 page: Page; base: string; artifact: string; planId: string; db: PrismaClient; reader: PrismaClient;
 principal: { accountId: string; sessionId: string }; pass: (message: string) => void;
}) {
 const envelope = () => ({ schemaVersion: 1, actionId: randomUUID(), deviceId: randomUUID(), originatingAccountId: principal.accountId, ownershipEpoch: 0, dependsOn: [] });
 const accepted = (response: { outcome: { status: string } }) => assert.equal(response.outcome.status, 'Accepted');
 const read = async (id: string) => (await readExecution(reader, principal, id))!;
 const close = async (e: ExecutionRead) => accepted(await finishExecution(db, principal, { ...envelope(), commandType: 'FinishExecution', target: { executionId: e.executionId }, expected: reviewedResults(await read(e.executionId)), intent: { acknowledgeUnrecorded: true } }));
 const complete = async (id: string) => {
  for (let i = 0; i < 50; i++) {
   const n = await readNextWorkout(reader, principal, id);
   if (n.execution) await close(n.execution);
   else if (n.occurrence) {
    const result = await startOccurrence(db, principal, { ...envelope(), commandType: 'StartOccurrence', target: { planId: id, occurrenceId: n.occurrence.id }, expected: { planRevisionId: n.revisionId, instructionEpoch: 0 }, intent: {} });
    accepted(result); await close(await read(result.outcome.status === 'Accepted' ? result.outcome.result.executionId : ''));
   } else if (n.lifecycle === 'Completed') return;
   else accepted(await advanceWeek(db, principal, { ...envelope(), commandType: 'AdvanceWeek', target: { planId: id }, expected: { planRevisionId: n.revisionId, acceptedSequence: n.acceptedSequence, weekIndex: n.week.index, firstOccurrenceId: n.week.firstOccurrenceId }, intent: {} }));
  }
  throw new Error('Fixture plan did not complete');
 };
 await complete(fixturePlan);
 await page.goto(base + '/trainer2/dev/drafts');
 await page.getByRole('button', { name: 'Customize this template' }).click();
 const entries = [...program.map(e => catalog.find(c => c.id === 't2:' + e.catalogKey)!), catalog.find(c => c.id === 't2:machine-assisted-pull-up')!, catalog.find(c => c.id === 't2:incline-dumbbell-bench-press')!];
 const row = (i: number) => page.getByRole('region', { name: 'Exercise ' + (i + 1), exact: true });
 for (const [i, entry] of entries.entries()) {
  if (i < 5) await row(i).getByRole('button', { name: 'Replace', exact: true }).click();
  else await page.getByRole('button', { name: 'Add exercise', exact: true }).click();
  const picker = page.getByRole('dialog', { name: i < 5 ? 'Swap exercise' : 'Add exercise', exact: true });
  await picker.getByLabel('Search exercises', { exact: true }).fill(entry.name);
  await picker.getByRole('button').filter({ has: page.getByText(entry.name, { exact: true }) }).click();
  await row(i).getByRole('button', { name: 'Edit', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Edit prescription' });
  await sheet.getByLabel('Sets', { exact: true }).fill('2');
  await sheet.getByLabel('Reps from').fill('8'); await sheet.getByLabel('Reps to').fill('8');
  await sheet.getByLabel(/Optional starting/).fill(entry.convention === 'smithPlatesTotal' ? '0' : '42.5');
  if (entry.convention !== 'machinePlatesPerArm' && entry.convention !== 'smithPlatesTotal') {
   await sheet.getByText('Advanced prescription details', { exact: true }).click();
   await expect(sheet.getByLabel('Unit', { exact: true })).toHaveCount(0);
   await sheet.getByLabel('Load or assistance · lb', { exact: true }).fill('10.125000');
  }
  await sheet.getByRole('button', { name: 'Apply changes', exact: true }).click();
 }
 await page.getByLabel('Plan name', { exact: true }).fill('Disposable program support regression');
 await page.getByRole('button', { name: 'Save plan', exact: true }).click();
 await expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible();
 const planId = new URL(page.url()).searchParams.get('planId')!;
 let head = (await readDraft(reader, principal, planId))!;
 let authored = head.intent.occurrences[0].positions;
 assert.deepEqual(authored.map(p => p.exercise.kind === 'catalogSnapshot' ? p.exercise.catalogId : null), entries.map(e => e.id));
 for (const [i, p] of authored.entries()) {
  assert.equal(p.targets[0].reps.basis, entries[i].repBasis);
  assert.equal(p.targets[0].measurement?.convention, entries[i].convention);
  assert.equal(p.targets[0].measurement && 'unit' in p.targets[0].measurement ? p.targets[0].measurement.unit : null, 'lb');
 }
 const bytes = canonicalJson(head.intent);
 await page.reload(); await expect(row(0)).toContainText(entries[0].name);
 assert.equal(canonicalJson((await readDraft(reader, principal, planId))!.intent), bytes);
 await page.screenshot({ path: resolve(artifact, 'program-builder.png'), fullPage: true });
 pass('All nine qualified variants plus assistance and frozen dumbbell snapshot selected, prescribed through Builder, saved and reloaded with exact identities/units/bases');
 // Compatibility kg values come from a synthetic fixture, never a user kg workflow.
 const builder = structuredClone(head.intent.builder!);
 for (const row of builder.workouts[0].rows) {
  const m = row.prescription.measurement;
  if (m && m.kind !== 'bodyweight' && m.convention !== 'machinePlatesPerArm' && m.convention !== 'smithPlatesTotal') m.unit = 'kg';
 }
 accepted(await editDraft(db, principal, { ...envelope(), commandType: 'EditDraft', target: { planId },
  expected: { planRevisionId: head.revisionId }, intent: { operations: [{ op: 'editWorkoutDefaults', builder }] } }));
 head = (await readDraft(reader, principal, planId))!; authored = head.intent.occurrences[0].positions;
 accepted(await activatePlan(db, principal, { ...envelope(), commandType: 'ActivatePlan', target: { planId }, expected: { planRevisionId: head.revisionId }, intent: { reviewed: head.activation } }));
 const started = await startOccurrence(db, principal, { ...envelope(), commandType: 'StartOccurrence', target: { planId, occurrenceId: head.intent.occurrences[0].id }, expected: { planRevisionId: head.revisionId, instructionEpoch: head.activation.instructions.epoch }, intent: {} });
 accepted(started); if (started.outcome.status !== 'Accepted') throw new Error('Start failed');
 const executionId = started.outcome.result.executionId;
 await page.goto(base + '/trainer2/dev/executions/' + executionId);
 const active = page.getByRole('region', { name: 'Active set', exact: true });
 const queue = page.getByRole('region', { name: 'Exercise queue' });
 // Restore a swapped position to its exact prescribed kg tuple before any new result.
 let e = await read(executionId); const positionId = e.initial.positions[1].id;
 for (const intent of [{ restoreOriginal: false as const, catalogId: entries[0].id }, { restoreOriginal: true as const }]) {
  const preview = (await previewExerciseSwap(reader, principal, { executionId, positionId, intent }))!;
  accepted(await swapExercise(db, principal, { ...envelope(), commandType: 'SwapExercise', target: { executionId, positionId }, expected: { contentHash: preview.contentHash, assignment: preview.assignment, instructionEpoch: preview.instructionEpoch, effectiveHash: preview.effectiveHash }, intent }));
 }
 for (const [i, p] of authored.entries()) {
  await queue.getByRole('button', { name: new RegExp(p.exercise.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ', set 1, unrecorded') }).click();
  const m = p.targets[0].measurement!; assert('value' in m);
  await expect(active.getByLabel('Set 1 Actual load', { exact: true })).toHaveValue(pounds(m.value, m.unit));
  if (i === 0) await active.getByLabel('Set 1 Actual load', { exact: true }).fill('25.125');
  await active.getByLabel('Set 1 Actual reps', { exact: true }).fill('8');
  await active.getByRole('button', { name: '2 RIR', exact: true }).click();
  await active.getByRole('button', { name: 'Log set', exact: true }).click();
  await expect(active.getByLabel('Set 2 Actual load', { exact: true })).toHaveValue(i === 0 ? '25.125' : pounds(m.value, m.unit));
  await expect(active.getByLabel('Set 2 Actual reps', { exact: true })).toHaveValue('8');
  await expect(active.getByLabel('Set 2 Actual RIR (optional)', { exact: true })).toHaveValue('2');
  const e = await read(executionId), owned = executionPositions(e)[i];
  assert.deepEqual(e.results.find(r => r.targetId === owned.targets[0].id)!.result!.measurement, i === 0 ? { ...m, value: '25.125', unit: 'lb' } : m);
 }
 pass('First-set exact prefill, untouched decimal kg, edited lbs, assistance, per-arm plates, zero Smith plates and per-side reps; subsequent sets copy actual load/reps/RIR');
 e = await read(executionId);
 accepted(await addExercise(db, principal, { ...envelope(), commandType: 'AddExercise', target: { executionId }, expected: { contentHash: e.contentHash }, intent: { catalogId: entries[3].id, sets: 1, reps: { min: 8, max: 8, basis: entries[3].repBasis }, rir: '2', startingLoad: authored[3].targets[0].measurement } }));
 e = await read(executionId); const addition = e.exerciseAdditions![0];
 accepted(await addSet(db, principal, { ...envelope(), commandType: 'AddSet', target: { executionId, positionId: addition.content.position.id }, expected: { contentHash: e.contentHash, assignment: currentAssignment(e, addition.content.position.id) }, intent: {} }));
 await page.reload();
 await queue.getByRole('button', { name: new RegExp(addition.content.position.exercise.name + ', set 1, unrecorded') }).last().click();
 await expect(active.getByLabel('Set 1 Actual load', { exact: true })).toHaveValue('22.32');
 await active.getByLabel('Set 1 Actual reps', { exact: true }).fill('8');
 await active.getByRole('button', { name: 'Log set', exact: true }).click();
 await expect(active.getByLabel('Set 2 Actual load', { exact: true })).toHaveValue('22.32');
 await page.setViewportSize({ width: 390, height: 844 });
 await page.screenshot({ path: resolve(artifact, 'program-logger-mobile.png'), fullPage: true });
 pass('New definitions accepted in swap/restore and execution Add exercise/Add set; exact added kg prefill and carry-forward');
 await close(await read(executionId)); await complete(planId);
 // A new local independent plan tests history with blank prescribed measurements.
 const stageId = randomUUID();
 const nextIntent: DraftDocument = { schemaVersion: 1, name: 'Disposable history follow-up', progression: { version: 1, mode: 'plannedPrescriptions', scope: 'wholePlan', parameters: {} }, endpoint: 'endOfOrderedOccurrences', stages: [{ id: stageId, name: 'History' }], occurrences: [{ id: randomUUID(), stageId, name: 'History', positions: authored.map(p => ({ id: randomUUID(), exercise: p.exercise, targets: [{ ...p.targets[0], id: randomUUID(), measurement: null }] })) }] };
 const nextPlan = randomUUID(); accepted(await createDraft(db, principal, { ...envelope(), commandType: 'CreateDraft', target: { planId: nextPlan }, expected: {}, intent: nextIntent }));
 const nextHead = (await readDraft(reader, principal, nextPlan))!;
 accepted(await activatePlan(db, principal, { ...envelope(), commandType: 'ActivatePlan', target: { planId: nextPlan }, expected: { planRevisionId: nextHead.revisionId }, intent: { reviewed: nextHead.activation } }));
 const nextStarted = await startOccurrence(db, principal, { ...envelope(), commandType: 'StartOccurrence', target: { planId: nextPlan, occurrenceId: nextIntent.occurrences[0].id }, expected: { planRevisionId: nextHead.revisionId, instructionEpoch: nextHead.activation.instructions.epoch }, intent: {} });
 accepted(nextStarted); if (nextStarted.outcome.status !== 'Accepted') throw new Error('Start failed');
 await page.goto(base + '/trainer2/dev/executions/' + nextStarted.outcome.result.executionId);
 await expect(active.getByLabel('Set 1 Actual load', { exact: true })).toHaveValue('25');
 await active.getByRole('button', { name: 'History', exact: true }).click();
 await expect(page.getByRole('dialog', { name: 'Exercise history' })).toContainText('25.125');
 await page.getByRole('dialog', { name: 'Exercise history' }).press('Escape');
 // Cable lateral raise now has two matching source positions, so no guessed history.
 await queue.getByRole('button', { name: new RegExp(entries[3].name + ', set 1, unrecorded') }).click();
 await expect(active.getByLabel('Set 1 Actual load', { exact: true })).toHaveValue('');
 pass('Blank prescribed load uses rounded history suggestion separately; exact performed history retained; duplicate source identity produces no guessed cable load');
}
