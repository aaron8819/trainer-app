import { getEffectiveStimulusByMuscle } from "@/lib/engine/stimulus";
import { normalizeExposedMuscle } from "@/lib/engine/volume-landmarks";

const MIN_DISPLAY_STIMULUS_WEIGHT = 0.2;

type ExerciseMuscleMapping = {
  role: string;
  muscle: { name: string };
};

export type ExerciseMuscleTagSource = {
  id?: string | null;
  name: string;
  aliases?: Array<string | { alias: string }> | null;
  exerciseMuscles?: ExerciseMuscleMapping[] | null;
};

function normalizeAlias(alias: string | { alias: string }): string {
  return typeof alias === "string" ? alias : alias.alias;
}

function normalizeMuscleLabel(muscle: string): string {
  return normalizeExposedMuscle(muscle.trim());
}

function collectMusclesByRole(
  exerciseMuscles: ExerciseMuscleMapping[] | null | undefined,
  role: "PRIMARY" | "SECONDARY"
): string[] {
  const seen = new Set<string>();
  const muscles: string[] = [];

  for (const mapping of exerciseMuscles ?? []) {
    if (mapping.role !== role) {
      continue;
    }

    const muscle = normalizeMuscleLabel(mapping.muscle.name);
    if (!muscle || seen.has(muscle)) {
      continue;
    }

    seen.add(muscle);
    muscles.push(muscle);
  }

  return muscles;
}

function normalizeEffectiveStimulus(input: Map<string, number>): Map<string, number> {
  const normalized = new Map<string, number>();

  for (const [muscle, weight] of input) {
    const exposedMuscle = normalizeMuscleLabel(muscle);
    if (!exposedMuscle || !Number.isFinite(weight) || weight <= 0) {
      continue;
    }

    normalized.set(exposedMuscle, (normalized.get(exposedMuscle) ?? 0) + weight);
  }

  return normalized;
}

export function buildExerciseMuscleTags(exercise: ExerciseMuscleTagSource): string[] {
  const primaryMuscles = collectMusclesByRole(exercise.exerciseMuscles, "PRIMARY");
  const secondaryMuscles = collectMusclesByRole(exercise.exerciseMuscles, "SECONDARY");
  const effectiveStimulus = normalizeEffectiveStimulus(
    getEffectiveStimulusByMuscle(
      {
        id: exercise.id ?? exercise.name,
        name: exercise.name,
        aliases: (exercise.aliases ?? []).map(normalizeAlias),
        primaryMuscles,
        secondaryMuscles,
      },
      1,
      { logFallback: false }
    )
  );

  const tags: string[] = [];
  const seen = new Set<string>();
  const addTag = (muscle: string) => {
    const normalized = normalizeMuscleLabel(muscle);
    if (!normalized || seen.has(normalized)) {
      return;
    }

    const weight = effectiveStimulus.get(normalized) ?? 0;
    if (weight < MIN_DISPLAY_STIMULUS_WEIGHT) {
      return;
    }

    seen.add(normalized);
    tags.push(normalized);
  };

  for (const muscle of primaryMuscles) {
    addTag(muscle);
  }

  for (const muscle of secondaryMuscles) {
    addTag(muscle);
  }

  const taxonomyMuscles = new Set([...primaryMuscles, ...secondaryMuscles]);
  const additionalMuscles = Array.from(effectiveStimulus.entries())
    .filter(([muscle, weight]) => !taxonomyMuscles.has(muscle) && weight >= MIN_DISPLAY_STIMULUS_WEIGHT)
    .sort(([leftMuscle, leftWeight], [rightMuscle, rightWeight]) => {
      if (rightWeight !== leftWeight) {
        return rightWeight - leftWeight;
      }

      return leftMuscle.localeCompare(rightMuscle);
    });

  for (const [muscle] of additionalMuscles) {
    addTag(muscle);
  }

  return tags;
}
