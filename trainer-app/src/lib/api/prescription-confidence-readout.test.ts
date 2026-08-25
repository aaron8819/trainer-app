import { describe, expect, it } from "vitest";
import { buildPrescriptionConfidenceReadouts } from "./prescription-confidence-readout";
import type { MeasurementSemantics, ZeroLoadMeaning } from "@/lib/exercise-measurement/semantics";
import type { WorkoutPlan } from "@/lib/engine/types";

function workout(input: {
  targetLoad: number;
  measurement: MeasurementSemantics | null;
  zeroLoadMeaning: ZeroLoadMeaning | null;
}): WorkoutPlan {
  return {
    id: "workout-1",
    scheduledDate: "2026-08-23T12:00:00.000Z",
    warmup: [],
    mainLifts: [
      {
        id: "workout-exercise-1",
        exercise: {
          id: "exercise-1",
          name: "Test Exercise",
          movementPatterns: ["squat"],
          splitTags: ["legs"],
          jointStress: "medium",
          equipment: ["machine"],
        },
        orderIndex: 0,
        isMainLift: true,
        measurement: input.measurement ?? undefined,
        zeroLoadMeaning: input.zeroLoadMeaning,
        sets: [
          {
            setIndex: 1,
            targetReps: 8,
            targetLoad: input.targetLoad,
            targetRpe: 8,
          },
        ],
      },
    ],
    accessories: [],
    estimatedMinutes: 15,
  };
}

describe("prescription confidence zero-load source", () => {
  it.each([
    [
      "Bulgarian semantic zero",
      {
        profile: "REPS_EXTERNAL_LOAD" as const,
        loadConvention: "IMPLEMENT_WEIGHT" as const,
        repBasis: "PER_SIDE" as const,
      },
      "BODYWEIGHT_NO_ADDED_LOAD" as const,
      "bodyweight",
    ],
    [
      "Hack semantic zero",
      {
        profile: "REPS_EXTERNAL_LOAD" as const,
        loadConvention: "MACHINE_DISPLAYED" as const,
        repBasis: "TOTAL" as const,
      },
      "MACHINE_DEFAULT_NO_ADDED_LOAD" as const,
      "machine_default",
    ],
    ["legacy-neutral zero", null, null, "neutral_zero"],
  ])("classifies %s without guessing from zero", (_label, measurement, zeroLoadMeaning, source) => {
    const [readout] = buildPrescriptionConfidenceReadouts({
      workout: workout({ targetLoad: 0, measurement, zeroLoadMeaning }),
    });

    expect(readout?.loadSource).toBe(source);
  });

  it("preserves positive history source behavior", () => {
    const [readout] = buildPrescriptionConfidenceReadouts({
      workout: workout({
        targetLoad: 100,
        measurement: {
          profile: "REPS_EXTERNAL_LOAD",
          loadConvention: "BARBELL_TOTAL",
          repBasis: "TOTAL",
        },
        zeroLoadMeaning: null,
      }),
      loadAudit: {
        progressionTraces: {},
        selectedAnchorEvidence: {},
        resolvedLoads: {
          "workout-exercise-1": {
            placementId: "workout-exercise-1",
            canonicalExerciseId: "exercise-1",
            source: "history",
          },
        },
      } as never,
    });

    expect(readout?.loadSource).toBe("history");
  });
});
