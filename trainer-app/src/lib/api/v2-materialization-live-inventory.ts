import { getEffectiveStimulusByMuscle } from "@/lib/engine/stimulus";
import type { V2MaterializationExercise } from "@/lib/engine/planning/v2";

export type LiveV2MaterializationExerciseRow = {
  id: string;
  name: string;
  aliases?: Array<{ alias: string }>;
  movementPatterns?: readonly string[] | null;
  isCompound?: boolean | null;
  isMainLiftEligible?: boolean | null;
  fatigueCost?: number | null;
  exerciseEquipment?: Array<{ equipment: { type: string } }>;
  exerciseMuscles?: Array<{ role: string; muscle: { name: string } }>;
};

function musclesByRole(
  exercise: Pick<LiveV2MaterializationExerciseRow, "exerciseMuscles">,
  role: "PRIMARY" | "SECONDARY",
): string[] {
  return (exercise.exerciseMuscles ?? [])
    .filter((entry) => entry.role === role)
    .map((entry) => entry.muscle.name)
    .sort((left, right) => left.localeCompare(right));
}

export function normalizeLiveInventoryForV2Materialization(
  exercises: LiveV2MaterializationExerciseRow[],
): V2MaterializationExercise[] {
  return exercises.map((exercise) => {
    const primaryMuscles = musclesByRole(exercise, "PRIMARY");
    const secondaryMuscles = musclesByRole(exercise, "SECONDARY");
    const aliases = (exercise.aliases ?? []).map((alias) => alias.alias);
    const stimulusByMusclePerSet = Object.fromEntries(
      getEffectiveStimulusByMuscle(
        {
          id: exercise.id,
          name: exercise.name,
          aliases,
          primaryMuscles,
          secondaryMuscles,
        },
        1,
        { logFallback: false },
      ),
    );

    return {
      exerciseId: exercise.id,
      name: exercise.name,
      aliases,
      movementPatterns: [...(exercise.movementPatterns ?? [])].map((pattern) =>
        pattern.toLowerCase(),
      ),
      primaryMuscles,
      secondaryMuscles,
      equipment: (exercise.exerciseEquipment ?? []).map((entry) =>
        entry.equipment.type.toLowerCase(),
      ),
      isCompound: exercise.isCompound ?? false,
      isMainLiftEligible: exercise.isMainLiftEligible ?? false,
      fatigueCost: exercise.fatigueCost ?? undefined,
      stimulusByMusclePerSet,
    };
  });
}
