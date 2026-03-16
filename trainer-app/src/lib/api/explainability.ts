import { prisma } from "@/lib/db/prisma";
import type {
  WorkoutExplanation,
  FilteredExerciseSummary,
  MuscleVolumeCompliance,
  VolumeComplianceStatus,
  NextExposureDecision,
} from "@/lib/engine/explainability";
import { VOLUME_LANDMARKS } from "@/lib/engine/volume-landmarks";
import {
  explainExerciseRationale,
  explainPrescriptionRationale,
  generateCoachMessages,
} from "@/lib/engine/explainability";
import { getEffectiveStimulusByMuscle } from "@/lib/engine/stimulus";
import type { Exercise as EngineExercise, PrimaryGoal, WorkoutSelectionMode } from "@/lib/engine/types";
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
import { isProgressionEligibleWorkout } from "@/lib/progression/progression-eligibility";
import {
  buildCanonicalProgressionEvaluationInput,
  type CanonicalProgressionHistorySession,
} from "@/lib/progression/canonical-progression-input";
import { derivePerformedExerciseSemantics } from "@/lib/session-semantics/performed-exercise-semantics";
import { classifySetLog } from "@/lib/session-semantics/set-classification";
import { resolveTargetRepRange } from "@/lib/session-semantics/target-evaluation";
import { deriveSessionSemantics } from "@/lib/session-semantics/derive-session-semantics";
import { getCanonicalNextExposureCopy } from "@/lib/ui/next-exposure-copy";

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

function countsTowardCanonicalPerformanceHistory(input: {
  advancesSplit?: boolean | null;
  selectionMetadata?: unknown;
  selectionMode?: string | null;
  sessionIntent?: string | null;
  mesocyclePhaseSnapshot?: string | null;
}): boolean {
  return deriveSessionSemantics({
    advancesSplit: input.advancesSplit,
    selectionMetadata: input.selectionMetadata,
    selectionMode: input.selectionMode,
    sessionIntent: input.sessionIntent,
    mesocyclePhase: input.mesocyclePhaseSnapshot,
  }).countsTowardPerformanceHistory;
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
  const nextExposureDecisions = new Map<string, NextExposureDecision>();
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
    const effectiveRepRange = resolveTargetRepRange({
      targetReps: topSet?.targetReps,
      targetRepRange: topSet?.targetRepRange,
    });
    const repRange: [number, number] = effectiveRepRange
      ? [effectiveRepRange.min, effectiveRepRange.max]
      : [8, 8];
    const isMainLiftEligible = workoutExercise.exercise.isMainLiftEligible ?? workoutExercise.isMainLift;
    const equipmentTypes = workoutExercise.exercise.exerciseEquipment.map((item) => item.equipment.type);
    const lastPerformed = await loadLatestPerformedSetSummary(
      workout.userId,
      workout.id,
      workoutExercise.exerciseId,
      workout.scheduledDate,
      isMainLiftEligible,
      repRange,
      equipmentTypes
    );
    const todayPrescription = summarizeTodayTopSet(engineSets);
    const currentSemantics = derivePerformedExerciseSemantics({
      isMainLiftEligible,
      sets: workoutExercise.sets.map((set) => ({
        setIndex: set.setIndex,
        targetLoad: set.targetLoad,
        actualLoad: set.logs[0]?.actualLoad ?? null,
        actualReps: set.logs[0]?.actualReps ?? null,
        actualRpe: set.logs[0]?.actualRpe ?? null,
        wasSkipped: set.logs[0]?.wasSkipped ?? false,
      })),
    });
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
    const nextExposureDecision = await buildNextExposureDecision(
      currentSemantics,
      repRange,
      equipmentTypes,
      {
        userId: workout.userId,
        workoutId: workout.id,
        exerciseId: workoutExercise.exerciseId,
        scheduledDate: workout.scheduledDate,
        selectionMode: workout.selectionMode ?? undefined,
        performedLogs: workoutExercise.sets.map((set) => ({
          setIndex: set.setIndex,
          log: set.logs[0]
            ? {
                actualRpe: set.logs[0].actualRpe,
                actualLoad: set.logs[0].actualLoad,
              }
            : undefined,
        })),
      }
    );
    if (nextExposureDecision) {
      nextExposureDecisions.set(workoutExercise.exerciseId, nextExposureDecision);
    }
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
    nextExposureDecisions,
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
    take: 12,
  });

  const canonicalWorkouts = workouts
    .filter((workout) =>
      countsTowardCanonicalPerformanceHistory({
        advancesSplit: workout.advancesSplit,
        selectionMetadata: workout.selectionMetadata,
        selectionMode: workout.selectionMode,
        sessionIntent: workout.sessionIntent,
        mesocyclePhaseSnapshot: workout.mesocyclePhaseSnapshot,
      })
    )
    .slice(0, 6);

  if (canonicalWorkouts.length === 0 && sessionIntent) {
    return loadHistoricalEffectiveSetTotals(userId, currentDate, excludeWorkoutId, exerciseById);
  }

  return canonicalWorkouts.map((entry) => computeWorkoutEffectiveSets(entry.exercises, exerciseById));
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
  const output = new Map<string, { maxLoad: number | null; maxReps: number | null }>(
    exerciseIds.map((exerciseId) => [exerciseId, { maxLoad: null, maxReps: null }])
  );
  const rows = await prisma.workoutExercise.findMany({
    where: {
      exerciseId: { in: exerciseIds },
      workout: {
        userId,
        status: { in: [...PERFORMED_WORKOUT_STATUSES] },
        id: { not: excludeWorkoutId },
      },
    },
    include: {
      workout: {
        select: {
          advancesSplit: true,
          selectionMetadata: true,
          selectionMode: true,
          sessionIntent: true,
          mesocyclePhaseSnapshot: true,
        },
      },
      sets: {
        include: {
          logs: { orderBy: { completedAt: "desc" }, take: 1 },
        },
      },
    },
  });

  for (const row of rows) {
    if (
      !countsTowardCanonicalPerformanceHistory({
        advancesSplit: row.workout.advancesSplit,
        selectionMetadata: row.workout.selectionMetadata,
        selectionMode: row.workout.selectionMode,
        sessionIntent: row.workout.sessionIntent,
        mesocyclePhaseSnapshot: row.workout.mesocyclePhaseSnapshot,
      })
    ) {
      continue;
    }

    const current = output.get(row.exerciseId) ?? { maxLoad: null, maxReps: null };
    for (const set of row.sets) {
      const latest = set.logs[0];
      if (!latest || latest.wasSkipped) {
        continue;
      }
      if (latest.actualLoad != null) {
        current.maxLoad =
          current.maxLoad == null ? latest.actualLoad : Math.max(current.maxLoad, latest.actualLoad);
      }
      if (latest.actualReps != null) {
        current.maxReps =
          current.maxReps == null ? latest.actualReps : Math.max(current.maxReps, latest.actualReps);
      }
    }
    output.set(row.exerciseId, current);
  }

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
  isMainLiftEligible: boolean,
  repRange: [number, number],
  equipment: string[]
): Promise<(ProgressionSetSummary & { decisionLog?: string[] }) | null> {
  const previous = await findLatestProgressionEligibleWorkoutExercise({
    userId,
    workoutId,
    exerciseId,
  });

  if (!previous) return null;
  const performedDate = previous.workout?.scheduledDate ?? null;
  if (performedDate) {
    const ageDays = Math.floor((asOfDate.getTime() - performedDate.getTime()) / (24 * 60 * 60 * 1000));
    if (ageDays > HISTORY_RECENCY_WINDOW_DAYS) {
      return null;
    }
  }

  const performedLogs = previous.sets.map((set) => ({ setIndex: set.setIndex, log: set.logs[0] }));
  const performedSemantics = derivePerformedExerciseSemantics({
    isMainLiftEligible,
    sets: previous.sets.map((set) => ({
      setIndex: set.setIndex,
      targetLoad: set.targetLoad,
      actualLoad: set.logs[0]?.actualLoad ?? null,
      actualReps: set.logs[0]?.actualReps ?? null,
      actualRpe: set.logs[0]?.actualRpe ?? null,
      wasSkipped: set.logs[0]?.wasSkipped ?? false,
    })),
  });
  if (!performedSemantics) {
    return null;
  }

  const progressionInput = await buildExplainabilityCanonicalProgressionInput(
    performedSemantics,
    repRange,
    equipment,
    {
      userId,
      workoutId,
      selectionMode: previous.workout.selectionMode ?? undefined,
      scheduledDate: performedDate ?? undefined,
      exerciseId,
      performedLogs,
    }
  );
  const decision = computeDoubleProgressionDecision(
    progressionInput.lastSets,
    progressionInput.repRange,
    progressionInput.equipment,
    progressionInput.decisionOptions
  );

  return {
    reps: performedSemantics.medianReps,
    load: performedSemantics.anchorLoad,
    rpe: performedSemantics.modalRpe,
    performedAt: performedDate ? performedDate.toISOString() : null,
    decisionLog: decision?.decisionLog,
  };
}

type ExplainabilityConfidenceInput = {
  userId: string;
  workoutId: string;
  exerciseId: string;
  selectionMode?: WorkoutSelectionMode;
  scheduledDate?: Date;
  performedLogs: Array<{
    setIndex: number;
    log?: { actualRpe: number | null; actualLoad: number | null } | undefined;
  }>;
};

async function resolveExplainabilityHistoryConfidenceScale(
  input: ExplainabilityConfidenceInput
): Promise<number> {
  const { selectionMode } = input;
  if (selectionMode !== "MANUAL") {
    return selectionMode === "INTENT" ? 1 : 0.8;
  }
  const anomalyFlags = await resolveManualAnomalyFlags(input);
  if (anomalyFlags.length > 0) {
    return 0.3;
  }

  const hasIntentHistory = await findLatestProgressionEligibleWorkoutExercise({
    userId: input.userId,
    workoutId: input.workoutId,
    exerciseId: input.exerciseId,
    requiredSelectionMode: "INTENT",
  });
  return hasIntentHistory ? 0.7 : 1;
}

async function resolveExplainabilityConfidenceNotes(
  input: ExplainabilityConfidenceInput
): Promise<string[]> {
  const notes: string[] = [];
  if (input.selectionMode === "INTENT") {
    notes.push("Previous INTENT history kept full progression confidence.");
    return notes;
  }
  if (input.selectionMode !== "MANUAL") {
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

  const hasIntentHistory = await findLatestProgressionEligibleWorkoutExercise({
    userId: input.userId,
    workoutId: input.workoutId,
    exerciseId: input.exerciseId,
    requiredSelectionMode: "INTENT",
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
  if (currentModal != null && input.scheduledDate) {
    const recentIntent = await findLatestProgressionEligibleWorkoutExercise({
      userId: input.userId,
      workoutId: input.workoutId,
      exerciseId: input.exerciseId,
      scheduledBefore: input.scheduledDate,
      requiredSelectionMode: "INTENT",
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

async function findLatestProgressionEligibleWorkoutExercise(input: {
  userId: string;
  workoutId: string;
  exerciseId: string;
  scheduledBefore?: Date;
  requiredSelectionMode?: WorkoutSelectionMode;
}) {
  let scheduledBefore = input.scheduledBefore;

  while (true) {
    const candidate = await prisma.workoutExercise.findFirst({
      where: {
        exerciseId: input.exerciseId,
        workout: {
          userId: input.userId,
          id: { not: input.workoutId },
          status: { in: [...PERFORMED_WORKOUT_STATUSES] },
          ...(input.requiredSelectionMode
            ? { selectionMode: input.requiredSelectionMode as never }
            : {}),
          ...(scheduledBefore ? { scheduledDate: { lt: scheduledBefore } } : {}),
        },
      },
      orderBy: { workout: { scheduledDate: "desc" } },
      include: {
        workout: {
          select: {
            scheduledDate: true,
            selectionMode: true,
            sessionIntent: true,
            selectionMetadata: true,
            mesocyclePhaseSnapshot: true,
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

    if (!candidate) {
      return null;
    }
    if (
      scheduledBefore &&
      candidate.workout.scheduledDate.getTime() >= scheduledBefore.getTime()
    ) {
      return null;
    }

    if (
      isProgressionEligibleWorkout({
        selectionMetadata: candidate.workout.selectionMetadata,
        selectionMode: candidate.workout.selectionMode,
        sessionIntent: candidate.workout.sessionIntent,
        mesocyclePhase: candidate.workout.mesocyclePhaseSnapshot,
      })
    ) {
      return candidate;
    }

    scheduledBefore = candidate.workout.scheduledDate;
  }
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

async function buildNextExposureDecision(
  performedSemantics: ReturnType<typeof derivePerformedExerciseSemantics>,
  repRange: [number, number],
  equipment: string[],
  input: ExplainabilityConfidenceInput
): Promise<NextExposureDecision | null> {
  if (!performedSemantics) {
    return null;
  }

  const progressionInput = await buildExplainabilityCanonicalProgressionInput(
    performedSemantics,
    repRange,
    equipment,
    input
  );
  const decision = computeDoubleProgressionDecision(
    progressionInput.lastSets,
    progressionInput.repRange,
    progressionInput.equipment,
    progressionInput.decisionOptions
  );
  if (!decision) {
    return null;
  }

  const action: NextExposureDecision["action"] =
    decision.nextLoad > decision.anchorLoad
      ? "increase"
      : decision.nextLoad < decision.anchorLoad
      ? "decrease"
      : "hold";

  return {
    action,
    summary: getCanonicalNextExposureCopy(action).summary,
    reason: formatNextExposureReason({
      action,
      decisionPath: decision.path,
      decisionLog: decision.decisionLog,
      repRange,
      medianReps: performedSemantics.medianReps,
      modalRpe: performedSemantics.modalRpe,
      anchorLoad: decision.anchorLoad,
    }),
    anchorLoad: decision.anchorLoad,
    repRange: { min: repRange[0], max: repRange[1] },
    modalRpe: performedSemantics.modalRpe,
    medianReps: performedSemantics.medianReps,
    decisionLog: decision.decisionLog,
  };
}

async function buildExplainabilityCanonicalProgressionInput(
  performedSemantics: NonNullable<ReturnType<typeof derivePerformedExerciseSemantics>>,
  repRange: [number, number],
  equipment: string[],
  input: ExplainabilityConfidenceInput
) {
  return buildCanonicalProgressionEvaluationInput({
    lastSets: performedSemantics.signalSets,
    repRange,
    equipment: resolveProgressionEquipment(equipment),
    anchorOverride: performedSemantics.anchorLoad ?? undefined,
    historySessions: await loadExplainabilityProgressionSessions(input),
  });
}

type ExplainabilityProgressionSession = CanonicalProgressionHistorySession;

async function loadExplainabilityProgressionSessions(
  input: ExplainabilityConfidenceInput
): Promise<ExplainabilityProgressionSession[]> {
  const sessions: ExplainabilityProgressionSession[] = [
    await resolveExplainabilityProgressionSession(input),
  ];
  let scheduledBefore = input.scheduledDate;

  while (scheduledBefore) {
    const previous = await findLatestProgressionEligibleWorkoutExercise({
      userId: input.userId,
      workoutId: input.workoutId,
      exerciseId: input.exerciseId,
      scheduledBefore,
    });
    if (!previous) {
      break;
    }

    sessions.push(
      await resolveExplainabilityProgressionSession({
        userId: input.userId,
        workoutId: input.workoutId,
        exerciseId: input.exerciseId,
        selectionMode: previous.workout.selectionMode ?? undefined,
        scheduledDate: previous.workout.scheduledDate,
        performedLogs: previous.sets.map((set) => ({
          setIndex: set.setIndex,
          log: set.logs[0]
            ? {
                actualRpe: set.logs[0].actualRpe,
                actualLoad: set.logs[0].actualLoad,
              }
            : undefined,
        })),
      })
    );
    scheduledBefore = previous.workout.scheduledDate;
  }

  return sessions;
}

async function resolveExplainabilityProgressionSession(
  input: ExplainabilityConfidenceInput
): Promise<ExplainabilityProgressionSession> {
  const [confidence, confidenceNotes] = await Promise.all([
    resolveExplainabilityHistoryConfidenceScale(input),
    resolveExplainabilityConfidenceNotes(input),
  ]);
  return {
    selectionMode: input.selectionMode,
    confidence,
    confidenceNotes,
  };
}

function formatNextExposureReason(input: {
  action: NextExposureDecision["action"];
  decisionPath?: string;
  decisionLog?: string[];
  repRange: [number, number];
  medianReps: number | null;
  modalRpe: number | null;
  anchorLoad: number;
}): string {
  const repBand = `${input.repRange[0]}-${input.repRange[1]}`;
  const medianRepsLabel =
    input.medianReps != null ? Number(input.medianReps.toFixed(1)) : "n/a";
  const modalRpeLabel = input.modalRpe != null ? input.modalRpe : "n/a";

  if (input.action === "increase") {
    if (input.decisionPath === "path_5_overshoot") {
      return input.modalRpe != null && input.modalRpe > 8
        ? `You beat the written load across enough working sets to earn a one-step increase, even at modal RPE ${modalRpeLabel}.`
        : `You beat the written load at manageable effort, so ${input.anchorLoad} lbs should not stay capped next time.`;
    }
    return `Median reps reached the top of the ${repBand} band at manageable effort (modal RPE ${modalRpeLabel}) on ${input.anchorLoad} lbs.`;
  }
  if (input.action === "decrease") {
    return `Effort looked too high to keep ${input.anchorLoad} lbs moving productively next time.`;
  }
  const overshootGateMessage = input.decisionLog
    ?.slice()
    .reverse()
    .find((entry) => entry.startsWith("Overshoot gate:"));
  if (overshootGateMessage) {
    return overshootGateMessage.replace(/^Overshoot gate:\s*/, "");
  }
  if (input.modalRpe != null && input.modalRpe >= 9) {
    return `Effort was already high at modal RPE ${modalRpeLabel}, so ${input.anchorLoad} lbs should hold.`;
  }
  return `Median reps stayed at ${medianRepsLabel} in the ${repBand} band, so keep building reps before adding load.`;
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
      (s) => !classifySetLog(s.logs[0]).isSkipped
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
