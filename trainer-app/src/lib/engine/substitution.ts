import type { Exercise, SplitTag } from "./types";

const BLOCKED_TAGS: SplitTag[] = ["core", "mobility", "prehab", "conditioning"];

export function suggestSubstitutes(
  target: Exercise,
  exerciseLibrary: Exercise[],
  painFlags?: Record<string, 0 | 1 | 2 | 3>
) {
  const candidates = applyPainConstraints(
    exerciseLibrary.filter((exercise) => exercise.id !== target.id),
    painFlags
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

function hasBlockedTag(exercise: Exercise) {
  return (exercise.splitTags ?? []).some((tag) => BLOCKED_TAGS.includes(tag));
}

function applyPainConstraints(
  exercises: Exercise[],
  painFlags?: Record<string, 0 | 1 | 2 | 3>
) {
  if (!painFlags) {
    return exercises;
  }

  return exercises.filter((exercise) => {
    const contraindications = exercise.contraindications ?? {};
    const elbowPain = painFlags.elbow !== undefined && painFlags.elbow >= 2;
    const shoulderPain = painFlags.shoulder !== undefined && painFlags.shoulder >= 2;
    const lowBackPain = painFlags.low_back !== undefined && painFlags.low_back >= 2;

    if (elbowPain && contraindications["elbow"]) {
      return false;
    }
    if (shoulderPain && contraindications["shoulder"]) {
      return false;
    }
    if (lowBackPain) {
      if (contraindications["low_back"]) {
        return false;
      }
      if (exercise.movementPatterns?.includes("hinge")) {
        return false;
      }
    }

    const kneePain = painFlags.knee !== undefined && painFlags.knee >= 2;
    const wristPain = painFlags.wrist !== undefined && painFlags.wrist >= 2;
    const hipPain = painFlags.hip !== undefined && painFlags.hip >= 2;

    if (kneePain && contraindications["knee"]) {
      return false;
    }
    if (wristPain && contraindications["wrist"]) {
      return false;
    }
    if (hipPain && contraindications["hip"]) {
      return false;
    }

    return true;
  });
}
