import { prisma } from "@/lib/db/prisma";
import { WorkoutStatus } from "@prisma/client";
import { PERFORMED_WORKOUT_STATUSES } from "@/lib/workout-status";
import { deriveSessionSemantics } from "@/lib/session-semantics/derive-session-semantics";
import { classifySetLog } from "@/lib/session-semantics/set-classification";
import {
  readRuntimeAddedExerciseIds,
  readRuntimeAddedSetIds,
} from "@/lib/ui/selection-metadata";
import {
  measurementComparisonKey,
  parseMeasurementColumns,
  permitsComputedLoadComparison,
  type MeasurementSemantics,
} from "@/lib/exercise-measurement/semantics";

const ESTIMATED_STRENGTH_MAX_REPS = 15;
const PERFORMED_WORKOUT_STATUS_SET = new Set<WorkoutStatus>(
  PERFORMED_WORKOUT_STATUSES,
);

export type ExerciseHistorySet = {
  setIndex: number;
  reps: number;
  load: number | null;
  rpe: number | null;
  completedAt: string;
  isRuntimeAdded: boolean;
};

export type ExerciseHistoryRepresentativeSet = ExerciseHistorySet & {
  basis: "best_estimated_strength" | "heaviest_completed_load" | "most_reps";
};

export type ExerciseHistoryLoadConvention =
  | "per_dumbbell"
  | "per_implement"
  | "recorded_external_load"
  | "machine_displayed"
  | "displayed_assistance"
  | "no_load"
  | "not_comparable";

export type ExerciseExposure = {
  workoutId: string;
  date: string;
  workoutStatus: "COMPLETED" | "PARTIAL";
  measurement: MeasurementSemantics | null;
  displayLoadConvention: ExerciseHistoryLoadConvention;
  isRecordComparable: boolean;
  sets: ExerciseHistorySet[];
  completedSetCount: number;
  skippedSetCount: number;
  unloggedSetCount: number;
  hasSessionLocalChanges: boolean;
  representativeSet: ExerciseHistoryRepresentativeSet;
};

export type ExerciseSetRecord = {
  date: string;
  load: number;
  reps: number;
  rpe: number | null;
};

export type EstimatedStrengthRecord = ExerciseSetRecord & {
  estimatedOneRepMax: number;
};

export type SessionVolumeRecord = {
  date: string;
  volume: number;
  completedSetCount: number;
};

export type ExerciseHistoryResult = {
  exercise: {
    id: string;
    name: string | null;
    equipment: string[];
  };
  comparison: {
    scope: "exact_exercise";
    loadConvention: ExerciseHistoryLoadConvention;
    note: string;
  };
  lastExposure: ExerciseExposure | null;
  recentExposures: ExerciseExposure[];
  records: {
    bestEstimatedStrength: EstimatedStrengthRecord | null;
    heaviestCompletedLoad: ExerciseSetRecord | null;
    highestSessionVolume: SessionVolumeRecord | null;
  };
};

type HistoryRow = Awaited<ReturnType<typeof loadHistoryRows>>[number];

async function loadHistoryRows(exerciseId: string, userId: string) {
  return prisma.workoutExercise.findMany({
    where: {
      exerciseId,
      workout: {
        userId,
        status: { in: [...PERFORMED_WORKOUT_STATUSES] as WorkoutStatus[] },
      },
    },
    orderBy: { workout: { scheduledDate: "desc" } },
    include: {
      exercise: {
        include: {
          exerciseEquipment: { include: { equipment: true } },
        },
      },
      workout: {
        select: {
          id: true,
          scheduledDate: true,
          completedAt: true,
          status: true,
          selectionMetadata: true,
          selectionMode: true,
          sessionIntent: true,
          advancesSplit: true,
          mesocyclePhaseSnapshot: true,
        },
      },
      sets: {
        orderBy: { setIndex: "asc" },
        include: { logs: { orderBy: { completedAt: "desc" }, take: 1 } },
      },
    },
  });
}

function estimateOneRepMax(load: number, reps: number): number {
  return load * (1 + reps / 30);
}

function compareEstimatedStrength(a: ExerciseHistorySet, b: ExerciseHistorySet): number {
  const aEstimate = estimateOneRepMax(a.load ?? 0, a.reps);
  const bEstimate = estimateOneRepMax(b.load ?? 0, b.reps);
  return bEstimate - aEstimate || (b.load ?? 0) - (a.load ?? 0) || b.reps - a.reps;
}

function selectRepresentativeSet(
  sets: ExerciseHistorySet[]
): ExerciseHistoryRepresentativeSet {
  const estimatedStrengthSets = sets
    .filter(
      (set) =>
        set.load != null &&
        set.load > 0 &&
        set.reps > 0 &&
        set.reps <= ESTIMATED_STRENGTH_MAX_REPS
    )
    .sort(compareEstimatedStrength);
  if (estimatedStrengthSets[0]) {
    return { ...estimatedStrengthSets[0], basis: "best_estimated_strength" };
  }

  const loadedSets = sets
    .filter((set) => set.load != null && set.load > 0)
    .sort((a, b) => (b.load ?? 0) - (a.load ?? 0) || b.reps - a.reps);
  if (loadedSets[0]) {
    return { ...loadedSets[0], basis: "heaviest_completed_load" };
  }

  const mostReps = [...sets].sort((a, b) => b.reps - a.reps)[0];
  return { ...mostReps, basis: "most_reps" };
}

function resolveLoadConvention(
  measurement: MeasurementSemantics | null,
  equipment: string[],
): ExerciseHistoryLoadConvention {
  if (measurement) {
    if (measurement.profile === "REPS_BODYWEIGHT") return "no_load";
    if (measurement.loadConvention === "MACHINE_DISPLAYED") {
      return "machine_displayed";
    }
    if (measurement.loadConvention === "DISPLAYED_ASSISTANCE") {
      return "displayed_assistance";
    }
    if (measurement.loadConvention === "IMPLEMENT_WEIGHT") {
      return "per_implement";
    }
    return "recorded_external_load";
  }

  if (equipment.includes("bodyweight")) return "not_comparable";
  if (equipment.includes("dumbbell")) return "per_dumbbell";
  return "recorded_external_load";
}

type PerformedExerciseExposure = Omit<ExerciseExposure, "isRecordComparable">;

function toExposure(row: HistoryRow): PerformedExerciseExposure | null {
  const semantics = deriveSessionSemantics({
    advancesSplit: row.workout.advancesSplit,
    selectionMetadata: row.workout.selectionMetadata,
    selectionMode: row.workout.selectionMode,
    sessionIntent: row.workout.sessionIntent,
    mesocyclePhase: row.workout.mesocyclePhaseSnapshot,
  });
  if (!semantics.countsTowardPerformanceHistory) {
    return null;
  }

  const runtimeAddedSetIds = readRuntimeAddedSetIds(row.workout.selectionMetadata);
  const runtimeAddedExerciseIds = readRuntimeAddedExerciseIds(row.workout.selectionMetadata);
  const sets: ExerciseHistorySet[] = [];
  let skippedSetCount = 0;
  let unloggedSetCount = 0;

  for (const set of row.sets) {
    const log = set.logs[0];
    const classification = classifySetLog(log);
    if (classification.isSkipped) {
      skippedSetCount += 1;
    } else if (!classification.isResolved) {
      unloggedSetCount += 1;
    }
    if (!log || !classification.isWorkEvidence) {
      continue;
    }
    sets.push({
      setIndex: set.setIndex,
      reps: log.actualReps ?? 0,
      load: log.actualLoad ?? null,
      rpe: log.actualRpe ?? null,
      completedAt: log.completedAt.toISOString(),
      isRuntimeAdded: runtimeAddedSetIds.has(set.id),
    });
  }

  if (sets.length === 0) {
    return null;
  }

  const measurement = parseMeasurementColumns(row);
  const equipment = row.exercise.exerciseEquipment.map((item) =>
    item.equipment.type.toLowerCase(),
  );

  return {
    workoutId: row.workout.id,
    date: (row.workout.completedAt ?? row.workout.scheduledDate).toISOString(),
    workoutStatus: row.workout.status as "COMPLETED" | "PARTIAL",
    measurement,
    displayLoadConvention: resolveLoadConvention(measurement, equipment),
    sets,
    completedSetCount: sets.length,
    skippedSetCount,
    unloggedSetCount,
    hasSessionLocalChanges:
      runtimeAddedExerciseIds.has(row.id) || sets.some((set) => set.isRuntimeAdded),
    representativeSet: selectRepresentativeSet(sets),
  };
}

function buildRecords(exposures: ExerciseExposure[]): ExerciseHistoryResult["records"] {
  const loadedSets = exposures.flatMap((exposure) =>
    exposure.sets
      .filter((set) => set.load != null && set.load > 0 && set.reps > 0)
      .map((set) => ({ exposure, set, load: set.load as number }))
  );
  const estimatedStrengthSets = loadedSets
    .filter(({ set }) => set.reps <= ESTIMATED_STRENGTH_MAX_REPS)
    .sort((a, b) => compareEstimatedStrength(a.set, b.set));
  const bestEstimated = estimatedStrengthSets[0];
  const heaviest = [...loadedSets].sort(
    (a, b) => b.load - a.load || b.set.reps - a.set.reps
  )[0];
  const sessionVolumes = exposures
    .map((exposure) => ({
      exposure,
      volume: exposure.sets.reduce(
        (sum, set) => sum + (set.load != null ? set.load * set.reps : 0),
        0
      ),
    }))
    .filter((row) => row.volume > 0)
    .sort((a, b) => b.volume - a.volume);
  const highestVolume = sessionVolumes[0];

  return {
    bestEstimatedStrength: bestEstimated
      ? {
          date: bestEstimated.exposure.date,
          load: bestEstimated.load,
          reps: bestEstimated.set.reps,
          rpe: bestEstimated.set.rpe,
          estimatedOneRepMax: Math.round(
            estimateOneRepMax(bestEstimated.load, bestEstimated.set.reps) * 10
          ) / 10,
        }
      : null,
    heaviestCompletedLoad: heaviest
      ? {
          date: heaviest.exposure.date,
          load: heaviest.load,
          reps: heaviest.set.reps,
          rpe: heaviest.set.rpe,
        }
      : null,
    highestSessionVolume: highestVolume
      ? {
          date: highestVolume.exposure.date,
          volume: Math.round(highestVolume.volume * 10) / 10,
          completedSetCount: highestVolume.exposure.completedSetCount,
        }
      : null,
  };
}

export async function loadExerciseHistory(
  exerciseId: string,
  userId: string,
  limit: number = 3,
  comparisonSnapshot?: { measurement: MeasurementSemantics | null },
): Promise<ExerciseHistoryResult> {
  const rows = await loadHistoryRows(exerciseId, userId);
  const performedRows = rows.filter(
    (row) =>
      row.exerciseId === exerciseId &&
      PERFORMED_WORKOUT_STATUS_SET.has(row.workout.status),
  );
  const performedExposures = performedRows
    .map(toExposure)
    .filter((row): row is PerformedExerciseExposure => row !== null)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const currentMeasurement = comparisonSnapshot
    ? comparisonSnapshot.measurement
    : performedExposures[0]?.measurement ?? null;
  const currentComparisonKey = measurementComparisonKey({
    exerciseId,
    measurement: currentMeasurement,
  });
  const currentLoadComparable = currentMeasurement
    ? permitsComputedLoadComparison(currentMeasurement)
    : performedExposures[0]?.displayLoadConvention !== "not_comparable";
  const exposures: ExerciseExposure[] = performedExposures.map((exposure) => ({
    ...exposure,
    isRecordComparable:
      currentLoadComparable &&
      measurementComparisonKey({
        exerciseId,
        measurement: exposure.measurement,
      }) === currentComparisonKey,
  }));

  const exercise = performedRows[0]?.exercise;
  const equipment = (exercise?.exerciseEquipment ?? []).map((item) =>
    item.equipment.type.toLowerCase()
  );
  const hasBodyweight = equipment.includes("bodyweight");
  const loadConvention = resolveLoadConvention(currentMeasurement, equipment);

  return {
    exercise: {
      id: exerciseId,
      name: exercise?.name ?? null,
      equipment,
    },
    comparison: {
      scope: "exact_exercise",
      loadConvention,
      note: currentMeasurement
        ? permitsComputedLoadComparison(currentMeasurement)
          ? "All performed work for this exact exercise is shown. Load records use only exposures with matching frozen measurement semantics."
          : "All performed work for this exact exercise is shown, but computed load records are disabled for this measurement convention."
        : hasBodyweight
        ? "All performed work for this exact exercise is shown. Legacy load records are unavailable because bodyweight and assistance are not comparable in the current data model."
        : "All performed work for this exact exercise is shown. Load records use only legacy-null exposures from this exact exercise.",
    },
    lastExposure: exposures[0] ?? null,
    recentExposures: exposures.slice(0, limit),
    records: buildRecords(exposures.filter((exposure) => exposure.isRecordComparable)),
  };
}
