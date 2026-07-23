import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import type { Prisma } from "@prisma/client";
import { Pool } from "pg";
import {
  DATABASE_TARGET_ENV_VARS,
  sanitizeDatabaseTargetEnvironment,
  validateDisposableDatabaseTargets,
} from "../src/lib/operations/test-environment-preflight";

const TARGET_MIGRATION =
  "20260714210000_make_pre_session_readiness_snapshots_atomic";
const containerName = `trainer-readiness-${process.pid}-${randomUUID().slice(0, 8)}`;
const postgresUser = "trainer";
const postgresPassword = "trainer-readiness-disposable";
const postgresDatabase = "trainer";
let closeAppResources: (() => Promise<void>) | null = null;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function command(
  executable: string,
  args: string[],
  options: { env?: NodeJS.ProcessEnv; input?: string; quiet?: boolean } = {}
): string {
  const result = spawnSync(executable, args, {
    cwd: process.cwd(),
    env: options.env ?? process.env,
    encoding: "utf8",
    input: options.input,
    stdio: options.quiet ? "pipe" : ["pipe", "inherit", "inherit"],
  });
  if (result.status !== 0) {
    throw new Error(
      `COMMAND_FAILED executable=${executable} args=${args.join(" ")} status=${result.status}\n${result.stderr ?? ""}`
    );
  }
  return (result.stdout ?? "").trim();
}

function docker(args: string[], options: { input?: string; quiet?: boolean } = {}) {
  return command("docker", args, options);
}

function runSql(database: string, sql: string, quiet = true): string {
  return docker(
    [
      "exec",
      "-i",
      containerName,
      "psql",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      postgresUser,
      "-d",
      database,
      quiet ? "-tA" : "-a",
    ],
    { input: sql, quiet }
  );
}

function waitForPostgres(): void {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const result = spawnSync(
      "docker",
      [
        "exec",
        "-i",
        containerName,
        "psql",
        "-v",
        "ON_ERROR_STOP=1",
        "-U",
        postgresUser,
        "-d",
        postgresDatabase,
        "-tAc",
        "SELECT 1",
      ],
      { stdio: "ignore" }
    );
    if (result.status === 0) return;
    const end = Date.now() + 1_000;
    while (Date.now() < end) {
      // Bounded startup polling for the disposable container.
    }
  }
  throw new Error("DISPOSABLE_POSTGRES_DID_NOT_BECOME_READY");
}

function verifyLegacyMigration(): void {
  runSql(postgresDatabase, `CREATE DATABASE trainer_legacy;`);
  const migrationsRoot = join(process.cwd(), "prisma", "migrations");
  const migrations = readdirSync(migrationsRoot)
    .filter((name) => name < TARGET_MIGRATION)
    .sort();
  for (const migration of migrations) {
    const sql = readFileSync(join(migrationsRoot, migration, "migration.sql"), "utf8");
    runSql("trainer_legacy", sql);
  }
  runSql(
    "trainer_legacy",
    `
      INSERT INTO "User" ("id", "email")
      VALUES ('legacy-user', 'legacy-readiness@test.local');
      INSERT INTO "MacroCycle" (
        "id", "userId", "startDate", "endDate", "durationWeeks",
        "trainingAge", "primaryGoal", "updatedAt"
      ) VALUES (
        'legacy-macro', 'legacy-user', '2026-01-01', '2026-03-31', 12,
        'INTERMEDIATE', 'HYPERTROPHY', CURRENT_TIMESTAMP
      );
      INSERT INTO "Mesocycle" (
        "id", "macroCycleId", "mesoNumber", "startWeek", "durationWeeks",
        "focus", "volumeTarget", "intensityBias", "isActive"
      ) VALUES (
        'legacy-meso', 'legacy-macro', 1, 0, 4,
        'Legacy readiness migration', 'MODERATE', 'HYPERTROPHY', true
      );
      INSERT INTO "PreSessionReadinessSnapshot" (
        "id", "userId", "activeMesocycleId", "mesocycleState",
        "weekInMeso", "sessionInWeek", "slotId", "slotIntent",
        "contractVersion", "contractJson"
      ) VALUES (
        'legacy-snapshot', 'legacy-user', 'legacy-meso', 'ACTIVE_ACCUMULATION',
        1, 1, 'upper_a', 'upper', 1, '{}'::jsonb
      );
    `
  );
  const targetSql = readFileSync(
    join(migrationsRoot, TARGET_MIGRATION, "migration.sql"),
    "utf8"
  );
  runSql("trainer_legacy", targetSql);
  const status = runSql(
    "trainer_legacy",
    `SELECT "identityStatus" FROM "PreSessionReadinessSnapshot" WHERE "id" = 'legacy-snapshot';`
  );
  assert(status === "LEGACY_UNKNOWN", "LEGACY_IDENTITY_STATUS_NOT_PRESERVED");
  const exactHash = runSql(
    "trainer_legacy",
    `SELECT COALESCE("identityHash", 'NULL') FROM "PreSessionReadinessSnapshot" WHERE "id" = 'legacy-snapshot';`
  );
  assert(exactHash === "NULL", "LEGACY_ROW_WAS_GIVEN_FABRICATED_EXACT_IDENTITY");
}

function makeContract(input: { userId: string; mesocycleId: string }) {
  return {
    contractVersion: 1 as const,
    scope: {
      mode: "pre-session-readiness" as const,
      ownerSeam: "api/pre-session-readiness-contract" as const,
      source: {
        producerMode: "persisted_snapshot" as const,
        producer: "pre_session_readiness_snapshot" as const,
        provenance: "app_read_model" as const,
      },
      readOnly: true as const,
      auditOnly: false,
      affectsScoringOrGeneration: false as const,
      consumedByProduction: false as const,
    },
    nextSessionIdentity: {
      userId: input.userId,
      activeMesocycleId: input.mesocycleId,
      activeState: "ACTIVE_ACCUMULATION",
      currentWeek: 1,
      currentSession: 1,
      nextSlotId: "upper_a",
      nextIntent: "upper",
      existingWorkoutId: null,
      incompleteWorkoutStatus: null,
      incompleteWorkoutReadiness: "none",
      existingWorkoutAction: "none",
      generationPath: "standard_generation",
      generator: "generateSessionFromIntent",
    },
    startability: {
      status: "startable" as const,
      safeToTrain: true,
      normalStartCoachingAllowed: true,
      action: "run_seed_as_prescribed" as const,
      reasons: ["ready"],
      blockerSummary: "none",
    },
    seedRuntimeProof: {
      status: "valid" as const,
      compositionSource: "persisted_slot_plan_seed",
      receiptMesocycleId: input.mesocycleId,
      seedSource: "postgres_verification",
      seedExecutableShape: "set_aware",
      seedOrderSetCountsRespected: true,
      readOnlyEvidenceOnly: true as const,
      seedRuntimeChanged: false as const,
      proofLines: ["read-only"],
    },
    projectedWeekStatus: {
      status: "no_further_action" as const,
      currentWeek: 1,
      phase: "accumulation",
      belowMev: [],
      overMav: [],
      fatigueRisks: [],
      projectionNotes: [],
      doseGuidanceRows: [],
      noAddOnReason: "No add-ons.",
    },
    doseClosure: {
      heading: "Dose Closure",
      priority: [],
      optional: [],
      monitor: [],
      suppress: [],
      guardrails: [],
      recommendations: [],
    },
    sessionLocalCoaching: {
      defaultInstruction: "Run seed as prescribed.",
      floorBufferOpportunities: [],
      prescriptionConfidenceWatches: [],
      fatigueCautions: [],
      safeOptionalAddOns: [],
      suppressAvoid: [],
      addOnState: { status: "none" as const, reason: "No add-ons." },
    },
    calibrationWatches: {
      prescriptionConfidence: [],
      recoveryCaveats: [],
      fatigue: [],
    },
    consistencyChecks: [
      {
        id: "seed_runtime_proof_read_only" as const,
        status: "pass" as const,
        severity: "info" as const,
        message: "Read-only seed proof.",
        evidence: [],
      },
    ],
    boundaries: {
      readOnly: true as const,
      affectsScoringOrGeneration: false as const,
      consumedByProduction: false as const,
      wouldWriteTransaction: false as const,
      dbMutation: false as const,
      workoutLogSessionCreated: false as const,
      seedRuntimeChanged: false as const,
      plannerMaterializerChanged: false as const,
      notes: ["disposable PostgreSQL verification"],
    },
  };
}

async function main(): Promise<void> {
  assert(
    process.argv.includes("--confirm-disposable"),
    "READINESS_DB_TEST_REQUIRES_CONFIRM_DISPOSABLE"
  );
  docker([
    "run",
    "--rm",
    "-d",
    "--name",
    containerName,
    "-e",
    `POSTGRES_USER=${postgresUser}`,
    "-e",
    `POSTGRES_PASSWORD=${postgresPassword}`,
    "-e",
    `POSTGRES_DB=${postgresDatabase}`,
    "-p",
    "127.0.0.1::5432",
    "postgres:16-alpine",
  ]);
  waitForPostgres();
  const portOutput = docker(
    ["port", containerName, "5432/tcp"],
    { quiet: true }
  );
  const port = portOutput.match(/:(\d+)$/)?.[1];
  assert(port, `DISPOSABLE_POSTGRES_PORT_NOT_FOUND output=${portOutput}`);
  const databaseUrl = `postgresql://${postgresUser}:${postgresPassword}@127.0.0.1:${port}/${postgresDatabase}`;
  runSql(postgresDatabase, `CREATE DATABASE trainer_shadow;`);
  const shadowDatabaseUrl = `postgresql://${postgresUser}:${postgresPassword}@127.0.0.1:${port}/trainer_shadow`;
  const env: NodeJS.ProcessEnv = {
    ...sanitizeDatabaseTargetEnvironment(process.env),
    DATABASE_URL: databaseUrl,
    TEST_DATABASE_URL: databaseUrl,
    DIRECT_URL: databaseUrl,
    SHADOW_DATABASE_URL: shadowDatabaseUrl,
    TRAINER_DISPOSABLE_DB_CONFIRMED: "1",
    NODE_ENV: "test" as const,
  };
  const targetValidation = validateDisposableDatabaseTargets({
    environment: env,
    confirmed: true,
  });
  assert(targetValidation.valid, "READINESS_DB_TEST_TARGET_INVALID");
  for (const name of DATABASE_TARGET_ENV_VARS) delete process.env[name];
  Object.assign(process.env, {
    DATABASE_URL: databaseUrl,
    TEST_DATABASE_URL: databaseUrl,
    DIRECT_URL: databaseUrl,
    SHADOW_DATABASE_URL: shadowDatabaseUrl,
    NODE_ENV: "test",
  });

  command(
    process.execPath,
    [
      join(process.cwd(), "node_modules", "prisma", "build", "index.js"),
      "migrate",
      "deploy",
    ],
    { env }
  );
  verifyLegacyMigration();

  const importedDb = await import("@/lib/db/prisma");
  const dbModule = importedDb;
  const importedSnapshot = await import("@/lib/api/pre-session-readiness-snapshot");
  const snapshotModule = importedSnapshot;
  const { prisma, closePrismaResourcesForAuditCli } = dbModule;
  closeAppResources = closePrismaResourcesForAuditCli;
  const {
    activatePreSessionReadinessSnapshot,
    loadCurrentPreSessionReadinessSnapshot,
    loadCurrentPreSessionReadinessSnapshotIdentity,
  } = snapshotModule;

  async function createOwner(label: string) {
    const suffix = randomUUID();
    const user = await prisma.user.create({
      data: { email: `${label}-${suffix}@test.local` },
    });
    await prisma.constraints.create({
      data: {
        userId: user.id,
        daysPerWeek: 1,
        splitType: "UPPER_LOWER",
        weeklySchedule: ["UPPER"],
      },
    });
    const macro = await prisma.macroCycle.create({
      data: {
        userId: user.id,
        startDate: new Date("2026-01-01T00:00:00.000Z"),
        endDate: new Date("2026-03-31T00:00:00.000Z"),
        durationWeeks: 12,
        trainingAge: "INTERMEDIATE",
        primaryGoal: "HYPERTROPHY",
      },
    });
    const slotSequence = {
      version: 1,
      source: "postgres_verification",
      sequenceMode: "ordered_flexible",
      slots: [{ slotId: "upper_a", intent: "UPPER" }],
    };
    const seed = {
      version: 1,
      source: "postgres_verification",
      slots: [{ slotId: "upper_a", exercises: [] }],
    };
    const mesocycle = await prisma.mesocycle.create({
      data: {
        macroCycleId: macro.id,
        mesoNumber: 1,
        startWeek: 0,
        durationWeeks: 4,
        focus: "Readiness concurrency verification",
        volumeTarget: "MODERATE",
        intensityBias: "HYPERTROPHY",
        sessionsPerWeek: 1,
        splitType: "UPPER_LOWER",
        daysPerWeek: 1,
        isActive: true,
        slotSequenceJson: slotSequence,
        slotPlanSeedJson: seed,
      },
    });
    const payloadHash = snapshotModule.hashPreSessionReadinessSnapshotSource(seed);
    const revision = await prisma.mesocycleSeedRevision.create({
      data: {
        mesocycleId: mesocycle.id,
        revision: 1,
        seedPayload: seed,
        payloadHash,
        hashAlgorithm: "sha256",
        provenanceStatus: "exact",
        creationReason: "readiness_postgres_verification",
      },
    });
    await prisma.mesocycle.update({
      where: { id: mesocycle.id },
      data: { currentSeedRevisionId: revision.id },
    });
    return { user, mesocycle };
  }

  const owner = await createOwner("readiness-owner");
  const identity = await loadCurrentPreSessionReadinessSnapshotIdentity(owner.user.id);
  assert(identity, "CURRENT_READINESS_IDENTITY_MISSING");
  const contract = makeContract({
    userId: owner.user.id,
    mesocycleId: owner.mesocycle.id,
  });

  const concurrent = await Promise.all([
    activatePreSessionReadinessSnapshot({ preparedIdentity: identity, contract }),
    activatePreSessionReadinessSnapshot({ preparedIdentity: identity, contract }),
  ]);
  assert(
    concurrent[0].snapshot.id === concurrent[1].snapshot.id,
    "IDENTICAL_CONCURRENT_PREPARES_DID_NOT_CONVERGE"
  );
  const activeAfterConcurrency = await prisma.preSessionReadinessSnapshot.findMany({
    where: { userId: owner.user.id, invalidatedAt: null, identityStatus: "EXACT" },
  });
  assert(activeAfterConcurrency.length === 1, "DUPLICATE_ACTIVE_AFTER_CONCURRENCY");

  const conflictingContract = {
    ...contract,
    projectedWeekStatus: {
      ...contract.projectedWeekStatus,
      projectionNotes: ["conflicting deterministic output"],
    },
  };
  let conflictingPayloadRejected = false;
  try {
    await activatePreSessionReadinessSnapshot({
      preparedIdentity: identity,
      contract: conflictingContract,
    });
  } catch (error) {
    conflictingPayloadRejected =
      error instanceof snapshotModule.PreSessionReadinessSnapshotConflictError &&
      error.code === "PAYLOAD_INTEGRITY_CONFLICT";
  }
  assert(conflictingPayloadRejected, "SAME_IDENTITY_DIFFERENT_PAYLOAD_NOT_REJECTED");

  let uniqueIndexRejectedDuplicate = false;
  try {
    const row = activeAfterConcurrency[0];
    await prisma.preSessionReadinessSnapshot.create({
      data: {
        userId: row.userId,
        activeMesocycleId: row.activeMesocycleId,
        mesocycleState: row.mesocycleState,
        weekInMeso: row.weekInMeso,
        sessionInWeek: row.sessionInWeek,
        slotId: row.slotId,
        slotIntent: row.slotIntent,
        contractVersion: row.contractVersion,
        contractJson: row.contractJson as Prisma.InputJsonValue,
        identityStatus: "EXACT",
        identityContractVersion: row.identityContractVersion,
        identityJson: row.identityJson as Prisma.InputJsonValue,
        identityHash: row.identityHash,
        targetHash: row.targetHash,
        payloadHash: row.payloadHash,
        readinessEvidenceFingerprint: row.readinessEvidenceFingerprint,
        projectionFingerprint: row.projectionFingerprint,
      },
    });
  } catch (error) {
    uniqueIndexRejectedDuplicate =
      typeof error === "object" && error !== null && "code" in error &&
      (error as { code?: unknown }).code === "P2002";
  }
  assert(uniqueIndexRejectedDuplicate, "PARTIAL_UNIQUE_INDEX_DID_NOT_REJECT_DUPLICATE");

  await prisma.readinessSignal.create({
    data: {
      userId: owner.user.id,
      subjectiveReadiness: 4,
      subjectiveMotivation: 4,
      subjectiveSoreness: {},
      performanceRpeDeviation: 0,
      performanceStalls: 0,
      performanceCompliance: 1,
      fatigueScoreOverall: 0.8,
      fatigueScoreBreakdown: {},
    },
  });
  const replacementIdentity =
    await loadCurrentPreSessionReadinessSnapshotIdentity(owner.user.id);
  assert(replacementIdentity, "REPLACEMENT_IDENTITY_MISSING");
  runSql(
    postgresDatabase,
    `
      CREATE OR REPLACE FUNCTION fail_readiness_replacement() RETURNS trigger AS $$
      BEGIN
        IF NEW."readinessEvidenceFingerprint" = '${replacementIdentity.readinessEvidenceFingerprint}' THEN
          RAISE EXCEPTION 'forced readiness replacement failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER fail_readiness_replacement_trigger
        BEFORE INSERT ON "PreSessionReadinessSnapshot"
        FOR EACH ROW EXECUTE FUNCTION fail_readiness_replacement();
    `
  );
  let replacementFailed = false;
  try {
    await activatePreSessionReadinessSnapshot({
      preparedIdentity: replacementIdentity,
      contract,
    });
  } catch {
    replacementFailed = true;
  }
  assert(replacementFailed, "FORCED_REPLACEMENT_FAILURE_DID_NOT_FAIL");
  const previousStillActive = await prisma.preSessionReadinessSnapshot.findUnique({
    where: { id: concurrent[0].snapshot.id },
  });
  assert(previousStillActive?.invalidatedAt == null, "FAILED_REPLACEMENT_INVALIDATED_PREVIOUS");
  runSql(
    postgresDatabase,
    `DROP TRIGGER fail_readiness_replacement_trigger ON "PreSessionReadinessSnapshot";
     DROP FUNCTION fail_readiness_replacement();`
  );

  const successfulFirstReplacement = await activatePreSessionReadinessSnapshot({
    preparedIdentity: replacementIdentity,
    contract,
  });
  assert(
    successfulFirstReplacement.invalidatedSnapshotCount === 1,
    "VALID_REPLACEMENT_DID_NOT_SUPERSEDE_PREVIOUS"
  );

  const concurrentPreparedIdentity =
    await loadCurrentPreSessionReadinessSnapshotIdentity(owner.user.id);
  assert(concurrentPreparedIdentity, "CONCURRENT_STALE_IDENTITY_MISSING");
  const racePool = new Pool({ connectionString: databaseUrl });
  const raceClient = await racePool.connect();
  await raceClient.query("BEGIN");
  await raceClient.query('LOCK TABLE "ReadinessSignal" IN ACCESS EXCLUSIVE MODE');
  const staleActivation = activatePreSessionReadinessSnapshot({
    preparedIdentity: concurrentPreparedIdentity,
    contract,
  });
  await new Promise((resolve) => setTimeout(resolve, 150));
  await raceClient.query(
    `INSERT INTO "ReadinessSignal" (
      "id", "userId", "subjectiveReadiness", "subjectiveMotivation",
      "subjectiveSoreness", "performanceRpeDeviation", "performanceStalls",
      "performanceCompliance", "fatigueScoreOverall", "fatigueScoreBreakdown"
    ) VALUES ($1, $2, 3, 3, '{}'::jsonb, 0, 0, 1, 0.6, '{}'::jsonb)`,
    [`signal-${randomUUID()}`, owner.user.id]
  );
  await raceClient.query("COMMIT");
  raceClient.release();
  await racePool.end();
  let staleRejected = false;
  try {
    await staleActivation;
  } catch (error) {
    staleRejected =
      error instanceof snapshotModule.PreSessionReadinessSnapshotConflictError &&
      error.code === "STALE_PREPARATION";
  }
  assert(staleRejected, "STALE_READINESS_PREPARATION_NOT_REJECTED");
  const activeAfterStale = await prisma.preSessionReadinessSnapshot.count({
    where: { userId: owner.user.id, invalidatedAt: null, identityStatus: "EXACT" },
  });
  assert(activeAfterStale === 1, "STALE_PREPARATION_CHANGED_ACTIVE_STATE");
  const currentReplacementIdentity =
    await loadCurrentPreSessionReadinessSnapshotIdentity(owner.user.id);
  assert(currentReplacementIdentity, "CURRENT_REPLACEMENT_IDENTITY_MISSING");
  const successfulReplacement = await activatePreSessionReadinessSnapshot({
    preparedIdentity: currentReplacementIdentity,
    contract,
  });
  assert(
    successfulReplacement.invalidatedSnapshotCount === 1,
    "CURRENT_REPLACEMENT_DID_NOT_SUPERSEDE_PREVIOUS"
  );

  const secondOwner = await createOwner("readiness-owner-two");
  const secondIdentity =
    await loadCurrentPreSessionReadinessSnapshotIdentity(secondOwner.user.id);
  assert(secondIdentity, "SECOND_OWNER_IDENTITY_MISSING");
  const secondContract = makeContract({
    userId: secondOwner.user.id,
    mesocycleId: secondOwner.mesocycle.id,
  });
  const secondActivation = await activatePreSessionReadinessSnapshot({
    preparedIdentity: secondIdentity,
    contract: secondContract,
  });
  const firstOwnerLoad = await loadCurrentPreSessionReadinessSnapshot(owner.user.id);
  const secondOwnerLoad = await loadCurrentPreSessionReadinessSnapshot(secondOwner.user.id);
  assert(firstOwnerLoad.status === "available", "FIRST_OWNER_SNAPSHOT_UNAVAILABLE");
  assert(secondOwnerLoad.status === "available", "SECOND_OWNER_SNAPSHOT_UNAVAILABLE");
  assert(
    firstOwnerLoad.snapshot.id !== secondActivation.snapshot.id &&
      secondOwnerLoad.snapshot.id === secondActivation.snapshot.id,
    "OWNER_ISOLATION_FAILED"
  );

  console.log(
    JSON.stringify({
      ok: true,
      migrationLegacyUnknown: true,
      partialUniqueIndex: true,
      atomicRollback: true,
      identicalConcurrency: true,
      conflictingPayload: true,
      stalePreparation: true,
      ownerIsolation: true,
    })
  );
}

async function run(): Promise<void> {
  let started = false;
  try {
    docker(["version", "--format", "{{.Server.Version}}"], { quiet: true });
    started = true;
    await main();
  } finally {
    if (closeAppResources) {
      await closeAppResources();
    }
    if (started) {
      spawnSync("docker", ["rm", "-f", containerName], { stdio: "ignore" });
    }
  }
}

void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
