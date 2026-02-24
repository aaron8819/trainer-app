import { applyLoads as applyLoadsEngine } from "@/lib/engine/apply-loads";
import type { PeriodizationModifiers } from "@/lib/engine/rules";
import { prisma } from "@/lib/db/prisma";
import type {
  Exercise,
  Injury,
  Profile,
  Constraints as ConstraintsRecord,
  Workout,
  WorkoutExercise,
  WorkoutSet,
  SetLog,
} from "@prisma/client";
import {
  EquipmentType as PrismaEquipmentType,
  PrimaryGoal,
  SecondaryGoal,
  WorkoutStatus,
} from "@prisma/client";
import { mapLatestCheckIn, type CheckInRow } from "./checkin-staleness";
import type {
  Constraints,
  EquipmentType,
  Goals,
  JointStress,
  MovementPatternV2,
  SplitDay as EngineSplitDay,
  SplitTag,
  StimulusBias,
  SessionCheckIn as EngineSessionCheckIn,
  UserPreferences,
  UserProfile,
  WorkoutHistoryEntry,
  WorkoutPlan,
  SplitDay,
} from "@/lib/engine/types";

import type { WeekInBlockHistoryEntry } from "./periodization";

type ExerciseWithMuscles = Exercise & {
  exerciseMuscles?: { role: string; muscle: { name: string } }[];
};

type WorkoutWithRelations = Workout & {
  exercises: (WorkoutExercise & {
    exercise: ExerciseWithMuscles;
    sets: (WorkoutSet & { logs: SetLog[] })[];
  })[];
};

export async function resolveOwner() {
  const runtimeMode = process.env.RUNTIME_MODE?.trim().toLowerCase() ?? "single_user_local";
  const configuredOwnerEmail = process.env.OWNER_EMAIL?.trim().toLowerCase();
  const singleUserEmail = configuredOwnerEmail ?? "owner@local";

  const upsertOwner = async () =>
    prisma.user.upsert({
      where: { email: singleUserEmail },
      update: {},
      create: { email: singleUserEmail },
    });

  if (runtimeMode !== "single_user_local") {
    return upsertOwner();
  }

  // Prisma adapter/driver failures can be transient in local dev.
  const maxAttempts = 2;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await upsertOwner();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const isTransientDriverExit =
        message.includes("DbHandler exited") || message.includes("DriverAdapterError");

      if (!isTransientDriverExit || attempt >= maxAttempts) {
        throw error;
      }

      await prisma.$disconnect().catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }

  throw new Error("resolveOwner retry loop exhausted");
}

export async function loadWorkoutContext(userId: string) {
  const [profile, goals, constraints, injuries, exercises, workouts, preferences, checkIns] = await Promise.all([
    prisma.profile.findUnique({ where: { userId } }),
    prisma.goals.findUnique({ where: { userId } }),
    prisma.constraints.findUnique({ where: { userId } }),
    prisma.injury.findMany({ where: { userId, isActive: true } }),
    prisma.exercise.findMany({
      include: {
        exerciseEquipment: { include: { equipment: true } },
        exerciseMuscles: { include: { muscle: true } },
        aliases: true,
      },
    }),
    prisma.workout.findMany({
      where: { userId },
      orderBy: { scheduledDate: "desc" },
      take: 12,
      include: {
        exercises: {
          include: {
            exercise: {
              include: {
                exerciseMuscles: { include: { muscle: true } },
              },
            },
            sets: { include: { logs: { orderBy: { completedAt: "desc" }, take: 1 } } },
          },
        },
      },
    }),
    prisma.userPreference.findUnique({ where: { userId } }),
    prisma.readinessSignal.findMany({
      where: { userId },
      orderBy: { timestamp: "desc" },
      take: 1,
      select: {
        timestamp: true,
        subjectiveReadiness: true,
        subjectiveSoreness: true,
      },
    }),
  ]);

  const normalizedCheckIns: CheckInRow[] = checkIns.map((signal) => ({
    date: signal.timestamp,
    readiness: signal.subjectiveReadiness,
    painFlags: signal.subjectiveSoreness,
    notes: null,
  }));

  return {
    profile,
    goals,
    constraints,
    injuries,
    exercises,
    workouts,
    preferences,
    checkIns: normalizedCheckIns,
  };
}

export function mapProfile(userId: string, profile: Profile, injuries: Injury[]): UserProfile {
  const heightCm =
    profile.heightIn !== null && profile.heightIn !== undefined
      ? Math.round(profile.heightIn * 2.54)
      : undefined;
  const weightKg =
    profile.weightLb !== null && profile.weightLb !== undefined
      ? Number((profile.weightLb * 0.45359237).toFixed(1))
      : undefined;
  return {
    id: userId,
    age: profile.age ?? undefined,
    sex: profile.sex ?? undefined,
    heightCm,
    weightKg,
    trainingAge: profile.trainingAge.toLowerCase() as UserProfile["trainingAge"],
    injuries: injuries.map((injury) => ({
      bodyPart: injury.bodyPart,
      severity: injury.severity as 1 | 2 | 3 | 4 | 5,
      isActive: injury.isActive,
    })),
  };
}

export function mapGoals(primary: PrimaryGoal, secondary: SecondaryGoal): Goals {
  const normalizedPrimary = primary.toLowerCase() as Goals["primary"];
  const normalizedSecondary = secondary.toLowerCase() as Goals["secondary"];
  const isStrengthFocused =
    normalizedPrimary === "strength" ||
    normalizedPrimary === "strength_hypertrophy" ||
    normalizedSecondary === "strength";
  const isHypertrophyFocused =
    normalizedPrimary === "hypertrophy" || normalizedPrimary === "strength_hypertrophy";

  return {
    primary: normalizedPrimary,
    secondary: normalizedSecondary,
    isStrengthFocused,
    isHypertrophyFocused,
  };
}

export function mapConstraints(constraints: ConstraintsRecord): Constraints {
  return {
    daysPerWeek: constraints.daysPerWeek,
    splitType: constraints.splitType.toLowerCase() as Constraints["splitType"],
    weeklySchedule: (constraints.weeklySchedule ?? []).map(
      (intent) => intent.toLowerCase() as Constraints["weeklySchedule"][number]
    ),
  };
}

export function mapExercises(
  exercises: (Exercise & {
    exerciseEquipment: { equipment: { type: PrismaEquipmentType } }[];
    exerciseMuscles: { role: string; muscle: { name: string; sraHours: number } }[];
  })[]
) {
  return exercises.map((exercise) => ({
    id: exercise.id,
    name: exercise.name,
    movementPatterns: (exercise.movementPatterns ?? []).map((pattern) =>
      pattern.toLowerCase()
    ) as MovementPatternV2[],
    splitTags: (exercise.splitTags ?? []).map((tag) => tag.toLowerCase()) as SplitTag[],
    jointStress: exercise.jointStress.toLowerCase() as JointStress,
    isMainLiftEligible: exercise.isMainLiftEligible ?? false,
    isCompound: exercise.isCompound ?? false,
    fatigueCost: exercise.fatigueCost ?? 3,
    stimulusBias: (exercise.stimulusBias ?? []).map((bias) => bias.toLowerCase()) as unknown as
      | StimulusBias[],
    contraindications: (exercise.contraindications as Record<string, unknown>) ?? undefined,
    timePerSetSec: exercise.timePerSetSec ?? undefined,
    sfrScore: exercise.sfrScore ?? 3,
    lengthPositionScore: exercise.lengthPositionScore ?? 3,
    difficulty: exercise.difficulty ? exercise.difficulty.toLowerCase() as "beginner" | "intermediate" | "advanced" : undefined,
    isUnilateral: exercise.isUnilateral ?? undefined,
    repRangeMin: exercise.repRangeMin ?? undefined,
    repRangeMax: exercise.repRangeMax ?? undefined,
    equipment: exercise.exerciseEquipment.map((item) =>
      item.equipment.type.toLowerCase()
    ) as EquipmentType[],
    primaryMuscles: exercise.exerciseMuscles
      .filter((item) => item.role === "PRIMARY")
      .map((item) => item.muscle.name),
    secondaryMuscles: exercise.exerciseMuscles
      .filter((item) => item.role === "SECONDARY")
      .map((item) => item.muscle.name),
    muscleSraHours: Object.fromEntries(
      exercise.exerciseMuscles.map((item) => [item.muscle.name, item.muscle.sraHours])
    ),
  }));
}

export function mapHistory(workouts: WorkoutWithRelations[]): WorkoutHistoryEntry[] {
  return workouts.map((workout) => ({
    date: workout.scheduledDate.toISOString(),
    completed: workout.status === WorkoutStatus.COMPLETED,
    status: workout.status,
    advancesSplit: workout.advancesSplit ?? true,
    selectionMode: workout.selectionMode,
    sessionIntent: workout.sessionIntent
      ? (workout.sessionIntent.toLowerCase() as EngineSplitDay)
      : undefined,
    forcedSplit: workout.forcedSplit
      ? (workout.forcedSplit.toLowerCase() as EngineSplitDay)
      : undefined,
    exercises: workout.exercises.map((exercise) => ({
      exerciseId: exercise.exerciseId,
      primaryMuscles: exercise.exercise.exerciseMuscles
        ?.filter((m) => m.role === "PRIMARY")
        .map((m) => m.muscle.name) ?? [],
      sets: exercise.sets.flatMap((set) => {
        const log = set.logs[0];
        if (!log || log.wasSkipped) {
          return [];
        }
        return [
          {
            exerciseId: exercise.exerciseId,
            setIndex: set.setIndex,
            reps: log.actualReps ?? 0,
            rpe: log.actualRpe ?? undefined,
            load: log.actualLoad ?? undefined,
          },
        ];
      }),
    })),
  }));
}

export function mapPreferences(preferences: {
  favoriteExerciseIds?: string[];
  avoidExerciseIds?: string[];
} | null): UserPreferences | undefined {
  if (!preferences) {
    return undefined;
  }

  return {
    favoriteExerciseIds: preferences.favoriteExerciseIds ?? [],
    avoidExerciseIds: preferences.avoidExerciseIds ?? [],
  };
}

export function mapCheckIn(
  checkIns: CheckInRow[] | null | undefined
): EngineSessionCheckIn | undefined {
  return mapLatestCheckIn(checkIns);
}

type ExerciseWithAliases = Exercise & {
  aliases?: { alias: string }[];
  exerciseEquipment: { equipment: { type: PrismaEquipmentType } }[];
  exerciseMuscles: { role: string; muscle: { name: string; sraHours: number } }[];
};

export function applyLoads(
  workout: WorkoutPlan,
  exercises: ExerciseWithAliases[],
  history: WorkoutHistoryEntry[],
  profile: UserProfile,
  primaryGoal: Goals["primary"],
  periodization?: PeriodizationModifiers,
  weekInBlock?: number,
  sessionIntent?: SplitDay
): WorkoutPlan {
  const exerciseById = Object.fromEntries(
    mapExercises(exercises).map((exercise) => [exercise.id, exercise])
  );

  return applyLoadsEngine(workout, {
    history,
    baselines: [],
    exerciseById,
    primaryGoal,
    profile,
    periodization,
    weekInBlock,
    sessionIntent,
  });
}

export type { WeekInBlockHistoryEntry };
