import { prisma } from "@/lib/db/prisma";
import { mapExercises } from "./workout-context";
import { suggestSubstitutes } from "@/lib/engine/substitution";
import type { ExerciseDetail, ExerciseListItem } from "@/lib/exercise-library/types";
import type { Constraints } from "@/lib/engine/types";
import { resolveExercisePreferenceState } from "./exercise-preferences";

const DEFAULT_SUBSTITUTE_CONSTRAINTS: Constraints = {
  daysPerWeek: 4,
  sessionMinutes: 60,
  splitType: "ppl",
  availableEquipment: [
    "barbell",
    "dumbbell",
    "machine",
    "cable",
    "bodyweight",
    "kettlebell",
    "band",
    "bench",
    "rack",
  ],
};

const SUBSTITUTION_POOL_TTL_MS = 5 * 60 * 1000;

let substitutionPoolCache:
  | {
      expiresAt: number;
      data: Awaited<ReturnType<typeof loadSubstitutionPoolFresh>>;
    }
  | null = null;

function splitAndSortMuscles(exercise: {
  exerciseMuscles: { role: string; muscle: { name: string } }[];
}) {
  const primaryMuscles = exercise.exerciseMuscles
    .filter((m) => m.role === "PRIMARY")
    .map((m) => m.muscle.name)
    .sort((a, b) => a.localeCompare(b));

  const secondaryMuscles = exercise.exerciseMuscles
    .filter((m) => m.role === "SECONDARY")
    .map((m) => m.muscle.name)
    .sort((a, b) => a.localeCompare(b));

  return { primaryMuscles, secondaryMuscles };
}

function mapUserConstraintsToEngine(
  record:
    | {
        daysPerWeek: number;
        sessionMinutes: number;
        splitType: string;
        availableEquipment: string[];
      }
    | null
): Constraints {
  if (!record) {
    return DEFAULT_SUBSTITUTE_CONSTRAINTS;
  }

  const availableEquipment = (record.availableEquipment ?? []).map((item) =>
    item.toLowerCase()
  ) as Constraints["availableEquipment"];

  return {
    daysPerWeek: record.daysPerWeek,
    sessionMinutes: record.sessionMinutes,
    splitType: record.splitType.toLowerCase() as Constraints["splitType"],
    availableEquipment:
      availableEquipment.length > 0
        ? availableEquipment
        : DEFAULT_SUBSTITUTE_CONSTRAINTS.availableEquipment,
  };
}

async function loadSubstitutionPoolFresh() {
  return prisma.exercise.findMany({
    include: {
      exerciseEquipment: { include: { equipment: true } },
      exerciseMuscles: { include: { muscle: true } },
    },
    orderBy: { name: "asc" },
  });
}

async function loadSubstitutionPool() {
  if (substitutionPoolCache && Date.now() < substitutionPoolCache.expiresAt) {
    return substitutionPoolCache.data;
  }

  const data = await loadSubstitutionPoolFresh();
  substitutionPoolCache = {
    expiresAt: Date.now() + SUBSTITUTION_POOL_TTL_MS,
    data,
  };

  return data;
}

export async function loadExerciseLibrary(userId?: string): Promise<ExerciseListItem[]> {
  const [exercises, preferences] = await Promise.all([
    prisma.exercise.findMany({
      orderBy: { name: "asc" },
      include: {
        exerciseEquipment: { include: { equipment: true } },
        exerciseMuscles: { include: { muscle: true } },
      },
    }),
    userId ? prisma.userPreference.findUnique({ where: { userId } }) : null,
  ]);

  return exercises.map((exercise) => {
    const { primaryMuscles, secondaryMuscles } = splitAndSortMuscles(exercise);
    const preferenceState = resolveExercisePreferenceState(preferences, {
      id: exercise.id,
      name: exercise.name,
    });

    return {
      id: exercise.id,
      name: exercise.name,
      isCompound: exercise.isCompound ?? false,
      movementPatterns: (exercise.movementPatterns ?? []).map(
        (p) => p.toLowerCase()
      ) as ExerciseListItem["movementPatterns"],
      splitTags: (exercise.splitTags ?? []).map(
        (t) => t.toLowerCase()
      ) as ExerciseListItem["splitTags"],
      jointStress: exercise.jointStress.toLowerCase() as ExerciseListItem["jointStress"],
      equipment: exercise.exerciseEquipment.map(
        (e) => e.equipment.type.toLowerCase()
      ) as ExerciseListItem["equipment"],
      primaryMuscles,
      secondaryMuscles,
      fatigueCost: exercise.fatigueCost ?? 3,
      sfrScore: exercise.sfrScore ?? 3,
      lengthPositionScore: exercise.lengthPositionScore ?? 3,
      difficulty: exercise.difficulty
        ? (exercise.difficulty.toLowerCase() as "beginner" | "intermediate" | "advanced")
        : undefined,
      isUnilateral: exercise.isUnilateral ?? undefined,
      isFavorite: preferenceState.isFavorite,
      isAvoided: preferenceState.isAvoided,
    };
  });
}

export async function loadExerciseDetail(
  exerciseId: string,
  userId?: string
): Promise<ExerciseDetail | null> {
  const exercise = await prisma.exercise.findUnique({
    where: { id: exerciseId },
    include: {
      exerciseEquipment: { include: { equipment: true } },
      exerciseMuscles: { include: { muscle: true } },
      aliases: true,
      variations: true,
    },
  });

  if (!exercise) return null;

  const [preferences, baseline, userConstraints, allExercises] = await Promise.all([
    userId ? prisma.userPreference.findUnique({ where: { userId } }) : null,
    userId
      ? prisma.baseline.findFirst({
          where: { userId, exerciseId, context: "default" },
        })
      : null,
    userId
      ? prisma.constraints.findUnique({
          where: { userId },
          select: {
            daysPerWeek: true,
            sessionMinutes: true,
            splitType: true,
            availableEquipment: true,
          },
        })
      : null,
    loadSubstitutionPool(),
  ]);

  const { primaryMuscles, secondaryMuscles } = splitAndSortMuscles(exercise);
  const preferenceState = resolveExercisePreferenceState(preferences, {
    id: exercise.id,
    name: exercise.name,
  });

  // Compute substitutes via engine
  const engineExercises = mapExercises(allExercises);
  const targetEngine = engineExercises.find((e) => e.id === exerciseId);
  const substituteConstraints = mapUserConstraintsToEngine(userConstraints);

  let substitutes: { id: string; name: string; primaryMuscles: string[] }[] = [];
  if (targetEngine) {
    const subs = suggestSubstitutes(
      targetEngine,
      engineExercises,
      substituteConstraints
    );
    substitutes = subs.map((s) => ({
      id: s.id,
      name: s.name,
      primaryMuscles: s.primaryMuscles ?? [],
    }));
  }

  return {
    id: exercise.id,
    name: exercise.name,
    isCompound: exercise.isCompound ?? false,
    isMainLiftEligible: exercise.isMainLiftEligible ?? false,
    movementPatterns: (exercise.movementPatterns ?? []).map(
      (p) => p.toLowerCase()
    ) as ExerciseDetail["movementPatterns"],
    splitTags: (exercise.splitTags ?? []).map(
      (t) => t.toLowerCase()
    ) as ExerciseDetail["splitTags"],
    jointStress: exercise.jointStress.toLowerCase() as ExerciseDetail["jointStress"],
    equipment: exercise.exerciseEquipment.map(
      (e) => e.equipment.type.toLowerCase()
    ) as ExerciseDetail["equipment"],
    primaryMuscles,
    secondaryMuscles,
    fatigueCost: exercise.fatigueCost ?? 3,
    stimulusBias: (exercise.stimulusBias ?? []).map(
      (b) => b.toLowerCase()
    ) as ExerciseDetail["stimulusBias"],
    contraindications: (exercise.contraindications as Record<string, unknown>) ?? undefined,
    sfrScore: exercise.sfrScore ?? 3,
    lengthPositionScore: exercise.lengthPositionScore ?? 3,
    difficulty: exercise.difficulty ? exercise.difficulty.toLowerCase() as "beginner" | "intermediate" | "advanced" : undefined,
    isUnilateral: exercise.isUnilateral ?? undefined,
    timePerSetSec: exercise.timePerSetSec ?? 120,
    repRangeMin: exercise.repRangeMin ?? undefined,
    repRangeMax: exercise.repRangeMax ?? undefined,
    aliases: exercise.aliases.map((a) => a.alias),
    variations: exercise.variations.map((v) => ({
      id: v.id,
      name: v.name,
      description: v.description ?? undefined,
    })),
    substitutes,
    isFavorite: preferenceState.isFavorite,
    isAvoided: preferenceState.isAvoided,
    baseline: baseline
      ? {
          id: baseline.id,
          context: baseline.context,
          workingWeightMin: baseline.workingWeightMin ?? undefined,
          workingWeightMax: baseline.workingWeightMax ?? undefined,
          workingRepsMin: baseline.workingRepsMin ?? undefined,
          workingRepsMax: baseline.workingRepsMax ?? undefined,
          topSetWeight: baseline.topSetWeight ?? undefined,
          topSetReps: baseline.topSetReps ?? undefined,
          notes: baseline.notes ?? undefined,
        }
      : undefined,
  };
}
