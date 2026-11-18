import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { Pool } from 'pg';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { createDraft, readDraft } from '../../src/lib/api/trainer2/planning';
import { activatePlan } from '../../src/lib/api/trainer2/activation';
import { acceptCommand } from '../../src/lib/api/trainer2/command';
import { readInstructions } from '../../src/lib/api/trainer2/instructions';
import { readExecution, readNextWorkout } from '../../src/lib/api/trainer2/execution';
import { saveSetResult } from '../../src/lib/api/trainer2/set-results';
import { initialPrescription, START_POLICY } from '../../src/lib/trainer2-contracts/execution';
import { catalog, catalogExercise } from '../../src/lib/engine/trainer2/catalog';
import { currentAssignment } from '../../src/lib/engine/trainer2/exercise-swap';
import { canonicalJson, integrityHash } from '../../src/lib/api/trainer2/integrity';

/** Separate database owned by an already-authorized disposable runner; never reads real env URLs. */
export async function verifyAmendmentUpgrade({ admin, pass }: { admin: Pool; pass: (message: string) => void }) {
  const source = new URL(String(admin.options.connectionString ?? ''));
  assert.equal(source.protocol, 'postgresql:');
  assert(['127.0.0.1', 'localhost', '[::1]'].includes(source.hostname), 'Disposable loopback target required');
  assert(/^\/trainer2_disposable_[a-z0-9_]+$/.test(source.pathname), 'Disposable source database required');
  const sourceIdentity = (await admin.query('SELECT current_database() AS db,current_user AS role')).rows[0];
  assert.equal('/' + sourceIdentity.db, source.pathname); assert.equal(sourceIdentity.role, 'postgres');
  const name = 'trainer2_disposable_amendment_upgrade_' + randomUUID().replaceAll('-', '').slice(0, 12);
  assert(/^trainer2_disposable_amendment_upgrade_[a-f0-9]{12}$/.test(name));
  const target = new URL(source); target.pathname = '/' + name;
  const migration = '20261118010000_trainer2_pending_exercise_amendment';
  let created = false, pool: Pool | undefined, db: PrismaClient | undefined;
  const priorOwner = process.env.TRAINER2_OWNER_USER_ID;
  try {
    await admin.query(`CREATE DATABASE "${name}"`); created = true;
    pool = new Pool({ connectionString: target.toString(), max: 3 });
    assert.equal((await pool.query('SELECT current_database() AS db')).rows[0].db, name);
    for (const entry of readdirSync('prisma/migrations').filter(n => n < migration && n !== 'migration_lock.toml').sort())
      await pool.query(readFileSync(`prisma/migrations/${entry}/migration.sql`, 'utf8'));
    const grants = readFileSync('prisma/trainer2-runtime-grants.sql', 'utf8');
    const boundary = grants.indexOf('-- Apply once after 20261118010000;'); assert(boundary > 0);
    // Roles belong to the parent disposable cluster and already exist. Only this
    // database's grants/policies are installed; no shared role alteration occurs.
    await pool.query(grants.slice(0, boundary).replace(/^CREATE ROLE .*;\r?\n/gm, ''));
    assert.equal((await pool.query(`SELECT to_regclass('public."Trainer2PlanExerciseAmendment"') AS relation`)).rows[0].relation, null);
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: target.toString() }) });
    const accountId = randomUUID(), sessionId = randomUUID(), planId = randomUUID(), stageId = randomUUID();
    process.env.TRAINER2_OWNER_USER_ID = accountId;
    await pool.query('INSERT INTO "User" ("id","email") VALUES ($1,$2)', [accountId, name + '@trainer2.invalid']);
    await pool.query('INSERT INTO "Trainer2Owner" ("id","accountId","passcodeVerifier") VALUES (1,$1,$2)', [accountId, 'synthetic-disabled']);
    await pool.query(`INSERT INTO "Trainer2DeviceSession" ("id","ownerId","tokenHash","createdAt","renewedAt","expiresAt","absoluteExpiresAt","epoch") VALUES ($1,1,$2,now(),now(),now()+interval '1 day',now()+interval '2 days',0)`, [sessionId, createHash('sha256').update(randomUUID()).digest('hex')]);
    const principal = { accountId, sessionId };
    const envelope = () => ({ schemaVersion: 1 as const, actionId: randomUUID(), deviceId: randomUUID(), originatingAccountId: accountId, ownershipEpoch: 0, dependsOn: [] });
    const intent = { schemaVersion: 1 as const, name: 'Pre-amendment history', endpoint: 'endOfOrderedOccurrences' as const,
      progression: { version: 1 as const, mode: 'plannedPrescriptions' as const, scope: 'wholePlan' as const, parameters: {} },
      stages: [{ id: stageId, name: 'Week one' }], occurrences: Array.from({ length: 2 }, (_, i) => ({ id: randomUUID(), stageId, name: `Historical ${i + 1}`,
        positions: [{ id: randomUUID(), role: 'Main lift' as const, exercise: catalogExercise(catalog.find(e => e.id === 't2:bodyweight-45-degree-back-extension')!), targets: [{ id: randomUUID(), classification: 'working' as const, required: true,
          reps: { min: 8, max: 12, basis: 'total' as const }, measurement: { kind: 'bodyweight' as const, convention: 'bodyweightOnly' as const }, rir: '2', restSeconds: '90' }] }] })) };
    assert.equal((await createDraft(db, principal, { ...envelope(), commandType: 'CreateDraft', target: { planId }, expected: {}, intent })).outcome.status, 'Accepted');
    const plan = (await readDraft(db, principal, planId))!;
    assert.equal((await activatePlan(db, principal, { ...envelope(), commandType: 'ActivatePlan', target: { planId }, expected: { planRevisionId: plan.revisionId }, intent: { reviewed: plan.activation } })).outcome.status, 'Accepted');
    const revision = await db.trainer2PlanRevision.findUniqueOrThrow({ where: { id: plan.revisionId } });
    const executionId = randomUUID(), startedAt = new Date(), occurrence = intent.occurrences[0];
    const startCommand = { ...envelope(), commandType: 'StartOccurrence', target: { planId, occurrenceId: occurrence.id }, expected: { planRevisionId: plan.revisionId, instructionEpoch: 0 }, intent: {} };
    const initial = initialPrescription.parse({ schemaVersion: 1, kind: 'START', provenance: 'VERIFIED_START', policyVersion: START_POLICY,
      accountId, executionId, planId, revisionId: plan.revisionId, sourceContentHash: revision.contentHash, startedAt: startedAt.toISOString(),
      stage: intent.stages[0], occurrence, progression: intent.progression, instructions: await readInstructions(db, accountId),
      positions: occurrence.positions.map(p => ({ id: randomUUID(), sourcePositionId: p.id, targets: p.targets.map(t => ({ id: randomUUID(), sourceTargetId: t.id })) })) });
    const canonicalContent = canonicalJson(initial), contentHash = integrityHash(canonicalContent);
    assert.equal((await acceptCommand(db, principal, startCommand, startCommand, async tx => {
      await tx.trainer2Execution.create({ data: { id: executionId, accountId, planId, revisionId: plan.revisionId, occurrenceId: occurrence.id,
        actionId: startCommand.actionId, startedAt, initialPrescription: initial, canonicalContent, contentHash } });
      return { executionId, planId, revisionId: plan.revisionId, occurrenceId: occurrence.id, contentHash };
    })).outcome.status, 'Accepted');
    const execution = (await readExecution(db, principal, executionId))!;
    assert.equal((await saveSetResult(db, principal, { ...envelope(), commandType: 'RecordSetResult', target: { executionId, targetId: initial.positions[0].targets[0].id },
      expected: { resultVersion: 0, assignment: currentAssignment(execution, initial.positions[0].id) },
      intent: { result: { reps: { value: 10, basis: 'total' }, measurement: { kind: 'bodyweight', convention: 'bodyweightOnly' }, rir: '2' } } })).outcome.status, 'Accepted');
    const tables = (await pool.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' AND (tablename LIKE 'Trainer2%' OR tablename='User') ORDER BY tablename`)).rows.map(r => r.tablename as string);
    const rows = async () => Object.fromEntries(await Promise.all(tables.map(async table => [table, (await pool!.query(`SELECT to_jsonb(x) AS row FROM "${table}" x ORDER BY to_jsonb(x)::text`)).rows])));
    const before = await rows();
    await pool.query(readFileSync(`prisma/migrations/${migration}/migration.sql`, 'utf8'));
    await pool.query(readFileSync('prisma/trainer2-plan-amendment-grants.sql', 'utf8'));
    assert.deepEqual(await rows(), before, 'Forward amendment migration changed historical business rows');
    const after = (await readExecution(db, principal, executionId))!;
    assert.equal(canonicalJson(after.initial), canonicalContent); assert.equal(after.results.length, 1); assert.equal(after.results[0].result?.reps?.value, 10);
    assert.equal(after.initial.amendment, undefined);
    const next = await readNextWorkout(db, principal, planId);
    assert.equal(next.amendment, null); assert.equal(next.execution?.executionId, executionId);
    assert.equal(next.effectiveOccurrences[1].positions[0].exercise.name, 'Bodyweight 45-Degree Back Extension');
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM "Trainer2PlanExerciseAmendment"')).rows[0].n, 0);
    pass('Populated pre-amendment PostgreSQL upgrade preserves every business row, original START and saved result; new reader accepts legacy snapshot');
  } finally {
    if (priorOwner === undefined) delete process.env.TRAINER2_OWNER_USER_ID; else process.env.TRAINER2_OWNER_USER_ID = priorOwner;
    try { await db?.$disconnect(); } finally {
      try { await pool?.end(); } finally {
        if (created) {
          await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
          assert.equal((await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [name])).rowCount, 0);
        }
      }
    }
  }
}
