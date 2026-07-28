import { describe, expect, it } from "vitest";
import {
  STRENGTH_SESSION_TIMING,
  estimateStrengthSessionTiming,
  getStrengthExerciseRestSeconds,
  getStrengthPrimaryWarmupRamp,
  roundStrengthSessionMinutes,
} from "./strength-session-timing";

describe("Strength session timing authority", () => {
  it("defines the complete rest classification used by Strength prescription", () => {
    expect(
      getStrengthExerciseRestSeconds({
        role: "CORE_COMPOUND",
        fatigueCost: 3,
        isCompound: true,
      }),
    ).toBe(240);
    expect(
      getStrengthExerciseRestSeconds({
        role: "CORE_COMPOUND",
        fatigueCost: 4,
        isCompound: true,
      }),
    ).toBe(300);
    expect(
      getStrengthExerciseRestSeconds({
        role: "ACCESSORY",
        fatigueCost: 5,
        isCompound: true,
      }),
    ).toBe(150);
    expect(
      getStrengthExerciseRestSeconds({
        role: "ACCESSORY",
        fatigueCost: 5,
        isCompound: false,
      }),
    ).toBe(90);
    expect(STRENGTH_SESSION_TIMING.countsRestAfterFinalSet).toBe(true);
  });

  it("owns the primary warm-up ramp for every training age", () => {
    expect(getStrengthPrimaryWarmupRamp("beginner")).toHaveLength(2);
    expect(getStrengthPrimaryWarmupRamp("intermediate")).toHaveLength(3);
    expect(getStrengthPrimaryWarmupRamp("advanced")).toHaveLength(3);
  });

  it("includes warm-ups, work, every prescribed rest, and exercise transitions", () => {
    const timing = estimateStrengthSessionTiming({
      trainingAge: "beginner",
      exercises: [
        {
          role: "CORE_COMPOUND",
          setCount: 3,
          fatigueCost: 4,
          isCompound: true,
        },
        {
          role: "ACCESSORY",
          setCount: 2,
          fatigueCost: 2,
          isCompound: false,
        },
      ],
    });

    expect(timing).toEqual({
      primaryWarmupSeconds: 196,
      workSeconds: 146,
      prescribedRestSeconds: 1_080,
      transitionSeconds: 30,
      fixedOverheadSeconds: 0,
      totalSeconds: 1_452,
      estimatedMinutes: 25,
    });
  });

  it("proves transition overhead changes the complete estimate", () => {
    const oneExercise = estimateStrengthSessionTiming({
      trainingAge: "beginner",
      exercises: [
        {
          role: "ACCESSORY",
          setCount: 1,
          fatigueCost: 2,
          isCompound: false,
        },
      ],
    });
    const twoExercises = estimateStrengthSessionTiming({
      trainingAge: "beginner",
      exercises: [
        {
          role: "ACCESSORY",
          setCount: 1,
          fatigueCost: 2,
          isCompound: false,
        },
        {
          role: "ACCESSORY",
          setCount: 1,
          fatigueCost: 2,
          isCompound: false,
        },
      ],
    });

    expect(oneExercise.transitionSeconds).toBe(0);
    expect(twoExercises.transitionSeconds).toBe(
      STRENGTH_SESSION_TIMING.transitionSecondsBetweenExercises,
    );
  });

  it("ceil-rounds immediately below, at, and above a five-minute boundary", () => {
    expect(roundStrengthSessionMinutes(2_699)).toBe(45);
    expect(roundStrengthSessionMinutes(2_700)).toBe(45);
    expect(roundStrengthSessionMinutes(2_701)).toBe(50);
  });
});
