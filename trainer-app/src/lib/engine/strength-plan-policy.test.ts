import { describe, expect, it } from "vitest";
import { normalizeAcceptedSeedPayload } from "@/lib/api/mesocycle-seed-revision";
import exerciseCatalog from "../../../prisma/exercises_comprehensive.json";
import {
  buildStrengthPlanPolicy,
  canonicalizeStrengthLimitations,
  estimateStrengthSeedSessionMinutes,
  getStrengthRirTarget,
  StrengthLimitationValidationError,
  toStrengthSlotPlanSeed,
  toStrengthSlotSequence,
  type StrengthExerciseCandidate,
  type StrengthPlanConfiguration,
} from "./strength-plan-policy";
import { getRestSeconds } from "./prescription";
import { getStrengthExerciseRestSeconds } from "./strength-session-timing";
import type { Exercise } from "./types";

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
      first.slots.every(
        (slot) =>
          slot.estimatedMinutes <=
          baseConfiguration.sessionDurationMinutes,
      ),
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

  it("keeps anti-extension exercises eligible for the Strength core lane by semantics", () => {
    const antiExtensionCatalog = catalog.map((candidate) =>
      candidate.id === "plank"
        ? {
            ...candidate,
            id: "ab-wheel-rollout",
            name: "Renamed Core Rollout",
            movementPatterns: ["anti_extension" as const],
            isCompound: true,
            fatigueCost: 2,
          }
        : candidate,
    );
    const policy = buildStrengthPlanPolicy({
      configuration: baseConfiguration,
      trainingAge: "intermediate",
      limitations: [],
      exercises: antiExtensionCatalog,
    });

    expect(
      policy.slots
        .flatMap((slot) => slot.exercises)
        .map((exercise) => exercise.exerciseId),
    ).toContain("ab-wheel-rollout");
  });

  it("substitutes equipment-incompatible and contraindicated preferences", () => {
    const policy = buildStrengthPlanPolicy({
      configuration: {
        ...baseConfiguration,
        equipmentProfile: "MACHINES",
      },
      trainingAge: "intermediate",
      limitations: ["left knee", "lower back"],
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

  it("preserves the legacy BARBELL_HOME trap-bar substitution", () => {
    const policy = buildStrengthPlanPolicy({
      configuration: {
        ...baseConfiguration,
        equipmentProfile: "BARBELL_HOME",
        preferredLifts: {
          ...baseConfiguration.preferredLifts,
          hinge: "TRAP_BAR_DEADLIFT",
        },
      },
      trainingAge: "intermediate",
      limitations: [],
      exercises: [
        ...catalog,
        exercise("trap-bar-deadlift", "Trap Bar Deadlift", "hinge", [
          "Trap_Bar",
        ]),
      ],
    });

    expect(policy.resolvedPrimaryLifts.hinge).toBe("Conventional Deadlift");
    expect(policy.substitutions).toContain(
      "Trap Bar Deadlift → Conventional Deadlift",
    );
  });

  it("preserves legacy MACHINES rejection of band-only candidates", () => {
    const policy = buildStrengthPlanPolicy({
      configuration: {
        ...baseConfiguration,
        equipmentProfile: "MACHINES",
        preferredLifts: {
          ...baseConfiguration.preferredLifts,
          press: "MACHINE_PRESS",
        },
      },
      trainingAge: "intermediate",
      limitations: [],
      exercises: [
        ...catalog.filter((candidate) => candidate.id !== "machine-press"),
        exercise(
          "band-machine-press",
          "Machine Chest Press",
          "horizontal_push",
          ["Band"],
        ),
      ],
    });

    expect(policy.resolvedPrimaryLifts.press).toBe("Push-Up");
    expect(policy.substitutions).toContain("Machine Chest Press → Push-Up");
    expect(
      policy.slots
        .flatMap((slot) => slot.exercises)
        .some((entry) => entry.exerciseId === "band-machine-press"),
    ).toBe(false);
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
          slot.exercises.length <= 5 &&
          slot.exercises.some((entry) => entry.role === "CORE_COMPOUND"),
      ),
    ).toBe(true);
    expect(
      policy.slots
        .flatMap((slot) => slot.exercises)
        .filter((entry) => entry.role === "CORE_COMPOUND")
        .every((entry) => entry.setCount === 3),
    ).toBe(true);
    expect(
      policy.slots.every((slot) => slot.estimatedMinutes <= 45),
    ).toBe(true);
  });

  it("budgets compound assistance with runtime's longer rest model", () => {
    const policy = buildStrengthPlanPolicy({
      configuration: {
        ...baseConfiguration,
        daysPerWeek: 2,
        sessionDurationMinutes: 45,
      },
      trainingAge: "beginner",
      limitations: [],
      exercises: catalog,
    });

    expect(
      policy.slots[0]?.exercises.find(
        (entry) => entry.exerciseId === "barbell-row",
      ),
    ).toMatchObject({
      role: "ACCESSORY",
      setCount: 2,
    });
    expect(policy.slots[0]?.estimatedMinutes).toBe(45);
  });

  it.each([
    [["low back"], ["low_back"]],
    [["lower back"], ["low_back"]],
    [["knee"], ["knee"]],
    [["left knee"], ["knee"]],
    [["knees"], ["knee"]],
    [["shoulder"], ["shoulder"]],
    [["right shoulder"], ["shoulder"]],
    [["shoulder impingement"], ["shoulder"]],
    [["  RIGHT-Shoulder: impingement  "], ["shoulder"]],
    [["LOW / BACK"], ["low_back"]],
    [["both knees; left shoulder"], ["knee", "shoulder"]],
    [["pain in my left knee"], ["knee"]],
    [["history of right shoulder impingement"], ["shoulder"]],
    [
      ["right rotator cuff/shoulder impingement syndrome"],
      ["shoulder"],
    ],
    [["hip problem"], ["hip"]],
    [["low-back pain"], ["low_back"]],
    [["lower-back problems"], ["low_back"]],
    [["my knee hurts"], ["knee"]],
    [["previous knee injury"], ["knee"]],
    [["  PAIN   IN MY LEFT KNEE  "], ["knee"]],
    [["(left knee), right shoulder/elbows"], ["knee", "shoulder", "elbow"]],
    [["my knee's pain"], ["knee"]],
    [
      ["Pain in my left knee, and history of right shoulder impingement."],
      ["knee", "shoulder"],
    ],
  ])(
    "canonicalizes recognized limitation phrasing %j",
    (limitations, expected) => {
      expect(canonicalizeStrengthLimitations(limitations)).toEqual(expected);
    },
  );

  it("fails closed for an unclassifiable active limitation", () => {
    expect(() =>
      canonicalizeStrengthLimitations(["left ankle"]),
    ).toThrow(StrengthLimitationValidationError);
    expect(() =>
      buildStrengthPlanPolicy({
        configuration: baseConfiguration,
        trainingAge: "intermediate",
        limitations: ["left ankle"],
        exercises: catalog,
      }),
    ).toThrow("STRENGTH_PLAN_UNCLASSIFIED_LIMITATION:left ankle");
  });

  it.each([
    "hip hop",
    "wristwatch",
    "friendship",
    "shoulderbag",
    "knee-high fashion",
    "pain in my knee and ankle",
    "history of knee pain while playing soccer",
    "rotator problem",
    "cuff pain",
  ])("rejects unrelated or materially unclassifiable text %j", (limitation) => {
    expect(() => canonicalizeStrengthLimitations([limitation])).toThrow(
      StrengthLimitationValidationError,
    );
  });

  it("never lets a preferred lift bypass a recognized limitation", () => {
    const policy = buildStrengthPlanPolicy({
      configuration: baseConfiguration,
      trainingAge: "intermediate",
      limitations: ["Left-knee pain", "LOWER BACK"],
      exercises: catalog,
    });

    const selectedIds = policy.slots.flatMap((slot) =>
      slot.exercises.map((entry) => entry.exerciseId),
    );
    expect(selectedIds).not.toContain("back-squat");
    expect(selectedIds).not.toContain("deadlift");
    expect(policy.substitutions).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^Barbell Back Squat → /),
        expect.stringMatching(/^Conventional Deadlift → /),
      ]),
    );
  });

  it("excludes every incompatible primary and assistance candidate", () => {
    const contraindicatedIds = new Set([
      "bench",
      "ohp",
      "face-pull",
    ]);
    const policy = buildStrengthPlanPolicy({
      configuration: {
        ...baseConfiguration,
        preferredLifts: {
          ...baseConfiguration.preferredLifts,
          press: "BARBELL_BENCH",
        },
      },
      trainingAge: "intermediate",
      limitations: ["right shoulder impingement"],
      exercises: catalog.map((candidate) =>
        contraindicatedIds.has(candidate.id)
          ? { ...candidate, contraindications: ["shoulder"] }
          : candidate,
      ),
    });

    expect(
      policy.slots
        .flatMap((slot) => slot.exercises)
        .some((exercise) => contraindicatedIds.has(exercise.exerciseId)),
    ).toBe(false);
  });

  it("fails explicitly when limitation filtering makes a required lane infeasible", () => {
    expect(() =>
      buildStrengthPlanPolicy({
        configuration: baseConfiguration,
        trainingAge: "intermediate",
        limitations: ["shoulders"],
        exercises: catalog.map((candidate) =>
          candidate.movementPatterns.includes("vertical_push")
            ? { ...candidate, contraindications: ["shoulder"] }
            : candidate,
        ),
      }),
    ).toThrow(
      "STRENGTH_PLAN_REQUIRED_LANE_UNAVAILABLE:strength_upper_b:vertical_push",
    );
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
            sessionDurationMinutes: 60,
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

  it("keeps every successful supported configuration within its requested duration", () => {
    const shippedCatalog = exerciseCatalog.exercises.map((entry, index) => ({
      id: `matrix-${index}`,
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
    let successfulSessions = 0;
    let explicitFailures = 0;

    for (const sessionDurationMinutes of [45, 60, 75, 90] as const) {
      for (const trainingAge of [
        "beginner",
        "intermediate",
        "advanced",
      ] as const) {
        for (const daysPerWeek of [2, 3, 4, 5] as const) {
          for (const emphasis of [
            "BALANCED",
            "SQUAT",
            "BENCH",
            "DEADLIFT",
          ] as const) {
            for (const equipmentProfile of [
              "FULL_GYM",
              "BARBELL_HOME",
              "DUMBBELLS",
              "MACHINES",
              "BODYWEIGHT",
            ] as const) {
              for (const limitations of [
                [] as string[],
                ["left knee", "right shoulder", "lower back"],
              ]) {
                try {
                  const policy = buildStrengthPlanPolicy({
                    configuration: {
                      ...baseConfiguration,
                      sessionDurationMinutes,
                      daysPerWeek,
                      emphasis,
                      equipmentProfile,
                      preferredLifts: {
                        squat: "AUTO",
                        press: "AUTO",
                        hinge: "AUTO",
                      },
                    },
                    trainingAge,
                    limitations,
                    exercises: shippedCatalog,
                  });
                  for (const slot of policy.slots) {
                    expect(slot.estimatedMinutes).toBeLessThanOrEqual(
                      sessionDurationMinutes,
                    );
                    expect(
                      estimateStrengthSeedSessionMinutes({
                        trainingAge,
                        exercises: slot.exercises,
                        catalog: shippedCatalog,
                      }),
                    ).toBe(slot.estimatedMinutes);
                    for (const exercise of slot.exercises) {
                      const classification = shippedCatalog.find(
                        (candidate) =>
                          candidate.id === exercise.exerciseId,
                      )!;
                      const isMainLift =
                        exercise.role === "CORE_COMPOUND";
                      const expectedRest =
                        getStrengthExerciseRestSeconds({
                          role: exercise.role,
                          fatigueCost: classification.fatigueCost,
                          isCompound: classification.isCompound,
                        });
                      expect(
                        getRestSeconds(
                          classification as unknown as Exercise,
                          isMainLift,
                          isMainLift ? 5 : 10,
                          "strength",
                        ),
                      ).toBe(expectedRest);
                    }
                    successfulSessions += 1;
                  }
                } catch (error) {
                  expect(error).toBeInstanceOf(Error);
                  expect((error as Error).message).toMatch(
                    /^STRENGTH_PLAN_(REQUIRED_LANE_UNAVAILABLE|PRIMARY_LIFT_UNAVAILABLE|DURATION_UNACHIEVABLE):/,
                  );
                  explicitFailures += 1;
                }
              }
            }
          }
        }
      }
    }

    expect(successfulSessions).toBeGreaterThan(0);
    expect(explicitFailures).toBeGreaterThan(0);
  });
});
