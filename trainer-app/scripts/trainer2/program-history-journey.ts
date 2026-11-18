import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { expect as baseExpect, type Page } from '@playwright/test';
import type { PrismaClient } from '@prisma/client';
import { readNextWorkout, readExecution, startOccurrence } from '../../src/lib/api/trainer2/execution';
import { finishExecution } from '../../src/lib/api/trainer2/workout-finish';
import { advanceWeek } from '../../src/lib/api/trainer2/advance-week';
import { reviewedResults } from '../../src/lib/trainer2-contracts/workout-finish';
import { createDraft, readDraft } from '../../src/lib/api/trainer2/planning';
import { activatePlan } from '../../src/lib/api/trainer2/activation';
import { createHypertrophyPlan } from '../../src/lib/engine/trainer2/plan-builder';

const expect = baseExpect.configure({ timeout: 30_000 });
// Called only by the existing confirmed disposable navigation fixture.
export async function programHistoryJourney({ page, base, artifact, db, reader, principal, planId, pass }: {
  page: Page; base: string; artifact: string; db: PrismaClient; reader: PrismaClient;
  principal: { accountId: string; sessionId: string }; planId: string; pass: (message: string) => void;
}) {
  const envelope = () => ({ schemaVersion: 1, actionId: randomUUID(), deviceId: randomUUID(),
    originatingAccountId: principal.accountId, ownershipEpoch: 0, dependsOn: [] });
  const accepted = (response: { outcome: { status: string } }) => assert.equal(response.outcome.status, 'Accepted');
  for (let i = 0; i < 100; i++) {
    const next = await readNextWorkout(reader, principal, planId);
    if (next.lifecycle === 'Completed') break;
    if (next.execution) {
      const execution = (await readExecution(reader, principal, next.execution.executionId))!;
      accepted(await finishExecution(db, principal, { ...envelope(), commandType: 'FinishExecution',
        target: { executionId: execution.executionId }, expected: reviewedResults(execution),
        intent: { acknowledgeUnrecorded: true } }));
    } else if (next.occurrence) {
      accepted(await startOccurrence(db, principal, { ...envelope(), commandType: 'StartOccurrence',
        target: { planId, occurrenceId: next.occurrence.id },
        expected: { planRevisionId: next.revisionId, instructionEpoch: next.instructionEpoch }, intent: {} }));
    } else {
      accepted(await advanceWeek(db, principal, { ...envelope(), commandType: 'AdvanceWeek', target: { planId },
        expected: { planRevisionId: next.revisionId, acceptedSequence: next.acceptedSequence,
          weekIndex: next.week.index, firstOccurrenceId: next.week.firstOccurrenceId }, intent: {} }));
    }
  }
  assert.equal((await readNextWorkout(reader, principal, planId)).lifecycle, 'Completed');
  const successor = randomUUID();
  const intent = { ...createHypertrophyPlan(), name: 'Current successor program' };
  accepted(await createDraft(db, principal, { ...envelope(), commandType: 'CreateDraft',
    target: { planId: successor }, expected: {}, intent }));
  const head = (await readDraft(reader, principal, successor))!;
  accepted(await activatePlan(db, principal, { ...envelope(), commandType: 'ActivatePlan',
    target: { planId: successor }, expected: { planRevisionId: head.revisionId }, intent: { reviewed: head.activation } }));
  const before = await db.trainer2Plan.findMany({ where: { accountId: principal.accountId }, orderBy: { id: 'asc' } });
  const executions = await db.trainer2Execution.count({ where: { accountId: principal.accountId } });
  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(base + '/trainer2');
    const history = page.getByRole('link', { name: 'Program history', exact: true });
    await expect(history).toBeVisible();
    const historyBox = (await history.boundingBox())!;
    const programBox = (await page.getByRole('link', { name: 'View Program', exact: true }).boundingBox())!;
    assert(historyBox.y >= programBox.y + programBox.height);
    await history.click();
    const completed = page.getByRole('region', { name: 'Completed programs', exact: true });
    await expect(completed.getByRole('link', { name: 'Open completed plan', exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Current programs', exact: true })).toContainText('Current successor program');
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: resolve(artifact, `program-history-${width}.png`), fullPage: true });
    await completed.getByRole('link', { name: 'Open completed plan', exact: true }).click();
    await expect(page.getByText('Saved · Completed · read-only', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Week 1', exact: true }).click();
    const workout = page.locator('details[data-occurrence-id]').first();
    await workout.locator('summary').first().click();
    await workout.getByRole('link', { name: 'View results', exact: true }).click();
    await expect(page.getByRole('link', { name: 'Back to training', exact: true })).toBeVisible();
    await page.goBack();
    await expect(page.getByText('Saved · Completed · read-only', { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText('Saved · Completed · read-only', { exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Program history', exact: true }).click();
    await page.getByRole('link', { name: 'Open active plan', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Current successor program', exact: true })).toBeVisible();
  }
  assert.deepEqual(await db.trainer2Plan.findMany({ where: { accountId: principal.accountId }, orderBy: { id: 'asc' } }), before);
  assert.equal(await db.trainer2Execution.count({ where: { accountId: principal.accountId } }), executions);
  pass('Completed program history at desktop/390/320: active successor retained, saved weeks/results accessible, Back/reload/repeated visits read-only');
}
