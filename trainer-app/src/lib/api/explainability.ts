/**
 * Explainability API - Orchestration Layer
 *
 * Phase 4.5: Load workout from DB and generate complete explanation
 *
 * Responsibilities:
 * - Load workout + all context (block, volume, readiness, selection metadata)
 * - Map DB types to engine types
 * - Call explainability functions (session context, exercise rationale, prescription rationale, coach messages)
 * - Return complete WorkoutExplanation
 */

import { prisma } from "@/lib/db/prisma";
import type { WorkoutExplanation, CoachMessage } from "@/lib/engine/explainability";
import {
  explainSessionContext,
  explainExerciseRationale,
  explainPrescriptionRationale,
  generateCoachMessages,
} from "@/lib/engine/explainability";
import type { Exercise as EngineExercise } from "@/lib/engine/types";
import type { SelectionObjective, SelectionCandidate } from "@/lib/engine/selection-v2/types";
import { loadCurrentBlockContext } from "./periodization";
import { mapLatestCheckIn } from "./checkin-staleness";
import { mapExercises } from "./workout-context";
import { getPeriodizationModifiers } from "@/lib/engine/rules";
import type { Workout, WorkoutExercise } from "@prisma/client";

/**
 * Generate complete workout explanation
 *
 * Loads workout from DB, derives context, and generates:
 * - Session context (block phase, volume, readiness)
 * - Coach messages (warnings, encouragement, milestones, tips)
 * - Per-exercise rationale (selection factors, KB citations, alternatives)
 * - Per-exercise prescription rationale (sets/reps/load/RIR/rest)
 *
 * @param workoutId - Workout ID
 * @returns WorkoutExplanation with all rationale data
 */
export async function generateWorkoutExplanation(
  workoutId: string
): Promise<WorkoutExplanation | { error: string }> {
  // 1. Load workout with relations
  const workout = await prisma.workout.findUnique({
    where: { id: workoutId },
    include: {
      programBlock: true,
      exercises: {
        include: {
          exercise: {
            include: {
              exerciseEquipment: {
                include: {
                  equipment: true,
                },
              },
              exerciseMuscles: {
                include: {
                  muscle: true,
                },
              },
            },
          },
          sets: true,
        },
      },
    },
  });

  if (!workout) {
    return { error: "Workout not found" };
  }

  // 2. Load block context
  const blockContext = await loadCurrentBlockContext(workout.userId, workout.scheduledDate);

  // 3. Load volume by muscle group (from weekly history)
  const volumeByMuscle = await loadVolumeByMuscle(workout.userId, workout.scheduledDate);

  // 4. Load latest check-in (readiness)
  const checkIns = await prisma.sessionCheckIn.findMany({
    where: { userId: workout.userId },
    orderBy: { createdAt: "desc" },
    take: 1,
  });

  const readiness = mapLatestCheckIn(
    checkIns.map((c) => ({
      date: c.date,
      readiness: c.readiness,
      painFlags: c.painFlags,
      notes: c.notes,
    })),
    workout.scheduledDate
  );

  // 5. Generate session context
  const sessionContext = explainSessionContext({
    blockContext,
    volumeByMuscle,
    fatigueScore: undefined, // TODO Phase 4.6: Integrate autoregulation fatigue score
    modifications: undefined,
    signalAge: readiness
      ? Math.floor((workout.scheduledDate.getTime() - new Date(readiness.date).getTime()) / (24 * 60 * 60 * 1000))
      : undefined,
  });

  // 6. Load exercise library (for alternatives)
  const exerciseLibrary = await prisma.exercise.findMany({
    include: {
      exerciseEquipment: {
        include: {
          equipment: true,
        },
      },
      exerciseMuscles: {
        include: {
          muscle: true,
        },
      },
    },
  });

  const mappedExercises = mapExercises(exerciseLibrary);

  // 7. Generate coach messages
  const workoutStats = deriveWorkoutStats(workout);
  const coachMessages = generateCoachMessages({
    sessionContext,
    blockContext,
    workoutStats,
  });

  // 8. Generate exercise rationales
  const exerciseRationales = new Map();
  const selectionObjective = buildSelectionObjective(workout);

  for (const workoutExercise of workout.exercises) {
    const candidate = buildSelectionCandidate(workoutExercise, mappedExercises);
    if (candidate) {
      const rationale = explainExerciseRationale(candidate, selectionObjective, mappedExercises);
      exerciseRationales.set(workoutExercise.exerciseId, rationale);
    }
  }

  // 9. Generate prescription rationales
  const prescriptionRationales = new Map();

  for (const workoutExercise of workout.exercises) {
    const exercise = mappedExercises.find((e) => e.id === workoutExercise.exerciseId);
    if (!exercise) continue;

    // Map DB sets to engine WorkoutSet type
    const engineSets = workoutExercise.sets.map((dbSet) => ({
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
        primary: (blockContext?.macroCycle.primaryGoal ?? "hypertrophy") as any,
        secondary: "none",
      },
      profile: {
        trainingAge: blockContext?.macroCycle.trainingAge ?? "intermediate",
      },
      periodization: blockContext
        ? getPeriodizationModifiers(
            blockContext.weekInBlock,
            (blockContext.macroCycle.primaryGoal === "general_fitness"
              ? "hypertrophy"
              : blockContext.macroCycle.primaryGoal) as any,
            blockContext.macroCycle.trainingAge
          )
        : undefined,
      weekInMesocycle: blockContext?.weekInMeso,
      restSeconds: engineSets[0]?.restSeconds,
      exerciseRepRange:
        exercise.repRangeMin && exercise.repRangeMax
          ? { min: exercise.repRangeMin, max: exercise.repRangeMax }
          : undefined,
    });

    prescriptionRationales.set(workoutExercise.exerciseId, rationale);
  }

  // 10. Return complete explanation
  return {
    sessionContext,
    coachMessages,
    exerciseRationales,
    prescriptionRationales,
  };
}

/**
 * Load weekly volume by muscle group
 *
 * Counts total sets per muscle in the last 7 days
 *
 * @param userId - User ID
 * @param currentDate - Current date (for 7-day lookback)
 * @returns Map of muscle name -> set count
 */
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
      status: "COMPLETED",
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
          sets: true,
        },
      },
    },
  });

  const volumeByMuscle = new Map<string, number>();

  for (const workout of recentWorkouts) {
    for (const exercise of workout.exercises) {
      const setCount = exercise.sets.length;
      for (const em of exercise.exercise.exerciseMuscles) {
        if (em.role === "PRIMARY") {
          const current = volumeByMuscle.get(em.muscle.name) ?? 0;
          volumeByMuscle.set(em.muscle.name, current + setCount);
        } else if (em.role === "SECONDARY") {
          const current = volumeByMuscle.get(em.muscle.name) ?? 0;
          // Secondary muscles count as 0.3x volume (indirect stimulus)
          volumeByMuscle.set(em.muscle.name, current + setCount * 0.3);
        }
      }
    }
  }

  return volumeByMuscle;
}

/**
 * Derive workout statistics for coach messages
 *
 * @param workout - Workout with exercises and sets
 * @returns Workout stats (total sets, volume spike, muscles approaching MRV, PR potential)
 */
function deriveWorkoutStats(
  workout: Workout & {
    exercises: Array<
      WorkoutExercise & {
        sets: any[];
      }
    >;
  }
): {
  totalSets: number;
  hasPRPotential?: boolean;
  volumeSpikePercent?: number;
  musclesApproachingMRV?: string[];
} {
  const totalSets = workout.exercises.reduce((sum, ex) => sum + (ex.sets?.length ?? 0), 0);

  // TODO Phase 4.6: Derive volumeSpikePercent, musclesApproachingMRV, hasPRPotential from DB history
  // For now, return minimal stats
  return {
    totalSets,
  };
}

/**
 * Build SelectionObjective from workout metadata
 *
 * Creates a minimal SelectionObjective for explainability context
 * (Actual selection has already been done, this is just for rationale generation)
 *
 * @param workout - Workout record
 * @returns Minimal SelectionObjective for rationale generation
 */
function buildSelectionObjective(workout: Workout): SelectionObjective {
  return {
    constraints: {
      volumeFloor: new Map(),
      volumeCeiling: new Map(),
      timeBudget: 60,
      equipment: new Set(),
      // Phase 2: Required specific constraint sets (ADR-063)
      painConflicts: new Set(),
      userAvoids: new Set(),
      equipmentUnavailable: new Set(),
      // Backward compatibility: deprecated contraindications field
      contraindications: new Set(),
      minExercises: 1,
      maxExercises: 10,
    },
    weights: {
      volumeDeficitFill: 0.4,
      rotationNovelty: 0.25,
      sfrEfficiency: 0.15,
      lengthenedBias: 0.1,
      movementDiversity: 0.05,
      sraReadiness: 0.025,
      userPreference: 0.025,
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

/**
 * Build SelectionCandidate from WorkoutExercise
 *
 * Maps DB exercise to engine SelectionCandidate with dummy scores
 * (Real selection scores are not persisted in DB, so we approximate)
 *
 * @param workoutExercise - Workout exercise record
 * @param exerciseLibrary - Full exercise library
 * @returns SelectionCandidate or null if exercise not found
 */
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
    sets: { id: string }[];
  },
  exerciseLibrary: EngineExercise[]
): SelectionCandidate | null {
  const exercise = exerciseLibrary.find((e) => e.id === workoutExercise.exerciseId);
  if (!exercise) return null;

  // Build volume contribution map
  const volumeContribution = new Map<
    string,
    {
      direct: number;
      indirect: number;
    }
  >();

  for (const em of workoutExercise.exercise.exerciseMuscles) {
    const setCount = workoutExercise.sets?.length ?? 3;
    if (em.role === "PRIMARY") {
      volumeContribution.set(em.muscle.name, {
        direct: setCount,
        indirect: 0,
      });
    } else if (em.role === "SECONDARY") {
      const existing = volumeContribution.get(em.muscle.name) ?? { direct: 0, indirect: 0 };
      volumeContribution.set(em.muscle.name, {
        direct: existing.direct,
        indirect: existing.indirect + setCount * 0.3,
      });
    }
  }

  // Approximate selection scores (actual scores are computed during generation, not persisted)
  const scores = {
    deficitFill: 0.8,
    rotationNovelty: 0.7,
    sfrScore: (exercise.sfrScore ?? 3) / 5,
    lengthenedScore: (exercise.lengthPositionScore ?? 3) / 5,
    movementNovelty: 0.6,
    sraAlignment: 0.8,
    userPreference: 0.5,
  };

  return {
    exercise,
    proposedSets: workoutExercise.sets?.length ?? 3,
    volumeContribution,
    timeContribution: ((exercise.timePerSetSec ?? 90) * (workoutExercise.sets?.length ?? 3)) / 60,
    scores,
    totalScore: 0.7,
  };
}
