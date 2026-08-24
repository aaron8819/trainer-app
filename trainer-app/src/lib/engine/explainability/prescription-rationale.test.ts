import { describe, expect, it } from "vitest";
import {
  explainLoadChoice,
  explainPrescriptionRationale,
} from "./prescription-rationale";
import type { FrozenMeasurementSnapshot } from "@/lib/exercise-measurement/semantics";

function narrative(targetLoad: number, measurementSnapshot: FrozenMeasurementSnapshot): string {
  return explainPrescriptionRationale({
    exercise: {
      id: "exercise-1",
      name: "Test Exercise",
      movementPatterns: ["squat"],
      splitTags: ["legs"],
      jointStress: "medium",
      equipment: ["machine"],
    },
    sets: [
      {
        setIndex: 1,
        targetReps: 8,
        targetLoad,
        targetRpe: 8,
      },
    ],
    isMainLift: true,
    goals: { primary: "hypertrophy", secondary: "none" },
    profile: { trainingAge: "intermediate" },
    measurementSnapshot,
  }).overallNarrative;
}

describe("prescription rationale zero-load narrative", () => {
  it.each([
    [
      "Bulgarian semantic zero",
      {
        measurement: {
          profile: "REPS_EXTERNAL_LOAD" as const,
          loadConvention: "IMPLEMENT_WEIGHT" as const,
          repBasis: "PER_SIDE" as const,
        },
        zeroLoadMeaning: "BODYWEIGHT_NO_ADDED_LOAD" as const,
      },
      "@ Bodyweight",
    ],
    [
      "Hack semantic zero",
      {
        measurement: {
          profile: "REPS_EXTERNAL_LOAD" as const,
          loadConvention: "MACHINE_DISPLAYED" as const,
          repBasis: "TOTAL" as const,
        },
        zeroLoadMeaning: "MACHINE_DEFAULT_NO_ADDED_LOAD" as const,
      },
      "@ Machine default / no added load",
    ],
    [
      "legacy-neutral zero",
      { measurement: null, zeroLoadMeaning: null },
      "@ 0lbs",
    ],
  ])("renders %s from semantic context", (_label, snapshot, expected) => {
    const result = narrative(0, snapshot);
    expect(result).toContain(expected);
    if (_label === "legacy-neutral zero") {
      expect(result).not.toContain("Bodyweight");
    }
  });

  it("preserves positive numeric load wording", () => {
    expect(
      narrative(100, {
        measurement: {
          profile: "REPS_EXTERNAL_LOAD",
          loadConvention: "BARBELL_TOTAL",
          repBasis: "TOTAL",
        },
        zeroLoadMeaning: null,
      }),
    ).toContain("@ 100lbs");
  });

  it("does not describe a zero prior load as bodyweight without semantics", () => {
    expect(explainLoadChoice(10, 0, 10, 10, "intermediate").reason).toBe(
      "Working load increased from a zero-load baseline",
    );
  });
});
