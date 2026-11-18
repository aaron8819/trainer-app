import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { Pool } from 'pg';
import { createDraft, readDraft } from '../../src/lib/api/trainer2/planning';
import { activatePlan } from '../../src/lib/api/trainer2/activation';
import { readNextWorkout, readExecution, startOccurrence } from '../../src/lib/api/trainer2/execution';
import { finishExecution } from '../../src/lib/api/trainer2/workout-finish';
import { advanceWeek } from '../../src/lib/api/trainer2/advance-week';
import { skipOccurrence } from '../../src/lib/api/trainer2/skip-occurrence';
import { discardEmptyExecution } from '../../src/lib/api/trainer2/discard-execution';
import { amendPendingExercise, previewPendingExerciseAmendment } from '../../src/lib/api/trainer2/plan-exercise-amendment';
import { acceptCommand } from '../../src/lib/api/trainer2/command';
import { reviewedResults } from '../../src/lib/trainer2-contracts/workout-finish';
import { canonicalJson, integrityHash } from '../../src/lib/api/trainer2/integrity';
import { catalog, catalogExercise } from '../../src/lib/engine/trainer2/catalog';
import type { AmendPendingExerciseCommand, AmendmentContent } from '../../src/lib/trainer2-contracts/plan-exercise-amendment';
import type { ServerPrincipal } from '../../src/lib/api/trainer2/principal';

/** Only call in the existing disposable PostgreSQL 17 fixture after its forward upgrade.
 * Completes any remaining synthetic active plan, completes the behavioral fixture, then returns a separate active browser fixture. */
export async function verifyPlanAmendments({ db, reader, admin, principal, pass }: {
  db: PrismaClient; reader: PrismaClient; admin: Pool; principal: ServerPrincipal; pass: (message: string) => void;
}) {
  const envelope = () => ({ schemaVersion: 1 as const, actionId: randomUUID(), deviceId: randomUUID(),
    originatingAccountId: principal.accountId, ownershipEpoch: 0, dependsOn: [] });
  const accepted = (r: { outcome: { status: string } }) => assert.equal(r.outcome.status, 'Accepted');
  const read = async (id: string) => { const x = await readExecution(reader, principal, id); assert(x); return x; };
  const close = async (id: string) => accepted(await finishExecution(db, principal, { ...envelope(), commandType: 'FinishExecution',
    target: { executionId: id }, expected: reviewedResults(await read(id)), intent: { acknowledgeUnrecorded: true } }));
  const complete = async (id: string) => {
    for (let i = 0; i < 1000; i++) {
      const n = await readNextWorkout(reader, principal, id);
      if (n.lifecycle === 'Completed') return;
      if (n.execution) { await close(n.execution.executionId); continue; }
      if (n.occurrence) {
        const r = await startOccurrence(db, principal, { ...envelope(), commandType: 'StartOccurrence', target: { planId: id, occurrenceId: n.occurrence.id },
          expected: { planRevisionId: n.revisionId, instructionEpoch: n.instructionEpoch, amendmentVersion: n.amendment?.version ?? 0 }, intent: {} });
        accepted(r); assert(r.outcome.status === 'Accepted'); await close(r.outcome.result.executionId);
      } else accepted(await advanceWeek(db, principal, { ...envelope(), commandType: 'AdvanceWeek', target: { planId: id },
        expected: { planRevisionId: n.revisionId, acceptedSequence: n.acceptedSequence, weekIndex: n.week.index, firstOccurrenceId: n.week.firstOccurrenceId }, intent: {} }));
    }
    throw new Error('Amendment fixture failed to complete');
  };
  const existing = await reader.trainer2Plan.findFirst({ where: { accountId: principal.accountId, lifecycle: 'Active' } });
  if (existing) await complete(existing.id);
  const planId = randomUUID(), stageId = randomUUID();
  const intent = { schemaVersion: 1 as const, name: 'Synthetic future exercise amendments', endpoint: 'endOfOrderedOccurrences' as const,
    progression: { version: 1 as const, mode: 'plannedPrescriptions' as const, scope: 'wholePlan' as const, parameters: {} },
    stages: [{ id: stageId, name: 'Trial' }], occurrences: Array.from({ length: 9 }, (_, i) => ({ id: randomUUID(), stageId, name: `Amendment ${i + 1}`,
      positions: [{ id: randomUUID(), role: 'Main lift' as const, exercise: catalogExercise(catalog.find(e => e.id === 't2:bodyweight-45-degree-back-extension')!),
        targets: [{ id: randomUUID(), classification: 'working' as const, required: true, reps: { min: 8, max: 12, basis: 'total' as const },
          measurement: { kind: 'bodyweight' as const, convention: 'bodyweightOnly' as const }, rir: '2', restSeconds: '90' }] }] })) };
  accepted(await createDraft(db, principal, { ...envelope(), commandType: 'CreateDraft', target: { planId }, expected: {}, intent }));
  const plan = (await readDraft(reader, principal, planId))!;
  accepted(await activatePlan(db, principal, { ...envelope(), commandType: 'ActivatePlan', target: { planId }, expected: { planRevisionId: plan.revisionId }, intent: { reviewed: plan.activation } }));
  const originalRevision = await admin.query('SELECT * FROM "Trainer2PlanRevision" WHERE "id"=$1', [plan.revisionId]);
  const position = (i: number) => ({ occurrenceId: intent.occurrences[i].id, positionId: intent.occurrences[i].positions[0].id });
  const preview = (indices: number[]) => reader.$transaction(tx => previewPendingExerciseAmendment(tx, principal, {
    planId, intent: { positions: indices.map(position), catalogId: 't2:45-degree-back-extension' } }));
  const command = async (indices: number[]): Promise<AmendPendingExerciseCommand> => ({ ...envelope(), commandType: 'AmendPendingExercise', target: { planId },
    expected: (await preview(indices)).expected, intent: { positions: indices.map(position), catalogId: 't2:45-degree-back-extension' } });
  const startCommand = (i: number, amendmentVersion: number) => ({ ...envelope(), commandType: 'StartOccurrence', target: { planId, occurrenceId: intent.occurrences[i].id },
    expected: { planRevisionId: plan.revisionId, instructionEpoch: plan.activation.instructions.epoch, amendmentVersion }, intent: {} });
  const start = async (i: number, version: number) => { const r = await startOccurrence(db, principal, startCommand(i, version)); accepted(r); assert(r.outcome.status === 'Accepted'); return read(r.outcome.result.executionId); };
  const rows = async () => (await admin.query('SELECT * FROM "Trainer2PlanExerciseAmendment" WHERE "planId"=$1 ORDER BY "version"', [planId])).rows;
  const old = await start(0, 0), oldSnapshot = canonicalJson(old.initial); await close(old.executionId);
  const beforePreview = (await admin.query('SELECT count(*) AS n FROM "Trainer2DurableAction"')).rows;
  await preview([1, 2]); assert.deepEqual((await admin.query('SELECT count(*) AS n FROM "Trainer2DurableAction"')).rows, beforePreview);
  const invalid = await command([1]); invalid.intent.positions.push(position(0));
  assert.notEqual((await amendPendingExercise(db, principal, invalid)).outcome.status, 'Accepted'); assert.equal((await rows()).length, 0);
  const saved = await command([1, 2]); accepted(await amendPendingExercise(db, principal, saved));
  assert.equal((await amendPendingExercise(db, principal, saved)).replayed, true);
  await assert.rejects(() => amendPendingExercise(db, principal, { ...saved, intent: { ...saved.intent, positions: [position(1)] } }), /ACTION_ID_COLLISION/);
  assert.equal((await rows()).length, 1);
  assert.deepEqual((await admin.query('SELECT * FROM "Trainer2PlanRevision" WHERE "id"=$1', [plan.revisionId])).rows, originalRevision.rows);
  assert.equal(canonicalJson((await read(old.executionId)).initial), oldSnapshot);
  const next = await readNextWorkout(reader, principal, planId);
  assert.equal(next.effectiveOccurrences.find(o => o.id === position(1).occurrenceId)!.positions[0].exercise.name, '45-Degree Back Extension');
  assert.equal(next.effectiveOccurrences.find(o => o.id === position(3).occurrenceId)!.positions[0].exercise.name, 'Bodyweight 45-Degree Back Extension');
  assert.notEqual((await startOccurrence(db, principal, startCommand(1, 0))).outcome.status, 'Accepted');
  const changed = await start(1, 1); assert.equal(changed.initial.amendment?.actionId, saved.actionId);
  assert.equal(changed.initial.occurrence.positions[0].exercise.name, '45-Degree Back Extension');
  assert.equal(changed.initial.occurrence.positions[0].targets[0].measurement, null); await close(changed.executionId);
  pass('Prospective amendment preview, atomic selection, exact replay/collision, stale START and immutable accepted/history snapshots');

  // Queue both commands behind the same account lock, guaranteeing each order independently.
  async function race(first: () => Promise<{ outcome: { status: string } }>, second: () => Promise<{ outcome: { status: string } }>) {
    const lock = await admin.connect(); await lock.query('BEGIN');
    await lock.query('SELECT "accountId" FROM "Trainer2AccountTrainingState" WHERE "accountId"=$1 FOR UPDATE', [principal.accountId]);
    const wait = async (n: number) => { for (let i = 0; i < 200; i++) {
      const r = await admin.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'");
      if (r.rows[0].n >= n) return; await new Promise(resolve => setTimeout(resolve, 20));
    } throw new Error('Amendment race did not block behind account lock'); };
    let a: ReturnType<typeof first> | undefined, b: ReturnType<typeof second> | undefined;
    try { a = first(); await wait(1); b = second(); await wait(2); await lock.query('COMMIT'); return await Promise.all([a, b]); }
    finally { await lock.query('ROLLBACK'); lock.release(); await Promise.allSettled([a, b].filter(Boolean)); }
  }
  const firstAmend = await command([3]);
  const r1 = await race(() => amendPendingExercise(db, principal, firstAmend), () => startOccurrence(db, principal, startCommand(3, 1)));
  assert.equal(r1[0].outcome.status, 'Accepted'); assert.notEqual(r1[1].outcome.status, 'Accepted');
  const amended = await start(3, 2); await close(amended.executionId);
  const secondAmend = await command([4]); const startFirst = startCommand(4, 2);
  const r2 = await race(() => startOccurrence(db, principal, startFirst), () => amendPendingExercise(db, principal, secondAmend));
  assert.equal(r2[0].outcome.status, 'Accepted'); assert.notEqual(r2[1].outcome.status, 'Accepted');
  const open = (await readNextWorkout(reader, principal, planId)).execution!;
  assert.equal(open.initial.occurrence.positions[0].exercise.name, 'Bodyweight 45-Degree Back Extension');
  accepted(await discardEmptyExecution(db, principal, { ...envelope(), commandType: 'DiscardEmptyExecution', target: { executionId: open.executionId, occurrenceId: open.initial.occurrence.id }, expected: reviewedResults(open), intent: {} }));
  await assert.rejects(() => preview([4]), /POSITION_NOT_PENDING/);
  const skipRead = await readNextWorkout(reader, principal, planId);
  accepted(await skipOccurrence(db, principal, { ...envelope(), commandType: 'SkipOccurrence', target: { planId, occurrenceId: position(5).occurrenceId },
    expected: { planRevisionId: plan.revisionId, acceptedSequence: skipRead.acceptedSequence }, intent: {} }));
  await assert.rejects(() => preview([5]), /POSITION_NOT_PENDING/);
  pass('Account-locked START/amendment race in both orders; discarded and skipped occurrences remain ineligible');

  const rawCommand = await command([6]), rawPreview = await preview([6]);
  const rawInsert = async (content: AmendmentContent, commandOverride = rawCommand, omitOutcome = false) => {
    const canonical = canonicalJson(content), hash = integrityHash(canonical);
    const raw = { ...commandOverride, actionId: randomUUID(), expected: { ...commandOverride.expected, effectiveHash: hash } };
    if (omitOutcome) return db.$transaction(async tx => {
      // No DurableAction or accepted seal can be bypassed with a standalone row.
      await tx.$executeRaw`INSERT INTO "Trainer2PlanExerciseAmendment" ("accountId","planId","revisionId","actionId","version","instructionEpoch","contentHash","canonicalContent","content") VALUES (${principal.accountId},${planId}::uuid,${plan.revisionId}::uuid,${raw.actionId}::uuid,3,${raw.expected.instructionEpoch},${hash},${canonical},${JSON.stringify(content)}::jsonb)`;
    });
    return acceptCommand(db, principal, raw, raw, async tx => {
      await tx.$executeRaw`INSERT INTO "Trainer2PlanExerciseAmendment" ("accountId","planId","revisionId","actionId","version","instructionEpoch","contentHash","canonicalContent","content") VALUES (${principal.accountId},${planId}::uuid,${plan.revisionId}::uuid,${raw.actionId}::uuid,3,${raw.expected.instructionEpoch},${hash},${canonical},${JSON.stringify(content)}::jsonb)`;
      return { planId, version: 3, contentHash: hash };
    });
  };
  const forged = structuredClone(rawPreview.content); forged.replacements[0].exercise.name = 'Forged exercise';
  await assert.rejects(() => rawInsert(forged));
  const forgedTarget = structuredClone(rawPreview.content); forgedTarget.replacements[0].targets[0].reps.min = 99;
  await assert.rejects(() => rawInsert(forgedTarget));
  const startedContent = structuredClone(rawPreview.content); Object.assign(startedContent.replacements[0], position(0));
  startedContent.replacements[0].targets = intent.occurrences[0].positions[0].targets.map(t => ({ ...t, measurement: null }));
  await assert.rejects(() => rawInsert(startedContent, { ...rawCommand, intent: { ...rawCommand.intent, positions: [position(0)] } }));
  await assert.rejects(() => rawInsert(rawPreview.content, rawCommand, true));
  assert.equal((await rows()).length, 2);
  await assert.rejects(() => db.$executeRaw`UPDATE "Trainer2PlanExerciseAmendment" SET "version"=99 WHERE "planId"=${planId}::uuid`);
  await assert.rejects(() => reader.$executeRaw`DELETE FROM "Trainer2PlanExerciseAmendment" WHERE "planId"=${planId}::uuid`);
  const providerProbe = await admin.connect();
  try {
    await providerProbe.query('BEGIN');
    for (const role of ['anon', 'authenticated', 'service_role']) {
      if (!(await providerProbe.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [role])).rowCount) await providerProbe.query(`CREATE ROLE ${role} NOLOGIN`);
      const privileges = await providerProbe.query(`SELECT has_table_privilege($1,'"Trainer2PlanExerciseAmendment"','SELECT,INSERT,UPDATE,DELETE') AS allowed`, [role]);
      assert.equal(privileges.rows[0].allowed, false);
    }
  } finally { await providerProbe.query('ROLLBACK'); providerProbe.release(); }
  accepted(await amendPendingExercise(db, principal, rawCommand));
  const cumulative = await readNextWorkout(reader, principal, planId);
  for (const i of [2, 6]) assert.equal(cumulative.effectiveOccurrences.find(o => o.id === position(i).occurrenceId)!.positions[0].exercise.name, '45-Degree Back Extension');
  // A syntactically valid START cannot omit or forge the accepted overlay provenance.
  const rawStart = startCommand(8, 3), executionId = randomUUID(), startedAt = new Date();
  const initial = { ...old.initial, executionId, startedAt: startedAt.toISOString(), occurrence: intent.occurrences[8],
    positions: [{ id: randomUUID(), sourcePositionId: position(8).positionId,
      targets: intent.occurrences[8].positions[0].targets.map(t => ({ id: randomUUID(), sourceTargetId: t.id })) }] };
  const canonicalStart = canonicalJson(initial), startHash = integrityHash(canonicalStart);
  await assert.rejects(() => acceptCommand(db, principal, rawStart, rawStart, async tx => {
    await tx.$executeRaw`INSERT INTO "Trainer2Execution" ("id","accountId","planId","revisionId","occurrenceId","actionId","lifecycle","startedAt","initialPrescription","canonicalContent","contentHash")
      VALUES (${executionId}::uuid,${principal.accountId},${planId}::uuid,${plan.revisionId}::uuid,${position(8).occurrenceId}::uuid,${rawStart.actionId}::uuid,'Open',${startedAt},${JSON.stringify(initial)}::jsonb,${canonicalStart},${startHash})`;
    return { executionId, planId, revisionId: plan.revisionId, occurrenceId: position(8).occurrenceId, contentHash: startHash };
  }));
  await complete(planId);
  assert.equal(canonicalJson((await read(old.executionId)).initial), oldSnapshot);
  pass('Raw SQL forged catalog/targets/started source/missing action and START provenance denied; immutable rows and restricted roles; cumulative lifecycle completes');
  // Leave a minimal clean fixture for the separate browser acceptance owner.
  const browserPlanId = randomUUID(), browserStageId = randomUUID();
  const browserIntent = { ...intent, name: 'Future exercise browser trial', stages: [{ id: browserStageId, name: 'Week one' }],
    occurrences: intent.occurrences.slice(0, 2).map((o, i) => ({ ...o, id: randomUUID(), stageId: browserStageId, name: `Back extension ${i + 1}`,
      positions: o.positions.map(p => ({ ...p, id: randomUUID(), targets: p.targets.map(t => ({ ...t, id: randomUUID() })) })) })) };
  accepted(await createDraft(db, principal, { ...envelope(), commandType: 'CreateDraft', target: { planId: browserPlanId }, expected: {}, intent: browserIntent }));
  const browserHead = (await readDraft(reader, principal, browserPlanId))!;
  accepted(await activatePlan(db, principal, { ...envelope(), commandType: 'ActivatePlan', target: { planId: browserPlanId },
    expected: { planRevisionId: browserHead.revisionId }, intent: { reviewed: browserHead.activation } }));
  const browserStart = await startOccurrence(db, principal, { ...envelope(), commandType: 'StartOccurrence', target: { planId: browserPlanId, occurrenceId: browserIntent.occurrences[0].id },
    expected: { planRevisionId: browserHead.revisionId, instructionEpoch: browserHead.activation.instructions.epoch }, intent: {} });
  accepted(browserStart); assert(browserStart.outcome.status === 'Accepted'); await close(browserStart.outcome.result.executionId);
  return { planId: browserPlanId, originalRevisionId: browserHead.revisionId, completedExecutionId: browserStart.outcome.result.executionId,
    pendingOccurrenceId: browserIntent.occurrences[1].id };
}
