import type { Exercise, Muscle, MovementPatternV2, WorkoutPlan } from "@/lib/engine/types";
import { getEffectiveStimulusByMuscle } from "@/lib/engine/stimulus";
import type { SessionIntent } from "@/lib/engine/session-types";

export const MAX_ACCESSORY_LANE_INSERTIONS_PER_WEEK = 2;
export const MAX_ACCESSORY_LANE_PER_SLOT = 1;

export type AccessoryLaneMuscle = "Core" | "Adductors" | "Abductors" | "Forearms";

export type AccessoryLaneInsertion = {
  muscle: AccessoryLaneMuscle;
  exercise: Exercise;
};

export type AccessoryLaneDecision =
  | {
      insert: true;
      insertion: AccessoryLaneInsertion;
    }
  | {
      insert: false;
      reason: string;
    };

const MATERIAL_DEFICIT_THRESHOLD = 1;
const MIN_LANE_STIMULUS_PER_SET = 0.5;
const MAX_LOW_FATIGUE_COST = 2;

export const ACCESSORY_LANE_MUSCLES: AccessoryLaneMuscle[] = [
  "Core",
  "Adductors",
  "Abductors",
  "Forearms",
];

const LANE_COMPATIBILITY: Record<AccessoryLaneMuscle, readonly SessionIntent[]> = {
  Core: ["lower", "legs", "full_body"],
  Adductors: ["lower", "legs", "full_body"],
  Abductors: ["lower", "legs", "full_body"],
  Forearms: ["pull", "upper", "full_body"],
};

const CORE_LOW_INTERFERENCE_PATTERNS = new Set<MovementPatternV2>([
  "anti_rotation",
  "rotation",
  "flexion",
  "extension",
  "isolation",
]);

function countWorkoutExercises(workout: WorkoutPlan): number {
  return workout.mainLifts.length + workout.accessories.length;
}

function getSelectedExercises(workout: WorkoutPlan): Exercise[] {
  return [...workout.mainLifts, ...workout.accessories].map((entry) => entry.exercise);
}

function getSelectedExerciseIds(workout: WorkoutPlan): Set<string> {
  return new Set(getSelectedExercises(workout).map((exercise) => exercise.id));
}

function getMovementPatterns(exercises: readonly Exercise[]): Set<MovementPatternV2> {
  const patterns = new Set<MovementPatternV2>();
  for (const exercise of exercises) {
    for (const pattern of exercise.movementPatterns ?? []) {
      patterns.add(pattern);
    }
  }
  return patterns;
}

function hasMeaningfulHingeStress(workout: WorkoutPlan): boolean {
  return getSelectedExercises(workout).some((exercise) => {
    const patterns = exercise.movementPatterns ?? [];
    if (!patterns.includes("hinge")) {
      return false;
    }
    if ((exercise.isCompound ?? false) || (exercise.fatigueCost ?? 3) >= 3) {
      return true;
    }
    return (getEffectiveStimulusByMuscle(exercise, 1, { logFallback: false }).get("Lower Back") ?? 0) >= 0.5;
  });
}

function isSlotCompatible(muscle: AccessoryLaneMuscle, slotIntent: SessionIntent): boolean {
  return LANE_COMPATIBILITY[muscle].includes(slotIntent);
}

function getLaneStimulus(exercise: Exercise, muscle: AccessoryLaneMuscle): number {
  return getEffectiveStimulusByMuscle(exercise, 1, { logFallback: false }).get(muscle) ?? 0;
}

function getProjectedDeficit(input: {
  muscle: AccessoryLaneMuscle;
  weeklyTargetByMuscle: ReadonlyMap<Muscle, number>;
  projectedEffectiveSetsByMuscle: ReadonlyMap<Muscle, number>;
}): number {
  const target = input.weeklyTargetByMuscle.get(input.muscle) ?? 0;
  const projected = input.projectedEffectiveSetsByMuscle.get(input.muscle) ?? 0;
  return Math.max(0, target - projected);
}

function selectLaneMuscle(input: {
  slotIntent: SessionIntent;
  workout: WorkoutPlan;
  weeklyTargetByMuscle: ReadonlyMap<Muscle, number>;
  projectedEffectiveSetsByMuscle: ReadonlyMap<Muscle, number>;
}): AccessoryLaneMuscle | null {
  const deficits = ACCESSORY_LANE_MUSCLES.flatMap((muscle, priority) => {
    if (!isSlotCompatible(muscle, input.slotIntent)) {
      return [];
    }
    if (muscle === "Core" && hasMeaningfulHingeStress(input.workout)) {
      return [];
    }
    const deficit = getProjectedDeficit({
      muscle,
      weeklyTargetByMuscle: input.weeklyTargetByMuscle,
      projectedEffectiveSetsByMuscle: input.projectedEffectiveSetsByMuscle,
    });
    return deficit >= MATERIAL_DEFICIT_THRESHOLD ? [{ muscle, deficit, priority }] : [];
  });

  if (deficits.length === 0) {
    return null;
  }

  deficits.sort((left, right) => {
    const forearmPriorityDelta =
      (left.muscle === "Forearms" ? 1 : 0) - (right.muscle === "Forearms" ? 1 : 0);
    if (forearmPriorityDelta !== 0) {
      return forearmPriorityDelta;
    }
    if (right.deficit !== left.deficit) {
      return right.deficit - left.deficit;
    }
    return left.priority - right.priority;
  });

  return deficits[0]?.muscle ?? null;
}

function isCoreCandidateFatigueCompatible(exercise: Exercise): boolean {
  if ((exercise.movementPatterns ?? []).includes("hinge")) {
    return false;
  }
  return (exercise.movementPatterns ?? []).some((pattern) =>
    CORE_LOW_INTERFERENCE_PATTERNS.has(pattern)
  );
}

function isLaneCandidate(input: {
  exercise: Exercise;
  muscle: AccessoryLaneMuscle;
  selectedExerciseIds: ReadonlySet<string>;
}): boolean {
  const exercise = input.exercise;
  if (input.selectedExerciseIds.has(exercise.id)) {
    return false;
  }
  if ((exercise.isMainLiftEligible ?? false) || (exercise.isCompound ?? false)) {
    return false;
  }
  if ((exercise.fatigueCost ?? 3) > MAX_LOW_FATIGUE_COST) {
    return false;
  }
  if (input.muscle === "Core" && !isCoreCandidateFatigueCompatible(exercise)) {
    return false;
  }
  return getLaneStimulus(exercise, input.muscle) >= MIN_LANE_STIMULUS_PER_SET;
}

function getInterferenceScore(input: {
  exercise: Exercise;
  muscle: AccessoryLaneMuscle;
  selectedMovementPatterns: ReadonlySet<MovementPatternV2>;
}): number {
  const candidatePatterns = input.exercise.movementPatterns ?? [];
  const duplicatePatternPenalty = candidatePatterns.some((pattern) =>
    input.selectedMovementPatterns.has(pattern)
  )
    ? 1
    : 0;
  const collateralStimulus = Array.from(
    getEffectiveStimulusByMuscle(input.exercise, 1, { logFallback: false }).entries()
  ).reduce(
    (sum, [muscle, effectiveSets]) => sum + (muscle === input.muscle ? 0 : effectiveSets),
    0
  );

  return duplicatePatternPenalty + collateralStimulus;
}

function rankCandidates(input: {
  candidates: Exercise[];
  muscle: AccessoryLaneMuscle;
  selectedMovementPatterns: ReadonlySet<MovementPatternV2>;
}): Exercise[] {
  return [...input.candidates].sort((left, right) => {
    const fatigueDelta = (left.fatigueCost ?? 3) - (right.fatigueCost ?? 3);
    if (fatigueDelta !== 0) {
      return fatigueDelta;
    }

    const interferenceDelta =
      getInterferenceScore({
        exercise: left,
        muscle: input.muscle,
        selectedMovementPatterns: input.selectedMovementPatterns,
      }) -
      getInterferenceScore({
        exercise: right,
        muscle: input.muscle,
        selectedMovementPatterns: input.selectedMovementPatterns,
      });
    if (interferenceDelta !== 0) {
      return interferenceDelta;
    }

    const sfrDelta = (right.sfrScore ?? 0) - (left.sfrScore ?? 0);
    if (sfrDelta !== 0) {
      return sfrDelta;
    }

    const stimulusDelta =
      getLaneStimulus(right, input.muscle) - getLaneStimulus(left, input.muscle);
    if (stimulusDelta !== 0) {
      return stimulusDelta;
    }

    return `${left.name}:${left.id}`.localeCompare(`${right.name}:${right.id}`);
  });
}

export function selectAccessoryLaneInsertion(input: {
  slotIntent: SessionIntent;
  workout: WorkoutPlan;
  exerciseLibrary: readonly Exercise[];
  weeklyTargetByMuscle: ReadonlyMap<Muscle, number>;
  projectedEffectiveSetsByMuscle: ReadonlyMap<Muscle, number>;
  maxExercises: number;
  weeklyInsertionCount: number;
  slotInsertionCount?: number;
  slotQualityPreserved: boolean;
}): AccessoryLaneDecision {
  if (input.weeklyInsertionCount >= MAX_ACCESSORY_LANE_INSERTIONS_PER_WEEK) {
    return { insert: false, reason: "weekly_cap_reached" };
  }
  if ((input.slotInsertionCount ?? 0) >= MAX_ACCESSORY_LANE_PER_SLOT) {
    return { insert: false, reason: "slot_cap_reached" };
  }
  if (countWorkoutExercises(input.workout) >= input.maxExercises) {
    return { insert: false, reason: "session_cap_reached" };
  }
  if (!input.slotQualityPreserved) {
    return { insert: false, reason: "slot_quality_not_preserved" };
  }

  const muscle = selectLaneMuscle({
    slotIntent: input.slotIntent,
    workout: input.workout,
    weeklyTargetByMuscle: input.weeklyTargetByMuscle,
    projectedEffectiveSetsByMuscle: input.projectedEffectiveSetsByMuscle,
  });
  if (!muscle) {
    return { insert: false, reason: "no_material_compatible_deficit" };
  }

  const selectedExerciseIds = getSelectedExerciseIds(input.workout);
  const selectedMovementPatterns = getMovementPatterns(getSelectedExercises(input.workout));
  const candidates = input.exerciseLibrary.filter((exercise) =>
    isLaneCandidate({ exercise, muscle, selectedExerciseIds })
  );
  const selectedExercise = rankCandidates({ candidates, muscle, selectedMovementPatterns })[0];
  if (!selectedExercise) {
    return { insert: false, reason: "no_reasonable_candidate" };
  }

  return {
    insert: true,
    insertion: {
      muscle,
      exercise: selectedExercise,
    },
  };
}
