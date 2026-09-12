import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createDraft, editDraft, readDraft, type ServerPrincipal } from '../../src/lib/api/trainer2/planning';
import type { CreateDraftCommand, DraftDocument } from '../../src/lib/trainer2-contracts/draft';
import { createHypertrophyPlan, expandWorkoutDefaults, markOverride, resetField, restoreWeek } from '../../src/lib/engine/trainer2/plan-builder';
import { draftEdits } from '../../src/components/trainer2/draft-edits';

export async function verifyTemplatePersistence(db: Parameters<typeof createDraft>[0], principal: ServerPrincipal) {
  const command: CreateDraftCommand = { schemaVersion: 1, commandType: 'CreateDraft', actionId: randomUUID(), originatingAccountId: principal.accountId,
    deviceId: randomUUID(), ownershipEpoch: 0, dependsOn: [], target: { planId: randomUUID() }, expected: {}, intent: createHypertrophyPlan() };
  assert.equal((await createDraft(db, principal, command)).outcome.status, 'Accepted');
  let saved = (await readDraft(db, principal, command.target.planId))!;
  async function save(doc: DraftDocument) {
    const edit = { ...command, actionId: randomUUID(), commandType: 'EditDraft' as const, expected: { planRevisionId: saved.revisionId }, intent: { operations: draftEdits(saved.intent, doc) } };
    const response = await editDraft(db, principal, edit);
    assert.equal(response.outcome.status, 'Accepted');
    assert.equal((await editDraft(db, principal, edit)).replayed, true);
    saved = (await readDraft(db, principal, command.target.planId))!;
    assert.deepEqual(saved.intent, doc);
  }
  let d = structuredClone(saved.intent), o = d.occurrences[8], p = o.positions[0];
  markOverride(o, p.id, ['reps']); // Explicitly equal to defaults.
  o.overrides!.targets = { [p.targets[1].id]: ['restSeconds'] };
  p.targets[1].restSeconds = '123.00';
  const removed = o.positions[1]; o.overrides!.removed.push(removed.sourceKey!); o.positions.splice(1, 1);
  const duplicate = structuredClone(p); duplicate.id = randomUUID(); delete duplicate.sourceKey;
  duplicate.targets.forEach(t => { t.id = randomUUID(); }); o.positions.push(duplicate);
  o.overrides!.order = true; o.positions.reverse();
  await save(expandWorkoutDefaults(d));
  d = structuredClone(saved.intent);
  d.builder!.workouts[0].rows[0].prescription.reps.min = 7;
  d.builder!.workouts[0].rows[0].prescription.restSeconds = '90';
  d.builder!.workouts[0].rows.reverse();
  await save(expandWorkoutDefaults(d));
  o = saved.intent.occurrences[8]; p = o.positions.find(position => position.id === p.id)!;
  assert.equal(p.targets[0].reps.min, 6);
  assert.equal(p.targets[0].restSeconds, '90');
  assert.equal(p.targets[1].restSeconds, '123.00');
  assert(o.positions.some(position => position.id === duplicate.id));
  assert(!o.positions.some(position => position.id === removed.id));
  await save(resetField(saved.intent, o.id, p.id, 'reps'));
  assert.equal(saved.intent.occurrences[8].positions.find(position => position.id === p.id)!.targets[0].reps.min, 7);
  await save(restoreWeek(saved.intent, o.id));
  assert(!saved.intent.occurrences[8].positions.some(position => position.id === duplicate.id));
  assert.notEqual(saved.intent.occurrences[8].positions.find(position => position.sourceKey === removed.sourceKey)!.id, removed.id);
  // Old authored descriptions are preserved by the same database boundary.
  const legacy = { ...command, actionId: randomUUID(), target: { planId: randomUUID() }, intent: createHypertrophyPlan(undefined, true) };
  delete legacy.intent.builder!.starterVersion;
  legacy.intent.occurrences[0].weekOverride = true;
  legacy.intent.occurrences[0].positions = [{ id: randomUUID(), exercise: { kind: 'authoredDescription', name: 'Squat', variation: 'Original description' }, targets: [] }];
  assert.equal((await createDraft(db, principal, legacy)).outcome.status, 'Accepted');
  assert.deepEqual((await readDraft(db, principal, legacy.target.planId))!.intent, legacy.intent);
}
