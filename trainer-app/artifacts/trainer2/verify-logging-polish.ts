import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { chromium, expect, type Page } from '@playwright/test';
import { createHypertrophyPlan } from '../../src/lib/engine/trainer2/plan-builder';
import { reviewedResults } from '../../src/lib/trainer2-contracts/workout-finish';
import { verificationSource } from '../../scripts/trainer2/verification-source';

async function main() {
  const [base, confirmation] = process.argv.slice(2);
  assert(confirmation === '--confirm-synthetic-trial' && /^http:\/\/127\.0\.0\.1:\d+$/.test(base));
  const ready = JSON.parse(readFileSync('artifacts/trainer2/active-set-evidence/demo-demo-ready.json', 'utf8'));
  assert.equal(new URL(ready.url).origin, base);
  const accountId = ready.next.accountId, source = verificationSource(), dir = 'artifacts/trainer2/polish-evidence/'; mkdirSync(dir, { recursive: true });
  const get = async (path: string) => { const r = await fetch(base + path); assert(r.ok); return r.json(); };
  const envelope = () => ({ schemaVersion: 1, actionId: randomUUID(), deviceId: randomUUID(), originatingAccountId: accountId, ownershipEpoch: 0, dependsOn: [] });
  const post = async (path: string, data: object) => {
    const r = await fetch(base + path, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...envelope(), ...data }) });
    const body = await r.json(); assert.equal(r.status, 200, JSON.stringify(body)); return body.outcome.result;
  };
  const plansFile = dir + 'runner-plans.json';
  const ownedPlans: string[] = existsSync(plansFile) ? JSON.parse(readFileSync(plansFile, 'utf8')) : [];
  // Close only the task-owned synthetic setup plan. This runner never accepts another origin/account.
  for (const cleanupPlan of [ready.planId, ...ownedPlans]) for (;;) {
    const n = await get('/api/trainer2/plans/' + cleanupPlan + '/next'); if (!n.occurrence) break;
    const started = n.execution ?? await post('/api/trainer2/executions/start', { commandType: 'StartOccurrence', target: { planId: cleanupPlan, occurrenceId: n.occurrence.id }, expected: { planRevisionId: n.revisionId, instructionEpoch: n.instructionEpoch }, intent: {} });
    const ex = await get('/api/trainer2/executions/' + started.executionId);
    await post('/api/trainer2/executions/finish', { commandType: 'FinishExecution', target: { executionId: ex.executionId }, expected: reviewedResults(ex), intent: { acknowledgeUnrecorded: true } });
  }
  const template = createHypertrophyPlan(), basic = template.occurrences[0].positions[0], planId = randomUUID(), stageId = randomUUID();
  const mass = { kind: 'externalLoad', value: '20', unit: 'kg', convention: 'barbellTotal', zeroMeaning: 'validZero' };
  const t = (extra = {}) => ({ ...basic.targets[0], id: randomUUID(), reps: { min: 8, max: 8, basis: 'total' }, measurement: mass, rir: '2', ...extra });
  const positions = [
    { ...basic, id: randomUUID(), sourceKey: undefined, role: 'Main lift', targets: [t(), t({ reps: { min: 10, max: 12, basis: 'total' }, rir: '4' }), t()] },
    { ...basic, id: randomUUID(), sourceKey: undefined, role: 'Accessory', targets: [t({ measurement: null, reps: { min: 6, max: 10, basis: 'total' } }), t({ measurement: null })] },
    { id: randomUUID(), role: 'Accessory', exercise: { kind: 'authoredDescription', name: 'Synthetic assistance', variation: '' }, targets: [t({ reps: { min: 6, max: 6, basis: 'perSide' }, measurement: { kind: 'assistance', value: '0', unit: 'kg', convention: 'displayedAssistance', zeroMeaning: 'noAssistance' } }), t({ reps: { min: 8, max: 10, basis: 'perSide' }, measurement: { kind: 'assistance', value: '20', unit: 'kg', convention: 'displayedAssistance', zeroMeaning: 'noAssistance' } })] },
    { id: randomUUID(), role: 'Core', exercise: { kind: 'authoredDescription', name: 'Bodyweight control', variation: '' }, targets: [t({ measurement: { kind: 'bodyweight', convention: 'bodyweightOnly' } })] },
    { id: randomUUID(), role: 'Accessory', exercise: { kind: 'authoredDescription', name: 'Added load control', variation: '' }, targets: [t({ reps: { min: 5, max: 5, basis: 'alternating' }, measurement: { kind: 'addedLoad', value: '5', unit: 'kg', convention: 'addedExternal', zeroMeaning: 'noAddedLoad' } })] },
  ];
  const occurrences = [{ id: randomUUID(), stageId, name: 'Polish loop', positions }, { id: randomUUID(), stageId, name: 'Partial finish', positions: [{ ...basic, id: randomUUID(), sourceKey: undefined, targets: [t(), t()] }] }];
  await post('/api/trainer2/drafts/create', { commandType: 'CreateDraft', target: { planId }, expected: {}, intent: { schemaVersion: 1, name: 'SYNTHETIC logging polish', endpoint: 'endOfOrderedOccurrences', progression: template.progression, stages: [{ id: stageId, name: 'Week 1' }], occurrences } });
  ownedPlans.push(planId); writeFileSync(plansFile, JSON.stringify(ownedPlans));
  const draft = await get('/api/trainer2/drafts/' + planId);
  await post('/api/trainer2/drafts/activate', { commandType: 'ActivatePlan', target: { planId }, expected: { planRevisionId: draft.revisionId }, intent: { reviewed: draft.activation } });
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1360, height: 1000 }, reducedMotion: 'reduce' });
  const page = await context.newPage(), errors: string[] = [], passed: string[] = [];
  const wire = (p: Page) => { p.on('dialog', d => void d.accept()); p.on('pageerror', e => errors.push(e.message)); };
  wire(page); context.on('page', wire);
  const panel = (p = page) => p.getByRole('region', { name: 'Active set', exact: true });
  const queue = (p = page) => p.getByRole('region', { name: 'Exercise queue' });
  const chips = (p = page) => queue(p).getByRole('button', { name: /, set \d+,/ });
  const select = async (i: number, p = page) => { await chips(p).nth(i).click(); };
  const reps = (p = page) => panel(p).getByLabel(/Actual reps/), load = (p = page) => panel(p).getByLabel(/Actual load$/), rir = (p = page) => panel(p).getByLabel(/Actual RIR/);
  const save = async (p = page) => { await panel(p).getByRole('button', { name: /^(Log set|Save correction)$/ }).click(); };
  let executionId = '';
  const read = () => get('/api/trainer2/executions/' + executionId);
  const timer = () => page.evaluate(() => { const key = Object.keys(localStorage).find(k => k.startsWith('trainer2-rest:')); return key ? JSON.parse(localStorage.getItem(key)!) : null; });
  try {
    await page.goto(base + '/trainer2/dev/drafts?planId=' + planId); await page.getByRole('button', { name: 'Start workout', exact: true }).click(); await expect(page).toHaveURL(/executions\//); executionId = page.url().split('/').at(-1)!;
    const initial = await read(), url = page.url();
    await expect(load()).toHaveValue('44.09'); await expect(reps()).toHaveValue('8'); await expect(rir()).toHaveValue('2');
    assert.equal(await panel().getByLabel(/load unit/).count(), 0); assert.equal(await page.getByText('Recovery', { exact: true }).count(), 0);
    await page.screenshot({ path: dir + 'desktop-before.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: dir + 'mobile-before.png', fullPage: true });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await select(3); await expect(load()).toHaveValue(''); await expect(reps()).toHaveValue(''); await reps().fill('11');
    await select(2); await load().fill('60'); await select(0); await expect(load()).toHaveValue('44.09'); await save();
    await expect(panel()).toContainText('Set 2 of 3'); await expect(load()).toHaveValue('44.09'); await expect(reps()).toHaveValue('8'); await expect(rir()).toHaveValue('2');
    await expect(panel()).toContainText('10–12 reps'); await expect(panel()).toContainText('4 RIR');
    await expect(page.getByRole('complementary', { name: 'Rest timer' })).toBeVisible(); const firstTimer = await timer(); assert.equal(firstTimer.duration, 180000);
    assert.equal(await page.evaluate(() => document.activeElement?.tagName), 'H3');
    await page.screenshot({ path: dir + 'mobile-rest.png', fullPage: true });
    await page.setViewportSize({ width: 1360, height: 1000 }); await page.screenshot({ path: dir + 'desktop-rest.png', fullPage: true });
    await panel().getByText('Controls', { exact: true }).click(); await panel().getByRole('button', { name: '+30 seconds', exact: true }).click(); assert.equal((await timer()).deadline, firstTimer.deadline + 30000);
    await panel().getByRole('button', { name: '−30 seconds', exact: true }).click(); assert.equal((await timer()).deadline, firstTimer.deadline);
    await page.reload(); await expect(load()).toHaveValue('44.09'); assert.equal((await timer()).deadline, firstTimer.deadline);
    const background = await context.newPage(); await background.goto('about:blank'); await background.bringToFront();
    const cdp = await context.newCDPSession(page); await cdp.send('Page.setWebLifecycleState', { state: 'frozen' });
    await new Promise(r => setTimeout(r, 2200)); await cdp.send('Page.setWebLifecycleState', { state: 'active' }); await page.bringToFront();
    assert.equal((await timer()).deadline, firstTimer.deadline); await background.close();
    await panel().getByText('Controls', { exact: true }).click(); await panel().getByRole('button', { name: 'Dismiss', exact: true }).click();
    await expect(page.getByRole('complementary', { name: 'Rest timer' })).toHaveCount(0); const dismissed = await timer(); await page.reload(); assert.equal((await timer()).deadline, dismissed.deadline);
    passed.push('Prescribed kg/exact reps/RIR, absent load/range, duplicate identities and retained input; 180s deadline, +/-30, reload, frozen/background browser, dismissal');
    await save(); await expect(panel()).toContainText('Set 3 of 3'); await expect(load()).toHaveValue('60');
    await reps().fill('7'); await save(); await expect(reps()).toHaveValue('11'); await expect(load()).toHaveValue('');
    await panel().getByRole('button', { name: 'Discard input', exact: true }).click(); await expect(reps()).toHaveValue('');
    // Correction stays selected and does not restart rest. Same-value pounds view is no mutation.
    await select(0); const beforeCorrection = await timer(), before = await read(); await save(); assert.equal((await read()).history.length, before.history.length);
    await reps().fill('9'); await panel().getByLabel(/correction reason/).fill('Synthetic correction'); await save(); await expect(panel()).toContainText('Saved v2'); assert.equal((await timer()).deadline, beforeCorrection.deadline); await expect(chips().nth(0)).toHaveAttribute('aria-pressed', 'true');
    await panel().getByLabel(/correction reason/).fill('Clear test'); await panel().getByRole('button', { name: 'Clear erroneous result', exact: true }).click(); await expect(panel()).toContainText('Saved v3');
    await reps().fill('0'); await load().fill('0'); await panel().getByLabel(/correction reason/).fill('Re-record zero'); await save(); await expect(panel()).toContainText('Saved v4'); assert.equal((await timer()).deadline, beforeCorrection.deadline);
    passed.push('Same-value save is no-op; correction stays selected; clear/re-record preserves identity and zero without restarting rest');
    await select(3); await reps().fill('6'); await load().fill('140');
    let release!: () => void, reached!: () => void; const held = new Promise<void>(r => reached = r), wait = new Promise<void>(r => release = r);
    await page.route('**/api/trainer2/executions/results', async route => { const response = await route.fetch(); reached(); await wait; await route.fulfill({ response }); }, { times: 1 });
    await save(); await held; await select(5); await expect(load()).toHaveValue('0'); await expect(reps()).toHaveValue('6'); const focus = await page.evaluate(() => document.activeElement?.textContent); release();
    await expect(panel()).toContainText('4 of 9 sets recorded'); assert.equal(await page.evaluate(() => document.activeElement?.textContent), focus); assert.equal((await timer()).duration, 120000);
    await select(4); await expect(load()).toHaveValue('140'); await expect(reps()).toHaveValue('6'); await reps().fill('8');
    let original = ''; await page.route('**/api/trainer2/executions/results', async route => { original = route.request().postData()!; await route.fetch(); await route.abort('failed'); }, { times: 1 });
    const oldTimer = await timer(); await save(); await expect(panel().getByRole('button', { name: 'Retry save' })).toBeEnabled(); assert.equal((await timer()).event, oldTimer.event);
    await panel().getByRole('button', { name: 'Check saved results', exact: true }).click(); await expect(panel()).toContainText('Results are up to date. Retry save'); await expect(panel().getByRole('button', { name: 'Retry save' })).toBeEnabled();
    await page.reload(); await expect(panel().getByRole('button', { name: 'Retry save' })).toBeEnabled(); await new Promise(r => setTimeout(r, 1200));
    const request = page.waitForRequest(r => r.url().endsWith('/executions/results') && r.method() === 'POST'); await panel().getByRole('button', { name: 'Retry save' }).click(); assert.equal((await request).postData(), original);
    await expect(panel()).toContainText('5 of 9 sets recorded');
    await expect(panel().getByRole('button', { name: 'Retry save' })).toHaveCount(0);
    const committed = (await read()).history.find((r: any) => r.actionId === JSON.parse(original).actionId); assert.equal((await timer()).deadline, Date.parse(committed.recordedAt) + 120000);
    const replayDeadline = (await timer()).deadline;
    await fetch(base + '/api/trainer2/executions/results', { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: original });
    await page.reload(); assert.equal((await timer()).deadline, replayDeadline);
    assert.equal((await read()).history.filter((r: any) => r.actionId === committed.actionId).length, 1);
    passed.push('Held late response preserves selection/focus; 120s uses logged exercise; lost response/check/read/reload/exact retry; duplicate replay has one revision and original timer deadline');
    // Concurrent stale correction requires explicit latest review and preserves typed input.
    const tab = await context.newPage(); await tab.goto(url); await select(0, tab); await reps(tab).fill('4'); await panel(tab).getByLabel(/correction reason/).fill('Stale correction');
    await select(0); await reps().fill('5'); await panel().getByLabel(/correction reason/).fill('Concurrent correction'); await save(); await expect(panel()).toContainText('Saved v5');
    await save(tab); await expect(panel(tab).getByRole('button', { name: 'Review latest result' })).toBeVisible(); await expect(reps(tab)).toHaveValue('4');
    await panel(tab).getByRole('button', { name: 'Review latest result' }).click(); await panel(tab).getByRole('button', { name: 'Use this version for my correction' }).click(); await save(tab); await expect(panel(tab)).toContainText('Saved v6'); await expect(chips(tab).nth(0)).toHaveAttribute('aria-pressed', 'true'); await tab.close();
    await page.reload(); await select(5); await rir().fill(''); await save(); await expect(panel()).toContainText('Set 2 of 2'); await expect(load()).toHaveValue('0'); await expect(reps()).toHaveValue('6'); await expect(rir()).toHaveValue('');
    await save(); await expect(panel()).toContainText('Bodyweight control'); assert.equal(await load().count(), 0); await save(); await expect(panel()).toContainText('Added load control'); await expect(load()).toHaveValue('11.02'); await save(); await expect(panel()).toContainText('Ready to finish');
    const full = await read(); assert.equal(full.results.length, 9); assert.deepEqual(full.initial, initial.initial);
    assert(full.results.some((r: any) => r.result.measurement?.kind === 'bodyweight')); assert(full.results.some((r: any) => r.result.reps?.basis === 'alternating')); assert(full.results.some((r: any) => r.result.measurement?.kind === 'assistance' && r.result.measurement.value === '0' && r.result.rir === null));
    // Queue expansion is a DOM state, stable while changing selection and saving.
    const group = queue().locator('details').filter({ has: page.locator(':scope > summary', { hasText: 'Main lift' }) }).first();
    await group.locator(':scope > summary').click(); await expect(group).not.toHaveAttribute('open', ''); await page.reload();
    // Browser clock advances only for deterministic expiry; elapsed background time above used wall clock.
    await page.clock.install(); await page.clock.fastForward(240000); await expect(page.getByRole('complementary', { name: 'Rest timer' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Finish workout', exact: true }).click(); await page.getByRole('button', { name: 'Confirm finish', exact: true }).click(); await expect(page).toHaveURL(/drafts\?planId=/); assert.equal(await timer(), null);
    passed.push('Two-tab stale correction; assistance/per-side/unspecified RIR; bodyweight and added/alternating; immutable initial capture; deterministic expiry; complete finish clears rest and navigates home');
    await page.getByRole('button', { name: 'Start workout', exact: true }).click(); await expect(page).toHaveURL(/executions\//);
    await page.getByText('Workout menu', { exact: true }).click(); await page.getByRole('button', { name: 'Discard empty workout', exact: true }).click(); await page.getByRole('button', { name: 'Confirm discard', exact: true }).click(); await expect(page.getByText('Workout attempt discarded.', { exact: true })).toBeVisible();
    await page.goto(base + '/trainer2/dev/drafts?planId=' + planId); await page.getByRole('button', { name: 'Start workout', exact: true }).click(); await expect(page).toHaveURL(/executions\//); await save();
    await page.getByRole('button', { name: 'Finish workout', exact: true }).click(); await page.getByRole('button', { name: 'Finish with unrecorded sets', exact: true }).click(); await expect(page).toHaveURL(/drafts\?planId=/); await expect(page.getByRole('heading', { name: 'Plan complete', exact: true })).toBeVisible();
    passed.push('Secondary eligible discard and fresh start; acknowledged incomplete finish returns home without recording missing work');
    const kgPlan = randomUUID(), kgStage = randomUUID();
    await post('/api/trainer2/drafts/create', { commandType: 'CreateDraft', target: { planId: kgPlan }, expected: {}, intent: { schemaVersion: 1, name: 'SYNTHETIC kg provenance', endpoint: 'endOfOrderedOccurrences', progression: template.progression, stages: [{ id: kgStage, name: 'Week 1' }], occurrences: [{ id: randomUUID(), stageId: kgStage, name: 'Kilogram history', positions: [{ ...basic, id: randomUUID(), sourceKey: undefined, targets: [t(), t(), t()] }] }] } });
    ownedPlans.push(kgPlan); writeFileSync(plansFile, JSON.stringify(ownedPlans));
    const kgDraft = await get('/api/trainer2/drafts/' + kgPlan);
    await post('/api/trainer2/drafts/activate', { commandType: 'ActivatePlan', target: { planId: kgPlan }, expected: { planRevisionId: kgDraft.revisionId }, intent: { reviewed: kgDraft.activation } });
    await page.goto(base + '/trainer2/dev/drafts?planId=' + kgPlan); await page.getByRole('button', { name: 'Start workout', exact: true }).click(); await expect(page).toHaveURL(/executions\//);
    const kgId = page.url().split('/').at(-1)!, kgRead = () => get('/api/trainer2/executions/' + kgId), kgInitial = await kgRead();
    const kgMeasurement = { ...mass, value: '20.000000' };
    await post('/api/trainer2/executions/results', { commandType: 'RecordSetResult', target: { executionId: kgId, targetId: kgInitial.initial.positions[0].targets[0].id }, expected: { resultVersion: 0 }, intent: { result: { reps: { value: 8, basis: 'total' }, measurement: kgMeasurement, rir: '2' } } });
    await page.reload(); await select(0); await expect(load()).toHaveValue('44.09'); await save(); assert.equal((await kgRead()).history.length, 1);
    await reps().fill('9'); await panel().getByLabel(/correction reason/).fill('Rep-only kg correction'); await save(); await expect(panel()).toContainText('Saved v2');
    assert.deepEqual((await kgRead()).results[0].result.measurement, kgMeasurement); await page.reload(); await expect(load()).toHaveValue('44.09'); await save(); assert.equal((await kgRead()).history.length, 2);
    await expect(page.getByRole('complementary', { name: 'Rest timer' })).toHaveCount(0);
    await select(1); await expect(load()).toHaveValue('44.09'); await save(); await expect(panel()).toContainText('Set 3 of 3');
    await panel().getByText('History', { exact: true }).click(); await expect(panel()).toContainText('Previous ·'); await expect(panel()).toContainText('recorded');
    const mainGroup = queue().locator('details').first(); await mainGroup.locator(':scope > summary').click();
    await reps().fill('10'); await save(); await expect(panel()).toContainText('Ready to finish'); await expect(mainGroup).not.toHaveAttribute('open', '');
    await mainGroup.locator(':scope > summary').click(); const setDetails = mainGroup.locator('details').first(); await setDetails.locator(':scope > summary').click();
    await queue().getByRole('button', { name: /Barbell Back Squat/ }).first().click(); await expect(setDetails).not.toHaveAttribute('open', '');
    await page.setViewportSize({ width: 390, height: 500 }); await page.screenshot({ path: dir + 'keyboard-height-emulation.png', fullPage: true });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.getByRole('button', { name: 'Finish workout', exact: true }).click(); await page.getByRole('button', { name: 'Confirm finish', exact: true }).click(); await expect(page).toHaveURL(/drafts\?planId=/);
    passed.push('Actual persisted kg edit/no-op/reload has no drift; rep-only correction retains exact kg spelling; historical replay starts no timer; kg history remains visible after lb record; queue expansion persists through saves/selection; 390x500 keyboard-height emulation');
    assert.deepEqual(errors, []);
    writeFileSync(dir + 'browser.json', JSON.stringify({ source, sourceAfter: verificationSource(), passed, errors, browser: browser.version(), base, planId, executionId, initial, full, qualified: 'Desktop and viewport emulation; real PostgreSQL via isolated local HTTP runtime' }, null, 2));
    console.log(passed.join('\n'));
  } catch (error) { await page.screenshot({ path: dir + 'failure.png', fullPage: true }); writeFileSync(dir + 'failure.txt', await page.locator('body').innerText()); throw error; }
  finally { await browser.close(); }
}
void main().catch(e => { console.error(e); process.exitCode = 1; });
