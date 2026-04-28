import { describe, expect, it } from "vitest";
import { buildV2SetDistributionIntent } from "./v2/set-distribution-intent";

const targetSkeleton = {
  weeks: 5,
  slotSequence: ["upper_a", "lower_a", "upper_b", "lower_b"] as const,
  slots: [
    {
      slotId: "upper_a" as const,
      intent: "horizontal push/pull + rear delt/triceps support",
      targetSessionSets: { min: 15, max: 20 },
      lanes: [
        {
          laneId: "chest_anchor",
          role: "anchor" as const,
          primaryMuscles: ["Chest"],
          preferredExerciseClasses: ["horizontal_press"],
          targetSets: { min: 3, preferred: 4, max: 4 },
        },
        {
          laneId: "rear_delt",
          role: "accessory" as const,
          primaryMuscles: ["Rear Delts"],
          preferredExerciseClasses: ["rear_delt_isolation"],
          targetSets: { min: 2, preferred: 3, max: 3 },
        },
      ],
    },
    {
      slotId: "lower_a" as const,
      intent: "squat-dominant + hamstring support",
      targetSessionSets: { min: 12, max: 18 },
      lanes: [
        {
          laneId: "squat_anchor",
          role: "anchor" as const,
          primaryMuscles: ["Quads"],
          preferredExerciseClasses: ["squat_pattern"],
          targetSets: { min: 3, preferred: 4, max: 4 },
        },
      ],
    },
    {
      slotId: "upper_b" as const,
      intent: "vertical push/pull + side delts/arms",
      targetSessionSets: { min: 15, max: 21 },
      lanes: [
        {
          laneId: "side_delt_isolation",
          role: "accessory" as const,
          primaryMuscles: ["Side Delts"],
          preferredExerciseClasses: ["lateral_raise"],
          targetSets: { min: 3, preferred: 4, max: 4 },
        },
      ],
    },
    {
      slotId: "lower_b" as const,
      intent: "hinge-dominant + quad support + calves",
      targetSessionSets: { min: 10, max: 16 },
      lanes: [
        {
          laneId: "knee_flexion_curl",
          role: "support" as const,
          primaryMuscles: ["Hamstrings"],
          preferredExerciseClasses: ["hamstring_curl"],
          targetSets: { min: 2, preferred: 3, max: 3 },
        },
      ],
    },
  ],
};

const weeklyProgressionModel = {
  weeks: [
    {
      week: 1,
      phase: "entry_calibration" as const,
      volumeMultiplier: 0.875,
      rirTarget: "3-4",
    },
    {
      week: 2,
      phase: "accumulation" as const,
      volumeMultiplier: 1,
      rirTarget: "2-3",
    },
    {
      week: 3,
      phase: "hard_accumulation" as const,
      volumeMultiplier: 1.075,
      rirTarget: "1-2",
    },
    {
      week: 4,
      phase: "peak_overreach_lite" as const,
      volumeMultiplier: 1.125,
      rirTarget: "0-1 isolations; 1-2 compounds",
    },
    {
      week: 5,
      phase: "deload" as const,
      volumeMultiplier: 0.5,
      rirTarget: "4-5",
    },
  ],
};

describe("buildV2SetDistributionIntent", () => {
  it("returns deterministic lane budgets from target skeleton inputs", () => {
    const first = buildV2SetDistributionIntent({
      targetSkeleton,
      weeklyProgressionModel,
    });
    const second = buildV2SetDistributionIntent({
      targetSkeleton,
      weeklyProgressionModel,
    });

    expect(second).toEqual(first);
    expect(first.summary).toMatchObject({
      weekCount: 5,
      slotCount: 4,
      laneCount: 5,
    });
    expect(first.summary.plannedTotalSetsByWeek.map((row) => row.week)).toEqual([
      1,
      2,
      3,
      4,
      5,
    ]);
  });

  it("does not require repaired projection or accepted seed inputs", () => {
    const intent = buildV2SetDistributionIntent({
      targetSkeleton,
      weeklyProgressionModel,
    });

    expect(intent.guardrails).toEqual({
      doesNotUseRepairedProjectionAsTarget: true,
      doesNotUseAcceptedSeedAsTarget: true,
      doesNotAffectSelection: true,
      doesNotAffectRepair: true,
      doesNotAffectRuntimeReplay: true,
    });
    expect(intent.weeks[0].slots[0].lanes[0].evidenceBasis).toEqual(
      expect.arrayContaining([
        "ignores_no_repair_repaired_seed_runtime_output",
      ])
    );
  });

  it("exposes min preferred max lane budgets separately from cap and concentration policy", () => {
    const intent = buildV2SetDistributionIntent({
      targetSkeleton,
      weeklyProgressionModel,
    });
    const chest = intent.weeks[1].slots
      .find((slot) => slot.slotId === "upper_a")
      ?.lanes.find((lane) => lane.laneId === "chest_anchor");
    const rearDelt = intent.weeks[1].slots
      .find((slot) => slot.slotId === "upper_a")
      ?.lanes.find((lane) => lane.laneId === "rear_delt");

    expect(chest?.setBudget).toEqual({
      min: 3,
      preferred: 4,
      max: 4,
      basis: "target_lane",
    });
    expect(chest?.capPolicy).toEqual({
      maxSetsPerExerciseWithoutJustification: 5,
      maxDirectExercises: 2,
      allowAboveFiveSetsOnlyWithJustification: true,
    });
    expect(chest?.concentrationPolicy).toEqual({
      warningShare: 0.5,
      blockerShare: 0.6,
      appliesTo: "primary_target",
    });
    expect(rearDelt?.setBudget).toEqual({
      min: 2,
      preferred: 3,
      max: 3,
      basis: "exercise_class_role",
    });
    expect(rearDelt?.concentrationPolicy.appliesTo).toBe("support_target");
  });

  it("marks deload budgets as a deload transform without changing read-only flags", () => {
    const intent = buildV2SetDistributionIntent({
      targetSkeleton,
      weeklyProgressionModel,
    });
    const deloadChest = intent.weeks[4].slots[0].lanes[0];

    expect(intent.readOnly).toBe(true);
    expect(intent.affectsScoringOrGeneration).toBe(false);
    expect(deloadChest.setBudget).toEqual({
      min: 2,
      preferred: 2,
      max: 2,
      basis: "deload_transform",
    });
  });
});
