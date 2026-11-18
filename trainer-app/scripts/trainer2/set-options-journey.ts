import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { expect as baseExpect, type Page } from '@playwright/test';
import type { PrismaClient } from '@prisma/client';
import { createDraft, readDraft } from '../../src/lib/api/trainer2/planning';
import { activatePlan } from '../../src/lib/api/trainer2/activation';
import { startOccurrence, readExecution, readNextWorkout } from '../../src/lib/api/trainer2/execution';
import { skipOccurrence } from '../../src/lib/api/trainer2/skip-occurrence';
import { advanceWeek } from '../../src/lib/api/trainer2/advance-week';
import { finishExecution } from '../../src/lib/api/trainer2/workout-finish';
import { executionPositions } from '../../src/lib/engine/trainer2/execution-targets';
import { reviewedResults } from '../../src/lib/trainer2-contracts/workout-finish';
import { acceptedFixtureResult as accepted } from '../../src/lib/operations/trainer2-fixture';

const expect = baseExpect.configure({ timeout: 30_000 });
// Runs only inside the existing disposable logger fixture, never against user data.
export async function setOptionsJourney({ page, base, artifact, planId: previousPlanId, db, reader, principal, pass }: {
  page: Page; base: string; artifact: string; planId: string; db: PrismaClient; reader: PrismaClient;
  principal: { accountId: string; sessionId: string }; pass: (message: string) => void;
}) {
  const envelope = () => ({ schemaVersion: 1, actionId: randomUUID(), deviceId: randomUUID(), originatingAccountId: principal.accountId, ownershipEpoch: 0, dependsOn: [] });
  // Resolve the earlier synthetic fixture through public owners before activation.
  for (let i = 0; i < 30; i++) {
    const next = await readNextWorkout(reader, principal, previousPlanId);
    if (next.lifecycle === 'Completed') break;
    if (next.occurrence) accepted(await skipOccurrence(db, principal, { ...envelope(), commandType: 'SkipOccurrence', target: { planId: previousPlanId, occurrenceId: next.occurrence.id }, expected: { planRevisionId: next.revisionId, acceptedSequence: next.acceptedSequence }, intent: {} }));
    else accepted(await advanceWeek(db, principal, { ...envelope(), commandType: 'AdvanceWeek', target: { planId: previousPlanId }, expected: { planRevisionId: next.revisionId, acceptedSequence: next.acceptedSequence, weekIndex: next.week.index, firstOccurrenceId: next.week.firstOccurrenceId }, intent: {} }));
  }
  const stageId = randomUUID(), planId = randomUUID();
  const intent = { schemaVersion: 1, name: 'Remember calf raise options', endpoint: 'endOfOrderedOccurrences', stages: [{ id: stageId, name: 'Training' }], occurrences: [0, 1].map(i => ({ id: randomUUID(), stageId, name: `Workout ${i + 1}`, positions: [{ id: randomUUID(), exercise: { kind: 'authoredDescription', name: 'Standing calf raise (machine/load to calibrate)', variation: 'Standing' }, targets: [0, 1, 2].map(() => ({ id: randomUUID(), classification: 'working', required: true, reps: { min: 10, max: 15, basis: 'total' }, measurement: null, rir: '3', restSeconds: '120' })) }] })) };
  accepted(await createDraft(db, principal, { ...envelope(), commandType: 'CreateDraft', target: { planId }, expected: {}, intent }));
  const head = (await readDraft(reader, principal, planId))!;
  accepted(await activatePlan(db, principal, { ...envelope(), commandType: 'ActivatePlan', target: { planId }, expected: { planRevisionId: head.revisionId }, intent: { reviewed: head.activation } }));
  const start = async (index: number) => accepted(await startOccurrence(db, principal, { ...envelope(), commandType: 'StartOccurrence', target: { planId, occurrenceId: intent.occurrences[index].id }, expected: { planRevisionId: head.revisionId, instructionEpoch: 0 }, intent: {} }));
  const first = await start(0);
  await page.goto(`${base}/trainer2/dev/executions/${first.executionId}`);
  const active = page.getByRole('region', { name: 'Active set' });
  await page.getByText('Set options', { exact: true }).click();
  await page.getByLabel('Set 1 actual load type').selectOption('externalLoad');
  await page.getByLabel('Set 1 load basis').selectOption('machineDisplayed');
  await active.getByLabel('Set 1 Actual reps', { exact: true }).fill('12');
  await active.getByRole('button', { name: 'Log set', exact: true }).click();
  await expect(active.getByLabel('Set 2 Actual load', { exact: true })).toHaveValue('');
  await page.reload();
  await expect(active.getByLabel('Set 2 Actual load', { exact: true })).toHaveValue('');
  await active.getByLabel('Set 2 Actual load', { exact: true }).fill('100');
  await active.getByRole('button', { name: 'Log set', exact: true }).click();
  await expect(active.getByLabel('Set 3 Actual load', { exact: true })).toHaveValue('100');
  await page.getByText('Set options', { exact: true }).click();
  await page.getByLabel('Set 3 load basis').selectOption('machineAddedPlatesTotal');
  const logged = page.waitForResponse(r => r.url().endsWith('/api/trainer2/executions/results') && r.request().method() === 'POST');
  await active.getByRole('button', { name: 'Log set', exact: true }).click();
  assert((await logged).ok());
  await expect(active.getByRole('heading', { name: 'Ready to finish' })).toBeVisible();
  const before = (await readExecution(reader, principal, first.executionId))!;
  const firstResult = before.results.find(r => r.targetId === executionPositions(before)[0].targets[0].id)!;
  assert.equal(firstResult.result?.measurement, null);
  assert.equal(firstResult.result?.loggingOptions?.convention, 'machineDisplayed');
  accepted(await finishExecution(db, principal, { ...envelope(), commandType: 'FinishExecution', target: { executionId: first.executionId }, expected: reviewedResults(before), intent: { acknowledgeUnrecorded: true } }));
  const second = await start(1);
  await page.goto(`${base}/trainer2/dev/executions/${second.executionId}`);
  await expect(active).toContainText('Total plates added (lb)');
  await expect(active.getByLabel('Set 1 Actual load', { exact: true })).toHaveValue('');
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: resolve(artifact, `remembered-set-options-${width}.png`), fullPage: true });
  }
  assert.deepEqual((await readExecution(reader, principal, first.executionId))!.results, before.results);
  pass('Authored calf options survive blank-weight log, next sets, reload, intentional basis change and next workout; original results unchanged');
}
