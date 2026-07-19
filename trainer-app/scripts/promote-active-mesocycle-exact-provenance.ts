import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import dotenv from "dotenv";
import { Pool } from "pg";
import {
  canonicalizeJson,
  fingerprintCanonicalJson,
  normalizeAcceptedSeedPayload,
  promoteLegacySeedRevisionToExactInTransaction,
} from "@/lib/api/mesocycle-seed-revision";

const TARGET_MESOCYCLE_ID = "b6e1a399-eda3-4e61-8cd6-2c6787910413";
const EXPECTED_HASH_PREFIX = "91a62d15066e";

type TargetRow = {
  mesocycleId: string;
  state: string;
  isActive: boolean;
  slotPlanSeedJson: unknown;
  currentRevisionId: string;
  revisionId: string;
  revision: number;
  seedPayload: unknown;
  payloadHash: string | null;
  hashAlgorithm: string | null;
  provenanceStatus: string;
  creationReason: string;
  actorSource: string | null;
  sourceRevisionId: string | null;
};

type TargetSnapshot = {
  row: TargetRow;
  canonicalHash: string;
  exactPayloadRevisionCount: number;
  totalRevisionCount: number;
  appliedMigrationCount: number;
  tableCounts: Record<string, number>;
};

function argumentValue(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing required ${name} value.`);
  }
  return value;
}

function loadExplicitEnvironment(): string {
  const envFile = resolve(process.cwd(), argumentValue("--env-file"));
  const parsed = dotenv.parse(readFileSync(envFile));
  if (!parsed.DATABASE_URL) {
    throw new Error("The explicit environment file must define DATABASE_URL.");
  }
  Object.assign(process.env, parsed);
  return envFile;
}

function comparisonPayload(row: TargetRow): unknown {
  return {
    mesocycle: {
      id: row.mesocycleId,
      state: row.state,
      isActive: row.isActive,
      currentSeedRevisionId: row.currentRevisionId,
      slotPlanSeedJson: row.slotPlanSeedJson,
    },
    revision: {
      id: row.revisionId,
      mesocycleId: row.mesocycleId,
      revision: row.revision,
      seedPayload: row.seedPayload,
      payloadHash: row.payloadHash,
      hashAlgorithm: row.hashAlgorithm,
      provenanceStatus: row.provenanceStatus,
      creationReason: row.creationReason,
      actorSource: row.actorSource,
      sourceRevisionId: row.sourceRevisionId,
    },
  };
}

async function loadTargetSnapshot(pool: Pool): Promise<TargetSnapshot> {
  const target = await pool.query<TargetRow>(`
    SELECT
      m."id" AS "mesocycleId",
      m."state"::text AS "state",
      m."isActive",
      m."slotPlanSeedJson",
      m."currentSeedRevisionId" AS "currentRevisionId",
      r."id" AS "revisionId",
      r."revision",
      r."seedPayload",
      r."payloadHash",
      r."hashAlgorithm",
      r."provenanceStatus",
      r."creationReason",
      r."actorSource",
      r."sourceRevisionId"
    FROM "Mesocycle" m
    JOIN "MesocycleSeedRevision" r ON r."id" = m."currentSeedRevisionId"
    WHERE m."id" = $1
  `, [TARGET_MESOCYCLE_ID]);
  const row = target.rows[0];
  if (!row) throw new Error("TARGET_MESOCYCLE_NOT_FOUND");

  const canonicalHash = normalizeAcceptedSeedPayload(row.seedPayload).hash;
  const [revisionCounts, migrationCount, tableCounts] = await Promise.all([
    pool.query<{ total: string; exactPayload: string }>(`
      SELECT
        COUNT(*)::text AS "total",
        COUNT(*) FILTER (
          WHERE "mesocycleId" = $1
            AND "payloadHash" = $2
            AND "hashAlgorithm" = 'sha256'
            AND "provenanceStatus" = 'exact'
        )::text AS "exactPayload"
      FROM "MesocycleSeedRevision"
    `, [TARGET_MESOCYCLE_ID, canonicalHash]),
    pool.query<{ applied: string }>(`
      SELECT COUNT(*)::text AS "applied"
      FROM "_prisma_migrations"
      WHERE "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL
    `),
    pool.query<Record<string, string>>(`
      SELECT
        (SELECT COUNT(*) FROM "Mesocycle")::text AS "Mesocycle",
        (SELECT COUNT(*) FROM "MesocycleSeedRevision")::text AS "MesocycleSeedRevision",
        (SELECT COUNT(*) FROM "Workout")::text AS "Workout",
        (SELECT COUNT(*) FROM "WorkoutExercise")::text AS "WorkoutExercise",
        (SELECT COUNT(*) FROM "WorkoutSet")::text AS "WorkoutSet",
        (SELECT COUNT(*) FROM "SetLog")::text AS "SetLog",
        (SELECT COUNT(*) FROM "ReadinessSignal")::text AS "ReadinessSignal"
    `),
  ]);
  const counts = tableCounts.rows[0] ?? {};

  return {
    row,
    canonicalHash,
    exactPayloadRevisionCount: Number(revisionCounts.rows[0]?.exactPayload ?? 0),
    totalRevisionCount: Number(revisionCounts.rows[0]?.total ?? 0),
    appliedMigrationCount: Number(migrationCount.rows[0]?.applied ?? 0),
    tableCounts: Object.fromEntries(
      Object.entries(counts).map(([key, value]) => [key, Number(value)]),
    ),
  };
}

function assertPreflight(snapshot: TargetSnapshot): void {
  const { row } = snapshot;
  if (!row.isActive || !row.state.startsWith("ACTIVE_")) {
    throw new Error("TARGET_MESOCYCLE_NOT_ACTIVE");
  }
  if (row.revision !== 1 || row.provenanceStatus !== "legacy_unknown") {
    throw new Error("TARGET_LEGACY_REVISION_CHANGED");
  }
  if (row.payloadHash !== null || row.hashAlgorithm !== null) {
    throw new Error("TARGET_LEGACY_HASH_STATE_CHANGED");
  }
  if (snapshot.totalRevisionCount !== 3) {
    throw new Error("SEED_REVISION_COUNT_CHANGED");
  }
  if (snapshot.appliedMigrationCount !== 15) {
    throw new Error("MIGRATION_LEDGER_CHANGED");
  }
  if (!snapshot.canonicalHash.startsWith(EXPECTED_HASH_PREFIX)) {
    throw new Error("TARGET_CANONICAL_HASH_CHANGED");
  }
  if (snapshot.exactPayloadRevisionCount !== 0) {
    throw new Error("TARGET_EXACT_REVISION_ALREADY_EXISTS");
  }
  const seedCanonical = canonicalizeJson(
    normalizeAcceptedSeedPayload(row.slotPlanSeedJson).canonicalPayload,
  );
  const revisionCanonical = canonicalizeJson(
    normalizeAcceptedSeedPayload(row.seedPayload).canonicalPayload,
  );
  if (seedCanonical !== revisionCanonical) {
    throw new Error("TARGET_SEED_REVISION_PAYLOAD_MISMATCH");
  }
}

function assertExactState(snapshot: TargetSnapshot): void {
  if (
    !snapshot.row.isActive ||
    !snapshot.row.state.startsWith("ACTIVE_") ||
    snapshot.row.revision !== 2 ||
    snapshot.row.provenanceStatus !== "exact" ||
    snapshot.row.hashAlgorithm !== "sha256" ||
    snapshot.row.payloadHash !== snapshot.canonicalHash ||
    !snapshot.canonicalHash.startsWith(EXPECTED_HASH_PREFIX) ||
    snapshot.exactPayloadRevisionCount !== 1 ||
    snapshot.totalRevisionCount !== 4 ||
    snapshot.appliedMigrationCount !== 15
  ) {
    throw new Error("TARGET_EXACT_STATE_INVALID");
  }
}

function sanitizedSnapshot(snapshot: TargetSnapshot): unknown {
  return {
    target: snapshot.row.mesocycleId,
    state: snapshot.row.state,
    isActive: snapshot.row.isActive,
    currentRevisionId: snapshot.row.currentRevisionId,
    revision: snapshot.row.revision,
    provenanceStatus: snapshot.row.provenanceStatus,
    payloadHash: snapshot.row.payloadHash,
    canonicalHashPrefix: `${snapshot.canonicalHash.slice(0, 12)}...`,
    exactPayloadRevisionCount: snapshot.exactPayloadRevisionCount,
    totalRevisionCount: snapshot.totalRevisionCount,
    appliedMigrationCount: snapshot.appliedMigrationCount,
    tableCounts: snapshot.tableCounts,
    comparisonFingerprint: fingerprintCanonicalJson(
      comparisonPayload(snapshot.row),
    ),
  };
}

async function revisionFingerprint(pool: Pool, revisionId: string): Promise<string> {
  const result = await pool.query<{
    id: string;
    mesocycleId: string;
    revision: number;
    seedPayload: unknown;
    payloadHash: string | null;
    hashAlgorithm: string | null;
    provenanceStatus: string;
    creationReason: string;
    actorSource: string | null;
    sourceRevisionId: string | null;
  }>(`
    SELECT "id", "mesocycleId", "revision", "seedPayload", "payloadHash",
      "hashAlgorithm", "provenanceStatus", "creationReason", "actorSource",
      "sourceRevisionId"
    FROM "MesocycleSeedRevision"
    WHERE "id" = $1
  `, [revisionId]);
  const row = result.rows[0];
  if (!row) throw new Error("LEGACY_REVISION_MISSING_AFTER_PROMOTION");
  return fingerprintCanonicalJson(row);
}

function assertPostPromotion(
  before: TargetSnapshot,
  after: TargetSnapshot,
  legacyFingerprintBefore: string,
  legacyFingerprintAfter: string,
): void {
  if (
    after.row.revision !== 2 ||
    after.row.provenanceStatus !== "exact" ||
    after.row.payloadHash !== before.canonicalHash ||
    after.row.hashAlgorithm !== "sha256" ||
    after.row.sourceRevisionId !== before.row.revisionId
  ) {
    throw new Error("PROMOTED_REVISION_INVALID");
  }
  if (after.totalRevisionCount !== before.totalRevisionCount + 1) {
    throw new Error("PROMOTION_REVISION_COUNT_INVALID");
  }
  if (after.exactPayloadRevisionCount !== 1) {
    throw new Error("PROMOTION_EXACT_REVISION_COUNT_INVALID");
  }
  if (after.appliedMigrationCount !== before.appliedMigrationCount) {
    throw new Error("PROMOTION_MIGRATION_LEDGER_CHANGED");
  }
  if (
    fingerprintCanonicalJson(after.row.slotPlanSeedJson) !==
    fingerprintCanonicalJson(before.row.slotPlanSeedJson)
  ) {
    throw new Error("PROMOTION_SLOT_PLAN_SEED_CHANGED");
  }
  if (legacyFingerprintAfter !== legacyFingerprintBefore) {
    throw new Error("PROMOTION_LEGACY_REVISION_CHANGED");
  }
  for (const [table, beforeCount] of Object.entries(before.tableCounts)) {
    const expected = table === "MesocycleSeedRevision" ? beforeCount + 1 : beforeCount;
    if (after.tableCounts[table] !== expected) {
      throw new Error(`PROMOTION_UNEXPECTED_TABLE_COUNT:${table}`);
    }
  }
}

async function promote(preflight: TargetSnapshot): Promise<unknown> {
  const preflightFingerprint = fingerprintCanonicalJson(
    comparisonPayload(preflight.row),
  );
  const legacyPayloadFingerprint = fingerprintCanonicalJson(
    preflight.row.seedPayload,
  );
  const [{ Prisma }, dbModule] = await Promise.all([
    import("@prisma/client"),
    import("@/lib/db/prisma"),
  ]);
  try {
    return await dbModule.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "Mesocycle" WHERE "id" = ${TARGET_MESOCYCLE_ID} FOR UPDATE`,
      );
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "MesocycleSeedRevision" WHERE "id" = ${preflight.row.revisionId} FOR UPDATE`,
      );
      const locked = await tx.mesocycle.findUnique({
        where: { id: TARGET_MESOCYCLE_ID },
        select: {
          id: true,
          state: true,
          isActive: true,
          slotPlanSeedJson: true,
          currentSeedRevisionId: true,
          currentSeedRevision: {
            select: {
              id: true,
              revision: true,
              seedPayload: true,
              payloadHash: true,
              hashAlgorithm: true,
              provenanceStatus: true,
              creationReason: true,
              actorSource: true,
              sourceRevisionId: true,
            },
          },
        },
      });
      if (!locked?.currentSeedRevisionId || !locked.currentSeedRevision) {
        throw new Error("TARGET_LOCKED_STATE_MISSING");
      }
      const lockedRow: TargetRow = {
        mesocycleId: locked.id,
        state: locked.state,
        isActive: locked.isActive,
        slotPlanSeedJson: locked.slotPlanSeedJson,
        currentRevisionId: locked.currentSeedRevisionId,
        revisionId: locked.currentSeedRevision.id,
        revision: locked.currentSeedRevision.revision,
        seedPayload: locked.currentSeedRevision.seedPayload,
        payloadHash: locked.currentSeedRevision.payloadHash,
        hashAlgorithm: locked.currentSeedRevision.hashAlgorithm,
        provenanceStatus: locked.currentSeedRevision.provenanceStatus,
        creationReason: locked.currentSeedRevision.creationReason,
        actorSource: locked.currentSeedRevision.actorSource,
        sourceRevisionId: locked.currentSeedRevision.sourceRevisionId,
      };
      if (
        fingerprintCanonicalJson(comparisonPayload(lockedRow)) !==
        preflightFingerprint
      ) {
        throw new Error("LEGACY_REVISION_CHANGED_IN_TRANSACTION");
      }
      return promoteLegacySeedRevisionToExactInTransaction(tx, {
        mesocycleId: TARGET_MESOCYCLE_ID,
        actorSource: "targeted_exact_provenance_promotion",
        expectedLegacyRevisionFingerprint: legacyPayloadFingerprint,
      });
    });
  } finally {
    await dbModule.closePrismaResourcesForAuditCli();
  }
}

async function verifyGenerationAndRollbackOnlySave(
  snapshot: TargetSnapshot,
): Promise<unknown> {
  const [contextModule, generationModule, provenanceModule, mutationModule, dbModule] =
    await Promise.all([
      import("@/lib/audit/workout-audit/context-builder"),
      import("@/lib/audit/workout-audit/generation-runner"),
      import("@/lib/api/save-workout/seed-provenance"),
      import("@/lib/api/workout-mutation"),
      import("@/lib/db/prisma"),
    ]);
  try {
    const context = await contextModule.buildWorkoutAuditContext({
      mode: "future-week",
      ownerEmail: "aaron8819@gmail.com",
      plannerDiagnosticsMode: "standard",
    });
    const run = await generationModule.runWorkoutAuditGeneration(context);
    if (!run.generationResult || "error" in run.generationResult) {
      throw new Error("EXACT_PROVENANCE_GENERATION_FAILED");
    }
    const intent = context.generationInput?.intent;
    const receipt = run.generationResult.selection.sessionDecisionReceipt;
    if (!receipt) {
      throw new Error("EXACT_PROVENANCE_RECEIPT_MISSING");
    }
    const receiptProvenance = receipt?.sessionProvenance;
    const receiptSeed = receiptProvenance?.seedProvenance;
    if (
      context.nextSession?.slotId !== "lower_b" ||
      receiptProvenance?.compositionSource !== "persisted_slot_plan_seed" ||
      receiptSeed?.revisionId !== snapshot.row.revisionId ||
      receiptSeed.revision !== 2 ||
      receiptSeed.hash !== snapshot.canonicalHash
    ) {
      throw new Error("EXACT_PROVENANCE_RECEIPT_INVALID");
    }

    const verificationWorkoutId = `rollback-exact-provenance-${crypto.randomUUID()}`;
    let resolverPassed = false;
    let persistencePathReached = false;
    const rollbackSentinel = "ROLLBACK_ONLY_EXACT_PROVENANCE_SAVE_VERIFIED";
    try {
      await dbModule.prisma.$transaction(async (tx) => {
        const seedProvenance =
          await provenanceModule.resolveWorkoutSeedProvenanceForSave(tx, {
            receipt,
            resolvedMesocycleId: TARGET_MESOCYCLE_ID,
            existingWorkout: null,
          });
        resolverPassed = Boolean(
          seedProvenance &&
            seedProvenance.seedRevisionId === snapshot.row.revisionId &&
            seedProvenance.seedRevisionNumber === 2 &&
            seedProvenance.seedPayloadHash === snapshot.canonicalHash,
        );
        if (!resolverPassed || !seedProvenance) {
          throw new Error("SAVE_SEED_PROVENANCE_RESOLUTION_INVALID");
        }
        await tx.workout.create({
          data: {
            id: verificationWorkoutId,
            userId: context.userId,
            scheduledDate: new Date(),
            status: "PLANNED",
            selectionMetadata: { sessionDecisionReceipt: receipt },
            mesocycleId: TARGET_MESOCYCLE_ID,
            ...seedProvenance,
          },
        });
        await mutationModule.executeWorkoutMutationInTransaction(
          tx,
          {
            workoutId: verificationWorkoutId,
            userId: context.userId,
            expectedRevision: 1,
          },
          async (mutationTx) => {
            const persisted = await mutationTx.workout.findUnique({
              where: { id: verificationWorkoutId },
              select: {
                seedRevisionId: true,
                seedRevisionNumber: true,
                seedPayloadHash: true,
              },
            });
            persistencePathReached =
              persisted?.seedRevisionId === snapshot.row.revisionId &&
              persisted.seedRevisionNumber === 2 &&
              persisted.seedPayloadHash === snapshot.canonicalHash;
            if (!persistencePathReached) {
              throw new Error("SAVE_PERSISTENCE_PATH_PROVENANCE_INVALID");
            }
            return persisted;
          },
        );
        throw new Error(rollbackSentinel);
      });
    } catch (error) {
      if (!(error instanceof Error) || error.message !== rollbackSentinel) {
        throw error;
      }
    }
    const permanentVerificationRows = await dbModule.prisma.workout.count({
      where: { id: verificationWorkoutId },
    });
    if (!resolverPassed || !persistencePathReached || permanentVerificationRows !== 0) {
      throw new Error("ROLLBACK_ONLY_SAVE_VERIFICATION_INVALID");
    }
    return {
      slotId: context.nextSession?.slotId,
      intent,
      compositionSource: receiptProvenance.compositionSource,
      receiptSeed,
      resolverPassed,
      persistencePathReached,
      permanentVerificationRows,
    };
  } finally {
    await dbModule.closePrismaResourcesForAuditCli();
  }
}

async function main(): Promise<void> {
  const envFile = loadExplicitEnvironment();
  const mode = argumentValue("--mode");
  if (mode !== "preflight" && mode !== "promote" && mode !== "verify") {
    throw new Error("--mode must be preflight, promote, or verify.");
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const before = await loadTargetSnapshot(pool);
    if (mode === "verify") assertExactState(before);
    else assertPreflight(before);
    console.log(JSON.stringify({ envFile, mode, before: sanitizedSnapshot(before) }, null, 2));
    if (process.argv.includes("--emit-fixture")) {
      console.log(JSON.stringify({ fixturePayload: before.row.seedPayload }));
    }
    if (mode === "preflight") return;

    if (mode === "verify") {
      const verification = await verifyGenerationAndRollbackOnlySave(before);
      const afterVerification = await loadTargetSnapshot(pool);
      assertExactState(afterVerification);
      console.log(
        JSON.stringify(
          { verification, after: sanitizedSnapshot(afterVerification) },
          null,
          2,
        ),
      );
      return;
    }

    const legacyFingerprintBefore = await revisionFingerprint(
      pool,
      before.row.revisionId,
    );
    const result = await promote(before);
    const after = await loadTargetSnapshot(pool);
    const legacyFingerprintAfter = await revisionFingerprint(
      pool,
      before.row.revisionId,
    );
    assertPostPromotion(
      before,
      after,
      legacyFingerprintBefore,
      legacyFingerprintAfter,
    );
    console.log(JSON.stringify({ result, after: sanitizedSnapshot(after) }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
