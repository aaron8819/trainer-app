import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium, expect } from '@playwright/test';
import { createHypertrophyPlan, expandWorkoutDefaults, markOverride } from '../../src/lib/engine/trainer2/plan-builder';
import type { DraftDocument } from '../../src/lib/trainer2-contracts/draft';
import { draftEdits } from '../../src/components/trainer2/draft-edits';
import { verificationSource } from './verification-source';

// Run against a separately launched, task-owned disposable demo only. Baseline
// fixtures are optional and must have been saved by the uncorrected candidate.
async function main() {
  const [confirmation, base, container, baseline] = process.argv.slice(2);
  assert.equal(confirmation, '--confirm-disposable');
  assert.match(base, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.match(container, /^trainer2-draft-[a-f0-9]{12}$/);
  const database = container.replace('trainer2-draft-', 'trainer2_disposable_');
  const sql = (q: string) => execFileSync('docker', ['exec', container, 'psql', '-U', 'postgres', '-d', database, '-At', '-c', q], { encoding: 'utf8', windowsHide: true }).trim();
  const account = sql(`SELECT "accountId" FROM "Trainer2AccountPrincipal" WHERE subject='developer'`);
  assert(account);
  const directory = 'artifacts/corrections'; mkdirSync(directory, { recursive: true });
  const checks: string[] = [];
  const receipt: Record<string, unknown> = { source: verificationSource(), base, container, database, checks };
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, hasTouch: true });
  const p = await context.newPage(); p.setDefaultTimeout(15000);
  const envelope = () => ({ schemaVersion: 1, originatingAccountId: account, deviceId: randomUUID(), ownershipEpoch: 0, dependsOn: [], actionId: randomUUID() });
  type Saved = { planId: string; revisionId: string; revisionNumber: number; intent: DraftDocument };
  const read = async (id: string): Promise<Saved> => { const r = await context.request.get(`${base}/api/trainer2/drafts/${id}`); assert.equal(r.status(), 200); return r.json(); };
  const post = async (command: object, kind: 'create' | 'edit') => { const r = await context.request.post(`${base}/api/trainer2/drafts/${kind}`, { data: command, headers: { Origin: base } }); return { status: r.status(), body: await r.json() }; };
  const create = async (intent: DraftDocument) => { const planId = randomUUID(); const r = await post({ ...envelope(), commandType: 'CreateDraft', target: { planId }, expected: {}, intent }, 'create'); assert.equal(r.body.outcome?.status, 'Accepted'); return read(planId); };
  const row = (i: number) => p.getByRole('region', { name: `Exercise ${i}`, exact: true });
  const fresh = async () => { await p.goto(`${base}/trainer2/dev/drafts`); await p.getByRole('tab', { name: 'Lower A', exact: true }).waitFor(); };
  const save = async () => { await p.getByRole('button', { name: 'Save plan', exact: true }).click(); await p.getByRole('status').filter({ hasText: /^Saved$/ }).waitFor(); return read(new URL(p.url()).searchParams.get('planId')!); };
  const reload = async () => { await p.reload(); await p.getByRole('status').filter({ hasText: /^Saved$/ }).waitFor(); };
  try {
    await fresh();
    // R1 exact reported reproduction, with surviving custom work and pending name.
    await p.getByLabel('Edit scope').selectOption('2'); await p.getByLabel('Exercise 1 sets', { exact: true }).fill('5');
    await row(1).getByText('Individual sets', { exact: true }).click();
    await row(1).getByLabel('Rest seconds (blank = unspecified)', { exact: true }).nth(5).fill('123.00');
    await row(1).getByLabel('Rest seconds (blank = unspecified)', { exact: true }).nth(1).fill('77.00');
    const before = await save(); const original = before.intent.occurrences[8].positions[0];
    await reload(); await p.getByLabel('Edit scope').selectOption('2'); await p.getByLabel('Plan name', { exact: true }).fill('Pending unrelated edit');
    await p.getByRole('button', { name: 'Reset sets override', exact: true }).click();
    const dialog = p.getByRole('dialog', { name: 'Confirm replacement' }); await expect(dialog).toContainText('Set 5'); await expect(dialog).toContainText('Week 3');
    await p.screenshot({ path: `${directory}/reset-confirm-desktop.png`, fullPage: true });
    await p.setViewportSize({ width: 390, height: 844 }); await p.screenshot({ path: `${directory}/reset-confirm-mobile.png`, fullPage: true });
    await p.getByRole('button', { name: 'Keep my edits', exact: true }).click();
    await expect(p.getByLabel('Exercise 1 sets', { exact: true })).toHaveValue('5'); await expect(p.getByLabel('Plan name', { exact: true })).toHaveValue('Pending unrelated edit');
    await p.getByRole('button', { name: 'Reset sets override', exact: true }).click(); await p.getByRole('button', { name: 'Confirm replacement', exact: true }).click();
    let saved = await save(); assert.deepEqual(saved.intent.occurrences[8].positions[0].targets, original.targets.slice(0, 3));
    assert(!saved.intent.occurrences[8].overrides?.targets?.[original.targets[4].id]); assert.equal(saved.intent.name, 'Pending unrelated edit');
    await reload(); await p.getByLabel('Edit scope').selectOption('2'); await expect(p.getByLabel('Exercise 1 sets', { exact: true })).toHaveValue('3');
    await p.getByLabel('Exercise 1 sets', { exact: true }).fill('4'); await p.getByRole('button', { name: 'Reset sets override', exact: true }).click(); assert.equal(await dialog.count(), 0);
    await p.getByLabel('Edit scope').selectOption('4'); await p.getByLabel('Exercise 1 sets', { exact: true }).fill('5'); await p.getByRole('button', { name: 'Reset sets override', exact: true }).click();
    await expect(p.getByLabel('Exercise 1 sets', { exact: true })).toHaveValue('2'); await save(); await reload(); await p.getByLabel('Edit scope').selectOption('4'); await expect(p.getByLabel('Exercise 1 sets', { exact: true })).toHaveValue('2');
    checks.push('R1 exact reset, cancel, confirm, save/reload; surviving IDs/prescriptions and pending name retained; uncustomized reset and deload count stable.');

    // R2 ordinary shared removal: cancel first, then save all dependent cleanup.
    await fresh(); await p.setViewportSize({ width: 1280, height: 900 }); await p.getByLabel('Edit scope').selectOption('2'); await p.getByLabel('Exercise 1 reps min', { exact: true }).fill('7');
    const removalBefore = await save(), removed = removalBefore.intent.occurrences[8].positions[0];
    await p.getByLabel('Edit scope').selectOption('all'); await row(1).getByRole('button', { name: 'Remove exercise', exact: true }).click(); await p.getByRole('button', { name: 'Keep my edits', exact: true }).click();
    assert.deepEqual((await read(removalBefore.planId)).intent, removalBefore.intent);
    await p.getByLabel('Edit scope').selectOption('2'); await expect(p.getByLabel('Exercise 1 reps min', { exact: true })).toHaveValue('7');
    await p.getByLabel('Edit scope').selectOption('all'); await row(1).getByRole('button', { name: 'Remove exercise', exact: true }).click(); await p.getByRole('button', { name: 'Confirm replacement', exact: true }).click(); saved = await save(); await reload();
    const edits = saved.intent.occurrences[8].overrides!; assert(!edits.values?.[removed.id]); assert(!edits.fields[removed.id]); assert(removed.targets.every(t => !edits.targets?.[t.id]));
    checks.push('R2 shared removal cancel preserves saved customization; confirmation removes position, masks, values and target metadata through PostgreSQL reload.');

    // Same server relationship boundary on create and edit; each rejected batch
    // begins with a valid rename to discriminate atomic rejection.
    for (const kind of ['unknown', 'foreign', 'unmasked', 'unsupported', 'malformed']) {
      const start = await create(createHypertrophyPlan()), d = structuredClone(start.intent), o = d.occurrences[8];
      const key = kind === 'unknown' ? randomUUID() : kind === 'foreign' ? d.occurrences[0].positions[0].id : o.positions[0].id;
      o.overrides = { removed: [], order: false, fields: kind === 'unmasked' ? {} : { [o.positions[0].id]: ['rir'] }, values: { [key]: { rir: kind === 'malformed' ? '-1' : '7' } } };
      if (kind === 'unsupported') Object.assign(o.overrides.values![key], { surprise: true });
      const id = randomUUID(); const created = await post({ ...envelope(), commandType: 'CreateDraft', target: { planId: id }, expected: {}, intent: d }, 'create');
      assert.notEqual(created.body.outcome?.status, 'Accepted'); assert.equal((await context.request.get(`${base}/api/trainer2/drafts/${id}`)).status(), 404);
      d.name = 'Must not partially apply'; const result = await post({ ...envelope(), commandType: 'EditDraft', target: { planId: start.planId }, expected: { planRevisionId: start.revisionId }, intent: { operations: draftEdits(start.intent, d) } }, 'edit');
      assert.notEqual(result.body.outcome?.status, 'Accepted'); assert.deepEqual(await read(start.planId), start);
    }
    for (const withValues of [true, false]) {
      const d = createHypertrophyPlan(), o = d.occurrences[8], row = o.positions[0]; markOverride(o, row.id, ['reps'], withValues ? { reps: row.targets[0].reps } : undefined);
      const start = await create(d); const next = structuredClone(start.intent); next.builder!.workouts[0].rows[0].prescription.reps.min = 7;
      const result = await post({ ...envelope(), commandType: 'EditDraft', target: { planId: start.planId }, expected: { planRevisionId: start.revisionId }, intent: { operations: draftEdits(start.intent, expandWorkoutDefaults(next)) } }, 'edit');
      assert.equal(result.body.outcome?.status, 'Accepted'); assert.equal((await read(start.planId)).intent.occurrences[8].positions[0].targets[0].reps.min, 6);
    }
    checks.push('R2 unknown/foreign/unmasked/unsupported/malformed values rejected on Create/Edit with no partial rename or revision; explicit equal values and mask-only documents survive shared edits.');

    // U1 plus Add/Swap keyboard restoration and populated-plan smoke.
    await fresh();
    for (const entry of ['Add exercise', 'Swap']) for (const exit of ['Escape', 'Close picker', 'select']) {
      const trigger = entry === 'Swap' ? row(1).getByRole('button', { name: 'Swap', exact: true }) : p.getByRole('button', { name: 'Add exercise', exact: true });
      await trigger.click();
      if (exit === 'Escape') await p.keyboard.press('Escape'); else if (exit === 'Close picker') await p.getByRole('button', { name: exit, exact: true }).click(); else await p.getByRole('dialog').getByRole('button', { name: /Front Squat/ }).click();
      await expect(trigger).toBeFocused(); await p.keyboard.press('Tab'); assert.notEqual(await p.evaluate(() => document.activeElement?.tagName), 'BODY');
    }
    await p.getByLabel('Edit scope').selectOption('2'); await p.getByRole('button', { name: 'Add exercise', exact: true }).click(); await p.getByRole('dialog').getByRole('button', { name: /Front Squat/ }).click();
    const n = await p.getByRole('region', { name: /^Exercise \d+$/ }).count(); await p.getByLabel(`Exercise ${n} reps min`, { exact: true }).fill('7');
    await row(n).getByText('Individual sets', { exact: true }).click(); await row(n).getByLabel('Rest seconds (blank = unspecified)', { exact: true }).nth(2).fill('0');
    assert.equal(await row(n).getByRole('button', { name: /^Reset/ }).count(), 0); saved = await save(); const addition = saved.intent.occurrences[8].positions.at(-1)!;
    assert(!addition.sourceKey); assert.equal(addition.targets[0].reps.min, 7); assert.equal(addition.targets[1].restSeconds, '0');
    await reload(); await p.getByLabel('Edit scope').selectOption('2'); assert.equal(await row(n).getByRole('button', { name: /^Reset/ }).count(), 0);
    await p.screenshot({ path: `${directory}/addition-desktop.png`, fullPage: true }); await p.setViewportSize({ width: 390, height: 844 }); await row(n).scrollIntoViewIfNeeded(); await p.screenshot({ path: `${directory}/addition-mobile.png` });
    await p.getByLabel('Exercise 1 reps min', { exact: true }).fill('7'); await row(1).getByRole('button', { name: 'Reset reps override', exact: true }).click(); await expect(p.getByLabel('Exercise 1 reps min', { exact: true })).toHaveValue('6'); await save();
    checks.push('U1 week-only add/edit/individual edit/save/reload has no reset controls or inheritance masks; shared reset still works. U2 Add/Swap Escape/close/select restore focus and Tab continues; populated swap/customize/save/reload passes.');

    // U3 effective saved targets, including meaningful zero and per-side basis.
    const mixed = createHypertrophyPlan(), o = mixed.occurrences[8], target = o.positions[0].targets[1]; target.reps = { min: 15, max: 20, basis: 'total' }; target.rir = '0'; o.overrides = { removed: [], order: false, fields: {}, targets: { [target.id]: ['reps', 'rir'] } };
    const mixedSaved = await create(mixed); await p.goto(`${base}/trainer2/dev/drafts?planId=${mixedSaved.planId}`); await p.getByRole('status').filter({ hasText: /^Saved$/ }).waitFor(); await p.getByRole('button', { name: 'View all 5 weeks', exact: true }).click();
    const weekly = p.getByLabel('All five weeks', { exact: true }); await expect(weekly).toContainText('Mixed sets · Set 1: 6–10 · 2 left; Set 2: 15–20 · 0 left; Set 3: 6–10 · 2 left'); await expect(weekly).toContainText('2 × 8–12 per side · 2 left'); await expect(weekly).toContainText('3 × 6–10 · 3 left');
    await p.screenshot({ path: `${directory}/summary-mobile.png`, fullPage: true }); await p.setViewportSize({ width: 1280, height: 900 }); await p.screenshot({ path: `${directory}/summary-desktop.png`, fullPage: true }); assert.deepEqual((await read(mixedSaved.planId)).intent, mixed);
    checks.push('U3 mixed summary exposes every set, zero reps-left and per-side reps; homogeneous text stays compact; summary leaves saved targets unchanged.');

    if (baseline) {
      const b = JSON.parse(readFileSync(`${baseline}/browser-probes.json`, 'utf8'));
      const a = JSON.parse(readFileSync(`${baseline}/additional-probes.json`, 'utf8'));
      const ids = [b.findings.find((f: { id: string }) => f.id === 'F2').orphanMetadataAccepted.planId, a.observations.sharedRemovalOrphan.planId];
      for (const id of ids) {
        const old = await read(id); const bytes = sql(`SELECT "canonicalContent" FROM "Trainer2PlanRevision" WHERE id='${old.revisionId}'`);
        await p.goto(`${base}/trainer2/dev/drafts?planId=${id}`); await p.getByRole('button', { name: 'Remove obsolete override labels', exact: true }).waitFor();
        assert.equal((await read(id)).revisionId, old.revisionId);
        await p.screenshot({ path: `${directory}/recovery-desktop.png`, fullPage: true });
        await p.getByRole('button', { name: 'Remove obsolete override labels', exact: true }).click(); const repaired = await save();
        assert.equal(repaired.revisionNumber, old.revisionNumber + 1); assert.deepEqual(repaired.intent.occurrences.map(o => o.positions), old.intent.occurrences.map(o => o.positions));
        assert.equal(sql(`SELECT "canonicalContent" FROM "Trainer2PlanRevision" WHERE id='${old.revisionId}'`), bytes); await reload();
        assert.equal(await p.getByRole('button', { name: 'Remove obsolete override labels', exact: true }).count(), 0);
      }
      checks.push('R2 synthetic pre-correction Create orphan and ordinary shared-removal orphan open unchanged, explicitly repair into a new revision, preserve all prescriptions and historical canonical bytes.');
    }
    receipt.status = 'passed';
  } catch (error) { receipt.error = String(error); await p.screenshot({ path: `${directory}/failure.png`, fullPage: true }); throw error; }
  finally { writeFileSync(`${directory}/correction-browser.json`, JSON.stringify(receipt, null, 2)); await browser.close(); }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
