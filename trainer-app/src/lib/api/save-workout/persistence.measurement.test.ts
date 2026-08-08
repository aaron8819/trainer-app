import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { buildExerciseStimulusSnapshot } from "@/lib/stimulus-accounting/snapshot";
import { applyAcceptedMeasurementSnapshots } from "./persistence";

const measurement = {
  profile: "REPS_EXTERNAL_LOAD" as const,
  loadConvention: "BARBELL_TOTAL" as const,
  repBasis: "TOTAL" as const,
};

function acceptedV3() {
  const exercise = {
    exerciseId: "squat",
    role: "CORE_COMPOUND" as const,
    setCount: 3,
    intent: {
      userRole: "PRIMARY_LIFT" as const,
      target: { kind: "movement_pattern" as const, movementPattern: "squat" as const },
    },
    measurement,
  };
  return {
    version: 3 as const,
    source: "custom_hypertrophy_plan_v1" as const,
    settings: { equipmentProfile: "FULL_GYM" as const, sessionDurationMinutes: 60 as const },
    slots: [
      { slotId: "lower_a", name: "Lower A", focus: "LOWER" as const, exercises: [exercise] },
      { slotId: "lower_b", name: "Lower B", focus: "LOWER" as const, exercises: [exercise] },
    ],
  };
}

const prepared = {
  exerciseId: "squat",
  section: "MAIN" as const,
  measurement,
  movementPatterns: ["SQUAT" as const],
  stimulusAccountingSnapshot: buildExerciseStimulusSnapshot(
    {
      id: "squat",
      name: "Barbell Back Squat",
      primaryMuscles: ["Quads"],
      secondaryMuscles: ["Glutes"],
      stimulusProfile: { quads: 1, glutes: 0.5 },
    },
    "exact",
  ),
  sets: [{ setIndex: 1, targetReps: 8 }],
};

describe("accepted workout measurement snapshot copying", () => {
  it("copies the exact accepted V3 snapshot and rejects client drift", async () => {
    const tx = {
      mesocycleSeedRevision: {
        findUnique: vi.fn().mockResolvedValue({ seedPayload: acceptedV3() }),
      },
    } as unknown as Prisma.TransactionClient;
    await expect(
      applyAcceptedMeasurementSnapshots(tx, {
        seedRevisionId: "revision-v3",
        exercises: [prepared],
      }),
    ).resolves.toEqual([prepared]);
    await expect(
      applyAcceptedMeasurementSnapshots(tx, {
        seedRevisionId: "revision-v3",
        exercises: [
          {
            ...prepared,
            measurement: { ...measurement, loadConvention: "IMPLEMENT_WEIGHT" },
          },
        ],
      }),
    ).rejects.toThrow(/WORKOUT_MEASUREMENT_SNAPSHOT_MISMATCH/);
  });

  it("strips measurement from legacy materialization", async () => {
    const tx = {} as Prisma.TransactionClient;
    const [legacy] = await applyAcceptedMeasurementSnapshots(tx, {
      seedRevisionId: null,
      exercises: [prepared],
    });
    expect(legacy).not.toHaveProperty("measurement");
  });
});
