import {
  attachRuntimeEditReconciliation,
  attachWorkoutStructureState,
  buildWorkoutStructureState,
  readRuntimeEditReconciliation,
  type PersistedWorkoutStructureExerciseInput,
  type RuntimeEditDirectiveState,
  type RuntimeEditOperation,
  type RuntimeExerciseReplaceReason,
  type RuntimeEditReconciliation,
  type SaveableSelectionMetadata,
  type WorkoutStructureState,
} from "@/lib/ui/selection-metadata";
import type { ExerciseStimulusAccountingEvidence } from "@/lib/stimulus-accounting/snapshot";
import type { SessionCapacityReductionEvidence } from "./template-session/session-capacity-reduction";

const CONSERVATIVE_RUNTIME_EDIT_DIRECTIVES: RuntimeEditDirectiveState = {
  continuityAlias: "none",
  progressionAlias: "none",
  futureSessionGeneration: "ignore",
  futureSeedCarryForward: "ignore",
};

export type RuntimeEditMutation =
  | {
      kind: "add_exercise";
      workoutExerciseId: string;
      exerciseId: string;
      orderIndex: number;
      section: "WARMUP" | "MAIN" | "ACCESSORY";
      setCount: number;
      prescriptionSource:
        | "session_accessory_defaults"
        | "generic_accessory_fallback";
      stimulusAccounting?: ExerciseStimulusAccountingEvidence;
    }
  | {
      kind: "add_set";
      workoutExerciseId: string;
      exerciseId: string;
      workoutSetId: string;
      setIndex: number;
      clonedFromSetIndex: number;
    }
  | {
      kind: "remove_exercise";
      workoutExerciseId: string;
      exerciseId: string;
      orderIndex: number;
      section: "WARMUP" | "MAIN" | "ACCESSORY";
      setCount: number;
    }
  | {
      kind: "replace_exercise";
      workoutExerciseId: string;
      fromExerciseId: string;
      fromExerciseName: string;
      toExerciseId: string;
      toExerciseName: string;
      reason: RuntimeExerciseReplaceReason;
      setCount: number;
      fromStimulusAccounting?: ExerciseStimulusAccountingEvidence;
      toStimulusAccounting?: ExerciseStimulusAccountingEvidence;
    }
  | {
      kind: "rewrite_structure";
    };

export type RuntimeEditReconciliationInput = {
  selectionMetadata: unknown;
  selectionMode?: string | null;
  sessionIntent?: string | null;
  persistedExercises: PersistedWorkoutStructureExerciseInput[];
  mutation: RuntimeEditMutation;
  reconciledAt?: string | Date;
};

export type RuntimeEditReconciliationResult = {
  nextSelectionMetadata: SaveableSelectionMetadata;
  workoutStructureState: WorkoutStructureState;
  runtimeEditReconciliation?: RuntimeEditReconciliation;
  appendedOpKind?: RuntimeEditOperation["kind"];
};

function normalizeReconciledAt(value?: string | Date): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return value ?? new Date().toISOString();
}

function appendRuntimeEditOperation(input: {
  existing: RuntimeEditReconciliation | undefined;
  op: RuntimeEditOperation | undefined;
  reconciledAt: string;
}): RuntimeEditReconciliation | undefined {
  if (!input.existing && !input.op) {
    return undefined;
  }

  if (!input.op) {
    return input.existing;
  }

  return {
    version: 1,
    lastReconciledAt: input.reconciledAt,
    ops: [...(input.existing?.ops ?? []), input.op],
    directives: input.existing?.directives ?? CONSERVATIVE_RUNTIME_EDIT_DIRECTIVES,
  };
}

function buildRuntimeEditOperation(input: {
  mutation: RuntimeEditMutation;
  workoutStructureState: WorkoutStructureState;
  appliedAt: string;
  existing?: RuntimeEditReconciliation;
}): RuntimeEditOperation | undefined {
  if (input.mutation.kind === "add_exercise") {
    return {
      kind: "add_exercise",
      source: "api_workouts_add_exercise",
      appliedAt: input.appliedAt,
      scope: "current_workout_only",
      facts: {
        workoutExerciseId: input.mutation.workoutExerciseId,
        exerciseId: input.mutation.exerciseId,
        orderIndex: input.mutation.orderIndex,
        section: input.mutation.section,
        setCount: input.mutation.setCount,
        prescriptionSource: input.mutation.prescriptionSource,
        stimulusAccounting: input.mutation.stimulusAccounting,
      },
    };
  }

  if (input.mutation.kind === "add_set") {
    return {
      kind: "add_set",
      source: "api_workouts_add_set",
      appliedAt: input.appliedAt,
      scope: "current_workout_only",
      facts: {
        workoutExerciseId: input.mutation.workoutExerciseId,
        exerciseId: input.mutation.exerciseId,
        workoutSetId: input.mutation.workoutSetId,
        setIndex: input.mutation.setIndex,
        clonedFromSetIndex: input.mutation.clonedFromSetIndex,
      },
    };
  }

  if (input.mutation.kind === "remove_exercise") {
    return {
      kind: "remove_exercise",
      source: "api_workouts_remove_exercise",
      appliedAt: input.appliedAt,
      scope: "current_workout_only",
      facts: {
        workoutExerciseId: input.mutation.workoutExerciseId,
        exerciseId: input.mutation.exerciseId,
        orderIndex: input.mutation.orderIndex,
        section: input.mutation.section,
        setCount: input.mutation.setCount,
      },
    };
  }

  if (input.mutation.kind === "replace_exercise") {
    return {
      kind: "replace_exercise",
      source: "api_workouts_swap_exercise",
      appliedAt: input.appliedAt,
      scope: "current_workout_only",
      facts: {
        workoutExerciseId: input.mutation.workoutExerciseId,
        fromExerciseId: input.mutation.fromExerciseId,
        fromExerciseName: input.mutation.fromExerciseName,
        toExerciseId: input.mutation.toExerciseId,
        toExerciseName: input.mutation.toExerciseName,
        reason: input.mutation.reason,
        setCount: input.mutation.setCount,
        fromStimulusAccounting: input.mutation.fromStimulusAccounting,
        toStimulusAccounting: input.mutation.toStimulusAccounting,
      },
    };
  }

  if (!input.workoutStructureState.reconciliation.hasDrift) {
    return undefined;
  }

  const capacityOperation = input.existing?.ops.find(
    (operation) => operation.kind === "reduce_session_capacity",
  );
  if (capacityOperation) {
    const expectedRemoved = capacityOperation.facts.omitted
      .filter((row) => row.retainedSetCount === 0)
      .map((row) => row.exerciseId)
      .sort();
    const expectedReduced = capacityOperation.facts.omitted
      .filter((row) => row.retainedSetCount > 0)
      .map((row) => row.exerciseId)
      .sort();
    const reconciliation = input.workoutStructureState.reconciliation;
    const fullyExplained =
      reconciliation.addedExerciseIds.length === 0 &&
      reconciliation.exercisesWithPrescriptionChanges.length === 0 &&
      JSON.stringify([...reconciliation.removedExerciseIds].sort()) ===
        JSON.stringify(expectedRemoved) &&
      JSON.stringify(
        [...reconciliation.exercisesWithSetCountChanges].sort(),
      ) === JSON.stringify(expectedReduced);
    if (fullyExplained) {
      return undefined;
    }
  }

  return {
    kind: "rewrite_structure",
    source: "api_workouts_save",
    appliedAt: input.appliedAt,
    scope: "current_workout_only",
    facts: {
      changedFields: input.workoutStructureState.reconciliation.changedFields,
      addedExerciseIds: input.workoutStructureState.reconciliation.addedExerciseIds,
      removedExerciseIds: input.workoutStructureState.reconciliation.removedExerciseIds,
      exercisesWithSetCountChanges:
        input.workoutStructureState.reconciliation.exercisesWithSetCountChanges,
      exercisesWithPrescriptionChanges:
        input.workoutStructureState.reconciliation.exercisesWithPrescriptionChanges,
    },
  };
}

export function reconcileRuntimeEditSelectionMetadata(
  input: RuntimeEditReconciliationInput
): RuntimeEditReconciliationResult {
  const reconciledAt = normalizeReconciledAt(input.reconciledAt);
  const workoutStructureState = buildWorkoutStructureState({
    selectionMetadata: input.selectionMetadata,
    selectionMode: input.selectionMode,
    sessionIntent: input.sessionIntent,
    persistedExercises: input.persistedExercises,
    reconciledAt,
  });
  const nextOp = buildRuntimeEditOperation({
    mutation: input.mutation,
    workoutStructureState,
    appliedAt: reconciledAt,
    existing: readRuntimeEditReconciliation(input.selectionMetadata),
  });
  const runtimeEditReconciliation = appendRuntimeEditOperation({
    existing: readRuntimeEditReconciliation(input.selectionMetadata),
    op: nextOp,
    reconciledAt,
  });

  let nextSelectionMetadata = attachWorkoutStructureState(
    input.selectionMetadata,
    workoutStructureState
  );
  if (runtimeEditReconciliation) {
    nextSelectionMetadata = attachRuntimeEditReconciliation(
      nextSelectionMetadata,
      runtimeEditReconciliation
    );
  }

  return {
    nextSelectionMetadata,
    workoutStructureState,
    runtimeEditReconciliation,
    appendedOpKind: nextOp?.kind,
  };
}

export function attachSessionCapacityReductionReconciliation(input: {
  selectionMetadata: unknown;
  evidence: SessionCapacityReductionEvidence;
  appliedAt?: string | Date;
}): SaveableSelectionMetadata {
  const appliedAt = normalizeReconciledAt(input.appliedAt);
  const existing = readRuntimeEditReconciliation(input.selectionMetadata);
  const existingCapacityOperations =
    existing?.ops.filter(
      (operation) => operation.kind === "reduce_session_capacity",
    ) ?? [];
  const matching = existingCapacityOperations.find(
    (operation) =>
      operation.facts.offeredStructureFingerprint ===
        input.evidence.offeredStructureFingerprint &&
      operation.facts.plannedStructureFingerprint ===
        input.evidence.plannedStructureFingerprint &&
      operation.facts.seedRevisionId === input.evidence.seedRevisionId,
  );
  if (matching) {
    return input.selectionMetadata as SaveableSelectionMetadata;
  }
  if (existingCapacityOperations.length > 0) {
    throw new Error("SESSION_CAPACITY_REDUCTION_CONFLICT");
  }
  const operation: RuntimeEditOperation = {
    kind: "reduce_session_capacity",
    source: "api_workouts_generate_from_intent",
    appliedAt,
    scope: "current_workout_only",
    facts: {
      ...input.evidence,
    },
  };
  return attachRuntimeEditReconciliation(input.selectionMetadata, {
    version: 1,
    lastReconciledAt: appliedAt,
    ops: [...(existing?.ops ?? []), operation],
    directives: existing?.directives ?? CONSERVATIVE_RUNTIME_EDIT_DIRECTIVES,
  });
}
