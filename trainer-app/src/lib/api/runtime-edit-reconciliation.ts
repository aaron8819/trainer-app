import {
  attachRuntimeEditReconciliation,
  attachWorkoutStructureState,
  buildWorkoutStructureState,
  readRuntimeEditReconciliation,
  type PersistedWorkoutStructureExerciseInput,
  type RuntimeEditDirectiveState,
  type RuntimeEditOperation,
  type RuntimeEditReconciliation,
  type SaveableSelectionMetadata,
  type WorkoutStructureState,
} from "@/lib/ui/selection-metadata";

const CONSERVATIVE_RUNTIME_EDIT_DIRECTIVES: RuntimeEditDirectiveState = {
  continuityAlias: "none",
  progressionAlias: "none",
  futureSessionGeneration: "ignore",
  futureSeedCarryForward: "ignore",
};

export type RuntimeEditMutation =
  | {
      kind: "add_exercise";
      exerciseId: string;
      orderIndex: number;
      section: "WARMUP" | "MAIN" | "ACCESSORY";
      setCount: number;
    }
  | {
      kind: "replace_exercise";
      workoutExerciseId: string;
      fromExerciseId: string;
      toExerciseId: string;
      reason: "gap_fill_equivalent_accessory_swap";
      setCount: number;
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
}): RuntimeEditOperation | undefined {
  if (input.mutation.kind === "add_exercise") {
    return {
      kind: "add_exercise",
      source: "api_workouts_add_exercise",
      appliedAt: input.appliedAt,
      scope: "current_workout_only",
      facts: {
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
        toExerciseId: input.mutation.toExerciseId,
        reason: input.mutation.reason,
        setCount: input.mutation.setCount,
      },
    };
  }

  if (!input.workoutStructureState.reconciliation.hasDrift) {
    return undefined;
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
