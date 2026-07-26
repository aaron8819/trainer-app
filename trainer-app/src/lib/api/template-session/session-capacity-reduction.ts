import { createHash } from "node:crypto";
import { estimateWorkoutMinutes } from "@/lib/engine/template-session";
import type { WorkoutExercise, WorkoutPlan } from "@/lib/engine/types";
import {
  fingerprintSessionCapacityExecutableRows,
  SESSION_CAPACITY_REDUCTION_TRANSFORM_VERSION,
  type SessionCapacityOmissionClass,
  type SessionCapacityProtectedClaim,
  type SessionCapacityReductionManifest,
} from "@/lib/engine/planning/v2";

export type SessionCapacityMode = "as_planned" | "short_today";

export type SessionCapacityUnavailableReason =
  | "already_streamlined"
  | "older_plan"
  | "unsupported_session"
  | "stale_manifest"
  | "pain_or_equipment_conflict"
  | "integrity_failure"
  | "must_select_before_start";

export type SessionCapacityOmission = {
  exerciseId: string;
  exerciseName: string;
  plannedSetCount: number;
  retainedSetCount: number;
  omittedSetIndexes: number[];
  omissionClass: Exclude<SessionCapacityOmissionClass, "none">;
  yieldOrder: number;
};

export type SessionCapacityReductionEvidence = {
  workoutId: string;
  mode: "short_today";
  reason: "user_selected_temporary_capacity";
  transformVersion: typeof SESSION_CAPACITY_REDUCTION_TRANSFORM_VERSION;
  seedRevisionId: string;
  seedRevisionNumber: number;
  seedPayloadHash: string;
  executableRowsHash: string;
  plannedStructureFingerprint: string;
  offeredStructureFingerprint: string;
  omitted: SessionCapacityOmission[];
  retainedProtectionClaims: SessionCapacityProtectedClaim[];
};

export type SessionCapacityReductionResult =
  | {
      status: "as_planned";
      workout: WorkoutPlan;
    }
  | {
      status: "unavailable";
      reason: SessionCapacityUnavailableReason;
      workout: WorkoutPlan;
    }
  | {
      status: "applied";
      workout: WorkoutPlan;
      evidence: SessionCapacityReductionEvidence;
      preview: {
        removedExercises: Array<{ exerciseId: string; exerciseName: string }>;
        removedSetCount: number;
        retainedProtectionSummary: string;
        estimatedMinutes: number;
        redistributionNotice: string;
      };
    };

type ExecutableSlot = {
  slotId: string;
  exercises: Array<{
    exerciseId: string;
    role: "CORE_COMPOUND" | "ACCESSORY";
    setCount: number;
  }>;
};

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function fingerprintSessionCapacityWorkout(workout: WorkoutPlan): string {
  const normalizeExercise = (exercise: WorkoutExercise) => ({
    exerciseId: exercise.exercise.id,
    role: exercise.role ?? (exercise.isMainLift ? "main" : "accessory"),
    sets: exercise.sets.map((set) => ({
      setIndex: set.setIndex,
      targetReps: set.targetReps,
      targetRepRange: set.targetRepRange,
      targetRpe: set.targetRpe,
      targetLoad: set.targetLoad,
      restSeconds: set.restSeconds,
    })),
  });
  return createHash("sha256")
    .update(
      stableJson({
        warmup: workout.warmup.map(normalizeExercise),
        mainLifts: workout.mainLifts.map(normalizeExercise),
        accessories: workout.accessories.map(normalizeExercise),
      }),
    )
    .digest("hex");
}

function unavailable(
  workout: WorkoutPlan,
  reason: SessionCapacityUnavailableReason,
): SessionCapacityReductionResult {
  return { status: "unavailable", reason, workout };
}

function retainedProtectionClaims(
  rows: Array<{ protectedClaims: SessionCapacityProtectedClaim[] }>,
): SessionCapacityProtectedClaim[] {
  return rows
    .flatMap((row) => row.protectedClaims)
    .filter(
      (claim, index, claims) =>
        claims.findIndex(
          (candidate) =>
            candidate.kind === claim.kind &&
            candidate.minimumRetainedSetCount ===
              claim.minimumRetainedSetCount,
        ) === index,
    );
}

export function applySessionCapacityReduction(input: {
  plannedWorkout: WorkoutPlan;
  acceptedReductionManifest?: SessionCapacityReductionManifest;
  mode: SessionCapacityMode;
  week: number;
  slotId?: string | null;
  isAccumulationPrimary: boolean;
  isWorkoutUncreated?: boolean;
  hasPainOrEquipmentConflict?: boolean;
  seedRevision?: {
    id: string;
    revision: number;
    payloadHash: string | null;
  } | null;
  executableSeedSlots?: ExecutableSlot[] | null;
}): SessionCapacityReductionResult {
  if (input.mode === "as_planned") {
    return { status: "as_planned", workout: input.plannedWorkout };
  }
  if (input.isWorkoutUncreated === false) {
    return unavailable(input.plannedWorkout, "must_select_before_start");
  }
  if (!input.isAccumulationPrimary || !input.slotId) {
    return unavailable(input.plannedWorkout, "unsupported_session");
  }
  if (input.hasPainOrEquipmentConflict) {
    return unavailable(input.plannedWorkout, "pain_or_equipment_conflict");
  }
  const manifest = input.acceptedReductionManifest;
  if (!manifest || !input.seedRevision || !input.executableSeedSlots) {
    return unavailable(input.plannedWorkout, "older_plan");
  }
  if (
    input.seedRevision.revision !== manifest.seedRevisionNumber ||
    input.seedRevision.payloadHash == null
  ) {
    return unavailable(input.plannedWorkout, "stale_manifest");
  }
  const executableRowsHash = fingerprintSessionCapacityExecutableRows(
    input.executableSeedSlots,
  );
  if (executableRowsHash !== manifest.executableRowsHash) {
    return unavailable(input.plannedWorkout, "stale_manifest");
  }
  const variant = manifest.variants.find(
    (candidate) =>
      candidate.week === input.week && candidate.slotId === input.slotId,
  );
  const executableSlot = input.executableSeedSlots.find(
    (candidate) => candidate.slotId === input.slotId,
  );
  if (!variant || !executableSlot) {
    return unavailable(input.plannedWorkout, "stale_manifest");
  }
  const plannedExercises = [
    ...input.plannedWorkout.mainLifts,
    ...input.plannedWorkout.accessories,
  ];
  if (
    variant.rows.length !== executableSlot.exercises.length ||
    variant.rows.length !== plannedExercises.length
  ) {
    return unavailable(input.plannedWorkout, "integrity_failure");
  }
  const manifestRows = new Map(
    variant.rows.map((row) => [row.exerciseId, row]),
  );
  const plannedByExerciseId = new Map(
    plannedExercises.map((exercise) => [exercise.exercise.id, exercise]),
  );
  if (plannedByExerciseId.size !== plannedExercises.length) {
    return unavailable(input.plannedWorkout, "integrity_failure");
  }
  for (const executable of executableSlot.exercises) {
    const row = manifestRows.get(executable.exerciseId);
    const planned = plannedByExerciseId.get(executable.exerciseId);
    if (
      !row ||
      row.plannedSetCount !== executable.setCount ||
      !planned ||
      planned.sets.length !== executable.setCount ||
      row.protectedClaims.some(
        (claim) => row.shortSetCount < claim.minimumRetainedSetCount,
      )
    ) {
      return unavailable(input.plannedWorkout, "integrity_failure");
    }
  }

  const omitted: SessionCapacityOmission[] = [];
  const reduceSection = (exercises: WorkoutExercise[]): WorkoutExercise[] =>
    exercises.flatMap((exercise) => {
      const row = manifestRows.get(exercise.exercise.id);
      if (!row) {
        return [];
      }
      if (row.shortSetCount < row.plannedSetCount) {
        if (row.omissionClass === "none" || row.yieldOrder == null) {
          return [];
        }
        omitted.push({
          exerciseId: exercise.exercise.id,
          exerciseName: exercise.exercise.name,
          plannedSetCount: row.plannedSetCount,
          retainedSetCount: row.shortSetCount,
          omittedSetIndexes: exercise.sets
            .slice(row.shortSetCount)
            .map((set) => set.setIndex),
          omissionClass: row.omissionClass,
          yieldOrder: row.yieldOrder,
        });
      }
      return row.shortSetCount > 0
        ? [{ ...exercise, sets: exercise.sets.slice(0, row.shortSetCount) }]
        : [];
    });

  const mainLifts = reduceSection(input.plannedWorkout.mainLifts);
  const accessories = reduceSection(input.plannedWorkout.accessories);
  const removedSetCount = omitted.reduce(
    (sum, row) => sum + row.plannedSetCount - row.retainedSetCount,
    0,
  );
  const removedExerciseCount = omitted.filter(
    (row) => row.retainedSetCount === 0,
  ).length;
  if (removedExerciseCount === 0 && removedSetCount < 3) {
    return unavailable(input.plannedWorkout, "already_streamlined");
  }
  if (mainLifts.length + accessories.length < 3) {
    return unavailable(input.plannedWorkout, "integrity_failure");
  }
  const workout = {
    ...input.plannedWorkout,
    mainLifts,
    accessories,
    estimatedMinutes: estimateWorkoutMinutes([
      ...input.plannedWorkout.warmup,
      ...mainLifts,
      ...accessories,
    ]),
  };
  const evidence: SessionCapacityReductionEvidence = {
    workoutId: input.plannedWorkout.id,
    mode: "short_today",
    reason: "user_selected_temporary_capacity",
    transformVersion: SESSION_CAPACITY_REDUCTION_TRANSFORM_VERSION,
    seedRevisionId: input.seedRevision.id,
    seedRevisionNumber: input.seedRevision.revision,
    seedPayloadHash: input.seedRevision.payloadHash,
    executableRowsHash,
    plannedStructureFingerprint: fingerprintSessionCapacityWorkout(
      input.plannedWorkout,
    ),
    offeredStructureFingerprint: fingerprintSessionCapacityWorkout(workout),
    omitted: omitted.sort(
      (left, right) =>
        left.yieldOrder - right.yieldOrder ||
        left.exerciseId.localeCompare(right.exerciseId),
    ),
    retainedProtectionClaims: retainedProtectionClaims(variant.rows),
  };
  return {
    status: "applied",
    workout,
    evidence,
    preview: {
      removedExercises: evidence.omitted
        .filter((row) => row.retainedSetCount === 0)
        .map((row) => ({
          exerciseId: row.exerciseId,
          exerciseName: row.exerciseName,
        })),
      removedSetCount,
      retainedProtectionSummary:
        "Primary anchors, required movement roles, direct floors, and protected exposures are retained.",
      estimatedMinutes: workout.estimatedMinutes,
      redistributionNotice:
        "Nothing removed today will automatically move to another workout.",
    },
  };
}
