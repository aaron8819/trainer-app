import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { expect as baseExpect, type Page } from '@playwright/test';

const expect = baseExpect.configure({ timeout: 30_000 });
export async function loggerJourney({ page, base, home, artifact, accountId, executionId, pass }: {
  page: Page; base: string; home: string; artifact: string; accountId: string; planId: string; executionId: string; pass: (value: string) => void;
}) {
  const url = `${base}/trainer2/dev/executions/${executionId}`;
  const active = page.getByRole('region', { name: 'Active set' });
  const queue = page.getByRole('region', { name: 'Exercise queue' });
  const shot = async (name: string) => page.screenshot({ path: resolve(artifact, name + '.png'), fullPage: true });
  const read = async () => page.evaluate(async path => { const response = await fetch(path); if (!response.ok) throw new Error('Execution read failed'); return response.json(); }, `/api/trainer2/executions/${executionId}`);
  const draft = async () => page.evaluate(({ accountId, executionId }) => Object.fromEntries(Object.entries(sessionStorage).filter(([key]) => key.startsWith(`trainer2-result:${accountId}:${executionId}:`))), { accountId, executionId });
  await page.goto(url);
  await expect(active.getByLabel('Set 1 Actual load', { exact: true })).toHaveValue('132.28');
  await expect(active.getByLabel('Set 1 Actual reps', { exact: true })).toHaveValue('');
  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await active.getByLabel('Set 1 Actual reps', { exact: true }).scrollIntoViewIfNeeded();
    const before = await active.boundingBox();
    await active.getByLabel('Set 1 Actual reps', { exact: true }).fill('8');
    assert(Math.abs((await active.boundingBox())!.height - before!.height) < 1, 'Numeric entry changed card height');
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.equal(await active.getByLabel('Set 1 Actual reps', { exact: true }).evaluate(e => getComputedStyle(e).fontSize), '27px');
    await shot(`logger-${width}`);
  }
  await active.getByRole('button', { name: 'History', exact: true }).click();
  const history = page.getByRole('dialog', { name: 'Exercise history' });
  await expect(history.getByRole('table')).toBeVisible();
  await expect(history).toContainText('10');
  await shot('history-320');
  await history.press('Escape');
  await expect(history).not.toBeVisible();
  await expect(active.getByRole('button', { name: 'History', exact: true })).toBeFocused();
  await expect(active.getByLabel('Set 1 Actual reps', { exact: true })).toHaveValue('8');
  pass('Desktop, 390px, 320px stable entry, prescription prefill, history dialog, Escape, focus return and retained draft');

  await active.getByRole('button', { name: 'Log set', exact: true }).click();
  await expect(active.getByLabel('Set 2 Actual reps', { exact: true })).toHaveValue('8');
  await expect(active.getByLabel('Set 2 Actual load', { exact: true })).toHaveValue('132.28');
  const initial = await read();
  assert.equal(initial.results[0].result.measurement.unit, 'kg');
  assert.equal(initial.initial.occurrence.positions[0].targets[0].measurement.unit, 'kg');
  assert.equal(initial.results[0].result.measurement.value, '60');
  const timer = page.getByLabel('Rest timer', { exact: true });
  await expect(timer).toBeVisible();
  const timerStorage = `trainer2-rest:${accountId}:${executionId}`;
  const timerBefore = await page.evaluate(key => localStorage.getItem(key), timerStorage);
  await timer.getByRole('button', { name: '+30 seconds' }).click();
  await timer.getByRole('button', { name: '−30 seconds' }).click();
  await active.getByRole('button', { name: 'Skip set', exact: true }).click();
  await expect(active.getByLabel('Set 3 Actual reps', { exact: true })).toHaveValue('8');
  await shot('timer-skip-320');
  assert(timerBefore);
  await page.reload();
  await expect(timer).toBeVisible();
  pass('Prescribed kg load displays in pounds and logs its untouched original kg value; confirmed log carries values forward; skip advances; timer adjustments and reload persist');

  // Abort every delivery response after the server accepts the exact request.
  const bodies: string[] = [];
  await page.route('**/api/trainer2/executions/results', async route => {
    bodies.push(route.request().postData()!);
    const response = await route.fetch(); assert.equal((await response.json()).outcome.status, 'Accepted');
    await route.abort('failed');
  });
  await active.getByLabel('Set 3 Actual reps', { exact: true }).fill('9');
  await active.getByLabel('Set 3 Actual load', { exact: true }).fill('132.5');
  await active.getByRole('button', { name: '5 RIR', exact: true }).click();
  await active.getByRole('button', { name: 'Log set', exact: true }).click();
  await expect(active.getByRole('button', { name: 'Retry save', exact: true })).toBeVisible();
  const pending = await draft();
  assert(Object.values(pending).some(value => JSON.parse(value).pending));
  await shot('lost-response-320');
  await page.reload();
  await expect(active.getByRole('button', { name: 'Retry save', exact: true })).toBeVisible();
  assert.deepEqual(await draft(), pending);
  await page.unroute('**/api/trainer2/executions/results');
  let retry = '';
  page.on('request', request => { if (request.url().endsWith('/api/trainer2/executions/results') && request.method() === 'POST') retry = request.postData() ?? ''; });
  await active.getByRole('button', { name: 'Retry save', exact: true }).click();
  await expect(active.getByLabel('Set 1 Actual reps', { exact: true })).toBeVisible();
  assert.equal(retry, bodies[0]);
  const afterRetry = await read();
  assert.equal(afterRetry.results.find((r: { targetId: string }) => r.targetId === JSON.parse(bodies[0]).target.targetId).result.measurement.unit, 'kg');
  pass('Accepted lost response preserves exact pending envelope and typed draft across reload; replay confirms edited lbs without duplicate work');

  const firstName = initial.initial.occurrence.positions[0].exercise.name;
  await queue.getByRole('button', { name: new RegExp(`${firstName}, set 1, recorded`) }).click();
  await active.getByLabel('Set 1 Actual reps', { exact: true }).fill('11');
  let competed = false;
  await page.route('**/api/trainer2/executions/results', async route => {
    if (!competed) {
      competed = true;
      const command = route.request().postDataJSON();
      const other = { ...command, actionId: randomUUID(), deviceId: randomUUID(), intent: { result: { ...command.intent.result, reps: { value: 12, basis: 'total' } } } };
      const response = await route.fetch({ postData: JSON.stringify(other) });
      assert.equal((await response.json()).outcome.status, 'Accepted');
    }
    await route.continue();
  });
  await active.getByRole('button', { name: 'Update set', exact: true }).click();
  await expect(active.getByRole('button', { name: 'Review latest result', exact: true })).toBeVisible();
  await expect(active.getByLabel('Set 1 Actual reps', { exact: true })).toHaveValue('11');
  await active.getByRole('button', { name: 'Review latest result', exact: true }).click();
  await active.getByRole('button', { name: 'Use latest result for my correction', exact: true }).click();
  await shot('stale-correction-320');
  await page.unroute('**/api/trainer2/executions/results');
  await active.getByRole('button', { name: 'Update set', exact: true }).click();
  await expect(active.getByText('Saved', { exact: true })).toBeVisible();
  await active.getByRole('button', { name: 'Return to active set', exact: true }).click();
  pass('Logged-set correction conflicts with a real competing correction; input retained, latest explicitly adopted, confirmed update and return');

  // The current unlogged exercise can swap and restore without touching logged identities.
  await active.getByRole('button', { name: 'Swap', exact: true }).click();
  const swap = page.getByRole('dialog', { name: 'Swap exercise', exact: true });
  await swap.getByLabel('Search library').fill('row');
  await swap.getByRole('button', { name: /Chest.*Supported.*Dumbbell Row/i }).click();
  await swap.getByRole('button', { name: 'Confirm swap', exact: true }).click();
  await expect(swap).not.toBeVisible();
  await active.getByRole('button', { name: 'Swap', exact: true }).click();
  await swap.getByRole('button', { name: 'Return to original', exact: true }).click();
  await swap.getByRole('button', { name: 'Confirm swap', exact: true }).click();
  await expect(swap).not.toBeVisible();
  const chipsBefore = await queue.getByRole('button', { name: /, set \d+,/ }).count();
  await queue.getByRole('button', { name: '+ Add set', exact: true }).nth(1).click();
  await expect(queue.getByRole('button', { name: /, set \d+,/ })).toHaveCount(chipsBefore + 1);
  await page.getByRole('button', { name: '+ Add exercise', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Add exercise', exact: true });
  await picker.getByLabel('Search exercises').fill('machine crunch');
  await picker.getByRole('button', { name: /Machine Crunch/ }).click();
  const configure = page.getByRole('dialog', { name: 'Configure added exercise' });
  await configure.getByLabel('Working sets').fill('1');
  await configure.getByRole('button', { name: 'Add exercise', exact: true }).click();
  await expect(queue.getByRole('button', { name: /Machine Crunch, set 1,/ })).toBeVisible();
  pass('Real swap and restore commands, assignment readback, Add set and Add exercise update queue and counts');

  await page.setViewportSize({ width: 390, height: 500 });
  await active.getByLabel('Set 1 Actual reps', { exact: true }).fill('10');
  await active.getByLabel('Set 1 Actual load', { exact: true }).fill('40');
  await active.getByLabel('Set 1 Actual RIR (optional)', { exact: true }).fill('3.5');
  await active.getByRole('button', { name: 'Log set', exact: true }).scrollIntoViewIfNeeded();
  await shot('reduced-height-390');
  await active.getByLabel('Set 1 Actual RIR (optional)', { exact: true }).press('Tab');
  assert(await page.evaluate(() => document.activeElement?.tagName === 'BUTTON'));
  await active.getByRole('button', { name: 'Log set', exact: true }).click();
  await expect(active.getByRole('heading', { name: 'Ready to finish' })).not.toBeVisible();
  await page.setViewportSize({ width: 320, height: 844 });
  await page.getByRole('button', { name: 'Finish workout', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Finish anyway', exact: true })).toBeVisible();
  await shot('finish-confirmation-320');
  await page.getByRole('button', { name: 'Keep working', exact: true }).click();
  await page.getByRole('button', { name: 'Finish workout', exact: true }).click();
  await page.getByRole('button', { name: 'Finish anyway', exact: true }).click();
  await expect(page).toHaveURL(home);
  await expect(page.getByText('Workout finished.', { exact: false }).first()).toBeVisible();
  await page.goto(url);
  await expect(page.getByRole('heading', { name: 'Workout finished', exact: true })).toBeVisible();
  const correction = page.getByRole('button', { name: 'Correct result', exact: true }).first();
  await correction.click();
  await page.getByLabel('Set 1 Actual reps', { exact: true }).first().fill('13');
  await page.getByRole('button', { name: 'Save correction', exact: true }).click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await shot('completed-review-320');
  pass('Reduced viewport, numeric keyboard attributes, keyboard navigation, finish cancel/confirm to Home, completed review and historical correction');
}
