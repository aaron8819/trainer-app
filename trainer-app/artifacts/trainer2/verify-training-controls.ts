import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium, expect } from '@playwright/test';
import { createHypertrophyPlan } from '../../src/lib/engine/trainer2/plan-builder';
import { verificationSource } from '../../scripts/trainer2/verification-source';

async function main() {
  const [base, confirmation] = process.argv.slice(2);
  const ready = JSON.parse(readFileSync('artifacts/trainer2/training-ui-evidence/demo-ready.json', 'utf8'));
  assert(confirmation === '--confirm-synthetic-trial' && /^http:\/\/127\.0\.0\.1:\d+$/.test(base) && new URL(ready.url).origin === base);
  const source = verificationSource(), accountId = ready.next.accountId, planId = randomUUID();
  const get = async (path: string) => { const r = await fetch(base + path); assert(r.ok); return r.json(); };
  const post = async (path: string, data: object) => {
    const r = await fetch(base + path, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({ schemaVersion: 1, actionId: randomUUID(), deviceId: randomUUID(), originatingAccountId: accountId, ownershipEpoch: 0, dependsOn: [], ...data }) });
    const body = await r.json(); assert.equal(r.status, 200, JSON.stringify(body)); return body.outcome.result;
  };
  const template = createHypertrophyPlan(), target = template.occurrences[0].positions[0].targets[0];
  const stages = [{ id: randomUUID(), name: 'Week 1' }, { id: randomUUID(), name: 'Final block' }];
  const external = { kind: 'externalLoad' as const, value: '0', unit: 'kg' as const, convention: 'barbellTotal' as const, zeroMeaning: 'validZero' as const };
  const positions = [
    { id: randomUUID(), role: 'Main lift', exercise: template.occurrences[0].positions[0].exercise, targets: [{ ...target, id: randomUUID(), rir: '1', measurement: external }, { ...target, id: randomUUID(), rir: '4', measurement: { ...external, unit: 'lb' } }] },
    { id: randomUUID(), exercise: { kind: 'authoredDescription', name: 'Same catalog display name is not identity', variation: '' }, targets: [{ ...target, id: randomUUID(), measurement: { kind: 'bodyweight', convention: 'bodyweightOnly' } }] },
    { id: randomUUID(), exercise: { kind: 'authoredDescription', name: 'Synthetic assistance', variation: '' }, targets: [{ ...target, id: randomUUID(), reps: { min: 6, max: 8, basis: 'perSide' }, measurement: { kind: 'assistance', convention: 'displayedAssistance', value: '0', unit: 'lb', zeroMeaning: 'noAssistance' } }] },
  ];
  const occurrences = [0, 1, 2].map(i => ({ id: randomUUID(), stageId: stages[i === 2 ? 1 : 0].id, name: 'Duplicate workout', positions: i === 0 ? positions : [{ id: randomUUID(), exercise: { kind: 'authoredDescription', name: 'Unmatched custom exercise', variation: '' }, targets: [{ ...target, id: randomUUID() }] }] }));
  const intent = { schemaVersion: 1, name: 'SYNTHETIC independent controls', endpoint: 'endOfOrderedOccurrences', progression: template.progression, stages, occurrences };
  await post('/api/trainer2/drafts/create', { commandType: 'CreateDraft', target: { planId }, expected: {}, intent });
  const draft = await get(`/api/trainer2/drafts/${planId}`);
  await post('/api/trainer2/drafts/activate', { commandType: 'ActivatePlan', target: { planId }, expected: { planRevisionId: draft.revisionId }, intent: { reviewed: draft.activation } });
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors: string[] = []; page.on('dialog', d => void d.accept()); page.on('pageerror', e => errors.push(e.message));
  const url = `${base}/trainer2/dev/drafts?planId=${planId}`, dir = 'artifacts/trainer2/training-ui-evidence/';
  try {
    await page.goto(url);
    await expect(page.getByText('Week 1 of 2')).toBeVisible();
    await expect(page.getByText(/Target 1–4 RIR/)).toBeVisible();
    await expect(page.getByRole('article')).toHaveCount(2);
    await page.screenshot({ path: dir + 'independent-mixed.png', fullPage: true });
    await page.getByRole('button', { name: 'Start workout', exact: true }).click();
    await expect(page).toHaveURL(/executions\//);
    const executionId = page.url().split('/').at(-1)!;
    const rows = page.locator('[aria-label$="actual result"]');
    await expect(rows).toHaveCount(4);
    await rows.nth(0).getByLabel('Set 1 Actual reps').fill('8');
    await rows.nth(0).getByLabel('Set 1 Actual load', { exact: true }).fill('0');
    await rows.nth(0).getByRole('button', { name: 'Record set' }).click(); await expect(rows.nth(0)).toContainText('Saved v1');
    await rows.nth(1).getByLabel('Set 2 Actual reps').fill('7');
    await rows.nth(1).getByLabel('Set 2 Actual load', { exact: true }).fill('45');
    await rows.nth(1).getByRole('button', { name: 'Record set' }).click(); await expect(rows.nth(1)).toContainText('Saved v1');
    await rows.nth(2).getByLabel('Set 1 Actual reps').fill('0');
    await rows.nth(2).getByRole('button', { name: 'Record set' }).click(); await expect(rows.nth(2)).toContainText('Saved v1');
    await rows.nth(3).getByLabel('Set 1 Actual reps').fill('6');
    await rows.nth(3).getByLabel('Set 1 Actual load', { exact: true }).fill('0');
    await rows.nth(3).getByRole('button', { name: 'Record set' }).click(); await expect(rows.nth(3)).toContainText('Saved v1');
    await expect(page.getByRole('button', { name: 'Finish workout', exact: true })).toBeEnabled();
    const read = await get(`/api/trainer2/executions/${executionId}`);
    const results = read.initial.positions.flatMap((p: { targets: { id: string }[] }) => p.targets.map(t => read.results.find((r: { targetId: string }) => r.targetId === t.id).result));
    assert.equal(results[0].measurement.value, '0'); assert.equal(results[0].measurement.unit, 'kg');
    assert.equal(results[1].measurement.unit, 'lb'); assert.equal(results[2].measurement.kind, 'bodyweight');
    assert.equal(results[3].measurement.kind, 'assistance'); assert.equal(results[3].measurement.value, '0'); assert.equal(results[3].reps.basis, 'perSide');
    assert.equal(read.previous.length, 1); assert.equal(read.previous[0].positionId, positions[0].id);
    await page.getByRole('button', { name: 'Finish workout', exact: true }).click(); await page.getByRole('button', { name: 'Confirm finish' }).click();
    await expect(page).toHaveURL(url);
    await page.getByRole('button', { name: 'Start workout', exact: true }).click();
    await expect(page.getByText('No comparable previous performance.')).toBeVisible();
    const discardedUrl = page.url();
    await page.getByLabel('Set 1 Actual reps', { exact: true }).fill('6');
    await page.getByRole('link', { name: 'Back to training' }).click();
    await page.getByRole('link', { name: 'Continue workout' }).click();
    await expect(page.getByLabel('Set 1 Actual reps', { exact: true })).toHaveValue('6');
    await page.getByRole('button', { name: 'Discard input' }).click();
    await page.getByRole('button', { name: 'Discard empty workout', exact: true }).click(); await page.getByRole('button', { name: 'Confirm discard' }).click();
    await expect(page.getByRole('heading', { name: 'Workout attempt discarded' })).toBeVisible();
    await page.getByRole('link', { name: 'Back to training' }).click();
    await expect(page.getByRole('link', { name: 'Continue workout' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Skip workout', exact: true }).click();
    await expect(page.getByRole('group', { name: 'Confirm skip' })).toContainText('Week 1 · Workout 2 of 3');
    await page.screenshot({ path: dir + 'duplicate-confirmation.png', fullPage: true });
    await page.getByRole('button', { name: 'Confirm skip' }).click();
    await expect(page.getByText('Week 2 of 2')).toBeVisible();
    await page.getByRole('button', { name: 'Skip workout', exact: true }).click(); await page.getByRole('button', { name: 'Confirm skip' }).click();
    await expect(page.getByText('Program complete')).toBeVisible();
    await expect(page.getByText(/1 workouts completed · 2 skipped/)).toBeVisible();
    await page.screenshot({ path: dir + 'final-completion.png', fullPage: true });
    await page.reload(); await expect(page.getByText('Program complete')).toBeVisible();
    await page.goto(discardedUrl); await expect(page.getByRole('heading', { name: 'Workout attempt discarded' })).toBeVisible();
    assert.deepEqual(errors, []);
    writeFileSync(dir + 'controls.json', JSON.stringify({ source, browser: browser.version(), planId, url, discardedUrl, executionId, results, previous: read.previous, errors, passed: ['Independent two-stage layout and mixed nonidentical prescriptions', 'kg/lb, external zero, bodyweight zero reps, assistance zero, per-side, optional actual RIR', 'Custom identity omission and no-history empty state', 'Pending input retained across leaving/returning; explicit discard releases finish/discard guard', 'Discarded attempts excluded from home; bookmark preserved', 'Duplicate-name confirmation binding; final completion with truthful completed/skipped counts; reload'] }, null, 2));
    console.log('PASS synthetic independent/measurement/final-plan controls');
  } finally { await browser.close(); }
}
void main().catch(e => { console.error(e); process.exitCode = 1; });
