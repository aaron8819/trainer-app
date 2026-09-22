import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium, expect } from '@playwright/test';
import { verificationSource } from '../../scripts/trainer2/verification-source';

async function main() {
  assert.equal(process.argv[2], '--confirm-synthetic-trial');
  const ready = JSON.parse(readFileSync('artifacts/trainer2/prefill-evidence/ready.json', 'utf8'));
  assert(/^http:\/\/127\.0\.0\.1:\d+$/.test(ready.base));
  const dir = 'artifacts/trainer2/alignment-evidence/';
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1360, height: 1000 }, reducedMotion: 'reduce' });
  const page = await context.newPage(), errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  try {
    await page.goto(ready.url); await page.getByRole('button', { name: 'Start workout', exact: true }).click();
    await expect(page).toHaveURL(/executions\//); const executionUrl = page.url(), id = executionUrl.split('/').at(-1)!;
    const read = async () => { const r = await page.request.get(ready.base + '/api/trainer2/executions/' + id); assert(r.ok()); return r.json(); };
    const panel = page.getByRole('region', { name: 'Active set', exact: true });
    const chips = page.getByRole('region', { name: 'Exercise queue' }).getByRole('button', { name: /, set \d+,/ });
    await expect(panel.getByLabel(/Actual load$/)).toHaveValue('130');
    await panel.getByRole('button', { name: 'Skip set', exact: true }).click(); await expect(chips.nth(1)).toHaveAttribute('aria-pressed', 'true');
    await panel.getByLabel(/Actual load$/).fill('137.25'); await panel.getByLabel(/Actual reps/).fill('9');
    await panel.getByRole('button', { name: 'Log set', exact: true }).click(); await expect(chips.nth(2)).toHaveAttribute('aria-pressed', 'true');
    await expect(panel.getByLabel(/Actual load$/)).toHaveValue('137.25');
    const before = await read(); assert.equal(before.skips.length, 1); assert.equal(before.results.length, 1);
    const timerKey = `trainer2-rest:${before.initial.accountId}:${id}`;
    const timer = await page.evaluate(k => localStorage.getItem(k), timerKey); assert(timer);
    const checkpoint = new Date().toISOString();
    writeFileSync(dir + 'demo-before-restart.json', JSON.stringify({ checkpoint, executionUrl, before, timer, ready }, null, 2));
    console.log('READY_FOR_RESTART ' + executionUrl);
    // Operator restarts only the task's application, then writes this checkpoint to the signal file.
    for (let i = 0; ; i++) {
      if (existsSync(dir + 'restart-signal.txt') && readFileSync(dir + 'restart-signal.txt', 'utf8').trim() === checkpoint) break;
      if (i > 360) throw new Error('Application restart confirmation timed out');
      await new Promise(r => setTimeout(r, 500));
    }
    await page.reload(); await expect(chips.nth(2)).toHaveAttribute('aria-pressed', 'true');
    assert.deepEqual(await read(), before); assert.equal(await page.evaluate(k => localStorage.getItem(k), timerKey), timer);
    await expect(panel.getByLabel(/Actual load$/)).toHaveValue('137.25'); await expect(panel.getByLabel(/Actual reps/)).toHaveValue('9');
    await chips.nth(0).click(); await expect(panel.getByRole('button', { name: 'Log this set' })).toBeVisible();
    await chips.nth(2).click();
    for (const width of [1360, 390, 320]) {
      await page.setViewportSize({ width, height: width === 1360 ? 1000 : 844 }); await chips.nth(2).click();
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path: dir + `demo-${width}.png`, fullPage: true });
    }
    // Corrections/history placement and keyboard focus, without changing data.
    await chips.nth(1).click(); await expect(panel.getByRole('button', { name: 'Update set' })).toBeVisible();
    await panel.getByRole('button', { name: 'History', exact: true }).click();
    await page.screenshot({ path: dir + 'demo-mobile-history.png', fullPage: true });
    await panel.getByRole('button', { name: 'Return to active set' }).click();
    assert.deepEqual(await read(), before); assert.deepEqual(errors, []);
    writeFileSync(dir + 'demo-restart.json', JSON.stringify({ at: new Date().toISOString(), source: verificationSource(), executionUrl, ready, before, timer, preserved: true, errors }, null, 2));
    console.log('Demo verified: skip, exact result, prefill, selection and rest deadline survived application restart. ' + executionUrl);
  } finally { await browser.close(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
