import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  workoutFindFirst: vi.fn(),
  profileFindUnique: vi.fn(),
  goalsFindUnique: vi.fn(),
  exerciseFindMany: vi.fn(),
  setLogFindMany: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    workout: { findFirst: mocks.workoutFindFirst },
    profile: { findUnique: mocks.profileFindUnique },
    goals: { findUnique: mocks.goalsFindUnique },
    exercise: { findMany: mocks.exerciseFindMany },
    setLog: { findMany: mocks.setLogFindMany },
  },
}));

import { resolveRuntimeAddedExercisePreviews } from "./runtime-added-exercise-preview";
import { buildRevisedFourDayPlanAcceptedSeed } from "@/lib/engine/hypertrophy-plan-authoring-v4-revised.fixture";

function acceptedV3Seed() {
  const measurement = {
    profile: "REPS_EXTERNAL_LOAD" as const,
    loadConvention: "MACHINE_DISPLAYED" as const,
    repBasis: "TOTAL" as const,
  };
  return {
    version: 3 as const,
    source: "custom_hypertrophy_plan_v1" as const,
    settings: {
      equipmentProfile: "FULL_GYM" as const,
      sessionDurationMinutes: 60 as const,
    },
    slots: ["upper", "lower"].map((slotId) => ({
      slotId,
      name: slotId === "upper" ? "Upper" : "Lower",
      focus: slotId === "upper" ? "UPPER" as const : "LOWER" as const,
      exercises: [{
        exerciseId: `${slotId}-exercise`,
        role: "ACCESSORY" as const,
        setCount: 3,
        intent: {
          userRole: "ACCESSORY" as const,
          target: {
            kind: "muscle" as const,
            muscleId: slotId === "upper" ? "biceps" as const : "calves" as const,
          },
        },
        measurement,
      }],
    })),
  };
}

function exercise(input: {
  id: string;
  measurementProfile?: string | null;
  loadConvention?: string | null;
  repBasis?: string | null;
  zeroLoadMeaning?: string | null;
  name?: string;
}) {
  return {
    id: input.id,
    name: input.name ?? input.id,
    repRangeMin: 8,
    repRangeMax: 12,
    fatigueCost: 2,
    isCompound: false,
    measurementProfile: input.measurementProfile ?? null,
    loadConvention: input.loadConvention ?? null,
    repBasis: input.repBasis ?? null,
    zeroLoadMeaning: input.zeroLoadMeaning ?? null,
    exerciseEquipment: [],
  };
}

describe("runtime-added measurement previews", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.profileFindUnique.mockResolvedValue({ trainingAge: "INTERMEDIATE" });
    mocks.goalsFindUnique.mockResolvedValue({ primaryGoal: "HYPERTROPHY" });
    mocks.setLogFindMany.mockResolvedValue([
      {
        actualLoad: 185,
        workoutSet: { workoutExercise: { exerciseId: "classified" } },
      },
    ]);
  });

  it("filters unclassified V3 candidates and never previews a historical load", async () => {
    mocks.workoutFindFirst.mockResolvedValue({
      selectionMetadata: {},
      seedRevision: { seedPayload: acceptedV3Seed() },
      exercises: [],
    });
    mocks.exerciseFindMany.mockResolvedValue([
      exercise({
        id: "classified",
        measurementProfile: "REPS_EXTERNAL_LOAD",
        loadConvention: "BARBELL_TOTAL",
        repBasis: "TOTAL",
      }),
      exercise({ id: "unclassified" }),
    ]);

    const previews = await resolveRuntimeAddedExercisePreviews({
      workoutId: "workout",
      userId: "user",
      exerciseIds: ["classified", "unclassified"],
    });

    expect(previews).toHaveLength(1);
    expect(previews[0]).toMatchObject({
      exerciseId: "classified",
      targetLoad: null,
      measurement: {
        profile: "REPS_EXTERNAL_LOAD",
        loadConvention: "BARBELL_TOTAL",
        repBasis: "TOTAL",
      },
      zeroLoadMeaning: null,
    });
  });

  it("freezes complete Bulgarian and Hack semantics in accepted V4 add previews", async () => {
    mocks.workoutFindFirst.mockResolvedValue({
      selectionMetadata: {},
      seedRevision: { seedPayload: buildRevisedFourDayPlanAcceptedSeed() },
      exercises: [],
    });
    mocks.exerciseFindMany.mockResolvedValue([
      exercise({
        id: "bulgarian",
        name: "Bulgarian Split Squat",
        measurementProfile: "REPS_EXTERNAL_LOAD",
        loadConvention: "IMPLEMENT_WEIGHT",
        repBasis: "PER_SIDE",
        zeroLoadMeaning: "BODYWEIGHT_NO_ADDED_LOAD",
      }),
      exercise({
        id: "hack",
        name: "Hack Squat",
        measurementProfile: "REPS_EXTERNAL_LOAD",
        loadConvention: "MACHINE_DISPLAYED",
        repBasis: "TOTAL",
        zeroLoadMeaning: "MACHINE_DEFAULT_NO_ADDED_LOAD",
      }),
    ]);

    const previews = await resolveRuntimeAddedExercisePreviews({
      workoutId: "workout",
      userId: "user",
      exerciseIds: ["bulgarian", "hack"],
    });

    expect(previews).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          exerciseId: "bulgarian",
          measurement: {
            profile: "REPS_EXTERNAL_LOAD",
            loadConvention: "IMPLEMENT_WEIGHT",
            repBasis: "PER_SIDE",
          },
          zeroLoadMeaning: "BODYWEIGHT_NO_ADDED_LOAD",
          targetLoad: null,
        }),
        expect.objectContaining({
          exerciseId: "hack",
          measurement: {
            profile: "REPS_EXTERNAL_LOAD",
            loadConvention: "MACHINE_DISPLAYED",
            repBasis: "TOTAL",
          },
          zeroLoadMeaning: "MACHINE_DEFAULT_NO_ADDED_LOAD",
          targetLoad: null,
        }),
      ])
    );
  });

  it("retains legacy preview behavior", async () => {
    mocks.workoutFindFirst.mockResolvedValue({
      selectionMetadata: {},
      seedRevision: null,
      exercises: [],
    });
    mocks.exerciseFindMany.mockResolvedValue([exercise({ id: "classified" })]);

    const [preview] = await resolveRuntimeAddedExercisePreviews({
      workoutId: "workout",
      userId: "user",
      exerciseIds: ["classified"],
    });

    expect(preview?.targetLoad).toBe(185);
  });
});
