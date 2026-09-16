import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { reviewedResults } from '../../src/lib/trainer2-contracts/workout-finish';

async function main() {
  const [base, confirmation] = process.argv.slice(2);
  const ready = JSON.parse(readFileSync('artifacts/trainer2/training-ui-evidence/demo-ready.json', 'utf8'));
  assert(confirmation === '--confirm-synthetic-trial' && /^http:\/\/127\.0\.0\.1:\d+$/.test(base) && new URL(ready.url).origin === base);
  const get = async (path: string) => { const r = await fetch(base + path); assert(r.ok); return r.json(); };
  const post = async (path: string, data: object) => {
    const r = await fetch(base + path, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({ schemaVersion: 1, actionId: randomUUID(), deviceId: randomUUID(), originatingAccountId: ready.next.accountId, ownershipEpoch: 0, dependsOn: [], ...data }) });
    assert.equal(r.status, 200, JSON.stringify(await r.json()));
  };
  let next = await get(`/api/trainer2/plans/${ready.planId}/next`);
  if (next.execution) await post('/api/trainer2/executions/finish', { commandType: 'FinishExecution', target: { executionId: next.execution.executionId }, expected: reviewedResults(next.execution), intent: { acknowledgeUnrecorded: true } });
  for (;;) {
    next = await get(`/api/trainer2/plans/${ready.planId}/next`); if (!next.occurrence) break;
    await post('/api/trainer2/occurrences/skip', { commandType: 'SkipOccurrence', target: { planId: ready.planId, occurrenceId: next.occurrence.id }, expected: { planRevisionId: next.revisionId, acceptedSequence: next.acceptedSequence }, intent: {} });
  }
  console.log('Resolved synthetic test plan through supported commands', ready.planId);
}
void main().catch(e => { console.error(e); process.exitCode = 1; });
