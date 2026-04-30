export type CalvesFourFourPlannerOnlyPolicyOverride = {
  id: "calves_4_4_lower_slot_allocation";
  readOnly: true;
  appliesOnlyTo: "planner_only_dry_run";
  slots: Array<{
    slotId: "lower_a" | "lower_b";
    muscle: "Calves";
    targetEffectiveSets: 4;
    maxDirectExercises: 1;
    preferredExerciseClass: "calf_raise";
  }>;
};

export type V2CombinedStrategyShadowProjectionOverride = {
  id: "combined_lagging_protection_late_block_cap";
  readOnly: true;
  appliesOnlyTo: "v2_strategy_shadow_projection";
  candidateHypotheses: [
    "protect_lagging_muscles_earlier",
    "cap_late_block_volume",
  ];
  candidateProtectedMuscles: string[];
  candidateDonorMuscles: string[];
  preferRedistributionBeforeNetNewVolume: true;
};

export type PlannerOnlyPolicyOverride =
  | CalvesFourFourPlannerOnlyPolicyOverride
  | V2CombinedStrategyShadowProjectionOverride;

export function createCalvesFourFourPlannerOnlyPolicyOverride(): CalvesFourFourPlannerOnlyPolicyOverride {
  return {
    id: "calves_4_4_lower_slot_allocation",
    readOnly: true,
    appliesOnlyTo: "planner_only_dry_run",
    slots: [
      {
        slotId: "lower_a",
        muscle: "Calves",
        targetEffectiveSets: 4,
        maxDirectExercises: 1,
        preferredExerciseClass: "calf_raise",
      },
      {
        slotId: "lower_b",
        muscle: "Calves",
        targetEffectiveSets: 4,
        maxDirectExercises: 1,
        preferredExerciseClass: "calf_raise",
      },
    ],
  };
}

export function createV2CombinedStrategyShadowProjectionOverride(input: {
  candidateProtectedMuscles: readonly string[];
  candidateDonorMuscles: readonly string[];
}): V2CombinedStrategyShadowProjectionOverride | undefined {
  if (
    input.candidateProtectedMuscles.length === 0 &&
    input.candidateDonorMuscles.length === 0
  ) {
    return undefined;
  }
  return {
    id: "combined_lagging_protection_late_block_cap",
    readOnly: true,
    appliesOnlyTo: "v2_strategy_shadow_projection",
    candidateHypotheses: [
      "protect_lagging_muscles_earlier",
      "cap_late_block_volume",
    ],
    candidateProtectedMuscles: Array.from(
      new Set(input.candidateProtectedMuscles),
    ).sort((left, right) => left.localeCompare(right)),
    candidateDonorMuscles: Array.from(new Set(input.candidateDonorMuscles)).sort(
      (left, right) => left.localeCompare(right),
    ),
    preferRedistributionBeforeNetNewVolume: true,
  };
}
