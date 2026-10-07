import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { expect as baseExpect, type Page } from '@playwright/test';
import type { PrismaClient } from '@prisma/client';
import { createHypertrophyPlan, expandWorkoutDefaults, newRow, markOverride } from '../../src/lib/engine/trainer2/plan-builder';
import { catalog, catalogExercise } from '../../src/lib/engine/trainer2/catalog';
import { readDraft } from '../../src/lib/api/trainer2/planning';
import { activatePlan } from '../../src/lib/api/trainer2/activation';
import { readExecution, readNextWorkout, startOccurrence } from '../../src/lib/api/trainer2/execution';
import { readExecutionWithPrevious } from '../../src/lib/api/trainer2/previous-performance';
import { finishExecution } from '../../src/lib/api/trainer2/workout-finish';
import { skipOccurrence } from '../../src/lib/api/trainer2/skip-occurrence';
import { advanceWeek } from '../../src/lib/api/trainer2/advance-week';
import { reviewedResults } from '../../src/lib/trainer2-contracts/workout-finish';

const expect = baseExpect.configure({ timeout: 30_000 });
const variants = ['hack-squat-plates-added', 'seated-calf-raise-plates-added', 'smith-machine-standing-calf-raise-plates-added', 'iso-lateral-low-row-plates-per-arm'];
const values = ['0.000000', '50.125000', '0', '45'];
export function equipmentFixturePlan() {
  let doc = createHypertrophyPlan(undefined, true);
  for (const workout of doc.builder!.workouts) workout.rows = variants.map((id, i) => {
    const row = newRow(id), entry = catalog.find(e => e.id === `t2:${id}`)!;
    row.exercise = catalogExercise(entry); row.sets = 1;
    row.prescription.measurement = { kind: 'externalLoad', value: values[i], unit: 'lb',
      convention: entry.convention as 'machineAddedPlatesTotal' | 'smithPlatesTotal' | 'machinePlatesPerArm', zeroMeaning: 'validZero' };
    return row;
  });
  doc = expandWorkoutDefaults(doc);
  // Second rotation has explicit blank loads so history supplies suggestions.
  for (const p of doc.occurrences[4].positions) {
    p.targets.forEach(t => { t.measurement = null; });
    markOverride(doc.occurrences[4], p.id, ['measurement'], { measurement: null });
  }
  return expandWorkoutDefaults(doc);
}
export async function equipmentJourney({ page, base, home, artifact, accountId, planId, db, reader, principal, pass }: {
  page: Page; base: string; home: string; artifact: string; accountId: string; planId: string; executionId: string;
  pass: (value: string) => void; db: PrismaClient; reader: PrismaClient; principal: { accountId: string; sessionId: string };
}) {
  const envelope = () => ({ schemaVersion: 1, actionId: randomUUID(), deviceId: randomUUID(), originatingAccountId: accountId, ownershipEpoch: 0, dependsOn: [] });
  const accepted = <T>(response: { outcome: { status: string; result?: T } }): T => { assert.equal(response.outcome.status, 'Accepted'); return response.outcome.result!; };
  await page.goto(home);
  const card = page.getByRole('region', { name: 'Exercise 1', exact: true });
  await card.getByText('Equipment starting resistance', { exact: true }).click();
  await expect(card.getByLabel('Starting resistance · lb')).toHaveValue('');
  await card.getByLabel('Equipment identifier').fill('Disposable identified hack machine');
  await card.getByLabel('Starting resistance · lb').fill('105');
  await card.getByRole('button', { name: 'Apply equipment details' }).click();
  await expect(card).toContainText('Starting resistance: 105 lb · separate from added plates');
  await card.getByRole('button', { name: 'Edit', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Edit prescription' });
  await expect(sheet.getByLabel('Optional starting load · lbs')).toHaveValue('0.000000');
  await sheet.getByRole('button', { name: 'Apply changes' }).click();
  const [saveResponse] = await Promise.all([page.waitForResponse(r => r.url().endsWith('/api/trainer2/drafts/edit') && r.request().method() === 'POST'), page.getByRole('button', { name: 'Save plan', exact: true }).click()]);
  assert.equal((await saveResponse.json()).outcome.status, 'Accepted');
  await expect(page.getByRole('button', { name: 'Save plan', exact: true })).toBeDisabled();
  const saved = (await readDraft(reader, principal, planId))!;
  const first = saved.intent.occurrences[0].positions[0];
  assert.equal(first.exercise.kind === 'catalogSnapshot' && first.exercise.equipmentSetup?.startingResistance.value, '105');
  assert.equal(first.targets[0].measurement && 'value' in first.targets[0].measurement && first.targets[0].measurement.value, '0.000000');
  pass('Builder saved identified 105 lb separately from exact zero added plates');
  accepted(await activatePlan(db, principal, { ...envelope(), commandType: 'ActivatePlan', target: { planId }, expected: { planRevisionId: saved.revisionId }, intent: { reviewed: saved.activation } }));
  const start = async (index: number) => accepted(await startOccurrence(db, principal, { ...envelope(), commandType: 'StartOccurrence', target: { planId, occurrenceId: saved.intent.occurrences[index].id }, expected: { planRevisionId: saved.revisionId, instructionEpoch: 0 }, intent: {} }));
  const finish = async (executionId: string) => accepted(await finishExecution(db, principal, { ...envelope(), commandType: 'FinishExecution', target: { executionId }, expected: reviewedResults((await readExecution(reader, principal, executionId))!), intent: { acknowledgeUnrecorded: true } }));
  const initial = await start(0);
  await page.goto(`${base}/trainer2/dev/executions/${initial.executionId}`);
  const active = page.getByRole('region', { name: 'Active set' });
  for (let i = 0; i < variants.length; i++) {
    await expect(active.getByRole('heading', { name: firstName(i), exact: true })).toBeVisible();
    await expect(active.getByLabel('Set 1 Actual load', { exact: true })).toHaveValue(values[i]);
    if (i === 0) await expect(active).toContainText('Starting resistance: 105 lb');
    await active.getByLabel('Set 1 Actual reps', { exact: true }).fill('10');
    await active.getByRole('button', { name: 'Log set', exact: true }).click();
    await expect.poll(async () => (await readExecution(reader, principal, initial.executionId))!.results.length).toBe(i + 1);
  }
  const recorded = (await readExecution(reader, principal, initial.executionId))!;
  for (let i = 0; i < variants.length; i++) {
    const targetId = recorded.initial.positions[i].targets[0].id;
    assert.deepEqual(recorded.results.find(r => r.targetId === targetId)!.result!.measurement, saved.intent.occurrences[0].positions[i].targets[0].measurement);
  }
  assert.deepEqual(recorded.initial.occurrence.positions[0].exercise, first.exercise);
  pass('Logger persisted exact total plates, zero Smith plates and 45 per arm without adding resistance');
  await finish(initial.executionId); await page.reload();
  await expect(page.getByRole('heading', { name: 'Workout finished', exact: true })).toBeVisible();
  await expect(page.getByText(/Starting resistance: 105 lb/).first()).toBeVisible();
  await page.screenshot({ path: resolve(artifact, 'equipment-history.png'), fullPage: true });
  pass('Completed history retains and separately displays equipment-specific resistance');
  for (let index = 1; index < 4; index++) accepted(await skipOccurrence(db, principal, { ...envelope(), commandType: 'SkipOccurrence', target: { planId, occurrenceId: saved.intent.occurrences[index].id }, expected: { planRevisionId: saved.revisionId, acceptedSequence: (await readNextWorkout(reader, principal, planId)).acceptedSequence }, intent: {} }));
  const next = await readNextWorkout(reader, principal, planId);
  accepted(await advanceWeek(db, principal, { ...envelope(), commandType: 'AdvanceWeek', target: { planId }, expected: { planRevisionId: saved.revisionId, acceptedSequence: next.acceptedSequence, weekIndex: next.week.index, firstOccurrenceId: next.week.firstOccurrenceId }, intent: {} }));
  const later = await start(4);
  const enriched = await reader.$transaction(tx => readExecutionWithPrevious(tx, principal, later.executionId));
  assert.equal(enriched!.firstSetLoads!.length, 4); assert.equal(enriched!.previous!.length, 4);
  assert(enriched!.initial.occurrence.positions.every(p => p.targets[0].measurement === null));
  await page.goto(`${base}/trainer2/dev/executions/${later.executionId}`);
  await expect(active.getByLabel('Set 1 Actual load', { exact: true })).toHaveValue('0');
  await active.getByRole('button', { name: 'History', exact: true }).click();
  const history = page.getByRole('dialog', { name: 'Exercise history' });
  await expect(history).toContainText('105 lb'); await expect(history).toContainText('total machine plates added');
  await page.screenshot({ path: resolve(artifact, 'equipment-prefill.png'), fullPage: true });
  pass('Next rotation blank load receives compatible zero-plate history, with separate resistance metadata');
}
function firstName(index: number) { return catalog.find(e => e.id === `t2:${variants[index]}`)!.name; }
