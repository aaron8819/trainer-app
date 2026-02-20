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
} from "@/lib/engine/types";

import { deriveWeekInBlock, type WeekInBlockHistoryEntry } from "./periodization";

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
  const configuredOwnerEmail = process.env.OWNER_EMAIL?.trim().toLowerCase();
  if (configuredOwnerEmail) {
    return prisma.user.upsert({
      where: { email: configuredOwnerEmail },
      update: {},
      create: { email: configuredOwnerEmail },
    });
  }

  const withProfile = await prisma.user.findFirst({
    orderBy: { createdAt: "asc" },
    where: {
      profile: {
        isNot: null,
      },
      goals: {
        isNot: null,
      },
      constraints: {
        isNot: null,
      },
    },
  });

  if (withProfile) {
    return withProfile;
  }

  const firstUser = await prisma.user.findFirst({ orderBy: { createdAt: "asc" } });
  if (firstUser) {
    return firstUser;
  }

  return prisma.user.create({
    data: { email: configuredOwnerEmail ?? "owner@local" },
  });
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
    prisma.sessionCheckIn.findMany({ where: { userId }, orderBy: { date: "desc" }, take: 1 }),
  ]);

  return { profile, goals, constraints, injuries, exercises, workouts, preferences, checkIns };
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
  return {
    primary: primary.toLowerCase() as Goals["primary"],
    secondary: secondary.toLowerCase() as Goals["secondary"],
  };
}

export function mapConstraints(constraints: ConstraintsRecord): Constraints {
  return {
    daysPerWeek: constraints.daysPerWeek,
    sessionMinutes: constraints.sessionMinutes,
    splitType: constraints.splitType.toLowerCase() as Constraints["splitType"],
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
      sets: exercise.sets.map((set) => {
        const log = set.logs[0];
        return {
          exerciseId: exercise.exerciseId,
          setIndex: set.setIndex,
          reps: log?.actualReps ?? set.targetReps ?? 0,
          rpe: log?.actualRpe ?? set.targetRpe ?? undefined,
          load: log?.actualLoad ?? set.targetLoad ?? undefined,
        };
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
  sessionMinutes?: number,
  periodization?: PeriodizationModifiers,
  weekInBlock?: number
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
    sessionMinutes,
    periodization,
    weekInBlock,
  });
}

export { deriveWeekInBlock, type WeekInBlockHistoryEntry };
