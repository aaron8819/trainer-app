import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium, expect } from '@playwright/test';
import { verificationSource } from '../../scripts/trainer2/verification-source';
async function main() {
  const dir = 'artifacts/trainer2/visual-evidence/';
  const ready = JSON.parse(readFileSync(dir + 'demo-ready.json', 'utf8'));
  const base = new URL(ready.url).origin;
  assert(base === 'http://127.0.0.1:' + process.argv[2]);
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1360, height: 1000 }, reducedMotion: 'reduce' });
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => void d.accept());
  const get = async (path: string) => { const r = await page.request.get(base + path); assert(r.ok()); return r.json(); };
  try {
    const draft = await get('/api/trainer2/drafts/' + ready.planId);
    await page.goto(ready.url);
    await page.getByRole('button', { name: 'Start workout', exact: true }).click();
    await expect(page).toHaveURL(/executions\//);
    const executionUrl = page.url(), executionId = executionUrl.split('/').at(-1)!;
    const initialRead = await get('/api/trainer2/executions/' + executionId);
    assert.deepEqual(initialRead.initial.occurrence, draft.intent.occurrences[4]);
    assert.equal(initialRead.initial.revisionId, draft.revisionId);
    const panel = page.getByRole('region', { name: 'Active set', exact: true });
    const load = panel.getByLabel(/Actual load$/);
    const queue = page.getByRole('region', { name: 'Exercise queue' });
    const chips = queue.getByRole('button', { name: /, set \d+,/ });
    await expect(load).toHaveValue('132.28');
    await expect(panel).toContainText('132.28 lb barbell total');
    await expect(queue.getByText('Primary · Quads').first()).toBeVisible();
    await page.screenshot({ path: dir + 'prescribed-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: dir + 'prescribed-mobile.png', fullPage: true });
    await panel.getByText('History', { exact: true }).click();
    await expect(panel.getByRole('table')).toBeVisible();
    await expect(panel.getByRole('table')).not.toContainText('recorded');
    await expect(panel).not.toContainText('Exercise comparison');
    await page.screenshot({ path: dir + 'history-mobile.png', fullPage: true });
    await page.setViewportSize({ width: 1360, height: 1000 });
    await page.screenshot({ path: dir + 'history-desktop.png', fullPage: true });
    await panel.getByText('History', { exact: true }).click();
    await chips.nth(3).click();
    await expect(load).toHaveValue('');
    const unspecified = initialRead.initial.occurrence.positions[1].targets[0];
    assert.equal(unspecified.measurement, null);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: dir + 'unspecified-mobile.png', fullPage: true });
    await chips.nth(0).click(); await expect(load).toHaveValue('132.28');
    await load.fill('135');
    await page.reload(); await expect(load).toHaveValue('135');
    await expect(page.getByRole('button', { name: 'Finish workout', exact: true })).toBeDisabled();
    await panel.getByRole('button', { name: 'Discard input' }).click();
    await expect(load).toHaveValue('132.28');
    for (const width of [320, 390, 1360]) {
      await page.setViewportSize({ width, height: 844 });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      const controls = await panel.getByRole('button').evaluateAll(bs => bs.filter(b => b.getBoundingClientRect().height > 0).map(b => b.getBoundingClientRect().height));
      assert(controls.every(h => h >= 44));
    }
    assert.deepEqual((await get('/api/trainer2/executions/' + executionId)).initial, initialRead.initial);
    assert.deepEqual((await get('/api/trainer2/drafts/' + ready.planId)).intent, draft.intent);
    // Keep the evaluation workout pristine; close only this empty inspection attempt.
    await page.getByText('Workout menu', { exact: true }).click();
    await page.getByRole('button', { name: 'Discard empty workout', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm discard' }).click();
    await expect(page.getByRole('heading', { name: 'Workout attempt discarded' })).toBeVisible();
    await page.goto(ready.url);
    await expect(page.getByRole('button', { name: 'Start workout', exact: true })).toBeEnabled();
    const next = await get('/api/trainer2/plans/' + ready.planId + '/next');
    assert.equal(next.execution, null); assert.equal(next.occurrence.id, draft.intent.occurrences[4].id);
    for (const prior of ready.completed) assert.deepEqual(await get('/api/trainer2/executions/' + prior.executionId), prior);
    assert.deepEqual(errors, []);
    writeFileSync(dir + 'demo-final.json', JSON.stringify({ source: verificationSource(), url: ready.url, executionUrl, draftRevision: draft.revisionId, initialRead, unspecified, next, errors, checks: ['authored revision equals immutable execution occurrence', '60.00 kg → 132.28 lb input and starting target', 'absent prescription stays empty', 'history table and original-unit disclosure', 'typed input survives reload; discard restores suggestion', '320/390/1360 no overflow, 44px buttons', 'saved prescription and synthetic history unchanged', 'empty inspection discarded; Week 2 ready'] }, null, 2));
    console.log('VERIFIED VISUAL DEMO ' + ready.url);
  } finally { await browser.close(); }
}
void main().catch(e => { console.error(e); process.exitCode = 1; });
