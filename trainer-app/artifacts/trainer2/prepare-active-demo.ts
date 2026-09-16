// Demo-only preparation. Run once against a fresh, separately launched trial demo.
// Uses the existing UI and HTTP commands; never connects to a database.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { chromium, expect } from '@playwright/test';
import { reviewedResults } from '../../src/lib/trainer2-contracts/workout-finish';
import { validateExecutionRead, nextWorkoutRead } from '../../src/lib/trainer2-contracts/execution';

async function main() {
  const [base, confirmation] = process.argv.slice(2);
  assert(confirmation === '--confirm-synthetic-trial' && process.argv.length === 4);
  assert(/^http:\/\/127\.0\.0\.1:\d+$/.test(base), 'Use the new trial launcher loopback origin');
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1360, height: 1000 } });
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  try {
    await page.goto(`${base}/trainer2/dev/drafts`);
    await expect(page.getByLabel('Plan name', { exact: true })).toBeEnabled();
    await page.getByLabel('Plan name', { exact: true }).fill('SYNTHETIC active-set UI — five-week hypertrophy');
    const saving = page.waitForResponse(r => r.url().endsWith('/api/trainer2/drafts/create') && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Save plan', exact: true }).click();
    const created = await saving;
    assert.equal(created.status(), 200);
    const submitted = created.request().postDataJSON();
    const result = await created.json();
    assert.equal(result.outcome.status, 'Accepted');
    const planId = result.outcome.result.planId;
    const envelope = () => ({ schemaVersion: 1, actionId: randomUUID(), originatingAccountId: submitted.originatingAccountId,
      deviceId: submitted.deviceId, ownershipEpoch: submitted.ownershipEpoch, dependsOn: [] });
    const get = async (path: string) => {
      const response = await fetch(base + path, { redirect: 'error' });
      assert.equal(response.status, 200, path); return response.json();
    };
    const post = async (path: string, command: object) => {
      const response = await fetch(base + path, { method: 'POST', redirect: 'error',
        headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify({ ...envelope(), ...command }) });
      const body = await response.json();
      assert.equal(response.status, 200, JSON.stringify(body));
      assert.equal(body.outcome.status, 'Accepted'); return body.outcome.result;
    };
    const draft = await get(`/api/trainer2/drafts/${planId}`);
    assert.equal(draft.intent.stages.length, 5);
    assert.equal(draft.intent.occurrences.length, 20);
    assert.deepEqual(draft.intent.occurrences.slice(0, 4).map((o: { name: string }) => o.name), ['Lower A', 'Upper A', 'Lower B', 'Upper B']);
    assert.deepEqual(draft.activationBlockers, []);
    await post('/api/trainer2/drafts/activate', { commandType: 'ActivatePlan', target: { planId },
      expected: { planRevisionId: draft.revisionId }, intent: { reviewed: draft.activation } });
    // Kilograms, interpreted according to each existing catalog exercise's convention.
    const loads = [[70, 60, 35, 45, 25], [50, 20, 40, 7.5, 25, 10], [120, 12.5, 30, 35, 30], [20, 40, 15, 40, 25, 20, 20]];
    const completed = [];
    for (let workout = 0; workout < 4; workout++) {
      const next = nextWorkoutRead.parse(await get(`/api/trainer2/plans/${planId}/next`));
      assert.equal(next.occurrence?.id, draft.intent.occurrences[workout].id);
      assert.equal(next.execution, null);
      const started = await post('/api/trainer2/executions/start', { commandType: 'StartOccurrence',
        target: { planId, occurrenceId: next.occurrence!.id }, expected: { planRevisionId: next.revisionId, instructionEpoch: next.instructionEpoch }, intent: {} });
      const read = async () => validateExecutionRead(await get(`/api/trainer2/executions/${started.executionId}`), submitted.originatingAccountId);
      let execution = await read();
      for (const [i, position] of execution.initial.positions.entries()) {
        const source = execution.initial.occurrence.positions[i];
        assert.equal(source.exercise.kind, 'catalogSnapshot');
        if (source.exercise.kind !== 'catalogSnapshot') throw new Error('Expected catalog');
        for (const [j, target] of position.targets.entries()) {
          const prescription = source.targets[j];
          const weight = loads[workout][i] + (i === 0 && j === 1 ? 2.5 : 0);
          const measurement = source.exercise.loadKind === 'bodyweight' ? { kind: 'bodyweight', convention: 'bodyweightOnly' } : {
            kind: source.exercise.loadKind, value: weight.toFixed(2), unit: 'kg', convention: source.exercise.convention,
            zeroMeaning: source.exercise.loadKind === 'externalLoad' ? 'validZero' : source.exercise.loadKind === 'addedLoad' ? 'noAddedLoad' : 'noAssistance' };
          await post('/api/trainer2/executions/results', { commandType: 'RecordSetResult',
            target: { executionId: execution.executionId, targetId: target.id }, expected: { resultVersion: 0 },
            intent: { result: { reps: { value: Math.max(prescription.reps.min, prescription.reps.max - j - 1), basis: prescription.reps.basis }, measurement, rir: String(3 - Math.min(j, 2)) } } });
        }
      }
      execution = await read();
      await post('/api/trainer2/executions/finish', { commandType: 'FinishExecution', target: { executionId: execution.executionId },
        expected: reviewedResults(execution), intent: { acknowledgeUnrecorded: false } });
      execution = await read();
      if (workout === 0) {
        const first = execution.results.find(r => r.targetId === execution.initial.positions[0].targets[0].id)!;
        await post('/api/trainer2/executions/corrections', { commandType: 'CorrectHistoricalSetResult',
          target: { executionId: execution.executionId, targetId: first.targetId },
          expected: { resultVersion: first.version, performedSetId: first.performedSetId },
          intent: { result: { ...first.result, reps: { ...first.result!.reps, value: 8 } }, reason: 'Correct recorded result' } });
        execution = await read();
        assert.equal(execution.history!.length, execution.results.length + 1);
        assert.equal(execution.results.find(r => r.targetId === first.targetId)!.version, 2);
      }
      assert.equal(execution.lifecycle, 'Finished');
      assert.equal(execution.finish!.unknownTargetIds.length, 0);
      completed.push(execution);
      console.log(`Prepared Week 1 ${execution.initial.occurrence.name}: ${execution.results.length} recorded sets`);
    }
    const nextPath = `/api/trainer2/plans/${planId}/next`;
    const before = nextWorkoutRead.parse(await get(nextPath));
    assert.equal(before.occurrence!.id, draft.intent.occurrences[4].id);
    assert.equal(before.occurrence!.name, 'Lower A');
    assert.equal(before.execution, null);
    assert.deepEqual(before.occurrences.slice(0, 4).map(o => o.status), ['Finished', 'Finished', 'Finished', 'Finished']);
    const url = `${base}/trainer2/dev/drafts?planId=${planId}`;
    await page.goto(url);
    await expect(page.getByRole('button', { name: 'Start workout', exact: true })).toBeEnabled();
    await page.reload();
    await expect(page.getByRole('button', { name: 'Start workout', exact: true })).toBeEnabled();
    assert.deepEqual(await get(nextPath), before);
    for (const execution of completed) assert.deepEqual(await get(`/api/trainer2/executions/${execution.executionId}`), execution);
    assert.equal(await page.locator('[data-nextjs-dialog]').count(), 0);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: 'artifacts/trainer2/active-set-evidence/demo-demo-ready.png', fullPage: true });
    writeFileSync('artifacts/trainer2/active-set-evidence/demo-demo-page.txt', await page.locator('body').innerText());
    writeFileSync('artifacts/trainer2/active-set-evidence/demo-demo-ready.json', JSON.stringify({ preparedAt: new Date().toISOString(), url, planId,
      browser: browser.version(), errors, next: before, completed }, null, 2));
    console.log(`VERIFIED TRIAL: ${url}`);
  } finally { await browser.close(); }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
