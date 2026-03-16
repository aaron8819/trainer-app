import type { WorkoutPlan } from "@/lib/engine/types";
import { readSessionDecisionReceipt } from "./session-decision-receipt";
import type {
  DeloadTransformationTrace,
  ProgressionDecisionTrace,
  SessionAuditExerciseSnapshot,
  SessionAuditGeneratedState,
  SessionAuditMutationSummary,
  SessionAuditSavedState,
  SessionAuditSetSnapshot,
  SessionAuditSnapshot,
} from "./session-audit-types";
import { deriveSessionSemantics } from "@/lib/session-semantics/derive-session-semantics";

type JsonRecord = Record<string, unknown>;

function toObject(value: unknown): JsonRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as JsonRecord;
}

function parseSetSnapshot(value: unknown): SessionAuditSetSnapshot | undefined {
  const record = toObject(value);
  if (!record || typeof record.setIndex !== "number") {
    return undefined;
  }

  const targetRepRange = toObject(record.targetRepRange);
  return {
    setIndex: record.setIndex,
    targetReps: typeof record.targetReps === "number" ? record.targetReps : undefined,
    targetRepRange:
      targetRepRange &&
      typeof targetRepRange.min === "number" &&
      typeof targetRepRange.max === "number"
        ? {
            min: targetRepRange.min,
            max: targetRepRange.max,
          }
        : undefined,
    targetRpe: typeof record.targetRpe === "number" ? record.targetRpe : undefined,
    targetLoad: typeof record.targetLoad === "number" ? record.targetLoad : undefined,
    role: typeof record.role === "string" ? record.role : undefined,
    restSeconds: typeof record.restSeconds === "number" ? record.restSeconds : undefined,
  };
}

function parseExerciseSnapshot(value: unknown): SessionAuditExerciseSnapshot | undefined {
  const record = toObject(value);
  if (
    !record ||
    typeof record.exerciseId !== "string" ||
    typeof record.exerciseName !== "string" ||
    typeof record.orderIndex !== "number" ||
    typeof record.section !== "string" ||
    typeof record.isMainLift !== "boolean" ||
    typeof record.prescribedSetCount !== "number" ||
    !Array.isArray(record.prescribedSets)
  ) {
    return undefined;
  }

  const prescribedSets = record.prescribedSets
    .map(parseSetSnapshot)
    .filter((entry): entry is SessionAuditSetSnapshot => Boolean(entry));

  return {
    exerciseId: record.exerciseId,
    exerciseName: record.exerciseName,
    orderIndex: record.orderIndex,
    section: record.section as SessionAuditExerciseSnapshot["section"],
    isMainLift: record.isMainLift,
    role: typeof record.role === "string" ? record.role : undefined,
    prescribedSetCount: record.prescribedSetCount,
    prescribedSets,
  };
}

function parseProgressionTraceRecord(value: unknown): Record<string, ProgressionDecisionTrace> {
  const record = toObject(value);
  if (!record) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(record).flatMap(([exerciseId, entry]) => {
      const item = toObject(entry);
      if (
        !item ||
        item.version !== 1 ||
        item.decisionSource !== "double_progression" ||
        !toObject(item.repRange) ||
        !toObject(item.anchor) ||
        !toObject(item.confidence) ||
        !toObject(item.metrics) ||
        !toObject(item.outcome) ||
        !Array.isArray(item.decisionLog)
      ) {
        return [];
      }

      return [[exerciseId, item as unknown as ProgressionDecisionTrace]];
    })
  );
}

function parseDeloadTrace(value: unknown): DeloadTransformationTrace | undefined {
  const record = toObject(value);
  if (
    !record ||
    record.version !== 1 ||
    typeof record.sessionIntent !== "string" ||
    typeof record.targetRpe !== "number" ||
    typeof record.setFactor !== "number" ||
    typeof record.minSets !== "number" ||
    typeof record.exerciseCount !== "number" ||
    !Array.isArray(record.exercises)
  ) {
    return undefined;
  }
  return record as unknown as DeloadTransformationTrace;
}

function parseGeneratedState(value: unknown): SessionAuditGeneratedState | undefined {
  const record = toObject(value);
  if (
    !record ||
    typeof record.selectionMode !== "string" ||
    typeof record.sessionIntent !== "string" ||
    typeof record.exerciseCount !== "number" ||
    typeof record.hardSetCount !== "number" ||
    !Array.isArray(record.exercises) ||
    !toObject(record.semantics) ||
    !toObject(record.traces)
  ) {
    return undefined;
  }

  return {
    selectionMode: record.selectionMode,
    sessionIntent: record.sessionIntent,
    targetMuscles: Array.isArray(record.targetMuscles)
      ? record.targetMuscles.filter((entry): entry is string => typeof entry === "string")
      : undefined,
    cycleContext: toObject(record.cycleContext) as SessionAuditGeneratedState["cycleContext"],
    deloadDecision: toObject(record.deloadDecision) as SessionAuditGeneratedState["deloadDecision"],
    semantics: record.semantics as SessionAuditGeneratedState["semantics"],
    exerciseCount: record.exerciseCount,
    hardSetCount: record.hardSetCount,
    exercises: record.exercises
      .map(parseExerciseSnapshot)
      .filter((entry): entry is SessionAuditExerciseSnapshot => Boolean(entry)),
    filteredExercises: Array.isArray(record.filteredExercises)
      ? record.filteredExercises.flatMap((entry) => {
          const item = toObject(entry);
          if (
            !item ||
            typeof item.exerciseName !== "string" ||
            typeof item.reason !== "string" ||
            typeof item.userFriendlyMessage !== "string"
          ) {
            return [];
          }
          return [{
            exerciseId: typeof item.exerciseId === "string" ? item.exerciseId : undefined,
            exerciseName: item.exerciseName,
            reason: item.reason,
            userFriendlyMessage: item.userFriendlyMessage,
          }];
        })
      : undefined,
    traces: {
      progression: parseProgressionTraceRecord(toObject(record.traces)?.progression),
      deload: parseDeloadTrace(toObject(record.traces)?.deload),
    },
  };
}

function parseSavedState(value: unknown): SessionAuditSavedState | undefined {
  const record = toObject(value);
  if (
    !record ||
    typeof record.workoutId !== "string" ||
    typeof record.status !== "string" ||
    typeof record.advancesSplit !== "boolean" ||
    !toObject(record.semantics)
  ) {
    return undefined;
  }

  const mesocycleSnapshot = toObject(record.mesocycleSnapshot);
  return {
    workoutId: record.workoutId,
    revision: typeof record.revision === "number" ? record.revision : undefined,
    status: record.status,
    advancesSplit: record.advancesSplit,
    mesocycleSnapshot: mesocycleSnapshot
      ? {
          mesocycleId:
            typeof mesocycleSnapshot.mesocycleId === "string" || mesocycleSnapshot.mesocycleId === null
              ? (mesocycleSnapshot.mesocycleId as string | null)
              : undefined,
          week: typeof mesocycleSnapshot.week === "number" ? mesocycleSnapshot.week : undefined,
          session:
            typeof mesocycleSnapshot.session === "number" ? mesocycleSnapshot.session : undefined,
          phase:
            typeof mesocycleSnapshot.phase === "string" || mesocycleSnapshot.phase === null
              ? (mesocycleSnapshot.phase as string | null)
              : undefined,
        }
      : undefined,
    semantics: record.semantics as SessionAuditSavedState["semantics"],
  };
}

export function parseSessionAuditSnapshot(value: unknown): SessionAuditSnapshot | undefined {
  const record = toObject(value);
  if (!record || record.version !== 1) {
    return undefined;
  }

  const generated = parseGeneratedState(record.generated);
  const saved = parseSavedState(record.saved);
  if (!generated && !saved) {
    return undefined;
  }

  return {
    version: 1,
    generated,
    saved,
  };
}

export function extractSessionAuditSnapshot(value: unknown): SessionAuditSnapshot | undefined {
  const record = toObject(value);
  if (!record) {
    return undefined;
  }
  return parseSessionAuditSnapshot(record.sessionAuditSnapshot);
}

export function readSessionAuditSnapshot(selectionMetadata: unknown): SessionAuditSnapshot | undefined {
  return extractSessionAuditSnapshot(selectionMetadata);
}

function mapSetSnapshot(
  set: {
    setIndex: number;
    targetReps?: number;
    targetRepRange?: { min: number; max: number };
    targetRpe?: number;
    targetLoad?: number;
    role?: string;
    restSeconds?: number;
  }
): SessionAuditSetSnapshot {
  return {
    setIndex: set.setIndex,
    targetReps: set.targetReps,
    targetRepRange: set.targetRepRange,
    targetRpe: set.targetRpe,
    targetLoad: set.targetLoad,
    role: set.role,
    restSeconds: set.restSeconds,
  };
}

function buildExerciseSnapshots(workout: WorkoutPlan): SessionAuditExerciseSnapshot[] {
  const sections: Array<{
    entries: WorkoutPlan["warmup"] | WorkoutPlan["mainLifts"] | WorkoutPlan["accessories"];
    section: "warmup" | "main" | "accessory";
  }> = [
    { entries: workout.warmup, section: "warmup" },
    { entries: workout.mainLifts, section: "main" },
    { entries: workout.accessories, section: "accessory" },
  ];

  return sections.flatMap(({ entries, section }) =>
    entries.map((exercise) => ({
      exerciseId: exercise.exercise.id,
      exerciseName: exercise.exercise.name,
      orderIndex: exercise.orderIndex,
      section,
      isMainLift: exercise.isMainLift,
      role: exercise.role,
      prescribedSetCount: exercise.sets.length,
      prescribedSets: exercise.sets.map(mapSetSnapshot),
    }))
  );
}

type PersistedWorkoutExerciseInput = {
  exerciseId: string;
  exercise: { name: string };
  orderIndex: number;
  section?: string | null;
  isMainLift: boolean;
  role?: string | null;
  sets: Array<{
    setIndex: number;
    targetReps?: number | null;
    targetRepMin?: number | null;
    targetRepMax?: number | null;
    targetRpe?: number | null;
    targetLoad?: number | null;
    role?: string | null;
    restSeconds?: number | null;
  }>;
};

function normalizePersistedSection(
  section: string | null | undefined
): SessionAuditExerciseSnapshot["section"] {
  const normalized = section?.trim().toUpperCase();
  if (normalized === "WARMUP") return "warmup";
  if (normalized === "ACCESSORY") return "accessory";
  return "main";
}

function buildPersistedExerciseSnapshots(
  exercises: PersistedWorkoutExerciseInput[]
): SessionAuditExerciseSnapshot[] {
  return exercises.map((exercise) => ({
    exerciseId: exercise.exerciseId,
    exerciseName: exercise.exercise.name,
    orderIndex: exercise.orderIndex,
    section: normalizePersistedSection(exercise.section),
    isMainLift: exercise.isMainLift,
    role: typeof exercise.role === "string" ? exercise.role : undefined,
    prescribedSetCount: exercise.sets.length,
    prescribedSets: exercise.sets.map((set) => ({
      setIndex: set.setIndex,
      targetReps: typeof set.targetReps === "number" ? set.targetReps : undefined,
      targetRepRange:
        typeof set.targetRepMin === "number" && typeof set.targetRepMax === "number"
          ? { min: set.targetRepMin, max: set.targetRepMax }
          : undefined,
      targetRpe: typeof set.targetRpe === "number" ? set.targetRpe : undefined,
      targetLoad: typeof set.targetLoad === "number" ? set.targetLoad : undefined,
      role: typeof set.role === "string" ? set.role : undefined,
      restSeconds: typeof set.restSeconds === "number" ? set.restSeconds : undefined,
    })),
  }));
}

function serializeSetSignature(set: SessionAuditSetSnapshot): string {
  return JSON.stringify({
    setIndex: set.setIndex,
    targetReps: set.targetReps ?? null,
    targetRepRange: set.targetRepRange ?? null,
    targetRpe: set.targetRpe ?? null,
    targetLoad: set.targetLoad ?? null,
    role: set.role ?? null,
    restSeconds: set.restSeconds ?? null,
  });
}

function serializeExercisePrescription(exercise: SessionAuditExerciseSnapshot): string {
  return JSON.stringify({
    orderIndex: exercise.orderIndex,
    section: exercise.section,
    isMainLift: exercise.isMainLift,
    role: exercise.role ?? null,
    prescribedSets: exercise.prescribedSets.map(serializeSetSignature),
  });
}

export function buildGeneratedSessionAuditSnapshot(input: {
  workout: WorkoutPlan;
  selectionMode: string;
  sessionIntent: string;
  selectionMetadata: unknown;
  targetMuscles?: string[];
  advancesSplit?: boolean | null;
  filteredExercises?: Array<{
    exerciseId?: string;
    exerciseName: string;
    reason: string;
    userFriendlyMessage: string;
  }>;
  progressionTraces?: Record<string, ProgressionDecisionTrace>;
  deloadTrace?: DeloadTransformationTrace;
}): SessionAuditSnapshot {
  const receipt = readSessionDecisionReceipt(input.selectionMetadata);
  const semantics = deriveSessionSemantics({
    advancesSplit: input.advancesSplit,
    selectionMode: input.selectionMode,
    sessionIntent: input.sessionIntent,
    selectionMetadata: input.selectionMetadata,
  });
  const exercises = buildExerciseSnapshots(input.workout);

  return {
    version: 1,
    generated: {
      selectionMode: input.selectionMode,
      sessionIntent: input.sessionIntent,
      targetMuscles: input.targetMuscles ?? receipt?.targetMuscles,
      cycleContext: receipt?.cycleContext,
      deloadDecision: receipt?.deloadDecision,
      semantics,
      exerciseCount: exercises.length,
      hardSetCount: exercises.reduce((sum, exercise) => sum + exercise.prescribedSetCount, 0),
      exercises,
      filteredExercises: input.filteredExercises,
      traces: {
        progression: input.progressionTraces ?? {},
        deload: input.deloadTrace,
      },
    },
  };
}

export function buildSavedSessionAuditSnapshot(input: {
  selectionMetadata: unknown;
  workoutId: string;
  revision?: number;
  status: string;
  advancesSplit: boolean;
  selectionMode?: string | null;
  sessionIntent?: string | null;
  mesocycleId?: string | null;
  mesocycleWeekSnapshot?: number | null;
  mesoSessionSnapshot?: number | null;
  mesocyclePhaseSnapshot?: string | null;
}): SessionAuditSnapshot {
  const existing = readSessionAuditSnapshot(input.selectionMetadata);
  const semantics = deriveSessionSemantics({
    advancesSplit: input.advancesSplit,
    selectionMode: input.selectionMode,
    sessionIntent: input.sessionIntent,
    selectionMetadata: input.selectionMetadata,
    mesocyclePhase: input.mesocyclePhaseSnapshot,
  });

  return {
    version: 1,
    generated: existing?.generated,
    saved: {
      workoutId: input.workoutId,
      revision: input.revision,
      status: input.status,
      advancesSplit: input.advancesSplit,
      mesocycleSnapshot:
        input.mesocycleId != null ||
        input.mesocycleWeekSnapshot != null ||
        input.mesoSessionSnapshot != null ||
        input.mesocyclePhaseSnapshot != null
          ? {
              mesocycleId: input.mesocycleId,
              week: input.mesocycleWeekSnapshot,
              session: input.mesoSessionSnapshot,
              phase: input.mesocyclePhaseSnapshot,
            }
          : undefined,
      semantics,
    },
  };
}

export function resolvePersistedOrReconstructedSessionAuditSnapshot(input: {
  selectionMetadata: unknown;
  workoutId: string;
  revision?: number;
  status: string;
  advancesSplit?: boolean | null;
  selectionMode?: string | null;
  sessionIntent?: string | null;
  mesocycleId?: string | null;
  mesocycleWeekSnapshot?: number | null;
  mesoSessionSnapshot?: number | null;
  mesocyclePhaseSnapshot?: string | null;
}): {
  sessionSnapshot: SessionAuditSnapshot;
  snapshotSource: "persisted" | "reconstructed_saved_only";
} {
  const persistedSnapshot = readSessionAuditSnapshot(input.selectionMetadata);
  if (persistedSnapshot) {
    return {
      sessionSnapshot: persistedSnapshot,
      snapshotSource: "persisted",
    };
  }

  return {
    sessionSnapshot: buildSavedSessionAuditSnapshot({
      selectionMetadata: input.selectionMetadata,
      workoutId: input.workoutId,
      revision: input.revision,
      status: input.status,
      advancesSplit: input.advancesSplit ?? true,
      selectionMode: input.selectionMode,
      sessionIntent: input.sessionIntent,
      mesocycleId: input.mesocycleId,
      mesocycleWeekSnapshot: input.mesocycleWeekSnapshot,
      mesoSessionSnapshot: input.mesoSessionSnapshot,
      mesocyclePhaseSnapshot: input.mesocyclePhaseSnapshot,
    }),
    snapshotSource: "reconstructed_saved_only",
  };
}

export function buildSessionAuditMutationSummary(input: {
  snapshot: SessionAuditSnapshot;
  savedSelectionMode?: string | null;
  savedSessionIntent?: string | null;
  persistedExercises?: PersistedWorkoutExerciseInput[];
}): SessionAuditMutationSummary {
  if (!input.snapshot.generated) {
    return {
      version: 1,
      comparisonState: "missing_generated_snapshot",
      hasDrift: false,
      changedFields: [],
      addedExerciseIds: [],
      removedExerciseIds: [],
      exercisesWithSetCountChanges: [],
      exercisesWithPrescriptionChanges: [],
      savedSelectionMode:
        typeof input.savedSelectionMode === "string" ? input.savedSelectionMode : undefined,
      savedSessionIntent:
        typeof input.savedSessionIntent === "string" ? input.savedSessionIntent : undefined,
      savedSemanticsKind: input.snapshot.saved?.semantics.kind,
    };
  }

  const changedFields: SessionAuditMutationSummary["changedFields"] = [];
  const generatedExercises = input.snapshot.generated.exercises;
  const persistedExercises = input.persistedExercises
    ? buildPersistedExerciseSnapshots(input.persistedExercises)
    : [];
  const generatedById = new Map(generatedExercises.map((exercise) => [exercise.exerciseId, exercise]));
  const persistedById = new Map(persistedExercises.map((exercise) => [exercise.exerciseId, exercise]));

  const addedExerciseIds = persistedExercises
    .filter((exercise) => !generatedById.has(exercise.exerciseId))
    .map((exercise) => exercise.exerciseId);
  const removedExerciseIds = generatedExercises
    .filter((exercise) => persistedById.size > 0 && !persistedById.has(exercise.exerciseId))
    .map((exercise) => exercise.exerciseId);
  const sharedExerciseIds = generatedExercises
    .map((exercise) => exercise.exerciseId)
    .filter((exerciseId) => persistedById.has(exerciseId));
  const exercisesWithSetCountChanges = sharedExerciseIds.filter((exerciseId) => {
    const generated = generatedById.get(exerciseId);
    const persisted = persistedById.get(exerciseId);
    return generated?.prescribedSetCount !== persisted?.prescribedSetCount;
  });
  const exercisesWithPrescriptionChanges = sharedExerciseIds.filter((exerciseId) => {
    const generated = generatedById.get(exerciseId);
    const persisted = persistedById.get(exerciseId);
    return (
      generated != null &&
      persisted != null &&
      serializeExercisePrescription(generated) !== serializeExercisePrescription(persisted)
    );
  });

  if (addedExerciseIds.length > 0) {
    changedFields.push("exercise_added");
  }
  if (removedExerciseIds.length > 0) {
    changedFields.push("exercise_removed");
  }
  if (exercisesWithSetCountChanges.length > 0) {
    changedFields.push("exercise_set_count_changed");
  }
  if (exercisesWithPrescriptionChanges.length > 0) {
    changedFields.push("exercise_prescription_changed");
  }

  const savedSelectionMode =
    typeof input.savedSelectionMode === "string" ? input.savedSelectionMode : undefined;
  const savedSessionIntent =
    typeof input.savedSessionIntent === "string" ? input.savedSessionIntent : undefined;
  if (
    savedSelectionMode &&
    savedSelectionMode !== input.snapshot.generated.selectionMode
  ) {
    changedFields.push("selection_mode");
  }
  if (
    savedSessionIntent &&
    savedSessionIntent !== input.snapshot.generated.sessionIntent
  ) {
    changedFields.push("session_intent");
  }

  const generatedSemantics = input.snapshot.generated.semantics;
  const savedSemantics = input.snapshot.saved?.semantics;
  if (savedSemantics && savedSemantics.kind !== generatedSemantics.kind) {
    changedFields.push("semantics_kind");
  }
  if (
    savedSemantics &&
    savedSemantics.countsTowardProgressionHistory !==
      generatedSemantics.countsTowardProgressionHistory
  ) {
    changedFields.push("progression_history_eligibility");
  }

  return {
    version: 1,
    comparisonState: "comparable",
    hasDrift: changedFields.length > 0,
    changedFields,
    addedExerciseIds,
    removedExerciseIds,
    exercisesWithSetCountChanges,
    exercisesWithPrescriptionChanges,
    generatedSelectionMode: input.snapshot.generated.selectionMode,
    savedSelectionMode,
    generatedSessionIntent: input.snapshot.generated.sessionIntent,
    savedSessionIntent,
    generatedSemanticsKind: generatedSemantics.kind,
    savedSemanticsKind: savedSemantics?.kind,
  };
}

export function attachSessionAuditSnapshotToSelectionMetadata(
  selectionMetadata: unknown,
  sessionAuditSnapshot: SessionAuditSnapshot
): JsonRecord {
  return {
    ...(toObject(selectionMetadata) ?? {}),
    sessionAuditSnapshot,
  };
}
