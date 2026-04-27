export type PlannerOnlyPolicyOverride = {
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

export function createCalvesFourFourPlannerOnlyPolicyOverride(): PlannerOnlyPolicyOverride {
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
