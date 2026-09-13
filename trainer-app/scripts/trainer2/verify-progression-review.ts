import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { chromium, type Page } from '@playwright/test';
import { createDraft, editDraft, readDraft, ActionCollision, type ServerPrincipal } from '../../src/lib/api/trainer2/planning';
import { createHypertrophyPlan, changeSetCount, expandWorkoutDefaults, newRow } from '../../src/lib/engine/trainer2/plan-builder';
import { draftEdits } from '../../src/components/trainer2/draft-edits';
import type { DraftDocument, CreateDraftCommand, EditDraftCommand } from '../../src/lib/trainer2-contracts/draft';

export async function verifyProgressionReview(db: PrismaClient, reader: PrismaClient, principal: ServerPrincipal, other: ServerPrincipal, startWeb: () => Promise<string>) {
  const envelope = () => ({ schemaVersion: 1 as const, actionId: randomUUID(), originatingAccountId: principal.accountId, deviceId: randomUUID(), ownershipEpoch: 0, dependsOn: [] });
  const create = async (intent: DraftDocument) => {
    const command: CreateDraftCommand = { ...envelope(), commandType: 'CreateDraft', target: { planId: randomUUID() }, expected: {}, intent };
    assert.equal((await createDraft(db, principal, command)).outcome.status, 'Accepted');
    return (await readDraft(reader, principal, command.target.planId))!;
  };
  const edit = (head: NonNullable<Awaited<ReturnType<typeof readDraft>>>, intent: DraftDocument): EditDraftCommand => ({ ...envelope(), commandType: 'EditDraft', target: { planId: head.planId }, expected: { planRevisionId: head.revisionId }, intent: { operations: draftEdits(head.intent, intent) } });
  const snapshot = async () => ({ plans: await db.trainer2Plan.findMany({ orderBy: { id: 'asc' } }), revisions: await db.trainer2PlanRevision.findMany({ orderBy: { id: 'asc' } }), identities: await db.trainer2Identity.findMany({ orderBy: { id: 'asc' } }), actions: await db.trainer2DurableAction.findMany({ orderBy: { actionId: 'asc' } }), outcomes: await db.trainer2ActionOutcome.findMany({ orderBy: { outcomeCursor: 'asc' } }), states: await db.trainer2AccountTrainingState.findMany({ orderBy: { accountId: 'asc' } }) });
  const first = await create(createHypertrophyPlan());
  assert.equal(first.review.status, 'validDraft');
  const beforeRead = await snapshot();
  assert.deepEqual(await readDraft(reader, principal, first.planId), first);
  assert.equal(await readDraft(reader, other, first.planId), null);
  assert.deepEqual(await snapshot(), beforeRead, 'Review and cross-account reads write nothing');
  const changed = structuredClone(first.intent); delete changed.progression;
  const command = edit(first, changed);
  const result = await editDraft(db, principal, command);
  assert.equal(result.outcome.status, 'Accepted');
  assert.deepEqual((await editDraft(db, principal, command)).outcome, result.outcome);
  await assert.rejects(editDraft(db, principal, { ...command, intent: { operations: [{ op: 'setProgressionIntent', progression: first.intent.progression }] } }), ActionCollision);
  const second = (await readDraft(reader, principal, first.planId))!;
  assert.equal(second.intent.progression, undefined);
  assert.equal(second.review.issues[0].code, 'PROGRESSION_INTENT_REQUIRED');
  assert.equal((await editDraft(db, principal, edit(second, first.intent))).outcome.status, 'Accepted');
  const equal = (await readDraft(reader, principal, first.planId))!;
  assert.equal(equal.contentHash, first.contentHash);
  assert.notEqual(equal.review.digest, first.review.digest);
  assert.notEqual(equal.revisionId, first.revisionId);
  assert.deepEqual((await db.trainer2PlanRevision.findUniqueOrThrow({ where: { id: first.revisionId } })).document, first.intent);
  const a = edit(equal, { ...equal.intent, name: 'Editor A' });
  const b = edit(equal, { ...equal.intent, progression: undefined });
  const raced = await Promise.all([editDraft(db, principal, a), editDraft(db, principal, b)]);
  assert.deepEqual(raced.map(r => r.outcome.status).sort(), ['Accepted', 'Conflict']);
  const current = (await readDraft(reader, principal, first.planId))!;
  const unchanged = await snapshot();
  for (const progression of [{ ...first.intent.progression, version: 2 }, { ...first.intent.progression, parameters: { increase: 5 } }, { ...first.intent.progression, mode: 'automatic' }, { ...first.intent.progression, targetId: randomUUID() }]) {
    await assert.rejects(editDraft(db, principal, { ...edit(current, { ...current.intent, name: 'Must not write' }), intent: { operations: [{ op: 'renamePlan', name: 'Must not write' }, { op: 'setProgressionIntent', progression }] } }));
  }
  await assert.rejects(editDraft(db, other, edit(current, { ...current.intent, name: 'Foreign' })));
  assert.deepEqual(await snapshot(), unchanged, 'Malformed or foreign commands leave no partial writes');
  const old = createHypertrophyPlan(); delete old.progression;
  const historical = await create(old);
  assert.equal(historical.intent.progression, undefined);
  assert.equal((await editDraft(db, principal, edit(historical, { ...old, name: 'Older renamed' }))).outcome.status, 'Accepted');
  assert.equal((await readDraft(reader, principal, historical.planId))!.intent.progression, undefined);
  const structural = createHypertrophyPlan();
  structural.occurrences[0].weekOverride = true;
  structural.occurrences[0].positions[0].exercise = { kind: 'authoredDescription', name: 'Independent custom swap', variation: '' };
  structural.occurrences[1].positions.push({ id: randomUUID(), exercise: newRow('Week-only custom').exercise, targets: [{ ...structural.occurrences[1].positions[0].targets[0], id: randomUUID() }] });
  const structurePlan = await create(structural);
  const reduced = changeSetCount(structurePlan.intent, { workoutKey: structurePlan.intent.builder!.workouts[1].key, key: structurePlan.intent.builder!.workouts[1].rows[0].key }, 2);
  assert.equal((await editDraft(db, principal, edit(structurePlan, reduced))).outcome.status, 'Accepted');
  const structureHead = (await readDraft(reader, principal, structurePlan.planId))!;
  assert.equal(structureHead.review.status, 'validDraft');
  assert.notEqual(structureHead.review.digest, structurePlan.review.digest);
  assert.deepEqual(expandWorkoutDefaults(structureHead.intent), structureHead.intent);
  const base = await startWeb();
  const beforeHttp = await snapshot();
  assert.equal((await fetch(`${base}/api/trainer2/drafts/${first.planId}`)).status, 200);
  for (const action of ['activate', 'start', 'finish']) assert.equal((await fetch(`${base}/api/trainer2/drafts/${action}`, { method: 'POST' })).status, 405);
  assert.deepEqual(await snapshot(), beforeHttp, 'HTTP review and absent lifecycle commands create nothing');
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const screenshots: string[] = [];
  try {
    const tab = await browser.newPage({ viewport: { width: 1280, height: 950 } });
    const errors: string[] = []; tab.on('pageerror', error => errors.push(error.message));
    await browserJourney(tab, base, screenshots);
    await tab.goto(`${base}/trainer2/dev/drafts?planId=${historical.planId}`);
    await tab.getByRole('status').filter({ hasText: /^Saved$/ }).waitFor();
    await tab.getByRole('button', { name: 'Review plan', exact: true }).click();
    await tab.getByRole('link', { name: /Choose how to follow/ }).click();
    await tab.getByRole('button', { name: 'Edit progression' }).click();
    await tab.getByLabel('Progression method').selectOption('plannedPrescriptions');
    await tab.getByRole('button', { name: 'Save plan', exact: true }).click();
    await tab.getByRole('status').filter({ hasText: /^Saved$/ }).waitFor();
    await tab.getByRole('button', { name: 'Review plan', exact: true }).click();
    await tab.getByRole('heading', { name: 'Saved plan checks passed' }).waitFor();
    const empty = await create(createHypertrophyPlan(undefined, true));
    await tab.goto(`${base}/trainer2/dev/drafts?planId=${empty.planId}`);
    await tab.getByRole('status').filter({ hasText: /^Saved$/ }).waitFor();
    await tab.getByRole('button', { name: 'Review plan', exact: true }).click();
    await tab.getByRole('heading', { name: 'Resolve these plan issues' }).waitFor();
    const issue = tab.getByRole('link', { name: /Week 3 \/ Upper B: add/ });
    await issue.click();
    assert.equal(await tab.getByLabel('Edit scope').inputValue(), '2');
    assert.equal(await tab.getByRole('tab', { name: 'Upper B' }).getAttribute('aria-selected'), 'true');
    await tab.setViewportSize({ width: 390, height: 844 });
    await tab.getByRole('region', { name: 'Plan review', exact: true }).scrollIntoViewIfNeeded();
    const path = resolve('artifacts/trainer2/progression-issues-mobile.png'); await tab.screenshot({ path }); screenshots.push(path);
    assert.deepEqual(errors, []);
    return { status: 'passed', browser: browser.version(), screenshots, cases: ['immutable intent', 'same values new digest', 'review read-only', 'two-editor CAS', 'safe retry and collision', 'strict atomic rejection', 'cross-account rejection', 'old plan explicit selection', 'independent/custom/structural edits', 'browser save-review-edit-review-reload', 'mobile issue edit link'] };
  } finally { await browser.close(); }
}
async function browserJourney(tab: Page, base: string, screenshots: string[]) {
  const button = (name: string) => tab.getByRole('button', { name, exact: true });
  const save = async () => { await button('Save plan').click(); await tab.getByRole('status').filter({ hasText: /^Saved$/ }).waitFor(); };
  const review = async () => { await button('Review plan').click(); await tab.getByRole('heading', { name: 'Saved plan checks passed' }).waitFor(); };
  await tab.goto(`${base}/trainer2/dev/drafts`);
  await tab.getByRole('tab', { name: 'Lower A', exact: true }).waitFor();
  assert.equal(await button('Review plan').isDisabled(), true);
  await tab.getByLabel('Exercise 1 reps min', { exact: true }).fill('7');
  await save(); await review();
  await tab.getByText('Workouts, weekly changes and deload', { exact: true }).click();
  assert.equal(await tab.getByRole('heading', { name: 'Week 5 · Deload', exact: true }).count(), 1);
  for (const [width, height, name] of [[1280, 950, 'desktop'], [390, 844, 'mobile']] as const) {
    await tab.setViewportSize({ width, height }); await tab.evaluate(() => window.scrollTo(0, 0));
    const path = resolve(`artifacts/trainer2/progression-${name}.png`); await tab.screenshot({ path }); screenshots.push(path);
    assert(await tab.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await tab.getByRole('heading', { name: 'Saved plan checks passed' }).scrollIntoViewIfNeeded();
    const reviewPath = resolve(`artifacts/trainer2/review-${name}.png`); await tab.screenshot({ path: reviewPath }); screenshots.push(reviewPath);
  }
  await tab.getByLabel('Plan name').fill('Reviewed edited plan');
  assert.equal(await button('Review plan').isDisabled(), true);
  await save(); await tab.getByText(/Review outdated/).waitFor(); await review();
  await tab.reload(); await tab.getByRole('status').filter({ hasText: /^Saved$/ }).waitFor();
  assert.equal(await tab.getByRole('heading', { name: 'Saved plan checks passed' }).count(), 0);
  await review();
}
