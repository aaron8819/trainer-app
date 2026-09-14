import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { PrismaClient } from '@prisma/client';
import type { Pool } from 'pg';
import { chromium, expect as playwrightExpect } from '@playwright/test';
import { createDraft, readDraft, ActionCollision, type ServerPrincipal } from '../../src/lib/api/trainer2/planning';
import { activatePlan } from '../../src/lib/api/trainer2/activation';
import { startOccurrence, readExecution } from '../../src/lib/api/trainer2/execution';
import { saveSetResult } from '../../src/lib/api/trainer2/set-results';
import { createHypertrophyPlan } from '../../src/lib/engine/trainer2/plan-builder';
import { commandBinding } from '../../src/lib/api/trainer2/integrity';
import type { SetResultCommand, PerformedResult } from '../../src/lib/trainer2-contracts/set-results';
import type { ExecutionRead } from '../../src/lib/trainer2-contracts/execution';
const expect = playwrightExpect.configure({ timeout: 30_000 });

export async function verifySetResults(db: PrismaClient, reader: PrismaClient, owner: PrismaClient, admin: Pool,
  browserPrincipal: ServerPrincipal, startWeb: () => Promise<string>, restartWeb: () => Promise<string>, upgrade: (accountId: string) => Promise<unknown>) {
  const results: string[] = [], preservation: unknown[] = [];
  const pass = (s: string) => { results.push(s); console.log(`PASS ${s}`); writeFileSync(resolve('artifacts/trainer2/set-results-progress.json'), JSON.stringify({ results, preservation }, null, 2)); };
  const envelope = (p: ServerPrincipal) => ({ schemaVersion: 1 as const, actionId: randomUUID(), originatingAccountId: p.accountId, deviceId: randomUUID(), ownershipEpoch: 0, dependsOn: [] });
  const account = async () => { const p = { accountId: randomUUID(), issuer: 'result-test', subject: randomUUID() }; await owner.user.create({ data: { id: p.accountId, email: `${p.subject}@trainer2.invalid` } }); await owner.trainer2AccountPrincipal.create({ data: { id: randomUUID(), ...p } }); return p; };
  const create = async (p: ServerPrincipal, independent = false) => {
    let intent = createHypertrophyPlan();
    if (independent) {
      const stageId = randomUUID(); const positions = Array.from({ length: 6 }, (_, i) => ({ id: randomUUID(), exercise: { kind: 'authoredDescription' as const, name: i === 1 ? 'Alpha' : 'Zulu', variation: 'Synthetic' },
        targets: [{ id: randomUUID(), required: i % 2 === 0, classification: (['preparation', 'rampUp', 'working', 'optionalFinisher'] as const)[i % 4],
          reps: { min: 3, max: 6, basis: (['total', 'perSide', 'alternating'] as const)[i % 3] },
          measurement: i === 0 ? null : i === 1 ? { kind: 'bodyweight' as const, convention: 'bodyweightOnly' as const } : i === 2 ? { kind: 'addedLoad' as const, value: '0.00', unit: 'lb' as const, convention: 'addedExternal' as const, zeroMeaning: 'noAddedLoad' as const } : i === 3 ? { kind: 'assistance' as const, value: '2.00', unit: 'kg' as const, convention: 'displayedAssistance' as const, zeroMeaning: 'noAssistance' as const } : { kind: 'externalLoad' as const, value: '1.0', unit: 'kg' as const, convention: i === 4 ? 'perImplement' as const : 'machineDisplayed' as const, zeroMeaning: 'validZero' as const }, rir: i === 0 ? null : '0', restSeconds: null }] }));
      intent = { schemaVersion: 1, name: 'Mixed independent workout', endpoint: 'endOfOrderedOccurrences', progression: intent.progression,
        stages: [{ id: stageId, name: 'Synthetic stage' }], occurrences: [{ id: randomUUID(), stageId, name: 'Mixed sets', positions }] };
    }
    const planId = randomUUID(); assert.equal((await createDraft(db, p, { ...envelope(p), commandType: 'CreateDraft', target: { planId }, expected: {}, intent })).outcome.status, 'Accepted');
    const h = (await readDraft(reader, p, planId))!;
    assert.equal((await activatePlan(db, p, { ...envelope(p), commandType: 'ActivatePlan', target: { planId }, expected: { planRevisionId: h.revisionId }, intent: { reviewed: h.activation } })).outcome.status, 'Accepted');
    const start = await startOccurrence(db, p, { ...envelope(p), commandType: 'StartOccurrence', target: { planId, occurrenceId: h.intent.occurrences[0].id }, expected: { planRevisionId: h.revisionId, instructionEpoch: 0 }, intent: {} });
    assert.equal(start.outcome.status, 'Accepted'); if (start.outcome.status !== 'Accepted') throw new Error('Start failed');
    return (await readExecution(reader, p, start.outcome.result.executionId))!;
  };
  const actual = (value = 7): PerformedResult => ({ reps: { value, basis: 'total' }, measurement: null, rir: null });
  const record = (p: ServerPrincipal, x: ExecutionRead, index = 0, result = actual()): SetResultCommand => ({ ...envelope(p), commandType: 'RecordSetResult',
    target: { executionId: x.executionId, targetId: x.initial.positions.flatMap(p => p.targets)[index].id }, expected: { resultVersion: 0 }, intent: { result } });
  const correction = (p: ServerPrincipal, c: SetResultCommand, performedSetId: string, version: number, result: PerformedResult | null = actual(8)): SetResultCommand => ({
    ...envelope(p), commandType: 'CorrectSetResult', target: c.target, expected: { resultVersion: version, performedSetId }, intent: { result, reason: result ? 'Correct typing mistake' : 'Accidentally recorded' } });
  const accept = (r: Awaited<ReturnType<typeof saveSetResult>>) => { assert.equal(r.outcome.status, 'Accepted'); if (r.outcome.status !== 'Accepted') throw new Error('Expected accepted'); return r.outcome.result; };
  const conflict = (r: { outcome: { status: string; code?: string } }, code = 'STALE_SET_RESULT') => { assert.notEqual(r.outcome.status, 'Accepted'); assert.equal(r.outcome.code, code); };
  const original = async (p: ServerPrincipal) => ({ executions: await owner.trainer2Execution.findMany({ where: { accountId: p.accountId } }),
    plans: await owner.trainer2Plan.findMany({ where: { accountId: p.accountId } }), revisions: await owner.trainer2PlanRevision.findMany({ where: { accountId: p.accountId }, orderBy: { revisionNumber: 'asc' } }) });
  const preserved = async (p: ServerPrincipal, before: Awaited<ReturnType<typeof original>>, category: string) => {
    const after = await original(p); assert.deepEqual(after, before); preservation.push({ category, hashes: after.executions.map(x => x.contentHash), unchanged: true });
  };
  const persisted = async (p: ServerPrincipal) => (await admin.query('SELECT * FROM "Trainer2SetResultRevision" WHERE "accountId"=$1 ORDER BY "targetId","version"', [p.accountId])).rows;
  async function race<T>(p: ServerPrincipal, first: () => Promise<T>, second: () => Promise<T>) {
    const lock = await admin.connect(); await lock.query('BEGIN');
    const pid = (await lock.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    await lock.query('SELECT "accountId" FROM "Trainer2AccountTrainingState" WHERE "accountId"=$1 FOR UPDATE', [p.accountId]);
    const waiting = async (count: number) => { const deadline = Date.now() + 8000; for (;;) {
      const r = await admin.query('WITH RECURSIVE waiting(pid) AS (SELECT pid FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid)) UNION SELECT a.pid FROM pg_stat_activity a JOIN waiting w ON w.pid=ANY(pg_blocking_pids(a.pid))) SELECT DISTINCT pid FROM waiting', [pid]);
      if (r.rowCount! >= count) return; if (Date.now() > deadline) throw new Error('Expected observed result lock queue'); await new Promise(r => setTimeout(r, 20));
    } };
    let a: Promise<T> | undefined, b: Promise<T> | undefined;
    try { a = first(); await waiting(1); b = second(); await waiting(2); await lock.query('COMMIT'); return await Promise.all([a, b]); }
    finally { await lock.query('ROLLBACK'); lock.release(); await Promise.allSettled([a, b].filter(Boolean)); }
  }
  const upgradePrincipal = await account(); await create(upgradePrincipal); await upgrade(upgradePrincipal.accountId);
  pass('Fresh full migration chain and no-op redeploy; populated accepted-base upgrade preserves existing Open execution without invented results and permits runtime recording');
  for (const independent of [false, true]) {
    const p = await account(), x = await create(p, independent), before = await original(p);
    const targets = x.initial.positions.flatMap(p => p.targets);
    const values: PerformedResult[] = [actual(0), { reps: { value: 4, basis: 'perSide' }, measurement: { kind: 'bodyweight', convention: 'bodyweightOnly' }, rir: '0' },
      { reps: { value: 5, basis: 'alternating' }, measurement: { kind: 'addedLoad', value: '0.00', unit: 'lb', convention: 'addedExternal', zeroMeaning: 'noAddedLoad' }, rir: null },
      { reps: null, measurement: { kind: 'assistance', value: '0', unit: 'kg', convention: 'displayedAssistance', zeroMeaning: 'noAssistance' }, rir: '1.50' },
      { reps: { value: 9, basis: 'total' }, measurement: { kind: 'externalLoad', value: '12.500', unit: 'lb', convention: 'perImplement', zeroMeaning: 'notAllowed' }, rir: null },
      { reps: { value: 2, basis: 'total' }, measurement: { kind: 'externalLoad', value: '0', unit: 'kg', convention: 'machineDisplayed', zeroMeaning: 'validZero' }, rir: null }];
    const commands = values.slice(0, targets.length).map((v, i) => record(p, x, i, v));
    for (const c of commands) accept(await saveSetResult(db, p, c));
    await preserved(p, before, `${independent ? 'independent' : 'template'} records`);
    for (const [i, c] of commands.entries()) assert.deepEqual((await persisted(p)).find(r => r.targetId === c.target.targetId).result, values[i]);
    const c = commands[0], initial = (await readExecution(reader, p, x.executionId))!.results.find(r => r.targetId === c.target.targetId)!;
    const edit = correction(p, c, initial.performedSetId, 1, actual(3)); accept(await saveSetResult(db, p, edit));
    accept(await saveSetResult(db, p, correction(p, c, initial.performedSetId, 2, values[0])));
    conflict(await saveSetResult(db, p, { ...edit, actionId: randomUUID() })); // ABA: equal values do not restore version 1.
    const clear = correction(p, c, initial.performedSetId, 3, null); accept(await saveSetResult(db, p, clear));
    assert.equal((await readExecution(reader, p, x.executionId))!.results.find(r => r.targetId === c.target.targetId)!.result, null);
    conflict(await saveSetResult(db, p, { ...c, actionId: randomUUID() }));
    accept(await saveSetResult(db, p, correction(p, c, initial.performedSetId, 4, actual(6))));
    conflict(await saveSetResult(db, p, { ...clear, actionId: randomUUID() }));
    const history = (await persisted(p)).filter(r => r.targetId === c.target.targetId);
    assert.deepEqual(history.map(r => r.version), [1, 2, 3, 4, 5]); assert(history.every(r => r.performedSetId === initial.performedSetId));
    assert.deepEqual(history.map(r => r.result), [values[0], actual(3), values[0], null, actual(6)]); assert(history.slice(1).every(r => r.reason && r.actionId));
    await preserved(p, before, 'correction, equal-value version, clear/re-record, stale rejects');
    const replay = await saveSetResult(db, p, edit); assert.equal(replay.replayed, true); assert.equal(accept(replay).version, 2);
    assert.equal((await readExecution(reader, p, x.executionId))!.results.find(r => r.targetId === c.target.targetId)!.version, 5);
    await assert.rejects(saveSetResult(db, p, { ...edit, intent: { result: actual(1), reason: 'Changed payload' } }), ActionCollision);
    await preserved(p, before, 'historical replay and payload collision');
    pass(`${independent ? 'Independent duplicate names and mixed prescriptions' : 'Template'}: several values, zero/null/units/basis/effort, independent persisted provenance, correction/ABA/clear/re-record, replay/collision and immutable prescription`);
  }
  for (const mode of ['sameRecord', 'sameCorrection', 'differentSets', 'exactReplay'] as const) {
    const p = await account(), x = await create(p), before = await original(p);
    let a = record(p, x), b = record(p, x, mode === 'differentSets' ? 1 : 0, actual(10));
    if (mode === 'sameCorrection') { const first = accept(await saveSetResult(db, p, a)); a = correction(p, a, first.performedSetId, 1); b = correction(p, b, first.performedSetId, 1, actual(11)); }
    if (mode === 'exactReplay') b = a;
    const outcomes = await race(p, () => saveSetResult(db, p, a), () => saveSetResult(db, p, b)); accept(outcomes[0]);
    if (mode === 'differentSets' || mode === 'exactReplay') accept(outcomes[1]); else conflict(outcomes[1]);
    if (mode === 'exactReplay') assert.equal(outcomes.filter(r => r.replayed).length, 1);
    assert.equal((await persisted(p)).length, mode === 'sameCorrection' || mode === 'differentSets' ? 2 : 1);
    await preserved(p, before, `controlled race ${mode}`);
  }
  pass('Observed PostgreSQL blocking chains: simultaneous same-set initial records, corrections, different-set records and identical command retry');
  const p = await account(), x = await create(p), before = await original(p), c = record(p, x), other = await account(), foreign = await create(other);
  await assert.rejects(saveSetResult(db, other, c));
  conflict(await saveSetResult(db, other, { ...c, ...envelope(other) }), 'NOT_FOUND');
  conflict(await saveSetResult(db, p, { ...c, actionId: randomUUID(), target: { ...c.target, targetId: foreign.initial.positions[0].targets[0].id } }), 'SET_NOT_FOUND');
  conflict(await saveSetResult(db, p, { ...c, actionId: randomUUID(), target: { ...c.target, targetId: x.initial.occurrence.positions[0].targets[0].id } }), 'SET_NOT_FOUND');
  conflict(await saveSetResult(db, p, { ...c, actionId: randomUUID(), target: { ...c.target, executionId: foreign.executionId } }), 'NOT_FOUND');
  for (const invalid of [actual(-1), actual(1.5), actual(1001), { ...actual(), rir: '11' }, { ...actual(), rir: '-1' },
    { ...actual(), measurement: { kind: 'externalLoad', value: '0', unit: 'kg', convention: 'barbellTotal', zeroMeaning: 'notAllowed' } },
    { ...actual(), reps: { value: 20, basis: 'duration' } }, { reps: null, measurement: null, rir: null }]) await assert.rejects(saveSetResult(db, p, { ...c, actionId: randomUUID(), intent: { result: invalid } }));
  await preserved(p, before, 'invalid shapes and cross-owner references');
  const rows = async () => ({ results: await persisted(p), actions: await owner.trainer2DurableAction.findMany({ where: { accountId: p.accountId }, orderBy: { actionId: 'asc' } }),
    outcomes: await owner.trainer2ActionOutcome.findMany({ where: { accountId: p.accountId }, orderBy: { outcomeCursor: 'asc' } }), state: await owner.trainer2AccountTrainingState.findUnique({ where: { accountId: p.accountId } }) });
  const beforeFailure = await rows();
  await admin.query(`CREATE FUNCTION result_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."accountId"='${p.accountId}' THEN RAISE EXCEPTION 'result outcome injected failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER result_test_failure BEFORE INSERT ON "Trainer2ActionOutcome" FOR EACH ROW EXECUTE FUNCTION result_test_failure()`);
  try { await assert.rejects(saveSetResult(db, p, c)); assert.deepEqual(await rows(), beforeFailure); }
  finally { await admin.query('DROP TRIGGER result_test_failure ON "Trainer2ActionOutcome"; DROP FUNCTION result_test_failure()'); }
  accept(await saveSetResult(db, p, c)); await preserved(p, before, 'late transaction failure and same-command recovery');
  pass('Invalid shapes/numbers, cross-account/execution/target denials, final-outcome failure rolls back revision/action/sequence, same command then succeeds');
  for (const sql of ['UPDATE "Trainer2SetResultRevision" SET "reason"=\'x\'', 'DELETE FROM "Trainer2SetResultRevision"', 'TRUNCATE "Trainer2SetResultRevision"', 'ALTER TABLE "Trainer2SetResultRevision" ADD COLUMN bad text', 'UPDATE "Trainer2Execution" SET "contentHash"=\'bad\'']) await assert.rejects(db.$executeRawUnsafe(sql));
  await assert.rejects(reader.$executeRawUnsafe('INSERT INTO "Trainer2SetResultRevision" SELECT * FROM "Trainer2SetResultRevision"'));
  await assert.rejects(db.$executeRawUnsafe(`INSERT INTO "Trainer2SetResultRevision" ("accountId","executionId","targetId","performedSetId","version","actionId","result","reason") SELECT "accountId","executionId","targetId","performedSetId",99,"actionId","result",'bypass' FROM "Trainer2SetResultRevision" LIMIT 1`));
  const firstResult = (await readExecution(reader, p, x.executionId))!.results[0];
  const directBefore = await rows();
  // Construct fresh envelopes and direct runtime writes without the production command helper.
  for (const fault of ['staleVersion', 'changedIdentity', 'missingReason', 'missingOutcome'] as const) {
    const direct = correction(p, c, firstResult.performedSetId, fault === 'staleVersion' ? 0 : 1, actual(9));
    await assert.rejects(db.$transaction(async tx => {
      await tx.trainer2DurableAction.create({ data: { accountId: p.accountId, actionId: direct.actionId, ...commandBinding(direct) } });
      await tx.trainer2SetResultRevision.create({ data: { accountId: p.accountId, ...c.target,
        performedSetId: fault === 'changedIdentity' ? randomUUID() : firstResult.performedSetId, version: 2,
        actionId: direct.actionId, result: actual(9), reason: fault === 'missingReason' ? null : 'Correct typing mistake' } });
    }));
    assert.deepEqual(await rows(), directBefore);
  }
  assert.equal((await admin.query(`SELECT count(*) FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE c.relname='Trainer2SetResultRevision' AND a.grantee=0`)).rows[0].count, '0');
  await preserved(p, before, 'direct mutation denial');
  pass('Restricted runtime/read grants, no PUBLIC privilege, direct version/history/prescription mutation and DDL denial');
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    let base = await startWeb();
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }); const page = await context.newPage();
    page.on('dialog', d => void d.accept()); const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${base}/trainer2/dev/drafts`); await page.getByRole('button', { name: 'Save plan', exact: true }).click();
    await expect(page.getByRole('status').first()).toHaveText('Saved'); await page.getByRole('button', { name: 'Review plan', exact: true }).click();
    await page.getByRole('button', { name: 'Activate plan', exact: true }).click(); await expect(page.getByRole('status').first()).toHaveText('Plan active');
    await page.getByRole('button', { name: 'Start workout', exact: true }).click(); await page.waitForURL('**/trainer2/dev/executions/*');
    const executionId = page.url().split('/').at(-1)!, browserBefore = await original(browserPrincipal);
    const opened = (await readExecution(reader, browserPrincipal, executionId))!;
    const denied = record(browserPrincipal, opened);
    const noOrigin = await page.request.post(`${base}/api/trainer2/executions/results`, { data: denied }); assert.equal(noOrigin.status(), 403);
    const wrongAccount = await page.request.post(`${base}/api/trainer2/executions/results`, { headers: { Origin: base }, data: { ...denied, originatingAccountId: other.accountId } }); assert.equal(wrongAccount.status(), 403);
    const first = page.getByLabel('Set 1 actual result', { exact: true }).first(), second = page.getByLabel('Set 2 actual result', { exact: true }).first();
    const initialTab = await context.newPage(); initialTab.on('dialog', d => void d.accept()); await initialTab.goto(page.url());
    const initialOther = initialTab.getByLabel('Set 1 actual result', { exact: true }).first();
    await initialOther.getByRole('button', { name: 'Enter actual result' }).click(); await initialOther.getByLabel('Set 1 Actual reps', { exact: true }).fill('12');
    await first.getByRole('button', { name: 'Enter actual result' }).click(); await first.getByLabel('Set 1 Actual reps', { exact: true }).fill('8');
    await first.getByLabel('Set 1 actual load type').selectOption('externalLoad');
    await first.getByLabel('Set 1 Actual load', { exact: true }).fill('20.00');
    await first.getByLabel('Set 1 load unit').selectOption('lb');
    await first.getByLabel('Set 1 load basis').selectOption('barbellTotal');
    await first.getByLabel('Set 1 Actual RIR (optional)', { exact: true }).fill('0');
    await second.getByRole('button', { name: 'Enter actual result' }).click(); await second.getByLabel('Set 2 Actual reps', { exact: true }).fill('6');
    await first.getByRole('button', { name: 'Record set', exact: true }).click(); await expect(first.getByText(/^Saved v1:/)).toBeVisible();
    await initialOther.getByRole('button', { name: 'Record set', exact: true }).click(); await expect(initialOther.getByRole('button', { name: 'Review latest result' })).toBeVisible();
    await expect(initialOther.getByLabel('Set 1 Actual reps', { exact: true })).toHaveValue('12'); await initialTab.close();
    await expect(second.getByLabel('Set 2 Actual reps', { exact: true })).toHaveValue('6');
    await second.getByRole('button', { name: 'Record set', exact: true }).click(); await expect(second.getByText(/^Saved v1:/)).toBeVisible();
    const browserSaved = await readExecution(reader, browserPrincipal, executionId);
    assert.deepEqual(browserSaved!.results.find(r => r.targetId === opened.initial.positions[0].targets[0].id)!.result,
      { reps: { value: 8, basis: 'total' }, measurement: { kind: 'externalLoad', value: '20.00', unit: 'lb', convention: 'barbellTotal', zeroMeaning: 'validZero' }, rir: '0' });
    await page.reload(); await expect(first.getByText(/^Saved v1: 8 reps/)).toBeVisible();
    await first.getByRole('button', { name: 'Edit result' }).click(); await first.getByLabel('Set 1 Actual reps', { exact: true }).fill('9');
    await first.getByLabel('Set 1 correction reason').fill('Counted one more rep');
    let originalBody = ''; let dropped!: () => void; const droppedResponse = new Promise<void>(r => { dropped = r; });
    await page.route('**/api/trainer2/executions/results', async route => { originalBody = route.request().postData()!; await route.fetch(); await route.abort('failed'); dropped(); }, { times: 1 });
    await first.getByRole('button', { name: 'Save correction' }).click(); await droppedResponse;
    await expect(first.getByRole('button', { name: 'Check again' })).toBeEnabled(); await page.reload();
    let retryBody = ''; page.on('request', r => { if (r.url().endsWith('/executions/results')) retryBody = r.postData()!; });
    await first.getByRole('button', { name: 'Check again' }).click(); await expect(first.getByText(/^Saved v2: 9 reps/)).toBeVisible(); assert.equal(retryBody, originalBody);
    const tab = await context.newPage(); tab.on('dialog', d => void d.accept()); await tab.goto(page.url());
    const otherRow = tab.getByLabel('Set 1 actual result', { exact: true }).first();
    for (const row of [first, otherRow]) { await row.getByRole('button', { name: 'Edit result' }).click(); await row.getByLabel('Set 1 correction reason').fill('Concurrent correction'); }
    await first.getByLabel('Set 1 Actual reps', { exact: true }).fill('10'); await otherRow.getByLabel('Set 1 Actual reps', { exact: true }).fill('11');
    await first.getByRole('button', { name: 'Save correction' }).click(); await expect(first.getByText(/^Saved v3: 10 reps/)).toBeVisible();
    await tab.getByRole('button', { name: 'Refresh saved results' }).click(); await expect(otherRow.getByText(/^Saved v3:/)).toBeVisible();
    await otherRow.getByRole('button', { name: 'Save correction' }).click(); await expect(otherRow.getByRole('button', { name: 'Review latest result' })).toBeVisible();
    assert.equal(JSON.parse((await tab.evaluate(() => Object.entries(sessionStorage).find(([k]) => k.startsWith('trainer2-result:'))?.[1]))!).base.version, 2);
    await expect(otherRow.getByLabel('Set 1 Actual reps', { exact: true })).toHaveValue('11');
    await otherRow.getByRole('button', { name: 'Review latest result' }).click(); await otherRow.getByRole('button', { name: 'Use this version for my correction' }).click();
    await otherRow.getByRole('button', { name: 'Save correction' }).click(); await expect(otherRow.getByText(/^Saved v4: 11 reps/)).toBeVisible();
    await tab.close(); await page.reload(); await expect(first.getByText(/^Saved v4: 11 reps/)).toBeVisible();
    await second.getByRole('button', { name: 'Edit result' }).click(); await second.getByLabel('Set 2 correction reason').fill('Accidentally recorded');
    await second.getByRole('button', { name: 'Clear erroneous result' }).click(); await expect(second.getByText(/^Saved v2: Cleared/)).toBeVisible();
    await second.getByRole('button', { name: 'Re-record result' }).click(); await second.getByLabel('Set 2 Actual reps', { exact: true }).fill('0');
    await second.getByLabel('Set 2 rep basis').selectOption('perSide'); await second.getByLabel('Set 2 actual load type').selectOption('bodyweight');
    await second.getByLabel('Set 2 correction reason').fill('Correct actual result'); await second.getByRole('button', { name: 'Save correction' }).click();
    await expect(second.getByText(/^Saved v3: 0 reps per side/)).toBeVisible();
    const secondHistory = (await persisted(browserPrincipal)).filter(r => r.targetId === opened.initial.positions[0].targets[1].id);
    assert.deepEqual(secondHistory.map(r => r.version), [1, 2, 3]); assert.equal(new Set(secondHistory.map(r => r.performedSetId)).size, 1);
    assert.equal(secondHistory[1].result, null);
    assert.deepEqual(secondHistory[2].result, { reps: { value: 0, basis: 'perSide' }, measurement: { kind: 'bodyweight', convention: 'bodyweightOnly' }, rir: null });
    assert.equal(await page.getByRole('navigation').count(), 0);
    await first.getByRole('button', { name: 'Edit result' }).click();
    await page.screenshot({ path: resolve('artifacts/trainer2/set-results-desktop.png'), fullPage: true });
    await first.getByRole('button', { name: 'Discard input' }).click();
    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); const phone = await mobile.newPage();
    await phone.goto(page.url()); const phoneRow = phone.getByLabel('Set 1 actual result', { exact: true }).first(); await phoneRow.getByRole('button', { name: 'Edit result' }).click();
    assert(await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)); assert.equal(await phone.getByRole('navigation').count(), 0);
    await phone.screenshot({ path: resolve('artifacts/trainer2/set-results-mobile.png'), fullPage: true }); await mobile.close();
    const stored = await readExecution(reader, browserPrincipal, executionId); const raw = await persisted(browserPrincipal);
    assert.equal(stored!.lifecycle, 'Open'); await preserved(browserPrincipal, browserBefore, 'browser records/corrections/conflict/replay');
    base = await restartWeb(); await page.goto(`${base}/trainer2/dev/executions/${executionId}`); await expect(first.getByText(/^Saved v4: 11 reps/)).toBeVisible();
    assert.deepEqual(await readExecution(reader, browserPrincipal, executionId), stored); assert.deepEqual(await persisted(browserPrincipal), raw);
    await preserved(browserPrincipal, browserBefore, 'same database process restart'); assert.deepEqual(errors, []);
    writeFileSync(resolve('artifacts/trainer2/set-results-persisted.json'), JSON.stringify({ current: stored!.results, revisions: raw, preservation }, null, 2));
    await context.close();
    pass('Actual Edge/API/PostgreSQL: start, several records, unrelated draft preservation, reload, correction, lost commit response/reload/exact retry, two-tab conflict/explicit recovery, desktop/mobile, same-DB app restart');
  } finally { await browser.close(); }
  return { status: 'passed', results, preservation };
}
