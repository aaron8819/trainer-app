import type { WorkoutSessionIntent } from "@prisma/client";
import type { SlotLanePlanLane } from "@/lib/engine/selection-v2";
import type { ProjectedSlotWorkout } from "./mesocycle-handoff-slot-plan-projection.coverage-evaluation";

type SlotSequenceEntry = {
  slotId: string;
  intent: WorkoutSessionIntent;
};

function isCurrentUpperLowerHypertrophyLaneSlice(
  slotSequence: readonly SlotSequenceEntry[],
): boolean {
  const slots = slotSequence.map((slot) => `${slot.slotId}:${slot.intent}`);
  return (
    slots.length === 4 &&
    slots[0] === "upper_a:UPPER" &&
    slots[1] === "lower_a:LOWER" &&
    slots[2] === "upper_b:UPPER" &&
    slots[3] === "lower_b:LOWER"
  );
}

function lane(
  slotId: string,
  laneId: string,
  preferredClasses: SlotLanePlanLane["preferredClasses"],
  preferredSets: number,
  options?: {
    minSets?: number;
    optional?: boolean;
    avoidExerciseIds?: string[];
  },
): SlotLanePlanLane {
  return {
    slotId,
    laneId,
    preferredClasses,
    minSets: options?.minSets ?? preferredSets,
    preferredSets,
    ...(options?.optional === true ? { optional: true } : {}),
    ...(options?.avoidExerciseIds && options.avoidExerciseIds.length > 0
      ? { avoidExerciseIds: options.avoidExerciseIds }
      : {}),
    source: "hypertrophy_upper_lower_slot_lane_plan",
  };
}

function getPriorChestAnchorExerciseIds(
  previousProjectedSlots: readonly ProjectedSlotWorkout[],
): string[] {
  return previousProjectedSlots.flatMap((slot) =>
    slot.workout.mainLifts
      .filter((exercise) =>
        (exercise.exercise.primaryMuscles ?? []).some(
          (muscle) => muscle.trim().toLowerCase() === "chest",
        ),
      )
      .map((exercise) => exercise.exercise.id),
  );
}

export function buildHypertrophyUpperLowerLanePlan(input: {
  slotId: string;
  slotSequence: readonly SlotSequenceEntry[];
  previousProjectedSlots?: readonly ProjectedSlotWorkout[];
}): SlotLanePlanLane[] {
  if (!isCurrentUpperLowerHypertrophyLaneSlice(input.slotSequence)) {
    return [];
  }

  const priorChestAnchorExerciseIds = getPriorChestAnchorExerciseIds(
    input.previousProjectedSlots ?? [],
  );

  switch (input.slotId) {
    case "upper_a":
      return [
        lane("upper_a", "chest_anchor", ["horizontal_press", "slight_incline_press"], 3),
        lane("upper_a", "row_anchor", ["chest_supported_row", "cable_row", "t_bar_row"], 3),
        lane("upper_a", "vertical_pull_support", ["pulldown", "assisted_pullup"], 2),
        lane("upper_a", "chest_secondary", ["chest_fly", "machine_press", "cable_press"], 2),
        lane("upper_a", "rear_delt", ["rear_delt_fly", "reverse_pec_deck"], 2),
        lane("upper_a", "triceps", ["triceps_isolation"], 2),
      ];
    case "lower_a":
      return [
        lane("lower_a", "squat_anchor", ["back_squat", "hack_squat", "leg_press"], 4),
        lane("lower_a", "quad_isolation", ["leg_extension"], 2),
        lane("lower_a", "hamstring_curl", ["seated_leg_curl", "lying_leg_curl"], 2),
        lane("lower_a", "secondary_hinge", ["rdl", "sldl", "light_hinge"], 2),
        lane("lower_a", "calves", ["calf_raise"], 3),
      ];
    case "upper_b":
      return [
        lane("upper_b", "vertical_press", ["overhead_press", "machine_shoulder_press"], 3),
        lane("upper_b", "vertical_pull_anchor", ["pulldown", "assisted_pullup"], 3),
        lane(
          "upper_b",
          "chest_second_exposure",
          ["machine_press", "horizontal_press", "chest_fly", "cable_press"],
          3,
          { avoidExerciseIds: priorChestAnchorExerciseIds },
        ),
        lane("upper_b", "row_support", ["cable_row", "chest_supported_row"], 2),
        lane("upper_b", "side_delt_isolation", ["lateral_raise"], 3),
        lane("upper_b", "biceps", ["biceps_curl"], 3),
        lane("upper_b", "optional_triceps", ["triceps_isolation"], 0, {
          minSets: 0,
          optional: true,
        }),
      ];
    case "lower_b":
      return [
        lane("lower_b", "hinge_anchor", ["rdl", "sldl", "light_hinge"], 3),
        lane("lower_b", "knee_flexion_curl", ["seated_leg_curl", "lying_leg_curl", "nordic_curl"], 2),
        lane("lower_b", "quad_support", ["leg_press", "split_squat", "goblet_squat", "leg_extension"], 2),
        lane("lower_b", "calves", ["calf_raise"], 4),
      ];
    default:
      return [];
  }
}
