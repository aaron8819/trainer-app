// Disposable browser/API/PostgreSQL reproduction of duplicate historical exercise occurrences.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { chromium, expect } from '@playwright/test';
import { createHypertrophyPlan } from '../../src/lib/engine/trainer2/plan-builder';
import { reviewedResults } from '../../src/lib/trainer2-contracts/workout-finish';
import { verificationSource } from '../../scripts/trainer2/verification-source';

async function main() {
  const [base, container, confirmation] = process.argv.slice(2);
  assert(confirmation === '--confirm-synthetic-trial' && /^http:\/\/127\.0\.0\.1:\d+$/.test(base) && /^trainer2-draft-[a-f0-9]+$/.test(container));
  const metadata = JSON.parse(execFileSync('docker', ['inspect', container], { encoding: 'utf8' }))[0];
  assert.equal(metadata.NetworkSettings.Ports['5432/tcp'][0].HostIp, '127.0.0.1');
  const database = metadata.Config.Env.find((item: string) => item.startsWith('POSTGRES_DB=')).slice('POSTGRES_DB='.length);
  assert(database.startsWith('trainer2_disposable_'));
  const source = verificationSource();
  const template = createHypertrophyPlan();
  const stageId = randomUUID();
  const position = template.occurrences[0].positions[0];
  const copy = () => ({ ...position, id: randomUUID(), sourceKey: undefined, targets: position.targets.slice(0, 1).map(target => ({ ...target, id: randomUUID(), measurement: null })) });
  const first = copy(), second = copy(), today = copy();
  const prescribed = { ...copy(), targets: position.targets.slice(0, 1).map(target => ({ ...target, id: randomUUID(), measurement: { kind: 'externalLoad' as const, value: '60', unit: 'kg' as const, convention: 'barbellTotal' as const, zeroMeaning: 'validZero' as const } })) };
  const occurrences = [
    { id: randomUUID(), stageId, name: 'Duplicate historical occurrences', positions: [first, second] },
    { id: randomUUID(), stageId, name: 'Current unique occurrence', positions: [today, prescribed] },
  ];
  const intent = { schemaVersion: 1, name: 'SYNTHETIC ambiguous prefill verification', endpoint: 'endOfOrderedOccurrences', progression: template.progression, stages: [{ id: stageId, name: 'Synthetic week' }], occurrences };
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage();
  const checks: string[] = [];
  try {
    await page.goto(base + '/trainer2/dev/drafts');
    await expect(page.getByRole('button', { name: 'Save plan', exact: true })).toBeEnabled();
    await page.route('**/api/trainer2/drafts/create', route => { const command = route.request().postDataJSON(); command.intent = intent; return route.continue({ postData: JSON.stringify(command) }); });
    const createdResponse = page.waitForResponse(response => response.url().endsWith('/drafts/create') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Save plan', exact: true }).click();
    const created = await createdResponse; assert.equal(created.status(), 200, await created.text());
    const planId = (await created.json()).outcome.result.planId;
    const accountId = created.request().postDataJSON().originatingAccountId;
    const envelope = () => ({ schemaVersion: 1, actionId: randomUUID(), deviceId: randomUUID(), originatingAccountId: accountId, ownershipEpoch: 0, dependsOn: [] });
    const get = async (path: string) => { const response = await fetch(base + path); assert(response.ok, await response.clone().text()); return response.json(); };
    const post = async (path: string, command: object) => { const response = await fetch(base + path, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...envelope(), ...command }) }); const body = await response.json(); assert.equal(response.status, 200, JSON.stringify(body)); return body.outcome.result; };
    const draft = await get('/api/trainer2/drafts/' + planId);
    await post('/api/trainer2/drafts/activate', { commandType: 'ActivatePlan', target: { planId }, expected: { planRevisionId: draft.revisionId }, intent: { reviewed: draft.activation } });
    let next = await get('/api/trainer2/plans/' + planId + '/next');
    const started = await post('/api/trainer2/executions/start', { commandType: 'StartOccurrence', target: { planId, occurrenceId: next.occurrence.id }, expected: { planRevisionId: next.revisionId, instructionEpoch: next.instructionEpoch }, intent: {} });
    const historic = await get('/api/trainer2/executions/' + started.executionId);
    for (const [index, value] of ['100', '200'].entries()) {
      const target = historic.initial.positions[index].targets[0];
      await post('/api/trainer2/executions/results', { commandType: 'RecordSetResult', target: { executionId: historic.executionId, targetId: target.id }, expected: { resultVersion: 0 }, intent: { result: { reps: { value: 8, basis: 'total' }, measurement: { kind: 'externalLoad', value, unit: 'lb', convention: 'barbellTotal', zeroMeaning: 'validZero' }, rir: '2' } } });
    }
    const beforeFinish = await get('/api/trainer2/executions/' + historic.executionId);
    await post('/api/trainer2/executions/finish', { commandType: 'FinishExecution', target: { executionId: historic.executionId }, expected: reviewedResults(beforeFinish), intent: { acknowledgeUnrecorded: false } });
    next = await get('/api/trainer2/plans/' + planId + '/next');
    const currentStart = await post('/api/trainer2/executions/start', { commandType: 'StartOccurrence', target: { planId, occurrenceId: next.occurrence.id }, expected: { planRevisionId: next.revisionId, instructionEpoch: next.instructionEpoch }, intent: {} });
    const current = await get('/api/trainer2/executions/' + currentStart.executionId);
    assert.deepEqual(current.firstSetLoads, []); assert.deepEqual(current.previous, []);
    checks.push('Two finished compatible occurrences with 100 and 200 lb produce empty prefill and empty display history');
    await page.goto(base + '/trainer2/dev/executions/' + current.executionId);
    const panel = page.getByRole('region', { name: 'Active set', exact: true });
    await expect(panel.getByLabel(/Actual load$/)).toHaveValue('');
    await panel.getByText('History', { exact: true }).click();
    await expect(page.getByText('No previous exercise results.')).toBeVisible();
    const chips = page.getByRole('region', { name: 'Exercise queue' }).getByRole('button', { name: /, set \d+,/ });
    await chips.nth(1).click();
    await expect(panel.getByLabel(/Actual load$/)).toHaveValue('130');
    checks.push('Real browser form remains blank and adjacent history reports no previous exercise results; explicit 60 kg prescription still suggests 130 lb');
    const sql = execFileSync('docker', ['exec', container, 'psql', '-U', 'postgres', '-d', database, '-Atc', `SELECT count(*) FROM "Trainer2SetResultRevision" WHERE "executionId"='${historic.executionId}'`], { encoding: 'utf8' }).trim();
    assert.equal(sql, '2'); checks.push('PostgreSQL contains two historical result revisions');
    const directory = 'artifacts/review/prefill-history-evidence/'; mkdirSync(directory, { recursive: true });
    const after = verificationSource(); assert.equal(after.manifestHash, source.manifestHash);
    writeFileSync(directory + 'browser-ambiguity.json', JSON.stringify({ at: new Date().toISOString(), source, after, base, container, database, historicId: historic.executionId, currentId: current.executionId, checks }, null, 2));
    console.log(checks.join('\n'));
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
