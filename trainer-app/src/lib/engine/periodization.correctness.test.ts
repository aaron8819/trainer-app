/**
 * Protects: Periodization correctness (week/block effects on prescription/volume/intensity).
 * Why it matters: Week progression must shift prescription direction predictably across a block.
 */
import { describe, expect, it } from "vitest";
import { generateWorkoutFromTemplate, type TemplateExerciseInput } from "./template-session";
import { getPeriodizationModifiers } from "./rules";
import type { Exercise } from "./types";

const squat: Exercise = {
  id: "squat",
  name: "Back Squat",
  movementPatterns: ["squat"],
  splitTags: ["legs"],
  jointStress: "high",
  isMainLiftEligible: true,
  isCompound: true,
  fatigueCost: 5,
  equipment: ["barbell", "rack"],
  primaryMuscles: ["Quads"],
  repRangeMin: 3,
  repRangeMax: 10,
};

const templateExercises: TemplateExerciseInput[] = [{ exercise: squat, orderIndex: 0 }];

const commonOptions = {
  profile: { id: "u1", trainingAge: "intermediate" as const, injuries: [] },
  goals: { primary: "strength" as const, secondary: "none" as const },
  history: [],
  exerciseLibrary: [squat],
  isStrict: true,
};

describe("periodization correctness", () => {
  it("moves from higher-rep/lower-RPE early week to lower-rep/higher-RPE later week", () => {
    const week1 = generateWorkoutFromTemplate(templateExercises, {
      ...commonOptions,
      weekInBlock: 1,
      periodization: getPeriodizationModifiers(1, "strength", "intermediate"),
    });
    const week3 = generateWorkoutFromTemplate(templateExercises, {
      ...commonOptions,
      weekInBlock: 3,
      periodization: getPeriodizationModifiers(3, "strength", "intermediate"),
    });

    const week1Set = week1.workout.mainLifts[0].sets[0];
    const week3Set = week3.workout.mainLifts[0].sets[0];

    expect(week3Set.targetReps).toBeLessThan(week1Set.targetReps);
    expect((week3Set.targetRpe ?? 0)).toBeGreaterThan((week1Set.targetRpe ?? 0));
  });
});
