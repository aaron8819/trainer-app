import { describe, expect, it } from "vitest";
import { generateWorkoutFromTemplate, type TemplateExerciseInput } from "./template-session";
import { getPeriodizationModifiers } from "./rules";
import type { Exercise } from "./types";
import type { BlockContext, BlockType } from "./periodization/types";

const bench: Exercise = {
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

const templateExercises: TemplateExerciseInput[] = [{ exercise: bench, orderIndex: 0 }];

const commonOptions = {
  profile: { id: "u1", trainingAge: "intermediate" as const, injuries: [] },
  goals: { primary: "strength" as const, secondary: "none" as const },
  history: [],
  exerciseLibrary: [bench],
  sessionMinutes: 45,
  isStrict: true,
};

function makeBlockContext(
  blockType: BlockType,
  weekInBlock: number,
  durationWeeks: number
): BlockContext {
  return {
    block: {
      id: "block-1",
      mesocycleId: "meso-1",
      blockNumber: 1,
      blockType,
      startWeek: 0,
      durationWeeks,
      volumeTarget: "moderate",
      intensityBias: "strength",
      adaptationType: "neural_adaptation",
    },
    weekInBlock,
    weekInMeso: weekInBlock,
    weekInMacro: weekInBlock,
    mesocycle: {
      id: "meso-1",
      macroCycleId: "macro-1",
      mesoNumber: 1,
      startWeek: 0,
      durationWeeks,
      focus: "Strength Foundation",
      volumeTarget: "moderate",
      intensityBias: "strength",
      blocks: [],
    },
    macroCycle: {
      id: "macro-1",
      userId: "u1",
      startDate: new Date("2026-01-01T00:00:00.000Z"),
      endDate: new Date("2026-03-01T00:00:00.000Z"),
      durationWeeks: 8,
      trainingAge: "intermediate",
      primaryGoal: "strength",
      mesocycles: [],
    },
  };
}

describe("template-session block-aware bridge", () => {
  it("lowers target RPE in accumulation week 1 versus baseline and intensification is higher", () => {
    const baseline = generateWorkoutFromTemplate(templateExercises, {
      ...commonOptions,
      blockContext: null,
    });
    const accumulation = generateWorkoutFromTemplate(templateExercises, {
      ...commonOptions,
      blockContext: makeBlockContext("accumulation", 1, 2),
    });
    const intensification = generateWorkoutFromTemplate(templateExercises, {
      ...commonOptions,
      blockContext: makeBlockContext("intensification", 1, 2),
    });

    const baselineRpe = baseline.workout.mainLifts[0].sets[0].targetRpe ?? 0;
    const accumulationRpe = accumulation.workout.mainLifts[0].sets[0].targetRpe ?? 0;
    const intensificationRpe = intensification.workout.mainLifts[0].sets[0].targetRpe ?? 0;

    expect(accumulationRpe).toBeLessThan(baselineRpe);
    expect(intensificationRpe).toBeGreaterThan(accumulationRpe);
  });

  it("keeps behavior unchanged when blockContext is null", () => {
    const periodization = getPeriodizationModifiers(1, "strength", "intermediate");

    const omitted = generateWorkoutFromTemplate(templateExercises, {
      ...commonOptions,
      periodization,
    });
    const explicitNull = generateWorkoutFromTemplate(templateExercises, {
      ...commonOptions,
      periodization,
      blockContext: null,
    });

    expect(explicitNull.workout.mainLifts[0].sets).toEqual(omitted.workout.mainLifts[0].sets);
    expect(explicitNull.workout.accessories).toEqual(omitted.workout.accessories);
  });

  it("keeps deload target RPE capped and reduces rest seconds", () => {
    const periodization = getPeriodizationModifiers(4, "strength", "intermediate");

    const baseline = generateWorkoutFromTemplate(templateExercises, {
      ...commonOptions,
      periodization,
      blockContext: null,
    });
    const deload = generateWorkoutFromTemplate(templateExercises, {
      ...commonOptions,
      periodization,
      blockContext: makeBlockContext("deload", 1, 1),
    });

    const baselineSet = baseline.workout.mainLifts[0].sets[0];
    const deloadSet = deload.workout.mainLifts[0].sets[0];

    expect(deloadSet.targetRpe ?? 10).toBeLessThanOrEqual(6);
    expect(deloadSet.restSeconds ?? 0).toBeLessThan(baselineSet.restSeconds ?? 0);
  });
});
