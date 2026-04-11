import { getEffectiveStimulusByMuscle } from "@/lib/engine/stimulus";
import { normalizeExposedMuscle } from "@/lib/engine/volume-landmarks";

const MIN_DISPLAY_STIMULUS_WEIGHT = 0.2;
const PRIMARY_DISPLAY_STIMULUS_WEIGHT = 0.75;

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

export type ExerciseMuscleTagGroups = {
  primaryMuscles: string[];
  secondaryMuscles: string[];
};

export type ExerciseMuscleDisplayGroups = ExerciseMuscleTagGroups & {
  muscleTags: string[];
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

function collectMuscleDisplayOrder(input: {
  primaryMuscles: string[];
  secondaryMuscles: string[];
  effectiveStimulus: Map<string, number>;
}): Map<string, number> {
  const order = new Map<string, number>();
  const add = (muscle: string) => {
    const normalized = normalizeMuscleLabel(muscle);
    if (!normalized || order.has(normalized)) {
      return;
    }

    order.set(normalized, order.size);
  };

  input.primaryMuscles.forEach(add);
  input.secondaryMuscles.forEach(add);
  Array.from(input.effectiveStimulus.keys()).forEach(add);

  return order;
}

function sortStimulusEntries(
  entries: Array<[string, number]>,
  displayOrder: Map<string, number>
): Array<[string, number]> {
  return [...entries].sort(([leftMuscle, leftWeight], [rightMuscle, rightWeight]) => {
    if (rightWeight !== leftWeight) {
      return rightWeight - leftWeight;
    }

    const leftOrder = displayOrder.get(leftMuscle) ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = displayOrder.get(rightMuscle) ?? Number.MAX_SAFE_INTEGER;
    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }

    return leftMuscle.localeCompare(rightMuscle);
  });
}

export function buildExerciseMuscleDisplayGroups(
  exercise: ExerciseMuscleTagSource
): ExerciseMuscleDisplayGroups {
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
  const displayOrder = collectMuscleDisplayOrder({
    primaryMuscles,
    secondaryMuscles,
    effectiveStimulus,
  });
  const meaningfulStimulus = sortStimulusEntries(
    Array.from(effectiveStimulus.entries()).filter(
      ([, weight]) => weight >= MIN_DISPLAY_STIMULUS_WEIGHT
    ),
    displayOrder
  );

  const primary = meaningfulStimulus
    .filter(([, weight]) => weight >= PRIMARY_DISPLAY_STIMULUS_WEIGHT)
    .map(([muscle]) => muscle);
  const secondary = meaningfulStimulus
    .filter(([, weight]) => weight < PRIMARY_DISPLAY_STIMULUS_WEIGHT)
    .map(([muscle]) => muscle);

  if (primary.length === 0 && secondary.length > 0) {
    primary.push(secondary.shift() as string);
  }

  return {
    primaryMuscles: primary,
    secondaryMuscles: secondary,
    muscleTags: [...primary, ...secondary],
  };
}

export function buildExerciseMuscleTags(exercise: ExerciseMuscleTagSource): string[] {
  return buildExerciseMuscleDisplayGroups(exercise).muscleTags;
}
