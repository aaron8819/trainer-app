import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium, expect } from '@playwright/test';
import { verificationSource } from '../../scripts/trainer2/verification-source';

async function main() {
  expect.configure({ timeout: 20000 });
  const [mode] = process.argv.slice(2); assert(['inspect', 'capture', 'verify'].includes(mode));
  const dir = 'artifacts/trainer2/training-ui-evidence/';
  const ready = JSON.parse(readFileSync(dir + 'demo-ready.json', 'utf8')), base = new URL(ready.url).origin;
  assert(/^http:\/\/127\.0\.0\.1:\d+$/.test(base));
  const get = async (path: string) => { const r = await fetch(base + path); assert(r.ok); return r.json(); };
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  try {
    await page.goto(ready.url); await expect(page.getByText('Week 2 of 5 · Accumulation')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start workout', exact: true })).toBeEnabled();
    if (mode === 'inspect') {
      await page.getByRole('button', { name: 'Start workout', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Workout in progress' })).toBeVisible();
      await expect(page.locator('aside').first()).toContainText('Previous exercise results');
      await page.evaluate(() => scrollTo(0,0)); await page.screenshot({ path: dir + 'logging-final-mobile.png' });
      const input = page.getByLabel('Set 1 Actual load', { exact: true }).first();
      await input.fill('12.5'); await input.blur(); await input.focus();
      assert.deepEqual(await input.evaluate((e: HTMLInputElement) => [e.selectionStart, e.selectionEnd]), [0,4]);
      const bounds = await input.boundingBox(); assert(bounds && bounds.height >= 44);
      await page.getByRole('button', { name: 'Discard input' }).click();
      await page.setViewportSize({ width: 1360, height: 1000 }); await page.evaluate(() => scrollTo(0,0));
      await page.screenshot({ path: dir + 'logging-final-desktop.png' });
      const executionUrl = page.url();
      await page.getByRole('button', { name: 'Discard empty workout', exact: true }).click(); await page.getByRole('button', { name: 'Confirm discard' }).click();
      await expect(page.getByRole('heading', { name: 'Workout attempt discarded' })).toBeVisible();
      await page.getByRole('link', { name: 'Back to training' }).click();
      await expect(page.getByRole('button', { name: 'Start workout', exact: true })).toBeEnabled();
      const expectedNext = ready.next.occurrence.id;
      ready.discardedInspectionUrl = executionUrl;
      ready.next = await get(`/api/trainer2/plans/${ready.planId}/next`);
      assert.equal(ready.next.execution, null); assert.equal(ready.next.occurrence.id, expectedNext);
      writeFileSync(dir + 'demo-ready.json', JSON.stringify(ready,null,2));
    }
    const snapshot = { next: await get(`/api/trainer2/plans/${ready.planId}/next`), completed: await Promise.all(ready.completed.map((e: { executionId: string }) => get(`/api/trainer2/executions/${e.executionId}`))),
      discarded: ready.discardedInspectionUrl ? await get('/api/trainer2/executions/' + ready.discardedInspectionUrl.split('/').at(-1)) : null };
    if (mode === 'capture') writeFileSync(dir + 'restart-before.json', JSON.stringify(snapshot,null,2));
    if (mode === 'verify') {
      assert.deepEqual(snapshot, JSON.parse(readFileSync(dir + 'restart-before.json','utf8')));
      await page.reload(); await expect(page.getByRole('button', { name: 'Start workout', exact: true })).toBeEnabled();
      await page.screenshot({ path: dir + 'demo-final-mobile.png', fullPage: true });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.setViewportSize({ width: 1360, height: 1000 }); await page.screenshot({ path: dir + 'demo-final-desktop.png', fullPage: true });
      await page.getByRole('link', { name: 'View Program' }).click(); await expect(page.getByRole('link', { name: 'View results' })).toHaveCount(4);
      await page.getByRole('link', { name: 'View results' }).first().click(); await expect(page.getByRole('heading', { name: 'Workout finished', exact: true })).toBeVisible();
      await page.goto(ready.discardedInspectionUrl); await expect(page.getByRole('heading', { name: 'Workout attempt discarded' })).toBeVisible();
      writeFileSync(dir + 'restart.json', JSON.stringify({ source: verificationSource(), verifiedAt: new Date().toISOString(), url: ready.url, browser: browser.version(), errors, equalReadbacks: true, preserves: ['exact next/status', 'four completed execution snapshots/results/corrections/history/previous summaries', 'discarded attempt'], finalState: 'Week 2 Lower A ready; 56 Week 1 results and one historical correction; no open execution, Week 2 results or skips. One empty inspection attempt is retained as discarded.' },null,2));
    }
    assert.deepEqual(errors, []); console.log('PASS demo ' + mode + ': ' + ready.url);
  } finally { await browser.close(); }
}
void main().catch(e => { console.error(e); process.exitCode=1; });
