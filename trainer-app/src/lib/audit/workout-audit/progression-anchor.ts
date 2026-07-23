import { prisma } from "@/lib/db/prisma";
import { PERFORMED_WORKOUT_STATUSES } from "@/lib/workout-status";
import { computeDoubleProgressionDecision } from "@/lib/engine/progression";
import {
  resolveCalibrationConfidenceScale,
  resolveLoadCalibrationPolicy,
  resolveProgressionEquipment,
  resolveValidLoadIncrement,
} from "@/lib/engine/load-calibration";
import { buildCanonicalProgressionEvaluationInput } from "@/lib/progression/canonical-progression-input";
import { derivePerformedExerciseSemantics } from "@/lib/session-semantics/performed-exercise-semantics";
import { resolveTargetRepRange } from "@/lib/session-semantics/target-evaluation";
import { isProgressionEligibleWorkout } from "@/lib/progression/progression-eligibility";
import { resolvePersistedOrReconstructedSessionAuditSnapshot } from "@/lib/evidence/session-audit-snapshot";
import { resolveAuditCanonicalSemantics } from "./canonical-semantics";
import type { ProgressionAnchorAuditPayload } from "./types";
import { PROGRESSION_ANCHOR_AUDIT_PAYLOAD_VERSION } from "./constants";

function buildConfidenceNotes(selectionMode?: string | null): string[] {
  if (selectionMode === "MANUAL") {
    return ["MANUAL session discounted for progression confidence."];
  }
  return [];
}

function buildHistorySession(entry: {
  exercise: { isMainLiftEligible?: boolean | null };
  workout: { id: string; scheduledDate: Date; selectionMode: string | null };
  sets: Array<{
    setIndex: number;
    targetLoad: number | null;
    targetReps: number | null;
    targetRepMin: number | null;
    targetRepMax: number | null;
    targetRpe: number | null;
    logs: Array<{
      actualLoad: number | null;
      actualReps: number | null;
      actualRpe: number | null;
      setIntent?: "WORK" | "WARMUP" | null;
      wasSkipped: boolean;
    }>;
  }>;
}) {
  const selectionMode = entry.workout.selectionMode ?? undefined;
  const confidence =
    selectionMode === "INTENT" ? 1 : selectionMode === "MANUAL" ? 0.7 : 0.8;
  const performedSemantics = derivePerformedExerciseSemantics({
    isMainLiftEligible: entry.exercise.isMainLiftEligible,
    sets: entry.sets.map((set) => ({
      setIndex: set.setIndex,
      targetLoad: set.targetLoad,
      targetReps: set.targetReps,
      targetRepMin: set.targetRepMin,
      targetRepMax: set.targetRepMax,
      targetRpe: set.targetRpe,
      actualLoad: set.logs[0]?.actualLoad ?? null,
      actualReps: set.logs[0]?.actualReps ?? null,
      actualRpe: set.logs[0]?.actualRpe ?? null,
      setIntent: set.logs[0]?.setIntent ?? "WORK",
      wasSkipped: set.logs[0]?.wasSkipped ?? false,
    })),
  });
  return {
    exposureId: entry.workout.id,
    date: entry.workout.scheduledDate.toISOString(),
    source: "exact_exercise_history" as const,
    selectionMode: selectionMode as "INTENT" | "MANUAL" | undefined,
    confidence,
    confidenceNotes: buildConfidenceNotes(selectionMode),
    sets: performedSemantics?.signalSets,
    representativeLoad: performedSemantics?.workingSetLoad ?? undefined,
    plannedWorkingSetCount: entry.sets.length,
  };
}

export async function buildProgressionAnchorAuditPayload(input: {
  userId: string;
  exerciseId: string;
  workoutId: string;
}): Promise<ProgressionAnchorAuditPayload> {
  const target = await prisma.workoutExercise.findFirst({
    where: {
      exerciseId: input.exerciseId,
      workout: {
        id: input.workoutId,
        userId: input.userId,
      },
    },
    include: {
      exercise: {
        include: {
          exerciseEquipment: {
            include: {
              equipment: true,
            },
          },
        },
      },
      workout: {
        select: {
          id: true,
          scheduledDate: true,
          revision: true,
          status: true,
          advancesSplit: true,
          selectionMode: true,
          sessionIntent: true,
          selectionMetadata: true,
          mesocycleId: true,
          mesocycleWeekSnapshot: true,
          mesoSessionSnapshot: true,
          mesocyclePhaseSnapshot: true,
        },
      },
      sets: {
        orderBy: { setIndex: "asc" },
        include: {
          logs: { orderBy: { completedAt: "desc" }, take: 1 },
        },
      },
    },
  });
  if (!target) {
    throw new Error(
      `No target workout prescription found for workoutId=${input.workoutId} exerciseId=${input.exerciseId}`
    );
  }

  const rows = await prisma.workoutExercise.findMany({
    where: {
      exerciseId: input.exerciseId,
      workout: {
        userId: input.userId,
        status: { in: [...PERFORMED_WORKOUT_STATUSES] as never },
        scheduledDate: { lte: target.workout.scheduledDate },
      },
    },
    orderBy: [{ workout: { scheduledDate: "desc" } }, { workoutId: "desc" }],
    take: 8,
    include: {
      exercise: {
        include: {
          exerciseEquipment: {
            include: {
              equipment: true,
            },
          },
        },
      },
      workout: {
        select: {
          id: true,
          scheduledDate: true,
          revision: true,
          status: true,
          advancesSplit: true,
          selectionMode: true,
          sessionIntent: true,
          selectionMetadata: true,
          mesocycleId: true,
          mesocycleWeekSnapshot: true,
          mesoSessionSnapshot: true,
          mesocyclePhaseSnapshot: true,
        },
      },
      sets: {
        orderBy: { setIndex: "asc" },
        include: {
          logs: { orderBy: { completedAt: "desc" }, take: 1 },
        },
      },
    },
  });

  const eligibleRows = rows.filter((entry) =>
    isProgressionEligibleWorkout({
      selectionMetadata: entry.workout.selectionMetadata,
      selectionMode: entry.workout.selectionMode,
      sessionIntent: entry.workout.sessionIntent,
    })
  );

  const targetExposure = rows.find((entry) => entry.workout.id === target.workout.id);
  const current = targetExposure ?? eligibleRows[0] ?? rows[0];
  if (!current) {
    throw new Error(
      `No performed progression exposure found before workoutId=${input.workoutId} exerciseId=${input.exerciseId}`
    );
  }

  const performedSemantics = derivePerformedExerciseSemantics({
    isMainLiftEligible: current.exercise.isMainLiftEligible,
    sets: current.sets.map((set) => ({
      setIndex: set.setIndex,
      targetLoad: set.targetLoad,
      targetReps: set.targetReps,
      targetRepMin: set.targetRepMin,
      targetRepMax: set.targetRepMax,
      targetRpe: set.targetRpe,
      actualLoad: set.logs[0]?.actualLoad ?? null,
      actualReps: set.logs[0]?.actualReps ?? null,
      actualRpe: set.logs[0]?.actualRpe ?? null,
      setIntent: set.logs[0]?.setIntent ?? "WORK",
      wasSkipped: set.logs[0]?.wasSkipped ?? false,
    })),
  });
  if (!performedSemantics) {
    throw new Error(`No progression signal sets found for exerciseId=${input.exerciseId}`);
  }

  const firstTarget = target.sets.find(
    (set) => set.targetReps != null || (set.targetRepMin != null && set.targetRepMax != null)
  );
  const repRange = resolveTargetRepRange({
    targetReps: firstTarget?.targetReps ?? undefined,
    targetRepRange:
      firstTarget?.targetRepMin != null && firstTarget?.targetRepMax != null
        ? {
            min: firstTarget.targetRepMin,
            max: firstTarget.targetRepMax,
          }
        : undefined,
  });
  const effectiveRepRange: [number, number] = repRange
    ? [repRange.min, repRange.max]
    : [8, 8];

  const priorEligibleRows = eligibleRows.filter(
    (entry) => entry.workout.id !== current.workout.id
  );
  const calibrationExercise = {
    equipment: current.exercise.exerciseEquipment.map((entry) => entry.equipment.type),
    isCompound: current.exercise.isCompound,
  };
  const calibrationPolicy = resolveLoadCalibrationPolicy(calibrationExercise);
  const calibrationConfidenceScale = resolveCalibrationConfidenceScale(
    calibrationPolicy,
    Math.max(priorEligibleRows.length, 1)
  );
  const progressionInput = buildCanonicalProgressionEvaluationInput({
    lastSets: performedSemantics.signalSets,
    repRange: effectiveRepRange,
    equipment: resolveProgressionEquipment(calibrationExercise),
    currentTarget: {
      reps: firstTarget?.targetReps ?? firstTarget?.targetRepMax ?? undefined,
      rpe: firstTarget?.targetRpe ?? undefined,
    },
    workingSetLoad: performedSemantics.workingSetLoad ?? undefined,
    historySessions: [buildHistorySession(current), ...priorEligibleRows.map(buildHistorySession)],
    calibrationConfidenceScale,
    calibrationConfidenceReason: calibrationPolicy.confidenceReason,
    loadIncrement: resolveValidLoadIncrement(calibrationExercise),
  });
  const decision = computeDoubleProgressionDecision(
    progressionInput.lastSets,
    progressionInput.repRange,
    progressionInput.equipment,
    {
      ...progressionInput.decisionOptions,
      promotionPolicy: {
        allowCatchUp: calibrationPolicy.allowCatchUp,
        overshootConfidenceScale: calibrationPolicy.overshootConfidenceScale,
      },
    }
  );
  if (!decision) {
    throw new Error(`Unable to compute progression decision for exerciseId=${input.exerciseId}`);
  }

  const { sessionSnapshot, snapshotSource } =
    resolvePersistedOrReconstructedSessionAuditSnapshot({
      selectionMetadata: target.workout.selectionMetadata,
      workoutId: target.workout.id,
      revision: target.workout.revision ?? undefined,
      status: target.workout.status,
      advancesSplit: target.workout.advancesSplit,
      selectionMode: target.workout.selectionMode,
      sessionIntent: target.workout.sessionIntent,
      mesocycleId: target.workout.mesocycleId,
      mesocycleWeekSnapshot: target.workout.mesocycleWeekSnapshot,
      mesoSessionSnapshot: target.workout.mesoSessionSnapshot,
      mesocyclePhaseSnapshot: target.workout.mesocyclePhaseSnapshot,
    });
  const canonicalSemantics = resolveAuditCanonicalSemantics(sessionSnapshot);

  return {
    version: PROGRESSION_ANCHOR_AUDIT_PAYLOAD_VERSION,
    workoutId: target.workout.id,
    exerciseId: target.exerciseId,
    exerciseName: target.exercise.name,
    scheduledDate: target.workout.scheduledDate.toISOString(),
    selectionMode: target.workout.selectionMode ?? undefined,
    sessionIntent: target.workout.sessionIntent ?? undefined,
    sessionSnapshotSource: snapshotSource,
    sessionSnapshot,
    canonicalSemantics,
    trace: decision.trace,
  };
}
