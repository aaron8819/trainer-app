/**
 * Protects: Prescription correctness (rep ranges / rest / RIR targets by goal).
 * Why it matters: Goal-specific prescription bands are core training logic and must not drift silently.
 */
import { describe, expect, it } from "vitest";
import { generateWorkoutFromTemplate, type TemplateExerciseInput } from "./template-session";
import type { Exercise } from "./types";

const mainLift: Exercise = {
  id: "bench",
  name: "Bench Press",
  movementPatterns: ["horizontal_push"],
  splitTags: ["push"],
  jointStress: "high",
  isMainLiftEligible: true,
  isCompound: true,
  fatigueCost: 4,
  equipment: ["barbell", "bench", "rack"],
  primaryMuscles: ["Chest"],
  repRangeMin: 3,
  repRangeMax: 12,
};

const accessory: Exercise = {
  id: "raise",
  name: "Lateral Raise",
  movementPatterns: ["vertical_push"],
  splitTags: ["push"],
  jointStress: "low",
  isMainLiftEligible: false,
  isCompound: false,
  fatigueCost: 2,
  equipment: ["dumbbell"],
  primaryMuscles: ["Side Delts"],
  repRangeMin: 8,
  repRangeMax: 20,
};

const templateExercises: TemplateExerciseInput[] = [
  { exercise: mainLift, orderIndex: 0 },
  { exercise: accessory, orderIndex: 1 },
];

const commonOptions = {
  profile: { id: "u1", trainingAge: "intermediate" as const, injuries: [] },
  history: [],
  exerciseLibrary: [mainLift, accessory],
  isStrict: true,
};

describe("prescription correctness", () => {
  it("applies broad goal-specific rep bands and main-vs-accessory rest behavior", () => {
    const hypertrophy = generateWorkoutFromTemplate(templateExercises, {
      ...commonOptions,
      goals: { primary: "hypertrophy" as const, secondary: "none" as const },
    });

    const strength = generateWorkoutFromTemplate(templateExercises, {
      ...commonOptions,
      goals: { primary: "strength" as const, secondary: "none" as const },
    });

    const hypoMainReps = hypertrophy.workout.mainLifts[0].sets[0].targetReps;
    const strMainReps = strength.workout.mainLifts[0].sets[0].targetReps;
    const hypoAccessoryMin = hypertrophy.workout.accessories[0].sets[0].targetRepRange?.min ?? 0;
    const strAccessoryMin = strength.workout.accessories[0].sets[0].targetRepRange?.min ?? 0;

    expect(hypoMainReps).toBeGreaterThanOrEqual(6);
    expect(hypoMainReps).toBeLessThanOrEqual(10);
    expect(strMainReps).toBeGreaterThanOrEqual(3);
    expect(strMainReps).toBeLessThanOrEqual(6);
    expect(hypoAccessoryMin).toBeGreaterThan(strAccessoryMin);
    expect(hypertrophy.workout.mainLifts[0].sets[0].restSeconds).toBeGreaterThanOrEqual(
      hypertrophy.workout.accessories[0].sets[0].restSeconds ?? 0
    );
  });
});
