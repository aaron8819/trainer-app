import { describe, expect, it } from "vitest";
import { normalizeAcceptedSeedPayload } from "@/lib/api/mesocycle-seed-revision";
import exerciseCatalog from "../../../prisma/exercises_comprehensive.json";
import {
  buildStrengthPlanPolicy,
  getStrengthRirTarget,
  toStrengthSlotPlanSeed,
  toStrengthSlotSequence,
  type StrengthExerciseCandidate,
  type StrengthPlanConfiguration,
} from "./strength-plan-policy";

function exercise(
  id: string,
  name: string,
  movementPattern: StrengthExerciseCandidate["movementPatterns"][number],
  equipment: string[],
  overrides: Partial<StrengthExerciseCandidate> = {},
): StrengthExerciseCandidate {
  return {
    id,
    name,
    movementPatterns: [movementPattern],
    equipment,
    contraindications: [],
    isMainLiftEligible: true,
    isCompound: true,
    fatigueCost: 3,
    ...overrides,
  };
}

const catalog: StrengthExerciseCandidate[] = [
  exercise("back-squat", "Barbell Back Squat", "squat", ["Barbell", "Rack"], {
    fatigueCost: 5,
    contraindications: ["knee", "low_back"],
  }),
  exercise("front-squat", "Front Squat", "squat", ["Barbell", "Rack"]),
  exercise("goblet-squat", "Goblet Squat", "squat", [
    "Dumbbell",
    "Kettlebell",
  ]),
  exercise("leg-press", "Leg Press", "squat", ["Machine"]),
  exercise(
    "deadlift",
    "Conventional Deadlift",
    "hinge",
    ["Barbell"],
    { fatigueCost: 5, contraindications: ["low_back"] },
  ),
  exercise("rdl", "Romanian Deadlift", "hinge", ["Barbell", "Dumbbell"]),
  exercise("glute-bridge", "Glute Bridge", "hinge", [
    "Barbell",
    "Dumbbell",
    "Bodyweight",
  ]),
  exercise("machine-hip-thrust", "Machine Hip Thrust", "hinge", ["Machine"]),
  exercise(
    "bench",
    "Barbell Bench Press",
    "horizontal_push",
    ["Barbell", "Bench"],
  ),
  exercise(
    "db-bench",
    "Dumbbell Bench Press",
    "horizontal_push",
    ["Dumbbell", "Bench"],
  ),
  exercise(
    "machine-press",
    "Machine Chest Press",
    "horizontal_push",
    ["Machine"],
  ),
  exercise("push-up", "Push-Up", "horizontal_push", ["Bodyweight"]),
  exercise(
    "ohp",
    "Barbell Overhead Press",
    "vertical_push",
    ["Barbell", "Rack"],
  ),
  exercise(
    "db-ohp",
    "Dumbbell Overhead Press",
    "vertical_push",
    ["Dumbbell", "Bench"],
  ),
  exercise(
    "machine-shoulder",
    "Machine Shoulder Press",
    "vertical_push",
    ["Machine"],
  ),
  exercise(
    "dip",
    "Dip (Triceps Emphasis)",
    "vertical_push",
    ["Bodyweight", "Machine"],
  ),
  exercise("barbell-row", "Barbell Row", "horizontal_pull", ["Barbell"]),
  exercise(
    "db-row",
    "One-Arm Dumbbell Row",
    "horizontal_pull",
    ["Dumbbell", "Bench"],
  ),
  exercise(
    "machine-row",
    "Chest-Supported T-Bar Row",
    "horizontal_pull",
    ["Machine"],
  ),
  exercise("inverted-row", "Inverted Row", "horizontal_pull", ["Bodyweight"]),
  exercise("pull-up", "Pull-Up", "vertical_pull", ["Bodyweight"]),
  exercise("lat-pulldown", "Lat Pulldown", "vertical_pull", [
    "Cable",
    "Machine",
  ]),
  exercise("split-squat", "Bulgarian Split Squat", "lunge", [
    "Dumbbell",
    "Bench",
  ]),
  exercise("leg-curl", "Lying Leg Curl", "flexion", ["Machine"], {
    isMainLiftEligible: false,
    isCompound: false,
  }),
  exercise("face-pull", "Face Pull", "horizontal_pull", ["Cable"], {
    isMainLiftEligible: false,
    isCompound: false,
  }),
  exercise("plank", "Plank", "anti_rotation", ["Bodyweight"], {
    isMainLiftEligible: false,
    isCompound: false,
  }),
];

const baseConfiguration: StrengthPlanConfiguration = {
  emphasis: "BALANCED",
  daysPerWeek: 4,
  sessionDurationMinutes: 60,
  equipmentProfile: "FULL_GYM",
  preferredLifts: {
    squat: "BACK_SQUAT",
    press: "BARBELL_BENCH",
    hinge: "CONVENTIONAL_DEADLIFT",
  },
};

describe("strength plan policy", () => {
  it("builds a deterministic, stable weekly strength structure", () => {
    const input = {
      configuration: baseConfiguration,
      trainingAge: "intermediate" as const,
      limitations: [],
      exercises: [...catalog].reverse(),
    };

    const first = buildStrengthPlanPolicy(input);
    const second = buildStrengthPlanPolicy(input);

    expect(second).toEqual(first);
    expect(first).toMatchObject({
      version: 1,
      source: "strength_plan_policy_v1",
      mesocycleWeeks: 5,
      sessionsPerWeek: 4,
      splitType: "UPPER_LOWER",
      resolvedPrimaryLifts: {
        squat: "Barbell Back Squat",
        press: "Barbell Bench Press",
        hinge: "Conventional Deadlift",
      },
    });
    expect(first.slots.map((slot) => slot.slotId)).toEqual([
      "strength_lower_a",
      "strength_upper_a",
      "strength_lower_b",
      "strength_upper_b",
    ]);
    expect(
      first.slots.every((slot) => slot.exercises.length <= 5),
    ).toBe(true);
    expect(
      first.slots
        .flatMap((slot) => slot.exercises)
        .every((entry) =>
          entry.role === "CORE_COMPOUND"
            ? entry.setCount === 4
            : entry.setCount === 2,
        ),
    ).toBe(true);
  });

  it("substitutes equipment-incompatible and contraindicated preferences", () => {
    const policy = buildStrengthPlanPolicy({
      configuration: {
        ...baseConfiguration,
        equipmentProfile: "MACHINES",
      },
      trainingAge: "intermediate",
      limitations: ["knee", "low_back"],
      exercises: catalog,
    });

    expect(policy.resolvedPrimaryLifts).toEqual({
      squat: "Leg Press",
      press: "Machine Chest Press",
      hinge: expect.stringMatching(/Hip Thrust/),
    });
    expect(policy.substitutions).toEqual(
      expect.arrayContaining([
        "Barbell Back Squat → Leg Press",
        "Barbell Bench Press → Machine Chest Press",
        expect.stringMatching(/^Conventional Deadlift → /),
      ]),
    );
    const chosen = new Set(
      policy.slots.flatMap((slot) =>
        slot.exercises.map((entry) => entry.exerciseId),
      ),
    );
    expect(chosen.has("back-squat")).toBe(false);
    expect(chosen.has("deadlift")).toBe(false);
  });

  it("uses lower volume for short sessions and preserves required primary work", () => {
    const policy = buildStrengthPlanPolicy({
      configuration: {
        ...baseConfiguration,
        daysPerWeek: 3,
        sessionDurationMinutes: 45,
      },
      trainingAge: "beginner",
      limitations: [],
      exercises: catalog,
    });

    expect(policy.slots).toHaveLength(3);
    expect(
      policy.slots.every(
        (slot) =>
          slot.exercises.length <= 4 &&
          slot.exercises.some((entry) => entry.role === "CORE_COMPOUND"),
      ),
    ).toBe(true);
    expect(
      policy.slots
        .flatMap((slot) => slot.exercises)
        .filter((entry) => entry.role === "CORE_COMPOUND")
        .every((entry) => entry.setCount === 3),
    ).toBe(true);
  });

  it("fails explicitly when a required movement lane cannot be resolved", () => {
    expect(() =>
      buildStrengthPlanPolicy({
        configuration: baseConfiguration,
        trainingAge: "intermediate",
        limitations: [],
        exercises: catalog.filter(
          (entry) => !entry.movementPatterns.includes("vertical_push"),
        ),
      }),
    ).toThrow(
      "STRENGTH_PLAN_REQUIRED_LANE_UNAVAILABLE:strength_upper_b:vertical_push",
    );
  });

  it("preserves configuration as explanatory evidence but accepts only executable seed truth", () => {
    const policy = buildStrengthPlanPolicy({
      configuration: baseConfiguration,
      trainingAge: "intermediate",
      limitations: [],
      exercises: catalog,
    });
    const sequence = toStrengthSlotSequence(policy);
    const seed = toStrengthSlotPlanSeed(policy);
    const accepted = normalizeAcceptedSeedPayload(seed);

    expect(sequence.strengthConfiguration).toMatchObject({
      emphasis: "BALANCED",
      daysPerWeek: 4,
      resolvedPrimaryLifts: {
        squat: "Barbell Back Squat",
      },
    });
    expect(accepted.canonicalPayload).toEqual({
      version: 1,
      source: "strength_plan_policy_v1",
      slots: seed.slots.map((slot) => ({
        slotId: slot.slotId,
        exercises: slot.exercises.map((entry) => ({
          exerciseId: entry.exerciseId,
          role: entry.role,
          setCount: entry.setCount,
        })),
      })),
    });
  });

  it("uses conservative effort targets and a high-RIR deload", () => {
    expect(
      getStrengthRirTarget({
        blockType: "accumulation",
        weekInBlock: 1,
      }),
    ).toEqual({ min: 3, max: 4 });
    expect(
      getStrengthRirTarget({
        blockType: "intensification",
        weekInBlock: 2,
      }),
    ).toEqual({ min: 1, max: 2 });
    expect(
      getStrengthRirTarget({ blockType: "deload", weekInBlock: 1 }),
    ).toEqual({ min: 4, max: 5 });
  });

  it("resolves every offered frequency and equipment profile from the shipped catalog", () => {
    const shippedCatalog = exerciseCatalog.exercises.map((entry, index) => ({
      id: `catalog-${index}`,
      name: entry.name,
      movementPatterns:
        entry.movementPatterns as StrengthExerciseCandidate["movementPatterns"],
      equipment: entry.equipment,
      contraindications: Object.entries(entry.contraindications ?? {}).flatMap(
        ([key, enabled]) => (enabled ? [key] : []),
      ),
      isMainLiftEligible: entry.isMainLiftEligible,
      isCompound: entry.isCompound,
      fatigueCost: entry.fatigueCost,
    }));

    for (const equipmentProfile of [
      "FULL_GYM",
      "BARBELL_HOME",
      "DUMBBELLS",
      "MACHINES",
      "BODYWEIGHT",
    ] as const) {
      for (const daysPerWeek of [2, 3, 4, 5] as const) {
        const policy = buildStrengthPlanPolicy({
          configuration: {
            ...baseConfiguration,
            daysPerWeek,
            sessionDurationMinutes: 45,
            equipmentProfile,
            preferredLifts: {
              squat: "AUTO",
              press: "AUTO",
              hinge: "AUTO",
            },
          },
          trainingAge: "intermediate",
          limitations: [],
          exercises: shippedCatalog,
        });
        expect(policy.slots).toHaveLength(daysPerWeek);
        expect(
          policy.slots.every(
            (slot) =>
              slot.exercises.length > 0 &&
              slot.exercises.length <= 4,
          ),
        ).toBe(true);
      }
    }
  });
});
