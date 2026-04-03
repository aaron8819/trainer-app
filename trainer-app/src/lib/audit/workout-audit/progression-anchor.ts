import { prisma } from "@/lib/db/prisma";
import { PERFORMED_WORKOUT_STATUSES } from "@/lib/workout-status";
import { computeDoubleProgressionDecision } from "@/lib/engine/progression";
import { buildCanonicalProgressionEvaluationInput } from "@/lib/progression/canonical-progression-input";
import { derivePerformedExerciseSemantics } from "@/lib/session-semantics/performed-exercise-semantics";
import { resolveTargetRepRange } from "@/lib/session-semantics/target-evaluation";
import { isProgressionEligibleWorkout } from "@/lib/progression/progression-eligibility";
import { resolvePersistedOrReconstructedSessionAuditSnapshot } from "@/lib/evidence/session-audit-snapshot";
import { resolveAuditCanonicalSemantics } from "./canonical-semantics";
import type { ProgressionAnchorAuditPayload } from "./types";
import { PROGRESSION_ANCHOR_AUDIT_PAYLOAD_VERSION } from "./constants";

function resolveProgressionEquipment(
  equipment: string[]
): "barbell" | "dumbbell" | "cable" | "other" {
  const normalized = equipment.map((entry) => entry.trim().toLowerCase());
  if (normalized.includes("barbell")) return "barbell";
  if (normalized.includes("dumbbell")) return "dumbbell";
  if (normalized.includes("cable")) return "cable";
  return "other";
}

function buildConfidenceNotes(selectionMode?: string | null): string[] {
  if (selectionMode === "INTENT") {
    return ["INTENT history kept full canonical progression confidence."];
  }
  if (selectionMode === "MANUAL") {
    return ["MANUAL session discounted for progression confidence."];
  }
  return selectionMode ? [`${selectionMode} history discounted for progression confidence.`] : [];
}

function buildHistorySession(entry: {
  workout: { selectionMode: string | null };
}) {
  const selectionMode = entry.workout.selectionMode ?? undefined;
  const confidence =
    selectionMode === "INTENT" ? 1 : selectionMode === "MANUAL" ? 0.7 : 0.8;
  return {
    selectionMode: selectionMode as "INTENT" | "MANUAL" | undefined,
    confidence,
    confidenceNotes: buildConfidenceNotes(selectionMode),
  };
}

export async function buildProgressionAnchorAuditPayload(input: {
  userId: string;
  exerciseId: string;
  workoutId?: string;
}): Promise<ProgressionAnchorAuditPayload> {
  const rows = await prisma.workoutExercise.findMany({
    where: {
      exerciseId: input.exerciseId,
      workout: {
        userId: input.userId,
        status: { in: [...PERFORMED_WORKOUT_STATUSES] as never },
        ...(input.workoutId ? { id: input.workoutId } : {}),
      },
    },
    orderBy: [{ workout: { scheduledDate: "desc" } }, { workoutId: "desc" }],
    take: input.workoutId ? 1 : 8,
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

  const current =
    (input.workoutId ? rows[0] : eligibleRows[0]) ?? rows[0];
  if (!current) {
    throw new Error(`No performed workout found for exerciseId=${input.exerciseId}`);
  }

  const performedSemantics = derivePerformedExerciseSemantics({
    isMainLiftEligible: current.exercise.isMainLiftEligible,
    sets: current.sets.map((set) => ({
      setIndex: set.setIndex,
      targetLoad: set.targetLoad,
      actualLoad: set.logs[0]?.actualLoad ?? null,
      actualReps: set.logs[0]?.actualReps ?? null,
      actualRpe: set.logs[0]?.actualRpe ?? null,
      wasSkipped: set.logs[0]?.wasSkipped ?? false,
    })),
  });
  if (!performedSemantics) {
    throw new Error(`No progression signal sets found for exerciseId=${input.exerciseId}`);
  }

  const firstTarget = current.sets.find(
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
  const progressionInput = buildCanonicalProgressionEvaluationInput({
    lastSets: performedSemantics.signalSets,
    repRange: effectiveRepRange,
    equipment: resolveProgressionEquipment(
      current.exercise.exerciseEquipment.map((entry) => entry.equipment.type)
    ),
    workingSetLoad: performedSemantics.workingSetLoad ?? undefined,
    historySessions: priorEligibleRows.map(buildHistorySession),
  });
  const decision = computeDoubleProgressionDecision(
    progressionInput.lastSets,
    progressionInput.repRange,
    progressionInput.equipment,
    progressionInput.decisionOptions
  );
  if (!decision) {
    throw new Error(`Unable to compute progression decision for exerciseId=${input.exerciseId}`);
  }

  const { sessionSnapshot, snapshotSource } =
    resolvePersistedOrReconstructedSessionAuditSnapshot({
      selectionMetadata: current.workout.selectionMetadata,
      workoutId: current.workout.id,
      revision: current.workout.revision ?? undefined,
      status: current.workout.status,
      advancesSplit: current.workout.advancesSplit,
      selectionMode: current.workout.selectionMode,
      sessionIntent: current.workout.sessionIntent,
      mesocycleId: current.workout.mesocycleId,
      mesocycleWeekSnapshot: current.workout.mesocycleWeekSnapshot,
      mesoSessionSnapshot: current.workout.mesoSessionSnapshot,
      mesocyclePhaseSnapshot: current.workout.mesocyclePhaseSnapshot,
    });
  const canonicalSemantics = resolveAuditCanonicalSemantics(sessionSnapshot);

  return {
    version: PROGRESSION_ANCHOR_AUDIT_PAYLOAD_VERSION,
    workoutId: current.workout.id,
    exerciseId: current.exerciseId,
    exerciseName: current.exercise.name,
    scheduledDate: current.workout.scheduledDate.toISOString(),
    selectionMode: current.workout.selectionMode ?? undefined,
    sessionIntent: current.workout.sessionIntent ?? undefined,
    sessionSnapshotSource: snapshotSource,
    sessionSnapshot,
    canonicalSemantics,
    trace: decision.trace,
  };
}
