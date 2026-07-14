import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { normalizeExposedMuscle } from "@/lib/engine/volume-landmarks";
import { readSessionSlotSnapshot } from "@/lib/evidence/session-decision-receipt";
import { readSessionDecisionReceipt } from "@/lib/evidence/session-decision-receipt";
import { deriveSessionSemantics } from "@/lib/session-semantics/derive-session-semantics";
import { classifySetLog } from "@/lib/session-semantics/set-classification";
import {
  getEffectiveStimulusFromSnapshot,
  getRelationshipMusclesFromSnapshot,
  parseExerciseStimulusSnapshot,
  type ExerciseStimulusAccountingEvidence,
  type ExerciseStimulusSnapshot,
} from "@/lib/stimulus-accounting/snapshot";
import {
  readRuntimeEditReconciliation,
  readWorkoutStructureState,
  type RuntimeEditReconciliation,
} from "@/lib/ui/selection-metadata";

const INCOMPLETE_WORKOUT_STATUSES = ["PLANNED", "IN_PROGRESS"] as const;
const CONTRIBUTION_PRECISION = 6;

type WorkoutReader =
  | Pick<Prisma.TransactionClient, "workout">
  | Pick<typeof prisma, "workout">;

export type PersistedIncompleteWorkoutSetLog = {
  id: string;
  setIntent?: "WORK" | "WARMUP" | null;
  actualReps?: number | null;
  actualRpe?: number | null;
  actualLoad?: number | null;
  wasSkipped: boolean;
  completedAt: Date;
};

export type PersistedIncompleteWorkoutSet = {
  id: string;
  setIndex: number;
  targetReps: number;
  targetRepMin?: number | null;
  targetRepMax?: number | null;
  targetRpe?: number | null;
  targetLoad?: number | null;
  restSeconds?: number | null;
  logs: PersistedIncompleteWorkoutSetLog[];
};

export type PersistedIncompleteWorkoutExercise = {
  id: string;
  exerciseId: string;
  orderIndex: number;
  section?: "WARMUP" | "MAIN" | "ACCESSORY" | null;
  isMainLift: boolean;
  movementPatterns: string[];
  stimulusAccountingSnapshot: unknown;
  exercise: {
    id: string;
    name: string;
  };
  sets: PersistedIncompleteWorkoutSet[];
};

export type PersistedIncompleteWorkoutRecord = {
  id: string;
  userId: string;
  status: string;
  scheduledDate: Date;
  mesocycleId?: string | null;
  mesocycleWeekSnapshot?: number | null;
  mesoSessionSnapshot?: number | null;
  advancesSplit?: boolean | null;
  selectionMode?: string | null;
  sessionIntent?: string | null;
  selectionMetadata?: unknown;
  exercises: PersistedIncompleteWorkoutExercise[];
};

export type IncompleteWorkoutContribution = {
  qualifyingSets: number;
  contributionsByMuscle: Record<string, number>;
};

export type IncompleteWorkoutProjectionExercise = {
  workoutExerciseId: string;
  exerciseId: string;
  exerciseName: string;
  orderIndex: number;
  section: "MAIN" | "ACCESSORY";
  movementPatterns: string[];
  primaryMuscles: string[];
  snapshotVersion: number | null;
  snapshotHash: string | null;
  status: "reliable" | "unreliable";
  reasons: string[];
  performedSetIds: string[];
  remainingSetIds: string[];
  excludedSetIds: string[];
  performed: IncompleteWorkoutContribution;
  remaining: IncompleteWorkoutContribution;
  totalProjected: IncompleteWorkoutContribution;
  projectedSets: Array<{
    workoutSetId: string;
    setIndex: number;
    category: "performed" | "remaining";
    targetReps: number;
    targetRpe: number | null;
    targetLoad: number | null;
  }>;
};

export type IncompleteWorkoutProjection = {
  workoutId: string;
  status: "reliable" | "unreliable";
  workoutStatus: string;
  slotId: string | null;
  intent: string | null;
  scheduledDate: string;
  mesoSessionSnapshot: number | null;
  sessionKind: ReturnType<typeof deriveSessionSemantics>["kind"];
  consumesWeeklyScheduleIntent: boolean;
  countsTowardProgressionHistory: boolean;
  countsTowardPerformanceHistory: boolean;
  performed: IncompleteWorkoutContribution;
  remaining: IncompleteWorkoutContribution;
  totalProjected: IncompleteWorkoutContribution;
  exercises: IncompleteWorkoutProjectionExercise[];
  evidence: {
    source: "persisted_immutable_workout";
    snapshotVersions: number[];
    exerciseCount: number;
    runtimeEditAttribution: "not_needed" | "exact" | "ambiguous";
    reasons: string[];
  };
};

type ContributionAccumulator = {
  qualifyingSets: number;
  contributionsByMuscle: Map<string, number>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeContribution(value: number): number {
  if (!Number.isFinite(value) || value === 0) {
    return 0;
  }
  return Number(value.toFixed(CONTRIBUTION_PRECISION));
}

function createAccumulator(): ContributionAccumulator {
  return {
    qualifyingSets: 0,
    contributionsByMuscle: new Map(),
  };
}

function addSnapshotContribution(
  accumulator: ContributionAccumulator,
  snapshot: ExerciseStimulusSnapshot,
  setCount: number
): void {
  if (setCount <= 0) {
    return;
  }
  accumulator.qualifyingSets += setCount;
  for (const [muscle, contribution] of getEffectiveStimulusFromSnapshot(
    snapshot,
    setCount
  )) {
    const exposedMuscle = normalizeExposedMuscle(muscle);
    accumulator.contributionsByMuscle.set(
      exposedMuscle,
      (accumulator.contributionsByMuscle.get(exposedMuscle) ?? 0) + contribution
    );
  }
}

function mergeAccumulator(
  target: ContributionAccumulator,
  source: IncompleteWorkoutContribution
): void {
  target.qualifyingSets += source.qualifyingSets;
  for (const [muscle, contribution] of Object.entries(
    source.contributionsByMuscle
  )) {
    target.contributionsByMuscle.set(
      muscle,
      (target.contributionsByMuscle.get(muscle) ?? 0) + contribution
    );
  }
}

function finalizeAccumulator(
  accumulator: ContributionAccumulator
): IncompleteWorkoutContribution {
  return {
    qualifyingSets: accumulator.qualifyingSets,
    contributionsByMuscle: Object.fromEntries(
      Array.from(accumulator.contributionsByMuscle.entries())
        .map(([muscle, contribution]): [string, number] => [
          muscle,
          normalizeContribution(contribution),
        ])
        .filter(([, contribution]) => contribution !== 0)
        .sort(([left], [right]) => left.localeCompare(right))
    ),
  };
}

function combineContributions(
  left: IncompleteWorkoutContribution,
  right: IncompleteWorkoutContribution
): IncompleteWorkoutContribution {
  const accumulator = createAccumulator();
  mergeAccumulator(accumulator, left);
  mergeAccumulator(accumulator, right);
  return finalizeAccumulator(accumulator);
}

function normalizeSection(
  exercise: PersistedIncompleteWorkoutExercise
): "WARMUP" | "MAIN" | "ACCESSORY" {
  if (exercise.section === "WARMUP" || exercise.section === "MAIN") {
    return exercise.section;
  }
  return exercise.isMainLift ? "MAIN" : "ACCESSORY";
}

function evidenceMatches(
  snapshot: ExerciseStimulusSnapshot,
  evidence: ExerciseStimulusAccountingEvidence | undefined
): boolean {
  return Boolean(
    evidence &&
      evidence.contractVersion === snapshot.version &&
      evidence.snapshotHash === snapshot.policyHash &&
      evidence.provenance === snapshot.provenance
  );
}

function getRawRuntimeEditState(selectionMetadata: unknown): {
  present: boolean;
  opCount: number | null;
} {
  const metadata = isRecord(selectionMetadata) ? selectionMetadata : null;
  const raw = isRecord(metadata?.runtimeEditReconciliation)
    ? metadata.runtimeEditReconciliation
    : null;
  return {
    present: raw != null,
    opCount: Array.isArray(raw?.ops) ? raw.ops.length : null,
  };
}

function getRawWorkoutStructureExerciseCount(
  selectionMetadata: unknown
): number | null {
  const metadata = isRecord(selectionMetadata) ? selectionMetadata : null;
  const raw = isRecord(metadata?.workoutStructureState)
    ? metadata.workoutStructureState
    : null;
  return Array.isArray(raw?.currentExercises)
    ? raw.currentExercises.length
    : raw == null
      ? null
      : -1;
}

function validateCurrentStructure(input: {
  workout: PersistedIncompleteWorkoutRecord;
  reasons: Set<string>;
}): void {
  const orderIndexes = input.workout.exercises.map(
    (exercise) => exercise.orderIndex
  );
  if (new Set(orderIndexes).size !== orderIndexes.length) {
    input.reasons.add("duplicate_workout_exercise_order_index");
  }

  const structureState = readWorkoutStructureState(
    input.workout.selectionMetadata
  );
  const rawExerciseCount = getRawWorkoutStructureExerciseCount(
    input.workout.selectionMetadata
  );
  if (rawExerciseCount === -1 || (rawExerciseCount != null && !structureState)) {
    input.reasons.add("invalid_workout_structure_state");
    return;
  }
  if (!structureState) {
    return;
  }
  if (structureState.currentExercises.length !== input.workout.exercises.length) {
    input.reasons.add("workout_structure_state_count_mismatch");
    return;
  }

  const persisted = [...input.workout.exercises]
    .sort(
      (left, right) =>
        left.orderIndex - right.orderIndex || left.id.localeCompare(right.id)
    )
    .map((exercise) => ({
      exerciseId: exercise.exerciseId,
      orderIndex: exercise.orderIndex,
      section: normalizeSection(exercise),
      setCount: exercise.sets.length,
    }));
  if (JSON.stringify(structureState.currentExercises) !== JSON.stringify(persisted)) {
    input.reasons.add("workout_structure_state_mismatch");
  }
}

function validateRuntimeEditState(input: {
  workout: PersistedIncompleteWorkoutRecord;
  reconciliation: RuntimeEditReconciliation | undefined;
  snapshots: Map<string, ExerciseStimulusSnapshot>;
  reasons: Set<string>;
}): {
  runtimeAddedExerciseIds: Set<string>;
  runtimeReplacedExerciseIds: Set<string>;
  attribution: IncompleteWorkoutProjection["evidence"]["runtimeEditAttribution"];
} {
  const rawState = getRawRuntimeEditState(input.workout.selectionMetadata);
  if (
    rawState.present &&
    (!input.reconciliation ||
      rawState.opCount == null ||
      rawState.opCount !== input.reconciliation.ops.length)
  ) {
    input.reasons.add("invalid_runtime_edit_reconciliation");
  }

  const exercisesById = new Map(
    input.workout.exercises.map((exercise) => [exercise.id, exercise])
  );
  const runtimeAddedExerciseIds = new Set<string>();
  const runtimeReplacedExerciseIds = new Set<string>();
  const removedExerciseIds = new Set<string>();
  let attribution: IncompleteWorkoutProjection["evidence"]["runtimeEditAttribution"] =
    input.reconciliation?.ops.length ? "exact" : "not_needed";

  for (const operation of input.reconciliation?.ops ?? []) {
    if (operation.kind === "add_exercise") {
      const workoutExerciseId = operation.facts.workoutExerciseId;
      if (!workoutExerciseId) {
        input.reasons.add("runtime_add_missing_workout_exercise_id");
        attribution = "ambiguous";
        continue;
      }
      runtimeAddedExerciseIds.add(workoutExerciseId);
      const exercise = exercisesById.get(workoutExerciseId);
      if (!exercise) {
        continue;
      }
      const snapshot = input.snapshots.get(workoutExerciseId);
      if (
        exercise.exerciseId !== operation.facts.exerciseId ||
        !snapshot ||
        snapshot.provenance !== "exact" ||
        !evidenceMatches(snapshot, operation.facts.stimulusAccounting)
      ) {
        input.reasons.add(
          `runtime_add_attribution_mismatch:${workoutExerciseId}`
        );
        attribution = "ambiguous";
      }
      continue;
    }

    if (operation.kind === "add_set") {
      const exercise = exercisesById.get(operation.facts.workoutExerciseId);
      if (
        !exercise ||
        exercise.exerciseId !== operation.facts.exerciseId ||
        !exercise.sets.some((set) => set.id === operation.facts.workoutSetId)
      ) {
        input.reasons.add(
          `runtime_added_set_missing:${operation.facts.workoutSetId}`
        );
        attribution = "ambiguous";
      }
      continue;
    }

    if (operation.kind === "remove_exercise") {
      removedExerciseIds.add(operation.facts.workoutExerciseId);
      if (
        exercisesById.has(operation.facts.workoutExerciseId) ||
        !runtimeAddedExerciseIds.has(operation.facts.workoutExerciseId)
      ) {
        input.reasons.add(
          `runtime_remove_attribution_ambiguous:${operation.facts.workoutExerciseId}`
        );
        attribution = "ambiguous";
      }
      continue;
    }

    if (operation.kind === "replace_exercise") {
      const workoutExerciseId = operation.facts.workoutExerciseId;
      const exercise = exercisesById.get(workoutExerciseId);
      const snapshot = input.snapshots.get(workoutExerciseId);
      runtimeReplacedExerciseIds.add(workoutExerciseId);
      if (
        !exercise ||
        exercise.exerciseId !== operation.facts.toExerciseId ||
        !snapshot ||
        snapshot.provenance !== "exact" ||
        !evidenceMatches(snapshot, operation.facts.toStimulusAccounting)
      ) {
        input.reasons.add(`runtime_swap_attribution_mismatch:${workoutExerciseId}`);
        attribution = "ambiguous";
        continue;
      }

      const appliedAt = Date.parse(operation.appliedAt);
      const hasPreSwapLog = exercise.sets.some((set) =>
        set.logs.some(
          (log) =>
            !Number.isFinite(appliedAt) ||
            log.completedAt.getTime() <= appliedAt
        )
      );
      if (hasPreSwapLog) {
        input.reasons.add(
          `runtime_swap_original_performed_attribution_unavailable:${workoutExerciseId}`
        );
        attribution = "ambiguous";
      }
    }
  }

  for (const workoutExerciseId of runtimeAddedExerciseIds) {
    if (
      !exercisesById.has(workoutExerciseId) &&
      !removedExerciseIds.has(workoutExerciseId)
    ) {
      input.reasons.add(`runtime_added_exercise_missing:${workoutExerciseId}`);
      attribution = "ambiguous";
    }
  }

  return {
    runtimeAddedExerciseIds,
    runtimeReplacedExerciseIds,
    attribution,
  };
}

function validateReceiptManifest(input: {
  workout: PersistedIncompleteWorkoutRecord;
  snapshots: Map<string, ExerciseStimulusSnapshot>;
  runtimeAddedExerciseIds: Set<string>;
  runtimeReplacedExerciseIds: Set<string>;
  reasons: Set<string>;
}): void {
  const manifest = readSessionDecisionReceipt(
    input.workout.selectionMetadata
  )?.stimulusAccounting;
  if (!manifest) {
    return;
  }
  const manifestByOrder = new Map(
    manifest.exercises.map((entry) => [entry.orderIndex, entry])
  );
  if (manifestByOrder.size !== manifest.exercises.length) {
    input.reasons.add("duplicate_receipt_stimulus_manifest_order_index");
  }

  for (const exercise of input.workout.exercises) {
    if (
      normalizeSection(exercise) === "WARMUP" ||
      input.runtimeAddedExerciseIds.has(exercise.id) ||
      input.runtimeReplacedExerciseIds.has(exercise.id)
    ) {
      continue;
    }
    const snapshot = input.snapshots.get(exercise.id);
    const entry = manifestByOrder.get(exercise.orderIndex);
    if (
      snapshot &&
      entry &&
      (entry.sourceExerciseId !== exercise.exerciseId ||
        !evidenceMatches(snapshot, entry))
    ) {
      input.reasons.add(`receipt_snapshot_mismatch:${exercise.id}`);
    }
  }
}

function projectExercise(input: {
  exercise: PersistedIncompleteWorkoutExercise;
  snapshot: ExerciseStimulusSnapshot | undefined;
  includeRemaining: boolean;
  inheritedReasons: string[];
}): IncompleteWorkoutProjectionExercise | null {
  const section = normalizeSection(input.exercise);
  if (section === "WARMUP") {
    return null;
  }

  const reasons = new Set(input.inheritedReasons);
  if (input.exercise.sets.length === 0) {
    reasons.add(`missing_persisted_set_structure:${input.exercise.id}`);
  }
  const setIds = input.exercise.sets.map((set) => set.id);
  const setIndexes = input.exercise.sets.map((set) => set.setIndex);
  if (new Set(setIds).size !== setIds.length) {
    reasons.add(`duplicate_workout_set_id:${input.exercise.id}`);
  }
  if (new Set(setIndexes).size !== setIndexes.length) {
    reasons.add(`duplicate_workout_set_index:${input.exercise.id}`);
  }

  const performedSetIds: string[] = [];
  const remainingSetIds: string[] = [];
  const excludedSetIds: string[] = [];
  const projectedSets: IncompleteWorkoutProjectionExercise["projectedSets"] = [];

  for (const set of [...input.exercise.sets].sort(
    (left, right) => left.setIndex - right.setIndex || left.id.localeCompare(right.id)
  )) {
    if (set.logs.length > 1) {
      reasons.add(`duplicate_set_log:${set.id}`);
      excludedSetIds.push(set.id);
      continue;
    }
    const log = set.logs[0];
    if (
      log?.wasSkipped === true &&
      (log.actualReps != null || log.actualRpe != null || log.actualLoad != null)
    ) {
      reasons.add(`contradictory_skipped_set_log:${set.id}`);
      excludedSetIds.push(set.id);
      continue;
    }

    const classification = classifySetLog(log);
    if (classification.isSkipped) {
      excludedSetIds.push(set.id);
      continue;
    }
    if (classification.countsTowardVolume) {
      performedSetIds.push(set.id);
      projectedSets.push({
        workoutSetId: set.id,
        setIndex: set.setIndex,
        category: "performed",
        targetReps: set.targetReps,
        targetRpe: set.targetRpe ?? null,
        targetLoad: set.targetLoad ?? null,
      });
      continue;
    }
    if (input.includeRemaining) {
      remainingSetIds.push(set.id);
      projectedSets.push({
        workoutSetId: set.id,
        setIndex: set.setIndex,
        category: "remaining",
        targetReps: set.targetReps,
        targetRpe: set.targetRpe ?? null,
        targetLoad: set.targetLoad ?? null,
      });
    } else {
      excludedSetIds.push(set.id);
    }
  }

  const contributingSetCount = performedSetIds.length + remainingSetIds.length;
  if (contributingSetCount > 0 && !input.snapshot) {
    reasons.add(`missing_or_invalid_stimulus_snapshot:${input.exercise.id}`);
  }

  const performedAccumulator = createAccumulator();
  const remainingAccumulator = createAccumulator();
  if (input.snapshot) {
    addSnapshotContribution(
      performedAccumulator,
      input.snapshot,
      performedSetIds.length
    );
    addSnapshotContribution(
      remainingAccumulator,
      input.snapshot,
      remainingSetIds.length
    );
  }
  const performed = finalizeAccumulator(performedAccumulator);
  const remaining = finalizeAccumulator(remainingAccumulator);

  return {
    workoutExerciseId: input.exercise.id,
    exerciseId: input.exercise.exerciseId,
    exerciseName: input.exercise.exercise.name,
    orderIndex: input.exercise.orderIndex,
    section,
    movementPatterns: [...new Set(input.exercise.movementPatterns)].sort(),
    primaryMuscles: input.snapshot
      ? getRelationshipMusclesFromSnapshot(input.snapshot, "primary")
          .map(normalizeExposedMuscle)
          .filter((muscle, index, muscles) => muscles.indexOf(muscle) === index)
          .sort()
      : [],
    snapshotVersion: input.snapshot?.version ?? null,
    snapshotHash: input.snapshot?.policyHash ?? null,
    status: reasons.size === 0 ? "reliable" : "unreliable",
    reasons: Array.from(reasons).sort(),
    performedSetIds,
    remainingSetIds,
    excludedSetIds,
    performed,
    remaining,
    totalProjected: combineContributions(performed, remaining),
    projectedSets,
  };
}

export function projectPersistedIncompleteWorkout(input: {
  workout: PersistedIncompleteWorkoutRecord;
  expectedUserId: string;
  expectedMesocycleId: string;
  expectedWeek: number;
  requireSlotIdentity: boolean;
}): IncompleteWorkoutProjection {
  const reasons = new Set<string>();
  if (
    !INCOMPLETE_WORKOUT_STATUSES.includes(
      input.workout.status as (typeof INCOMPLETE_WORKOUT_STATUSES)[number]
    )
  ) {
    reasons.add(`invalid_incomplete_workout_status:${input.workout.status}`);
  }
  if (input.workout.userId !== input.expectedUserId) {
    reasons.add("workout_owner_mismatch");
  }
  if (input.workout.mesocycleId !== input.expectedMesocycleId) {
    reasons.add("workout_mesocycle_mismatch");
  }
  if (input.workout.mesocycleWeekSnapshot !== input.expectedWeek) {
    reasons.add("workout_week_placement_mismatch");
  }
  if (!input.workout.sessionIntent) {
    reasons.add("missing_session_intent");
  }

  const sessionSlot = readSessionSlotSnapshot(input.workout.selectionMetadata);
  const semantics = deriveSessionSemantics({
    advancesSplit: input.workout.advancesSplit,
    selectionMetadata: input.workout.selectionMetadata,
    selectionMode: input.workout.selectionMode,
    sessionIntent: input.workout.sessionIntent,
  });
  if (
    input.requireSlotIdentity &&
    semantics.consumesWeeklyScheduleIntent &&
    !sessionSlot?.slotId
  ) {
    reasons.add("missing_session_slot_identity");
  }
  const includeRemaining = semantics.consumesWeeklyScheduleIntent;

  validateCurrentStructure({ workout: input.workout, reasons });
  const snapshots = new Map<string, ExerciseStimulusSnapshot>();
  for (const exercise of input.workout.exercises) {
    const snapshot = parseExerciseStimulusSnapshot(
      exercise.stimulusAccountingSnapshot
    );
    if (snapshot && snapshot.sourceExerciseId === exercise.exerciseId) {
      snapshots.set(exercise.id, snapshot);
    }
  }

  const reconciliation = readRuntimeEditReconciliation(
    input.workout.selectionMetadata
  );
  const runtimeEditState = validateRuntimeEditState({
    workout: input.workout,
    reconciliation,
    snapshots,
    reasons,
  });
  validateReceiptManifest({
    workout: input.workout,
    snapshots,
    runtimeAddedExerciseIds: runtimeEditState.runtimeAddedExerciseIds,
    runtimeReplacedExerciseIds: runtimeEditState.runtimeReplacedExerciseIds,
    reasons,
  });

  const exercises = [...input.workout.exercises]
    .sort(
      (left, right) =>
        left.orderIndex - right.orderIndex || left.id.localeCompare(right.id)
    )
    .map((exercise) =>
      projectExercise({
        exercise,
        snapshot: snapshots.get(exercise.id),
        includeRemaining,
        inheritedReasons: [],
      })
    )
    .filter(
      (exercise): exercise is IncompleteWorkoutProjectionExercise =>
        exercise != null
    );
  for (const exercise of exercises) {
    for (const reason of exercise.reasons) {
      reasons.add(reason);
    }
  }

  const performedAccumulator = createAccumulator();
  const remainingAccumulator = createAccumulator();
  for (const exercise of exercises) {
    mergeAccumulator(performedAccumulator, exercise.performed);
    mergeAccumulator(remainingAccumulator, exercise.remaining);
  }
  const performed = finalizeAccumulator(performedAccumulator);
  const remaining = finalizeAccumulator(remainingAccumulator);
  const snapshotVersions = Array.from(
    new Set(exercises.flatMap((exercise) => exercise.snapshotVersion ?? []))
  ).sort((left, right) => left - right);

  return {
    workoutId: input.workout.id,
    status: reasons.size === 0 ? "reliable" : "unreliable",
    workoutStatus: input.workout.status,
    slotId: sessionSlot?.slotId ?? null,
    intent: input.workout.sessionIntent?.toLowerCase() ?? null,
    scheduledDate: input.workout.scheduledDate.toISOString(),
    mesoSessionSnapshot: input.workout.mesoSessionSnapshot ?? null,
    sessionKind: semantics.kind,
    consumesWeeklyScheduleIntent: semantics.consumesWeeklyScheduleIntent,
    countsTowardProgressionHistory: semantics.countsTowardProgressionHistory,
    countsTowardPerformanceHistory: semantics.countsTowardPerformanceHistory,
    performed,
    remaining,
    totalProjected: combineContributions(performed, remaining),
    exercises,
    evidence: {
      source: "persisted_immutable_workout",
      snapshotVersions,
      exerciseCount: exercises.length,
      runtimeEditAttribution: runtimeEditState.attribution,
      reasons: Array.from(reasons).sort(),
    },
  };
}

export async function loadPersistedIncompleteWorkoutProjections(
  client: WorkoutReader,
  input: {
    userId: string;
    mesocycleId: string;
    targetWeek: number;
    requireSlotIdentity: boolean;
  }
): Promise<IncompleteWorkoutProjection[]> {
  const workouts = await client.workout.findMany({
    where: {
      userId: input.userId,
      mesocycleId: input.mesocycleId,
      status: { in: [...INCOMPLETE_WORKOUT_STATUSES] },
    },
    orderBy: [
      { mesoSessionSnapshot: "asc" },
      { scheduledDate: "asc" },
      { id: "asc" },
    ],
    select: {
      id: true,
      userId: true,
      status: true,
      scheduledDate: true,
      mesocycleId: true,
      mesocycleWeekSnapshot: true,
      mesoSessionSnapshot: true,
      advancesSplit: true,
      selectionMode: true,
      sessionIntent: true,
      selectionMetadata: true,
      exercises: {
        orderBy: [{ orderIndex: "asc" }, { id: "asc" }],
        select: {
          id: true,
          exerciseId: true,
          orderIndex: true,
          section: true,
          isMainLift: true,
          movementPatterns: true,
          stimulusAccountingSnapshot: true,
          exercise: {
            select: {
              id: true,
              name: true,
            },
          },
          sets: {
            orderBy: [{ setIndex: "asc" }, { id: "asc" }],
            select: {
              id: true,
              setIndex: true,
              targetReps: true,
              targetRepMin: true,
              targetRepMax: true,
              targetRpe: true,
              targetLoad: true,
              restSeconds: true,
              logs: {
                orderBy: [{ completedAt: "asc" }, { id: "asc" }],
                select: {
                  id: true,
                  setIntent: true,
                  actualReps: true,
                  actualRpe: true,
                  actualLoad: true,
                  wasSkipped: true,
                  completedAt: true,
                },
              },
            },
          },
        },
      },
    },
  });

  return (workouts as unknown as PersistedIncompleteWorkoutRecord[]).map(
    (workout) =>
      projectPersistedIncompleteWorkout({
        workout,
        expectedUserId: input.userId,
        expectedMesocycleId: input.mesocycleId,
        expectedWeek: input.targetWeek,
        requireSlotIdentity: input.requireSlotIdentity,
      })
  );
}
