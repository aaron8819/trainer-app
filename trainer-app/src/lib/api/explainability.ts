import { prisma } from "@/lib/db/prisma";
import type { WorkoutExplanation, FilteredExerciseSummary } from "@/lib/engine/explainability";
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
import { mapLatestCheckIn } from "./checkin-staleness";
import { mapExercises } from "./workout-context";
import { getPeriodizationModifiers } from "@/lib/engine/rules";
import type { Prisma, Workout, WorkoutExercise, WorkoutSet } from "@prisma/client";
import { PERFORMED_WORKOUT_STATUSES } from "@/lib/workout-status";
import {
  computeMusclesApproachingMRV,
  computeVolumeSpikePercent,
  hasPRPotential,
  SECONDARY_VOLUME_MULTIPLIER,
} from "./explainability/stats";

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
      subjectiveSoreness: true,
    },
  });
  const readiness = mapLatestCheckIn(
    readinessSignals.map((signal) => ({
      date: signal.timestamp,
      readiness: signal.subjectiveReadiness,
      painFlags: signal.subjectiveSoreness,
      notes: null,
    })),
    workout.scheduledDate
  );

  const sessionContext = explainSessionContext({
    blockContext,
    volumeByMuscle,
    fatigueScore: undefined,
    modifications: undefined,
    signalAge: readiness
      ? Math.floor((workout.scheduledDate.getTime() - new Date(readiness.date).getTime()) / (24 * 60 * 60 * 1000))
      : undefined,
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
  }

  const filteredExercises: FilteredExerciseSummary[] = (workout.filteredExercises ?? []).map((fe) => ({
    exerciseId: fe.exerciseId ?? fe.id,
    exerciseName: fe.exerciseName,
    reason: fe.reason,
    userFriendlyMessage: fe.userFriendlyMessage,
  }));

  const confidence = deriveExplainabilityConfidence({
    hasReadinessSignal: Boolean(readiness),
    hasBlockContext: Boolean(blockContext),
    hasStoredSelectionRationale: hasStoredRationale,
    hasDerivedWorkoutStats:
      workoutStats.volumeSpikePercent !== undefined ||
      workoutStats.hasPRPotential !== undefined ||
      (workoutStats.musclesApproachingMRV?.length ?? 0) > 0,
  });

  return {
    confidence,
    sessionContext,
    coachMessages,
    exerciseRationales,
    prescriptionRationales,
    filteredExercises,
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
  sets: Array<WorkoutSet & { logs: { wasSkipped: boolean }[] }>
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
