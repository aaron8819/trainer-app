import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { chromium, expect } from '@playwright/test';
import { Pool } from 'pg';
import { commandBinding } from '../../src/lib/api/trainer2/integrity';
import { reviewedResults } from '../../src/lib/trainer2-contracts/workout-finish';
import { verificationSource } from '../../scripts/trainer2/verification-source';

async function main() {
  const [container, confirmation] = process.argv.slice(2);
  assert(confirmation === '--confirm-synthetic-trial' && /^trainer2-draft-[a-f0-9]+$/.test(container));
  const ready = JSON.parse(readFileSync('artifacts/trainer2/prefill-evidence/ready.json', 'utf8'));
  const base: string = ready.base;
  assert(/^http:\/\/127\.0\.0\.1:\d+$/.test(base));
  const meta = JSON.parse(execFileSync('docker', ['inspect', container], { encoding: 'utf8', windowsHide: true }))[0];
  const port = meta.NetworkSettings.Ports['5432/tcp'][0]; assert.equal(port.HostIp, '127.0.0.1');
  const env = Object.fromEntries(meta.Config.Env.map((v: string) => [v.slice(0, v.indexOf('=')), v.slice(v.indexOf('=') + 1)]));
  assert(/^trainer2_disposable_/.test(env.POSTGRES_DB));
  const db = new Pool({ host: '127.0.0.1', port: Number(port.HostPort), user: 'postgres', password: env.POSTGRES_PASSWORD, database: env.POSTGRES_DB });
  const dir = 'artifacts/trainer2/alignment-evidence/'; mkdirSync(dir, { recursive: true });
  const source = verificationSource(), checks: string[] = [], races: unknown[] = [], errors: string[] = [];
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1360, height: 1000 }, reducedMotion: 'reduce' });
  const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
  const panel = page.getByRole('region', { name: 'Active set', exact: true });
  const chips = page.getByRole('region', { name: 'Exercise queue' }).getByRole('button', { name: /, set \d+,/ });
  const reps = () => panel.getByLabel(/Actual reps/), load = () => panel.getByLabel(/Actual load$/);
  const get = async (path: string) => { const r = await fetch(base + path); assert(r.ok, await r.clone().text()); return r.json(); };
  const post = async (path: string, command: unknown) => { const r = await fetch(base + '/api/trainer2/executions/' + path, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify(command) }); return { status: r.status, body: await r.json() }; };
  let id = '', accountId = '';
  const read = () => get('/api/trainer2/executions/' + id);
  const envelope = () => ({ schemaVersion: 1, actionId: randomUUID(), deviceId: randomUUID(), originatingAccountId: accountId, ownershipEpoch: 0, dependsOn: [] });
  const skip = (targetId: string) => ({ ...envelope(), commandType: 'SkipSet', target: { executionId: id, targetId }, expected: { resultVersion: 0, skipActionId: null }, intent: {} });
  const log = (targetId: string, skipActionId?: string) => ({ ...envelope(), commandType: 'RecordSetResult', target: { executionId: id, targetId }, expected: { resultVersion: 0, ...(skipActionId ? { skipActionId } : {}) }, intent: { result: { reps: { value: 8, basis: 'total' }, measurement: null, rir: '3' } } });
  const finish = (e: Parameters<typeof reviewedResults>[0]) => ({ ...envelope(), commandType: 'FinishExecution', target: { executionId: id }, expected: reviewedResults(e), intent: { acknowledgeUnrecorded: true } });
  const select = async (n: number) => { await chips.nth(n).click(); await expect(chips.nth(n)).toHaveAttribute('aria-pressed', 'true'); };
  const uiSave = async (name = 'Log set', endpoint = 'results') => {
    const response = page.waitForResponse(r => r.url().endsWith('/executions/' + endpoint) && r.request().method() === 'POST');
    await panel.getByRole('button', { name, exact: true }).click(); const r = await response;
    assert.equal(r.status(), 200, await r.text()); return r.request().postDataJSON();
  };
  // Establish actual waiting transactions before releasing the account lock.
  const race = async (first: [string, unknown], second: [string, unknown]) => {
    const lock = await db.connect(); await lock.query('BEGIN');
    await lock.query('SELECT "accountId" FROM "Trainer2AccountTrainingState" WHERE "accountId"=$1 FOR UPDATE', [accountId]);
    const waitFor = async (n: number) => {
      for (let i = 0; i < 100; i++) {
        const q = await db.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'");
        if (q.rows[0].n >= n) return;
        await new Promise(r => setTimeout(r, 30));
      }
      throw new Error('Expected blocked command transactions');
    };
    try {
      const a = post(...first); await waitFor(1); const b = post(...second); await waitFor(2);
      await lock.query('COMMIT'); const result = await Promise.all([a, b]); races.push({ first, second, result }); return result;
    } finally { await lock.query('ROLLBACK'); lock.release(); }
  };
  try {
    const pending = await get('/api/trainer2/plans/' + ready.planId + '/next');
    if (pending.execution) await page.goto(base + '/trainer2/dev/executions/' + pending.execution.executionId);
    else { await page.goto(ready.url); await page.getByRole('button', { name: 'Start workout', exact: true }).click(); }
    await expect(page).toHaveURL(/executions\//); id = page.url().split('/').at(-1)!;
    const initial = await read(); accountId = initial.initial.accountId;
    const ids: string[] = initial.initial.positions.flatMap((p: { targets: { id: string }[] }) => p.targets.map(t => t.id));
    if (!initial.skips?.length) await expect(load()).toHaveValue('130');
    // An untouched suggestion skips without a prompt or timer, then remains durable on reload.
    let dialogs = 0; page.on('dialog', d => { dialogs++; void d.dismiss(); });
    const skipped = initial.skips?.length ? JSON.parse((await db.query('SELECT "submittedEnvelope" FROM "Trainer2DurableAction" WHERE "actionId"=$1',[initial.skips[0].actionId])).rows[0].submittedEnvelope) : await uiSave('Skip set', 'skip-set');
    if (initial.skips?.length) { assert.equal(initial.results.length,0); assert.equal(initial.skips.length,1); await select(1); }
    await expect(chips.nth(1)).toHaveAttribute('aria-pressed', 'true'); assert.equal(dialogs, 0);
    assert.equal(await page.getByRole('complementary', { name: 'Rest timer' }).count(), 0);
    await page.reload(); await select(0); await expect(panel.getByRole('button', { name: 'Log this set' })).toBeVisible();
    const afterSkip = await read(); assert.equal(afterSkip.results.length, 0); assert.equal(afterSkip.skips[0].actionId, skipped.actionId);
    assert.deepEqual(afterSkip.initial, initial.initial);
    const discard = await post('discard', { ...envelope(), commandType: 'DiscardEmptyExecution', target: { executionId: id, occurrenceId: initial.initial.occurrence.id }, expected: reviewedResults(afterSkip), intent: {} });
    assert.equal(discard.body.outcome.code, 'EXECUTION_NOT_EMPTY');
    assert.equal((await post('skip-set', { ...skipped, target: { executionId: id, targetId: ids[1] } })).body.error, 'ACTION_ID_COLLISION');
    assert.equal((await post('skip-set', { ...skip(ids[1]), originatingAccountId: randomUUID() })).status, 403);
    // A missing durable outcome aborts the entire transaction, including its event and action.
    const rollbackCommand = skip(ids[11]), binding = commandBinding(rollbackCommand), tx = await db.connect();
    try {
      await tx.query('BEGIN'); await tx.query('SET LOCAL ROLE trainer2_draft_runtime');
      await tx.query('INSERT INTO "Trainer2DurableAction" ("accountId","actionId","envelopeHash","submittedEnvelope","hashVersion") VALUES ($1,$2,$3,$4,$5)', [accountId, rollbackCommand.actionId, binding.envelopeHash, binding.submittedEnvelope, binding.hashVersion]);
      await tx.query('INSERT INTO "Trainer2SetSkip" ("accountId","executionId","targetId","actionId") VALUES ($1,$2,$3,$4)', [accountId,id,ids[11],rollbackCommand.actionId]);
      await assert.rejects(tx.query('COMMIT'), /TRAINER2_/);
    } finally { await tx.query('ROLLBACK'); tx.release(); }
    assert.equal((await db.query('SELECT count(*)::int AS n FROM "Trainer2DurableAction" WHERE "actionId"=$1',[rollbackCommand.actionId])).rows[0].n,0);
    await assert.rejects(db.query('UPDATE "Trainer2SetSkip" SET "skippedAt"=clock_timestamp() WHERE "executionId"=$1',[id]));
    checks.push('Untouched suggestions skip without confirmation or performed values; no timer; reload durable; skip history prevents empty discard');
    await panel.getByRole('button', { name: 'Log this set' }).click();
    await load().fill('137.25'); await reps().fill('9'); await panel.getByLabel(/Actual RIR/).fill('0');
    await page.evaluate(() => window.scrollTo(0, 320));
    const geometry = async () => ({ scroll: await page.evaluate(() => scrollY), box: await reps().boundingBox() });
    const before = await geometry();
    await panel.getByRole('button', { name: 'Increase reps', exact: true }).click();
    await panel.getByRole('button', { name: 'Increase load by 5 lb', exact: true }).click();
    await panel.getByRole('button', { name: '3 RIR', exact: true }).click();
    const after = await geometry(); assert.equal(after.scroll, before.scroll); assert.equal(after.box!.y, before.box!.y);
    assert.equal(await panel.getByText('Unsaved input', { exact: true }).count(), 0);
    await load().fill('137.25'); await reps().fill('9'); await uiSave();
    await expect(chips.nth(1)).toHaveAttribute('aria-pressed', 'true'); await expect(load()).toHaveValue('137.25'); await expect(reps()).toHaveValue('9');
    const recorded = await read(); assert.equal(recorded.results[0].result.measurement.value, '137.25'); assert.equal(recorded.skips[0].actionId, skipped.actionId);
    const timerKey = `trainer2-rest:${accountId}:${id}`;
    const timer = () => page.evaluate(k => localStorage.getItem(k), timerKey);
    const timerBefore = await timer(); assert(timerBefore); assert.equal(JSON.parse(timerBefore).duration, 180000);
    await reps().fill('11'); await panel.getByRole('button', { name: 'Skip set', exact: true }).click();
    assert.equal(dialogs, 1); await expect(reps()).toHaveValue('11');
    page.removeAllListeners('dialog'); page.on('dialog', d => void d.accept());
    await uiSave('Skip set', 'skip-set'); await expect(chips.nth(2)).toHaveAttribute('aria-pressed', 'true'); assert.equal(await timer(), timerBefore);
    checks.push('Explicit reopening binds skip; exact fractional visible values persist and carry forward; step/RIR controls do not move; edited-skip cancellation retains draft; skip preserves timer');
    // Layout at matching desktop and narrow mobile viewports; timer remains outside and above card.
    for (const width of [1360, 390, 320]) {
      await page.setViewportSize({ width, height: width === 1360 ? 1000 : 844 }); await select(2);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      const buttons = await panel.getByRole('button', { name: /^(Log set|Skip set)$/ }).evaluateAll(xs => xs.map(x => x.getBoundingClientRect().width));
      assert.equal(buttons.length, 2); assert(Math.abs(buttons[0] - buttons[1]) < 1);
      const rect = await panel.boundingBox(), timerRect = await page.getByRole('complementary', { name: 'Rest timer' }).boundingBox();
      assert(rect!.y >= timerRect!.y + timerRect!.height);
      await page.screenshot({ path: dir + `logger-${width}.png`, fullPage: true });
    }
    const y = await page.evaluate(() => scrollY); const inputY = (await reps().boundingBox())!.y;
    await page.getByRole('button', { name: 'Dismiss rest timer' }).click();
    assert.equal(await page.evaluate(() => scrollY), y); assert.equal((await reps().boundingBox())!.y, inputY);
    await page.setViewportSize({ width: 1360, height: 1000 });
    // Corrections preserve timer; drafts remain target scoped through queue navigation.
    await reps().fill('13'); await select(0); await reps().fill('10'); const priorTimer = await timer(); await uiSave('Update set');
    await expect(panel.getByRole('status')).toHaveText('Saved'); assert.equal(await timer(), priorTimer);
    assert.equal(await panel.getByRole('button', { name: 'Skip set' }).count(), 0);
    await panel.getByRole('button', { name: 'Return to active set' }).click(); await expect(reps()).toHaveValue('13');
    await uiSave(); await expect(chips.nth(3)).toHaveAttribute('aria-pressed', 'true');
    // Simulate an accepted skip whose HTTP response is lost; exact retry must not duplicate.
    let uncertain: unknown;
    await page.route('**/executions/skip-set', async route => { uncertain = route.request().postDataJSON(); await route.fetch(); await route.abort(); });
    await panel.getByRole('button', { name: 'Skip set', exact: true }).click();
    await expect(panel.getByRole('status')).toContainText('could not be confirmed'); await page.unroute('**/executions/skip-set');
    await page.reload(); await panel.getByRole('button', { name: 'Retry save' }).click(); await expect(chips.nth(4)).toHaveAttribute('aria-pressed', 'true');
    assert.equal((await post('skip-set', uncertain)).body.replayed, true);
    checks.push('Desktop/390/320 layouts fit; equal pill buttons; sticky timer clears heading; dismiss has no jump; corrections keep deadline; drafts survive selection; uncertain skip reload retries once');
    // Delayed success must not steal selection/focus or replace another edited draft.
    let release!: () => void; const held = new Promise<void>(r => release = r); let accepted!: () => void; const reached = new Promise<void>(r => accepted = r);
    await page.route('**/executions/results', async route => { const response = await route.fetch(); accepted(); await held; await route.fulfill({ response }); });
    await load().fill('151.125'); await reps().fill('7'); await panel.getByRole('button', { name: 'Log set', exact: true }).click(); await reached;
    await select(5); await reps().fill('15'); const focus = await reps().getAttribute('aria-label'); const scroll = await page.evaluate(() => scrollY);
    release(); await expect(chips.nth(4)).toHaveAttribute('aria-label', /recorded/); await expect(reps()).toHaveValue('15');
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), focus); assert.equal(await page.evaluate(() => scrollY), scroll);
    await page.unroute('**/executions/results'); await uiSave(); await expect(chips.nth(6)).toHaveAttribute('aria-pressed', 'true');
    checks.push('Delayed accepted log preserves another selected set, typed draft, focus and viewport');
    // Both lock orders, same-action retry, stale tabs, exact target and lifecycle checks.
    let result = await race(['results', log(ids[6])], ['skip-set', skip(ids[6])]); assert.deepEqual(result.map(r => r.status), [200, 409]);
    const skipFirst = skip(ids[7]); result = await race(['skip-set', skipFirst], ['results', log(ids[7])]); assert.deepEqual(result.map(r => r.status), [200, 409]);
    const duplicate = skip(ids[8]); result = await race(['skip-set', duplicate], ['skip-set', duplicate]); assert.deepEqual(result.map(r => r.status), [200, 200]); assert.equal(result[1].body.replayed, true);
    assert.equal((await post('skip-set', skip(ids[8]))).status, 409);
    assert.equal((await post('results', log(ids[7]))).body.outcome.code, 'STALE_SET_SKIP');
    assert.equal((await post('skip-set', skip(randomUUID()))).body.outcome.code, 'SET_NOT_FOUND');
    const beforeRace = await read(); result = await race(['skip-set', skip(ids[9])], ['finish', finish(beforeRace)]); assert.deepEqual(result.map(r => r.status), [200, 409]);
    assert.equal(result[1].body.outcome.code, 'STALE_FINISH_RESULTS');
    await page.reload(); await page.getByRole('button', { name: 'Finish workout', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Finish workout' })).toContainText('explicitly skipped');
    await page.getByRole('button', { name: 'Finish with unrecorded sets' }).click(); await expect(page).toHaveURL(/drafts\?planId=/);
    const finished = await read(); assert.equal(finished.lifecycle, 'Finished'); assert.deepEqual(finished.initial, initial.initial);
    assert.equal((await post('results', log(ids[7], skipFirst.actionId))).body.outcome.code, 'EXECUTION_NOT_OPEN');
    assert.equal((await post('skip-set', skip(ids[10]))).body.outcome.code, 'EXECUTION_NOT_OPEN');
    const rows = (await db.query('SELECT * FROM "Trainer2SetSkip" WHERE "executionId"=$1 ORDER BY "targetId"', [id])).rows;
    assert.equal(rows.length, finished.skips.length);
    for (const s of rows) assert.equal(finished.skips.find((r: { targetId: string }) => r.targetId === s.targetId).actionId, s.actionId);
    const finishedId = id;
    // Finish-first makes the queued skip conflict, even against the same reviewed empty execution.
    const next = await get('/api/trainer2/plans/' + initial.initial.planId + '/next');
    const started = await post('start', { ...envelope(), commandType: 'StartOccurrence', target: { planId: next.planId, occurrenceId: next.occurrence.id }, expected: { planRevisionId: next.revisionId, instructionEpoch: next.instructionEpoch }, intent: {} });
    assert.equal(started.status, 200); id = started.body.outcome.result.executionId;
    const empty = await read(); result = await race(['finish', finish(empty)], ['skip-set', skip(empty.initial.positions[0].targets[0].id)]); assert.deepEqual(result.map(r => r.status), [200, 409]);
    // All targets resolved through skips still require explicit finish.
    const draftPost = async (path: string, command: unknown) => {
      const r = await fetch(base + '/api/trainer2/drafts/' + path, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify(command) });
      assert.equal(r.status, 200, await r.clone().text()); return (await r.json()).outcome.result;
    };
    const planId = randomUUID(), stageId = randomUUID();
    const position = { ...initial.initial.occurrence.positions[0], id: randomUUID(), sourceKey: undefined,
      targets: initial.initial.occurrence.positions[0].targets.slice(0, 2).map((t: object) => ({ ...t, id: randomUUID() })) };
    const intent = { schemaVersion: 1, name: 'SYNTHETIC all-skipped check', endpoint: 'endOfOrderedOccurrences', progression: initial.initial.progression,
      stages: [{ id: stageId, name: 'Synthetic' }], occurrences: [{ id: randomUUID(), stageId, name: 'All skipped', positions: [position] }] };
    await draftPost('create', { ...envelope(), commandType: 'CreateDraft', target: { planId }, expected: {}, intent });
    const draft = await get('/api/trainer2/drafts/' + planId);
    await draftPost('activate', { ...envelope(), commandType: 'ActivatePlan', target: { planId }, expected: { planRevisionId: draft.revisionId }, intent: { reviewed: draft.activation } });
    const allNext = await get('/api/trainer2/plans/' + planId + '/next');
    const allStart = await post('start', { ...envelope(), commandType: 'StartOccurrence', target: { planId, occurrenceId: allNext.occurrence.id }, expected: { planRevisionId: allNext.revisionId, instructionEpoch: allNext.instructionEpoch }, intent: {} });
    assert.equal(allStart.status, 200); id = allStart.body.outcome.result.executionId;
    const allInitial = await read();
    for (const t of allInitial.initial.positions[0].targets) assert.equal((await post('skip-set', skip(t.id))).status, 200);
    const allSkipped = await read(); assert.equal(allSkipped.lifecycle, 'Open'); assert.equal(allSkipped.results.length, 0); assert.equal(allSkipped.skips.length, 2);
    const noAck = finish(allSkipped); noAck.intent.acknowledgeUnrecorded = false;
    assert.equal((await post('finish', noAck)).body.outcome.code, 'UNRECORDED_ACKNOWLEDGEMENT_REQUIRED');
    assert.equal((await post('finish', finish(allSkipped))).status, 200);
    checks.push('Missing outcome rolls back skip/action; audit immutable; account and action identity protected; all-skipped execution stays Open and requires exact incomplete-work acknowledgement');
    checks.push('Observed account-lock queues: Log/Skip both orders, duplicate/replay, Skip/Finish both orders; stale state conflicts; finished logging/skipping denied; finish returns home; independent SQL matches audit readback');
    assert.deepEqual(errors, []);
    writeFileSync(dir + 'browser-and-races.json', JSON.stringify({ at: new Date().toISOString(), source, sourceAfter: verificationSource(), base, container, database: env.POSTGRES_DB, finishedId, checks, races, rows, finished, errors }, null, 2));
    console.log(checks.join('\n'));
  } finally { await browser.close(); await db.end(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
