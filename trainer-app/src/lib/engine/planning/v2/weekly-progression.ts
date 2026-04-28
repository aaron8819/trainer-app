import type { V2WeeklyProgressionModel } from "./types";

export function buildV2WeeklyProgressionModel(): V2WeeklyProgressionModel {
  return {
    weeks: [
      {
        week: 1,
        phase: "entry_calibration",
        volumeMultiplier: 0.875,
        rirTarget: "3-4",
        progressionIntent: "establish_anchors",
        limitations: ["week_1_uses_flagged_no_repair_evidence"],
      },
      {
        week: 2,
        phase: "accumulation",
        volumeMultiplier: 1,
        rirTarget: "2-3",
        progressionIntent: "productive_volume",
        limitations: ["derived_from_stable_skeleton_not_independent_plan"],
      },
      {
        week: 3,
        phase: "hard_accumulation",
        volumeMultiplier: 1.075,
        rirTarget: "1-2",
        progressionIntent: "push_stimulus",
        limitations: ["derived_from_stable_skeleton_not_independent_plan"],
      },
      {
        week: 4,
        phase: "peak_overreach_lite",
        volumeMultiplier: 1.125,
        rirTarget: "0-1 isolations; 1-2 compounds",
        progressionIntent: "peak_effort",
        limitations: [
          "derived_from_stable_skeleton_not_independent_plan",
          "fatigue_and_concentration_progression_not_fully_projected",
        ],
      },
      {
        week: 5,
        phase: "deload",
        volumeMultiplier: 0.5,
        rirTarget: "4-5",
        progressionIntent: "reduce_fatigue",
        limitations: ["deload_transform_defined_not_production_projected"],
      },
    ],
  };
}
