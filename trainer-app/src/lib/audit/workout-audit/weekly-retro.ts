import { readFile } from "node:fs/promises";
import { prisma } from "@/lib/db/prisma";
import { getExposedVolumeLandmarkEntries } from "@/lib/engine/volume-landmarks";
import { readSessionSlotSnapshot } from "@/lib/evidence/session-decision-receipt";
import { getWeeklyVolumeTarget } from "@/lib/api/mesocycle-lifecycle-math";
import { loadMesocycleWeekMuscleVolume } from "@/lib/api/weekly-volume";
import { readRuntimeEditReconciliation } from "@/lib/ui/selection-metadata";
import type { SessionAuditExerciseSnapshot } from "@/lib/evidence/session-audit-types";
import { WEEKLY_RETRO_AUDIT_PAYLOAD_VERSION } from "./constants";
import { buildHistoricalWeekAuditPayload } from "./historical-week";
import { buildProjectionDeliveryDrift } from "./projection-drift";
import {
  interpretRuntimeEdits,
  type RuntimeEditExerciseContext,
  type RuntimeEditTargetContext,
} from "./runtime-edit-interpretation";
import type {
  HistoricalWeekAuditSession,
  RuntimeEditIntent,
  RuntimeEditInterpretation,
  WeeklyRetroExerciseLoadCalibrationRow,
  WeeklyRetroAuditPayload,
  WeeklyRetroPlanAdherence,
  WeeklyRetroAuditSessionExecutionRow,
  WeeklyRetroAuditVolumeRow,
} from "./types";

const DEFAULT_FALLBACK_LANDMARK = {
  mev: 0,
  mav: 10,
};

type WeeklyRetroRuntimeWorkoutRow = {
  id: string;
  selectionMetadata: unknown;
  exercises: Array<{
    exerciseId: string;
    orderIndex: number;
    sets: Array<{
      setIndex: number;
      targetReps: number;
      targetRepMin?: number | null;
      targetRepMax?: number | null;
      targetRpe?: number | null;
      targetLoad?: number | null;
      logs?: Array<{
        actualReps?: number | null;
        actualRpe?: number | null;
        actualLoad?: number | null;
        wasSkipped: boolean;
      }>;
    }>;
    exercise: {
      name: string;
      aliases: Array<{ alias: string }>;
      exerciseMuscles: Array<{
        role: string;
        muscle: { name: string };
      }>;
    };
  }>;
};

type WeeklyRetroRuntimeWorkoutExercise =
  WeeklyRetroRuntimeWorkoutRow["exercises"][number];

type WeeklyRetroRuntimeWorkoutSet =
  WeeklyRetroRuntimeWorkoutExercise["sets"][number];

type ExerciseTargetPrescription = Pick<
  WeeklyRetroExerciseLoadCalibrationRow,
  "targetLoad" | "targetRepRange" | "targetRpe"
>;

function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

function computeMesoWeekStartDate(
  macroStartDate: Date,
  mesocycleStartWeek: number,
  week: number
): Date {
  const date = new Date(macroStartDate);
  date.setDate(date.getDate() + (mesocycleStartWeek + week - 1) * 7);
  return date;
}

function resolveSessionSemantics(session: HistoricalWeekAuditSession) {
  return session.sessionSnapshot.saved?.semantics ?? session.sessionSnapshot.generated?.semantics;
}

function normalizeIntent(intent: string | undefined): string | undefined {
  return typeof intent === "string" ? intent.trim().toLowerCase() : undefined;
}

function sumPositiveSetDeltas(
  interpretations: RuntimeEditInterpretation[],
  predicate: (interpretation: RuntimeEditInterpretation) => boolean
): number {
  return interpretations.reduce(
    (sum, interpretation) =>
      interpretation.setDelta > 0 && predicate(interpretation)
        ? sum + interpretation.setDelta
        : sum,
    0
  );
}

function countGeneratedPlannedSets(session: HistoricalWeekAuditSession): number {
  return (
    session.sessionSnapshot.generated?.exercises.reduce(
      (sum, exercise) => sum + exercise.prescribedSetCount,
      0
    ) ?? 0
  );
}

function buildGeneratedSetCounts(
  session: HistoricalWeekAuditSession
): Map<string, number> {
  return new Map(
    (session.sessionSnapshot.generated?.exercises ?? []).map((exercise) => [
      exercise.exerciseId,
      exercise.prescribedSetCount,
    ])
  );
}

function buildSavedSetCounts(
  workout: WeeklyRetroRuntimeWorkoutRow | undefined
): Map<string, number> {
  return new Map(
    (workout?.exercises ?? []).map((exercise) => [
      exercise.exerciseId,
      countPerformedOrStructuredSets(exercise.sets),
    ])
  );
}

function countPerformedOrStructuredSets(
  sets: WeeklyRetroRuntimeWorkoutRow["exercises"][number]["sets"]
): number {
  if (sets.some((set) => Array.isArray(set.logs))) {
    return sets.filter((set) => (set.logs?.length ?? 0) > 0 && !set.logs?.[0]?.wasSkipped).length;
  }
  return sets.length;
}

function countSavedSets(sets: WeeklyRetroRuntimeWorkoutSet[]): number {
  return sets.length;
}

function countPerformedSets(sets: WeeklyRetroRuntimeWorkoutSet[]): number {
  return sets.filter((set) => {
    const latestLog = set.logs?.[0];
    return latestLog && !latestLog.wasSkipped;
  }).length;
}

function countSkippedSets(sets: WeeklyRetroRuntimeWorkoutSet[]): number {
  return sets.filter((set) => set.logs?.[0]?.wasSkipped === true).length;
}

function median(values: number[]): number | undefined {
  if (values.length === 0) {
    return undefined;
  }
  const sorted = values.slice().sort((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[midpoint];
  }
  return (sorted[midpoint - 1] + sorted[midpoint]) / 2;
}

function modal(values: number[]): number | undefined {
  if (values.length === 0) {
    return undefined;
  }
  const counts = new Map<number, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return values
    .slice()
    .sort((left, right) => {
      const countDelta = (counts.get(right) ?? 0) - (counts.get(left) ?? 0);
      return countDelta !== 0 ? countDelta : left - right;
    })[0];
}

function firstFinite(values: Array<number | null | undefined>): number | undefined {
  return values.find(
    (value): value is number => typeof value === "number" && Number.isFinite(value)
  );
}

function resolveTargetRepRange(input: {
  targetReps?: number | null;
  targetRepMin?: number | null;
  targetRepMax?: number | null;
}): { min: number; max: number } | undefined {
  if (typeof input.targetRepMin === "number" && typeof input.targetRepMax === "number") {
    return { min: input.targetRepMin, max: input.targetRepMax };
  }
  if (typeof input.targetReps === "number") {
    return { min: input.targetReps, max: input.targetReps };
  }
  return undefined;
}

function resolveTargetPrescription(input: {
  generatedExercise?: SessionAuditExerciseSnapshot;
  savedExercise?: WeeklyRetroRuntimeWorkoutExercise;
}): ExerciseTargetPrescription {
  const generatedSets = input.generatedExercise?.prescribedSets ?? [];
  const savedSets = input.savedExercise?.sets ?? [];
  const generatedRepRange = generatedSets
    .map((set) => resolveTargetRepRange(set))
    .find((range): range is { min: number; max: number } => Boolean(range));
  const savedRepRange = savedSets
    .map((set) =>
      resolveTargetRepRange({
        targetReps: set.targetReps,
        targetRepMin: set.targetRepMin,
        targetRepMax: set.targetRepMax,
      })
    )
    .find((range): range is { min: number; max: number } => Boolean(range));

  return {
    targetLoad:
      firstFinite(generatedSets.map((set) => set.targetLoad)) ??
      firstFinite(savedSets.map((set) => set.targetLoad)),
    targetRepRange: generatedRepRange ?? savedRepRange,
    targetRpe:
      firstFinite(generatedSets.map((set) => set.targetRpe)) ??
      firstFinite(savedSets.map((set) => set.targetRpe)),
  };
}

function summarizePerformedLoad(
  sets: WeeklyRetroRuntimeWorkoutSet[],
  targetLoad: number | undefined
): WeeklyRetroExerciseLoadCalibrationRow["performedLoadSummary"] {
  const performedSets = sets
    .filter((set) => {
      const latestLog = set.logs?.[0];
      return latestLog && !latestLog.wasSkipped;
    })
    .sort((left, right) => left.setIndex - right.setIndex);
  const loads = performedSets
    .map((set) => set.logs?.[0]?.actualLoad)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const reps = performedSets
    .map((set) => set.logs?.[0]?.actualReps)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const rpes = performedSets
    .map((set) => set.logs?.[0]?.actualRpe)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const medianLoad = median(loads);

  return {
    anchorLoad: loads[0],
    medianLoad,
    medianReps: median(reps),
    modalRpe: modal(rpes),
    loadDeltaPct:
      typeof targetLoad === "number" && targetLoad > 0 && typeof medianLoad === "number"
        ? roundToTenth(((medianLoad - targetLoad) / targetLoad) * 100)
        : undefined,
  };
}

function classifyExerciseLoadCalibration(input: {
  plannedSetCount: number;
  savedSetCount: number;
  performedSetCount: number;
  skippedSetCount: number;
  addedSetCount: number;
  targetLoad?: number;
  targetRepRange?: { min: number; max: number };
  performedLoadSummary: WeeklyRetroExerciseLoadCalibrationRow["performedLoadSummary"];
}): Pick<WeeklyRetroExerciseLoadCalibrationRow, "classification" | "reasonCodes" | "notes"> {
  const coverage =
    input.plannedSetCount > 0 ? input.performedSetCount / input.plannedSetCount : null;

  if (input.plannedSetCount === 0 && input.savedSetCount > 0) {
    return {
      classification: "runtime_added",
      reasonCodes: ["exercise_not_in_generated_snapshot"],
      notes: [`saved_sets:${input.savedSetCount}`, `performed_sets:${input.performedSetCount}`],
    };
  }

  if (
    input.plannedSetCount > 0 &&
    (input.performedSetCount === 0 ||
      (coverage != null && coverage < 0.5) ||
      input.skippedSetCount >= Math.ceil(input.plannedSetCount / 2))
  ) {
    const reasonCodes = ["planned_exercise_low_performed_coverage"];
    if (input.skippedSetCount > 0) {
      reasonCodes.push("skipped_sets_present");
    }
    return {
      classification: "skipped_or_low_coverage",
      reasonCodes,
      notes: [
        `coverage:${coverage == null ? "n/a" : roundToTenth(coverage * 100)}%`,
        `skipped_sets:${input.skippedSetCount}`,
      ],
    };
  }

  const loadDeltaPct = input.performedLoadSummary.loadDeltaPct;
  const medianReps = input.performedLoadSummary.medianReps;
  const lowerRepTarget = input.targetRepRange?.min;
  const repsBelowTarget =
    typeof medianReps === "number" &&
    typeof lowerRepTarget === "number" &&
    medianReps < lowerRepTarget - 1;

  if (typeof input.targetLoad !== "number" || typeof loadDeltaPct !== "number") {
    return {
      classification: "insufficient_evidence",
      reasonCodes: ["missing_target_or_performed_load"],
      notes: [
        `target_load:${input.targetLoad ?? "missing"}`,
        `median_load:${input.performedLoadSummary.medianLoad ?? "missing"}`,
      ],
    };
  }

  const anchorLoad = input.performedLoadSummary.anchorLoad;
  const anchorNearTarget =
    typeof anchorLoad === "number" &&
    Math.abs(((anchorLoad - input.targetLoad) / input.targetLoad) * 100) <= 5;

  if (anchorNearTarget && loadDeltaPct <= -10 && input.performedSetCount >= 2) {
    return {
      classification: "recalibrated_hold",
      reasonCodes: ["opened_near_target_then_reduced_load"],
      notes: [`load_delta_pct:${loadDeltaPct}`],
    };
  }

  if (loadDeltaPct <= -15 || repsBelowTarget) {
    return {
      classification: "target_too_high",
      reasonCodes: [
        loadDeltaPct <= -15
          ? "performed_load_materially_below_target"
          : "median_reps_below_target",
      ],
      notes: [`load_delta_pct:${loadDeltaPct}`],
    };
  }

  if (loadDeltaPct >= 15 && !repsBelowTarget) {
    return {
      classification: "target_too_low",
      reasonCodes: ["performed_load_materially_above_target"],
      notes: [`load_delta_pct:${loadDeltaPct}`],
    };
  }

  return {
    classification: "clean",
    reasonCodes: ["performed_load_within_target_band"],
    notes: [
      `load_delta_pct:${loadDeltaPct}`,
      ...(input.addedSetCount > 0 ? [`added_sets:${input.addedSetCount}`] : []),
      ...(input.skippedSetCount > 0 ? [`skipped_sets:${input.skippedSetCount}`] : []),
    ],
  };
}

function buildReplacementMap(
  runtimeEditReconciliation: ReturnType<typeof readRuntimeEditReconciliation>
): Map<string, string> {
  const replacements = new Map<string, string>();
  for (const op of runtimeEditReconciliation?.ops ?? []) {
    if (op.kind === "replace_exercise") {
      replacements.set(op.facts.fromExerciseId, op.facts.toExerciseId);
    }
  }
  return replacements;
}

function computePlannedSetCompletion(input: {
  session: HistoricalWeekAuditSession;
  workout?: WeeklyRetroRuntimeWorkoutRow;
}): {
  total: number;
  completed: number;
  missed: number;
} {
  const generatedSetCounts = buildGeneratedSetCounts(input.session);
  const savedSetCounts = buildSavedSetCounts(input.workout);
  const replacementByOriginal = buildReplacementMap(
    readRuntimeEditReconciliation(input.workout?.selectionMetadata)
  );
  let completed = 0;

  for (const [exerciseId, plannedSets] of generatedSetCounts) {
    const replacementExerciseId = replacementByOriginal.get(exerciseId);
    const savedSets =
      savedSetCounts.get(exerciseId) ??
      (replacementExerciseId ? savedSetCounts.get(replacementExerciseId) : undefined) ??
      0;
    completed += Math.min(plannedSets, savedSets);
  }

  const total = countGeneratedPlannedSets(input.session);
  return {
    total,
    completed,
    missed: Math.max(0, total - completed),
  };
}

function buildExerciseContexts(
  workouts: WeeklyRetroRuntimeWorkoutRow[]
): RuntimeEditExerciseContext[] {
  const byId = new Map<string, RuntimeEditExerciseContext>();
  for (const workout of workouts) {
    for (const workoutExercise of workout.exercises) {
      if (byId.has(workoutExercise.exerciseId)) {
        continue;
      }
      byId.set(workoutExercise.exerciseId, {
        exerciseId: workoutExercise.exerciseId,
        exerciseName: workoutExercise.exercise.name,
        primaryMuscles: workoutExercise.exercise.exerciseMuscles
          .filter((mapping) => mapping.role === "PRIMARY")
          .map((mapping) => mapping.muscle.name),
        secondaryMuscles: workoutExercise.exercise.exerciseMuscles
          .filter((mapping) => mapping.role === "SECONDARY")
          .map((mapping) => mapping.muscle.name),
        aliases: workoutExercise.exercise.aliases.map((alias) => alias.alias),
      });
    }
  }
  return Array.from(byId.values());
}

function buildTargetContext(
  volumeRows: WeeklyRetroAuditVolumeRow[]
): RuntimeEditTargetContext[] {
  return volumeRows.map((row) => ({
    muscle: row.muscle,
    actualEffectiveSets: row.actualEffectiveSets,
    weeklyTarget: row.weeklyTarget,
    mev: row.mev,
  }));
}

function computeEngineConfidenceImpact(input: {
  plannedWorkCompletedPercent: number;
  plannedWorkMissedSets: number;
  explainedAdditionSets: number;
  substitutions: number;
  painFatigueDeviations: number;
  unclassifiedDrift: number;
  legacyLimitedSessionCount: number;
  unclassifiedNegativeOrRewriteCount: number;
}): WeeklyRetroPlanAdherence["engineConfidenceImpact"] {
  if (
    input.unclassifiedDrift >= 4 ||
    input.unclassifiedNegativeOrRewriteCount >= 2 ||
    input.plannedWorkMissedSets >= 8 ||
    input.plannedWorkCompletedPercent < 70 ||
    input.painFatigueDeviations >= 3
  ) {
    return "high";
  }

  if (
    input.plannedWorkMissedSets >= 3 ||
    input.plannedWorkCompletedPercent < 90 ||
    input.unclassifiedDrift >= 2 ||
    input.legacyLimitedSessionCount > 0
  ) {
    return "medium";
  }

  if (
    input.plannedWorkMissedSets > 0 ||
    input.unclassifiedDrift > 0 ||
    input.substitutions > 0 ||
    input.painFatigueDeviations > 0 ||
    input.explainedAdditionSets > 2
  ) {
    return "low";
  }

  return "none";
}

function buildPlanAdherence(input: {
  sessions: HistoricalWeekAuditSession[];
  workoutsById: Map<string, WeeklyRetroRuntimeWorkoutRow>;
  volumeRows: WeeklyRetroAuditVolumeRow[];
  legacyLimitedSessionCount: number;
}): WeeklyRetroPlanAdherence {
  const targetContext = buildTargetContext(input.volumeRows);
  const exerciseContexts = buildExerciseContexts(Array.from(input.workoutsById.values()));
  const interpretations: RuntimeEditInterpretation[] = [];
  const finalAdvancingWorkoutId = input.sessions
    .filter(
      (session) =>
        resolveSessionSemantics(session)?.consumesWeeklyScheduleIntent === true
    )
    .slice()
    .sort((left, right) => left.scheduledDate.localeCompare(right.scheduledDate))
    .at(-1)?.workoutId;
  let plannedWorkTotalSets = 0;
  let plannedWorkCompletedSets = 0;

  for (const session of input.sessions) {
    const workout = input.workoutsById.get(session.workoutId);
    const completion = computePlannedSetCompletion({ session, workout });
    plannedWorkTotalSets += completion.total;
    plannedWorkCompletedSets += completion.completed;
    interpretations.push(
      ...interpretRuntimeEdits({
        runtimeEditReconciliation: readRuntimeEditReconciliation(workout?.selectionMetadata),
        exerciseContexts,
        targetContext,
        weeklyOpportunity: {
          isFinalAdvancingSession: session.workoutId === finalAdvancingWorkoutId,
        },
        legacyReconciliation: session.reconciliation,
      })
    );
  }

  const explainedAdditionIntents = new Set<RuntimeEditIntent>([
    "final_weekly_opportunity_mev_closure",
    "target_gap_closure",
    "opportunistic_extra",
    "user_preference",
  ]);
  const explainedAdditionsByIntent: Partial<Record<RuntimeEditIntent, number>> = {};
  for (const interpretation of interpretations) {
    if (
      interpretation.setDelta <= 0 ||
      !explainedAdditionIntents.has(interpretation.intent)
    ) {
      continue;
    }
    explainedAdditionsByIntent[interpretation.intent] =
      (explainedAdditionsByIntent[interpretation.intent] ?? 0) +
      interpretation.setDelta;
  }

  const plannedWorkMissedSets = Math.max(
    0,
    plannedWorkTotalSets - plannedWorkCompletedSets
  );
  const plannedWorkCompletedPercent =
    plannedWorkTotalSets > 0
      ? Math.round((plannedWorkCompletedSets / plannedWorkTotalSets) * 100)
      : 100;
  const explainedAdditionSets = sumPositiveSetDeltas(interpretations, (interpretation) =>
    explainedAdditionIntents.has(interpretation.intent)
  );
  const substitutions = interpretations.filter(
    (interpretation) => interpretation.intent === "substitution"
  ).length;
  const painFatigueDeviations = interpretations.filter(
    (interpretation) =>
      interpretation.intent === "pain_avoidance" ||
      interpretation.intent === "fatigue_adjustment"
  ).length;
  const unclassifiedDrift = interpretations.filter(
    (interpretation) => interpretation.intent === "unclassified"
  ).length;
  const unclassifiedNegativeOrRewriteCount = interpretations.filter(
    (interpretation) =>
      interpretation.intent === "unclassified" &&
      (interpretation.setDelta < 0 || interpretation.opKind === "rewrite_structure")
  ).length;

  return {
    plannedWorkCompletedPercent,
    plannedWorkMissedSets,
    plannedWorkTotalSets,
    plannedWorkCompletedSets,
    explainedAdditions: {
      totalSets: explainedAdditionSets,
      byIntent: explainedAdditionsByIntent,
    },
    substitutions,
    painFatigueDeviations,
    unclassifiedDrift,
    engineConfidenceImpact: computeEngineConfidenceImpact({
      plannedWorkCompletedPercent,
      plannedWorkMissedSets,
      explainedAdditionSets,
      substitutions,
      painFatigueDeviations,
      unclassifiedDrift,
      legacyLimitedSessionCount: input.legacyLimitedSessionCount,
      unclassifiedNegativeOrRewriteCount,
    }),
    interpretations,
  };
}

function buildSessionExecutionRows(input: {
  sessions: HistoricalWeekAuditSession[];
  slotIdentityByWorkoutId: Map<string, ReturnType<typeof readSessionSlotSnapshot>>;
}): WeeklyRetroAuditSessionExecutionRow[] {
  return input.sessions.map((session) => {
    const semantics = resolveSessionSemantics(session);
    return {
      workoutId: session.workoutId,
      scheduledDate: session.scheduledDate,
      status: session.status,
      selectionMode: session.selectionMode,
      sessionIntent: session.sessionIntent,
      snapshotSource: session.snapshotSource,
      semanticKind: semantics?.kind,
      consumesWeeklyScheduleIntent: semantics?.consumesWeeklyScheduleIntent ?? false,
      isCloseout: semantics?.isCloseout ?? false,
      isDeload: semantics?.isDeload ?? false,
      slot: input.slotIdentityByWorkoutId.get(session.workoutId),
      mesocycleSnapshot: session.sessionSnapshot.saved?.mesocycleSnapshot,
      cycleContext: session.sessionSnapshot.generated?.cycleContext,
      canonicalSemantics: session.canonicalSemantics,
      progressionEvidence: session.progressionEvidence,
      weekClose: session.weekClose,
      reconciliation: session.reconciliation,
    };
  });
}

function buildExerciseLoadCalibrationRows(input: {
  week: number;
  sessions: HistoricalWeekAuditSession[];
  workoutsById: Map<string, WeeklyRetroRuntimeWorkoutRow>;
  slotIdentityByWorkoutId: Map<string, ReturnType<typeof readSessionSlotSnapshot>>;
}): WeeklyRetroExerciseLoadCalibrationRow[] {
  const rows: WeeklyRetroExerciseLoadCalibrationRow[] = [];

  for (const session of input.sessions) {
    const workout = input.workoutsById.get(session.workoutId);
    const savedExercisesById = new Map(
      (workout?.exercises ?? []).map((exercise) => [exercise.exerciseId, exercise])
    );
    const generatedExercises = session.sessionSnapshot.generated?.exercises ?? [];
    const generatedExerciseIds = new Set(generatedExercises.map((exercise) => exercise.exerciseId));
    const slot = input.slotIdentityByWorkoutId.get(session.workoutId);
    const sessionLabel =
      slot?.slotId ??
      [session.sessionIntent, session.scheduledDate.slice(0, 10)]
        .filter((value): value is string => Boolean(value))
        .join(":");

    const exercisePairs: Array<{
      generatedExercise?: SessionAuditExerciseSnapshot;
      savedExercise?: WeeklyRetroRuntimeWorkoutExercise;
    }> = [
      ...generatedExercises
        .slice()
        .sort((left, right) => left.orderIndex - right.orderIndex)
        .map((generatedExercise) => ({
          generatedExercise,
          savedExercise: savedExercisesById.get(generatedExercise.exerciseId),
        })),
      ...(workout?.exercises ?? [])
        .filter((savedExercise) => !generatedExerciseIds.has(savedExercise.exerciseId))
        .slice()
        .sort((left, right) => left.orderIndex - right.orderIndex)
        .map((savedExercise) => ({ savedExercise })),
    ];

    for (const pair of exercisePairs) {
      const plannedSetCount = pair.generatedExercise?.prescribedSetCount ?? 0;
      const savedSetCount = countSavedSets(pair.savedExercise?.sets ?? []);
      const performedSetCount = countPerformedSets(pair.savedExercise?.sets ?? []);
      const skippedSetCount = countSkippedSets(pair.savedExercise?.sets ?? []);
      const addedSetCount = Math.max(0, savedSetCount - plannedSetCount);
      const target = resolveTargetPrescription(pair);
      const performedLoadSummary = summarizePerformedLoad(
        pair.savedExercise?.sets ?? [],
        target.targetLoad
      );
      const classification = classifyExerciseLoadCalibration({
        plannedSetCount,
        savedSetCount,
        performedSetCount,
        skippedSetCount,
        addedSetCount,
        targetLoad: target.targetLoad,
        targetRepRange: target.targetRepRange,
        performedLoadSummary,
      });

      rows.push({
        week: input.week,
        workoutId: session.workoutId,
        slotId: slot?.slotId,
        sessionLabel,
        exerciseId: pair.generatedExercise?.exerciseId ?? pair.savedExercise?.exerciseId ?? "unknown",
        exerciseName:
          pair.generatedExercise?.exerciseName ?? pair.savedExercise?.exercise.name ?? "Unknown exercise",
        plannedSetCount,
        savedSetCount,
        performedSetCount,
        skippedSetCount,
        addedSetCount,
        ...target,
        performedLoadSummary,
        ...classification,
      });
    }
  }

  return rows;
}

function sortVolumeRows(
  left: WeeklyRetroAuditVolumeRow,
  right: WeeklyRetroAuditVolumeRow
): number {
  const leftMagnitude = Math.max(Math.abs(left.deltaToTarget), Math.abs(left.deltaToMev), Math.abs(left.deltaToMav));
  const rightMagnitude = Math.max(
    Math.abs(right.deltaToTarget),
    Math.abs(right.deltaToMev),
    Math.abs(right.deltaToMav)
  );
  if (rightMagnitude !== leftMagnitude) {
    return rightMagnitude - leftMagnitude;
  }
  return left.muscle.localeCompare(right.muscle);
}

export async function buildWeeklyRetroAuditPayload(input: {
  userId: string;
  ownerEmail?: string;
  week: number;
  mesocycleId: string;
  projectionArtifact?: unknown;
  projectionArtifactPath?: string;
}): Promise<WeeklyRetroAuditPayload> {
  const [historicalWeek, mesocycle] = await Promise.all([
    buildHistoricalWeekAuditPayload({
      userId: input.userId,
      week: input.week,
      mesocycleId: input.mesocycleId,
    }),
    prisma.mesocycle.findFirst({
      where: {
        id: input.mesocycleId,
        macroCycle: { userId: input.userId },
      },
      select: {
        id: true,
        durationWeeks: true,
        startWeek: true,
        blocks: {
          orderBy: { startWeek: "asc" },
          select: {
            blockType: true,
            startWeek: true,
            durationWeeks: true,
            volumeTarget: true,
            intensityBias: true,
          },
        },
        macroCycle: {
          select: {
            startDate: true,
          },
        },
      },
    }),
  ]);

  if (!mesocycle) {
    throw new Error(`No mesocycle found for weekly-retro mesocycleId=${input.mesocycleId}.`);
  }

  const weekStart = computeMesoWeekStartDate(
    new Date(mesocycle.macroCycle.startDate),
    mesocycle.startWeek,
    input.week
  );

  const [weeklyVolume, slotIdentityRows] = await Promise.all([
    loadMesocycleWeekMuscleVolume(prisma, {
      userId: input.userId,
      mesocycleId: input.mesocycleId,
      targetWeek: input.week,
      weekStart,
      includeBreakdowns: true,
    }),
    prisma.workout.findMany({
      where: {
        userId: input.userId,
        mesocycleId: input.mesocycleId,
        mesocycleWeekSnapshot: input.week,
      },
      select: {
        id: true,
        selectionMetadata: true,
        exercises: {
          orderBy: [{ orderIndex: "asc" }, { id: "asc" }],
          select: {
            exerciseId: true,
            orderIndex: true,
            sets: {
              orderBy: { setIndex: "asc" },
              select: {
                id: true,
                setIndex: true,
                targetReps: true,
                targetRepMin: true,
                targetRepMax: true,
                targetRpe: true,
                targetLoad: true,
                logs: {
                  orderBy: {
                    completedAt: "desc",
                  },
                  take: 1,
                  select: {
                    actualReps: true,
                    actualRpe: true,
                    actualLoad: true,
                    wasSkipped: true,
                  },
                },
              },
            },
            exercise: {
              select: {
                name: true,
                aliases: {
                  select: {
                    alias: true,
                  },
                },
                exerciseMuscles: {
                  select: {
                    role: true,
                    muscle: {
                      select: {
                        name: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    }),
  ]);

  const runtimeWorkouts = slotIdentityRows as WeeklyRetroRuntimeWorkoutRow[];
  const runtimeWorkoutsById = new Map(runtimeWorkouts.map((row) => [row.id, row]));
  const slotIdentityByWorkoutId = new Map(
    slotIdentityRows.map((row) => [row.id, readSessionSlotSnapshot(row.selectionMetadata)])
  );
  const sessionExecutionRows = buildSessionExecutionRows({
    sessions: historicalWeek.sessions,
    slotIdentityByWorkoutId,
  });
  const advancingSessions = historicalWeek.sessions.filter(
    (session) => resolveSessionSemantics(session)?.consumesWeeklyScheduleIntent === true
  );

  const missingSlotIdentityWorkoutIds: string[] = [];
  const duplicateSlotWorkouts = new Map<string, string[]>();
  const intentMismatches: WeeklyRetroAuditPayload["slotBalance"]["intentMismatches"] = [];

  for (const session of advancingSessions) {
    const slot = slotIdentityByWorkoutId.get(session.workoutId);
    if (!slot?.slotId) {
      missingSlotIdentityWorkoutIds.push(session.workoutId);
      continue;
    }

    const existing = duplicateSlotWorkouts.get(slot.slotId) ?? [];
    existing.push(session.workoutId);
    duplicateSlotWorkouts.set(slot.slotId, existing);

    const normalizedSessionIntent = normalizeIntent(session.sessionIntent);
    const normalizedSlotIntent = normalizeIntent(slot.intent);
    if (
      normalizedSessionIntent &&
      normalizedSlotIntent &&
      normalizedSessionIntent !== normalizedSlotIntent
    ) {
      intentMismatches.push({
        workoutId: session.workoutId,
        sessionIntent: session.sessionIntent,
        slotIntent: slot.intent,
        slotId: slot.slotId,
      });
    }
  }

  const duplicateSlots = Array.from(duplicateSlotWorkouts.entries())
    .filter(([, workoutIds]) => workoutIds.length > 1)
    .map(([slotId, workoutIds]) => ({ slotId, workoutIds }))
    .sort((left, right) => left.slotId.localeCompare(right.slotId));

  const volumeRows: WeeklyRetroAuditVolumeRow[] = getExposedVolumeLandmarkEntries()
    .map(([muscle, landmark]) => {
      const actualRow = weeklyVolume[muscle];
      const actualEffectiveSets = actualRow?.effectiveSets ?? 0;
      const weeklyTarget = getWeeklyVolumeTarget(mesocycle, muscle, input.week);
      const deltaToTarget = roundToTenth(actualEffectiveSets - weeklyTarget);
      const deltaToMev = roundToTenth(actualEffectiveSets - landmark.mev);
      const deltaToMav = roundToTenth(actualEffectiveSets - landmark.mav);
      const status =
        deltaToMev < 0
          ? "below_mev"
          : deltaToTarget < 0
            ? "under_target_only"
            : deltaToMav > 0
              ? "over_mav"
              : deltaToTarget > 0
                ? "over_target_only"
                : "within_target_band";

      return {
        muscle,
        actualEffectiveSets,
        weeklyTarget,
        mev: landmark.mev ?? DEFAULT_FALLBACK_LANDMARK.mev,
        mav: landmark.mav ?? DEFAULT_FALLBACK_LANDMARK.mav,
        deltaToTarget,
        deltaToMev,
        deltaToMav,
        status,
        topContributors: (actualRow?.contributions ?? [])
          .slice(0, 3)
          .map((contribution) => ({
            exerciseId: contribution.exerciseId,
            exerciseName: contribution.exerciseName,
            effectiveSets: contribution.effectiveSets,
            performedSets: contribution.performedSets,
          })),
      } satisfies WeeklyRetroAuditVolumeRow;
    })
    .filter((row) => row.weeklyTarget > 0 || row.actualEffectiveSets > 0)
    .sort(sortVolumeRows);

  const belowMev = volumeRows
    .filter((row) => row.status === "below_mev")
    .map((row) => row.muscle);
  const underTargetOnly = volumeRows
    .filter((row) => row.status === "under_target_only")
    .map((row) => row.muscle);
  const overMav = volumeRows
    .filter((row) => row.status === "over_mav")
    .map((row) => row.muscle);
  const overTargetOnly = volumeRows
    .filter((row) => row.status === "over_target_only")
    .map((row) => row.muscle);

  const driftSessions = historicalWeek.sessions.filter((session) => session.reconciliation.hasDrift);
  const prescriptionChangeCount = historicalWeek.sessions.filter((session) =>
    session.reconciliation.changedFields.includes("exercise_prescription_changed")
  ).length;
  const selectionDriftCount = historicalWeek.sessions.filter((session) =>
    session.reconciliation.changedFields.some((field) =>
      [
        "selection_mode",
        "session_intent",
        "semantics_kind",
        "progression_history_eligibility",
      ].includes(field)
    )
  ).length;
  const legacyLimitedSessionCount = historicalWeek.comparabilityCoverage.reconstructedSnapshotCount;
  const planAdherence = buildPlanAdherence({
    sessions: historicalWeek.sessions,
    workoutsById: runtimeWorkoutsById,
    volumeRows,
    legacyLimitedSessionCount,
  });
  const exerciseLoadCalibrationRows = buildExerciseLoadCalibrationRows({
    week: input.week,
    sessions: historicalWeek.sessions,
    workoutsById: runtimeWorkoutsById,
    slotIdentityByWorkoutId,
  });
  const slotIdentityIssueCount =
    missingSlotIdentityWorkoutIds.length + duplicateSlots.length + intentMismatches.length;

  const executiveHighlights: string[] = [];
  if (legacyLimitedSessionCount > 0) {
    executiveHighlights.push(
      `Legacy saved-only coverage limits ${legacyLimitedSessionCount} session(s).`
    );
  }
  if (planAdherence.unclassifiedDrift > 0) {
    executiveHighlights.push(
      `${planAdherence.unclassifiedDrift} runtime edit interpretation(s) remain unclassified.`
    );
  } else if (driftSessions.length > 0) {
    executiveHighlights.push(
      `${driftSessions.length} comparable session(s) had runtime edits with classified audit context.`
    );
  }
  if (planAdherence.plannedWorkMissedSets > 0) {
    executiveHighlights.push(
      `${planAdherence.plannedWorkMissedSets} planned set(s) were not preserved in saved workout structure.`
    );
  }
  if (belowMev.length > 0) {
    executiveHighlights.push(`${belowMev.length} muscle(s) finished below MEV.`);
  }
  if (underTargetOnly.length > 0) {
    executiveHighlights.push(
      `${underTargetOnly.length} muscle(s) finished under target but above MEV.`
    );
  }
  if (overMav.length > 0) {
    executiveHighlights.push(`${overMav.length} muscle(s) exceeded MAV.`);
  }
  if (slotIdentityIssueCount > 0) {
    executiveHighlights.push(
      `${slotIdentityIssueCount} slot-identity issue(s) surfaced across advancing sessions.`
    );
  }
  if (executiveHighlights.length === 0) {
    executiveHighlights.push("No high-risk weekly-retro signals detected.");
  }

  const rootCauses: WeeklyRetroAuditPayload["rootCauses"] = [];
  const interventions: WeeklyRetroAuditPayload["interventions"] = [];

  if (missingSlotIdentityWorkoutIds.length > 0) {
    rootCauses.push({
      code: "slot_identity_gap",
      summary: "Some advancing sessions are missing canonical slot identity receipts.",
      evidence: [
        `Missing sessionSlot receipts on workouts: ${missingSlotIdentityWorkoutIds.join(", ")}`,
      ],
    });
    interventions.push({
      priority: "high",
      kind: "slot_identity",
      summary: "Repair missing session-slot receipts before trusting slot-balance conclusions.",
      evidence: [
        `${missingSlotIdentityWorkoutIds.length} advancing session(s) lack slot identity.`,
      ],
    });
  }

  if (duplicateSlots.length > 0) {
    rootCauses.push({
      code: "slot_identity_duplicate",
      summary: "The same canonical slot id was consumed more than once in the audited week.",
      evidence: duplicateSlots.map(
        (entry) => `${entry.slotId}: ${entry.workoutIds.join(", ")}`
      ),
    });
    interventions.push({
      priority: "high",
      kind: "slot_identity",
      summary: "Review duplicate slot consumption and reconcile the affected workout receipts.",
      evidence: duplicateSlots.map(
        (entry) => `${entry.slotId} repeated across ${entry.workoutIds.length} workouts`
      ),
    });
  }

  if (intentMismatches.length > 0) {
    rootCauses.push({
      code: "slot_identity_intent_mismatch",
      summary: "Saved workout intent and canonical slot intent disagree for at least one advancing session.",
      evidence: intentMismatches.map(
        (entry) =>
          `${entry.workoutId}: session=${entry.sessionIntent ?? "unknown"} slot=${entry.slotIntent}`
      ),
    });
  }

  if (planAdherence.unclassifiedDrift > 0) {
    rootCauses.push({
      code: "unclassified_runtime_drift",
      summary: "Some runtime edits could not be explained from persisted operation facts and audit context.",
      evidence: planAdherence.interpretations
        .filter((interpretation) => interpretation.intent === "unclassified")
        .map(
          (interpretation) =>
            `${interpretation.opKind}: ${interpretation.evidence.join("; ")}`
        ),
    });
    interventions.push({
      priority:
        planAdherence.engineConfidenceImpact === "high" ? "high" : "medium",
      kind: "unclassified_runtime_drift",
      summary: "Inspect unclassified runtime edits before treating the week as clean calibration evidence.",
      evidence: [
        `${planAdherence.unclassifiedDrift} runtime edit interpretation(s) are unclassified.`,
      ],
    });
  }

  if (planAdherence.plannedWorkMissedSets > 0) {
    rootCauses.push({
      code: "missed_planned_work",
      summary: "Saved workout structure did not preserve all originally planned sets.",
      evidence: [
        `Planned work completed ${planAdherence.plannedWorkCompletedPercent}% (${planAdherence.plannedWorkCompletedSets}/${planAdherence.plannedWorkTotalSets} sets).`,
        `Missed planned sets: ${planAdherence.plannedWorkMissedSets}.`,
      ],
    });
    interventions.push({
      priority:
        planAdherence.engineConfidenceImpact === "high" ? "high" : "medium",
      kind: "missed_planned_work",
      summary: "Review missed planned work separately from runtime-added volume.",
      evidence: [
        `${planAdherence.plannedWorkMissedSets} planned set(s) were not completed/preserved by saved structure.`,
      ],
    });
  }

  if (
    selectionDriftCount > 0 &&
    planAdherence.engineConfidenceImpact !== "none"
  ) {
    rootCauses.push({
      code: "mutation_drift",
      summary: "Generated-vs-saved reconciliation shows selection or semantic drift beyond explained additions.",
      evidence: driftSessions
        .filter((session) =>
          session.reconciliation.changedFields.some((field) =>
            [
              "selection_mode",
              "session_intent",
              "semantics_kind",
              "progression_history_eligibility",
            ].includes(field)
          )
        )
        .map(
          (session) =>
            `${session.workoutId}: ${session.reconciliation.changedFields.join(", ")}`
        ),
    });
    interventions.push({
      priority: "high",
      kind: "mutation_drift",
      summary: "Inspect selection/semantic drift before drawing load-calibration conclusions.",
      evidence: [
        `${selectionDriftCount} session(s) carry selection or semantic drift.`,
      ],
    });
  }

  if (legacyLimitedSessionCount > 0) {
    rootCauses.push({
      code: "legacy_coverage_gap",
      summary: "Some sessions only have saved-state reconstruction, not persisted generated-layer truth.",
      evidence: historicalWeek.comparabilityCoverage.limitations,
    });
    interventions.push({
      priority: "medium",
      kind: "legacy_coverage",
      summary: "Treat legacy saved-only sessions as audit limitations, not generation defects.",
      evidence: [
        `${legacyLimitedSessionCount} session(s) lack generated-layer coverage.`,
      ],
    });
  }

  if (belowMev.length > 0) {
    rootCauses.push({
      code: "below_mev",
      summary: "Actual weekly effective volume finished below MEV for at least one muscle.",
      evidence: volumeRows
        .filter((row) => row.status === "below_mev")
        .map(
          (row) =>
            `${row.muscle}: actual=${row.actualEffectiveSets.toFixed(1)} mev=${row.mev.toFixed(1)} delta=${row.deltaToMev.toFixed(1)}`
        ),
    });
  }

  if (belowMev.length > 0 || underTargetOnly.length > 0) {
    interventions.push({
      priority: "medium",
      kind: "volume_deficit",
      summary: "Review under-target muscles against actual top contributors and session mix.",
      evidence: [
        `Below MEV: ${belowMev.join(", ") || "none"}`,
        `Under target only: ${underTargetOnly.join(", ") || "none"}`,
      ],
    });
  }

  if (overMav.length > 0) {
    rootCauses.push({
      code: "over_mav",
      summary: "Actual weekly effective volume exceeded MAV for at least one muscle.",
      evidence: volumeRows
        .filter((row) => row.status === "over_mav")
        .map(
          (row) =>
            `${row.muscle}: actual=${row.actualEffectiveSets.toFixed(1)} mav=${row.mav.toFixed(1)} delta=${row.deltaToMav.toFixed(1)}`
        ),
    });
    interventions.push({
      priority: "medium",
      kind: "volume_overshoot",
      summary: "Inspect overshooting muscles for stacked contributors or unexpected non-deload load retention.",
      evidence: [`Over MAV: ${overMav.join(", ")}`],
    });
  }

  const recommendedPriorities = interventions
    .slice()
    .sort((left, right) => {
      const priorityRank = { high: 0, medium: 1, low: 2 };
      return priorityRank[left.priority] - priorityRank[right.priority];
    })
    .map((entry) => entry.summary);

  const payload: WeeklyRetroAuditPayload = {
    version: WEEKLY_RETRO_AUDIT_PAYLOAD_VERSION,
    week: input.week,
    mesocycleId: input.mesocycleId,
    executiveSummary: {
      status:
        planAdherence.engineConfidenceImpact === "high" ||
        planAdherence.engineConfidenceImpact === "medium" ||
        legacyLimitedSessionCount > 0 ||
        belowMev.length > 0 ||
        underTargetOnly.length > 0 ||
        overMav.length > 0 ||
        slotIdentityIssueCount > 0
          ? "attention_required"
          : "stable",
      generatedLayerCoverage: historicalWeek.comparabilityCoverage.generatedLayerCoverage,
      sessionCount: historicalWeek.summary.sessionCount,
      advancingSessionCount: advancingSessions.length,
      progressionEligibleCount: historicalWeek.summary.progressionEligibleCount,
      progressionExcludedCount: historicalWeek.summary.progressionExcludedCount,
      driftSessionCount: driftSessions.length,
      belowMevCount: belowMev.length,
      underTargetCount: belowMev.length + underTargetOnly.length,
      overMavCount: overMav.length,
      slotIdentityIssueCount,
      highlights: executiveHighlights,
    },
    loadCalibration: {
      status:
        planAdherence.engineConfidenceImpact === "high" ||
        (planAdherence.engineConfidenceImpact === "medium" &&
          legacyLimitedSessionCount === 0) ||
        selectionDriftCount > 0
          ? "attention_required"
          : legacyLimitedSessionCount > 0
            ? "limited_by_legacy_coverage"
            : "aligned",
      comparableSessionCount: historicalWeek.comparabilityCoverage.comparableSessionCount,
      driftSessionCount: driftSessions.length,
      prescriptionChangeCount,
      selectionDriftCount,
      legacyLimitedSessionCount,
      highlightedSessions: driftSessions.map((session) => ({
        workoutId: session.workoutId,
        changedFields: [...session.reconciliation.changedFields],
      })),
    },
    sessionExecution: {
      summary: historicalWeek.summary,
      sessions: sessionExecutionRows,
    },
    slotBalance: {
      status: slotIdentityIssueCount > 0 ? "attention_required" : "balanced",
      advancingSessionCount: advancingSessions.length,
      identifiedSlotCount: advancingSessions.length - missingSlotIdentityWorkoutIds.length,
      missingSlotIdentityCount: missingSlotIdentityWorkoutIds.length,
      duplicateSlotCount: duplicateSlots.length,
      intentMismatchCount: intentMismatches.length,
      missingSlotIdentityWorkoutIds,
      duplicateSlots,
      intentMismatches,
    },
    volumeTargeting: {
      status:
        belowMev.length > 0 ||
        underTargetOnly.length > 0 ||
        overMav.length > 0 ||
        overTargetOnly.length > 0
          ? "attention_required"
          : "within_expected_band",
      belowMev,
      underTargetOnly,
      overMav,
      overTargetOnly,
      muscles: volumeRows,
    },
    planAdherence,
    exerciseLoadCalibrationRows,
    interventions,
    rootCauses,
    recommendedPriorities,
  };

  if (input.projectionArtifact !== undefined || input.projectionArtifactPath) {
    let projectionArtifact = input.projectionArtifact;
    let projectionArtifactReadError: string | undefined;

    if (projectionArtifact === undefined && input.projectionArtifactPath) {
      try {
        projectionArtifact = JSON.parse(
          await readFile(input.projectionArtifactPath, "utf8")
        );
      } catch (error) {
        projectionArtifactReadError = error instanceof Error ? error.message : String(error);
      }
    }

    payload.projectionDeliveryDrift = buildProjectionDeliveryDrift({
      projectionArtifact,
      projectionArtifactReadError,
      weeklyRetro: payload,
      actualIdentity: {
        userId: input.userId,
        ownerEmail: input.ownerEmail,
      },
    });
  }

  return payload;
}
