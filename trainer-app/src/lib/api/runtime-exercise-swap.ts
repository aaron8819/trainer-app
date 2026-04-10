export type RuntimeExerciseSwapProfile = {
  id: string;
  name: string;
  fatigueCost?: number | null;
  jointStress?: string | null;
  isMainLift?: boolean | null;
  isMainLiftEligible?: boolean | null;
  isCompound?: boolean | null;
  hasRecentHistory?: boolean | null;
  movementPatterns?: string[] | null;
  primaryMuscles?: string[] | null;
  equipment?: string[] | null;
};

export type RuntimeExerciseSwapEligibilityBlockCode =
  | "WORKOUT_NOT_OPEN"
  | "PARTIALLY_LOGGED_EXERCISE_BLOCKED"
  | "FULLY_LOGGED_EXERCISE_BLOCKED"
  | "ALREADY_SWAPPED"
  | "INSUFFICIENT_METADATA";

export type RuntimeExerciseSwapWorkoutState = {
  status: string;
  loggedSetCount: number;
  totalSetCount: number;
  isRuntimeAdded: boolean;
  isAlreadySwapped: boolean;
};

export type RuntimeExerciseSwapEligibilityDecision =
  | { eligible: true }
  | { eligible: false; reasonCode: RuntimeExerciseSwapEligibilityBlockCode };

export type RuntimeExerciseSwapEligibility = {
  primaryMuscleOverlap: string[];
  movementPatternOverlap: string[];
  movementFamilyOverlap: string[];
  movementMatch: "exact" | "family";
  roleMatch: boolean;
  equipmentDemandStayedAtOrBelowOriginal: boolean;
  equipmentDemandDelta: number;
  jointStressDelta: number;
  fatigueDelta: number;
  historyMatch: boolean;
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
const JOINT_STRESS_DEMAND: Record<string, number> = {
  low: 1,
  medium: 2,
  high: 3,
};

const MOVEMENT_FAMILY_BY_PATTERN: Record<string, string> = {
  horizontal_push: "push",
  vertical_push: "push",
  horizontal_pull: "pull",
  vertical_pull: "pull",
  squat: "knee_dominant",
  lunge: "knee_dominant",
  hinge: "hip_dominant",
  carry: "carry",
  rotation: "trunk",
  anti_rotation: "trunk",
  flexion: "trunk",
  extension: "trunk",
  abduction: "frontal_plane",
  adduction: "frontal_plane",
  isolation: "isolation",
  calf_raise_extended: "calf",
  calf_raise_flexed: "calf",
};

function normalizeList(values: string[] | null | undefined): string[] {
  return (values ?? [])
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0);
}

function intersect(left: string[], right: string[]): string[] {
  const rightSet = new Set(right);
  return left.filter((value) => rightSet.has(value));
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function resolveMovementFamilies(patterns: string[]): string[] {
  return unique(
    patterns.flatMap((pattern) => MOVEMENT_FAMILY_BY_PATTERN[pattern] ?? []),
  );
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

function resolveJointStressDemand(
  exercise: RuntimeExerciseSwapProfile,
): number | null {
  const stress = exercise.jointStress?.trim().toLowerCase();
  if (!stress) {
    return null;
  }

  return JOINT_STRESS_DEMAND[stress] ?? null;
}

function hasSufficientExerciseMetadata(
  exercise: RuntimeExerciseSwapProfile,
): boolean {
  return (
    normalizeList(exercise.primaryMuscles).length > 0 &&
    normalizeList(exercise.movementPatterns).length > 0 &&
    resolveJointStressDemand(exercise) != null
  );
}

function buildReason(input: RuntimeExerciseSwapEligibility): string {
  const muscleText =
    input.primaryMuscleOverlap.length > 0
      ? input.primaryMuscleOverlap.join(", ")
      : "the same primary musculature";
  const patternText =
    input.movementPatternOverlap.length > 0
      ? input.movementPatternOverlap.join(", ")
      : input.movementFamilyOverlap.join(", ");
  const fatigueText =
    input.fatigueDelta === 0
      ? "keeps fatigue flat"
      : `reduces fatigue by ${Math.abs(input.fatigueDelta)}`;
  const equipmentText = input.equipmentDemandStayedAtOrBelowOriginal
    ? "without raising equipment complexity"
    : "with a different equipment demand";

  return `Keeps ${muscleText}, matches ${patternText}, and ${fatigueText} ${equipmentText}.`;
}

export function isSwapEligible(
  sourceExercise: RuntimeExerciseSwapProfile,
  workoutState: RuntimeExerciseSwapWorkoutState,
): RuntimeExerciseSwapEligibilityDecision {
  if (
    workoutState.status !== "PLANNED" &&
    workoutState.status !== "IN_PROGRESS" &&
    workoutState.status !== "PARTIAL"
  ) {
    return { eligible: false, reasonCode: "WORKOUT_NOT_OPEN" };
  }

  if (
    workoutState.totalSetCount > 0 &&
    workoutState.loggedSetCount >= workoutState.totalSetCount
  ) {
    return { eligible: false, reasonCode: "FULLY_LOGGED_EXERCISE_BLOCKED" };
  }

  if (workoutState.loggedSetCount > 0) {
    return { eligible: false, reasonCode: "PARTIALLY_LOGGED_EXERCISE_BLOCKED" };
  }

  if (workoutState.isAlreadySwapped) {
    return { eligible: false, reasonCode: "ALREADY_SWAPPED" };
  }

  if (!hasSufficientExerciseMetadata(sourceExercise)) {
    return { eligible: false, reasonCode: "INSUFFICIENT_METADATA" };
  }

  return { eligible: true };
}

export function evaluateRuntimeExerciseSwapEligibility(input: {
  current: RuntimeExerciseSwapProfile;
  candidate: RuntimeExerciseSwapProfile;
}): RuntimeExerciseSwapEligibility | null {
  if (input.current.id === input.candidate.id) {
    return null;
  }

  if (
    !hasSufficientExerciseMetadata(input.current) ||
    !hasSufficientExerciseMetadata(input.candidate)
  ) {
    return null;
  }

  const currentPrimary = normalizeList(input.current.primaryMuscles);
  const candidatePrimary = normalizeList(input.candidate.primaryMuscles);
  const currentPatterns = normalizeList(input.current.movementPatterns);
  const candidatePatterns = normalizeList(input.candidate.movementPatterns);

  const primaryMuscleOverlap = intersect(currentPrimary, candidatePrimary);
  if (primaryMuscleOverlap.length === 0) {
    return null;
  }

  const movementPatternOverlap = intersect(currentPatterns, candidatePatterns);
  const movementFamilyOverlap = intersect(
    resolveMovementFamilies(currentPatterns),
    resolveMovementFamilies(candidatePatterns),
  );
  const movementMatch = movementPatternOverlap.length > 0 ? "exact" : "family";
  if (movementFamilyOverlap.length === 0) {
    return null;
  }

  if (
    input.current.isMainLift &&
    (!(input.candidate.isMainLiftEligible ?? false) ||
      candidatePatterns.includes("isolation"))
  ) {
    return null;
  }

  const currentJointStress = resolveJointStressDemand(input.current);
  const candidateJointStress = resolveJointStressDemand(input.candidate);
  if (currentJointStress == null || candidateJointStress == null) {
    return null;
  }
  const jointStressDelta = candidateJointStress - currentJointStress;
  if (jointStressDelta > 0) {
    return null;
  }

  const fatigueDelta =
    (input.candidate.fatigueCost ?? 3) - (input.current.fatigueCost ?? 3);
  if (fatigueDelta > 0) {
    return null;
  }

  const candidateEquipmentDemand = resolveEquipmentDemand(input.candidate);
  const currentEquipmentDemand = resolveEquipmentDemand(input.current);
  const equipmentDemandDelta =
    candidateEquipmentDemand - currentEquipmentDemand;
  const equipmentDemandStayedAtOrBelowOriginal = equipmentDemandDelta <= 0;
  const roleMatch =
    Boolean(input.current.isMainLift) ===
    Boolean(input.candidate.isMainLiftEligible);
  const historyMatch = Boolean(input.candidate.hasRecentHistory);

  return {
    primaryMuscleOverlap,
    movementPatternOverlap,
    movementFamilyOverlap,
    movementMatch,
    roleMatch,
    equipmentDemandStayedAtOrBelowOriginal,
    equipmentDemandDelta,
    jointStressDelta,
    fatigueDelta,
    historyMatch,
    score:
      (movementMatch === "exact" ? 200 : 100) +
      primaryMuscleOverlap.length * 5 +
      movementFamilyOverlap.length * 4 +
      (roleMatch ? 3 : 0) +
      Math.max(0, -equipmentDemandDelta) +
      Math.max(0, -jointStressDelta) +
      Math.max(0, -fatigueDelta) +
      (historyMatch ? 1 : 0),
  };
}

export function buildRuntimeExerciseSwapCandidates(input: {
  current: RuntimeExerciseSwapProfile;
  candidates: RuntimeExerciseSwapProfile[];
  excludedExerciseIds?: Set<string>;
  limit?: number;
}): RuntimeExerciseSwapCandidate[] {
  return input.candidates
    .flatMap((candidate) => {
      if (input.excludedExerciseIds?.has(candidate.id)) {
        return [];
      }

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
      const movementRank = (entry: RuntimeExerciseSwapCandidate) =>
        entry.compatibility.movementMatch === "exact" ? 2 : 1;
      if (movementRank(right) !== movementRank(left)) {
        return movementRank(right) - movementRank(left);
      }
      if (
        right.compatibility.primaryMuscleOverlap.length !==
        left.compatibility.primaryMuscleOverlap.length
      ) {
        return (
          right.compatibility.primaryMuscleOverlap.length -
          left.compatibility.primaryMuscleOverlap.length
        );
      }
      if (right.compatibility.roleMatch !== left.compatibility.roleMatch) {
        return right.compatibility.roleMatch ? 1 : -1;
      }
      if (
        left.compatibility.equipmentDemandDelta !==
        right.compatibility.equipmentDemandDelta
      ) {
        return (
          left.compatibility.equipmentDemandDelta -
          right.compatibility.equipmentDemandDelta
        );
      }
      if (
        left.compatibility.jointStressDelta !==
        right.compatibility.jointStressDelta
      ) {
        return (
          left.compatibility.jointStressDelta -
          right.compatibility.jointStressDelta
        );
      }
      if (
        left.compatibility.fatigueDelta !== right.compatibility.fatigueDelta
      ) {
        return (
          left.compatibility.fatigueDelta - right.compatibility.fatigueDelta
        );
      }
      if (
        right.compatibility.historyMatch !== left.compatibility.historyMatch
      ) {
        return right.compatibility.historyMatch ? 1 : -1;
      }
      return left.exerciseName.localeCompare(right.exerciseName);
    })
    .slice(0, input.limit ?? 5);
}
