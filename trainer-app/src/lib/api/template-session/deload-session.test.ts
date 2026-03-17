import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CANONICAL_DELOAD_SET_MULTIPLIER,
  getCanonicalDeloadTargetRpe,
} from "@/lib/deload/semantics";
import type { SessionIntent } from "@/lib/engine/session-types";

const mocks = vi.hoisted(() => {
  const workoutFindFirst = vi.fn();
  const workoutFindMany = vi.fn();
  return {
    workoutFindFirst,
    workoutFindMany,
    prisma: {
      workout: {
        findFirst: workoutFindFirst,
        findMany: workoutFindMany,
      },
    },
  };
});

vi.mock("@/lib/db/prisma", () => ({
  prisma: mocks.prisma,
}));

import { generateDeloadSessionFromIntentContext } from "./deload-session";

function makeRoleMap(
  overrides: Partial<Record<SessionIntent, Array<[string, "CORE_COMPOUND" | "ACCESSORY"]>>>
) {
  const intents: SessionIntent[] = [
    "push",
    "pull",
    "legs",
    "upper",
    "lower",
    "full_body",
    "body_part",
  ];

  return Object.fromEntries(
    intents.map((intent) => [intent, new Map(overrides[intent] ?? [])])
  ) as Record<SessionIntent, Map<string, "CORE_COMPOUND" | "ACCESSORY">>;
}

function makeMappedContext(input: {
  exerciseLibrary: Array<Record<string, unknown>>;
  roleMapByIntent?: Partial<
    Record<SessionIntent, Array<[string, "CORE_COMPOUND" | "ACCESSORY"]>>
  >;
}) {
  return {
    exerciseLibrary: input.exerciseLibrary,
    mesocycleRoleMapByIntent: makeRoleMap(input.roleMapByIntent ?? {}),
    activeMesocycle: {
      id: "meso-1",
      state: "ACTIVE_DELOAD",
      accumulationSessionsCompleted: 12,
      deloadSessionsCompleted: 0,
      sessionsPerWeek: 3,
      macroCycleId: "macro",
      mesoNumber: 1,
      startWeek: 0,
      durationWeeks: 5,
      focus: "hypertrophy",
      volumeTarget: "MODERATE",
      intensityBias: "HYPERTROPHY",
      completedSessions: 12,
      splitType: "PPL",
      daysPerWeek: 3,
      isActive: true,
      volumeRampConfig: {},
      rirBandConfig: {},
    },
  } as never;
}

describe("deload-session generation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps core-compound continuity, cuts sets roughly in half, and leaves load assignment to the canonical engine", async () => {
    mocks.workoutFindFirst.mockResolvedValue({
      exercises: [
        {
          exerciseId: "row",
          isMainLift: true,
          sets: [
            { logs: [{ actualReps: 10, actualLoad: 60 }] },
            { logs: [{ actualReps: 10, actualLoad: 60 }] },
            { logs: [{ actualReps: 10, actualLoad: 60 }] },
            { logs: [{ actualReps: 10, actualLoad: 60 }] },
          ],
        },
      ],
    });
    mocks.workoutFindMany.mockResolvedValue([
      {
        exercises: [
          {
            exerciseId: "row",
            isMainLift: true,
            sets: [
              { logs: [{ actualLoad: 60, actualReps: 10 }] },
              { logs: [{ actualLoad: 60, actualReps: 10 }] },
              { logs: [{ actualLoad: 55, actualReps: 10 }] },
              { logs: [{ actualLoad: 60, actualReps: 10 }] },
            ],
          },
          {
            exerciseId: "bench",
            isMainLift: true,
            sets: [
              { logs: [{ actualReps: 8, actualLoad: 200 }] },
              { logs: [{ actualReps: 8, actualLoad: 200 }] },
              { logs: [{ actualReps: 8, actualLoad: 180 }] },
              { logs: [{ actualReps: 8, actualLoad: 180 }] },
            ],
          },
        ],
      },
    ]);

    const result = await generateDeloadSessionFromIntentContext(
      "user-1",
      makeMappedContext({
        exerciseLibrary: [
          {
            id: "row",
            name: "Row",
            movementPatterns: ["horizontal_pull"],
            splitTags: ["pull"],
            jointStress: "medium",
            isMainLiftEligible: true,
            isCompound: true,
            fatigueCost: 3,
            equipment: ["machine"],
            primaryMuscles: ["Upper Back"],
            secondaryMuscles: ["Biceps"],
          },
          {
            id: "bench",
            name: "Bench Press",
            movementPatterns: ["horizontal_push"],
            splitTags: ["push"],
            jointStress: "medium",
            isMainLiftEligible: true,
            isCompound: true,
            fatigueCost: 4,
            equipment: ["barbell"],
            primaryMuscles: ["Chest"],
            secondaryMuscles: ["Triceps"],
          },
        ],
        roleMapByIntent: {
          pull: [
            ["row", "CORE_COMPOUND"],
            ["bench", "CORE_COMPOUND"],
          ],
        },
      }),
      "pull"
    );

    expect("error" in result).toBe(false);
    if ("error" in result) return;

    expect(result.workout.notes).toContain("trim redundant accessory overlap");
    expect(result.note).toContain("Loads stay lighter through the canonical load engine");

    const row = result.workout.mainLifts.find((entry) => entry.exercise.id === "row");
    const bench = result.workout.mainLifts.find((entry) => entry.exercise.id === "bench");

    expect(row?.sets).toHaveLength(2);
    expect(row?.sets[0].targetReps).toBe(10);
    expect(row?.sets[0].targetLoad).toBeUndefined();
    expect(row?.sets[0].targetRpe).toBe(getCanonicalDeloadTargetRpe());
    expect(result.trace.targetRpe).toBe(getCanonicalDeloadTargetRpe());
    expect(result.trace.setFactor).toBe(CANONICAL_DELOAD_SET_MULTIPLIER);
    expect(result.trace.exercises.find((entry) => entry.exerciseId === "row")).toMatchObject({
      baselineSetCount: 4,
      deloadSetCount: 2,
      structuralDecisionCode: "preserved_main_lift",
      anchoredLoad: 60,
      anchoredLoadSource: "latest_accumulation",
      latestAccumulationLoadCount: 4,
    });
    expect(result.trace.exercises.find((entry) => entry.exerciseId === "bench")).toMatchObject({
      structuralDecisionCode: "preserved_main_lift",
      anchoredLoad: 200,
      anchoredLoadSource: "peak_accumulation",
      peakAccumulationLoadCount: 4,
    });

    expect(bench?.sets).toHaveLength(2);
    expect(bench?.sets[0].targetReps).toBe(8);
    expect(bench?.sets[0].targetLoad).toBeUndefined();
  });

  it("trims redundant push-day press overlap and duplicate lateral raise buckets before applying set deloads", async () => {
    mocks.workoutFindFirst.mockResolvedValue({
      exercises: [
        {
          exerciseId: "incline-db-bench",
          isMainLift: true,
          sets: Array.from({ length: 4 }, () => ({ logs: [{ actualReps: 8, actualLoad: 80 }] })),
        },
        {
          exerciseId: "db-ohp",
          isMainLift: true,
          sets: Array.from({ length: 4 }, () => ({ logs: [{ actualReps: 8, actualLoad: 50 }] })),
        },
        {
          exerciseId: "dip",
          isMainLift: false,
          sets: Array.from({ length: 3 }, () => ({ logs: [{ actualReps: 10, actualLoad: 0 }] })),
        },
        {
          exerciseId: "machine-shoulder-press",
          isMainLift: false,
          sets: Array.from({ length: 2 }, () => ({ logs: [{ actualReps: 12, actualLoad: 90 }] })),
        },
        {
          exerciseId: "oh-tri-ext",
          isMainLift: false,
          sets: Array.from({ length: 3 }, () => ({ logs: [{ actualReps: 12, actualLoad: 35 }] })),
        },
        {
          exerciseId: "cable-lateral",
          isMainLift: false,
          sets: Array.from({ length: 3 }, () => ({ logs: [{ actualReps: 15, actualLoad: 15 }] })),
        },
        {
          exerciseId: "machine-lateral",
          isMainLift: false,
          sets: Array.from({ length: 2 }, () => ({ logs: [{ actualReps: 15, actualLoad: 40 }] })),
        },
      ],
    });
    mocks.workoutFindMany.mockResolvedValue([]);

    const result = await generateDeloadSessionFromIntentContext(
      "user-1",
      makeMappedContext({
        exerciseLibrary: [
          {
            id: "incline-db-bench",
            name: "Incline Dumbbell Bench Press",
            movementPatterns: ["horizontal_push"],
            splitTags: ["push"],
            jointStress: "medium",
            isMainLiftEligible: true,
            isCompound: true,
            fatigueCost: 4,
            equipment: ["dumbbell"],
            primaryMuscles: ["Chest"],
            secondaryMuscles: ["Front Delts", "Triceps"],
          },
          {
            id: "db-ohp",
            name: "Dumbbell Overhead Press",
            movementPatterns: ["vertical_push"],
            splitTags: ["push"],
            jointStress: "medium",
            isMainLiftEligible: true,
            isCompound: true,
            fatigueCost: 4,
            equipment: ["dumbbell"],
            primaryMuscles: ["Shoulders"],
            secondaryMuscles: ["Triceps"],
          },
          {
            id: "dip",
            name: "Dip (Chest Emphasis)",
            movementPatterns: ["horizontal_push"],
            splitTags: ["push"],
            jointStress: "high",
            isMainLiftEligible: false,
            isCompound: true,
            fatigueCost: 4,
            equipment: ["bodyweight"],
            primaryMuscles: ["Chest"],
            secondaryMuscles: ["Triceps"],
          },
          {
            id: "machine-shoulder-press",
            name: "Machine Shoulder Press",
            movementPatterns: ["vertical_push"],
            splitTags: ["push"],
            jointStress: "medium",
            isMainLiftEligible: false,
            isCompound: true,
            fatigueCost: 3,
            equipment: ["machine"],
            primaryMuscles: ["Shoulders"],
            secondaryMuscles: ["Triceps"],
          },
          {
            id: "oh-tri-ext",
            name: "Overhead Cable Triceps Extension",
            movementPatterns: ["extension"],
            splitTags: ["push"],
            jointStress: "low",
            isMainLiftEligible: false,
            isCompound: false,
            fatigueCost: 1,
            equipment: ["cable"],
            primaryMuscles: ["Triceps"],
            secondaryMuscles: [],
          },
          {
            id: "cable-lateral",
            name: "Cable Lateral Raise",
            movementPatterns: ["abduction"],
            splitTags: ["push"],
            jointStress: "low",
            isMainLiftEligible: false,
            isCompound: false,
            fatigueCost: 1,
            equipment: ["cable"],
            primaryMuscles: ["Side Delts"],
            secondaryMuscles: [],
          },
          {
            id: "machine-lateral",
            name: "Machine Lateral Raise",
            movementPatterns: ["abduction"],
            splitTags: ["push"],
            jointStress: "low",
            isMainLiftEligible: false,
            isCompound: false,
            fatigueCost: 1,
            equipment: ["machine"],
            primaryMuscles: ["Side Delts"],
            secondaryMuscles: [],
          },
        ],
        roleMapByIntent: {
          push: [
            ["incline-db-bench", "CORE_COMPOUND"],
            ["db-ohp", "CORE_COMPOUND"],
            ["dip", "ACCESSORY"],
            ["machine-shoulder-press", "ACCESSORY"],
            ["oh-tri-ext", "ACCESSORY"],
            ["cable-lateral", "ACCESSORY"],
            ["machine-lateral", "ACCESSORY"],
          ],
        },
      }),
      "push"
    );

    expect("error" in result).toBe(false);
    if ("error" in result) return;

    expect(result.workout.mainLifts.map((entry) => entry.exercise.name)).toEqual([
      "Incline Dumbbell Bench Press",
      "Dumbbell Overhead Press",
    ]);
    expect(result.workout.accessories.map((entry) => entry.exercise.name)).toEqual([
      "Overhead Cable Triceps Extension",
      "Cable Lateral Raise",
    ]);
    expect(result.trace.baselineExerciseCount).toBe(7);
    expect(result.trace.keptExerciseCount).toBe(4);
    expect(result.trace.baselineHardSetCount).toBe(21);
    expect(result.trace.keptHardSetCount).toBe(8);
    expect(result.trace.maxAccessoryCount).toBe(3);
    expect(result.trace.trimmedExercises).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          exerciseId: "dip",
          structuralDecisionCode: "trimmed_redundant_main_pattern",
        }),
        expect.objectContaining({
          exerciseId: "machine-shoulder-press",
          structuralDecisionCode: "trimmed_redundant_main_pattern",
        }),
        expect.objectContaining({
          exerciseId: "machine-lateral",
          structuralDecisionCode: "trimmed_duplicate_bucket",
        }),
      ])
    );
    expect(result.trace.exercises.find((entry) => entry.exerciseId === "oh-tri-ext")).toMatchObject({
      structuralDecisionCode: "kept_unique_accessory_coverage",
      deloadSetCount: 2,
    });
    expect(result.trace.exercises.find((entry) => entry.exerciseId === "cable-lateral")).toMatchObject({
      structuralDecisionCode: "kept_unique_accessory_coverage",
      deloadSetCount: 2,
    });
  });

  it("generalizes the simplification policy to non-push sessions by trimming overlapping lower-body compounds first", async () => {
    mocks.workoutFindFirst.mockResolvedValue({
      exercises: [
        {
          exerciseId: "back-squat",
          isMainLift: true,
          sets: Array.from({ length: 5 }, () => ({ logs: [{ actualReps: 6, actualLoad: 225 }] })),
        },
        {
          exerciseId: "rdl",
          isMainLift: true,
          sets: Array.from({ length: 4 }, () => ({ logs: [{ actualReps: 8, actualLoad: 185 }] })),
        },
        {
          exerciseId: "leg-press",
          isMainLift: false,
          sets: Array.from({ length: 3 }, () => ({ logs: [{ actualReps: 12, actualLoad: 300 }] })),
        },
        {
          exerciseId: "leg-extension",
          isMainLift: false,
          sets: Array.from({ length: 3 }, () => ({ logs: [{ actualReps: 15, actualLoad: 110 }] })),
        },
        {
          exerciseId: "leg-curl",
          isMainLift: false,
          sets: Array.from({ length: 3 }, () => ({ logs: [{ actualReps: 12, actualLoad: 90 }] })),
        },
        {
          exerciseId: "walking-lunge",
          isMainLift: false,
          sets: Array.from({ length: 2 }, () => ({ logs: [{ actualReps: 10, actualLoad: 40 }] })),
        },
        {
          exerciseId: "calf-raise",
          isMainLift: false,
          sets: Array.from({ length: 3 }, () => ({ logs: [{ actualReps: 15, actualLoad: 140 }] })),
        },
      ],
    });
    mocks.workoutFindMany.mockResolvedValue([]);

    const result = await generateDeloadSessionFromIntentContext(
      "user-1",
      makeMappedContext({
        exerciseLibrary: [
          {
            id: "back-squat",
            name: "Back Squat",
            movementPatterns: ["squat"],
            splitTags: ["legs"],
            jointStress: "high",
            isMainLiftEligible: true,
            isCompound: true,
            fatigueCost: 5,
            equipment: ["barbell"],
            primaryMuscles: ["Quads"],
            secondaryMuscles: ["Glutes"],
          },
          {
            id: "rdl",
            name: "Romanian Deadlift",
            movementPatterns: ["hinge"],
            splitTags: ["legs"],
            jointStress: "medium",
            isMainLiftEligible: true,
            isCompound: true,
            fatigueCost: 4,
            equipment: ["barbell"],
            primaryMuscles: ["Hamstrings"],
            secondaryMuscles: ["Glutes", "Lower Back"],
          },
          {
            id: "leg-press",
            name: "Leg Press",
            movementPatterns: ["squat"],
            splitTags: ["legs"],
            jointStress: "medium",
            isMainLiftEligible: false,
            isCompound: true,
            fatigueCost: 4,
            equipment: ["machine"],
            primaryMuscles: ["Quads"],
            secondaryMuscles: ["Glutes"],
          },
          {
            id: "leg-extension",
            name: "Leg Extension",
            movementPatterns: ["extension"],
            splitTags: ["legs"],
            jointStress: "low",
            isMainLiftEligible: false,
            isCompound: false,
            fatigueCost: 1,
            equipment: ["machine"],
            primaryMuscles: ["Quads"],
            secondaryMuscles: [],
          },
          {
            id: "leg-curl",
            name: "Lying Leg Curl",
            movementPatterns: ["flexion"],
            splitTags: ["legs"],
            jointStress: "low",
            isMainLiftEligible: false,
            isCompound: false,
            fatigueCost: 1,
            equipment: ["machine"],
            primaryMuscles: ["Hamstrings"],
            secondaryMuscles: [],
          },
          {
            id: "walking-lunge",
            name: "Walking Lunge",
            movementPatterns: ["lunge"],
            splitTags: ["legs"],
            jointStress: "medium",
            isMainLiftEligible: false,
            isCompound: true,
            fatigueCost: 3,
            equipment: ["dumbbell"],
            primaryMuscles: ["Quads"],
            secondaryMuscles: ["Glutes"],
          },
          {
            id: "calf-raise",
            name: "Standing Calf Raise",
            movementPatterns: ["calf_raise_extended"],
            splitTags: ["legs"],
            jointStress: "low",
            isMainLiftEligible: false,
            isCompound: false,
            fatigueCost: 1,
            equipment: ["machine"],
            primaryMuscles: ["Calves"],
            secondaryMuscles: [],
          },
        ],
        roleMapByIntent: {
          legs: [
            ["back-squat", "CORE_COMPOUND"],
            ["rdl", "CORE_COMPOUND"],
          ],
        },
      }),
      "legs"
    );

    expect("error" in result).toBe(false);
    if ("error" in result) return;

    expect(result.workout.mainLifts.map((entry) => entry.exercise.name)).toEqual([
      "Back Squat",
      "Romanian Deadlift",
    ]);
    expect(result.workout.accessories.map((entry) => entry.exercise.name)).toEqual([
      "Leg Extension",
      "Lying Leg Curl",
      "Standing Calf Raise",
    ]);
    expect(result.trace.baselineExerciseCount).toBe(7);
    expect(result.trace.keptExerciseCount).toBe(5);
    expect(result.trace.trimmedExercises).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          exerciseId: "leg-press",
          structuralDecisionCode: "trimmed_redundant_main_pattern",
        }),
        expect.objectContaining({
          exerciseId: "walking-lunge",
          structuralDecisionCode: "trimmed_redundant_main_pattern",
        }),
      ])
    );
  });

  it("handles 2-set and 1-set deload edge cases without inventing extra work", async () => {
    mocks.workoutFindFirst.mockResolvedValue({
      exercises: [
        {
          exerciseId: "two-set-row",
          isMainLift: true,
          sets: [
            { logs: [{ actualReps: 10, actualLoad: 70 }] },
            { logs: [{ actualReps: 10, actualLoad: 70 }] },
          ],
        },
        {
          exerciseId: "one-set-curl",
          isMainLift: false,
          sets: [{ logs: [{ actualReps: 12, actualLoad: 25 }] }],
        },
      ],
    });
    mocks.workoutFindMany.mockResolvedValue([
      {
        exercises: [
          {
            exerciseId: "two-set-row",
            isMainLift: true,
            sets: [
              { logs: [{ actualReps: 10, actualLoad: 70 }] },
              { logs: [{ actualReps: 10, actualLoad: 70 }] },
            ],
          },
          {
            exerciseId: "one-set-curl",
            isMainLift: false,
            sets: [{ logs: [{ actualReps: 12, actualLoad: 25 }] }],
          },
        ],
      },
    ]);

    const result = await generateDeloadSessionFromIntentContext(
      "user-1",
      makeMappedContext({
        exerciseLibrary: [
          {
            id: "two-set-row",
            name: "Row",
            movementPatterns: ["horizontal_pull"],
            splitTags: ["pull"],
            jointStress: "medium",
            isMainLiftEligible: true,
            isCompound: true,
            fatigueCost: 3,
            equipment: ["machine"],
            primaryMuscles: ["Upper Back"],
            secondaryMuscles: ["Biceps"],
          },
          {
            id: "one-set-curl",
            name: "Curl",
            movementPatterns: ["flexion"],
            splitTags: ["pull"],
            jointStress: "low",
            isMainLiftEligible: false,
            isCompound: false,
            fatigueCost: 1,
            equipment: ["cable"],
            primaryMuscles: ["Biceps"],
            secondaryMuscles: [],
          },
        ],
        roleMapByIntent: {
          pull: [["two-set-row", "CORE_COMPOUND"]],
        },
      }),
      "pull"
    );

    expect("error" in result).toBe(false);
    if ("error" in result) return;

    const row = result.workout.mainLifts.find((entry) => entry.exercise.id === "two-set-row");
    const curl = result.workout.accessories.find((entry) => entry.exercise.id === "one-set-curl");

    expect(row?.sets).toHaveLength(1);
    expect(curl?.sets).toHaveLength(1);
    expect(row?.sets[0].targetLoad).toBeUndefined();
    expect(curl?.sets[0].targetLoad).toBeUndefined();
  });
});
