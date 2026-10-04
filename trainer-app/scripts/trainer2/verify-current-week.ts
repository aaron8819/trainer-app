import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import type { PrismaClient } from '@prisma/client';
import type { Pool } from 'pg';
import { expect as playwrightExpect, type BrowserContext } from '@playwright/test';
import { createDraft, readDraft } from '../../src/lib/api/trainer2/planning';
import { activatePlan } from '../../src/lib/api/trainer2/activation';
import { startOccurrence, readExecution, readNextWorkout } from '../../src/lib/api/trainer2/execution';
import { skipOccurrence } from '../../src/lib/api/trainer2/skip-occurrence';
import { discardEmptyExecution } from '../../src/lib/api/trainer2/discard-execution';
import { finishExecution } from '../../src/lib/api/trainer2/workout-finish';
import { reviewedResults } from '../../src/lib/trainer2-contracts/workout-finish';
import { canonicalJson } from '../../src/lib/api/trainer2/integrity';
import { saveSetResult } from '../../src/lib/api/trainer2/set-results';
import { currentAssignment } from '../../src/lib/engine/trainer2/exercise-swap';
import type { ServerPrincipal } from '../../src/lib/api/trainer2/principal';
import type { DraftDocument } from '../../src/lib/trainer2-contracts/draft';
const expect = playwrightExpect.configure({ timeout: 30_000 });

export async function verifyCurrentWeek({ db, reader, admin, principal, context, base, artifact, pass, restart, upgrade }: {
  db: PrismaClient; reader: PrismaClient; admin: Pool; principal: ServerPrincipal; context: BrowserContext; base: string; artifact: string;
  pass: (name: string) => void; restart: () => Promise<void>; upgrade: () => Promise<void>;
}) {
  const envelope = () => ({ schemaVersion: 1, actionId: randomUUID(), deviceId: randomUUID(), originatingAccountId: principal.accountId, ownershipEpoch: 0, dependsOn: [] });
  const stage = randomUUID(), later = randomUUID(), planId = randomUUID();
  const intent: DraftDocument = { schemaVersion: 1, name: 'Current week synthetic program', endpoint: 'endOfOrderedOccurrences',
    progression: { version: 1, mode: 'plannedPrescriptions', scope: 'wholePlan', parameters: {} },
    stages: [{ id: later, name: 'Repeated label' }, { id: stage, name: 'Repeated label' }],
    occurrences: [stage, stage, stage, stage, later, later, stage].map((stageId, i) => ({ id: randomUUID(), stageId, name: i < 2 ? 'Same workout' : `Workout ${i + 1}`,
      positions: [{ id: randomUUID(), role: 'Main lift', exercise: { kind: 'authoredDescription', name: 'A deliberately long exercise name for mobile prescription review', variation: 'Secondary guidance stays behind intentional expansion.' },
        targets: [{ id: randomUUID(), required: i !== 3, classification: i === 3 ? 'optionalFinisher' : 'working', reps: { min: 5 + i, max: 8 + i, basis: 'perSide' },
          measurement: { kind: 'externalLoad', value: `${i * 5}.00`, unit: i % 2 ? 'lb' : 'kg', convention: 'perImplement', zeroMeaning: 'validZero' }, rir: `${i % 4}.0`, restSeconds: '120.00' }] }] })) };
  const accepted = <T>(response: { outcome: { status: string; result?: T } }): T => { assert.equal(response.outcome.status, 'Accepted'); return response.outcome.result!; };
  // Populate the released schema with a completed workout/result before upgrade.
  const oldPlanId=randomUUID(), oldStageId=randomUUID(), oldOccurrenceId=randomUUID();
  const oldIntent: DraftDocument={...intent,stages:[{id:oldStageId,name:'Released baseline'}],occurrences:[{...intent.occurrences[0],id:oldOccurrenceId,stageId:oldStageId,
    positions:[{...intent.occurrences[0].positions[0],id:randomUUID(),targets:[{...intent.occurrences[0].positions[0].targets[0],id:randomUUID()}]}]}]};
  accepted(await createDraft(db,principal,{...envelope(),commandType:'CreateDraft',target:{planId:oldPlanId},expected:{},intent:oldIntent}));
  const oldHead=(await readDraft(reader,principal,oldPlanId))!;
  accepted(await activatePlan(db,principal,{...envelope(),commandType:'ActivatePlan',target:{planId:oldPlanId},expected:{planRevisionId:oldHead.revisionId},intent:{reviewed:oldHead.activation}}));
  const oldStart=await startOccurrence(db,principal,{...envelope(),commandType:'StartOccurrence',target:{planId:oldPlanId,occurrenceId:oldOccurrenceId},expected:{planRevisionId:oldHead.revisionId,instructionEpoch:0},intent:{}});
  assert(oldStart.outcome.status==='Accepted'); let oldExecution=(await readExecution(reader,principal,oldStart.outcome.result.executionId))!;
  const oldPosition=oldExecution.initial.positions[0];
  accepted(await saveSetResult(db,principal,{...envelope(),commandType:'RecordSetResult',target:{executionId:oldExecution.executionId,targetId:oldPosition.targets[0].id},
    expected:{resultVersion:0,assignment:currentAssignment(oldExecution,oldPosition.id)},intent:{result:{reps:{value:5,basis:'perSide'},measurement:oldIntent.occurrences[0].positions[0].targets[0].measurement,rir:'2'}}}));
  oldExecution=(await readExecution(reader,principal,oldExecution.executionId))!;
  accepted(await finishExecution(db,principal,{...envelope(),commandType:'FinishExecution',target:{executionId:oldExecution.executionId},expected:reviewedResults(oldExecution),intent:{acknowledgeUnrecorded:false}}));
  accepted(await createDraft(db, principal, { ...envelope(), commandType: 'CreateDraft', target: { planId }, expected: {}, intent }));
  const head = (await readDraft(reader, principal, planId))!;
  accepted(await activatePlan(db, principal, { ...envelope(), commandType: 'ActivatePlan', target: { planId }, expected: { planRevisionId: head.revisionId }, intent: { reviewed: head.activation } }));
  const command = (index: number) => ({ ...envelope(), commandType: 'StartOccurrence', target: { planId, occurrenceId: intent.occurrences[index].id }, expected: { planRevisionId: head.revisionId, instructionEpoch: 0 }, intent: {} });
  const read = async (id: string) => (await readExecution(reader, principal, id))!;
  const finish = async (id: string) => accepted(await finishExecution(db, principal, { ...envelope(), commandType: 'FinishExecution', target: { executionId: id }, expected: reviewedResults(await read(id)), intent: { acknowledgeUnrecorded: true } }));
  const next = () => readNextWorkout(reader, principal, planId);
  const skipCommand = async (index: number) => ({ ...envelope(), commandType: 'SkipOccurrence', target: { planId, occurrenceId: intent.occurrences[index].id }, expected: { planRevisionId: head.revisionId, acceptedSequence: (await next()).acceptedSequence }, intent: {} });
  const baseStart=command(0), baseStarted=await startOccurrence(db,principal,baseStart); assert(baseStarted.outcome.status==='Accepted');
  const baseExecution=await read(baseStarted.outcome.result.executionId);
  const tables=(await admin.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND (tablename LIKE 'Trainer2%' OR tablename='User') ORDER BY tablename")).rows.map(r=>r.tablename as string);
  const allRows=async()=>Object.fromEntries(await Promise.all(tables.map(async t=>[t,(await admin.query(`SELECT to_jsonb(x) row FROM "${t}" x ORDER BY to_jsonb(x)::text`)).rows])));
  const populated=await allRows(); await upgrade(); assert.deepEqual(await allRows(),populated);
  assert.equal((await read(oldExecution.executionId)).results.length,1); assert.equal((await read(baseExecution.executionId)).lifecycle,'Open');
  accepted(await discardEmptyExecution(db,principal,{...envelope(),commandType:'DiscardEmptyExecution',target:{executionId:baseExecution.executionId,occurrenceId:baseExecution.initial.occurrence.id},expected:reviewedResults(baseExecution),intent:{}}));
  assert.equal((await startOccurrence(db,principal,baseStart)).replayed,true); assert.equal((await read(baseExecution.executionId)).lifecycle,'Discarded');
  pass('Populated released-base upgrade twice preserves every business row, finished result, open START and device session; historical start stays discarded');
  const snapshot = async () => ({ executions: await admin.query('SELECT to_jsonb(x) row FROM "Trainer2Execution" x ORDER BY "id"'),
    plan: await admin.query('SELECT to_jsonb(x) row FROM "Trainer2PlanRevision" x ORDER BY "id"') });
  const oracle = async (indices: number[]) => {
    assert.deepEqual((await next()).eligibleOccurrenceIds, indices.map(i => intent.occurrences[i].id));
    for (let i = 0; i < intent.occurrences.length; i++) {
      const value = await admin.query('SELECT trainer2_current_week_eligible($1,$2,$3::jsonb,$4) eligible', [principal.accountId, planId, JSON.stringify(intent), intent.occurrences[i].id]);
      assert.equal(value.rows[0].eligible, indices.includes(i), `SQL eligibility for occurrence ${i}`);
    }
  };
  await oracle([0, 1, 2, 3]);
  const future = await startOccurrence(db, principal, command(4)); assert.equal(future.outcome.status, 'Conflict');
  assert.equal(future.outcome.code, 'OCCURRENCE_NOT_CURRENT_WEEK');
  // Observe two real transactions blocked on the owning account row before release.
  async function race(first: ReturnType<typeof command>, second: ReturnType<typeof command>) {
    const lock = await admin.connect(); await lock.query('BEGIN');
    const pid = (await lock.query('SELECT pg_backend_pid() pid')).rows[0].pid;
    await lock.query('SELECT "accountId" FROM "Trainer2AccountTrainingState" WHERE "accountId"=$1 FOR UPDATE', [principal.accountId]);
    const wait = async (count: number) => { const deadline = Date.now() + 8000; for (;;) {
      const r = await admin.query('WITH RECURSIVE waiting(pid) AS (SELECT pid FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid)) UNION SELECT a.pid FROM pg_stat_activity a JOIN waiting w ON w.pid=ANY(pg_blocking_pids(a.pid))) SELECT DISTINCT pid FROM waiting', [pid]);
      if (r.rowCount! >= count) return; assert(Date.now() < deadline, 'Expected observed start lock queue'); await new Promise(r => setTimeout(r, 20));
    } };
    let a: ReturnType<typeof startOccurrence> | undefined, b: ReturnType<typeof startOccurrence> | undefined;
    try { a = startOccurrence(db, principal, first); await wait(1); b = startOccurrence(db, principal, second); await wait(2); await lock.query('COMMIT'); return await Promise.all([a, b]); }
    finally { await lock.query('ROLLBACK'); lock.release(); await Promise.allSettled([a, b].filter(Boolean)); }
  }
  const original = command(2), [winner, blocked] = await race(original, command(1));
  assert.equal(winner.outcome.status, 'Accepted'); assert(winner.outcome.status === 'Accepted');
  assert(blocked.outcome.status !== 'Accepted'); assert.equal(blocked.outcome.code, 'OPEN_EXECUTION_CONFLICT');
  assert.equal((await admin.query('SELECT count(*) n FROM "Trainer2Execution" WHERE "lifecycle"=\'Open\'')).rows[0].n, '1');
  const initial = await read(winner.outcome.result.executionId);
  assert.deepEqual(initial.initial.occurrence, intent.occurrences[2]); assert.deepEqual(initial.initial.stage, intent.stages.find(s => s.id === stage));
  assert.equal(initial.initial.sourceContentHash, head.contentHash);
  const beforeReplay = await snapshot(); assert.equal((await startOccurrence(db, principal, original)).replayed, true); assert.deepEqual((await snapshot()).executions.rows, beforeReplay.executions.rows);
  await assert.rejects(startOccurrence(db, principal, { ...original, target: command(1).target }), /ACTION_ID_COLLISION/);
  await assert.rejects(startOccurrence(db, { ...principal, accountId: randomUUID() }, command(0)));
  const stale = command(0); stale.expected.planRevisionId = randomUUID(); assert.equal((await startOccurrence(db, principal, stale)).outcome.status, 'Conflict');
  await finish(initial.executionId); await oracle([0, 1, 3]); assert.equal((await next()).occurrence!.id, intent.occurrences[0].id);
  pass('Out-of-order exact approved prescriptions, account/revision/collision checks, durable replay and observed single-open race');
  const [secondWinner, secondBlocked] = await race(command(3), command(0));
  assert(secondWinner.outcome.status === 'Accepted'); assert(secondBlocked.outcome.status !== 'Accepted'); assert.equal(secondBlocked.outcome.code, 'OPEN_EXECUTION_CONFLICT');
  const empty = await read(secondWinner.outcome.result.executionId);
  const discard = { ...envelope(), commandType: 'DiscardEmptyExecution', target: { executionId: empty.executionId, occurrenceId: empty.initial.occurrence.id }, expected: reviewedResults(empty), intent: {} };
  accepted(await discardEmptyExecution(db, principal, discard)); await oracle([0, 1, 3]);
  const restarted = await startOccurrence(db, principal, command(3)); assert(restarted.outcome.status === 'Accepted'); await finish(restarted.outcome.result.executionId);
  assert.equal((await discardEmptyExecution(db, principal, discard)).replayed, true); assert.equal((await read(empty.executionId)).lifecycle, 'Discarded'); await oracle([0, 1]);
  pass('Opposite selected start order, discard/fresh-start/replay recovery and optional-only occurrence retained until explicit resolution');

  let page = await context.newPage(); const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  const home = `${base}/trainer2/dev/drafts?planId=${planId}`;
  await page.goto(home); await expect(page.getByRole('button', { name: 'Start workout', exact: true })).toBeEnabled();
  const card = (index: number) => page.locator(`[data-occurrence-id="${intent.occurrences[index].id}"]`);
  await expect(card(0).getByRole('button')).toHaveAttribute('aria-pressed', 'true');
  const stable = await snapshot(); const sequence = (await next()).acceptedSequence;
  await card(1).getByRole('button').focus(); await page.keyboard.press('Enter'); await expect(card(1).getByRole('button')).toBeFocused();
  assert.equal((await next()).acceptedSequence, sequence); assert.deepEqual((await snapshot()).executions.rows, stable.executions.rows);
  assert.equal(await card(1).getByRole('button').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.getByRole('heading', { name: 'Same workout', exact: true }).count(), 3);
  const shots: string[] = [];
  for (const width of [1360, 390, 320]) {
    await page.setViewportSize({ width, height: 844 }); await page.goto(home + '&view=program');
    await page.getByRole('button', { name: 'Week 2', exact: true }).click(); await expect(page.locator(`[data-occurrence-id="${intent.occurrences[4].id}"]`)).toBeVisible();
    await page.getByRole('button', { name: 'Week 1', exact: true }).focus(); await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Week 1', exact: true })).toBeFocused();
    await card(1).getByText('Review prescriptions', { exact: true }).click();
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    for (const target of await page.getByRole('navigation', { name: 'Program weeks' }).getByRole('button').all()) assert((await target.boundingBox())!.height >= 44);
    const shot = resolve(artifact, `program-${width}.png`); await page.screenshot({ path: shot, fullPage: true }); shots.push(shot);
    await page.goto(home); await expect(page.getByRole('button', { name: 'Start workout', exact: true })).toBeEnabled();
    await card(1).getByRole('button').click(); assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    const trainingShot = resolve(artifact, `training-${width}.png`); await page.screenshot({ path: trainingShot, fullPage: true }); shots.push(trainingShot);
    assert((await card(1).getByRole('button').boundingBox())!.height >= 44);
  }
  pass('Selection performs no write; 1360/390/320 Program and Training layouts, exact identities, keyboard focus and 44px controls');
  const staleSkip = await skipCommand(0);
  let originalBody = '', dropped!: () => void; const responseDropped = new Promise<void>(resolve => { dropped = resolve; });
  await page.route('**/api/trainer2/executions/start', async route => { originalBody = route.request().postData()!; await route.fetch(); await route.abort('failed'); dropped(); }, { times: 1 });
  await page.getByRole('button', { name: 'Start workout', exact: true }).click(); await responseDropped;
  await expect(page.getByRole('button', { name: 'Check again', exact: true })).toBeEnabled();
  assert.equal(JSON.parse(originalBody).target.occurrenceId, intent.occurrences[1].id);
  const committed = await snapshot(); await page.reload(); await expect(page.getByRole('button', { name: 'Check again', exact: true })).toBeVisible();
  await expect(card(1).getByText(/In progress/)).toBeVisible(); assert.deepEqual((await snapshot()).executions.rows, committed.executions.rows);
  let retry = ''; page.on('request', r => { if (r.url().endsWith('/executions/start')) retry = r.postData()!; });
  await page.getByRole('button', { name: 'Check again', exact: true }).click(); await page.waitForURL('**/trainer2/dev/executions/*'); assert.equal(retry, originalBody);
  const selectedExecutionId = page.url().split('/').at(-1)!; assert.deepEqual((await read(selectedExecutionId)).initial.occurrence, intent.occurrences[1]);
  assert.equal((await skipOccurrence(db, principal, staleSkip)).outcome.status, 'Conflict');
  const tab = await context.newPage(); await tab.goto(home); await expect(tab.getByRole('link', { name: 'Resume workout', exact: true }).first()).toBeVisible(); assert.equal(await tab.getByRole('button', { name: 'Start workout', exact: true }).count(), 0);
  const different = await startOccurrence(db, principal, command(0)); assert(different.outcome.status !== 'Accepted'); assert.equal(different.outcome.code, 'OPEN_EXECUTION_CONFLICT');
  const executionUrl = page.url(); await page.close(); await restart();
  page = await context.newPage(); page.on('pageerror', e => errors.push(e.message)); await page.goto(executionUrl);
  await expect(page.getByRole('button', { name: 'Finish workout', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Finish workout', exact: true }).click(); await page.getByRole('button', { name: 'Finish anyway', exact: true }).click(); await page.waitForURL(home);
  await expect(page.getByRole('button', { name: 'Start workout', exact: true })).toBeEnabled(); assert.equal((await next()).execution, null); await oracle([0]);
  await tab.bringToFront(); await tab.evaluate(() => window.dispatchEvent(new Event('focus'))); await expect(tab.getByRole('button', { name: 'Start workout', exact: true })).toBeVisible();
  pass('Lost selected-start response/reload/exact replay, authoritative open state, server block, app restart, finish home and stale-tab refresh');
  await page.getByRole('button', { name: 'Skip workout', exact: true }).click(); await page.getByRole('button', { name: 'Confirm skip', exact: true }).click();
  await expect(page.getByText('Week 2 of 3', { exact: true })).toBeVisible(); await oracle([4, 5]);
  await expect(page.getByRole('button', { name: 'Start workout', exact: true })).toBeEnabled(); assert.equal((await next()).execution, null);
  await page.goto(home + '&view=program'); await page.getByRole('button', { name: 'Week 1', exact: true }).click(); await card(0).getByText('Review prescriptions', { exact: true }).click();
  await expect(card(0).getByText(/Explicitly skipped/)).toBeVisible(); await expect(card(1).getByRole('link', { name: 'View results' })).toBeVisible();
  const startLater = await startOccurrence(db, principal, command(4)); assert(startLater.outcome.status === 'Accepted'); await finish(startLater.outcome.result.executionId);
  const laterSkip = await skipCommand(5); accepted(await skipOccurrence(db, principal, laterSkip)); await oracle([6]);
  const lastSkip = await skipCommand(6); const terminal = await skipOccurrence(db, principal, lastSkip); assert(terminal.outcome.status === 'Accepted'); assert.equal(terminal.outcome.result.planCompleted, true);
  await oracle([]); assert.equal((await next()).lifecycle, 'Completed'); assert.equal((await next()).occurrence, null);
  const closed = await snapshot(); assert.equal((await startOccurrence(db, principal, original)).replayed, true); assert.equal((await skipOccurrence(db, principal, laterSkip)).replayed, true); assert.deepEqual((await snapshot()).executions.rows, closed.executions.rows);
  assert.equal(canonicalJson((await readDraft(reader, principal, planId))!.intent), canonicalJson(intent)); assert.deepEqual(errors, []);
  pass('Explicit skip, mixed completion endpoint, recurring stage runs, terminal review and historical replay preserve immutable plan');
  await tab.close(); await page.close();
  return { status: 'passed', planId, screenshots: shots, selectedExecutionId, approvedRevisionId: head.revisionId };
}
