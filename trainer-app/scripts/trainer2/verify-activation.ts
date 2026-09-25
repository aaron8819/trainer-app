import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { PrismaClient } from '@prisma/client';
import type { Pool } from 'pg';
import { chromium, expect as playwrightExpect } from '@playwright/test';
import { createDraft, editDraft, readDraft, ActionCollision, type ServerPrincipal } from '../../src/lib/api/trainer2/planning';
import { activatePlan } from '../../src/lib/api/trainer2/activation';
import { changeInstructions } from '../../src/lib/api/trainer2/instructions';
import { createHypertrophyPlan } from '../../src/lib/engine/trainer2/plan-builder';
import { canonicalJson, integrityHash } from '../../src/lib/api/trainer2/integrity';
import { catalog } from '../../src/lib/engine/trainer2/catalog';
import type { DraftDocument, EditDraftCommand } from '../../src/lib/trainer2-contracts/draft';
import type { ActivatePlanCommand, InstructionCommand } from '../../src/lib/trainer2-contracts/activation';

const expect = playwrightExpect.configure({ timeout: 30_000 });
type Head = NonNullable<Awaited<ReturnType<typeof readDraft>>>;
export async function verifyActivation(db: PrismaClient, reader: PrismaClient, owner: PrismaClient, admin: Pool, browserPrincipal: ServerPrincipal, startWeb: () => Promise<string>) {
  const results: string[] = [];
  const pass = (name: string) => { results.push(name); console.log(`PASS ${name}`); writeFileSync(resolve('artifacts/trainer2/activation-results.json'), JSON.stringify(results, null, 2)); };
  const envelope = (p: ServerPrincipal) => ({ schemaVersion: 1 as const, actionId: randomUUID(), originatingAccountId: p.accountId, deviceId: randomUUID(), ownershipEpoch: 0, dependsOn: [] });
  const account = async () => { const p = { accountId: randomUUID(), sessionId: randomUUID(), issuer: 'activation-test', subject: randomUUID() }; await owner.user.create({ data: { id: p.accountId, email: `${p.subject}@trainer2.invalid` } }); await owner.trainer2AccountPrincipal.create({ data: { id: randomUUID(), ...p } }); return p; };
  const create = async (p: ServerPrincipal, intent = createHypertrophyPlan()) => { const planId = randomUUID(); assert.equal((await createDraft(db, p, { ...envelope(p), commandType: 'CreateDraft', target: { planId }, expected: {}, intent })).outcome.status, 'Accepted'); return (await readDraft(reader, p, planId))!; };
  const activation = (p: ServerPrincipal, h: Head): ActivatePlanCommand => ({ ...envelope(p), commandType: 'ActivatePlan', target: { planId: h.planId }, expected: { planRevisionId: h.revisionId }, intent: { reviewed: h.activation } });
  const edit = (p: ServerPrincipal, h: Head, name: string): EditDraftCommand => ({ ...envelope(p), commandType: 'EditDraft', target: { planId: h.planId }, expected: { planRevisionId: h.revisionId }, intent: { operations: [{ op: 'renamePlan', name }] } });
  const code = (v: { outcome: { status: string; code?: string } }, c: string) => { assert.notEqual(v.outcome.status, 'Accepted'); assert.equal(v.outcome.code, c); };
  const state = async (p: ServerPrincipal) => ({ plans: await owner.trainer2Plan.findMany({ where: { accountId: p.accountId }, orderBy: { id: 'asc' } }), revisions: await owner.trainer2PlanRevision.findMany({ where: { accountId: p.accountId }, orderBy: { id: 'asc' } }), identities: await owner.trainer2Identity.findMany({ where: { accountId: p.accountId }, orderBy: { id: 'asc' } }), decisions: await owner.trainer2PlanDecision.findMany({ where: { accountId: p.accountId }, orderBy: { id: 'asc' } }), actions: await owner.trainer2DurableAction.findMany({ where: { accountId: p.accountId }, orderBy: { actionId: 'asc' } }), outcomes: await owner.trainer2ActionOutcome.findMany({ where: { accountId: p.accountId }, orderBy: { outcomeCursor: 'asc' } }), counter: await owner.trainer2AccountTrainingState.findUnique({ where: { accountId: p.accountId } }) });
  // Wait on observed PostgreSQL lock queues, never assume a scheduling delay.
  async function orderedRace<T>(p: ServerPrincipal, first: () => Promise<T>, second: () => Promise<T>) {
    const lock = await admin.connect();
    await lock.query('BEGIN'); const pid = (await lock.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    await lock.query('SELECT "accountId" FROM "Trainer2AccountTrainingState" WHERE "accountId"=$1 FOR UPDATE', [p.accountId]);
    const waiting = async (count: number) => { const deadline = Date.now() + 8000; for (;;) { const rows = await admin.query('WITH RECURSIVE waiting(pid) AS (SELECT pid FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid)) UNION SELECT a.pid FROM pg_stat_activity a JOIN waiting w ON w.pid=ANY(pg_blocking_pids(a.pid))) SELECT DISTINCT pid FROM waiting', [pid]); if (rows.rowCount! >= count) return; if (Date.now() > deadline) throw new Error('Expected controlled lock queue'); await new Promise(r => setTimeout(r, 20)); } };
    let a: Promise<T> | undefined, b: Promise<T> | undefined;
    try { a = first(); await waiting(1); b = second(); await waiting(2); await lock.query('COMMIT'); return await Promise.all([a, b]); }
    finally { await lock.query('ROLLBACK'); lock.release(); await Promise.allSettled([a, b].filter(Boolean)); }
  }
  const p = await account(); const h = await create(p); const cmd = activation(p, h); const before = await state(p);
  const pair = await orderedRace(p, () => activatePlan(db, p, cmd), () => activatePlan(db, p, cmd));
  assert.deepEqual(pair[0].outcome, pair[1].outcome); assert.equal(pair.filter(v => v.replayed).length, 1);
  const after = await state(p); assert.equal(after.plans[0].lifecycle, 'Active'); assert.equal(after.plans[0].currentRevisionId, h.revisionId); assert.equal(after.plans[0].initialApprovedRevisionId, h.revisionId);
  assert.deepEqual(after.revisions, before.revisions); assert.deepEqual(after.identities, before.identities); assert.equal(after.decisions.length, 1); assert.equal(after.decisions[0].reviewedDigest, h.activation.digest);
  assert.equal(after.counter!.acceptedSequence, before.counter!.acceptedSequence + BigInt(1)); assert.equal(after.outcomes.filter(o => o.actionId === cmd.actionId).length, 1);
  const storedEnvelope = after.actions.find(a => a.actionId === cmd.actionId)!; assert.deepEqual(JSON.parse(storedEnvelope.submittedEnvelope), cmd);
  await assert.rejects(activatePlan(db, p, { ...cmd, deviceId: randomUUID() }), ActionCollision);
  assert.deepEqual((await activatePlan(db, p, cmd)).outcome, pair[0].outcome);
  code(await activatePlan(db, p, activation(p, h)), 'ALREADY_ACTIVATED'); code(await editDraft(db, p, edit(p, h, 'Old editor')), 'PLAN_NOT_DRAFT');
  await assert.rejects(admin.query('UPDATE "Trainer2Plan" SET "tombstonedAt"=now() WHERE "id"=$1', [h.planId]));
  pass('Exact template activation; unchanged revision/document/identity registry; same-command concurrency, lost-response replay, collision, fresh already-active command and stale editor');
  const another = await create(p); code(await activatePlan(db, p, activation(p, another)), 'CURRENT_PLAN_CONFLICT');
  await assert.rejects(admin.query(`UPDATE "Trainer2Plan" SET "lifecycle"='Active', "initialApprovedRevisionId"="currentRevisionId" WHERE "id"=$1`, [another.planId]), (e: unknown) => (e as { code: string; constraint: string }).code === '23505' && (e as { constraint: string }).constraint === 'trainer2_one_current_plan');
  // Synthetic prerequisite fixture only; no Pause command is introduced.
  const pausedFixture = await admin.connect();
  try {
    await pausedFixture.query('BEGIN');
    await pausedFixture.query('ALTER TABLE "Trainer2Plan" DISABLE TRIGGER trainer2_activation_guard');
    await pausedFixture.query(`UPDATE "Trainer2Plan" SET "lifecycle"='Paused' WHERE "id"=$1`, [h.planId]);
    await pausedFixture.query('SET CONSTRAINTS ALL IMMEDIATE');
    await pausedFixture.query('ALTER TABLE "Trainer2Plan" ENABLE TRIGGER trainer2_activation_guard');
    await pausedFixture.query('COMMIT');
  } finally { await pausedFixture.query('ROLLBACK'); pausedFixture.release(); }
  const pausedConflict = await activatePlan(db, p, activation(p, another)); code(pausedConflict, 'CURRENT_PLAN_CONFLICT');
  if (pausedConflict.outcome.status !== 'Accepted') assert.equal(pausedConflict.outcome.currentPlanId, h.planId);
  assert.deepEqual((await activatePlan(db, p, cmd)).outcome, pair[0].outcome, 'Historical success remains historical after lifecycle changes');
  assert.equal((await readDraft(reader, p, h.planId))!.state.lifecycle, 'Paused');
  await assert.rejects(admin.query(`UPDATE "Trainer2Plan" SET "lifecycle"='Active', "initialApprovedRevisionId"="currentRevisionId" WHERE "id"=$1`, [another.planId]), (e: unknown) => (e as { code: string }).code === '23505');

  const foreign = await account(); assert.equal(await readDraft(reader, foreign, h.planId), null); await assert.rejects(activatePlan(db, foreign, cmd));
  code(await activatePlan(db, foreign, { ...activation(foreign, h), originatingAccountId: foreign.accountId }), 'NOT_FOUND');
  pass('Current-plan conflict and wrong-account isolation without replacement');
  for (const equal of [false, true]) {
    const u = await account(), head = await create(u); assert.equal((await editDraft(db, u, edit(u, head, equal ? head.intent.name : 'New values'))).outcome.status, 'Accepted');
    const latest = (await readDraft(reader, u, head.planId))!; assert.notEqual(latest.revisionId, head.revisionId); assert.equal(latest.contentHash === head.contentHash, equal);
    code(await activatePlan(db, u, activation(u, head)), 'STALE_REVIEW');
  }
  pass('Changed and equal-visible-value newer revisions both invalidate activation');
  const m = await account(), mh = await create(m), mc = activation(m, mh), malformedBefore = await state(m);
  for (const mutate of [
    (v: { intent: { reviewed?: { binding: Record<string, unknown>; digest: unknown } } }) => { delete v.intent.reviewed; },
    (v: { intent: { reviewed?: { binding: Record<string, unknown>; digest: unknown } } }) => { delete v.intent.reviewed!.binding.instructionHash; },
    (v: { intent: { reviewed?: { binding: Record<string, unknown>; digest: unknown } } }) => { v.intent.reviewed!.binding.policyVersion = 'unsupported'; },
    (v: { intent: { reviewed?: { binding: Record<string, unknown>; digest: unknown } } }) => { v.intent.reviewed!.digest = null; },
  ]) { const bad = structuredClone(mc); mutate(bad); await assert.rejects(activatePlan(db, m, bad)); }
  assert.deepEqual(await state(m), malformedBefore);
  for (const field of ['accountId', 'planId', 'revisionId', 'reviewDigest', 'instructionHash'] as const) {
    const bad = structuredClone(mc); bad.actionId = randomUUID(); bad.intent.reviewed.binding[field] = field.endsWith('Hash') || field === 'reviewDigest' ? '0'.repeat(64) : randomUUID();
    code(await activatePlan(db, m, bad), 'STALE_REVIEW');
  }
  const noIntent = createHypertrophyPlan(); delete noIntent.progression; const issueHead = await create(m, noIntent);
  code(await activatePlan(db, m, activation(m, issueHead)), 'PLAN_ISSUES');
  const unsupported = createHypertrophyPlan(); unsupported.progression!.version = 2 as 1;
  await assert.rejects(createDraft(db, m, { ...envelope(m), commandType: 'CreateDraft', target: { planId: randomUUID() }, expected: {}, intent: unsupported }));
  pass('Malformed/missing/unsupported bindings, binding mismatches, unsupported intent and saved readiness issues reject without activation');
  for (const differentPlans of [false, true]) {
    const u = await account(), first = await create(u), second = differentPlans ? await create(u) : first;
    const raced = await orderedRace(u, () => activatePlan(db, u, activation(u, first)), () => activatePlan(db, u, activation(u, second)));
    assert.equal(raced[0].outcome.status, 'Accepted'); code(raced[1], differentPlans ? 'CURRENT_PLAN_CONFLICT' : 'ALREADY_ACTIVATED'); assert.equal(await owner.trainer2Plan.count({ where: { accountId: u.accountId, lifecycle: 'Active' } }), 1);
  }
  for (const saveFirst of [true, false]) {
    const u = await account(), head = await create(u);
    const save = () => editDraft(db, u, edit(u, head, 'Concurrent saved change'));
    const activate = () => activatePlan(db, u, activation(u, head));
    const [first, second] = await orderedRace<Awaited<ReturnType<typeof save>> | Awaited<ReturnType<typeof activate>>>(u, saveFirst ? save : activate, saveFirst ? activate : save);
    assert.equal(first.outcome.status, 'Accepted'); code(second, saveFirst ? 'STALE_REVIEW' : 'PLAN_NOT_DRAFT');
    const persisted = await state(u); assert.equal(persisted.plans[0].lifecycle, saveFirst ? 'Draft' : 'Active');
  }
  pass('Observed lock queues: distinct same-plan commands, competing plans and both save/activation serial orders');
  const r = await account(), rh = await create(r); const restricted = rh.intent.occurrences[0].positions[0].exercise;
  assert.equal(restricted.kind, 'catalogSnapshot');
  const restrictionCommand = (): InstructionCommand => ({ ...envelope(r), commandType: 'ChangeInstructions', target: {}, expected: { instructionEpoch: 0 }, intent: { operation: 'AddRestriction', restriction: { id: randomUUID(), revisionId: randomUUID(), catalogId: restricted.kind === 'catalogSnapshot' ? restricted.catalogId : catalog[0].id, instruction: 'Explicit test exclusion', planId: rh.planId, from: '2026-01-01T00:00:00.000Z', until: null, cleared: false } } });
  const add = restrictionCommand();
  const rr = await orderedRace<unknown>(r, () => changeInstructions(db, r, add), () => activatePlan(db, r, activation(r, rh)));
  assert.equal((rr[0] as { outcome: { status: string } }).outcome.status, 'Accepted'); code(rr[1] as Parameters<typeof code>[0], 'STALE_REVIEW');
  const blocked = (await readDraft(reader, r, rh.planId))!; assert(blocked.activation.binding.restrictionIssues.length > 0);
  code(await activatePlan(db, r, activation(r, blocked)), 'UNRESOLVED_EXCLUSION');
  const allow: InstructionCommand = { ...envelope(r), commandType: 'ChangeInstructions', target: {}, expected: { instructionEpoch: 1 }, intent: { operation: 'AddScopedException', exception: { id: randomUUID(), restrictionRevisionId: blocked.activation.instructions.document.restrictions[0].revisionId, planId: rh.planId, planRevisionId: rh.revisionId,
    positionIds: blocked.activation.binding.restrictionIssues.map(i => i.positionId), from: '2026-01-01T00:00:00.000Z', until: null, reason: 'Explicitly permit only these reviewed positions' } } };
  const invalidException = structuredClone(allow); invalidException.actionId = randomUUID(); if (invalidException.intent.operation === 'AddScopedException') invalidException.intent.exception.positionIds = [randomUUID()];
  code(await changeInstructions(db, r, invalidException), 'INVALID_EXCEPTION_SCOPE');
  assert.equal((await changeInstructions(db, r, allow)).outcome.status, 'Accepted');
  const granted = (await readDraft(reader, r, rh.planId))!;
  assert.equal(granted.activation.binding.restrictionIssues.length, 0);
  assert.equal((await editDraft(db, r, edit(r, granted, granted.intent.name))).outcome.status, 'Accepted');
  const revisedExceptionScope = (await readDraft(reader, r, rh.planId))!;
  assert(revisedExceptionScope.activation.binding.restrictionIssues.length > 0, 'Even an equal-valued new revision needs fresh exception authority');
  const renewed = structuredClone(allow); renewed.actionId = randomUUID(); renewed.expected.instructionEpoch = 2;
  if (renewed.intent.operation === 'AddScopedException') { renewed.intent.exception.id = randomUUID(); renewed.intent.exception.planRevisionId = revisedExceptionScope.revisionId; }
  assert.equal((await changeInstructions(db, r, renewed)).outcome.status, 'Accepted');
  const allowed = (await readDraft(reader, r, rh.planId))!; assert.equal(allowed.activation.binding.restrictionIssues.length, 0); assert.equal((await activatePlan(db, r, activation(r, allowed))).outcome.status, 'Accepted');
  assert.equal((await owner.trainer2PlanDecision.findFirstOrThrow({ where: { planId: rh.planId } })).instructionRevisionId, allowed.activation.instructions.revisionId);
  pass('Restriction wins controlled race; stale epoch review; unresolved exclusion; exact scoped exception and activation provenance');
  const f = await account(), fh = await create(f), fc = activation(f, fh), original = await state(f);
  await admin.query(`CREATE FUNCTION trainer2_test_activation_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'INJECTED_ACTIVATION_FAILURE'; END $$; CREATE TRIGGER trainer2_test_activation_failure BEFORE INSERT ON "Trainer2PlanDecision" FOR EACH ROW EXECUTE FUNCTION trainer2_test_activation_failure()`);
  try { await assert.rejects(activatePlan(db, f, fc)); assert.deepEqual(await state(f), original); }
  finally { await admin.query('DROP TRIGGER trainer2_test_activation_failure ON "Trainer2PlanDecision"; DROP FUNCTION trainer2_test_activation_failure()'); }
  assert.equal((await activatePlan(db, f, fc)).outcome.status, 'Accepted');
  pass('Injected decision write failure rolls back lifecycle, action, outcome and counters; original command retries successfully');
  // Independent authored mixed prescriptions, repeated stage runs and identity order.
  const independent = createHypertrophyPlan(); delete independent.builder;
  independent.occurrences = [independent.occurrences[4], independent.occurrences[0]];
  independent.occurrences.forEach(o => { delete o.workoutKey; delete o.overrides; delete o.weekOverride; o.positions.forEach(p => { delete p.sourceKey; p.exercise = { kind: 'authoredDescription', name: 'Independent mixed exercise', variation: '' }; }); });
  independent.occurrences[0].positions[0].targets[0] = { ...independent.occurrences[0].positions[0].targets[0], measurement: { kind: 'assistance', value: '0.00', unit: 'kg', convention: 'displayedAssistance', zeroMeaning: 'noAssistance' }, reps: { min: 7, max: 11, basis: 'alternating' }, rir: null, restSeconds: '90.00' };
  const ip = await account(), ih = await create(ip, independent); assert.equal((await activatePlan(db, ip, activation(ip, ih))).outcome.status, 'Accepted'); assert.deepEqual((await readDraft(reader, ip, ih.planId))!.intent, independent);
  pass('Independent workouts and mixed prescriptions preserve authored decimals, progression, repeated-stage order and all stable identities');
  const base = await startWeb();
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 950 } }); const page = await context.newPage();
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${base}/trainer2/dev/drafts`); await expect(page.getByRole('button', { name: 'Save plan' })).toBeEnabled();
    assert.equal(await page.locator('[data-nextjs-dialog]').count(), 0);
    await page.getByRole('button', { name: 'Save plan' }).click(); await expect(page.getByRole('status')).toHaveText('Saved');
    const planId = new URL(page.url()).searchParams.get('planId')!;
    const saved = await owner.trainer2Plan.findUniqueOrThrow({ where: { id: planId } }); let exact = await owner.trainer2PlanRevision.findUniqueOrThrow({ where: { id: saved.currentRevisionId } });
    await page.getByRole('button', { name: 'Review plan', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Saved plan checks passed' })).toBeVisible();
    await page.getByLabel('Plan name', { exact: true }).fill('Unsaved local change'); await expect(page.getByRole('button', { name: 'Activate plan', exact: true })).toHaveCount(0);
    await page.getByLabel('Plan name', { exact: true }).fill((exact.document as DraftDocument).name); await page.getByRole('button', { name: 'Review plan', exact: true }).click(); await expect(page.getByRole('button', { name: 'Activate plan', exact: true })).toBeEnabled();
    const oldHead = (await readDraft(reader, browserPrincipal, planId))!;
    assert.equal((await editDraft(db, browserPrincipal, edit(browserPrincipal, oldHead, oldHead.intent.name))).outcome.status, 'Accepted');
    await page.getByRole('button', { name: 'Activate plan', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Reload and review again');
    assert.equal((await owner.trainer2Plan.findUniqueOrThrow({ where: { id: planId } })).lifecycle, 'Draft');
    await page.getByRole('button', { name: 'Reload latest version' }).click(); await expect(page.getByRole('status')).toHaveText('Saved');
    await page.getByRole('button', { name: 'Review plan', exact: true }).click(); await expect(page.getByRole('button', { name: 'Activate plan', exact: true })).toBeEnabled();
    const latestPlan = await owner.trainer2Plan.findUniqueOrThrow({ where: { id: planId } });
    const prior = exact; exact = await owner.trainer2PlanRevision.findUniqueOrThrow({ where: { id: latestPlan.currentRevisionId } });
    assert.notEqual(exact.id, prior.id); assert.equal(exact.contentHash, prior.contentHash);
    await page.screenshot({ path: resolve('artifacts/trainer2/activation-review-desktop.png'), fullPage: true });
    const sent: string[] = [];
    await page.route('**/api/trainer2/drafts/activate', async route => { sent.push(route.request().postData()!); const response = await route.fetch(); assert.equal(response.status(), 200); await route.abort('failed'); });
    await page.getByRole('button', { name: 'Activate plan', exact: true }).click(); await expect(page.getByRole('status')).toContainText('Activation could not be confirmed');
    assert.equal((await owner.trainer2Plan.findUniqueOrThrow({ where: { id: planId } })).lifecycle, 'Active');
    await page.unroute('**/api/trainer2/drafts/activate');
    page.on('request', request => { if (request.url().endsWith('/activate')) sent.push(request.postData()!); });
    await page.reload(); await expect(page.getByRole('button', { name: 'Check again' })).toBeEnabled();
    await page.getByRole('button', { name: 'Check again' }).click(); await expect(page.getByRole('status')).toHaveText('Plan active'); assert.equal(sent[0], sent[1]);
    const ids = await page.locator('[data-occurrence-id]').evaluateAll(nodes => nodes.map(n => n.getAttribute('data-occurrence-id')));
    assert.deepEqual(ids, (exact.document as DraftDocument).occurrences.map(o => o.id));
    assert.deepEqual((await owner.trainer2PlanRevision.findUniqueOrThrow({ where: { id: exact.id } })), exact);
    assert.equal(await owner.trainer2PlanDecision.count({ where: { planId } }), 1);
    await expect(page.getByRole('region', { name: 'Active plan', exact: true })).toContainText('Starting workouts is not available yet.');
    await page.screenshot({ path: resolve('artifacts/trainer2/activation-active-desktop.png'), fullPage: true });
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: resolve('artifacts/trainer2/activation-active-desktop-viewport.png') });
    await page.setViewportSize({ width: 390, height: 844 }); await page.reload(); await expect(page.getByRole('status')).toHaveText('Plan active');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: resolve('artifacts/trainer2/activation-active-mobile.png'), fullPage: true });
    await page.screenshot({ path: resolve('artifacts/trainer2/activation-active-mobile-viewport.png') });
    assert.deepEqual(errors, []); await context.close();
    pass('Real Edge: populated save/review, unsaved-change guard, committed lost response, byte-identical retry after reload, active bookmark, exact PostgreSQL order, desktop/mobile and no page errors');
    const browserHead = (await readDraft(reader, browserPrincipal, planId))!;
    assert.equal(browserHead.state.lifecycle, 'Active'); assert.equal(browserHead.contentHash, integrityHash(canonicalJson(exact.document)));
  } finally { await browser.close(); }
  return results;
}
