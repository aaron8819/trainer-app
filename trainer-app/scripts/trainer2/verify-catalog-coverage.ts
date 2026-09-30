import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
import type { PrismaClient } from '@prisma/client';
import { createDraft, readDraft } from '../../src/lib/api/trainer2/planning';
import { activatePlan } from '../../src/lib/api/trainer2/activation';
import { startOccurrence, readExecution, readNextWorkout } from '../../src/lib/api/trainer2/execution';
import { readExecutionWithPrevious } from '../../src/lib/api/trainer2/previous-performance';
import { saveSetResult } from '../../src/lib/api/trainer2/set-results';
import { finishExecution } from '../../src/lib/api/trainer2/workout-finish';
import { reviewedResults } from '../../src/lib/trainer2-contracts/workout-finish';
import { currentAssignment, effectiveOccurrence } from '../../src/lib/engine/trainer2/exercise-swap';
import { catalog, catalogExercise } from '../../src/lib/engine/trainer2/catalog';
import { canonicalJson } from '../../src/lib/trainer2-contracts/canonical-json';
import type { ServerPrincipal } from '../../src/lib/api/trainer2/principal';
import type { ExecutionRead } from '../../src/lib/trainer2-contracts/execution';
import type { PerformedResult } from '../../src/lib/trainer2-contracts/set-results';

// Called only inside the existing task-owned disposable PostgreSQL/browser runner.
export async function verifyCatalogCoverage(db: PrismaClient, reader: PrismaClient, principal: ServerPrincipal,
  page: Page, base: string, artifact: string, pass: (message: string) => void) {
  const envelope = () => ({ schemaVersion: 1, actionId: randomUUID(), deviceId: randomUUID(),
    originatingAccountId: principal.accountId, ownershipEpoch: 0, dependsOn: [] });
  const read = async (executionId: string) => (await readExecution(reader, principal, executionId))!;
  const close = async (execution: ExecutionRead) => assert.equal((await finishExecution(db, principal, {
    ...envelope(), commandType: 'FinishExecution', target: { executionId: execution.executionId },
    expected: reviewedResults(await read(execution.executionId)), intent: { acknowledgeUnrecorded: true },
  })).outcome.status, 'Accepted');
  const next = (planId: string) => readNextWorkout(reader, principal, planId);
  const start = async (planId: string) => {
    const n = await next(planId);
    assert(n.occurrence);
    const saved = (await readDraft(reader, principal, planId))!;
    const response = await startOccurrence(db, principal, { ...envelope(), commandType: 'StartOccurrence',
      target: { planId, occurrenceId: n.occurrence.id }, expected: { planRevisionId: saved.revisionId, instructionEpoch: saved.activation.instructions.epoch }, intent: {} });
    assert.equal(response.outcome.status, 'Accepted'); assert(response.outcome.status === 'Accepted');
    return read(response.outcome.result.executionId);
  };
  const complete = async (planId: string) => {
    for (let i = 0; i < 30; i++) {
      const n = await next(planId);
      if (n.execution) await close(n.execution);
      else if (n.occurrence) await close(await start(planId));
      else return;
    }
    throw new Error('Synthetic plan failed to complete');
  };
  const current = await db.trainer2Plan.findFirst({ where: { accountId: principal.accountId, lifecycle: 'Active' } });
  if (current) await complete(current.id);
  await page.goto(base + '/trainer2/dev/drafts');
  const row = (i: number) => page.getByRole('region', { name: 'Exercise ' + i, exact: true });
  await page.getByRole('tab', { name: 'Lower A', exact: true }).waitFor();
  for (const [i, name, filter, mobile] of [
    [1, 'Decline Barbell Bench Press', 'Barbell', false],
    [2, 'Concentration Curl', 'Dumbbell', true],
    [3, 'Hip Adduction Machine', 'Machine', true],
  ] as const) {
    await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1360, height: 1000 });
    await row(i).getByRole('button', { name: 'Swap', exact: true }).click();
    const picker = page.getByRole('dialog', { name: 'Swap exercise', exact: true });
    await picker.getByLabel('Search exercises', { exact: true }).fill(name);
    await picker.getByLabel('Filter picker equipment').selectOption(filter);
    await picker.getByRole('button', { name: new RegExp(name) }).click();
    await row(i).getByText(name, { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  }
  await row(1).getByRole('button', { name: 'Swap', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Swap exercise', exact: true });
  await picker.getByLabel('Search exercises', { exact: true }).fill('Plank');
  await picker.getByText('Duration or distance recording is not supported.', { exact: true }).first().waitFor();
  assert.equal(await picker.getByRole('button', { name: /^Plank/ }).count(), 0);
  await picker.getByRole('button', { name: 'Close picker' }).click();
  await page.getByLabel('Plan name', { exact: true }).fill('Catalog coverage browser trial');
  await page.getByRole('button', { name: 'Save plan', exact: true }).click();
  await page.getByRole('status').filter({ hasText: /^Saved$/ }).waitFor();
  const planId = new URL(page.url()).searchParams.get('planId')!;
  const saved = (await readDraft(reader, principal, planId))!;
  const savedBytes = canonicalJson(saved.intent);
  assert.equal(saved.intent.occurrences[0].positions[0].exercise.name, 'Decline Barbell Bench Press');
  assert.equal(saved.intent.occurrences[0].positions[1].targets[0].reps.basis, 'perSide');
  await page.reload();
  await row(1).getByText('Decline Barbell Bench Press', { exact: true }).waitFor();
  await page.screenshot({ path: resolve(artifact, 'catalog-mobile-builder.png'), fullPage: true });
  await page.getByRole('button', { name: 'Review plan', exact: true }).click();
  await page.getByRole('button', { name: 'Activate plan', exact: true }).click();
  await page.getByRole('button', { name: 'Start workout', exact: true }).click();
  const card = page.getByRole('region', { name: 'Active set', exact: true });
  await card.getByRole('heading', { name: 'Decline Barbell Bench Press', exact: true }).waitFor();
  const first = (await db.trainer2Execution.findFirstOrThrow({ where: { accountId: principal.accountId, lifecycle: 'Open' } })).id;
  const firstInitial = canonicalJson((await read(first)).initial);
  // Exercise swap and restore before recording, including a mobile equipment filter.
  await card.getByRole('button', { name: 'Swap', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Search library').fill('Decline Dumbbell Bench Press');
  await dialog.getByLabel('Equipment').selectOption('Dumbbell');
  await dialog.getByRole('button', { name: /Decline Dumbbell Bench Press/ }).click();
  await dialog.getByRole('button', { name: 'Confirm swap' }).click();
  await card.getByRole('heading', { name: 'Decline Dumbbell Bench Press', exact: true }).waitFor();
  await card.getByRole('button', { name: 'Swap', exact: true }).click();
  await dialog.getByRole('button', { name: 'Return to original', exact: true }).click();
  await dialog.getByRole('button', { name: 'Confirm swap' }).click();
  await card.getByRole('heading', { name: 'Decline Barbell Bench Press', exact: true }).waitFor();
  assert.deepEqual(effectiveOccurrence(await read(first)).positions[0], (await read(first)).initial.occurrence.positions[0]);
  const logUI = async (name: string, weight: string) => {
    await page.getByRole('region', { name: 'Exercise queue' }).getByRole('button', { name: new RegExp(name + ', set 1, unrecorded') }).click();
    await card.getByLabel('Set 1 Actual reps').fill('8');
    await card.getByLabel('Set 1 Actual load', { exact: true }).fill(weight);
    await card.getByRole('button', { name: 'Log set', exact: true }).click();
    await card.getByLabel('Set 2 Actual reps').waitFor();
    assert.equal(await card.getByLabel('Set 2 Actual load', { exact: true }).inputValue(), weight);
  };
  await logUI('Decline Barbell Bench Press', '125');
  await logUI('Concentration Curl', '25');
  await logUI('Hip Adduction Machine', '65');
  const finishUI = async () => {
    const finishedId = (await db.trainer2Execution.findFirstOrThrow({ where: { accountId: principal.accountId, lifecycle: 'Open' } })).id;
    await page.getByRole('button', { name: 'Finish workout', exact: true }).click();
    await page.getByRole('button', { name: 'Finish anyway', exact: true }).click();
    await page.getByRole('button', { name: 'Start workout', exact: true }).waitFor();
    await page.goto(base + '/trainer2/dev/executions/' + finishedId);
    await page.getByRole('heading', { name: 'Workout finished', exact: true }).waitFor();
  };
  await finishUI(); await page.reload();
  assert.equal((await read(first)).lifecycle, 'Finished');
  assert.equal(canonicalJson((await read(first)).initial), firstInitial);
  pass('Desktop/mobile builder search and filters → save/reload → activate → start/log → finish; immutable snapshots and same-position prefill');
  // Advance only task-owned synthetic occurrences to the next Lower A.
  for (let i = 0; i < 3; i++) await close(await start(planId));
  await page.goto(base + '/trainer2/dev/drafts?planId=' + planId);
  await page.getByRole('button', { name: 'Start workout', exact: true }).click();
  await card.getByLabel('Set 1 Actual load', { exact: true }).waitFor();
  assert.equal(await card.getByLabel('Set 1 Actual load', { exact: true }).inputValue(), '125');
  await page.getByRole('region', { name: 'Exercise queue' }).getByRole('button', { name: /Concentration Curl, set 1, unrecorded/ }).click();
  assert.equal(await card.getByLabel('Set 1 Actual load', { exact: true }).inputValue(), '25');
  await card.getByRole('button', { name: 'History', exact: true }).click();
  await card.getByRole('cell', { name: '25 lb', exact: true }).waitFor();
  await card.getByText('per side', { exact: true }).first().waitFor();
  await card.getByRole('button', { name: 'History', exact: true }).click();
  await page.getByRole('region', { name: 'Exercise queue' }).getByRole('button', { name: /Decline Barbell Bench Press, set 1, unrecorded/ }).click();
  await card.getByRole('button', { name: 'Swap', exact: true }).click();
  await dialog.getByLabel('Search library').fill('Decline Dumbbell Bench Press');
  await dialog.getByRole('button', { name: /Decline Dumbbell Bench Press/ }).click();
  await dialog.getByRole('button', { name: 'Confirm swap' }).click();
  await card.getByRole('heading', { name: 'Decline Dumbbell Bench Press', exact: true }).waitFor();
  assert.equal(await card.getByLabel('Set 1 Actual load', { exact: true }).inputValue(), '');
  await logUI('Decline Dumbbell Bench Press', '35');
  await finishUI(); await page.reload();
  await page.getByRole('heading', { name: /Decline Dumbbell Bench Press/ }).waitFor();
  assert.equal(canonicalJson((await readDraft(reader, principal, planId))!.intent), savedBytes);
  await page.screenshot({ path: resolve(artifact, 'catalog-mobile-replacement-history.png'), fullPage: true });
  pass('Subsequent history/prefill retains per-side meaning; new bench replacement clears original load, logs per dumbbell and survives completed reload');
  for (let i = 0; i < 3; i++) await close(await start(planId));
  await page.goto(base + '/trainer2/dev/drafts?planId=' + planId);
  await page.getByRole('button', { name: 'Start workout', exact: true }).click();
  await card.getByLabel('Set 1 Actual load', { exact: true }).waitFor();
  await card.getByRole('button', { name: 'Swap', exact: true }).click();
  await dialog.getByLabel('Search library').fill('Decline Dumbbell Bench Press');
  await dialog.getByRole('button', { name: /Decline Dumbbell Bench Press/ }).click();
  await dialog.getByText('35 lb suggested', { exact: true }).waitFor();
  await dialog.getByRole('button', { name: 'Confirm swap' }).click();
  await card.getByRole('heading', { name: 'Decline Dumbbell Bench Press', exact: true }).waitFor();
  assert.equal(await card.getByLabel('Set 1 Actual load', { exact: true }).inputValue(), '35');
  await card.getByRole('button', { name: 'Swap', exact: true }).click();
  await dialog.getByRole('button', { name: 'Return to original', exact: true }).click();
  await dialog.getByRole('button', { name: 'Confirm swap' }).click();
  await card.getByRole('heading', { name: 'Decline Barbell Bench Press', exact: true }).waitFor();
  assert.equal(await card.getByLabel('Set 1 Actual load', { exact: true }).inputValue(), '125');
  const restored = (await db.trainer2Execution.findFirstOrThrow({ where: { accountId: principal.accountId, lifecycle: 'Open' } })).id;
  const restoredRead = await read(restored);
  assert.deepEqual(effectiveOccurrence(restoredRead).positions[0], restoredRead.initial.occurrence.positions[0]);
  await close(restoredRead);
  pass('Later replacement preview/prefill uses 35 lb per dumbbell; Return to original restores its snapshot and 125 lb total-barbell suggestion');
  await complete(planId);
  // All 91 definitions round-trip through strict acceptance, START, performed evidence and history.
  const allId = randomUUID(), stageId = randomUUID();
  const positions = () => catalog.map(entry => ({ id: randomUUID(), exercise: catalogExercise(entry), targets: [{
    id: randomUUID(), classification: 'working' as const, required: true, reps: { ...entry.reps, basis: entry.repBasis },
    measurement: null, rir: '2', restSeconds: null,
  }] }));
  const allDocument = { schemaVersion: 1 as const, name: 'All qualified catalog definitions', endpoint: 'endOfOrderedOccurrences' as const,
    progression: { version: 1 as const, mode: 'plannedPrescriptions' as const, scope: 'wholePlan' as const, parameters: {} },
    stages: [{ id: stageId, name: 'Synthetic coverage' }],
    occurrences: Array.from({ length: 2 }, () => ({ id: randomUUID(), stageId, name: 'All definitions', positions: positions() })) };
  assert.equal((await createDraft(db, principal, { ...envelope(), commandType: 'CreateDraft', target: { planId: allId }, expected: {}, intent: allDocument })).outcome.status, 'Accepted');
  const allSaved = (await readDraft(reader, principal, allId))!;
  assert.deepEqual(allSaved.intent, allDocument);
  assert.equal((await activatePlan(db, principal, { ...envelope(), commandType: 'ActivatePlan', target: { planId: allId },
    expected: { planRevisionId: allSaved.revisionId }, intent: { reviewed: allSaved.activation } })).outcome.status, 'Accepted');
  const execution = await start(allId), initial = canonicalJson(execution.initial);
  for (let i = 0; i < catalog.length; i++) {
    const entry = catalog[i], owned = execution.initial.positions[i];
    const measurement = entry.loadKind === 'bodyweight' ? { kind: 'bodyweight' as const, convention: 'bodyweightOnly' as const } :
      { kind: entry.loadKind, value: entry.loadKind === 'externalLoad' ? '22.50' : '0.00', unit: 'kg',
        convention: entry.convention, zeroMeaning: entry.loadKind === 'externalLoad' ? entry.catalogFacts?.externalZeroMeaning ?? 'validZero' : entry.loadKind === 'addedLoad' ? 'noAddedLoad' : 'noAssistance' };
    const result = { reps: { value: 8, basis: entry.repBasis }, measurement, rir: '2' } as PerformedResult;
    const command = { ...envelope(), commandType: 'RecordSetResult', target: { executionId: execution.executionId, targetId: owned.targets[0].id },
      expected: { resultVersion: 0, assignment: currentAssignment(execution, owned.id) }, intent: { result } };
    if (entry.catalogFacts && entry.loadKind === 'externalLoad') {
      const invalid = { ...command, actionId: randomUUID(), intent: { result: { ...result, measurement: { ...measurement, convention: 'addedExternal', kind: 'addedLoad', zeroMeaning: 'noAddedLoad' } } } };
      assert.equal((await saveSetResult(db, principal, invalid)).outcome.status, 'Rejected');
    }
    assert.equal((await saveSetResult(db, principal, command)).outcome.status, 'Accepted');
    assert.deepEqual((await read(execution.executionId)).results.find(r => r.targetId === owned.targets[0].id)?.result, result);
  }
  assert.equal(canonicalJson((await read(execution.executionId)).initial), initial);
  await close(execution);
  const subsequent = await start(allId);
  const enriched = await reader.$transaction(tx => readExecutionWithPrevious(tx, principal, subsequent.executionId));
  assert(enriched);
  assert.equal(enriched.previous?.length, catalog.length);
  assert.equal(enriched.firstSetLoads?.length, catalog.filter(e => e.loadKind !== 'bodyweight').length);
  for (const load of enriched.firstSetLoads ?? []) {
    const m = load.result.result!.measurement!;
    assert('value' in m);
    assert.equal(m.value, m.kind === 'externalLoad' ? '22.50' : '0.00');
  }
  assert.deepEqual((await readDraft(reader, principal, allId))!.intent, allDocument);
  await close(subsequent);
  pass('All 91 stable IDs: save/activate/START/log/finish/history/subsequent prefill; barbell, per-implement, displayed machine, bodyweight, added load, assistance, bilateral/per-side and decimal evidence');
}
