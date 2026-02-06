import {
  applyLoads as applyLoadsEngine,
  type BaselineInput,
  type PeriodizationModifiers,
} from "@/lib/engine";
import { prisma } from "@/lib/db/prisma";
import type {
  Baseline,
  Exercise,
  Injury,
  Profile,
  ProgramBlock,
  Constraints as ConstraintsRecord,
  Workout,
  WorkoutExercise,
  WorkoutSet,
  SetLog,
} from "@prisma/client";
import {
  EquipmentType,
  PrimaryGoal,
  SecondaryGoal,
  TrainingAge,
  WorkoutStatus,
} from "@prisma/client";
import type {
  Constraints,
  Goals,
  JointStress,
  MovementPattern,
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

type WorkoutWithRelations = Workout & {
  programBlock?: ProgramBlock | null;
  exercises: (WorkoutExercise & {
    exercise: Exercise;
    sets: (WorkoutSet & { logs: SetLog[] })[];
  })[];
};

export async function resolveUser(userId?: string | null) {
  if (userId) {
    return prisma.user.findUnique({ where: { id: userId } });
  }
  const withProfile = await prisma.user.findFirst({
    orderBy: { createdAt: "desc" },
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

  return prisma.user.findFirst({ orderBy: { createdAt: "desc" } });
}

export async function loadWorkoutContext(userId: string) {
  const [profile, goals, constraints, injuries, baselines, exercises, workouts, preferences, checkIns] = await Promise.all([
    prisma.profile.findUnique({ where: { userId } }),
    prisma.goals.findUnique({ where: { userId } }),
    prisma.constraints.findUnique({ where: { userId } }),
    prisma.injury.findMany({ where: { userId, isActive: true } }),
    prisma.baseline.findMany({ where: { userId } }),
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
        programBlock: true,
        exercises: {
          include: {
            exercise: true,
            sets: { include: { logs: true } },
          },
        },
      },
    }),
    prisma.userPreference.findUnique({ where: { userId } }),
    prisma.sessionCheckIn.findMany({ where: { userId }, orderBy: { date: "desc" }, take: 1 }),
  ]);

  return { profile, goals, constraints, injuries, baselines, exercises, workouts, preferences, checkIns };
}

export function mapProfile(userId: string, profile: Profile, injuries: Injury[]): UserProfile {
  return {
    id: userId,
    age: profile.age ?? undefined,
    sex: profile.sex ?? undefined,
    heightCm: profile.heightCm ?? undefined,
    weightKg: profile.weightKg ?? undefined,
    trainingAge: (profile.trainingAge ?? TrainingAge.INTERMEDIATE).toLowerCase() as UserProfile["trainingAge"],
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
    availableEquipment: (constraints.availableEquipment ?? []).map((value) =>
      value.toLowerCase()
    ) as Constraints["availableEquipment"],
  };
}

export function mapExercises(
  exercises: (Exercise & {
    exerciseEquipment: { equipment: { type: EquipmentType } }[];
    exerciseMuscles: { role: string; muscle: { name: string } }[];
  })[]
) {
  return exercises.map((exercise) => ({
    id: exercise.id,
    name: exercise.name,
    movementPattern: exercise.movementPattern.toLowerCase() as MovementPattern,
    movementPatternsV2: (exercise.movementPatternsV2 ?? []).map((pattern) =>
      pattern.toLowerCase()
    ) as MovementPatternV2[],
    splitTags: (exercise.splitTags ?? []).map((tag) => tag.toLowerCase()) as SplitTag[],
    jointStress: exercise.jointStress.toLowerCase() as JointStress,
    isMainLift: exercise.isMainLift,
    isMainLiftEligible: exercise.isMainLiftEligible ?? exercise.isMainLift,
    isCompound: exercise.isCompound ?? exercise.isMainLift,
    fatigueCost: exercise.fatigueCost ?? undefined,
    stimulusBias: (exercise.stimulusBias ?? []).map((bias) => bias.toLowerCase()) as unknown as
      | StimulusBias[],
    contraindications: (exercise.contraindications as Record<string, unknown>) ?? undefined,
    timePerSetSec: exercise.timePerSetSec ?? undefined,
    equipment: exercise.exerciseEquipment.map((item) =>
      item.equipment.type.toLowerCase()
    ) as Constraints["availableEquipment"],
    primaryMuscles: exercise.exerciseMuscles
      .filter((item) => item.role === "PRIMARY")
      .map((item) => item.muscle.name),
    secondaryMuscles: exercise.exerciseMuscles
      .filter((item) => item.role === "SECONDARY")
      .map((item) => item.muscle.name),
  }));
}

export function mapHistory(workouts: WorkoutWithRelations[]): WorkoutHistoryEntry[] {
  return workouts.map((workout) => ({
    date: workout.scheduledDate.toISOString(),
    completed: workout.status === WorkoutStatus.COMPLETED,
    status: workout.status,
    advancesSplit: workout.advancesSplit ?? true,
    forcedSplit: workout.forcedSplit
      ? (workout.forcedSplit.toLowerCase() as EngineSplitDay)
      : undefined,
    exercises: workout.exercises.map((exercise) => ({
      exerciseId: exercise.exerciseId,
      movementPattern: exercise.exercise.movementPattern.toLowerCase() as WorkoutHistoryEntry["exercises"][number]["movementPattern"],
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
  favoriteExercises: string[];
  avoidExercises: string[];
  rpeTargets: unknown;
  progressionStyle: string | null;
  optionalConditioning: boolean;
  benchFrequency: number | null;
  squatFrequency: number | null;
  deadliftFrequency: number | null;
} | null): UserPreferences | undefined {
  if (!preferences) {
    return undefined;
  }

  const parsedRpe = Array.isArray(preferences.rpeTargets)
    ? (preferences.rpeTargets as UserPreferences["rpeTargets"])
    : undefined;

  return {
    favoriteExercises: preferences.favoriteExercises ?? [],
    avoidExercises: preferences.avoidExercises ?? [],
    rpeTargets: parsedRpe,
    progressionStyle: preferences.progressionStyle ?? undefined,
    optionalConditioning: preferences.optionalConditioning ?? undefined,
    benchFrequency: preferences.benchFrequency ?? undefined,
    squatFrequency: preferences.squatFrequency ?? undefined,
    deadliftFrequency: preferences.deadliftFrequency ?? undefined,
  };
}

export function mapCheckIn(checkIns: { date: Date; readiness: number; painFlags: unknown; notes: string | null }[] | null | undefined)
  : EngineSessionCheckIn | undefined {
  if (!checkIns || checkIns.length === 0) {
    return undefined;
  }
  const latest = checkIns[0];
  return {
    date: latest.date.toISOString(),
    readiness: latest.readiness as 1 | 2 | 3 | 4 | 5,
    painFlags: (latest.painFlags as Record<string, 0 | 1 | 2 | 3>) ?? undefined,
    notes: latest.notes ?? undefined,
  };
}

type ExerciseWithAliases = Exercise & {
  aliases?: { alias: string }[];
  exerciseEquipment: { equipment: { type: EquipmentType } }[];
  exerciseMuscles: { role: string; muscle: { name: string } }[];
};

export function mapBaselinesToExerciseIds(
  baselines: Baseline[],
  exercises: ExerciseWithAliases[]
): BaselineInput[] {
  const exerciseByName = new Map<string, string>();
  const aliasToId = new Map<string, string>();

  for (const exercise of exercises) {
    exerciseByName.set(normalizeName(exercise.name), exercise.id);
    for (const alias of exercise.aliases ?? []) {
      aliasToId.set(normalizeName(alias.alias), exercise.id);
    }
  }

  const mapped: BaselineInput[] = [];
  for (const baseline of baselines) {
    const baselineWithId = baseline as Baseline & { exerciseId?: string | null };
    const normalized = normalizeName(baseline.exerciseName);
    const exerciseId =
      baselineWithId.exerciseId ?? exerciseByName.get(normalized) ?? aliasToId.get(normalized);

    if (!exerciseId) {
      continue;
    }

    mapped.push({
      exerciseId,
      context: baseline.context ?? undefined,
      workingWeightMin: baseline.workingWeightMin ?? undefined,
      workingWeightMax: baseline.workingWeightMax ?? undefined,
      topSetWeight: baseline.topSetWeight ?? undefined,
    });
  }

  return mapped;
}

export function applyLoads(
  workout: WorkoutPlan,
  baselines: Baseline[],
  exercises: ExerciseWithAliases[],
  history: WorkoutHistoryEntry[],
  profile: UserProfile,
  primaryGoal: Goals["primary"],
  sessionMinutes?: number,
  periodization?: PeriodizationModifiers
): WorkoutPlan {
  const baselineInputs = mapBaselinesToExerciseIds(baselines, exercises);
  const exerciseById = Object.fromEntries(
    mapExercises(exercises).map((exercise) => [exercise.id, exercise])
  );

  return applyLoadsEngine(workout, {
    history,
    baselines: baselineInputs,
    exerciseById,
    primaryGoal,
    profile,
    sessionMinutes,
    periodization,
  });
}

export { deriveWeekInBlock, type WeekInBlockHistoryEntry };

function normalizeName(name: string) {
  return name
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\w\s()-]/g, "")
    .trim();
}
