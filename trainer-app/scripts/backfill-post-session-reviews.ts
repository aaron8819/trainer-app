import { Pool } from "pg";
import { buildPostSessionReviewContract } from "@/lib/api/post-session-review-contract-builder";
import { deriveSessionSemantics } from "@/lib/session-semantics/derive-session-semantics";
import {
  readSessionDecisionReceipt,
  readSessionSlotSnapshot,
} from "@/lib/evidence/session-decision-receipt";
import { buildExerciseStimulusSnapshot } from "@/lib/stimulus-accounting/snapshot";
import {
  runWithRolloutEnvironment,
  sanitizedRolloutEnvironment,
} from "@/lib/operations/rollout-environment";

function readOption(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function readPositiveInt(name: string, fallback: number): number {
  const raw = readOption(name);
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}

const write = process.argv.includes("--write");
const batchSize = readPositiveInt("--batch-size", 100);
const limit = readPositiveInt("--limit", Number.MAX_SAFE_INTEGER);
const initialAfterId = readOption("--after-id");
const inventoryOnly = process.argv.includes("--inventory-only");

const summary = {
  write,
  exactExisting: 0,
  legacyDerivedExisting: 0,
  legacyDerivedCandidate: 0,
  legacyUnknownUnproducible: 0,
  invalidCurrentEvidence: 0,
  writeConflicts: 0,
  written: 0,
  scanned: 0,
  lastScannedId: initialAfterId ?? null,
  hashDistribution: {} as Record<string, number>,
  failures: [] as Array<{ workoutId: string; reason: string }>,
};

function countHash(hash: string) {
  summary.hashDistribution[hash] = (summary.hashDistribution[hash] ?? 0) + 1;
}

type InventoryWorkout = {
  id: string;
  userId: string;
  ownerEmail: string;
  completedAt: Date | null;
  scheduledDate: Date;
  revision: number | null;
  selectionMode: string | null;
  sessionIntent: string | null;
  selectionMetadata: unknown;
  advancesSplit: boolean | null;
  templateId: string | null;
  mesocycleId: string | null;
  mesocycleWeekSnapshot: number | null;
  mesoSessionSnapshot: number | null;
  mesocyclePhaseSnapshot: string | null;
  slotPlanSeedJson: unknown;
};

type InventoryExercise = {
  id: string;
  workoutId: string;
  exerciseId: string;
  exerciseName: string;
  orderIndex: number;
  section: string;
  isMainLift: boolean;
  aliases: string[];
  primaryMuscles: string[];
  secondaryMuscles: string[];
};

type InventorySet = {
  id: string;
  workoutExerciseId: string;
  setIndex: number;
  targetReps: number | null;
  targetRepMin: number | null;
  targetRepMax: number | null;
  targetRpe: number | null;
  targetLoad: number | null;
  actualReps: number | null;
  actualLoad: number | null;
  actualRpe: number | null;
  logCompletedAt: Date | null;
  setIntent: "WORK" | "WARMUP" | null;
  wasSkipped: boolean | null;
};

async function runPreMigrationInventory(pool: Pool): Promise<void> {
  const [workouts, exercises, sets] = await Promise.all([
    pool.query<InventoryWorkout>(`
      SELECT w."id", w."userId", u."email" AS "ownerEmail", w."completedAt",
        w."scheduledDate", w."revision", w."selectionMode"::text AS "selectionMode",
        w."sessionIntent"::text AS "sessionIntent", w."selectionMetadata", w."advancesSplit",
        w."templateId", w."mesocycleId", w."mesocycleWeekSnapshot", w."mesoSessionSnapshot",
        w."mesocyclePhaseSnapshot"::text AS "mesocyclePhaseSnapshot", m."slotPlanSeedJson"
      FROM "Workout" w
      JOIN "User" u ON u."id" = w."userId"
      LEFT JOIN "Mesocycle" m ON m."id" = w."mesocycleId"
      WHERE w."status" = 'COMPLETED'
      ORDER BY w."id"
    `),
    pool.query<InventoryExercise>(`
      SELECT we."id", we."workoutId", we."exerciseId", e."name" AS "exerciseName",
        we."orderIndex", we."section"::text AS "section", we."isMainLift",
        COALESCE((SELECT json_agg(a."alias" ORDER BY a."alias") FROM "ExerciseAlias" a
          WHERE a."exerciseId" = e."id"), '[]'::json) AS aliases,
        COALESCE((SELECT json_agg(m."name" ORDER BY m."name") FROM "ExerciseMuscle" em
          JOIN "Muscle" m ON m."id" = em."muscleId"
          WHERE em."exerciseId" = e."id" AND em."role" = 'PRIMARY'), '[]'::json) AS "primaryMuscles",
        COALESCE((SELECT json_agg(m."name" ORDER BY m."name") FROM "ExerciseMuscle" em
          JOIN "Muscle" m ON m."id" = em."muscleId"
          WHERE em."exerciseId" = e."id" AND em."role" = 'SECONDARY'), '[]'::json) AS "secondaryMuscles"
      FROM "WorkoutExercise" we JOIN "Exercise" e ON e."id" = we."exerciseId"
      JOIN "Workout" w ON w."id" = we."workoutId" AND w."status" = 'COMPLETED'
      ORDER BY we."workoutId", we."orderIndex", we."id"
    `),
    pool.query<InventorySet>(`
      SELECT ws."id", ws."workoutExerciseId", ws."setIndex", ws."targetReps",
        ws."targetRepMin", ws."targetRepMax", ws."targetRpe", ws."targetLoad",
        log."actualReps", log."actualLoad", log."actualRpe",
        log."completedAt" AS "logCompletedAt", log."setIntent"::text AS "setIntent",
        log."wasSkipped"
      FROM "WorkoutSet" ws
      JOIN "WorkoutExercise" we ON we."id" = ws."workoutExerciseId"
      JOIN "Workout" w ON w."id" = we."workoutId" AND w."status" = 'COMPLETED'
      LEFT JOIN LATERAL (
        SELECT sl.* FROM "SetLog" sl WHERE sl."workoutSetId" = ws."id"
        ORDER BY sl."completedAt" DESC LIMIT 1
      ) log ON true
      ORDER BY ws."workoutExerciseId", ws."setIndex", ws."id"
    `),
  ]);

  const exercisesByWorkout = new Map<string, InventoryExercise[]>();
  for (const exercise of exercises.rows) {
    exercisesByWorkout.set(exercise.workoutId, [
      ...(exercisesByWorkout.get(exercise.workoutId) ?? []),
      exercise,
    ]);
  }
  const setsByExercise = new Map<string, InventorySet[]>();
  for (const set of sets.rows) {
    setsByExercise.set(set.workoutExerciseId, [
      ...(setsByExercise.get(set.workoutExerciseId) ?? []),
      set,
    ]);
  }

  const summary = {
    mode: "projected_pre_migration_inventory",
    writes: 0,
    completedWorkoutCandidates: workouts.rows.length,
    sufficientEvidence: 0,
    invalidReceipt: 0,
    invalidSeed: 0,
    invalidStimulus: 0,
    invalidHistory: 0,
    invalidLogs: 0,
    expectedLegacyDerived: 0,
    expectedUnproducible: 0,
    estimatedPayloadBytes: 0,
    failures: [] as Array<{ workoutId: string; reason: string }>,
  };

  for (const workout of workouts.rows) {
    const receipt = readSessionDecisionReceipt(workout.selectionMetadata);
    const hasReceiptProperty = Boolean(
      workout.selectionMetadata &&
        typeof workout.selectionMetadata === "object" &&
        "sessionDecisionReceipt" in workout.selectionMetadata,
    );
    if (hasReceiptProperty && !receipt) {
      summary.invalidReceipt += 1;
      summary.expectedUnproducible += 1;
      summary.failures.push({ workoutId: workout.id, reason: "invalid_receipt" });
      continue;
    }
    if (workout.slotPlanSeedJson != null) {
      const { parseSlotPlanSeedJson } = await import("@/lib/api/slot-plan-seed-parser");
      if (!parseSlotPlanSeedJson(workout.slotPlanSeedJson)) {
        summary.invalidSeed += 1;
        summary.expectedUnproducible += 1;
        summary.failures.push({ workoutId: workout.id, reason: "invalid_seed" });
        continue;
      }
    }

    const workoutExercises = exercisesByWorkout.get(workout.id) ?? [];
    let stimulusValid = true;
    for (const exercise of workoutExercises) {
      try {
        buildExerciseStimulusSnapshot(
          {
            id: exercise.exerciseId,
            name: exercise.exerciseName,
            aliases: exercise.aliases,
            primaryMuscles: exercise.primaryMuscles,
            secondaryMuscles: exercise.secondaryMuscles,
          },
          "legacy_derived",
        );
      } catch {
        stimulusValid = false;
        break;
      }
    }
    if (!stimulusValid) {
      summary.invalidStimulus += 1;
      summary.expectedUnproducible += 1;
      summary.failures.push({ workoutId: workout.id, reason: "invalid_stimulus" });
      continue;
    }
    const evidenceExercises = workoutExercises.map((exercise) => ({
      workoutExerciseId: exercise.id,
      exerciseId: exercise.exerciseId,
      exerciseName: exercise.exerciseName,
      orderIndex: exercise.orderIndex,
      section: exercise.section,
      isMainLift: exercise.isMainLift,
      sets: (setsByExercise.get(exercise.id) ?? []).map((set) => ({
        workoutSetId: set.id,
        setIndex: set.setIndex,
        setIntent: set.setIntent ?? "WORK",
        targetReps: set.targetReps,
        targetRepMin: set.targetRepMin,
        targetRepMax: set.targetRepMax,
        targetRpe: set.targetRpe,
        targetLoad: set.targetLoad,
        wasLogged: set.logCompletedAt != null,
        wasSkipped: set.wasSkipped === true,
        actualReps: set.actualReps,
        actualLoad: set.actualLoad,
        actualRpe: set.actualRpe,
        completedAt: set.logCompletedAt?.toISOString() ?? null,
      })),
    }));
    if (
      evidenceExercises.length === 0 ||
      !evidenceExercises.some((exercise) => exercise.sets.some((set) => set.wasLogged))
    ) {
      summary.invalidLogs += 1;
      summary.expectedUnproducible += 1;
      summary.failures.push({ workoutId: workout.id, reason: "insufficient_logs" });
      continue;
    }

    const semantics = deriveSessionSemantics({
      advancesSplit: workout.advancesSplit,
      selectionMetadata: workout.selectionMetadata,
      selectionMode: workout.selectionMode,
      sessionIntent: workout.sessionIntent,
      templateId: workout.templateId,
      mesocyclePhase: workout.mesocyclePhaseSnapshot,
    });
    const slot = readSessionSlotSnapshot(workout.selectionMetadata);
    const contract = buildPostSessionReviewContract({
      workoutIdentity: {
        userId: workout.userId,
        ownerEmail: workout.ownerEmail,
        workoutId: workout.id,
        status: "COMPLETED",
        revision: workout.revision,
        scheduledDate: workout.scheduledDate.toISOString(),
        selectionMode: workout.selectionMode,
        sessionIntent: workout.sessionIntent,
        advancesSplit: workout.advancesSplit,
        mesocycleId: workout.mesocycleId,
        mesocycleWeekSnapshot: workout.mesocycleWeekSnapshot,
        mesoSessionSnapshot: workout.mesoSessionSnapshot,
        mesocyclePhaseSnapshot: workout.mesocyclePhaseSnapshot,
        slotId: slot?.slotId ?? null,
      },
      sourceTruth: {
        setLogsAvailable: true,
        workoutStructureAvailable: true,
        sessionDecisionReceiptAvailable: Boolean(receipt),
      },
      sessionSemantics: {
        kind: semantics.kind,
        isDeload: semantics.isDeload,
        countsTowardWeeklyVolume: semantics.countsTowardWeeklyVolume,
        countsTowardProgressionHistory: semantics.countsTowardProgressionHistory,
        countsTowardPerformanceHistory: semantics.countsTowardPerformanceHistory,
        updatesProgressionAnchor: semantics.updatesProgressionAnchor,
        reasons: semantics.reasons.map((reason) => reason.code),
      },
      exercises: evidenceExercises,
      boundaryNotes: ["projected pre-migration inventory; no persisted snapshot was read or written"],
    });
    summary.sufficientEvidence += 1;
    summary.expectedLegacyDerived += 1;
    summary.estimatedPayloadBytes += Buffer.byteLength(JSON.stringify(contract));
  }

  console.log(JSON.stringify(summary, null, 2));
}

async function main() {
  if (inventoryOnly) {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
      await runPreMigrationInventory(pool);
    } finally {
      await pool.end();
    }
    return;
  }
  const [producerModule, snapshotModule] = await Promise.all([
    import("@/lib/api/post-session-review-producer"),
    import("@/lib/api/post-session-review-snapshot"),
  ]);
  const { prisma } = await import("@/lib/db/prisma");
  let afterId = initialAfterId;
  while (summary.scanned < limit) {
    const take = Math.min(batchSize, limit - summary.scanned);
    const workouts = await prisma.workout.findMany({
      where: {
        status: "COMPLETED",
        ...(afterId ? { id: { gt: afterId } } : {}),
      },
      orderBy: { id: "asc" },
      take,
      select: {
        id: true,
        userId: true,
        completedAt: true,
        postSessionReviewSnapshot: {
          select: { provenance: true, payloadHash: true },
        },
      },
    });
    if (workouts.length === 0) break;

    for (const workout of workouts) {
      summary.scanned += 1;
      afterId = workout.id;
      summary.lastScannedId = workout.id;
      const existing = workout.postSessionReviewSnapshot;
      if (existing) {
        if (existing.provenance === "exact") summary.exactExisting += 1;
        else summary.legacyDerivedExisting += 1;
        countHash(existing.payloadHash);
        continue;
      }

      try {
        const current = await producerModule.produceCurrentPostSessionReviewInterpretation(
          workout.userId,
          workout.id
        );
        if (current.status !== "ready") {
          if (current.reason === "invalid_contract") summary.invalidCurrentEvidence += 1;
          else summary.legacyUnknownUnproducible += 1;
          summary.failures.push({ workoutId: workout.id, reason: current.reason });
          continue;
        }
        const evidenceFingerprint = await snapshotModule.buildPostSessionReviewEvidenceFingerprint(prisma, {
          userId: workout.userId,
          workoutId: workout.id,
        });
        if (!evidenceFingerprint) {
          summary.invalidCurrentEvidence += 1;
          summary.failures.push({
            workoutId: workout.id,
            reason: "evidence_fingerprint_unavailable",
          });
          continue;
        }
        const payloadHash = snapshotModule.hashPostSessionReviewValue(current.contract);
        countHash(payloadHash);
        summary.legacyDerivedCandidate += 1;

        if (write) {
          await prisma.$transaction((tx) =>
            snapshotModule.createPostSessionReviewSnapshotInTransaction(tx, {
              userId: workout.userId,
              workoutId: workout.id,
              provenance: "legacy_derived",
              finalizedAt: workout.completedAt ?? undefined,
            })
          );
          summary.written += 1;
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        if (
          reason === "POST_SESSION_REVIEW_SNAPSHOT_CONFLICT" ||
          reason.includes("Unique constraint")
        ) {
          summary.writeConflicts += 1;
        } else {
          summary.invalidCurrentEvidence += 1;
        }
        summary.failures.push({ workoutId: workout.id, reason });
      }
    }

    if (workouts.length < take) break;
  }

  console.log(JSON.stringify(summary, null, 2));
}

runWithRolloutEnvironment(
  { argv: process.argv.slice(2), allowWrite: true },
  async (environment) => {
    console.log(JSON.stringify({ environment: sanitizedRolloutEnvironment(environment) }));
    try {
      await main();
    } finally {
      if (!inventoryOnly) {
        const { prisma } = await import("@/lib/db/prisma");
        await prisma.$disconnect();
      }
    }
  },
).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
