type SwapExerciseProfile = {
  id: string;
  name: string;
  isMainLiftEligible?: boolean | null;
  fatigueCost?: number | null;
  movementPatterns?: string[] | null;
  primaryMuscles?: string[] | null;
  equipment?: string[] | null;
};

export type GapFillSwapEligibility = {
  targetMuscleOverlap: string[];
  movementPatternOverlap: string[];
  equipmentDemandStayedAtOrBelowOriginal: boolean;
  fatigueDelta: number;
  score: number;
};

export type GapFillSwapCandidate = {
  exerciseId: string;
  exerciseName: string;
  primaryMuscles: string[];
  equipment: string[];
  compatibility: GapFillSwapEligibility;
  reason: string;
};

const GUIDED_EQUIPMENT = new Set(["machine", "cable", "band", "sled"]);
const FREE_WEIGHT_EQUIPMENT = new Set(["dumbbell", "kettlebell"]);
const TECHNICAL_EQUIPMENT = new Set(["barbell", "ez_bar", "trap_bar", "rack"]);

function normalizeList(values: string[] | null | undefined): string[] {
  return (values ?? [])
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0);
}

function intersect(left: string[], right: string[]): string[] {
  const rightSet = new Set(right);
  return left.filter((value) => rightSet.has(value));
}

function resolveEquipmentDemand(exercise: SwapExerciseProfile): number {
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

function buildReason(input: {
  targetMuscleOverlap: string[];
  movementPatternOverlap: string[];
  fatigueDelta: number;
  equipmentDemandStayedAtOrBelowOriginal: boolean;
}): string {
  const muscleText =
    input.targetMuscleOverlap.length > 0
      ? input.targetMuscleOverlap.join(", ")
      : "the planned target muscles";
  const movementText =
    input.movementPatternOverlap.length > 0
      ? input.movementPatternOverlap.join(", ")
      : "the planned movement pattern";
  const fatigueText =
    input.fatigueDelta === 0
      ? "keeps fatigue flat"
      : `reduces fatigue by ${Math.abs(input.fatigueDelta)}`;
  const equipmentText = input.equipmentDemandStayedAtOrBelowOriginal
    ? "does not escalate equipment demand"
    : "changes equipment demand";

  return `Covers ${muscleText}, matches ${movementText}, ${fatigueText}, and ${equipmentText}.`;
}

export function evaluateGapFillSwapEligibility(input: {
  current: SwapExerciseProfile;
  candidate: SwapExerciseProfile;
  targetMuscles?: string[] | null;
}): GapFillSwapEligibility | null {
  if (input.current.id === input.candidate.id) {
    return null;
  }
  if (input.candidate.isMainLiftEligible) {
    return null;
  }

  const currentPrimary = normalizeList(input.current.primaryMuscles);
  const candidatePrimary = normalizeList(input.candidate.primaryMuscles);
  const currentPatterns = normalizeList(input.current.movementPatterns);
  const candidatePatterns = normalizeList(input.candidate.movementPatterns);
  const targetMuscles = normalizeList(input.targetMuscles);

  const primaryOverlap = intersect(currentPrimary, candidatePrimary);
  if (primaryOverlap.length === 0) {
    return null;
  }

  const movementPatternOverlap = intersect(currentPatterns, candidatePatterns);
  if (movementPatternOverlap.length === 0) {
    return null;
  }

  const targetMuscleOverlap =
    targetMuscles.length > 0 ? intersect(candidatePrimary, targetMuscles) : primaryOverlap;
  if (targetMuscles.length > 0 && targetMuscleOverlap.length === 0) {
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
    targetMuscleOverlap,
    movementPatternOverlap,
    equipmentDemandStayedAtOrBelowOriginal,
    fatigueDelta,
    score:
      targetMuscleOverlap.length * 6 +
      primaryOverlap.length * 5 +
      movementPatternOverlap.length * 4 +
      Math.max(0, Math.abs(fatigueDelta)),
  };
}

export function buildGapFillSwapCandidates(input: {
  current: SwapExerciseProfile;
  candidates: SwapExerciseProfile[];
  targetMuscles?: string[] | null;
  limit?: number;
}): GapFillSwapCandidate[] {
  return input.candidates
    .flatMap((candidate) => {
      const compatibility = evaluateGapFillSwapEligibility({
        current: input.current,
        candidate,
        targetMuscles: input.targetMuscles,
      });
      if (!compatibility) {
        return [];
      }

      return [{
        exerciseId: candidate.id,
        exerciseName: candidate.name,
        primaryMuscles: normalizeList(candidate.primaryMuscles),
        equipment: normalizeList(candidate.equipment),
        compatibility,
        reason: buildReason(compatibility),
      }];
    })
    .sort((left, right) => {
      if (right.compatibility.score !== left.compatibility.score) {
        return right.compatibility.score - left.compatibility.score;
      }
      return left.exerciseName.localeCompare(right.exerciseName);
    })
    .slice(0, input.limit ?? 5);
}
