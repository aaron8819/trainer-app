import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium, expect } from '@playwright/test';
import type { DraftDocument } from '../../src/lib/trainer2-contracts/draft';
import { verificationSource } from './verification-source';

// Only a separately launched task-owned disposable demo is an authorized target.
async function main() {
  const [confirmation, base, container, mode = 'corrected'] = process.argv.slice(2);
  assert.equal(confirmation, '--confirm-disposable');
  assert.match(base, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.match(container, /^trainer2-draft-[a-f0-9]{12}$/);
  assert(['baseline', 'corrected'].includes(mode));
  const database = container.replace('trainer2-draft-', 'trainer2_disposable_');
  const sql = (q: string) => execFileSync('docker', ['exec', container, 'psql', '-U', 'postgres', '-d', database, '-At', '-c', q], { encoding: 'utf8', windowsHide: true }).trim();
  const directory = 'artifacts/week-only-set-reduction'; mkdirSync(directory, { recursive: true });
  const checks: unknown[] = [];
  const receipt: Record<string, unknown> = { source: verificationSource(), base, container, database, mode, checks };
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, hasTouch: true });
  const p = await context.newPage(); p.setDefaultTimeout(20000);
  type Saved = { planId: string; revisionId: string; intent: DraftDocument };
  const read = async (): Promise<Saved> => {
    const id = new URL(p.url()).searchParams.get('planId')!;
    const response = await context.request.get(`${base}/api/trainer2/drafts/${id}`);
    assert.equal(response.status(), 200); return response.json();
  };
  const save = async () => { await p.getByRole('button', { name: 'Save plan', exact: true }).click(); await p.getByRole('status').filter({ hasText: /^Saved$/ }).waitFor(); return read(); };
  const reload = async () => { const bookmark = p.url(); await p.goto('about:blank'); await p.goto(bookmark); await p.getByRole('status').filter({ hasText: /^Saved$/ }).waitFor(); await p.getByLabel('Edit scope').selectOption('2'); };
  const dialog = p.getByRole('dialog', { name: 'Confirm replacement' });
  try {
    for (const kind of mode === 'baseline' ? ['exact'] : ['exact', 'catalog', 'custom', 'equal']) {
      await p.setViewportSize({ width: 1280, height: 900 });
      await p.goto(`${base}/trainer2/dev/drafts`); await p.getByLabel('Edit scope').selectOption('2');
      await p.getByRole('button', { name: 'Add exercise', exact: true }).click();
      if (kind === 'custom') {
        await p.getByText('Create custom exercise', { exact: true }).click();
        await p.getByLabel('Custom exercise name').fill('Synthetic independent lift');
        await p.getByRole('button', { name: 'Use custom exercise', exact: true }).click();
      } else await p.getByRole('dialog').getByRole('button', { name: /Front Squat/ }).click();
      const row = p.getByRole('region', { name: 'Exercise 6', exact: true });
      const count = p.getByLabel('Exercise 6 sets', { exact: true });
      await count.fill('5'); await row.getByText('Individual sets', { exact: true }).click();
      const rest = row.getByLabel('Rest seconds (blank = unspecified)', { exact: true });
      if (kind !== 'equal') await rest.nth(5).fill('123.00');
      if (kind === 'catalog' || kind === 'custom') {
        await rest.nth(1).fill('77.00');
        await row.getByLabel('Minimum reps', { exact: true }).nth(4).fill('9');
        await row.getByLabel('Maximum reps', { exact: true }).nth(4).fill('19');
        await row.getByLabel('RIR (blank = unspecified)', { exact: true }).nth(4).fill('0');
        await row.getByLabel('Measurement kind', { exact: true }).nth(5).selectOption('externalLoad');
        await row.getByLabel('Load or assistance', { exact: true }).fill('42.500');
        await row.getByLabel('Unit', { exact: true }).selectOption('lb');
        if (kind === 'custom') {
          await row.getByLabel('Convention', { exact: true }).selectOption('perImplement');
          await row.getByLabel('Rep basis', { exact: true }).nth(4).selectOption('perSide');
        }
      }
      const before = await save(), original = before.intent.occurrences[8].positions[5];
      const historical = sql(`SELECT "canonicalContent" FROM "Trainer2PlanRevision" WHERE id='${before.revisionId}'`);
      assert(!original.sourceKey);
      await reload(); await count.fill('3');
      if (mode === 'baseline') {
        await expect(count).toHaveValue('3'); assert.equal(await dialog.count(), 0);
        const after = await save(); assert.deepEqual(after.intent.occurrences[8].positions[5].targets, original.targets.slice(0, 3));
        checks.push({ kind, dialogs: 0, before, after });
        await p.setViewportSize({ width: 390, height: 844 }); await row.scrollIntoViewIfNeeded();
        await p.screenshot({ path: `${directory}/baseline-loss-mobile.png` });
        continue;
      }
      await expect(dialog).toContainText('Set 5'); await expect(dialog).toContainText('Week 3');
      if (kind !== 'equal') await expect(dialog).toContainText('123.00');
      await expect(count).toHaveValue('5');
      assert.deepEqual(await read(), before); // Opening the warning has no persisted effects.
      await p.getByRole('button', { name: 'Keep my edits', exact: true }).click();
      // Pending changes made before the next warning must survive cancellation.
      await p.getByLabel('Plan name', { exact: true }).fill(`Pending ${kind}`);
      await p.getByLabel('Exercise 2 reps min', { exact: true }).fill('9');
      await count.fill('3');
      const warning = await dialog.innerText();
      await expect(dialog).toBeInViewport();
      await p.screenshot({ path: `${directory}/${kind}-warning-desktop.png` });
      await p.setViewportSize({ width: 390, height: 844 });
      await dialog.scrollIntoViewIfNeeded();
      await expect(dialog).toBeInViewport();
      await expect(p.getByRole('button', { name: 'Keep my edits', exact: true })).toBeInViewport();
      await p.screenshot({ path: `${directory}/${kind}-warning-mobile.png` });
      await p.getByRole('button', { name: 'Keep my edits', exact: true }).click();
      await expect(count).toHaveValue('5');
      await expect(p.getByLabel('Plan name', { exact: true })).toHaveValue(`Pending ${kind}`);
      const canceled = await save();
      assert.deepEqual(canceled.intent.occurrences[8].positions[5], original);
      const cancelExpected = structuredClone(before.intent);
      cancelExpected.name = `Pending ${kind}`;
      const co = cancelExpected.occurrences[8], other = co.positions[1];
      other.targets.forEach(t => { t.reps.min = 9; });
      co.overrides = { removed: [], order: false, fields: { [other.id]: ['reps'] }, values: { [other.id]: { reps: other.targets[0].reps } } };
      assert.deepEqual(canceled.intent, cancelExpected);
      await reload(); await count.fill('3'); await p.getByRole('button', { name: 'Confirm replacement', exact: true }).click();
      const after = await save();
      const expected = structuredClone(canceled.intent); expected.occurrences[8].positions[5].targets.splice(3);
      assert.deepEqual(after.intent, expected);
      await reload(); assert.deepEqual((await read()).intent, expected); await expect(count).toHaveValue('3');
      assert.equal(await row.getByRole('button', { name: /^Reset/ }).count(), 0);
      await row.getByText('Individual sets', { exact: true }).click(); await row.scrollIntoViewIfNeeded();
      await row.screenshot({ path: `${directory}/${kind}-result-mobile.png` });
      await p.setViewportSize({ width: 1280, height: 900 }); await p.screenshot({ path: `${directory}/${kind}-result-desktop.png`, fullPage: true });
      await count.fill('5'); const regrown = await save(); await reload();
      const targets = regrown.intent.occurrences[8].positions[5].targets;
      assert.deepEqual(targets.slice(0, 3), original.targets.slice(0, 3));
      for (const t of targets.slice(3)) {
        assert(!original.targets.some(old => old.id === t.id));
        assert.deepEqual({ ...t, id: '' }, { ...original.targets[2], id: '' });
      }
      assert.equal(sql(`SELECT "canonicalContent" FROM "Trainer2PlanRevision" WHERE id='${before.revisionId}'`), historical);
      checks.push({ kind, warning, before, canceled, after, regrown, historicalUnchanged: true });
    }
    if (mode === 'corrected') {
      await p.goto(`${base}/trainer2/dev/drafts`); await p.getByLabel('Edit scope').selectOption('2');
      const count = p.getByLabel('Exercise 1 sets', { exact: true });
      await count.fill('5'); await p.getByRole('button', { name: 'Reset sets override', exact: true }).click();
      assert.equal(await dialog.count(), 0); await expect(count).toHaveValue('3');
      await count.fill('5');
      const row = p.getByRole('region', { name: 'Exercise 1', exact: true });
      await row.getByText('Individual sets', { exact: true }).click();
      await row.getByLabel('Rest seconds (blank = unspecified)', { exact: true }).nth(5).fill('123.00');
      const before = await save(); await reload(); await count.fill('3');
      await expect(dialog).toContainText('Set 5'); await p.getByRole('button', { name: 'Keep my edits', exact: true }).click();
      await expect(count).toHaveValue('5');
      await p.getByRole('button', { name: 'Reset sets override', exact: true }).click();
      await expect(dialog).toContainText('Set 5'); await p.getByRole('button', { name: 'Confirm replacement', exact: true }).click();
      const after = await save(); await reload();
      assert.deepEqual(after.intent.occurrences[8].positions[0].targets, before.intent.occurrences[8].positions[0].targets.slice(0, 3));
      assert(!after.intent.occurrences[8].overrides?.targets?.[before.intent.occurrences[8].positions[0].targets[4].id]);
      await p.getByLabel('Edit scope').selectOption('all'); await count.fill('2');
      assert.equal(await dialog.count(), 0); const reduced = await save(); await reload(); await expect(count).toHaveValue('2');
      assert.equal(reduced.intent.occurrences[8].positions[0].targets.length, 2);
      checks.push({ sharedControls: 'Routine reset and shared reduction without conflict; customized local reduction cancel and reset confirm/save/bookmark reload; dependent mask removed.' });
    }
    receipt.status = 'passed';
  } catch (error) { receipt.error = String(error); await p.screenshot({ path: `${directory}/${mode}-failure.png`, fullPage: true }); throw error; }
  finally { writeFileSync(`${directory}/${mode}-browser.json`, JSON.stringify(receipt, null, 2)); await browser.close(); }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
