import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { PrismaClient } from '@prisma/client';
import type { Pool } from 'pg';
import { chromium, expect as playwrightExpect } from '@playwright/test';
import { createDraft, readDraft, readOutcomeChanges, ActionCollision, type ServerPrincipal } from '../../src/lib/api/trainer2/planning';
import { activatePlan } from '../../src/lib/api/trainer2/activation';
import { startOccurrence, readExecution, readNextWorkout, InvalidStartSnapshot } from '../../src/lib/api/trainer2/execution';
import { changeInstructions } from '../../src/lib/api/trainer2/instructions';
import { createHypertrophyPlan } from '../../src/lib/engine/trainer2/plan-builder';
import { catalog } from '../../src/lib/engine/trainer2/catalog';
import type { StartOccurrenceCommand } from '../../src/lib/trainer2-contracts/execution';
const expect = playwrightExpect.configure({ timeout: 30_000 });
type Head = NonNullable<Awaited<ReturnType<typeof readDraft>>>;
export async function verifyWorkoutStart(db: PrismaClient, reader: PrismaClient, owner: PrismaClient, admin: Pool,
  browserPrincipal: ServerPrincipal, startWeb: () => Promise<string>, restartWeb: () => Promise<string>, upgrade: (accountId: string) => Promise<unknown>) {
  const results: string[] = [];
  const pass = (s: string) => { results.push(s); console.log(`PASS ${s}`); writeFileSync(resolve('artifacts/trainer2/workout-start-results.json'), JSON.stringify(results, null, 2)); };
  const envelope = (p: ServerPrincipal) => ({ schemaVersion: 1 as const, actionId: randomUUID(), originatingAccountId: p.accountId, deviceId: randomUUID(), ownershipEpoch: 0, dependsOn: [] });
  const account = async () => { const p = { accountId: randomUUID(), issuer: 'start-test', subject: randomUUID() }; await owner.user.create({ data: { id: p.accountId, email: `${p.subject}@trainer2.invalid` } }); await owner.trainer2AccountPrincipal.create({ data: { id: randomUUID(), ...p } }); return p; };
  const create = async (p: ServerPrincipal, intent = createHypertrophyPlan(), activate = true) => {
    const planId = randomUUID(); assert.equal((await createDraft(db, p, { ...envelope(p), commandType: 'CreateDraft', target: { planId }, expected: {}, intent })).outcome.status, 'Accepted');
    const h = (await readDraft(reader, p, planId))!;
    if (activate) assert.equal((await activatePlan(db, p, { ...envelope(p), commandType: 'ActivatePlan', target: { planId }, expected: { planRevisionId: h.revisionId }, intent: { reviewed: h.activation } })).outcome.status, 'Accepted');
    return h;
  };
  const cmd = (p: ServerPrincipal, h: Head): StartOccurrenceCommand => ({ ...envelope(p), commandType: 'StartOccurrence', target: { planId: h.planId, occurrenceId: h.intent.occurrences[0].id }, expected: { planRevisionId: h.revisionId, instructionEpoch: 0 }, intent: {} });
  const accepted = (v: Awaited<ReturnType<typeof startOccurrence>>) => { assert.equal(v.outcome.status, 'Accepted'); if (v.outcome.status !== 'Accepted') throw new Error('Expected acceptance'); return v.outcome.result; };
  const code = (v: { outcome: { status: string; code?: string } }, expected: string) => { assert.notEqual(v.outcome.status, 'Accepted'); assert.equal(v.outcome.code, expected); };
  const rows = async (p: ServerPrincipal) => ({ executions: await owner.trainer2Execution.findMany({ where: { accountId: p.accountId } }),
    actions: await owner.trainer2DurableAction.findMany({ where: { accountId: p.accountId }, orderBy: { actionId: 'asc' } }),
    outcomes: await owner.trainer2ActionOutcome.findMany({ where: { accountId: p.accountId }, orderBy: { outcomeCursor: 'asc' } }),
    state: await owner.trainer2AccountTrainingState.findUnique({ where: { accountId: p.accountId } }) });
  async function race<T>(p: ServerPrincipal, first: () => Promise<T>, second: () => Promise<T>) {
    const lock = await admin.connect(); await lock.query('BEGIN');
    const pid = (await lock.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    await lock.query('SELECT "accountId" FROM "Trainer2AccountTrainingState" WHERE "accountId"=$1 FOR UPDATE', [p.accountId]);
    const waiting = async (count: number) => { const deadline = Date.now() + 8000; for (;;) {
      const r = await admin.query('WITH RECURSIVE waiting(pid) AS (SELECT pid FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid)) UNION SELECT a.pid FROM pg_stat_activity a JOIN waiting w ON w.pid=ANY(pg_blocking_pids(a.pid))) SELECT DISTINCT pid FROM waiting', [pid]);
      if (r.rowCount! >= count) return; if (Date.now() > deadline) throw new Error('Expected observed start lock queue'); await new Promise(r => setTimeout(r, 20));
    } };
    let a: Promise<T> | undefined, b: Promise<T> | undefined;
    try { a = first(); await waiting(1); b = second(); await waiting(2); await lock.query('COMMIT'); return await Promise.all([a, b]); }
    finally { await lock.query('ROLLBACK'); lock.release(); await Promise.allSettled([a, b].filter(Boolean)); }
  }
  for (const independent of [false, true]) {
    const p = await account(); let doc = createHypertrophyPlan();
    if (independent) {
      const stage = randomUUID();
      doc = { schemaVersion: 1, name: 'Independent', endpoint: 'endOfOrderedOccurrences', progression: doc.progression,
        stages: [{ id: stage, name: 'Stage Z' }], occurrences: ['Zulu', 'Alpha', 'Zulu'].map(name => ({ id: randomUUID(), stageId: stage, name,
          positions: [{ id: randomUUID(), exercise: { kind: 'authoredDescription', name: 'Same exercise', variation: 'Independent' }, targets: [
            { id: randomUUID(), classification: 'working', required: true, reps: { min: 4, max: 6, basis: 'perSide' }, measurement: { kind: 'externalLoad', value: '0.00', unit: 'lb', convention: 'perImplement', zeroMeaning: 'validZero' }, rir: '0.0', restSeconds: '0.00' },
            { id: randomUUID(), classification: 'optionalFinisher', required: false, reps: { min: 9, max: 12, basis: 'alternating' }, measurement: null, rir: null, restSeconds: null },
          ] }] })) };
    }
    const h = await create(p, doc), c = cmd(p, h);
    if (!independent) { await upgrade(p.accountId); pass('Accepted-base migration upgrade preserves activated plans and permits restricted-role start'); }
    const pair = await race(p, () => startOccurrence(db, p, c), () => startOccurrence(db, p, c));
    assert.deepEqual(pair[0].outcome, pair[1].outcome); assert.equal(pair.filter(v => v.replayed).length, 1);
    const result = accepted(pair[0]); const snapshot = (await readExecution(reader, p, result.executionId))!;
    // Independent expected values come from authored activated source, never production capture helpers.
    assert.deepEqual(snapshot.initial.occurrence, doc.occurrences[0]); assert.deepEqual(snapshot.initial.stage, doc.stages.find(s => s.id === doc.occurrences[0].stageId));
    assert.deepEqual(snapshot.initial.progression, doc.progression); assert.equal(snapshot.initial.sourceContentHash, h.contentHash);
    for (const [i, position] of snapshot.initial.positions.entries()) {
      assert.notEqual(position.id, doc.occurrences[0].positions[i].id); assert.equal(position.sourcePositionId, doc.occurrences[0].positions[i].id);
      position.targets.forEach((t, j) => { assert.notEqual(t.id, doc.occurrences[0].positions[i].targets[j].id); assert.equal(t.sourceTargetId, doc.occurrences[0].positions[i].targets[j].id); });
    }
    const before = await rows(p); await readNextWorkout(reader, p, h.planId); await readExecution(reader, p, result.executionId);
    assert.deepEqual(await rows(p), before); assert.deepEqual((await startOccurrence(db, p, c)).outcome, pair[0].outcome);
    code(await startOccurrence(db, p, cmd(p, h)), 'ALREADY_STARTED');
    await assert.rejects(startOccurrence(db, p, { ...c, deviceId: randomUUID() }), ActionCollision);
    const original = catalog[0].name; try { catalog[0].name = 'Changed prospective catalog'; assert.deepEqual(await readExecution(reader, p, result.executionId), snapshot); } finally { catalog[0].name = original; }
    for (const sql of ['UPDATE "Trainer2Execution" SET "contentHash"=\'bad\' WHERE "id"=$1', 'DELETE FROM "Trainer2Execution" WHERE "id"=$1']) await assert.rejects(admin.query(sql, [result.executionId]));
    const other = await account(); assert.equal(await readExecution(reader, other, result.executionId), null);
    assert.equal((await readOutcomeChanges(reader, other, BigInt(0))).changes.length, 0);
    await assert.rejects(startOccurrence(db, other, c)); code(await startOccurrence(db, other, { ...c, ...envelope(other) }), 'NOT_FOUND');
    // Owner-only corrupt fixture bypasses seals explicitly; runtime cannot perform this mutation.
    const corrupt = await admin.connect();
    try { await corrupt.query('BEGIN'); await corrupt.query('SET LOCAL session_replication_role=replica');
      const bad = { ...snapshot.initial, schemaVersion: 999 }; const text = JSON.stringify(bad);
      await corrupt.query('UPDATE "Trainer2Execution" SET "initialPrescription"=$2::text::jsonb, "canonicalContent"=$2::text, "contentHash"=encode(sha256(convert_to($2::text,\'UTF8\')),\'hex\') WHERE "id"=$1', [result.executionId, text]).then(() => assert.fail('Version check must reject'), () => {});
    } finally { await corrupt.query('ROLLBACK'); corrupt.release(); }
    pass(`${independent ? 'Independent mixed zero/null per-side optional work' : 'Template'}: exact capture, identities, observed identical race, replay, read-only reopen, catalog independence, immutable SQL, isolation`);
  }
  for (const same of [true, false]) {
    const p = await account(), h = await create(p), first = cmd(p, h), second = cmd(p, h);
    if (!same) second.target.occurrenceId = h.intent.occurrences[1].id;
    const result = await race(p, () => startOccurrence(db, p, first), () => startOccurrence(db, p, second));
    accepted(result[0]); code(result[1], same ? 'ALREADY_STARTED' : 'OCCURRENCE_NOT_NEXT'); assert.equal((await rows(p)).executions.length, 1);
  }
  pass('Distinct same-occurrence and competing occurrence controlled races');
  const p = await account(), draft = await create(p, createHypertrophyPlan(), false), c = cmd(p, draft);
  code(await startOccurrence(db, p, c), 'PLAN_NOT_ACTIVE');
  const h = await create(p); const valid = cmd(p, h);
  for (const [change, expected] of [
    [{ expected: { ...valid.expected, planRevisionId: randomUUID() } }, 'STALE_REVISION'],
    [{ target: { ...valid.target, occurrenceId: randomUUID() } }, 'OCCURRENCE_NOT_FOUND'],
    [{ target: { ...valid.target, occurrenceId: h.intent.occurrences[1].id } }, 'OCCURRENCE_NOT_NEXT'],
    [{ expected: { ...valid.expected, instructionEpoch: 1 } }, 'STALE_INSTRUCTIONS'],
  ] as const) code(await startOccurrence(db, p, { ...valid, actionId: randomUUID(), ...change }), expected);
  const beforeMalformed = await rows(p);
  for (const bad of [{ ...valid, intent: { prescription: h.intent } }, { ...valid, schemaVersion: 2 }, { ...valid, target: { planId: h.planId } }]) await assert.rejects(startOccurrence(db, p, bad));
  assert.deepEqual(await rows(p), beforeMalformed);
  await admin.query(`CREATE FUNCTION trainer2_test_start_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'INJECTED_START_FAILURE'; END $$; CREATE TRIGGER trainer2_test_start_failure AFTER INSERT ON "Trainer2Execution" FOR EACH ROW EXECUTE FUNCTION trainer2_test_start_failure()`);
  const beforeFailure = await rows(p);
  try { await assert.rejects(startOccurrence(db, p, valid)); assert.deepEqual(await rows(p), beforeFailure); }
  finally { await admin.query('DROP TRIGGER trainer2_test_start_failure ON "Trainer2Execution"; DROP FUNCTION trainer2_test_start_failure()'); }
  const started = accepted(await startOccurrence(db, p, valid));
  // A missing capture is impossible normally; administrative corruption fixture tests explicit read failure.
  const corrupt = await admin.connect();
  try { await corrupt.query('BEGIN'); await corrupt.query('SET LOCAL session_replication_role=replica');
    const row = (await rows(p)).executions[0]; const bad = { ...(row.initialPrescription as Record<string, unknown>), positions: [] }; const text = JSON.stringify(bad);
    await corrupt.query('UPDATE "Trainer2Execution" SET "initialPrescription"=$2::text::jsonb, "canonicalContent"=$2::text, "contentHash"=encode(sha256(convert_to($2::text,\'UTF8\')),\'hex\') WHERE "id"=$1', [started.executionId, text]);
    await corrupt.query('COMMIT'); await assert.rejects(readExecution(reader, p, started.executionId), InvalidStartSnapshot);
    await corrupt.query('BEGIN'); await corrupt.query('SET LOCAL session_replication_role=replica');
    await corrupt.query('UPDATE "Trainer2Execution" SET "initialPrescription"=$2::jsonb, "canonicalContent"=$3, "contentHash"=$4 WHERE "id"=$1', [row.id, JSON.stringify(row.initialPrescription), row.canonicalContent, row.contentHash]); await corrupt.query('COMMIT');
  } finally { await corrupt.query('ROLLBACK'); corrupt.release(); }
  pass('Draft, revision, occurrence and later-work eligibility; malformed payload; controlled post-insert rollback and retry; explicit corrupt snapshot failure');
  const restricted = await account(), rh = await create(restricted), rc = cmd(restricted, rh);
  const exercise = rh.intent.occurrences[0].positions[0].exercise; assert.equal(exercise.kind, 'catalogSnapshot');
  if (exercise.kind !== 'catalogSnapshot') throw new Error('Expected catalog exercise');
  assert.equal((await changeInstructions(db, restricted, { ...envelope(restricted), commandType: 'ChangeInstructions', target: {}, expected: { instructionEpoch: 0 }, intent: { operation: 'AddRestriction', restriction: { id: randomUUID(), revisionId: randomUUID(), catalogId: exercise.catalogId, instruction: 'Synthetic exclusion', planId: null, from: '2020-01-01T00:00:00.000Z', until: null, cleared: false } } })).outcome.status, 'Accepted');
  code(await startOccurrence(db, restricted, rc), 'STALE_INSTRUCTIONS'); code(await startOccurrence(db, restricted, { ...rc, actionId: randomUUID(), expected: { ...rc.expected, instructionEpoch: 1 } }), 'UNRESOLVED_EXCLUSION');
  const grants = (await admin.query(`SELECT has_table_privilege('trainer2_draft_reader','"Trainer2Execution"','INSERT,UPDATE,DELETE') reader_write, has_table_privilege('trainer2_draft_runtime','"Trainer2Execution"','UPDATE,DELETE') runtime_mutate, relrowsecurity FROM pg_class WHERE relname='Trainer2Execution'`)).rows[0];
  assert.deepEqual(grants, { reader_write: false, runtime_mutate: false, relrowsecurity: true });
  pass('Post-activation exclusion enforcement and restricted execution privileges');
  // Deliberately construct the architecture's old-open/new-active prerequisite. No closure command is exposed.
  const oldPlan = await admin.connect();
  try { await oldPlan.query('BEGIN'); await oldPlan.query('ALTER TABLE "Trainer2Plan" DISABLE TRIGGER trainer2_activation_guard');
    await oldPlan.query(`UPDATE "Trainer2Plan" SET "lifecycle"='ConcludedEarly' WHERE "id"=$1`, [h.planId]);
    await oldPlan.query('SET CONSTRAINTS ALL IMMEDIATE');
    await oldPlan.query('ALTER TABLE "Trainer2Plan" ENABLE TRIGGER trainer2_activation_guard'); await oldPlan.query('COMMIT');
  } finally { await oldPlan.query('ROLLBACK'); oldPlan.release(); }
  const newer = await create(p); code(await startOccurrence(db, p, cmd(p, newer)), 'OPEN_EXECUTION_CONFLICT');
  assert.equal((await readNextWorkout(reader, p, newer.planId)).execution!.executionId, started.executionId);
  assert((await readExecution(reader, p, started.executionId)) !== null);
  const indexes = (await admin.query(`SELECT indexdef FROM pg_indexes WHERE tablename='Trainer2Execution'`)).rows.map(r => r.indexdef);
  assert(indexes.some(s => s.includes('UNIQUE') && s.includes('trainer2_one_open_execution')));
  assert(indexes.some(s => s.includes('UNIQUE') && s.includes('("occurrenceId")')));
  pass('Old open execution blocks new active-plan start and remains readable; independent SQL uniqueness inspection');
  let base = await startWeb();
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }); const page = await context.newPage(); const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${base}/trainer2/dev/drafts`); await page.getByRole('button', { name: 'Save plan', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('Saved'); await page.getByRole('button', { name: 'Review plan', exact: true }).click();
    await page.getByRole('button', { name: 'Activate plan', exact: true }).click(); await expect(page.getByRole('status').first()).toHaveText('Plan active');
    await expect(page.getByRole('button', { name: 'Start workout', exact: true })).toBeVisible();
    const planUrl = page.url(); const planId = new URL(planUrl).searchParams.get('planId')!;
    const noStart = await rows(browserPrincipal); await page.reload(); await expect(page.getByRole('button', { name: 'Start workout', exact: true })).toBeVisible(); assert.deepEqual(await rows(browserPrincipal), noStart);
    let originalBody = '';
    let dropped!: () => void; const responseDropped = new Promise<void>(resolve => { dropped = resolve; });
    await page.route('**/api/trainer2/executions/start', async route => { originalBody = route.request().postData()!; try { await route.fetch(); await route.abort('failed'); dropped(); } catch { dropped(); } }, { times: 1 });
    await page.getByRole('button', { name: 'Start workout', exact: true }).click(); await expect(page.getByRole('button', { name: 'Check again', exact: true })).toBeVisible();
    await responseDropped; await expect(page.getByRole('button', { name: 'Check again', exact: true })).toBeEnabled();
    const committed = await rows(browserPrincipal); assert.equal(committed.executions.length, 1);
    await page.reload(); await expect(page.getByRole('button', { name: 'Check again', exact: true })).toBeVisible();
    let retryBody = ''; page.on('request', r => { if (r.url().endsWith('/executions/start')) retryBody = r.postData()!; });
    await page.getByRole('button', { name: 'Check again', exact: true }).click(); await page.waitForURL('**/trainer2/dev/executions/*');
    await expect(page.getByRole('heading', { name: 'Workout in progress' })).toBeVisible(); assert.equal(retryBody, originalBody);
    const executionUrl = page.url(), executionId = executionUrl.split('/').at(-1)!;
    const stored = await readExecution(reader, browserPrincipal, executionId); assert.deepEqual(stored!.initial.occurrence, (await readDraft(reader, browserPrincipal, planId))!.intent.occurrences[0]);
    await page.screenshot({ path: resolve('artifacts/trainer2/workout-start-desktop.png'), fullPage: true });
    await page.reload(); await expect(page.getByRole('heading', { name: 'Workout in progress' })).toBeVisible(); assert.deepEqual(await rows(browserPrincipal), committed);
    await page.goto(planUrl); await expect(page.getByRole('link', { name: 'Continue workout' })).toBeVisible(); await page.getByRole('link', { name: 'Continue workout' }).click(); await page.waitForURL(executionUrl);
    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
    const phone = await mobile.newPage(); await phone.goto(executionUrl); await expect(phone.getByRole('heading', { name: 'Workout in progress' })).toBeVisible();
    assert(await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)); await phone.screenshot({ path: resolve('artifacts/trainer2/workout-start-mobile-emulation.png'), fullPage: true }); await mobile.close();
    base = await restartWeb(); await page.goto(`${base}/trainer2/dev/executions/${executionId}`); await expect(page.getByRole('heading', { name: 'Workout in progress' })).toBeVisible();
    const api = await page.request.get(`${base}/api/trainer2/executions/${executionId}`); assert.deepEqual(await api.json(), stored); assert.deepEqual(await rows(browserPrincipal), committed);
    assert.deepEqual(errors, []); await context.close();
    pass('Actual Edge build-save-review-activate-start, dropped committed response/exact retry, bookmark/GET-only reload/continue, same-database server restart, desktop and mobile emulation');
  } finally { await browser.close(); }
  return { status: 'passed', results };
}
