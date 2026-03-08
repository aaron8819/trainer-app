import { prisma } from "@/lib/db/prisma";
import type {
  WorkoutExplanation,
  FilteredExerciseSummary,
  MuscleVolumeCompliance,
  VolumeComplianceStatus,
} from "@/lib/engine/explainability";
import { VOLUME_LANDMARKS } from "@/lib/engine/volume-landmarks";
import {
  explainExerciseRationale,
  explainPrescriptionRationale,
  generateCoachMessages,
} from "@/lib/engine/explainability";
import { getEffectiveStimulusByMuscle } from "@/lib/engine/stimulus";
import type { Exercise as EngineExercise, PrimaryGoal } from "@/lib/engine/types";
import type { SelectionObjective, SelectionCandidate } from "@/lib/engine/selection-v2/types";
import { loadCurrentBlockContext } from "./periodization";
import { getRestSeconds } from "@/lib/engine/prescription";
import { mapExercises } from "./workout-context";
import type { Prisma, Workout, WorkoutExercise, WorkoutSet } from "@prisma/client";
import { PERFORMED_WORKOUT_STATUSES } from "@/lib/workout-status";
import type {
  DeloadDecision,
  ProgressionReceipt,
  ProgressionSetSummary,
} from "@/lib/evidence/types";
import {
  computeMusclesApproachingMRV,
  computeVolumeSpikePercent,
  hasPRPotential,
} from "./explainability/stats";
import { computeDoubleProgressionDecision } from "@/lib/engine/progression";
import { getWeeklyVolumeTarget } from "./mesocycle-lifecycle-math";
import { readPersistedWorkoutMesocycleSnapshot } from "./workout-mesocycle-snapshot";
import {
  buildExplanationPeriodization,
  buildSessionContextFromEvidence,
  buildSessionEvidence,
  deriveExplainabilityConfidence,
} from "./explainability/assembly";
import {
  loadExplainabilityExerciseLibrary,
  loadWorkoutWithExplainabilityRelations,
  type WorkoutWithExplainabilityRelations,
} from "./explainability/query";
import { loadMesocycleWeekMuscleVolume } from "./weekly-volume";

const HISTORY_RECENCY_WINDOW_DAYS = 42;
const CANONICAL_RATIONALE_COMPONENT_KEYS = [
  "deficitFill",
  "rotationNovelty",
  "sfrScore",
  "lengthenedScore",
  "movementNovelty",
  "sraAlignment",
  "userPreference",
] as const;

function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

export async function generateWorkoutExplanation(
  workoutId: string
): Promise<WorkoutExplanation | { error: string }> {
  const workout: WorkoutWithExplainabilityRelations | null =
    await loadWorkoutWithExplainabilityRelations(workoutId);

  if (!workout) {
    return { error: "Workout not found" };
  }

  const exerciseLibrary = await loadExplainabilityExerciseLibrary();
  const mappedExercises = mapExercises(exerciseLibrary);
  const exerciseById = new Map(mappedExercises.map((exercise) => [exercise.id, exercise]));
  const { blockContext, weekInMeso } = await loadCurrentBlockContext(
    workout.userId,
    workout.scheduledDate
  );
  const volumeByMuscle = await loadVolumeByMuscle(
    workout.userId,
    workout.scheduledDate,
    exerciseById
  );

  const sessionEvidence = buildSessionEvidence({
    selectionMetadata: workout.selectionMetadata,
  });
  const sessionContext = buildSessionContextFromEvidence({
    blockContext,
    volumeByMuscle,
    sessionEvidence,
    sessionIntent: workout.sessionIntent,
  });

  const workoutStats = await deriveWorkoutStats(workout, volumeByMuscle, exerciseById);
  const coachMessages = generateCoachMessages({
    sessionContext,
    workoutStats,
  });

  const exerciseRationales = new Map();
  const selectionObjective = buildSelectionObjective();
  const workoutExerciseIds = new Set(workout.exercises.map((exercise) => exercise.exerciseId));
  const storedRationaleByExerciseId = parseStoredRationale(
    workout.selectionMetadata,
    workoutExerciseIds
  );
  const hasStoredRationale = Boolean(
    storedRationaleByExerciseId && Object.keys(storedRationaleByExerciseId).length > 0
  );

  for (const workoutExercise of workout.exercises) {
    const candidate = buildSelectionCandidate(
      workoutExercise,
      mappedExercises,
      storedRationaleByExerciseId?.[workoutExercise.exerciseId]
    );
    if (candidate) {
      const rationale = explainExerciseRationale(candidate, selectionObjective, mappedExercises);
      exerciseRationales.set(workoutExercise.exerciseId, rationale);
    }
  }

  const rawMacroGoal = blockContext?.macroCycle.primaryGoal ?? "hypertrophy";
  const mappedPrimaryGoal: PrimaryGoal = rawMacroGoal === "general_fitness" ? "hypertrophy" : rawMacroGoal;
  const prescriptionRationales = new Map();
  const progressionReceipts = new Map<string, ProgressionReceipt>();
  const explanationPeriodization = buildExplanationPeriodization({
    blockContext,
    weekInMeso,
    sessionDecisionReceipt: sessionEvidence.sessionDecisionReceipt,
    mappedPrimaryGoal,
  });

  for (const workoutExercise of workout.exercises) {
    const exercise = mappedExercises.find((e) => e.id === workoutExercise.exerciseId);
    if (!exercise) continue;

    const engineSets = workoutExercise.sets.map((dbSet: WorkoutSet) => ({
      setIndex: dbSet.setIndex,
      targetReps: dbSet.targetReps ?? 10,
      targetRepRange: dbSet.targetRepMin && dbSet.targetRepMax
        ? { min: dbSet.targetRepMin, max: dbSet.targetRepMax }
        : undefined,
      targetRpe: dbSet.targetRpe ?? undefined,
      targetLoad: dbSet.targetLoad ?? undefined,
      restSeconds: dbSet.restSeconds ?? undefined,
    }));

    const rationale = explainPrescriptionRationale({
      exercise,
      sets: engineSets,
      isMainLift: workoutExercise.isMainLift,
      goals: {
        primary: mappedPrimaryGoal,
        secondary: "none",
      },
      profile: {
        trainingAge: blockContext?.macroCycle.trainingAge ?? "intermediate",
      },
      periodization: explanationPeriodization.periodization,
      blockType: explanationPeriodization.blockType,
      weekInMesocycle: explanationPeriodization.weekInMesocycle,
      weekInBlock: explanationPeriodization.weekInBlock,
      blockDurationWeeks: explanationPeriodization.blockDurationWeeks,
      restSeconds:
        engineSets[0]?.restSeconds ??
        getRestSeconds(exercise, workoutExercise.isMainLift, engineSets[0]?.targetReps ?? 10),
      exerciseRepRange:
        exercise.repRangeMin && exercise.repRangeMax
          ? { min: exercise.repRangeMin, max: exercise.repRangeMax }
          : undefined,
    });

    prescriptionRationales.set(workoutExercise.exerciseId, rationale);

    const topSet = engineSets.find((set) => set.targetReps != null || set.targetRepRange != null);
    const repRange: [number, number] = topSet?.targetRepRange
      ? [topSet.targetRepRange.min, topSet.targetRepRange.max]
      : [topSet?.targetReps ?? 8, topSet?.targetReps ?? 8];
    const lastPerformed = await loadLatestPerformedSetSummary(
      workout.userId,
      workout.id,
      workoutExercise.exerciseId,
      workout.scheduledDate,
      workoutExercise.isMainLift,
      repRange,
      workoutExercise.exercise.exerciseEquipment.map((item) => item.equipment.type)
    );
    const todayPrescription = summarizeTodayTopSet(engineSets);
    const isReadinessScaled = sessionEvidence.readinessScaledExerciseIds.has(workoutExercise.exerciseId);
    progressionReceipts.set(
      workoutExercise.exerciseId,
      buildProgressionReceipt(
        lastPerformed,
        todayPrescription,
        sessionEvidence.deloadDecision,
        isReadinessScaled
      )
    );
  }

  const filteredExercises: FilteredExerciseSummary[] = (workout.filteredExercises ?? []).map((fe) => ({
    exerciseId: fe.exerciseId ?? fe.id,
    exerciseName: fe.exerciseName,
    reason: fe.reason,
    userFriendlyMessage: fe.userFriendlyMessage,
  }));

  const confidence = deriveExplainabilityConfidence({
    hasReadinessSignal: sessionEvidence.hasRecentReadinessSignal,
    hasBlockContext: Boolean(blockContext),
    hasSessionDecisionReceipt: sessionEvidence.hasSessionDecisionReceipt,
    hasStoredSelectionRationale: hasStoredRationale,
    hasDerivedWorkoutStats:
      workoutStats.volumeSpikePercent !== undefined ||
      workoutStats.hasPRPotential !== undefined ||
      (workoutStats.musclesApproachingMRV?.length ?? 0) > 0,
  });

  const volumeCompliance = await computeVolumeCompliance(workout, exerciseById);

  return {
    confidence,
    sessionContext,
    coachMessages,
    exerciseRationales,
    prescriptionRationales,
    progressionReceipts,
    filteredExercises,
    volumeCompliance,
  };
}

async function loadVolumeByMuscle(
  userId: string,
  currentDate: Date,
  exerciseById: Map<string, EngineExercise>
): Promise<Map<string, number>> {
  const sevenDaysAgo = new Date(currentDate);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const recentWorkouts = await prisma.workout.findMany({
    where: {
      userId,
      scheduledDate: {
        gte: sevenDaysAgo,
        lte: currentDate,
      },
      status: { in: [...PERFORMED_WORKOUT_STATUSES] },
    },
    include: {
      exercises: {
        include: {
          exercise: {
            include: {
              exerciseMuscles: {
                include: {
                  muscle: true,
                },
              },
            },
          },
          sets: {
            include: {
              logs: { orderBy: { completedAt: "desc" }, take: 1 },
            },
          },
        },
      },
    },
  });

  const volumeByMuscle = new Map<string, number>();

  for (const workout of recentWorkouts) {
    for (const exercise of workout.exercises) {
      const setCount = countLoggedPerformedSets(exercise.sets);
      if (setCount === 0) {
        continue;
      }
      const mappedExercise = exerciseById.get(exercise.exerciseId);
      if (!mappedExercise) {
        continue;
      }
      for (const [muscle, effective] of getEffectiveStimulusByMuscle(mappedExercise, setCount)) {
        volumeByMuscle.set(muscle, roundToTenth((volumeByMuscle.get(muscle) ?? 0) + effective));
      }
    }
  }

  return volumeByMuscle;
}

async function deriveWorkoutStats(
  workout: Workout & {
    exercises: Array<
      WorkoutExercise & {
        sets: Array<WorkoutSet & { logs: { wasSkipped: boolean }[] }>;
        exercise: {
          exerciseMuscles: {
            role: string;
            muscle: { name: string };
          }[];
        };
      }
    >;
  },
  weeklyVolumeByMuscle: Map<string, number>,
  exerciseById: Map<string, EngineExercise>
): Promise<{
  totalSets: number;
  hasPRPotential?: boolean;
  volumeSpikePercent?: number;
  musclesApproachingMRV?: string[];
}> {
  const totalSets = workout.exercises.reduce((sum, ex) => sum + countLoggedPerformedSets(ex.sets), 0);
  const currentWorkoutEffectiveSets = computeWorkoutEffectiveSets(workout.exercises, exerciseById);
  const baselineEffectiveSets = await loadHistoricalEffectiveSetTotals(
    workout.userId,
    workout.scheduledDate,
    workout.id,
    exerciseById,
    workout.sessionIntent ?? undefined
  );
  const volumeSpikePercent = computeVolumeSpikePercent(currentWorkoutEffectiveSets, baselineEffectiveSets);

  const weeklyWithCurrent = new Map(weeklyVolumeByMuscle);
  for (const [muscle, sets] of computeWorkoutEffectiveSetsByMuscle(
    workout.exercises,
    exerciseById
  ).entries()) {
    weeklyWithCurrent.set(muscle, (weeklyWithCurrent.get(muscle) ?? 0) + sets);
  }
  const musclesApproachingMRV = computeMusclesApproachingMRV(weeklyWithCurrent);

  const plannedByExercise = buildPlannedMaxByExercise(workout.exercises);
  const historyMaxByExercise = await loadHistoricalExercisePerformance(
    workout.userId,
    [...plannedByExercise.keys()],
    workout.id
  );

  return {
    totalSets,
    volumeSpikePercent,
    musclesApproachingMRV,
    hasPRPotential: hasPRPotential(plannedByExercise, historyMaxByExercise),
  };
}

function computeWorkoutEffectiveSets(
  exercises: Array<
    WorkoutExercise & {
      sets: Array<WorkoutSet & { logs: { wasSkipped: boolean }[] }>;
      exercise: {
        exerciseMuscles: {
          role: string;
          muscle: { name: string };
        }[];
      };
    }
  >,
  exerciseById: Map<string, EngineExercise>
): number {
  let total = 0;
  for (const exercise of exercises) {
    const setCount = countLoggedPerformedSets(exercise.sets);
    if (setCount === 0) {
      continue;
    }
    const mappedExercise = exerciseById.get(exercise.exerciseId);
    if (!mappedExercise) {
      continue;
    }
    for (const [, effective] of getEffectiveStimulusByMuscle(mappedExercise, setCount)) {
      total += effective;
    }
  }
  return roundToTenth(total);
}

function computeWorkoutEffectiveSetsByMuscle(
  exercises: Array<
    WorkoutExercise & {
      sets: Array<WorkoutSet & { logs: { wasSkipped: boolean }[] }>;
      exercise: {
        exerciseMuscles: {
          role: string;
          muscle: { name: string };
        }[];
      };
    }
  >,
  exerciseById: Map<string, EngineExercise>
): Map<string, number> {
  const output = new Map<string, number>();
  for (const exercise of exercises) {
    const setCount = countLoggedPerformedSets(exercise.sets);
    if (setCount === 0) {
      continue;
    }
    const mappedExercise = exerciseById.get(exercise.exerciseId);
    if (!mappedExercise) {
      continue;
    }
    for (const [muscle, effective] of getEffectiveStimulusByMuscle(mappedExercise, setCount)) {
      output.set(muscle, roundToTenth((output.get(muscle) ?? 0) + effective));
    }
  }
  return output;
}

async function loadHistoricalEffectiveSetTotals(
  userId: string,
  currentDate: Date,
  excludeWorkoutId: string,
  exerciseById: Map<string, EngineExercise>,
  sessionIntent?: string
): Promise<number[]> {
  const workouts = await prisma.workout.findMany({
    where: {
      userId,
      id: { not: excludeWorkoutId },
      status: { in: [...PERFORMED_WORKOUT_STATUSES] },
      scheduledDate: { lt: currentDate },
      ...(sessionIntent ? { sessionIntent: sessionIntent as never } : {}),
    },
    include: {
      exercises: {
        include: {
          exercise: {
            include: {
              exerciseMuscles: { include: { muscle: true } },
            },
          },
          sets: {
            include: {
              logs: { orderBy: { completedAt: "desc" }, take: 1 },
            },
          },
        },
      },
    },
    orderBy: { scheduledDate: "desc" },
    take: 6,
  });

  if (workouts.length === 0 && sessionIntent) {
    return loadHistoricalEffectiveSetTotals(userId, currentDate, excludeWorkoutId, exerciseById);
  }

  return workouts.map((entry) => computeWorkoutEffectiveSets(entry.exercises, exerciseById));
}

function buildPlannedMaxByExercise(
  exercises: Array<
    WorkoutExercise & {
      sets: Array<WorkoutSet & { logs: { actualLoad: number | null; actualReps: number | null; wasSkipped: boolean }[] }>;
    }
  >
): Map<string, { maxLoad: number | null; maxReps: number | null }> {
  const output = new Map<string, { maxLoad: number | null; maxReps: number | null }>();
  for (const exercise of exercises) {
    let maxLoad: number | null = null;
    let maxReps: number | null = null;
    for (const set of exercise.sets) {
      const latest = set.logs[0];
      if (!latest || latest.wasSkipped) {
        continue;
      }
      if (latest.actualLoad != null) {
        maxLoad = maxLoad == null ? latest.actualLoad : Math.max(maxLoad, latest.actualLoad);
      }
      if (latest.actualReps != null) {
        maxReps = maxReps == null ? latest.actualReps : Math.max(maxReps, latest.actualReps);
      }
    }
    output.set(exercise.exerciseId, { maxLoad, maxReps });
  }
  return output;
}

function countLoggedPerformedSets(
  sets: Array<{ logs: { wasSkipped: boolean }[] }>
): number {
  return sets.filter((set) => {
    const latest = set.logs[0];
    return Boolean(latest) && !latest?.wasSkipped;
  }).length;
}

async function loadHistoricalExercisePerformance(
  userId: string,
  exerciseIds: string[],
  excludeWorkoutId: string
): Promise<Map<string, { maxLoad: number | null; maxReps: number | null }>> {
  const output = new Map<string, { maxLoad: number | null; maxReps: number | null }>();
  await Promise.all(
    exerciseIds.map(async (exerciseId) => {
      const loadMax = await prisma.setLog.aggregate({
        _max: { actualLoad: true },
        where: {
          workoutSet: {
            workoutExercise: {
              exerciseId,
              workout: {
                userId,
                status: { in: [...PERFORMED_WORKOUT_STATUSES] },
                id: { not: excludeWorkoutId },
              },
            },
          },
          wasSkipped: false,
          actualLoad: { not: null },
        },
      });
      const repsMax = await prisma.setLog.aggregate({
        _max: { actualReps: true },
        where: {
          workoutSet: {
            workoutExercise: {
              exerciseId,
              workout: {
                userId,
                status: { in: [...PERFORMED_WORKOUT_STATUSES] },
                id: { not: excludeWorkoutId },
              },
            },
          },
          wasSkipped: false,
          actualReps: { not: null },
        },
      });
      output.set(exerciseId, {
        maxLoad: loadMax._max.actualLoad ?? null,
        maxReps: repsMax._max.actualReps ?? null,
      });
    })
  );
  return output;
}

function buildSelectionObjective(): SelectionObjective {
  return {
    constraints: {
      volumeFloor: new Map(),
      volumeCeiling: new Map(),
      painConflicts: new Set(),
      userAvoids: new Set(),
      minExercises: 1,
      maxExercises: 10,
    },
    weights: {
      volumeDeficitFill: 0.35,
      rotationNovelty: 0.22,
      lengthenedBias: 0.2,
      sfrEfficiency: 0.12,
      movementDiversity: 0.07,
      sraReadiness: 0.03,
      userPreference: 0.01,
    },
    volumeContext: {
      weeklyTarget: new Map(),
      weeklyActual: new Map(),
      effectiveActual: new Map(),
    },
    rotationContext: new Map(),
    sraContext: new Map(),
    preferences: {
      favoriteExerciseIds: new Set(),
      avoidExerciseIds: new Set(),
    },
  };
}

type StoredSelectionRationale = {
  score: number;
  components?: Partial<Record<(typeof CANONICAL_RATIONALE_COMPONENT_KEYS)[number], number>>;
  hardFilterPass?: boolean;
  selectedStep?: string;
  reason?: string;
};

export function normalizeStoredSelectionRationaleComponents(
  value: unknown
): StoredSelectionRationale["components"] | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const normalizedEntries = CANONICAL_RATIONALE_COMPONENT_KEYS.flatMap((key) => {
    const componentValue = (value as Record<string, unknown>)[key];
    return typeof componentValue === "number" && Number.isFinite(componentValue)
      ? [[key, componentValue] as const]
      : [];
  });

  return normalizedEntries.length > 0 ? Object.fromEntries(normalizedEntries) : undefined;
}

function parseStoredRationale(
  metadata: Prisma.JsonValue | null | undefined,
  allowedExerciseIds?: Set<string>
): Record<string, StoredSelectionRationale> | undefined {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return undefined;
  }

  const root = metadata as Record<string, unknown>;
  const rationaleRaw = root.rationale;
  if (!rationaleRaw || typeof rationaleRaw !== "object" || Array.isArray(rationaleRaw)) {
    return undefined;
  }

  const output: Record<string, StoredSelectionRationale> = {};
  for (const [exerciseId, value] of Object.entries(rationaleRaw as Record<string, unknown>)) {
    if (allowedExerciseIds && !allowedExerciseIds.has(exerciseId)) {
      continue;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      continue;
    }
    const entry = value as Record<string, unknown>;
    if (typeof entry.score !== "number") {
      continue;
    }
    output[exerciseId] = {
      score: entry.score,
      components: normalizeStoredSelectionRationaleComponents(entry.components),
      hardFilterPass: typeof entry.hardFilterPass === "boolean" ? entry.hardFilterPass : undefined,
      selectedStep: typeof entry.selectedStep === "string" ? entry.selectedStep : undefined,
      reason: typeof entry.reason === "string" ? entry.reason : undefined,
    };
  }

  return Object.keys(output).length > 0 ? output : undefined;
}

function buildSelectionCandidate(
  workoutExercise: WorkoutExercise & {
    exercise: {
      id: string;
      name: string;
      movementPatterns: string[];
      exerciseMuscles: {
        role: string;
        muscle: { name: string };
      }[];
    };
      sets: Array<{ id: string; logs: { wasSkipped: boolean }[] }>;
    },
  exerciseLibrary: EngineExercise[],
  storedRationale?: StoredSelectionRationale
): SelectionCandidate | null {
  const exercise = exerciseLibrary.find((e) => e.id === workoutExercise.exerciseId);
  if (!exercise) return null;

  const performedSetCount = countLoggedPerformedSets(workoutExercise.sets);
  const setCount = performedSetCount > 0 ? performedSetCount : workoutExercise.sets?.length ?? 3;
  const volumeContribution = getEffectiveStimulusByMuscle(exercise, setCount);
  const fallback = {
    deficitFill: Math.min(1, setCount / 6),
    rotationNovelty: Math.min(1, Math.max(1, exercise.movementPatterns.length) / 3),
    sfrScore: (exercise.sfrScore ?? 3) / 5,
    lengthenedScore: (exercise.lengthPositionScore ?? 3) / 5,
    movementNovelty: Math.min(1, Math.max(1, exercise.movementPatterns.length) / 4),
    sraAlignment: 0.5,
    userPreference: 0.5,
  };
  const components = storedRationale?.components ?? {};
  const scores = {
    deficitFill: components.deficitFill ?? fallback.deficitFill,
    rotationNovelty: components.rotationNovelty ?? fallback.rotationNovelty,
    sfrScore: components.sfrScore ?? fallback.sfrScore,
    lengthenedScore: components.lengthenedScore ?? fallback.lengthenedScore,
    movementNovelty: components.movementNovelty ?? fallback.movementNovelty,
    sraAlignment: components.sraAlignment ?? fallback.sraAlignment,
    userPreference: components.userPreference ?? fallback.userPreference,
  };

  const fallbackTotalScore =
    scores.deficitFill * 0.35 +
    scores.rotationNovelty * 0.22 +
    scores.sfrScore * 0.12 +
    scores.lengthenedScore * 0.2 +
    scores.movementNovelty * 0.07 +
    scores.sraAlignment * 0.03 +
    scores.userPreference * 0.01;

  return {
    exercise,
    proposedSets: setCount,
    volumeContribution,
    timeContribution: ((exercise.timePerSetSec ?? 90) * setCount) / 60,
    scores,
    totalScore: storedRationale?.score ?? fallbackTotalScore,
  };
}

async function loadLatestPerformedSetSummary(
  userId: string,
  workoutId: string,
  exerciseId: string,
  asOfDate: Date,
  isMainLift: boolean,
  repRange: [number, number],
  equipment: string[]
): Promise<(ProgressionSetSummary & { decisionLog?: string[] }) | null> {
  const previous = await prisma.workoutExercise.findFirst({
    where: {
      exerciseId,
      workout: {
        userId,
        id: { not: workoutId },
        status: { in: [...PERFORMED_WORKOUT_STATUSES] },
      },
    },
    orderBy: { workout: { scheduledDate: "desc" } },
    include: {
      workout: {
        select: {
          scheduledDate: true,
          selectionMode: true,
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

  if (!previous) return null;
  const performedDate = previous.workout?.scheduledDate ?? null;
  if (performedDate) {
    const ageDays = Math.floor((asOfDate.getTime() - performedDate.getTime()) / (24 * 60 * 60 * 1000));
    if (ageDays > HISTORY_RECENCY_WINDOW_DAYS) {
      return null;
    }
  }

  const performedLogs = previous.sets
    .map((set) => ({ setIndex: set.setIndex, log: set.logs[0] }))
    .filter(
      (entry) =>
        Boolean(entry.log) &&
        !entry.log?.wasSkipped &&
        (entry.log?.actualRpe == null || entry.log.actualRpe >= 6)
    );
  if (performedLogs.length === 0) {
    return null;
  }

  const loadFrequency = new Map<number, { count: number; latestSetIndex: number }>();
  for (const entry of performedLogs) {
    const load = entry.log?.actualLoad;
    if (!Number.isFinite(load) || (load ?? 0) < 0) {
      continue;
    }
    const current = loadFrequency.get(load as number);
    if (!current) {
      loadFrequency.set(load as number, { count: 1, latestSetIndex: entry.setIndex });
      continue;
    }
    current.count += 1;
    current.latestSetIndex = Math.max(current.latestSetIndex, entry.setIndex);
  }

  const modalLoad =
    loadFrequency.size > 0
      ? Array.from(loadFrequency.entries()).sort((a, b) => {
          const [, left] = a;
          const [, right] = b;
          if (right.count !== left.count) {
            return right.count - left.count;
          }
          if (right.latestSetIndex !== left.latestSetIndex) {
            return right.latestSetIndex - left.latestSetIndex;
          }
          return b[0] - a[0];
        })[0]?.[0]
      : null;
  const topSetLoad =
    performedLogs
      .sort((a, b) => a.setIndex - b.setIndex)
      .find((entry) => Number.isFinite(entry.log?.actualLoad) && (entry.log?.actualLoad ?? 0) >= 0)
      ?.log?.actualLoad ?? null;
  const anchorLoad = isMainLift ? topSetLoad : modalLoad;

  const representative =
    anchorLoad == null
      ? performedLogs.sort((a, b) => a.setIndex - b.setIndex)[0]
      : performedLogs
          .filter((entry) => entry.log?.actualLoad === anchorLoad)
          .sort((a, b) => b.setIndex - a.setIndex)[0];

  const decision = computeDoubleProgressionDecision(
    performedLogs.map((entry) => ({
      reps: entry.log?.actualReps ?? 0,
      rpe: entry.log?.actualRpe ?? undefined,
      load: entry.log?.actualLoad ?? undefined,
    })),
    repRange,
    resolveProgressionEquipment(equipment),
    {
      priorSessionCount: await countPerformedHistorySessions(userId, exerciseId, workoutId),
      historyConfidenceScale: await resolveExplainabilityHistoryConfidenceScale({
        userId,
        workoutId,
        previousSelectionMode: previous.workout.selectionMode ?? undefined,
        previousScheduledDate: performedDate ?? undefined,
        exerciseId,
        performedLogs,
      }),
      confidenceReasons: await resolveExplainabilityConfidenceNotes({
        userId,
        workoutId,
        previousSelectionMode: previous.workout.selectionMode ?? undefined,
        previousScheduledDate: performedDate ?? undefined,
        exerciseId,
        performedLogs,
      }),
    }
  );

  return {
    reps: representative?.log?.actualReps ?? null,
    load: anchorLoad,
    rpe: representative?.log?.actualRpe ?? null,
    performedAt: performedDate ? performedDate.toISOString() : null,
    decisionLog: decision?.decisionLog,
  };
}

async function countPerformedHistorySessions(
  userId: string,
  exerciseId: string,
  excludeWorkoutId: string
): Promise<number> {
  const countFn = (prisma as unknown as {
    workoutExercise?: {
      count?: (args: unknown) => Promise<number>;
    };
  }).workoutExercise?.count;
  if (!countFn) {
    return 1;
  }
  return countFn({
    where: {
      exerciseId,
      workout: {
        userId,
        id: { not: excludeWorkoutId },
        status: { in: [...PERFORMED_WORKOUT_STATUSES] },
      },
    },
  });
}

type ExplainabilityConfidenceInput = {
  userId: string;
  workoutId: string;
  exerciseId: string;
  previousSelectionMode?: string;
  previousScheduledDate?: Date;
  performedLogs: Array<{
    setIndex: number;
    log?: { actualRpe: number | null; actualLoad: number | null } | undefined;
  }>;
};

async function resolveExplainabilityHistoryConfidenceScale(
  input: ExplainabilityConfidenceInput
): Promise<number> {
  const { previousSelectionMode } = input;
  if (previousSelectionMode !== "MANUAL") {
    return previousSelectionMode === "INTENT" ? 1 : 0.8;
  }
  const anomalyFlags = await resolveManualAnomalyFlags(input);
  if (anomalyFlags.length > 0) {
    return 0.3;
  }

  const hasIntentHistory = await prisma.workoutExercise.findFirst({
    where: {
      exerciseId: input.exerciseId,
      workout: {
        userId: input.userId,
        id: { not: input.workoutId },
        status: { in: [...PERFORMED_WORKOUT_STATUSES] },
        selectionMode: "INTENT",
      },
    },
    select: { id: true },
  });
  return hasIntentHistory ? 0.7 : 1;
}

async function resolveExplainabilityConfidenceNotes(
  input: ExplainabilityConfidenceInput
): Promise<string[]> {
  const notes: string[] = [];
  if (input.previousSelectionMode === "INTENT") {
    notes.push("Previous INTENT history kept full progression confidence.");
    return notes;
  }
  if (input.previousSelectionMode !== "MANUAL") {
    notes.push("Previous history was not INTENT, so progression confidence was reduced.");
    return notes;
  }

  const anomalyFlags = await resolveManualAnomalyFlags(input);
  if (anomalyFlags.length > 0) {
    notes.push(
      `MANUAL history was heavily discounted because it looked unreliable: ${anomalyFlags.join(", ")}.`
    );
    return notes;
  }

  const hasIntentHistory = await prisma.workoutExercise.findFirst({
    where: {
      exerciseId: input.exerciseId,
      workout: {
        userId: input.userId,
        id: { not: input.workoutId },
        status: { in: [...PERFORMED_WORKOUT_STATUSES] },
        selectionMode: "INTENT",
      },
    },
    select: { id: true },
  });
  notes.push(
    hasIntentHistory
      ? "MANUAL history was discounted because cleaner INTENT history exists for this exercise."
      : "Only MANUAL history was available, so progression used it without an extra discount."
  );
  return notes;
}

async function resolveManualAnomalyFlags(
  input: ExplainabilityConfidenceInput
): Promise<string[]> {
  const anomalyFlags: string[] = [];
  const rpes = input.performedLogs
    .map((entry) => entry.log?.actualRpe)
    .filter((value): value is number => Number.isFinite(value));
  if (rpes.length > 0 && rpes.every((rpe) => rpe === rpes[0])) {
    anomalyFlags.push("every set reported the same RPE");
  }

  const rpeTenCount = rpes.filter((rpe) => rpe === 10).length;
  if (rpes.length > 0 && rpeTenCount / rpes.length > 0.5) {
    anomalyFlags.push("most sets were logged at RPE 10");
  }

  const currentModal = resolvePerformedModalLoad(input.performedLogs);
  if (currentModal != null && input.previousScheduledDate) {
    const recentIntent = await prisma.workoutExercise.findFirst({
      where: {
        exerciseId: input.exerciseId,
        workout: {
          userId: input.userId,
          id: { not: input.workoutId },
          status: { in: [...PERFORMED_WORKOUT_STATUSES] },
          selectionMode: "INTENT",
          scheduledDate: { lt: input.previousScheduledDate },
        },
      },
      orderBy: { workout: { scheduledDate: "desc" } },
      include: {
        sets: {
          orderBy: { setIndex: "asc" },
          include: {
            logs: { orderBy: { completedAt: "desc" }, take: 1 },
          },
        },
      },
    });

    if (recentIntent) {
      const intentLogs = recentIntent.sets.map((set) => ({
        setIndex: set.setIndex,
        log: set.logs[0]
          ? {
              actualRpe: set.logs[0].actualRpe,
              actualLoad: set.logs[0].actualLoad,
            }
          : undefined,
      }));
      const intentModal = resolvePerformedModalLoad(intentLogs);
      if (intentModal != null && intentModal > 0 && currentModal < intentModal * 0.5) {
        anomalyFlags.push("manual load dropped far below earlier INTENT history");
      }
    }
  }

  return anomalyFlags;
}

function resolvePerformedModalLoad(
  performedLogs: Array<{
    setIndex: number;
    log?: { actualRpe: number | null; actualLoad: number | null } | undefined;
  }>
): number | null {
  const frequency = new Map<number, number>();
  for (const entry of performedLogs) {
    if (
      entry.log?.actualRpe != null &&
      Number.isFinite(entry.log.actualRpe) &&
      entry.log.actualRpe < 6
    ) {
      continue;
    }
    if (!Number.isFinite(entry.log?.actualLoad) || (entry.log?.actualLoad ?? 0) < 0) {
      continue;
    }
    const load = entry.log?.actualLoad as number;
    frequency.set(load, (frequency.get(load) ?? 0) + 1);
  }
  if (frequency.size === 0) {
    return null;
  }
  return Array.from(frequency.entries()).sort((a, b) => {
    if (b[1] !== a[1]) {
      return b[1] - a[1];
    }
    return b[0] - a[0];
  })[0]?.[0] ?? null;
}

function summarizeTodayTopSet(
  sets: Array<{ targetReps?: number; targetRpe?: number; targetLoad?: number }>
): ProgressionSetSummary | null {
  const top = sets.find((set) => set.targetLoad != null || set.targetReps != null || set.targetRpe != null);
  if (!top) return null;
  return {
    reps: top.targetReps ?? null,
    load: top.targetLoad ?? null,
    rpe: top.targetRpe ?? null,
  };
}

function buildProgressionReceipt(
  lastPerformed: (ProgressionSetSummary & { decisionLog?: string[] }) | null,
  todayPrescription: ProgressionSetSummary | null,
  deloadDecision: DeloadDecision | null,
  readinessScaled: boolean
): ProgressionReceipt {
  const loadDelta =
    lastPerformed?.load != null && todayPrescription?.load != null
      ? todayPrescription.load - lastPerformed.load
      : null;
  const loadPercent =
    loadDelta != null && lastPerformed?.load && lastPerformed.load > 0
      ? (loadDelta / lastPerformed.load) * 100
      : null;
  const repsDelta =
    lastPerformed?.reps != null && todayPrescription?.reps != null
      ? todayPrescription.reps - lastPerformed.reps
      : null;
  const rpeDelta =
    lastPerformed?.rpe != null && todayPrescription?.rpe != null
      ? todayPrescription.rpe - lastPerformed.rpe
      : null;

  let trigger: ProgressionReceipt["trigger"] = "insufficient_data";
  if (deloadDecision && deloadDecision.mode !== "none") {
    trigger = "deload";
  } else if (readinessScaled) {
    trigger = "readiness_scale";
  } else if (todayPrescription?.load == null || lastPerformed?.load == null) {
    trigger = "insufficient_data";
  } else if (todayPrescription.load > lastPerformed.load) {
    trigger = "double_progression";
  } else {
    trigger = "hold";
  }

  return {
    lastPerformed,
    todayPrescription,
    delta: {
      load: loadDelta,
      loadPercent,
      reps: repsDelta,
      rpe: rpeDelta,
    },
    trigger,
    decisionLog: lastPerformed?.decisionLog,
  };
}

function resolveProgressionEquipment(equipment: string[]): "barbell" | "dumbbell" | "cable" | "other" {
  const normalized = equipment.map((item) => item.trim().toLowerCase());
  if (normalized.includes("barbell")) return "barbell";
  if (normalized.includes("dumbbell")) return "dumbbell";
  if (normalized.includes("cable")) return "cable";
  return "other";
}

// ---------------------------------------------------------------------------
// Volume Compliance (post-generation, read-only)
// ---------------------------------------------------------------------------

const VOLUME_COMPLIANCE_SEVERITY: VolumeComplianceStatus[] = [
  "OVER_MAV",
  "AT_MAV",
  "APPROACHING_MAV",
  "OVER_TARGET",
  "ON_TARGET",
  "APPROACHING_TARGET",
  "UNDER_MEV",
];

function computeVolumeComplianceStatus(
  projectedTotal: number,
  weeklyTarget: number,
  mev: number,
  mav: number
): VolumeComplianceStatus {
  if (projectedTotal > mav) return "OVER_MAV";
  if (projectedTotal === mav) return "AT_MAV";
  if (projectedTotal > mav * 0.85) return "APPROACHING_MAV";
  if (projectedTotal > weeklyTarget) return "OVER_TARGET";
  if (projectedTotal >= weeklyTarget) return "ON_TARGET";
  if (projectedTotal >= mev) return "APPROACHING_TARGET";
  return "UNDER_MEV";
}

async function computeVolumeCompliance(
  workout: WorkoutWithExplainabilityRelations,
  exerciseById: Map<string, EngineExercise>
): Promise<MuscleVolumeCompliance[]> {
  const mesocycleSnapshot = readPersistedWorkoutMesocycleSnapshot(workout);
  if (!mesocycleSnapshot) {
    return [];
  }

  const meso = await prisma.mesocycle.findUnique({
    where: { id: mesocycleSnapshot.mesocycleId },
    select: {
      durationWeeks: true,
      startWeek: true,
      blocks: {
        orderBy: { blockNumber: "asc" },
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
  });
  if (!meso) return [];

  const weekStart = new Date(meso.macroCycle.startDate);
  weekStart.setDate(weekStart.getDate() + (meso.startWeek + mesocycleSnapshot.week - 1) * 7);
  const performedEffectiveVolumeBeforeSession = new Map<string, number>(
    Object.entries(
      await loadMesocycleWeekMuscleVolume(prisma, {
        userId: workout.userId,
        mesocycleId: mesocycleSnapshot.mesocycleId,
        targetWeek: mesocycleSnapshot.week,
        weekStart,
        excludeWorkoutId: workout.id,
        performedBefore: workout.scheduledDate,
      })
    ).map(([muscle, row]) => [muscle, row.effectiveSets])
  );

  const plannedEffectiveVolumeThisSession = new Map<string, number>();
  for (const we of workout.exercises) {
    const prescribedSets = we.sets.filter(
      (s) => !s.logs[0]?.wasSkipped
    ).length;
    const exercise = exerciseById.get(we.exerciseId);
    if (!exercise || prescribedSets === 0) {
      continue;
    }
    for (const [muscle, effective] of getEffectiveStimulusByMuscle(exercise, prescribedSets)) {
      plannedEffectiveVolumeThisSession.set(
        muscle,
        roundToTenth((plannedEffectiveVolumeThisSession.get(muscle) ?? 0) + effective)
      );
    }
  }

  const compliance: MuscleVolumeCompliance[] = [];
  for (const [muscle, planned] of plannedEffectiveVolumeThisSession.entries()) {
    const landmarks = VOLUME_LANDMARKS[muscle];
    if (!landmarks) continue;

    const before = performedEffectiveVolumeBeforeSession.get(muscle) ?? 0;
    const projected = roundToTenth(before + planned);
    const weeklyTarget = getWeeklyVolumeTarget(meso, muscle, mesocycleSnapshot.week);

    compliance.push({
      muscle,
      performedEffectiveVolumeBeforeSession: before,
      plannedEffectiveVolumeThisSession: planned,
      projectedEffectiveVolume: projected,
      weeklyTarget,
      mev: landmarks.mev,
      mav: landmarks.mav,
      status: computeVolumeComplianceStatus(projected, weeklyTarget, landmarks.mev, landmarks.mav),
    });
  }

  // Sort by severity descending (OVER_MAV first, UNDER_MEV last)
  compliance.sort(
    (a, b) =>
      VOLUME_COMPLIANCE_SEVERITY.indexOf(a.status) -
      VOLUME_COMPLIANCE_SEVERITY.indexOf(b.status)
  );

  return compliance;
}
