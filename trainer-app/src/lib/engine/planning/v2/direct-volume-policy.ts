import type { V2PlannerSlotId } from "./types";

export type V2DirectVolumeCapacityProfileId =
  | "preferred"
  | "moderate"
  | "minimal";

export type V2DirectVolumeCapacityProfile = {
  id: V2DirectVolumeCapacityProfileId;
  maxSessionSetsBySlot: Record<V2PlannerSlotId, number>;
  maxExerciseCountBySlot: Record<V2PlannerSlotId, number>;
};

export const V2_DIRECT_VOLUME_CAPACITY_YIELD_ORDER = [
  "identity_preferences",
  "optional_triceps_top_up",
  "biceps",
  "rear_delt_surplus",
  "calf_surplus",
  "side_delt_surplus",
  "triceps_surplus",
  "hamstring_surplus",
] as const;

export const V2_DIRECT_VOLUME_CAPACITY_PROFILES: Record<
  V2DirectVolumeCapacityProfileId,
  V2DirectVolumeCapacityProfile
> = {
  preferred: {
    id: "preferred",
    maxSessionSetsBySlot: {
      upper_a: 21,
      lower_a: 11,
      upper_b: 21,
      lower_b: 14,
    },
    maxExerciseCountBySlot: {
      upper_a: 6,
      lower_a: 6,
      upper_b: 7,
      lower_b: 6,
    },
  },
  moderate: {
    id: "moderate",
    maxSessionSetsBySlot: {
      upper_a: 19,
      lower_a: 11,
      upper_b: 17,
      lower_b: 12,
    },
    maxExerciseCountBySlot: {
      upper_a: 6,
      lower_a: 4,
      upper_b: 5,
      lower_b: 4,
    },
  },
  minimal: {
    id: "minimal",
    maxSessionSetsBySlot: {
      upper_a: 17,
      lower_a: 9,
      upper_b: 13,
      lower_b: 11,
    },
    maxExerciseCountBySlot: {
      upper_a: 6,
      lower_a: 3,
      upper_b: 4,
      lower_b: 4,
    },
  },
};
