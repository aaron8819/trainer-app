import assert from 'node:assert/strict';
import { randomUUID as uuid } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import type { PrismaClient } from '@prisma/client';
import { chromium } from '@playwright/test';
import { createDraft, readDraft, type ServerPrincipal } from '../../src/lib/api/trainer2/planning';
import { canonicalJson, integrityHash } from '../../src/lib/api/trainer2/integrity';
import { createHypertrophyPlan } from '../../src/lib/engine/trainer2/plan-builder';
import { savedDraftDocument, type DraftDocument, type EditDraftCommand } from '../../src/lib/trainer2-contracts/draft';
import { INVALID_REVIEW_MESSAGE, validateReviewResponse } from '../../src/lib/engine/trainer2/review-response';

// Invoked only by the explicitly confirmed disposable progression harness.
export async function verifyReviewCorrections(db: PrismaClient, reader: PrismaClient, principal: ServerPrincipal, base: string) {
  const checks: { name: string; detail: unknown }[] = [];
  const record = (name: string, detail: unknown = true) => { checks.push({ name, detail }); console.log(`PASS ${name}`); };
  const envelope = () => ({ schemaVersion: 1 as const, actionId: uuid(), originatingAccountId: principal.accountId,
    deviceId: uuid(), ownershipEpoch: 0, dependsOn: [] });
  const create = async (intent: DraftDocument) => {
    const planId = uuid();
    assert.equal((await createDraft(db, principal, { ...envelope(), commandType: 'CreateDraft', target: { planId }, expected: {}, intent })).outcome.status, 'Accepted');
    return (await readDraft(reader, principal, planId))!;
  };
  const independent = createHypertrophyPlan(); delete independent.builder;
  independent.name = 'Synthetic interleaved order';
  independent.occurrences = independent.occurrences.slice(0, 4).map((o, i) => ({ id: o.id,
    name: ['Zulu', 'Alpha', 'Same name', 'Same name'][i], stageId: independent.stages[[2, 0, 2, 1][i]].id,
    positions: [{ id: uuid(), exercise: { kind: 'authoredDescription', name: `Custom exercise ${i + 1}`, variation: '' },
      targets: [{ id: uuid(), classification: 'working', required: true, reps: { min: 8, max: 12, basis: 'perSide' }, rir: '2.00', restSeconds: null,
        measurement: { kind: 'externalLoad', value: '17.500', unit: 'kg', convention: 'perImplement', zeroMeaning: 'validZero' } },
      { id: uuid(), classification: 'optionalFinisher', required: false, reps: { min: 5, max: 7, basis: 'alternating' }, rir: null, restSeconds: '90.00',
        measurement: { kind: 'assistance', value: '0.00', unit: 'lb', convention: 'displayedAssistance', zeroMeaning: 'noAssistance' } }] }] }));
  const mixed = createHypertrophyPlan();
  mixed.occurrences[0].weekOverride = true;
  mixed.occurrences[0].positions.push({ ...structuredClone(independent.occurrences[0].positions[0]), id: uuid(),
    targets: independent.occurrences[0].positions[0].targets.map(t => ({ ...t, id: uuid() })) });
  const heads = await Promise.all([create(createHypertrophyPlan()), create(independent), create(mixed)]);
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const tab = await browser.newPage({ viewport: { width: 1280, height: 950 } });
  tab.setDefaultTimeout(15_000);
  const errors: string[] = []; tab.on('pageerror', e => errors.push(e.message));
  const saved = () => tab.getByRole('status').filter({ hasText: /^Saved$/ }).waitFor();
  const open = async (planId: string) => { await tab.goto(`${base}/trainer2/dev/drafts?planId=${planId}`); await saved(); };
  const review = async () => { await tab.getByRole('button', { name: 'Review plan', exact: true }).click(); await tab.getByRole('heading', { name: 'Saved plan checks passed' }).waitFor(); };
  const rendered = tab.getByRole('region', { name: 'Saved plan review', exact: true });
  const compare = async (planId: string) => {
    const plan = await db.trainer2Plan.findUniqueOrThrow({ where: { id: planId } });
    const revision = await db.trainer2PlanRevision.findUniqueOrThrow({ where: { id: plan.currentRevisionId! } });
    const doc = savedDraftDocument.parse(revision.document);
    // PostgreSQL array order is the oracle, independent of review grouping.
    assert.deepEqual(await rendered.locator('[data-occurrence-id]').evaluateAll(elements => elements.map(e => e.getAttribute('data-occurrence-id'))), doc.occurrences.map(o => o.id));
    assert.deepEqual(await rendered.locator('h4').allTextContents(), doc.occurrences.map(o => o.name + (o.weekOverride ? ' · Week-only edits' : '')));
    for (const o of doc.occurrences) {
      const box = rendered.locator(`[data-occurrence-id="${o.id}"]`);
      const rows = box.locator(':scope > div');
      assert.equal(await rows.count(), o.positions.length);
      for (const [pi, p] of o.positions.entries()) {
        assert.equal(await rows.nth(pi).locator('p').first().innerText(), `${p.exercise.name} ${p.exercise.variation}`.trim());
        const sets = await rows.nth(pi).locator('p').allTextContents();
        assert.equal(sets.length - 1, p.targets.length);
        p.targets.forEach((t, ti) => {
          assert(sets[ti + 1].startsWith(`Set ${ti + 1}: ${t.reps.min}–${t.reps.max} reps`));
          if (t.reps.basis === 'perSide') assert(sets[ti + 1].includes('(per side)'));
          if (t.reps.basis === 'alternating') assert(sets[ti + 1].includes('(alternating)'));
          if (t.rir !== null) assert(sets[ti + 1].includes(` · ${t.rir} reps left`));
          if (t.measurement && t.measurement.kind !== 'bodyweight') assert(sets[ti + 1].includes(` · ${t.measurement.value} ${t.measurement.unit}`));
          if (t.restSeconds !== null) assert(sets[ti + 1].includes(` · Rest ${t.restSeconds}s`));
          if (!t.required) assert(sets[ti + 1].includes(' · Optional'));
        });
      }
    }
    record('Rendered order and prescriptions equal PostgreSQL', { planId, revisionId: revision.id, ids: doc.occurrences.map(o => o.id) });
  };
  try {
    for (const head of heads) {
      const result = await fetch(`${base}/api/trainer2/drafts/${head.planId}`); assert.equal(result.status, 200);
      const data = await validateReviewResponse(await result.json(), { accountId: principal.accountId, planId: head.planId, snapshot: head });
      assert.equal(data.review.contentHash, integrityHash(canonicalJson(head.intent)));
      await open(head.planId); await review(); await tab.getByText('Workouts, weekly changes and deload', { exact: true }).click(); await compare(head.planId);
    }
    const head = heads[1]; await open(head.planId);
    // Use the real independent editor reorder control, then save/reload/review.
    await tab.locator(`#edit-${head.intent.occurrences[0].id}`).getByRole('button', { name: 'Move down', exact: true }).first().click();
    await tab.getByRole('button', { name: 'Save plan', exact: true }).click(); await saved(); await tab.reload(); await saved(); await review();
    await tab.getByText('Workouts, weekly changes and deload', { exact: true }).click(); await compare(head.planId);
    for (const [width, height, label] of [[1280, 950, 'desktop'], [390, 844, 'mobile']] as const) {
      await tab.setViewportSize({ width, height }); await rendered.scrollIntoViewIfNeeded();
      await tab.screenshot({ path: `artifacts/trainer2/corrected-order-${label}.png` });
      assert(await tab.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    }
    const fault = async (name: string, mutate: (data: Record<string, unknown>) => void) => {
      await tab.route(`**/api/trainer2/drafts/${head.planId}`, async route => {
        const response = await route.fetch(); const data = await response.json(); mutate(data); await route.fulfill({ response, json: data });
      }, { times: 1 });
      await tab.getByRole('button', { name: 'Review plan', exact: true }).click();
      await tab.getByRole('alert').filter({ hasText: INVALID_REVIEW_MESSAGE }).waitFor();
      // Wait for completion as the previous error is deliberately retained during retry.
      await tab.getByRole('button', { name: 'Review plan', exact: true }).waitFor();
      assert.equal(await tab.getByRole('heading', { name: 'Saved plan checks passed' }).count(), 0);
      assert.equal(await tab.getByRole('heading', { name: 'Previous saved plan review' }).count(), 1);
      record(`Rejected client response: ${name}`);
    };
    const fields = ['accountId', 'planId', 'revisionId', 'contentHash', 'progression', 'progressionHash', 'policyVersion', 'digest', 'intent', 'issues', 'status'];
    for (const field of fields) await fault(`missing ${field}`, data => { delete (data.review as Record<string, unknown>)[field]; });
    for (const value of [null, '', 42, {}]) await fault(`invalid account ${JSON.stringify(value)}`, data => { (data.review as Record<string, unknown>).accountId = value; });
    for (const [field, value] of Object.entries({ accountId: 'another-account', planId: uuid(), revisionId: uuid(), policyVersion: 'trainer2-plan-review-v2',
      contentHash: '0'.repeat(64), progressionHash: '0'.repeat(64), digest: '0'.repeat(64), status: 'passed', progression: { version: 2 } }))
      await fault(`wrong ${field}`, data => { (data.review as Record<string, unknown>)[field] = value; });
    await fault('inconsistent result content', data => { ((data.review as Record<string, unknown>).intent as DraftDocument).name = 'Incorrect content'; });
    await fault('inconsistent result discriminator', data => { (data.review as Record<string, unknown>).status = 'issues'; });
    await tab.getByRole('region', { name: 'Plan review', exact: true }).scrollIntoViewIfNeeded();
    await tab.screenshot({ path: 'artifacts/trainer2/invalid-review-mobile.png' });
    await review(); record('Valid retry clears failed refresh state');
    assert.deepEqual((await db.trainer2PlanRevision.findUniqueOrThrow({ where: { id: head.revisionId } })).document, head.intent);
    // Duplicate labels are disambiguated by sequence, links still use identity.
    const latest = (await readDraft(reader, principal, head.planId))!;
    const command: EditDraftCommand = { ...envelope(), commandType: 'EditDraft', target: { planId: head.planId }, expected: { planRevisionId: latest.revisionId },
      intent: { operations: latest.intent.occurrences[2].positions.map(p => ({ op: 'removePosition', positionId: p.id })) } };
    const edit = await tab.request.post(`${base}/api/trainer2/drafts/edit`, { data: command, headers: { Origin: base } }); assert.equal(edit.status(), 200);
    await open(head.planId); await tab.getByRole('button', { name: 'Review plan', exact: true }).click();
    await tab.getByRole('heading', { name: 'Resolve these plan issues' }).waitFor();
    await tab.getByRole('link', { name: /Same name \(workout 3\)/ }).click();
    assert.equal(await tab.evaluate(() => document.activeElement?.id), `edit-${latest.intent.occurrences[2].id}`);
    record('Duplicate-name issue label and link preserve identity');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); writeFileSync('artifacts/trainer2/correction-matrix.json', JSON.stringify({ checks, errors }, null, 2)); }
}
