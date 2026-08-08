import type { Prisma } from "@prisma/client";
import type { WorkoutExercise, WorkoutPlan, WorkoutSet } from "@/lib/engine/types";
import {
  extractSessionAuditSnapshot,
} from "@/lib/evidence/session-audit-snapshot";
import { extractSessionDecisionReceipt } from "@/lib/evidence/session-decision-receipt";
import {
  attachRuntimeEditReconciliation,
  readRuntimeEditReconciliation,
  type SaveableSelectionMetadata,
} from "@/lib/ui/selection-metadata";
import {
  parseAcceptedSeedPayload,
  parseSlotPlanSeedJson,
} from "../slot-plan-seed-parser";
import {
  applySessionCapacityReduction,
  fingerprintSessionCapacityWorkout,
} from "../template-session/session-capacity-reduction";
import { attachSessionCapacityReductionReconciliation } from "../runtime-edit-reconciliation";

type SaveExerciseInput = {
  section: "WARMUP" | "MAIN" | "ACCESSORY";
  exerciseId: string;
  sets: Array<{
    setIndex: number;
    targetReps: number;
    targetRepRange?: { min: number; max: number };
    targetRpe?: number;
    targetLoad?: number;
    restSeconds?: number;
  }>;
};

type ActiveCapacityMesocycle = {
  id: string;
  state: string;
  slotPlanSeedJson: Prisma.JsonValue | null;
  currentSeedRevision: {
    id: string;
    revision: number;
    seedPayload: Prisma.JsonValue;
    payloadHash: string | null;
  } | null;
};

function makeExercise(input: {
  exerciseId: string;
  exerciseName: string;
  orderIndex: number;
  section: "warmup" | "main" | "accessory";
  sets: WorkoutSet[];
}): WorkoutExercise {
  return {
    id: `${input.section}:${input.orderIndex}:${input.exerciseId}`,
    exercise: {
      id: input.exerciseId,
      name: input.exerciseName,
      movementPatterns: [],
      splitTags: [],
      jointStress: "low",
      equipment: [],
    },
    orderIndex: input.orderIndex,
    isMainLift: input.section === "main",
    role: input.section,
    sets: input.sets,
  };
}

function buildPlannedWorkout(
  workoutId: string,
  selectionMetadata: unknown,
): WorkoutPlan | null {
  const generated = extractSessionAuditSnapshot(selectionMetadata)?.generated;
  if (!generated) {
    return null;
  }
  const exercises = generated.exercises.map((exercise) => {
    if (
      exercise.prescribedSets.length !== exercise.prescribedSetCount ||
      exercise.prescribedSets.some((set) => set.targetReps == null)
    ) {
      return null;
    }
    return makeExercise({
      exerciseId: exercise.exerciseId,
      exerciseName: exercise.exerciseName,
      orderIndex: exercise.orderIndex,
      section: exercise.section,
      sets: exercise.prescribedSets.map((set) => ({
        setIndex: set.setIndex,
        targetReps: set.targetReps!,
        targetRepRange: set.targetRepRange,
        targetRpe: set.targetRpe,
        targetLoad: set.targetLoad,
        restSeconds: set.restSeconds,
        role:
          set.role === "warmup" ||
          set.role === "main" ||
          set.role === "accessory"
            ? set.role
            : undefined,
      })),
    });
  });
  if (exercises.some((exercise) => exercise == null)) {
    return null;
  }
  const typed = exercises as WorkoutExercise[];
  return {
    id: workoutId,
    scheduledDate: "",
    warmup: typed.filter((exercise) => exercise.role === "warmup"),
    mainLifts: typed.filter((exercise) => exercise.role === "main"),
    accessories: typed.filter((exercise) => exercise.role === "accessory"),
    estimatedMinutes: 0,
  };
}

export function fingerprintShortTodaySaveExercises(
  exercises: SaveExerciseInput[] | undefined,
): string | null {
  if (!exercises?.length) {
    return null;
  }
  const rows = exercises.map((exercise, orderIndex) =>
    makeExercise({
      exerciseId: exercise.exerciseId,
      exerciseName: "",
      orderIndex,
      section: exercise.section.toLowerCase() as
        | "warmup"
        | "main"
        | "accessory",
      sets: exercise.sets,
    }),
  );
  return fingerprintSessionCapacityWorkout({
    id: "",
    scheduledDate: "",
    warmup: rows.filter((exercise) => exercise.role === "warmup"),
    mainLifts: rows.filter((exercise) => exercise.role === "main"),
    accessories: rows.filter((exercise) => exercise.role === "accessory"),
    estimatedMinutes: 0,
  });
}

function stripCapacityOperation(
  selectionMetadata: unknown,
): SaveableSelectionMetadata {
  const source =
    selectionMetadata &&
    typeof selectionMetadata === "object" &&
    !Array.isArray(selectionMetadata)
      ? ({ ...(selectionMetadata as Record<string, unknown>) } as SaveableSelectionMetadata)
      : {};
  const reconciliation = readRuntimeEditReconciliation(source);
  const retainedOps =
    reconciliation?.ops.filter(
      (operation) => operation.kind !== "reduce_session_capacity",
    ) ?? [];
  delete source.runtimeEditReconciliation;
  if (reconciliation && retainedOps.length > 0) {
    return attachRuntimeEditReconciliation(source, {
      ...reconciliation,
      ops: retainedOps,
    });
  }
  return source;
}

export function validateAndCanonicalizeShortTodaySave(input: {
  workoutId: string;
  selectionMetadata: unknown;
  exercises: SaveExerciseInput[] | undefined;
  activeMesocycle: ActiveCapacityMesocycle | null;
}): SaveableSelectionMetadata {
  if (!input.exercises?.length) {
    throw new Error("SESSION_CAPACITY_REDUCTION_INVALID");
  }
  const plannedWorkout = buildPlannedWorkout(
    input.workoutId,
    input.selectionMetadata,
  );
  const receipt = extractSessionDecisionReceipt(input.selectionMetadata);
  const active = input.activeMesocycle;
  const currentSeed = active?.currentSeedRevision
    ? parseAcceptedSeedPayload(active.currentSeedRevision.seedPayload)
    : null;
  const compatibilitySeed = active
    ? parseSlotPlanSeedJson(active.slotPlanSeedJson)
    : null;
  const seedProvenance = receipt?.sessionProvenance?.seedProvenance;
  if (
    !plannedWorkout ||
    !receipt?.sessionSlot?.slotId ||
    !receipt.cycleContext ||
    !active ||
    active.state !== "ACTIVE_ACCUMULATION" ||
    receipt.cycleContext.isDeload ||
    receipt.sessionProvenance?.compositionSource !==
      "persisted_slot_plan_seed" ||
    receipt.sessionProvenance.mesocycleId !== active.id ||
    !active.currentSeedRevision ||
    !currentSeed ||
    !compatibilitySeed?.acceptedPlannerIntent
      ?.sessionCapacityReductionManifest ||
    !seedProvenance ||
    seedProvenance.revisionId !== active.currentSeedRevision.id ||
    seedProvenance.revision !== active.currentSeedRevision.revision ||
    seedProvenance.hash !== active.currentSeedRevision.payloadHash
  ) {
    throw new Error("SESSION_CAPACITY_REDUCTION_UNAVAILABLE");
  }
  const executableSeedSlots = currentSeed.slots.map((slot) => ({
    slotId: slot.slotId,
    exercises: slot.exercises.map((exercise) => {
      if (exercise.setCount == null) {
        throw new Error("SESSION_CAPACITY_REDUCTION_UNAVAILABLE");
      }
      return {
        exerciseId: exercise.exerciseId,
        role: exercise.role,
        setCount: exercise.setCount,
      };
    }),
  }));
  const reduction = applySessionCapacityReduction({
    plannedWorkout,
    acceptedReductionManifest:
      compatibilitySeed.acceptedPlannerIntent.sessionCapacityReductionManifest,
    mode: "short_today",
    week: receipt.cycleContext.weekInMeso,
    slotId: receipt.sessionSlot.slotId,
    isAccumulationPrimary: true,
    seedRevision: {
      id: active.currentSeedRevision.id,
      revision: active.currentSeedRevision.revision,
      payloadHash: active.currentSeedRevision.payloadHash,
    },
    executableSeedSlots,
  });
  if (reduction.status !== "applied") {
    throw new Error(
      `SESSION_CAPACITY_REDUCTION_UNAVAILABLE:${reduction.status === "unavailable" ? reduction.reason : reduction.status}`,
    );
  }
  if (
    reduction.evidence.workoutId !== input.workoutId ||
    fingerprintShortTodaySaveExercises(input.exercises) !==
      reduction.evidence.offeredStructureFingerprint
  ) {
    throw new Error("SESSION_CAPACITY_REDUCTION_INVALID");
  }
  return attachSessionCapacityReductionReconciliation({
    selectionMetadata: stripCapacityOperation(input.selectionMetadata),
    evidence: reduction.evidence,
  });
}
