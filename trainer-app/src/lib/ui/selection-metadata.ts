import type { AutoregulationResult } from "@/lib/api/autoregulation";
import {
  attachSessionAuditSnapshotToSelectionMetadata,
  buildSessionAuditMutationSummary,
  extractSessionAuditSnapshot,
  readSessionAuditSnapshot,
} from "@/lib/evidence/session-audit-snapshot";
import {
  buildSessionDecisionReceipt,
  extractSessionDecisionReceipt,
} from "@/lib/evidence/session-decision-receipt";
import type { SessionAuditSnapshot } from "@/lib/evidence/session-audit-types";
import type { SessionAuditMutationSummary } from "@/lib/evidence/session-audit-types";
import type { SessionDecisionReceipt, SessionSlotSnapshot } from "@/lib/evidence/types";

export type SaveableSelectionMetadata = {
  rationale?: Record<string, unknown>;
  selectedExerciseIds?: string[];
  perExerciseSetTargets?: Record<string, number>;
  weekCloseId?: string;
  sessionDecisionReceipt?: SessionDecisionReceipt;
  sessionAuditSnapshot?: SessionAuditSnapshot;
  workoutStructureState?: WorkoutStructureState;
  runtimeEditReconciliation?: RuntimeEditReconciliation;
  gapFillExerciseSwapState?: GapFillExerciseSwapState;
};

export type WorkoutStructureExercise = {
  exerciseId: string;
  orderIndex: number;
  section: "WARMUP" | "MAIN" | "ACCESSORY";
  setCount: number;
};

export type WorkoutStructureState = {
  version: 1;
  lastReconciledAt: string;
  currentExercises: WorkoutStructureExercise[];
  reconciliation: SessionAuditMutationSummary;
};

export type GapFillExerciseSwapRecord = {
  version: 1;
  workoutExerciseId: string;
  originalExerciseId: string;
  originalExerciseName: string;
  swappedExerciseId: string;
  swappedExerciseName: string;
  allowedAt: string;
  scope: "session_only";
  allowedBy: "gap_fill_equivalent_accessory_swap";
  targetMuscleOverlap: string[];
  movementPatternOverlap: string[];
  equipmentDemandStayedAtOrBelowOriginal: boolean;
  fatigueDelta: number;
};

export type GapFillExerciseSwapState = {
  version: 1;
  swaps: GapFillExerciseSwapRecord[];
};

export type RuntimeEditDirectiveState = {
  continuityAlias: "none";
  progressionAlias: "none";
  futureSessionGeneration: "ignore";
  futureSeedCarryForward: "ignore";
};

export type RuntimeExerciseReplaceReason =
  | "gap_fill_equivalent_accessory_swap"
  | "equipment_availability_equivalent_pull_swap";

export type RuntimeEditOperationSource =
  | "api_workouts_add_exercise"
  | "api_workouts_add_set"
  | "api_workouts_remove_exercise"
  | "api_workouts_swap_exercise"
  | "api_workouts_save";

export type RuntimeEditOperationScope = "current_workout_only";

export type RuntimeEditAddExerciseOperation = {
  kind: "add_exercise";
  source: "api_workouts_add_exercise";
  appliedAt: string;
  scope: "current_workout_only";
  facts: {
    workoutExerciseId?: string;
    exerciseId: string;
    orderIndex: number;
    section: "WARMUP" | "MAIN" | "ACCESSORY";
    setCount: number;
    prescriptionSource?:
      | "session_accessory_defaults"
      | "generic_accessory_fallback";
  };
};

export type RuntimeEditReplaceExerciseOperation = {
  kind: "replace_exercise";
  source: "api_workouts_swap_exercise";
  appliedAt: string;
  scope: "current_workout_only";
  facts: {
    workoutExerciseId: string;
    fromExerciseId: string;
    fromExerciseName?: string;
    toExerciseId: string;
    toExerciseName?: string;
    reason: RuntimeExerciseReplaceReason;
    setCount: number;
  };
};

export type RuntimeEditAddSetOperation = {
  kind: "add_set";
  source: "api_workouts_add_set";
  appliedAt: string;
  scope: "current_workout_only";
  facts: {
    workoutExerciseId: string;
    exerciseId: string;
    workoutSetId: string;
    setIndex: number;
    clonedFromSetIndex: number;
  };
};

export type RuntimeEditRemoveExerciseOperation = {
  kind: "remove_exercise";
  source: "api_workouts_remove_exercise";
  appliedAt: string;
  scope: "current_workout_only";
  facts: {
    workoutExerciseId: string;
    exerciseId: string;
    orderIndex: number;
    section: "WARMUP" | "MAIN" | "ACCESSORY";
    setCount: number;
  };
};

export type RuntimeEditRewriteStructureOperation = {
  kind: "rewrite_structure";
  source: "api_workouts_save";
  appliedAt: string;
  scope: "current_workout_only";
  facts: {
    changedFields: SessionAuditMutationSummary["changedFields"];
    addedExerciseIds: string[];
    removedExerciseIds: string[];
    exercisesWithSetCountChanges: string[];
    exercisesWithPrescriptionChanges: string[];
  };
};

export type RuntimeEditOperation =
  | RuntimeEditAddExerciseOperation
  | RuntimeEditAddSetOperation
  | RuntimeEditRemoveExerciseOperation
  | RuntimeEditReplaceExerciseOperation
  | RuntimeEditRewriteStructureOperation;

export type RuntimeEditReconciliation = {
  version: 1;
  lastReconciledAt: string;
  ops: RuntimeEditOperation[];
  directives: RuntimeEditDirectiveState;
};

export const RUNTIME_ADDED_EXERCISE_BADGE_LABEL = "Added exercise";
export const RUNTIME_ADDED_EXERCISE_SESSION_NOTE =
  "Added during workout. Session-only; future planning ignores it.";
export const SWAPPED_EXERCISE_BADGE_LABEL = "Swapped";

export type RuntimeReplacedExerciseSummary = {
  workoutExerciseId: string;
  fromExerciseId: string;
  fromExerciseName?: string;
  toExerciseId: string;
  toExerciseName?: string;
  reason: RuntimeExerciseReplaceReason;
  setCount: number;
};

export type PersistedWorkoutStructureExerciseInput = {
  exerciseId: string;
  orderIndex: number;
  section?: string | null;
  sets: Array<{
    setIndex: number;
    targetReps?: number | null;
    targetRepMin?: number | null;
    targetRepMax?: number | null;
    targetRpe?: number | null;
    targetLoad?: number | null;
    restSeconds?: number | null;
  }>;
  exercise?: {
    name: string;
  };
};

function toObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function toStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const items = value.filter((entry): entry is string => typeof entry === "string");
  return items.length > 0 ? items : undefined;
}

function toNumberRecord(value: unknown): Record<string, number> | undefined {
  const record = toObject(value);
  if (!record) {
    return undefined;
  }

  const entries = Object.entries(record).filter(
    (entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1])
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function normalizeWorkoutSection(
  value: unknown
): WorkoutStructureExercise["section"] | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toUpperCase();
  if (normalized === "WARMUP" || normalized === "MAIN" || normalized === "ACCESSORY") {
    return normalized;
  }
  return undefined;
}

function parseWorkoutStructureExercise(value: unknown): WorkoutStructureExercise | undefined {
  const record = toObject(value);
  const section = normalizeWorkoutSection(record?.section);
  if (
    !record ||
    typeof record.exerciseId !== "string" ||
    typeof record.orderIndex !== "number" ||
    typeof record.setCount !== "number" ||
    !Number.isFinite(record.setCount) ||
    section == null
  ) {
    return undefined;
  }

  return {
    exerciseId: record.exerciseId,
    orderIndex: record.orderIndex,
    section,
    setCount: record.setCount,
  };
}

function parseWorkoutStructureState(value: unknown): WorkoutStructureState | undefined {
  const record = toObject(value);
  if (
    !record ||
    record.version !== 1 ||
    typeof record.lastReconciledAt !== "string" ||
    !Array.isArray(record.currentExercises)
  ) {
    return undefined;
  }

  const reconciliationRecord = toObject(record.reconciliation);
  if (
    !reconciliationRecord ||
    reconciliationRecord.version !== 1 ||
    typeof reconciliationRecord.comparisonState !== "string" ||
    typeof reconciliationRecord.hasDrift !== "boolean" ||
    !Array.isArray(reconciliationRecord.changedFields) ||
    !Array.isArray(reconciliationRecord.addedExerciseIds) ||
    !Array.isArray(reconciliationRecord.removedExerciseIds) ||
    !Array.isArray(reconciliationRecord.exercisesWithSetCountChanges) ||
    !Array.isArray(reconciliationRecord.exercisesWithPrescriptionChanges)
  ) {
    return undefined;
  }

  return {
    version: 1,
    lastReconciledAt: record.lastReconciledAt,
    currentExercises: record.currentExercises
      .map(parseWorkoutStructureExercise)
      .filter((entry): entry is WorkoutStructureExercise => Boolean(entry)),
    reconciliation: reconciliationRecord as SessionAuditMutationSummary,
  };
}

function parseGapFillExerciseSwapRecord(value: unknown): GapFillExerciseSwapRecord | undefined {
  const record = toObject(value);
  if (
    !record ||
    record.version !== 1 ||
    typeof record.workoutExerciseId !== "string" ||
    typeof record.originalExerciseId !== "string" ||
    typeof record.originalExerciseName !== "string" ||
    typeof record.swappedExerciseId !== "string" ||
    typeof record.swappedExerciseName !== "string" ||
    typeof record.allowedAt !== "string" ||
    record.scope !== "session_only" ||
    record.allowedBy !== "gap_fill_equivalent_accessory_swap" ||
    typeof record.equipmentDemandStayedAtOrBelowOriginal !== "boolean" ||
    typeof record.fatigueDelta !== "number"
  ) {
    return undefined;
  }

  return {
    version: 1,
    workoutExerciseId: record.workoutExerciseId,
    originalExerciseId: record.originalExerciseId,
    originalExerciseName: record.originalExerciseName,
    swappedExerciseId: record.swappedExerciseId,
    swappedExerciseName: record.swappedExerciseName,
    allowedAt: record.allowedAt,
    scope: "session_only",
    allowedBy: "gap_fill_equivalent_accessory_swap",
    targetMuscleOverlap: toStringArray(record.targetMuscleOverlap) ?? [],
    movementPatternOverlap: toStringArray(record.movementPatternOverlap) ?? [],
    equipmentDemandStayedAtOrBelowOriginal: record.equipmentDemandStayedAtOrBelowOriginal,
    fatigueDelta: record.fatigueDelta,
  };
}

function parseGapFillExerciseSwapState(value: unknown): GapFillExerciseSwapState | undefined {
  const record = toObject(value);
  if (!record || record.version !== 1 || !Array.isArray(record.swaps)) {
    return undefined;
  }

  return {
    version: 1,
    swaps: record.swaps
      .map(parseGapFillExerciseSwapRecord)
      .filter((entry): entry is GapFillExerciseSwapRecord => Boolean(entry)),
  };
}

function parseRuntimeEditDirectiveState(value: unknown): RuntimeEditDirectiveState | undefined {
  const record = toObject(value);
  if (
    !record ||
    record.continuityAlias !== "none" ||
    record.progressionAlias !== "none" ||
    record.futureSessionGeneration !== "ignore" ||
    record.futureSeedCarryForward !== "ignore"
  ) {
    return undefined;
  }

  return {
    continuityAlias: "none",
    progressionAlias: "none",
    futureSessionGeneration: "ignore",
    futureSeedCarryForward: "ignore",
  };
}

function parseRuntimeEditOperation(value: unknown): RuntimeEditOperation | undefined {
  const record = toObject(value);
  if (
    !record ||
    typeof record.appliedAt !== "string" ||
    record.scope !== "current_workout_only"
  ) {
    return undefined;
  }

  const facts = toObject(record.facts);
  if (!facts) {
    return undefined;
  }

  if (
    record.kind === "add_exercise" &&
    record.source === "api_workouts_add_exercise"
  ) {
    const section = normalizeWorkoutSection(facts.section);
    if (
      typeof facts.exerciseId !== "string" ||
      typeof facts.orderIndex !== "number" ||
      typeof facts.setCount !== "number" ||
      !Number.isFinite(facts.setCount) ||
      section == null
    ) {
      return undefined;
    }

    return {
      kind: "add_exercise",
      source: "api_workouts_add_exercise",
      appliedAt: record.appliedAt,
      scope: "current_workout_only",
      facts: {
        ...(typeof facts.workoutExerciseId === "string"
          ? { workoutExerciseId: facts.workoutExerciseId }
          : {}),
        exerciseId: facts.exerciseId,
        orderIndex: facts.orderIndex,
        section,
        setCount: facts.setCount,
        ...((facts.prescriptionSource === "session_accessory_defaults" ||
          facts.prescriptionSource === "generic_accessory_fallback")
          ? { prescriptionSource: facts.prescriptionSource }
          : {}),
      },
    };
  }

  if (
    record.kind === "add_set" &&
    record.source === "api_workouts_add_set"
  ) {
    if (
      typeof facts.workoutExerciseId !== "string" ||
      typeof facts.exerciseId !== "string" ||
      typeof facts.workoutSetId !== "string" ||
      typeof facts.setIndex !== "number" ||
      !Number.isFinite(facts.setIndex) ||
      typeof facts.clonedFromSetIndex !== "number" ||
      !Number.isFinite(facts.clonedFromSetIndex)
    ) {
      return undefined;
    }

    return {
      kind: "add_set",
      source: "api_workouts_add_set",
      appliedAt: record.appliedAt,
      scope: "current_workout_only",
      facts: {
        workoutExerciseId: facts.workoutExerciseId,
        exerciseId: facts.exerciseId,
        workoutSetId: facts.workoutSetId,
        setIndex: facts.setIndex,
        clonedFromSetIndex: facts.clonedFromSetIndex,
      },
    };
  }

  if (
    record.kind === "remove_exercise" &&
    record.source === "api_workouts_remove_exercise"
  ) {
    const section = normalizeWorkoutSection(facts.section);
    if (
      typeof facts.workoutExerciseId !== "string" ||
      typeof facts.exerciseId !== "string" ||
      typeof facts.orderIndex !== "number" ||
      !Number.isFinite(facts.orderIndex) ||
      typeof facts.setCount !== "number" ||
      !Number.isFinite(facts.setCount) ||
      section == null
    ) {
      return undefined;
    }

    return {
      kind: "remove_exercise",
      source: "api_workouts_remove_exercise",
      appliedAt: record.appliedAt,
      scope: "current_workout_only",
      facts: {
        workoutExerciseId: facts.workoutExerciseId,
        exerciseId: facts.exerciseId,
        orderIndex: facts.orderIndex,
        section,
        setCount: facts.setCount,
      },
    };
  }

  if (
    record.kind === "replace_exercise" &&
    record.source === "api_workouts_swap_exercise"
  ) {
    if (
      typeof facts.workoutExerciseId !== "string" ||
      typeof facts.fromExerciseId !== "string" ||
      typeof facts.toExerciseId !== "string" ||
      (facts.reason !== "gap_fill_equivalent_accessory_swap" &&
        facts.reason !== "equipment_availability_equivalent_pull_swap") ||
      typeof facts.setCount !== "number" ||
      !Number.isFinite(facts.setCount)
    ) {
      return undefined;
    }

    return {
      kind: "replace_exercise",
      source: "api_workouts_swap_exercise",
      appliedAt: record.appliedAt,
      scope: "current_workout_only",
      facts: {
        workoutExerciseId: facts.workoutExerciseId,
        fromExerciseId: facts.fromExerciseId,
        ...(typeof facts.fromExerciseName === "string"
          ? { fromExerciseName: facts.fromExerciseName }
          : {}),
        toExerciseId: facts.toExerciseId,
        ...(typeof facts.toExerciseName === "string"
          ? { toExerciseName: facts.toExerciseName }
          : {}),
        reason: facts.reason,
        setCount: facts.setCount,
      },
    };
  }

  if (
    record.kind === "rewrite_structure" &&
    record.source === "api_workouts_save"
  ) {
    const changedFields = Array.isArray(facts.changedFields)
      ? facts.changedFields.filter((entry): entry is SessionAuditMutationSummary["changedFields"][number] =>
          typeof entry === "string"
        )
      : null;
    const addedExerciseIds = toStringArray(facts.addedExerciseIds);
    const removedExerciseIds = toStringArray(facts.removedExerciseIds);
    const exercisesWithSetCountChanges = toStringArray(facts.exercisesWithSetCountChanges);
    const exercisesWithPrescriptionChanges = toStringArray(
      facts.exercisesWithPrescriptionChanges
    );

    if (
      changedFields == null ||
      !Array.isArray(facts.addedExerciseIds) ||
      !Array.isArray(facts.removedExerciseIds) ||
      !Array.isArray(facts.exercisesWithSetCountChanges) ||
      !Array.isArray(facts.exercisesWithPrescriptionChanges)
    ) {
      return undefined;
    }

    return {
      kind: "rewrite_structure",
      source: "api_workouts_save",
      appliedAt: record.appliedAt,
      scope: "current_workout_only",
      facts: {
        changedFields,
        addedExerciseIds: addedExerciseIds ?? [],
        removedExerciseIds: removedExerciseIds ?? [],
        exercisesWithSetCountChanges: exercisesWithSetCountChanges ?? [],
        exercisesWithPrescriptionChanges: exercisesWithPrescriptionChanges ?? [],
      },
    };
  }

  return undefined;
}

function parseRuntimeEditReconciliation(value: unknown): RuntimeEditReconciliation | undefined {
  const record = toObject(value);
  if (
    !record ||
    record.version !== 1 ||
    typeof record.lastReconciledAt !== "string" ||
    !Array.isArray(record.ops)
  ) {
    return undefined;
  }

  const directives = parseRuntimeEditDirectiveState(record.directives);
  if (!directives) {
    return undefined;
  }

  return {
    version: 1,
    lastReconciledAt: record.lastReconciledAt,
    ops: record.ops
      .map(parseRuntimeEditOperation)
      .filter((entry): entry is RuntimeEditOperation => Boolean(entry)),
    directives,
  };
}

function toWorkoutStructureExercises(
  exercises: PersistedWorkoutStructureExerciseInput[]
): WorkoutStructureExercise[] {
  return exercises
    .map((exercise) => ({
      exerciseId: exercise.exerciseId,
      orderIndex: exercise.orderIndex,
      section: normalizeWorkoutSection(exercise.section) ?? "ACCESSORY",
      setCount: exercise.sets.length,
    }))
    .sort((left, right) => left.orderIndex - right.orderIndex);
}

function readRetainedReceiptExceptions(
  receipt: SessionDecisionReceipt
): SessionDecisionReceipt["exceptions"] {
  return receipt.exceptions.filter(
    (entry) =>
      entry.code === "optional_gap_fill" ||
      entry.code === "supplemental_deficit_session" ||
      entry.code === "closeout_session"
  );
}

export function sanitizeSelectionMetadataForSave(value: unknown): SaveableSelectionMetadata | undefined {
  const record = toObject(value);
  if (!record) {
    return undefined;
  }

  const output: SaveableSelectionMetadata = {};
  if (record.rationale && typeof record.rationale === "object" && !Array.isArray(record.rationale)) {
    output.rationale = record.rationale as Record<string, unknown>;
  }

  const selectedExerciseIds = toStringArray(record.selectedExerciseIds);
  if (selectedExerciseIds) {
    output.selectedExerciseIds = selectedExerciseIds;
  }

  const perExerciseSetTargets = toNumberRecord(record.perExerciseSetTargets);
  if (perExerciseSetTargets) {
    output.perExerciseSetTargets = perExerciseSetTargets;
  }

  if (typeof record.weekCloseId === "string") {
    output.weekCloseId = record.weekCloseId;
  }

  const sessionDecisionReceipt = toObject(record.sessionDecisionReceipt);
  if (sessionDecisionReceipt) {
    const canonicalReceipt = extractSessionDecisionReceipt({
      sessionDecisionReceipt,
    });
    if (canonicalReceipt) {
      output.sessionDecisionReceipt = canonicalReceipt;
    }
  }

  const sessionAuditSnapshot = toObject(record.sessionAuditSnapshot);
  if (sessionAuditSnapshot) {
    const canonicalSnapshot = extractSessionAuditSnapshot({
      sessionAuditSnapshot,
    });
    if (canonicalSnapshot) {
      output.sessionAuditSnapshot = canonicalSnapshot;
    }
  }

  const workoutStructureState = parseWorkoutStructureState(record.workoutStructureState);
  if (workoutStructureState) {
    output.workoutStructureState = workoutStructureState;
  }

  const runtimeEditReconciliation = parseRuntimeEditReconciliation(
    record.runtimeEditReconciliation
  );
  if (runtimeEditReconciliation) {
    output.runtimeEditReconciliation = runtimeEditReconciliation;
  }

  return Object.keys(output).length > 0 ? output : {};
}

export function readWeekCloseIdFromSelectionMetadata(value: unknown): string | undefined {
  const record = toObject(value);
  return typeof record?.weekCloseId === "string" ? record.weekCloseId : undefined;
}

export function readWorkoutStructureState(
  value: unknown
): WorkoutStructureState | undefined {
  const record = toObject(value);
  return parseWorkoutStructureState(record?.workoutStructureState);
}

export function readGapFillExerciseSwapState(
  value: unknown
): GapFillExerciseSwapState | undefined {
  const record = toObject(value);
  return parseGapFillExerciseSwapState(record?.gapFillExerciseSwapState);
}

export function readRuntimeEditReconciliation(
  value: unknown
): RuntimeEditReconciliation | undefined {
  const record = toObject(value);
  return parseRuntimeEditReconciliation(record?.runtimeEditReconciliation);
}

export function readRuntimeAddedSetIds(selectionMetadata: unknown): Set<string> {
  const runtimeEditReconciliation = readRuntimeEditReconciliation(selectionMetadata);
  return new Set(
    (runtimeEditReconciliation?.ops ?? [])
      .filter(
        (operation): operation is RuntimeEditAddSetOperation =>
          operation.kind === "add_set"
      )
      .map((operation) => operation.facts.workoutSetId)
  );
}

export function readRuntimeAddedExerciseIds(selectionMetadata: unknown): Set<string> {
  const runtimeEditReconciliation = readRuntimeEditReconciliation(selectionMetadata);
  const addedExerciseIds = new Set<string>();

  for (const operation of runtimeEditReconciliation?.ops ?? []) {
    if (
      operation.kind === "add_exercise" &&
      typeof operation.facts.workoutExerciseId === "string"
    ) {
      addedExerciseIds.add(operation.facts.workoutExerciseId);
    }
    if (operation.kind === "remove_exercise") {
      addedExerciseIds.delete(operation.facts.workoutExerciseId);
    }
  }

  return addedExerciseIds;
}

export function readRuntimeReplacedExercises(
  selectionMetadata: unknown
): Map<string, RuntimeReplacedExerciseSummary> {
  const runtimeEditReconciliation = readRuntimeEditReconciliation(selectionMetadata);

  return new Map(
    (runtimeEditReconciliation?.ops ?? [])
      .filter(
        (operation): operation is RuntimeEditReplaceExerciseOperation =>
          operation.kind === "replace_exercise"
      )
      .map((operation) => [
        operation.facts.workoutExerciseId,
        {
          workoutExerciseId: operation.facts.workoutExerciseId,
          fromExerciseId: operation.facts.fromExerciseId,
          fromExerciseName: operation.facts.fromExerciseName,
          toExerciseId: operation.facts.toExerciseId,
          toExerciseName: operation.facts.toExerciseName,
          reason: operation.facts.reason,
          setCount: operation.facts.setCount,
        } satisfies RuntimeReplacedExerciseSummary,
      ])
  );
}

export function formatRuntimeExerciseSwapNote(
  replacement: Pick<RuntimeReplacedExerciseSummary, "fromExerciseName" | "fromExerciseId">
): string {
  return `Swapped from ${
    replacement.fromExerciseName ?? replacement.fromExerciseId
  }. Session-only; future progression stays exercise-specific.`;
}

export function attachWorkoutStructureState(
  selectionMetadata: unknown,
  workoutStructureState: WorkoutStructureState
): SaveableSelectionMetadata {
  return {
    ...(toObject(selectionMetadata) ?? {}),
    workoutStructureState,
  };
}

export function attachGapFillExerciseSwapRecord(
  selectionMetadata: unknown,
  swapRecord: GapFillExerciseSwapRecord
): SaveableSelectionMetadata {
  const existing = readGapFillExerciseSwapState(selectionMetadata);
  const swaps = existing?.swaps ?? [];

  return {
    ...(toObject(selectionMetadata) ?? {}),
    gapFillExerciseSwapState: {
      version: 1,
      swaps: [...swaps, swapRecord],
    } satisfies GapFillExerciseSwapState,
  };
}

export function attachRuntimeEditReconciliation(
  selectionMetadata: unknown,
  runtimeEditReconciliation: RuntimeEditReconciliation
): SaveableSelectionMetadata {
  return {
    ...(toObject(selectionMetadata) ?? {}),
    runtimeEditReconciliation,
  };
}

export function buildWorkoutStructureState(input: {
  selectionMetadata: unknown;
  selectionMode?: string | null;
  sessionIntent?: string | null;
  persistedExercises: PersistedWorkoutStructureExerciseInput[];
  reconciledAt?: string | Date;
}): WorkoutStructureState {
  const snapshot = readSessionAuditSnapshot(input.selectionMetadata) ?? { version: 1 };
  return {
    version: 1,
    lastReconciledAt:
      input.reconciledAt instanceof Date
        ? input.reconciledAt.toISOString()
        : input.reconciledAt ?? new Date().toISOString(),
    currentExercises: toWorkoutStructureExercises(input.persistedExercises),
    reconciliation: buildSessionAuditMutationSummary({
      snapshot,
      savedSelectionMode: input.selectionMode,
      savedSessionIntent: input.sessionIntent,
      persistedExercises: input.persistedExercises.map((exercise) => ({
        exerciseId: exercise.exerciseId,
        orderIndex: exercise.orderIndex,
        section: exercise.section,
        isMainLift: normalizeWorkoutSection(exercise.section) === "MAIN",
        exercise: {
          name: exercise.exercise?.name ?? exercise.exerciseId,
        },
        sets: exercise.sets,
      })),
    }),
  };
}

export function attachOptionalGapFillMetadata(
  selectionMetadata: SaveableSelectionMetadata,
  input: {
    enabled: boolean;
    targetMuscles?: string[];
    weekCloseId?: string;
  }
): SaveableSelectionMetadata {
  if (!input.enabled) {
    return selectionMetadata;
  }
  const receipt = selectionMetadata.sessionDecisionReceipt;
  if (!receipt) {
    return selectionMetadata;
  }
  const nextTargetMuscles =
    input.targetMuscles && input.targetMuscles.length > 0
      ? input.targetMuscles
      : receipt.targetMuscles;
  const hasMarker = receipt.exceptions.some((entry) => entry.code === "optional_gap_fill");

  return {
    ...selectionMetadata,
    ...(input.weekCloseId ? { weekCloseId: input.weekCloseId } : {}),
    sessionDecisionReceipt: hasMarker
      ? {
          ...receipt,
          targetMuscles: nextTargetMuscles,
        }
      : {
          ...receipt,
          targetMuscles: nextTargetMuscles,
          exceptions: [
            ...receipt.exceptions,
            {
              code: "optional_gap_fill",
              message: "Marked as optional gap-fill session.",
            },
          ],
        },
  };
}

export function attachSupplementalSessionMetadata(
  selectionMetadata: SaveableSelectionMetadata,
  input: {
    enabled: boolean;
    targetMuscles?: string[];
    anchorWeek?: number;
  }
): SaveableSelectionMetadata {
  if (!input.enabled) {
    return selectionMetadata;
  }
  void input.anchorWeek;

  const receipt = selectionMetadata.sessionDecisionReceipt;
  if (!receipt) {
    return selectionMetadata;
  }

  const nextTargetMuscles =
    input.targetMuscles && input.targetMuscles.length > 0
      ? input.targetMuscles
      : receipt.targetMuscles;
  const hasMarker = receipt.exceptions.some(
    (entry) => entry.code === "supplemental_deficit_session"
  );

  return {
    ...selectionMetadata,
    sessionDecisionReceipt: hasMarker
      ? {
          ...receipt,
          targetMuscles: nextTargetMuscles,
        }
      : {
          ...receipt,
          targetMuscles: nextTargetMuscles,
          exceptions: [
            ...receipt.exceptions,
            {
              code: "supplemental_deficit_session",
              message: "Marked as supplemental deficit session.",
            },
          ],
        },
  };
}

export function attachCloseoutSessionMetadata(
  selectionMetadata: SaveableSelectionMetadata,
  input: {
    enabled: boolean;
    weekCloseId?: string;
  }
): SaveableSelectionMetadata {
  if (!input.enabled) {
    return selectionMetadata;
  }

  const receipt = selectionMetadata.sessionDecisionReceipt;
  if (!receipt) {
    return selectionMetadata;
  }

  const retainedExceptions = readRetainedReceiptExceptions(receipt);
  const hasMarker = retainedExceptions.some((entry) => entry.code === "closeout_session");
  const existingWeekCloseId = readWeekCloseIdFromSelectionMetadata(selectionMetadata);
  if (
    hasMarker &&
    (input.weekCloseId == null || input.weekCloseId === existingWeekCloseId)
  ) {
    return selectionMetadata;
  }

  return {
    ...selectionMetadata,
    ...(input.weekCloseId ? { weekCloseId: input.weekCloseId } : {}),
    sessionDecisionReceipt: buildSessionDecisionReceipt({
      cycleContext: receipt.cycleContext,
      targetMuscles: receipt.targetMuscles,
      lifecycleRirTarget: receipt.lifecycleRirTarget,
      lifecycleVolumeTargets: receipt.lifecycleVolume.targets,
      sorenessSuppressedMuscles: receipt.sorenessSuppressedMuscles,
      deloadDecision: receipt.deloadDecision,
      plannerDiagnostics: receipt.plannerDiagnostics,
      plannerDiagnosticsMode: receipt.plannerDiagnosticsMode ?? "standard",
      additionalExceptions: hasMarker
        ? retainedExceptions
        : [
            ...retainedExceptions,
            {
              code: "closeout_session",
              message: "Marked as closeout session.",
            },
          ],
      autoregulation: {
        wasAutoregulated: receipt.readiness.wasAutoregulated,
        signalAgeHours: receipt.readiness.signalAgeHours,
        fatigueScoreOverall: receipt.readiness.fatigueScoreOverall,
        rationale: receipt.readiness.rationale,
        intensityScaling: receipt.readiness.intensityScaling,
      },
    }),
  };
}

export function attachSessionSlotMetadata(
  selectionMetadata: SaveableSelectionMetadata,
  sessionSlot: SessionSlotSnapshot | undefined
): SaveableSelectionMetadata {
  if (!sessionSlot) {
    return selectionMetadata;
  }

  const receipt = selectionMetadata.sessionDecisionReceipt;
  if (!receipt) {
    return selectionMetadata;
  }
  if (receipt.exceptions.some((entry) => entry.code === "closeout_session")) {
    return selectionMetadata;
  }

  return {
    ...selectionMetadata,
    sessionDecisionReceipt: buildSessionDecisionReceipt({
      cycleContext: receipt.cycleContext,
      sessionSlot,
      targetMuscles: receipt.targetMuscles,
      lifecycleRirTarget: receipt.lifecycleRirTarget,
      lifecycleVolumeTargets: receipt.lifecycleVolume.targets,
      sorenessSuppressedMuscles: receipt.sorenessSuppressedMuscles,
      deloadDecision: receipt.deloadDecision,
      plannerDiagnostics: receipt.plannerDiagnostics,
      plannerDiagnosticsMode: receipt.plannerDiagnosticsMode ?? "standard",
      additionalExceptions: readRetainedReceiptExceptions(receipt),
      autoregulation: {
        wasAutoregulated: receipt.readiness.wasAutoregulated,
        signalAgeHours: receipt.readiness.signalAgeHours,
        fatigueScoreOverall: receipt.readiness.fatigueScoreOverall,
        rationale: receipt.readiness.rationale,
        intensityScaling: receipt.readiness.intensityScaling,
      },
    }),
  };
}

export function buildCanonicalSelectionMetadata(
  value: unknown,
  autoregulation?: AutoregulationResult
): SaveableSelectionMetadata {
  const record = toObject(value) ?? {};
  const priorReceipt = extractSessionDecisionReceipt(record);

  const output =
    sanitizeSelectionMetadataForSave({
      ...record,
      sessionDecisionReceipt: priorReceipt
        ? buildSessionDecisionReceipt({
            cycleContext: priorReceipt.cycleContext,
            sessionSlot: priorReceipt.sessionSlot,
            targetMuscles: priorReceipt.targetMuscles,
            lifecycleRirTarget: priorReceipt.lifecycleRirTarget,
            lifecycleVolumeTargets: priorReceipt.lifecycleVolume.targets,
            sorenessSuppressedMuscles: priorReceipt.sorenessSuppressedMuscles,
            deloadDecision: priorReceipt.deloadDecision,
            plannerDiagnostics: priorReceipt.plannerDiagnostics,
            plannerDiagnosticsMode: "standard",
            additionalExceptions: readRetainedReceiptExceptions(priorReceipt),
            autoregulation:
              autoregulation
                ? {
                    wasAutoregulated: autoregulation.wasAutoregulated,
                    signalAgeHours: autoregulation.signalAgeHours,
                    fatigueScoreOverall: autoregulation.fatigueScore?.overall ?? null,
                    rationale: autoregulation.rationale,
                    modifications: autoregulation.modifications,
                  }
                : undefined,
          })
        : undefined,
    }) ?? {};

  if (record.sessionAuditSnapshot) {
    const sessionAuditSnapshot = extractSessionAuditSnapshot(record);
    if (sessionAuditSnapshot) {
      return attachSessionAuditSnapshotToSelectionMetadata(
        output,
        sessionAuditSnapshot
      ) as SaveableSelectionMetadata;
    }
  }

  return output;
}
