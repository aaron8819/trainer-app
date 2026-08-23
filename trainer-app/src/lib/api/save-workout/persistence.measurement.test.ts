import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { buildExerciseStimulusSnapshot } from "@/lib/stimulus-accounting/snapshot";
import {
  applyAcceptedMeasurementSnapshots,
  buildPersistedExercisesForSave,
  prepareWorkoutExercisesForPersistence,
  rewriteWorkoutExercises,
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
  zeroLoadMeaning: null,
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
    const seedPayload = acceptedV4();
    const acceptedPayloadBefore = JSON.stringify(seedPayload);
    const tx = {
      mesocycleSeedRevision: {
        findUnique: vi.fn().mockResolvedValue({ seedPayload }),
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
    expect(JSON.stringify(seedPayload)).toBe(acceptedPayloadBefore);
  });

  it("copies the canonical zero-load capability during normal materialization", async () => {
    const tx = {
      exercise: {
        findUnique: vi.fn().mockResolvedValue({
          id: "bulgarian",
          name: "Bulgarian Split Squat",
          movementPatterns: ["LUNGE"],
          zeroLoadMeaning: "BODYWEIGHT_NO_ADDED_LOAD",
          aliases: [],
          exerciseMuscles: [],
        }),
      },
    } as unknown as Prisma.TransactionClient;

    const [result] = await prepareWorkoutExercisesForPersistence(tx, [
      {
        exerciseId: "bulgarian",
        section: "ACCESSORY",
        sets: [{ setIndex: 1, targetReps: 8 }],
      },
    ]);

    expect(result.zeroLoadMeaning).toBe("BODYWEIGHT_NO_ADDED_LOAD");
  });

  it("persists the frozen capability without adding it to accepted measurement data", async () => {
    const create = vi.fn().mockResolvedValue({ id: "we-1" });
    const tx = {
      workoutExercise: {
        findMany: vi.fn().mockResolvedValue([]),
        create,
      },
      workoutSet: { deleteMany: vi.fn() },
    } as unknown as Prisma.TransactionClient;

    await rewriteWorkoutExercises(tx, {
      workoutId: "workout-1",
      exercises: [
        {
          ...prepared,
          measurement: {
            profile: "REPS_EXTERNAL_LOAD",
            loadConvention: "IMPLEMENT_WEIGHT",
            repBasis: "PER_SIDE",
          },
          zeroLoadMeaning: "BODYWEIGHT_NO_ADDED_LOAD",
        },
      ],
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          zeroLoadMeaning: "BODYWEIGHT_NO_ADDED_LOAD",
        }),
      }),
    );
  });

  it("rejects incompatible frozen capability tuples at the persistence writer", async () => {
    const tx = {
      workoutExercise: {
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn(),
      },
      workoutSet: { deleteMany: vi.fn() },
    } as unknown as Prisma.TransactionClient;

    await expect(
      rewriteWorkoutExercises(tx, {
        workoutId: "workout-1",
        exercises: [
          {
            ...prepared,
            zeroLoadMeaning: "BODYWEIGHT_NO_ADDED_LOAD",
          },
        ],
      })
    ).rejects.toThrow("ZERO_LOAD_MEANING_MEASUREMENT_MISMATCH");
  });

  it("strips measurement from legacy materialization", async () => {
    const tx = {} as Prisma.TransactionClient;
    const [legacy] = await applyAcceptedMeasurementSnapshots(tx, {
      seedRevisionId: null,
      exercises: [prepared],
    });
    expect(legacy).not.toHaveProperty("measurement");
    expect(legacy.zeroLoadMeaning).toBeNull();
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
