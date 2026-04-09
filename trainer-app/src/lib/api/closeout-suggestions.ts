import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { normalizeExposedMuscle } from "@/lib/engine/volume-landmarks";
import type { PrimaryGoal, TrainingAge } from "@/lib/engine/types";
import { buildRuntimeAddedExercisePreview } from "./runtime-added-exercise-preview";
import { loadProjectedWeekVolumeReport } from "./projected-week-volume";
import { loadMesocycleWeekMuscleVolume } from "./weekly-volume";
import type { BonusSuggestion } from "./bonus-suggestions";

const MIN_DEFICIT = 2.0;
const HIGH_PRIORITY = 3.5;
const MAX_SETS = 8;
const MAX_EXERCISES = 4;
const MAX_SETS_PER_MUSCLE = 4;
const DEFAULT_SETS = 2;
const RECENT_EXPOSURE_HOURS = 48;
const MAX_FATIGUE_COST = 3;

type CloseoutWorkout = Prisma.WorkoutGetPayload<{
  select: {
    id: true;
    selectionMetadata: true;
    mesocycleId: true;
    mesocycleWeekSnapshot: true;
    exercises: {
      orderBy: [{ orderIndex: "asc" }, { id: "asc" }];
      select: {
        id: true;
        orderIndex: true;
        section: true;
        exerciseId: true;
        exercise: {
          select: {
            id: true;
            name: true;
            exerciseMuscles: {
              select: {
                role: true;
                muscle: {
                  select: {
                    name: true;
                  };
                };
              };
            };
          };
        };
        sets: {
          orderBy: [{ setIndex: "asc" }, { id: "asc" }];
          select: {
            targetReps: true;
            targetRepMin: true;
            targetRepMax: true;
            targetRpe: true;
            restSeconds: true;
          };
        };
      };
    };
    mesocycle: {
      select: {
        id: true;
        startWeek: true;
        durationWeeks: true;
        sessionsPerWeek: true;
        macroCycle: {
          select: {
            startDate: true;
          };
        };
      };
    };
  };
}>;

type CandidateExercise = Prisma.ExerciseGetPayload<{
  include: {
    exerciseEquipment: {
      include: {
        equipment: true;
      };
    };
    exerciseMuscles: {
      include: {
        muscle: true;
      };
    };
  };
}>;

type RankedDeficit = {
  muscle: string;
  actual: number;
  projected: number;
  target: number;
  mev: number;
  deficit: number;
  priorityTier: 0 | 1;
};

function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

function computeMesoWeekStartDate(
  macroStartDate: Date,
  mesocycleStartWeek: number,
  targetWeek: number
): Date {
  const date = new Date(macroStartDate);
  date.setDate(date.getDate() + (mesocycleStartWeek + targetWeek - 1) * 7);
  return date;
}

function toPrimaryMuscles(
  exerciseMuscles: Array<{ role: string; muscle: { name: string } }>
): string[] {
  return Array.from(
    new Set(
      exerciseMuscles
        .filter((mapping) => mapping.role === "PRIMARY")
        .map((mapping) => normalizeExposedMuscle(mapping.muscle.name))
    )
  ).sort((left, right) => left.localeCompare(right));
}

function buildCurrentWorkoutCoverage(workout: CloseoutWorkout): {
  exerciseCount: number;
  setCount: number;
  coveredMuscles: Set<string>;
  setsByMuscle: Map<string, number>;
  exerciseIds: Set<string>;
  exerciseNames: Set<string>;
} {
  const coveredMuscles = new Set<string>();
  const setsByMuscle = new Map<string, number>();
  const exerciseIds = new Set<string>();
  const exerciseNames = new Set<string>();
  let setCount = 0;

  for (const exercise of workout.exercises) {
    exerciseIds.add(exercise.exerciseId);
    exerciseNames.add(exercise.exercise.name);
    setCount += exercise.sets.length;

    for (const muscle of toPrimaryMuscles(exercise.exercise.exerciseMuscles)) {
      coveredMuscles.add(muscle);
      setsByMuscle.set(
        muscle,
        Math.min(MAX_SETS_PER_MUSCLE, (setsByMuscle.get(muscle) ?? 0) + exercise.sets.length)
      );
    }
  }

  return {
    exerciseCount: workout.exercises.length,
    setCount,
    coveredMuscles,
    setsByMuscle,
    exerciseIds,
    exerciseNames,
  };
}

function buildRankedDeficits(input: {
  projectedRows: Awaited<ReturnType<typeof loadProjectedWeekVolumeReport>>["fullWeekByMuscle"];
  actualByMuscle: Record<string, { effectiveSets: number }>;
  coveredMuscles: Set<string>;
}): RankedDeficit[] {
  return input.projectedRows
    .map((row) => {
      const actual = roundToTenth(input.actualByMuscle[row.muscle]?.effectiveSets ?? 0);
      const projected = roundToTenth(row.projectedFullWeekEffectiveSets);
      const target = roundToTenth(row.weeklyTarget);
      const deficit = roundToTenth(Math.max(0, target - projected));

      return {
        muscle: row.muscle,
        actual,
        projected,
        target,
        mev: row.mev,
        deficit,
        priorityTier: deficit >= HIGH_PRIORITY ? 0 : 1,
      } satisfies RankedDeficit;
    })
    .filter(
      (row) => row.deficit >= MIN_DEFICIT && !input.coveredMuscles.has(row.muscle)
    )
    .sort((left, right) => {
      if (left.priorityTier !== right.priorityTier) {
        return left.priorityTier - right.priorityTier;
      }
      if (right.deficit !== left.deficit) {
        return right.deficit - left.deficit;
      }
      return left.muscle.localeCompare(right.muscle);
    });
}

function expandCandidateMuscles(muscles: string[]): string[] {
  const expanded = new Set<string>();
  for (const muscle of muscles) {
    expanded.add(muscle);
    if (muscle === "Core") {
      expanded.add("Abs");
    }
  }
  return [...expanded];
}

function compareExercisesForMuscle(
  targetMuscle: string,
  left: CandidateExercise,
  right: CandidateExercise
): number {
  const leftPrimaryMuscles = toPrimaryMuscles(left.exerciseMuscles);
  const rightPrimaryMuscles = toPrimaryMuscles(right.exerciseMuscles);
  const leftDirectMatch = leftPrimaryMuscles.includes(targetMuscle) ? 1 : 0;
  const rightDirectMatch = rightPrimaryMuscles.includes(targetMuscle) ? 1 : 0;
  if (rightDirectMatch !== leftDirectMatch) {
    return rightDirectMatch - leftDirectMatch;
  }

  const leftCompound = left.isCompound ?? false;
  const rightCompound = right.isCompound ?? false;
  if (leftCompound !== rightCompound) {
    return leftCompound ? 1 : -1;
  }

  const leftFatigue = left.fatigueCost ?? MAX_FATIGUE_COST;
  const rightFatigue = right.fatigueCost ?? MAX_FATIGUE_COST;
  if (leftFatigue !== rightFatigue) {
    return leftFatigue - rightFatigue;
  }

  const leftSfr = left.sfrScore ?? 0;
  const rightSfr = right.sfrScore ?? 0;
  if (rightSfr !== leftSfr) {
    return rightSfr - leftSfr;
  }

  const nameComparison = left.name.localeCompare(right.name);
  if (nameComparison !== 0) {
    return nameComparison;
  }

  return left.id.localeCompare(right.id);
}

function formatRepRange(min: number, max: number): string {
  return min === max ? String(min) : `${min}-${max}`;
}

async function loadCloseoutWorkout(input: {
  workoutId: string;
  userId: string;
}): Promise<CloseoutWorkout | null> {
  return prisma.workout.findFirst({
    where: {
      id: input.workoutId,
      userId: input.userId,
    },
    select: {
      id: true,
      selectionMetadata: true,
      mesocycleId: true,
      mesocycleWeekSnapshot: true,
      exercises: {
        orderBy: [{ orderIndex: "asc" }, { id: "asc" }],
        select: {
          id: true,
          orderIndex: true,
          section: true,
          exerciseId: true,
          exercise: {
            select: {
              id: true,
              name: true,
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
          sets: {
            orderBy: [{ setIndex: "asc" }, { id: "asc" }],
            select: {
              targetReps: true,
              targetRepMin: true,
              targetRepMax: true,
              targetRpe: true,
              restSeconds: true,
            },
          },
        },
      },
      mesocycle: {
        select: {
          id: true,
          startWeek: true,
          durationWeeks: true,
          sessionsPerWeek: true,
          macroCycle: {
            select: {
              startDate: true,
            },
          },
        },
      },
    },
  });
}

export async function getCloseoutSuggestions(input: {
  workoutId: string;
  userId: string;
}): Promise<BonusSuggestion[]> {
  const workout = await loadCloseoutWorkout(input);
  if (
    !workout ||
    !workout.mesocycle ||
    !workout.mesocycleId ||
    workout.mesocycleWeekSnapshot == null
  ) {
    return [];
  }

  const currentCoverage = buildCurrentWorkoutCoverage(workout);
  const remainingSetBudget = Math.max(0, MAX_SETS - currentCoverage.setCount);
  const remainingExerciseBudget = Math.max(0, MAX_EXERCISES - currentCoverage.exerciseCount);
  if (remainingSetBudget < DEFAULT_SETS || remainingExerciseBudget <= 0) {
    return [];
  }

  const weekStart = computeMesoWeekStartDate(
    workout.mesocycle.macroCycle.startDate,
    workout.mesocycle.startWeek ?? 0,
    workout.mesocycleWeekSnapshot
  );
  const recentExposureCutoff = new Date(Date.now() - RECENT_EXPOSURE_HOURS * 60 * 60 * 1000);

  const [projection, actualVolume, profile, goals, recentExposure] = await Promise.all([
    loadProjectedWeekVolumeReport({ userId: input.userId }),
    loadMesocycleWeekMuscleVolume(prisma, {
      userId: input.userId,
      mesocycleId: workout.mesocycleId,
      targetWeek: workout.mesocycleWeekSnapshot,
      weekStart,
    }),
    prisma.profile.findUnique({
      where: { userId: input.userId },
      select: { trainingAge: true },
    }),
    prisma.goals.findUnique({
      where: { userId: input.userId },
      select: { primaryGoal: true },
    }),
    prisma.exerciseExposure.findMany({
      where: {
        userId: input.userId,
        lastUsedAt: { gte: recentExposureCutoff },
      },
      select: {
        exerciseName: true,
      },
    }),
  ]);

  if (
    projection.currentWeek.mesocycleId !== workout.mesocycleId ||
    projection.currentWeek.week !== workout.mesocycleWeekSnapshot
  ) {
    return [];
  }

  const rankedDeficits = buildRankedDeficits({
    projectedRows: projection.fullWeekByMuscle,
    actualByMuscle: actualVolume,
    coveredMuscles: currentCoverage.coveredMuscles,
  });
  if (rankedDeficits.length === 0) {
    return [];
  }

  const recentlyUsedNames = new Set(recentExposure.map((entry) => entry.exerciseName));
  const candidateMuscles = rankedDeficits.map((row) => row.muscle);
  const candidateExercises = await prisma.exercise.findMany({
    where: {
      isMainLiftEligible: false,
      exerciseMuscles: {
        some: {
          role: "PRIMARY",
          muscle: {
            name: {
              in: expandCandidateMuscles(candidateMuscles),
            },
          },
        },
      },
    },
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
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: 200,
  });

  const filteredExercises = candidateExercises.filter((exercise) => {
    if (currentCoverage.exerciseIds.has(exercise.id)) {
      return false;
    }
    if (currentCoverage.exerciseNames.has(exercise.name)) {
      return false;
    }
    if (recentlyUsedNames.has(exercise.name)) {
      return false;
    }

    return (exercise.fatigueCost ?? MAX_FATIGUE_COST) <= MAX_FATIGUE_COST;
  });

  const selectedExerciseIds = new Set<string>();
  const suggestions: BonusSuggestion[] = [];
  const trainingAge =
    (profile?.trainingAge?.toLowerCase() as TrainingAge | undefined) ?? "intermediate";
  const primaryGoal =
    (goals?.primaryGoal?.toLowerCase() as PrimaryGoal | undefined) ?? "hypertrophy";

  for (const deficit of rankedDeficits) {
    if (suggestions.length >= remainingExerciseBudget) {
      break;
    }

    const usedSetBudget = suggestions.reduce((sum, suggestion) => sum + suggestion.sets, 0);
    if (remainingSetBudget - usedSetBudget < DEFAULT_SETS) {
      break;
    }

    if ((currentCoverage.setsByMuscle.get(deficit.muscle) ?? 0) >= MAX_SETS_PER_MUSCLE) {
      continue;
    }

    const candidate = filteredExercises
      .filter((exercise) => !selectedExerciseIds.has(exercise.id))
      .filter((exercise) => toPrimaryMuscles(exercise.exerciseMuscles).includes(deficit.muscle))
      .sort((left, right) => compareExercisesForMuscle(deficit.muscle, left, right))[0];

    if (!candidate) {
      continue;
    }

    const preview = buildRuntimeAddedExercisePreview({
      exercise: {
        id: candidate.id,
        name: candidate.name,
        repRangeMin: candidate.repRangeMin,
        repRangeMax: candidate.repRangeMax,
        fatigueCost: candidate.fatigueCost,
        isCompound: candidate.isCompound,
        equipment: candidate.exerciseEquipment.map((entry) => entry.equipment.type),
      },
      targetLoad: null,
      selectionMetadata: workout.selectionMetadata,
      currentExercises: workout.exercises,
      trainingAge,
      primaryGoal,
    });

    const rationalePrefix =
      deficit.priorityTier === 0 ? "High-priority closeout" : "Closeout top-up";
    const rationale = `${rationalePrefix}: ${deficit.muscle} is projected ${deficit.projected}/${deficit.target} against target (${deficit.actual} actual, MEV ${deficit.mev}, deficit ${deficit.deficit}).`;

    suggestions.push({
      muscle: deficit.muscle,
      exerciseId: candidate.id,
      exerciseName: candidate.name,
      primaryMuscles: toPrimaryMuscles(candidate.exerciseMuscles),
      equipment: candidate.exerciseEquipment.map((entry) => entry.equipment.type),
      sets: DEFAULT_SETS,
      reps: formatRepRange(preview.targetRepRange.min, preview.targetRepRange.max),
      rationale,
      reason: rationale,
      suggestedSets: DEFAULT_SETS,
      suggestedLoad: preview.targetLoad,
    });

    selectedExerciseIds.add(candidate.id);
    currentCoverage.setsByMuscle.set(
      deficit.muscle,
      Math.min(
        MAX_SETS_PER_MUSCLE,
        (currentCoverage.setsByMuscle.get(deficit.muscle) ?? 0) + DEFAULT_SETS
      )
    );
  }

  return suggestions;
}
