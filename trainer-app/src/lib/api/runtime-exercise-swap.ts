export type RuntimeExerciseSwapProfile = {
  id: string;
  name: string;
  fatigueCost?: number | null;
  movementPatterns?: string[] | null;
  primaryMuscles?: string[] | null;
  equipment?: string[] | null;
};

export type RuntimeExerciseSwapEligibility = {
  primaryMuscleOverlap: string[];
  movementPatternOverlap: string[];
  equipmentDemandStayedAtOrBelowOriginal: boolean;
  fatigueDelta: number;
  score: number;
};

export type RuntimeExerciseSwapCandidate = {
  exerciseId: string;
  exerciseName: string;
  primaryMuscles: string[];
  equipment: string[];
  compatibility: RuntimeExerciseSwapEligibility;
  reason: string;
};

const GUIDED_EQUIPMENT = new Set(["machine", "cable", "band", "sled"]);
const FREE_WEIGHT_EQUIPMENT = new Set(["dumbbell", "kettlebell"]);
const TECHNICAL_EQUIPMENT = new Set(["barbell", "ez_bar", "trap_bar", "rack"]);
const SUPPORTED_PULL_PATTERNS = new Set(["horizontal_pull", "vertical_pull"]);

function normalizeList(values: string[] | null | undefined): string[] {
  return (values ?? [])
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0);
}

function intersect(left: string[], right: string[]): string[] {
  const rightSet = new Set(right);
  return left.filter((value) => rightSet.has(value));
}

function resolveEquipmentDemand(exercise: RuntimeExerciseSwapProfile): number {
  const equipment = normalizeList(exercise.equipment);
  let demand = 0;

  for (const item of equipment) {
    if (TECHNICAL_EQUIPMENT.has(item)) {
      demand = Math.max(demand, 3);
    } else if (FREE_WEIGHT_EQUIPMENT.has(item)) {
      demand = Math.max(demand, 2);
    } else if (GUIDED_EQUIPMENT.has(item)) {
      demand = Math.max(demand, 1);
    }
  }

  return demand;
}

function buildReason(input: RuntimeExerciseSwapEligibility): string {
  const muscleText =
    input.primaryMuscleOverlap.length > 0
      ? input.primaryMuscleOverlap.join(", ")
      : "the same pull musculature";
  const patternText =
    input.movementPatternOverlap.length > 0
      ? input.movementPatternOverlap.join(", ")
      : "the same pull pattern";
  const fatigueText =
    input.fatigueDelta === 0
      ? "keeps fatigue flat"
      : `reduces fatigue by ${Math.abs(input.fatigueDelta)}`;
  const equipmentText = input.equipmentDemandStayedAtOrBelowOriginal
    ? "without raising equipment complexity"
    : "with a different equipment demand";

  return `Keeps ${muscleText}, matches ${patternText}, and ${fatigueText} ${equipmentText}.`;
}

export function isSupportedRuntimeExerciseSwapPattern(
  movementPatterns: string[] | null | undefined
): boolean {
  return normalizeList(movementPatterns).some((pattern) =>
    SUPPORTED_PULL_PATTERNS.has(pattern)
  );
}

export function evaluateRuntimeExerciseSwapEligibility(input: {
  current: RuntimeExerciseSwapProfile;
  candidate: RuntimeExerciseSwapProfile;
}): RuntimeExerciseSwapEligibility | null {
  if (input.current.id === input.candidate.id) {
    return null;
  }

  const currentPrimary = normalizeList(input.current.primaryMuscles);
  const candidatePrimary = normalizeList(input.candidate.primaryMuscles);
  const currentPatterns = normalizeList(input.current.movementPatterns).filter((pattern) =>
    SUPPORTED_PULL_PATTERNS.has(pattern)
  );
  const candidatePatterns = normalizeList(input.candidate.movementPatterns).filter((pattern) =>
    SUPPORTED_PULL_PATTERNS.has(pattern)
  );

  if (currentPatterns.length === 0 || candidatePatterns.length === 0) {
    return null;
  }

  const primaryMuscleOverlap = intersect(currentPrimary, candidatePrimary);
  if (primaryMuscleOverlap.length === 0) {
    return null;
  }

  const movementPatternOverlap = intersect(currentPatterns, candidatePatterns);
  if (movementPatternOverlap.length === 0) {
    return null;
  }

  const fatigueDelta = (input.candidate.fatigueCost ?? 3) - (input.current.fatigueCost ?? 3);
  if (fatigueDelta > 0) {
    return null;
  }

  const equipmentDemandStayedAtOrBelowOriginal =
    resolveEquipmentDemand(input.candidate) <= resolveEquipmentDemand(input.current);
  if (!equipmentDemandStayedAtOrBelowOriginal) {
    return null;
  }

  return {
    primaryMuscleOverlap,
    movementPatternOverlap,
    equipmentDemandStayedAtOrBelowOriginal,
    fatigueDelta,
    score:
      primaryMuscleOverlap.length * 5 +
      movementPatternOverlap.length * 4 +
      Math.max(0, Math.abs(fatigueDelta)),
  };
}

export function buildRuntimeExerciseSwapCandidates(input: {
  current: RuntimeExerciseSwapProfile;
  candidates: RuntimeExerciseSwapProfile[];
  limit?: number;
}): RuntimeExerciseSwapCandidate[] {
  return input.candidates
    .flatMap((candidate) => {
      const compatibility = evaluateRuntimeExerciseSwapEligibility({
        current: input.current,
        candidate,
      });
      if (!compatibility) {
        return [];
      }

      return [
        {
          exerciseId: candidate.id,
          exerciseName: candidate.name,
          primaryMuscles: normalizeList(candidate.primaryMuscles),
          equipment: normalizeList(candidate.equipment),
          compatibility,
          reason: buildReason(compatibility),
        } satisfies RuntimeExerciseSwapCandidate,
      ];
    })
    .sort((left, right) => {
      if (right.compatibility.score !== left.compatibility.score) {
        return right.compatibility.score - left.compatibility.score;
      }
      return left.exerciseName.localeCompare(right.exerciseName);
    })
    .slice(0, input.limit ?? 5);
}
