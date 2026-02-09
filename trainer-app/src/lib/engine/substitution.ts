import type { Constraints, Exercise } from "./types";
import { applyPainConstraints, hasBlockedTag } from "./filtering";

export function suggestSubstitutes(
  target: Exercise,
  exerciseLibrary: Exercise[],
  constraints: Constraints,
  painFlags?: Record<string, 0 | 1 | 2 | 3>
) {
  const allowedEquipment = constraints.availableEquipment;
  const candidates = applyPainConstraints(
    exerciseLibrary.filter((exercise) => exercise.id !== target.id),
    painFlags
  )
    .filter((exercise) =>
      exercise.equipment.some((item) => allowedEquipment.includes(item))
    )
    .filter((exercise) =>
      exercise.splitTags?.some((tag) => target.splitTags?.includes(tag))
    )
    .filter((exercise) => !hasBlockedTag(exercise));

  const scoreCandidate = (exercise: Exercise) => {
    const patternOverlap = (exercise.movementPatterns ?? []).filter((pattern) =>
      target.movementPatterns?.includes(pattern)
    ).length;
    const muscleOverlap = (exercise.primaryMuscles ?? []).filter((muscle) =>
      target.primaryMuscles?.includes(muscle)
    ).length;
    const stimulusOverlap = (exercise.stimulusBias ?? []).filter((bias) =>
      target.stimulusBias?.includes(bias)
    ).length;
    const fatigueDelta = Math.max(
      0,
      (target.fatigueCost ?? 3) - (exercise.fatigueCost ?? 3)
    );

    return patternOverlap * 4 + muscleOverlap * 3 + stimulusOverlap * 2 + fatigueDelta;
  };

  return candidates
    .map((exercise) => ({ exercise, score: scoreCandidate(exercise) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((item) => item.exercise);
}
