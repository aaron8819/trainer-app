import { prisma } from "@/lib/db/prisma";
import type {
  WorkoutExplanation,
  FilteredExerciseSummary,
  MuscleVolumeCompliance,
  VolumeComplianceStatus,
} from "@/lib/engine/explainability";
import { VOLUME_LANDMARKS, computeWeeklyVolumeTarget } from "@/lib/engine/volume-landmarks";
import {
  explainSessionContext,
  explainExerciseRationale,
  explainPrescriptionRationale,
  generateCoachMessages,
} from "@/lib/engine/explainability";
import type { Exercise as EngineExercise, PrimaryGoal } from "@/lib/engine/types";
import type { SelectionObjective, SelectionCandidate } from "@/lib/engine/selection-v2/types";
import { loadCurrentBlockContext } from "./periodization";
import { getRestSeconds } from "@/lib/engine/prescription";
import { CHECK_IN_STALENESS_WINDOW_MS } from "./checkin-staleness";
import { mapExercises } from "./workout-context";
import { getPeriodizationModifiers } from "@/lib/engine/rules";
import type { Prisma, Workout, WorkoutExercise, WorkoutSet } from "@prisma/client";
import { PERFORMED_WORKOUT_STATUSES } from "@/lib/workout-status";
import type {
  CycleContextSnapshot,
  DeloadDecision,
  ProgressionReceipt,
  ProgressionSetSummary,
} from "@/lib/evidence/types";
import {
  computeMusclesApproachingMRV,
  computeVolumeSpikePercent,
  hasPRPotential,
  SECONDARY_VOLUME_MULTIPLIER,
} from "./explainability/stats";
import { computeDoubleProgressionDecision } from "@/lib/engine/progression";

type WorkoutWithExplainabilityRelations = Prisma.WorkoutGetPayload<{
  include: {
    filteredExercises: true;
    exercises: {
      include: {
        exercise: {
          include: {
            exerciseEquipment: { include: { equipment: true } };
            exerciseMuscles: { include: { muscle: true } };
          };
        };
        sets: {
          include: {
            logs: { orderBy: { completedAt: "desc" }, take: 1 };
          };
        };
      };
    };
  };
}>;

const HISTORY_RECENCY_WINDOW_DAYS = 42;

export async function generateWorkoutExplanation(
  workoutId: string
): Promise<WorkoutExplanation | { error: string }> {
  const workout: WorkoutWithExplainabilityRelations | null = await prisma.workout.findUnique({
    where: { id: workoutId },
    include: {
      filteredExercises: true,
      exercises: {
        include: {
          exercise: {
            include: {
              exerciseEquipment: { include: { equipment: true } },
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
  });

  if (!workout) {
    return { error: "Workout not found" };
  }

  const { blockContext, weekInMeso } = await loadCurrentBlockContext(
    workout.userId,
    workout.scheduledDate
  );
  const volumeByMuscle = await loadVolumeByMuscle(workout.userId, workout.scheduledDate);

  const readinessSignals = await prisma.readinessSignal.findMany({
    where: { userId: workout.userId },
    orderBy: { timestamp: "desc" },
    take: 1,
    select: {
      timestamp: true,
      subjectiveReadiness: true,
    },
  });
  const latestReadiness = readinessSignals[0];
  const latestReadinessAgeDays = latestReadiness
    ? Math.floor(
        (workout.scheduledDate.getTime() - new Date(latestReadiness.timestamp).getTime()) /
          (24 * 60 * 60 * 1000)
      )
    : undefined;
  const latestReadinessAgeMs = latestReadiness
    ? workout.scheduledDate.getTime() - new Date(latestReadiness.timestamp).getTime()
    : undefined;
  const hasRecentReadinessSignal = Boolean(
    latestReadinessAgeMs != null && latestReadinessAgeMs <= CHECK_IN_STALENESS_WINDOW_MS
  );
  const cycleContext = parseCycleContext(workout.selectionMetadata);

  const sessionContext = explainSessionContext({
    blockContext,
    cycleContext,
    volumeByMuscle,
    fatigueScore: undefined,
    modifications: undefined,
    signalAge: latestReadinessAgeDays,
    hasRecentReadinessSignal,
    sessionIntent: workout.sessionIntent?.toLowerCase() as "push" | "pull" | "legs" | undefined,
  });

  const exerciseLibrary = await prisma.exercise.findMany({
    include: {
      exerciseEquipment: { include: { equipment: true } },
      exerciseMuscles: { include: { muscle: true } },
    },
  });
  const mappedExercises = mapExercises(exerciseLibrary);

  const workoutStats = await deriveWorkoutStats(workout, volumeByMuscle);
  const coachMessages = generateCoachMessages({
    sessionContext,
    blockContext,
    workoutStats,
  });

  const exerciseRationales = new Map();
  const selectionObjective = buildSelectionObjective();
  const storedRationaleByExerciseId = parseStoredRationale(workout.selectionMetadata);
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
  const deloadDecision = resolveDeloadDecision(workout.selectionMetadata, workout.autoregulationLog);
  const readinessScaledExerciseIds = resolveReadinessScaledExercises(workout.autoregulationLog);

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
      periodization: blockContext
        ? getPeriodizationModifiers(
            blockContext.weekInBlock,
            blockContext.macroCycle.primaryGoal === "general_fitness"
              ? "hypertrophy"
              : blockContext.macroCycle.primaryGoal,
            blockContext.macroCycle.trainingAge
          )
        : undefined,
      blockType: blockContext?.block.blockType,
      weekInMesocycle: weekInMeso,
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
    const isReadinessScaled = readinessScaledExerciseIds.has(workoutExercise.exerciseId);
    progressionReceipts.set(
      workoutExercise.exerciseId,
      buildProgressionReceipt(lastPerformed, todayPrescription, deloadDecision, isReadinessScaled)
    );
  }

  const filteredExercises: FilteredExerciseSummary[] = (workout.filteredExercises ?? []).map((fe) => ({
    exerciseId: fe.exerciseId ?? fe.id,
    exerciseName: fe.exerciseName,
    reason: fe.reason,
    userFriendlyMessage: fe.userFriendlyMessage,
  }));

  const confidence = deriveExplainabilityConfidence({
    hasReadinessSignal: hasRecentReadinessSignal,
    hasBlockContext: Boolean(blockContext),
    hasStoredSelectionRationale: hasStoredRationale,
    hasDerivedWorkoutStats:
      workoutStats.volumeSpikePercent !== undefined ||
      workoutStats.hasPRPotential !== undefined ||
      (workoutStats.musclesApproachingMRV?.length ?? 0) > 0,
  });

  const volumeCompliance = await computeVolumeCompliance(workout);

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

function deriveExplainabilityConfidence(input: {
  hasReadinessSignal: boolean;
  hasBlockContext: boolean;
  hasStoredSelectionRationale: boolean;
  hasDerivedWorkoutStats: boolean;
}): WorkoutExplanation["confidence"] {
  const missingSignals: string[] = [];
  if (!input.hasReadinessSignal) {
    missingSignals.push("fresh readiness signal");
  }
  if (!input.hasBlockContext) {
    missingSignals.push("active block context");
  }
  if (!input.hasStoredSelectionRationale) {
    missingSignals.push("persisted selection rationale");
  }
  if (!input.hasDerivedWorkoutStats) {
    missingSignals.push("history-derived workout stats");
  }

  const level: WorkoutExplanation["confidence"]["level"] =
    missingSignals.length === 0 ? "high" : missingSignals.length === 1 ? "medium" : "low";
  const summary =
    level === "high"
      ? "Explanations are grounded in full session context."
      : level === "medium"
      ? "Explanations are mostly grounded in context with minor approximations."
      : "Explanations include approximations due to missing context signals.";

  return { level, summary, missingSignals };
}

async function loadVolumeByMuscle(userId: string, currentDate: Date): Promise<Map<string, number>> {
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
      for (const em of exercise.exercise.exerciseMuscles) {
        if (em.role === "PRIMARY") {
          const current = volumeByMuscle.get(em.muscle.name) ?? 0;
          volumeByMuscle.set(em.muscle.name, current + setCount);
        } else if (em.role === "SECONDARY") {
          const current = volumeByMuscle.get(em.muscle.name) ?? 0;
          volumeByMuscle.set(em.muscle.name, current + setCount * SECONDARY_VOLUME_MULTIPLIER);
        }
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
  weeklyVolumeByMuscle: Map<string, number>
): Promise<{
  totalSets: number;
  hasPRPotential?: boolean;
  volumeSpikePercent?: number;
  musclesApproachingMRV?: string[];
}> {
  const totalSets = workout.exercises.reduce((sum, ex) => sum + countLoggedPerformedSets(ex.sets), 0);
  const currentWorkoutEffectiveSets = computeWorkoutEffectiveSets(workout.exercises);
  const baselineEffectiveSets = await loadHistoricalEffectiveSetTotals(
    workout.userId,
    workout.scheduledDate,
    workout.id,
    workout.sessionIntent ?? undefined
  );
  const volumeSpikePercent = computeVolumeSpikePercent(currentWorkoutEffectiveSets, baselineEffectiveSets);

  const weeklyWithCurrent = new Map(weeklyVolumeByMuscle);
  for (const [muscle, sets] of computeWorkoutEffectiveSetsByMuscle(workout.exercises).entries()) {
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
  >
): number {
  let total = 0;
  for (const exercise of exercises) {
    const setCount = countLoggedPerformedSets(exercise.sets);
    if (setCount === 0) {
      continue;
    }
    for (const mapping of exercise.exercise.exerciseMuscles) {
      if (mapping.role === "PRIMARY") {
        total += setCount;
      } else if (mapping.role === "SECONDARY") {
        total += setCount * SECONDARY_VOLUME_MULTIPLIER;
      }
    }
  }
  return total;
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
  >
): Map<string, number> {
  const output = new Map<string, number>();
  for (const exercise of exercises) {
    const setCount = countLoggedPerformedSets(exercise.sets);
    if (setCount === 0) {
      continue;
    }
    for (const mapping of exercise.exercise.exerciseMuscles) {
      const current = output.get(mapping.muscle.name) ?? 0;
      if (mapping.role === "PRIMARY") {
        output.set(mapping.muscle.name, current + setCount);
      } else if (mapping.role === "SECONDARY") {
        output.set(mapping.muscle.name, current + setCount * SECONDARY_VOLUME_MULTIPLIER);
      }
    }
  }
  return output;
}

async function loadHistoricalEffectiveSetTotals(
  userId: string,
  currentDate: Date,
  excludeWorkoutId: string,
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
    return loadHistoricalEffectiveSetTotals(userId, currentDate, excludeWorkoutId);
  }

  return workouts.map((entry) => computeWorkoutEffectiveSets(entry.exercises));
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
  components?: Record<string, number>;
  hardFilterPass?: boolean;
  selectedStep?: string;
  reason?: string;
};

function parseStoredRationale(
  metadata: Prisma.JsonValue | null | undefined
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
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      continue;
    }
    const entry = value as Record<string, unknown>;
    if (typeof entry.score !== "number") {
      continue;
    }
    output[exerciseId] = {
      score: entry.score,
      components:
        entry.components && typeof entry.components === "object" && !Array.isArray(entry.components)
          ? (entry.components as Record<string, number>)
          : undefined,
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

  const volumeContribution = new Map<
    string,
    {
      direct: number;
      indirect: number;
    }
  >();

  for (const em of workoutExercise.exercise.exerciseMuscles) {
    const performedSetCount = countLoggedPerformedSets(workoutExercise.sets);
    const setCount = performedSetCount > 0 ? performedSetCount : workoutExercise.sets?.length ?? 3;
    if (em.role === "PRIMARY") {
      volumeContribution.set(em.muscle.name, {
        direct: setCount,
        indirect: 0,
      });
    } else if (em.role === "SECONDARY") {
      const existing = volumeContribution.get(em.muscle.name) ?? { direct: 0, indirect: 0 };
      volumeContribution.set(em.muscle.name, {
        direct: existing.direct,
        indirect: existing.indirect + setCount * SECONDARY_VOLUME_MULTIPLIER,
      });
    }
  }

  const performedSetCount = countLoggedPerformedSets(workoutExercise.sets);
  const setCount = performedSetCount > 0 ? performedSetCount : workoutExercise.sets?.length ?? 3;
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
    deficitFill: components.deficitFill ?? components.volumeDeficitFill ?? fallback.deficitFill,
    rotationNovelty: components.rotationNovelty ?? fallback.rotationNovelty,
    sfrScore: components.sfrScore ?? components.sfrEfficiency ?? fallback.sfrScore,
    lengthenedScore: components.lengthenedScore ?? components.lengthenedBias ?? fallback.lengthenedScore,
    movementNovelty: components.movementNovelty ?? components.movementDiversity ?? fallback.movementNovelty,
    sraAlignment: components.sraAlignment ?? components.sraReadiness ?? fallback.sraAlignment,
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

function resolveDeloadDecision(
  selectionMetadata: Prisma.JsonValue | null | undefined,
  autoregulationLog: Prisma.JsonValue | null | undefined
): DeloadDecision | null {
  const fromSelection = extractDeloadDecisionFromJson(selectionMetadata);
  if (fromSelection) return fromSelection;
  const fromAutoreg = extractDeloadDecisionFromJson(autoregulationLog);
  return fromAutoreg ?? null;
}

function parseCycleContext(selectionMetadata: Prisma.JsonValue | null | undefined): CycleContextSnapshot | undefined {
  if (!selectionMetadata || typeof selectionMetadata !== "object" || Array.isArray(selectionMetadata)) {
    return undefined;
  }
  const root = selectionMetadata as Record<string, unknown>;
  const raw = root.cycleContext;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return undefined;
  }
  const value = raw as Record<string, unknown>;
  if (
    typeof value.weekInMeso !== "number" ||
    typeof value.weekInBlock !== "number" ||
    typeof value.phase !== "string" ||
    typeof value.blockType !== "string" ||
    typeof value.isDeload !== "boolean" ||
    (value.source !== "computed" && value.source !== "fallback")
  ) {
    return undefined;
  }

  return value as CycleContextSnapshot;
}

function extractDeloadDecisionFromJson(value: Prisma.JsonValue | null | undefined): DeloadDecision | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const root = value as Record<string, unknown>;
  const raw = root.deloadDecision;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }

  const entry = raw as Record<string, unknown>;
  if (
    typeof entry.mode !== "string" ||
    !Array.isArray(entry.reason) ||
    typeof entry.reductionPercent !== "number" ||
    typeof entry.appliedTo !== "string"
  ) {
    return null;
  }

  return {
    mode: entry.mode as DeloadDecision["mode"],
    reason: entry.reason.filter((item): item is string => typeof item === "string"),
    reductionPercent: entry.reductionPercent,
    appliedTo: entry.appliedTo as DeloadDecision["appliedTo"],
  };
}

function resolveReadinessScaledExercises(
  autoregulationLog: Prisma.JsonValue | null | undefined
): Set<string> {
  if (!autoregulationLog || typeof autoregulationLog !== "object" || Array.isArray(autoregulationLog)) {
    return new Set<string>();
  }
  const root = autoregulationLog as Record<string, unknown>;
  const modsRaw = root.modifications;
  if (!Array.isArray(modsRaw)) {
    return new Set<string>();
  }

  const ids = new Set<string>();
  for (const mod of modsRaw) {
    if (!mod || typeof mod !== "object" || Array.isArray(mod)) continue;
    const record = mod as Record<string, unknown>;
    const exerciseId = record.exerciseId;
    const type = record.type;
    if (typeof exerciseId === "string" && typeof type === "string" && type === "intensity_scale") {
      ids.add(exerciseId);
    }
  }
  return ids;
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
    notes.push("INTENT session confidence=1.00.");
    return notes;
  }
  if (input.previousSelectionMode !== "MANUAL") {
    notes.push("Non-INTENT session confidence=0.80.");
    return notes;
  }

  const anomalyFlags = await resolveManualAnomalyFlags(input);
  if (anomalyFlags.length > 0) {
    notes.push(
      `MANUAL anomaly flag(s): ${anomalyFlags.join(", ")}. Confidence reduced to 0.30.`
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
      ? "MANUAL session discounted (confidence=0.70) because INTENT history exists."
      : "MANUAL-only history detected; confidence held at 1.00."
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
    anomalyFlags.push("uniform_rpe_synthetic");
  }

  const rpeTenCount = rpes.filter((rpe) => rpe === 10).length;
  if (rpes.length > 0 && rpeTenCount / rpes.length > 0.5) {
    anomalyFlags.push("rpe10_majority");
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
        anomalyFlags.push("load_regression_vs_intent");
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
  workout: WorkoutWithExplainabilityRelations
): Promise<MuscleVolumeCompliance[]> {
  if (!workout.mesocycleId || workout.mesocycleWeekSnapshot == null) {
    return [];
  }

  const mesocycleId = workout.mesocycleId;
  const mesocycleWeekSnapshot = workout.mesocycleWeekSnapshot;

  const meso = await prisma.mesocycle.findUnique({
    where: { id: mesocycleId },
    select: { durationWeeks: true, state: true },
  });
  if (!meso) return [];

  const isDeload = meso.state === "ACTIVE_DELOAD";
  const mesoLength = meso.durationWeeks;

  // Query prior performed workouts in the same mesocycle week, excluding this workout
  const priorWorkouts = await prisma.workout.findMany({
    where: {
      mesocycleId,
      mesocycleWeekSnapshot,
      status: { in: [...PERFORMED_WORKOUT_STATUSES] },
      id: { not: workout.id },
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
  });

  // Count performed direct sets per primary muscle from prior sessions
  const setsLoggedBefore = new Map<string, number>();
  for (const priorWorkout of priorWorkouts) {
    for (const we of priorWorkout.exercises) {
      const performedSets = we.sets.filter((s) => {
        const latest = s.logs[0];
        return Boolean(latest) && !latest?.wasSkipped;
      }).length;
      if (performedSets === 0) continue;
      for (const em of we.exercise.exerciseMuscles) {
        if (em.role === "PRIMARY") {
          const muscle = em.muscle.name;
          setsLoggedBefore.set(muscle, (setsLoggedBefore.get(muscle) ?? 0) + performedSets);
        }
      }
    }
  }

  // Count prescribed direct sets per primary muscle for this session
  // (sets that are not explicitly skipped via a log)
  const setsPrescribed = new Map<string, number>();
  for (const we of workout.exercises) {
    const prescribedSets = we.sets.filter(
      (s) => !s.logs[0]?.wasSkipped
    ).length;
    if (prescribedSets === 0) continue;
    for (const em of we.exercise.exerciseMuscles) {
      if (em.role === "PRIMARY") {
        const muscle = em.muscle.name;
        setsPrescribed.set(muscle, (setsPrescribed.get(muscle) ?? 0) + prescribedSets);
      }
    }
  }

  // Build compliance rows for muscles with prescribed sets in this session
  const compliance: MuscleVolumeCompliance[] = [];
  for (const [muscle, prescribed] of setsPrescribed.entries()) {
    const landmarks = VOLUME_LANDMARKS[muscle];
    if (!landmarks) continue;

    const before = setsLoggedBefore.get(muscle) ?? 0;
    const projected = before + prescribed;
    const weeklyTarget = computeWeeklyVolumeTarget(
      landmarks,
      mesocycleWeekSnapshot,
      mesoLength,
      isDeload
    );

    compliance.push({
      muscle,
      setsLoggedBeforeSession: before,
      setsPrescribedThisSession: prescribed,
      projectedTotal: projected,
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
