import type { SessionIntent, SelectionOutput } from "@/lib/engine/session-types";
import type { Exercise } from "@/lib/engine/types";

const LOWER_MUSCLES = new Set([
  "quads",
  "hamstrings",
  "glutes",
  "calves",
  "adductors",
  "abductors",
  "lower back",
  "core",
  "abs",
]);

const UPPER_MUSCLES = new Set([
  "chest",
  "lats",
  "upper back",
  "front delts",
  "side delts",
  "rear delts",
  "biceps",
  "triceps",
  "forearms",
]);

function normalizeMuscle(muscle: string): string {
  return muscle.trim().toLowerCase();
}

function toTargetSet(targetMuscles?: string[]): Set<string> {
  return new Set((targetMuscles ?? []).map(normalizeMuscle));
}

function isLowerExercise(exercise: Exercise): boolean {
  if (exercise.splitTags.includes("legs")) {
    return true;
  }
  return (exercise.primaryMuscles ?? []).some((muscle) => LOWER_MUSCLES.has(normalizeMuscle(muscle)));
}

function isUpperExercise(exercise: Exercise): boolean {
  if (exercise.splitTags.includes("push") || exercise.splitTags.includes("pull")) {
    return true;
  }
  return (exercise.primaryMuscles ?? []).some((muscle) => UPPER_MUSCLES.has(normalizeMuscle(muscle)));
}

export function isIntentAlignedExercise(
  exercise: Exercise,
  intent: SessionIntent,
  targetMuscles?: string[]
): boolean {
  const targetSet = toTargetSet(targetMuscles);
  switch (intent) {
    case "push":
    case "pull":
    case "legs":
      return exercise.splitTags.includes(intent);
    case "upper":
      return isUpperExercise(exercise) && !isLowerExercise(exercise);
    case "lower":
      return isLowerExercise(exercise);
    case "full_body":
      return isUpperExercise(exercise) || isLowerExercise(exercise);
    case "body_part":
      if (targetSet.size === 0) {
        return false;
      }
      return (exercise.primaryMuscles ?? []).some((muscle) => targetSet.has(normalizeMuscle(muscle)));
    default:
      return false;
  }
}

export function filterPoolForIntent(
  exercisePool: Exercise[],
  intent: SessionIntent,
  targetMuscles?: string[]
): Exercise[] {
  return exercisePool.filter((exercise) => isIntentAlignedExercise(exercise, intent, targetMuscles));
}

function computeAlignmentRatio(
  selectedIds: string[],
  byId: Map<string, Exercise>,
  intent: SessionIntent,
  targetMuscles?: string[]
): number {
  if (selectedIds.length === 0) {
    return 0;
  }
  const aligned = selectedIds.filter((exerciseId) => {
    const exercise = byId.get(exerciseId);
    return exercise !== undefined && isIntentAlignedExercise(exercise, intent, targetMuscles);
  }).length;
  return aligned / selectedIds.length;
}

function hasFullBodyCoverage(selectedIds: string[], byId: Map<string, Exercise>) {
  let hasUpper = false;
  let hasLower = false;
  for (const exerciseId of selectedIds) {
    const exercise = byId.get(exerciseId);
    if (!exercise) {
      continue;
    }
    if (isUpperExercise(exercise)) {
      hasUpper = true;
    }
    if (isLowerExercise(exercise)) {
      hasLower = true;
    }
  }
  return { hasUpper, hasLower };
}

type AlignmentOptions = {
  minRatio?: number;
  targetMuscles?: string[];
};

export function enforceIntentAlignment(
  selection: SelectionOutput,
  exercisePool: Exercise[],
  intent: SessionIntent,
  options: AlignmentOptions = {}
): SelectionOutput | { error: string } {
  const minRatio = options.minRatio ?? 0.7;
  const byId = new Map(exercisePool.map((exercise) => [exercise.id, exercise]));
  const selectedIds = [...selection.selectedExerciseIds];
  const alignedPool = filterPoolForIntent(exercisePool, intent, options.targetMuscles);
  if (alignedPool.length === 0) {
    return { error: "No compatible exercises found for the requested intent" };
  }

  const used = new Set(selectedIds);
  const replaceAt = (index: number, nextExerciseId: string) => {
    const previousId = selectedIds[index];
    selectedIds[index] = nextExerciseId;
    used.delete(previousId);
    used.add(nextExerciseId);

    const previousTarget = selection.perExerciseSetTargets[previousId] ?? 3;
    if (!(nextExerciseId in selection.perExerciseSetTargets)) {
      selection.perExerciseSetTargets[nextExerciseId] = previousTarget;
    }
    delete selection.perExerciseSetTargets[previousId];

    const previousRationale = selection.rationale[previousId];
    if (previousRationale && !selection.rationale[nextExerciseId]) {
      selection.rationale[nextExerciseId] = {
        ...previousRationale,
        reason: previousRationale.reason
          ? `${previousRationale.reason} | repaired for intent alignment`
          : "repaired for intent alignment",
      };
    }
    delete selection.rationale[previousId];
  };

  let ratio = computeAlignmentRatio(selectedIds, byId, intent, options.targetMuscles);
  if (ratio < minRatio) {
    for (let i = 0; i < selectedIds.length && ratio < minRatio; i += 1) {
      const currentId = selectedIds[i];
      const currentExercise = byId.get(currentId);
      if (!currentExercise || isIntentAlignedExercise(currentExercise, intent, options.targetMuscles)) {
        continue;
      }
      const replacement = alignedPool.find((exercise) => !used.has(exercise.id));
      if (!replacement) {
        break;
      }
      replaceAt(i, replacement.id);
      ratio = computeAlignmentRatio(selectedIds, byId, intent, options.targetMuscles);
    }
  }

  if (intent === "full_body") {
    let coverage = hasFullBodyCoverage(selectedIds, byId);
    if (!coverage.hasUpper || !coverage.hasLower) {
      for (let i = selectedIds.length - 1; i >= 0 && (!coverage.hasUpper || !coverage.hasLower); i -= 1) {
        const needed = !coverage.hasUpper ? "upper" : "lower";
        const replacement = alignedPool.find((exercise) => {
          if (used.has(exercise.id)) {
            return false;
          }
          return needed === "upper" ? isUpperExercise(exercise) : isLowerExercise(exercise);
        });
        if (!replacement) {
          break;
        }
        replaceAt(i, replacement.id);
        coverage = hasFullBodyCoverage(selectedIds, byId);
      }
      if (!coverage.hasUpper || !coverage.hasLower) {
        return { error: "Unable to satisfy full-body upper/lower coverage with available exercises" };
      }
    }
  }

  ratio = computeAlignmentRatio(selectedIds, byId, intent, options.targetMuscles);
  if (ratio < minRatio) {
    return { error: "Unable to satisfy intent alignment with available exercises" };
  }

  selection.selectedExerciseIds = selectedIds;
  selection.mainLiftIds = selectedIds.filter((exerciseId) => byId.get(exerciseId)?.isMainLiftEligible);
  selection.accessoryIds = selectedIds.filter((exerciseId) => !byId.get(exerciseId)?.isMainLiftEligible);
  selection.intentDiagnostics = {
    intent,
    targetMuscles: options.targetMuscles ?? [],
    alignedRatio: ratio,
    minAlignedRatio: minRatio,
    selectedCount: selectedIds.length,
  };
  return selection;
}
