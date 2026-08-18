import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { buildExerciseStimulusSnapshot } from "@/lib/stimulus-accounting/snapshot";
import {
  applyAcceptedMeasurementSnapshots,
  buildPersistedExercisesForSave,
} from "./persistence";

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

function acceptedV4() {
  const prescriptions = [
    { week: 1, status: "PRESCRIBE" as const, setCount: 3, reps: { kind: "RANGE" as const, min: 5, max: 8 }, rir: { kind: "TARGET_RANGE" as const, min: 3, max: 4 } },
    { week: 2, status: "PRESCRIBE" as const, setCount: 3, reps: { kind: "RANGE" as const, min: 5, max: 8 }, rir: { kind: "TARGET_RANGE" as const, min: 3, max: 3 } },
    { week: 3, status: "PRESCRIBE" as const, setCount: 3, reps: { kind: "RANGE" as const, min: 5, max: 8 }, rir: { kind: "TARGET_RANGE" as const, min: 2, max: 3 } },
    { week: 4, status: "PRESCRIBE" as const, setCount: 3, reps: { kind: "RANGE" as const, min: 5, max: 8 }, rir: { kind: "TARGET_RANGE" as const, min: 1, max: 2 } },
    { week: 5, status: "PRESCRIBE" as const, setCount: 2, reps: { kind: "RANGE" as const, min: 5, max: 8 }, rir: { kind: "TARGET_RANGE" as const, min: 4, max: 5 } },
  ];
  const exercise = (placementId: string) => ({
    placementId,
    exerciseId: "squat",
    role: "CORE_COMPOUND" as const,
    intent: {
      userRole: "PRIMARY_LIFT" as const,
      target: { kind: "movement_pattern" as const, movementPattern: "squat" as const },
    },
    measurement,
    prescriptions,
  });
  return {
    version: 4 as const,
    source: "custom_hypertrophy_plan_v2" as const,
    settings: { equipmentProfile: "FULL_GYM" as const, sessionDurationMinutes: 60 as const },
    weeks: [
      { week: 1, phase: "ACCUMULATION" as const },
      { week: 2, phase: "ACCUMULATION" as const },
      { week: 3, phase: "ACCUMULATION" as const },
      { week: 4, phase: "ACCUMULATION" as const },
      { week: 5, phase: "DELOAD" as const },
    ],
    slots: [
      { slotId: "lower_a", name: "Lower A", focus: "LOWER" as const, exercises: [exercise("squat-a")] },
      { slotId: "lower_b", name: "Lower B", focus: "LOWER" as const, exercises: [exercise("squat-b")] },
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

  it("copies the server-authored V4 snapshot and rejects client drift", async () => {
    const tx = {
      mesocycleSeedRevision: {
        findUnique: vi.fn().mockResolvedValue({ seedPayload: acceptedV4() }),
      },
    } as unknown as Prisma.TransactionClient;

    await expect(
      applyAcceptedMeasurementSnapshots(tx, {
        seedRevisionId: "revision-v4",
        exercises: [prepared],
      }),
    ).resolves.toEqual([prepared]);
    await expect(
      applyAcceptedMeasurementSnapshots(tx, {
        seedRevisionId: "revision-v4",
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

  it("persists an unresolved calibrated target as null", () => {
    expect(
      buildPersistedExercisesForSave([
        {
          exerciseId: "squat",
          section: "MAIN",
          measurement,
          sets: [{ setIndex: 1, targetReps: 5, targetRpe: 6.5 }],
        },
      ])[0].sets[0].targetLoad,
    ).toBeNull();
  });
});
