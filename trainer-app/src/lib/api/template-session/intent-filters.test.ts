import { describe, expect, it } from "vitest";

import { enforceIntentAlignment } from "./intent-filters";
import type { Exercise } from "@/lib/engine/types";
import type { SelectionOutput } from "@/lib/engine/session-types";

describe("intent filter evidence guardrails", () => {
  it("records diagnostics instead of failing when some selected exercises are off-intent", () => {
    const pool: Exercise[] = [
      {
        id: "bench",
        name: "Bench Press",
        movementPatterns: ["horizontal_push"],
        splitTags: ["push"],
        jointStress: "medium",
        isMainLiftEligible: true,
        isCompound: true,
        fatigueCost: 4,
        sfrScore: 4,
        lengthPositionScore: 3,
        equipment: ["barbell"],
        primaryMuscles: ["Chest"],
        secondaryMuscles: ["Front Delts", "Triceps"],
      },
      {
        id: "row",
        name: "Barbell Row",
        movementPatterns: ["horizontal_pull"],
        splitTags: ["pull"],
        jointStress: "medium",
        isMainLiftEligible: true,
        isCompound: true,
        fatigueCost: 4,
        sfrScore: 3,
        lengthPositionScore: 3,
        equipment: ["barbell"],
        primaryMuscles: ["Lats", "Upper Back"],
        secondaryMuscles: ["Biceps"],
      },
    ];

    const selection: SelectionOutput = {
      selectedExerciseIds: ["bench", "row"],
      mainLiftIds: ["bench", "row"],
      accessoryIds: [],
      perExerciseSetTargets: { bench: 4, row: 4 },
      volumePlanByMuscle: {},
      rationale: {
        bench: {
          score: 1,
          components: {},
          hardFilterPass: true,
          selectedStep: "main_pick",
        },
        row: {
          score: 1,
          components: {},
          hardFilterPass: true,
          selectedStep: "main_pick",
        },
      },
    };

    const result = enforceIntentAlignment(selection, pool, "push");

    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.intentDiagnostics?.alignedRatio).toBe(0.5);
    expect(result.intentDiagnostics?.minAlignedRatio).toBe(0);
  });
});
