import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { expect as baseExpect, type Page } from '@playwright/test';
import type { PrismaClient } from '@prisma/client';
import { createDraft, readDraft } from '../../src/lib/api/trainer2/planning';
import { createHypertrophyPlan, expandWorkoutDefaults } from '../../src/lib/engine/trainer2/plan-builder';
import { canonicalJson } from '../../src/lib/trainer2-contracts/canonical-json';
const expect = baseExpect.configure({ timeout: 30_000 });

export async function assertPoundSurface(page: Page) {
  assert(!/\bkg\b/i.test(await page.locator('body').innerText()), 'Visible kg unit');
  await expect(page.getByRole('combobox', { name: 'Unit', exact: true })).toHaveCount(0);
  assert.equal(await page.locator('select option[value="kg"]').count(), 0);
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Horizontal overflow');
}

export async function lbOnlyBuilderJourney({ page, base, artifact, db, reader, principal, pass }: {
  page: Page; base: string; artifact: string; db: PrismaClient; reader: PrismaClient;
  principal: { accountId: string; sessionId: string }; pass: (value: string) => void;
}) {
  const row = page.getByRole('region', { name: 'Exercise 1', exact: true });
  const sheet = page.getByRole('dialog', { name: 'Edit prescription', exact: true });
  const open = () => row.getByRole('button', { name: 'Edit', exact: true }).click();
  const saved = () => expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible();
  await page.goto(base + '/trainer2/dev/drafts?view=builder');
  await page.getByRole('button', { name: 'Customize this template' }).click();
  await open();
  await sheet.getByText('Advanced prescription details', { exact: true }).click();
  await sheet.getByLabel('Measurement kind', { exact: true }).selectOption('externalLoad');
  await sheet.getByLabel('Load or assistance · lb', { exact: true }).fill('132.5');
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await assertPoundSurface(page);
    await expect(sheet.getByLabel('Optional starting load · lbs')).toHaveValue('132.5');
    await page.screenshot({ path: resolve(artifact, `lb-builder-${width}.png`), fullPage: true });
  }
  await sheet.getByRole('button', { name: 'Apply changes', exact: true }).click();
  await row.getByRole('button', { name: 'Replace', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Swap exercise', exact: true });
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 }); await assertPoundSurface(page);
    await page.screenshot({ path: resolve(artifact, `lb-picker-${width}.png`), fullPage: true });
  }
  await picker.press('Escape');
  await page.getByRole('button', { name: 'Save plan', exact: true }).click(); await saved();
  const newId = new URL(page.url()).searchParams.get('planId')!;
  const before = (await readDraft(reader, principal, newId))!;
  assert.deepEqual(before.intent.occurrences[0].positions[0].targets[0].measurement,
    { kind: 'externalLoad', value: '132.5', unit: 'lb', convention: 'barbellTotal', zeroMeaning: 'notAllowed' });
  await page.reload(); await saved(); await open();
  await expect(sheet.getByLabel('Optional starting load · lbs')).toHaveValue('132.5');
  assert.equal(canonicalJson((await readDraft(reader, principal, newId))!.intent), canonicalJson(before.intent));
  await sheet.getByRole('button', { name: 'Cancel edits', exact: true }).click();
  pass('New Builder advanced prescription saves 132.5 lb and survives real DB/browser reload; Builder and picker have no kg/unit selector at 390px and 320px');

  // Synthetic compatibility fixture, never authored through a kg UI.
  let intent = createHypertrophyPlan();
  intent.builder!.workouts[0].rows[0].prescription.measurement =
    { kind: 'externalLoad', value: '60.123456', unit: 'kg', convention: 'barbellTotal', zeroMeaning: 'notAllowed' };
  intent = expandWorkoutDefaults(intent);
  const legacyId = randomUUID();
  const response = await createDraft(db, principal, { schemaVersion: 1, actionId: randomUUID(), deviceId: randomUUID(),
    originatingAccountId: principal.accountId, ownershipEpoch: 0, dependsOn: [], commandType: 'CreateDraft',
    target: { planId: legacyId }, expected: {}, intent });
  assert.equal(response.outcome.status, 'Accepted');
  const legacy = (await readDraft(reader, principal, legacyId))!;
  await page.goto(base + '/trainer2/dev/drafts?planId=' + legacyId); await saved(); await open();
  await sheet.getByText('Advanced prescription details', { exact: true }).click();
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 }); await assertPoundSurface(page);
    await expect(sheet.getByLabel('Optional starting load · lbs')).toHaveValue('132.55');
    await expect(sheet.getByLabel('Load or assistance · lb')).toHaveValue('132.55');
    await page.screenshot({ path: resolve(artifact, `lb-legacy-builder-${width}.png`), fullPage: true });
  }
  await sheet.getByLabel('Reps from').fill('7');
  await sheet.getByRole('button', { name: 'Apply changes', exact: true }).click();
  await page.getByRole('button', { name: 'Save plan', exact: true }).click(); await saved(); await page.reload(); await saved();
  assert.deepEqual((await readDraft(reader, principal, legacyId))!.intent.occurrences[0].positions[0].targets[0].measurement,
    legacy.intent.occurrences[0].positions[0].targets[0].measurement);
  await open(); await sheet.getByText('Advanced prescription details', { exact: true }).click();
  await sheet.getByLabel('Load or assistance · lb').fill('132.5');
  await sheet.getByRole('button', { name: 'Apply changes', exact: true }).click();
  await page.getByRole('button', { name: 'Save plan', exact: true }).click(); await saved(); await page.reload(); await saved();
  assert.deepEqual((await readDraft(reader, principal, legacyId))!.intent.occurrences[0].positions[0].targets[0].measurement,
    { kind: 'externalLoad', value: '132.5', unit: 'lb', convention: 'barbellTotal', zeroMeaning: 'notAllowed' });
  pass('Legacy Builder kg prescription displays converted lb, reps-only save/reload preserves exact provenance, explicit advanced load edit saves 132.5 lb');
}
