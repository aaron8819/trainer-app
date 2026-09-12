import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
import type { readDraft } from '../../src/lib/api/trainer2/planning';
import { identities } from '../../src/lib/engine/trainer2/planning';
export async function verifyEditorBrowser(tab: Page, read: (id: string) => ReturnType<typeof readDraft>) {
  const button = (name: string) => tab.getByRole('button', { name, exact: true });
  const saved = () => tab.getByRole('status').filter({ hasText: /^Saved$/ }).waitFor();
  const save = async () => { await button('Save plan').click(); await saved(); };
  await tab.setViewportSize({ width: 1280, height: 950 });
  await tab.getByRole('tab', { name: 'Lower A', exact: true }).waitFor();
  assert.equal(await tab.getByRole('tab').count(), 4);
  assert.equal(new URL(tab.url()).searchParams.get('planId'), null);
  assert(await tab.getByText('4 training weeks + 1 deload week', { exact: true }).isVisible());
  await tab.evaluate(() => window.scrollTo(0, 0)); await tab.screenshot({ path: resolve('artifacts/trainer2/initial-plan.png'), fullPage: true });
  for (const name of ['Squat', 'Leg press']) {
    await tab.locator('#add-exercise').fill(name); await button('Add exercise').click();
  }
  await tab.evaluate(() => window.scrollTo(0, 0)); await tab.screenshot({ path: resolve('artifacts/trainer2/populated-workout.png'), fullPage: true });
  await save();
  const planId = new URL(tab.url()).searchParams.get('planId')!;
  const first = (await read(planId))!;
  assert.equal(first.intent.occurrences.length, 20);
  assert.deepEqual(first.intent.occurrences.filter(o => o.name === 'Lower A').map(o => [o.positions.length, o.positions[0].targets.length, o.positions[0].targets[0].rir]), [[2,3,'3'],[2,3,'3'],[2,3,'2'],[2,3,'1'],[2,2,'4']]);
  await button('View all 5 weeks').click(); await button('Week 2').click();
  await tab.getByRole('region', { name: 'Exercise 1', exact: true }).getByLabel('Reps from', { exact: true }).fill('10');
  await button('Edit across plan').click();
  await tab.getByLabel('Exercise 1 name', { exact: true }).fill('Front squat');
  await save();
  const edited = (await read(planId))!;
  assert.equal(edited.intent.occurrences[4].positions[0].exercise.name, 'Squat');
  assert.equal(edited.intent.occurrences[4].positions[0].targets[0].reps.min, 10);
  assert.equal(edited.intent.occurrences[8].positions[0].exercise.name, 'Front squat');
  assert.deepEqual(identities(edited.intent), identities(first.intent));
  await tab.evaluate(() => window.scrollTo(0, 0)); await tab.screenshot({ path: resolve('artifacts/trainer2/five-weeks.png'), fullPage: true });
  await tab.setViewportSize({ width: 390, height: 844 });
  await button('Hide weeks').click();
  await tab.evaluate(() => window.scrollTo(0, 0)); await tab.screenshot({ path: resolve('artifacts/trainer2/mobile-editor.png'), fullPage: true });
  assert(await tab.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  const firstRow = tab.getByRole('region', { name: 'Exercise 1', exact: true });
  await firstRow.getByRole('button', { name: 'Move down', exact: true }).click();
  await save();
  const reordered = (await read(planId))!;
  assert.deepEqual(reordered.intent.occurrences[0].positions.map(p => p.id), first.intent.occurrences[0].positions.map(p => p.id).reverse());
  assert.deepEqual(reordered.intent.occurrences[4], edited.intent.occurrences[4]);
  await tab.reload(); await saved();
  assert.deepEqual((await read(planId))!.intent, reordered.intent);
  assert(await button('Save plan').isDisabled());
  await tab.getByText('Review saved plan', { exact: true }).click();
  assert((await tab.getByLabel('Saved plan review').innerText()).includes('Week 5 · Deload'));
  assert((await tab.getByLabel('Saved plan review').innerText()).includes('4 reps left'));
  await tab.setViewportSize({ width: 1280, height: 950 });
  const other = await tab.context().newPage();
  try {
    await other.goto(tab.url()); await other.getByRole('status').filter({ hasText: /^Saved$/ }).waitFor();
    await other.getByLabel('Plan name', { exact: true }).fill('Other browser');
    await other.getByRole('button', { name: 'Save plan', exact: true }).click();
    await other.getByRole('status').filter({ hasText: /^Saved$/ }).waitFor();
    await tab.getByLabel('Plan name', { exact: true }).fill('Losing browser intent'); await button('Save plan').click();
    await tab.getByRole('status').filter({ hasText: 'changed in another tab' }).waitFor();
    assert.equal(await tab.getByLabel('Plan name', { exact: true }).inputValue(), 'Losing browser intent');
    await button('Reload latest version').click(); await saved();
    assert(await tab.getByLabel('Plan name', { exact: true }).isDisabled());
    await button('Continue from latest plan').click();
  } finally { await other.close(); }
  const bodies: string[] = [];
  await tab.route('**/api/trainer2/drafts/edit', async route => {
    bodies.push(route.request().postData()!);
    if (bodies.length === 1) { assert.equal((await route.fetch()).status(), 200); await route.abort('failed'); }
    else await route.continue();
  });
  await tab.getByLabel('Plan name', { exact: true }).fill('Response loss recovered'); await button('Save plan').click();
  await tab.getByRole('status').filter({ hasText: 'could not be confirmed' }).waitFor();
  assert(await button('Save plan').isDisabled());
  await button('Check again').click(); await saved();
  assert.equal(bodies.length, 2); assert.equal(bodies[0], bodies[1]);
  assert.equal((await read(planId))!.revisionNumber, 5);
  assert.deepEqual(identities((await read(planId))!.intent).map(i => i.id).sort(), identities(first.intent).map(i => i.id).sort());
  await tab.unroute('**/api/trainer2/drafts/edit');
  const text = await tab.locator('main').innerText();
  for (const forbidden of ['Create finite draft', 'Save name revision', 'Current head', 'Command envelope']) assert(!text.includes(forbidden));
  return planId;
}
