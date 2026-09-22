// Inspect only this prepared disposable demo, then discard the empty inspection attempt.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium, expect } from '@playwright/test';
import { verificationSource } from '../../scripts/trainer2/verification-source';
async function main() {
  assert(process.argv[2] === '--confirm-synthetic-trial');
  const dir = 'artifacts/trainer2/prefill-evidence/';
  const ready = JSON.parse(readFileSync(dir + 'ready.json', 'utf8'));
  assert(/^http:\/\/127\.0\.0\.1:\d+$/.test(ready.base));
  const get = async (path: string) => { const r = await fetch(ready.base + path); assert(r.ok); return r.json(); };
  const before = await get('/api/trainer2/plans/' + ready.planId + '/next');
  assert.equal(before.execution, null);
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1360, height: 1000 } });
  try {
    await page.goto(ready.url);
    await page.getByRole('button', { name: 'Start workout', exact: true }).click();
    await expect(page).toHaveURL(/executions\//);
    const executionId = page.url().split('/').at(-1)!;
    const panel = page.getByRole('region', { name: 'Active set', exact: true });
    const chips = page.getByRole('region', { name: 'Exercise queue' }).getByRole('button', { name: /, set \d+,/ });
    const values = [];
    for (const [index, expected] of [[0, '130'], [3, '140'], [6, ''], [9, '']] as const) {
      await chips.nth(index).click();
      await expect(panel.getByLabel(/Actual load$/)).toHaveValue(expected);
      values.push({ index, weight: await panel.getByLabel(/Actual load$/).inputValue() });
    }
    await chips.nth(0).click();
    await page.screenshot({ path: dir + 'demo-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: dir + 'demo-mobile.png', fullPage: true });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    const execution = await get('/api/trainer2/executions/' + executionId);
    assert.equal(execution.results.length, 0);
    await page.getByText('Workout menu', { exact: true }).click();
    await page.getByRole('button', { name: 'Discard empty workout', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm discard', exact: true }).click();
    await expect(page.getByText('Workout attempt discarded.', { exact: true })).toBeVisible();
    const discarded = await get('/api/trainer2/executions/' + executionId);
    assert.equal(discarded.lifecycle, 'Discarded');
    assert.equal(discarded.firstSetLoads.length, 0);
    const after = await get('/api/trainer2/plans/' + ready.planId + '/next');
    assert.equal(after.occurrence.id, before.occurrence.id);
    assert.equal(after.execution, null);
    for (const original of ready.completed) assert.deepEqual(await get('/api/trainer2/executions/' + original.executionId), original);
    await page.goto(ready.url);
    await expect(page.getByRole('button', { name: 'Start workout', exact: true })).toBeEnabled();
    writeFileSync(dir + 'demo-inspection.json', JSON.stringify({ at: new Date().toISOString(), url: ready.url, source: verificationSource(), values, execution, discarded, after, historyUnchanged: true }, null, 2));
    console.log('Demo ready; empty inspection attempt discarded, original histories unchanged: ' + ready.url);
  } finally { await browser.close(); }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
