import { describe, expect, it } from "vitest";
import type { Exercise, WorkoutPlan } from "@/lib/engine/types";
import {
  MAX_ACCESSORY_LANE_INSERTIONS_PER_WEEK,
  selectAccessoryLaneInsertion,
} from "./accessory-lane";

function makeExercise(input: Partial<Exercise> & Pick<Exercise, "id" | "name">): Exercise {
  return {
    id: input.id,
    name: input.name,
    movementPatterns: input.movementPatterns ?? ["isolation"],
    splitTags: input.splitTags ?? [],
    jointStress: input.jointStress ?? "low",
    isMainLiftEligible: input.isMainLiftEligible ?? false,
    isCompound: input.isCompound ?? false,
    fatigueCost: input.fatigueCost ?? 1,
    sfrScore: input.sfrScore ?? 4,
    equipment: input.equipment ?? ["machine"],
    primaryMuscles: input.primaryMuscles ?? [],
    secondaryMuscles: input.secondaryMuscles ?? [],
    stimulusProfile: input.stimulusProfile,
  };
}

function makeWorkout(exercises: Exercise[]): WorkoutPlan {
  return {
    id: "workout-1",
    scheduledDate: "2026-03-19T12:00:00.000Z",
    warmup: [],
    mainLifts: exercises.slice(0, 1).map((exercise, index) => ({
      id: `${exercise.id}:main`,
      exercise,
      orderIndex: index,
      isMainLift: true,
      role: "main",
      sets: [{ setIndex: 1, targetReps: 8, role: "main" }],
    })),
    accessories: exercises.slice(1).map((exercise, index) => ({
      id: `${exercise.id}:accessory`,
      exercise,
      orderIndex: index + 1,
      isMainLift: false,
      role: "accessory",
      sets: [{ setIndex: 1, targetReps: 12, role: "accessory" }],
    })),
    estimatedMinutes: 45,
  };
}

function makeTargets(values: Partial<Record<"Core" | "Adductors" | "Abductors" | "Forearms", number>>) {
  return new Map<string, number>([
    ["Core", values.Core ?? 0],
    ["Adductors", values.Adductors ?? 0],
    ["Abductors", values.Abductors ?? 0],
    ["Forearms", values.Forearms ?? 0],
  ]);
}

const baseExercises = [
  makeExercise({
    id: "squat",
    name: "Back Squat",
    movementPatterns: ["squat"],
    splitTags: ["legs"],
    isMainLiftEligible: true,
    isCompound: true,
    fatigueCost: 4,
    primaryMuscles: ["Quads", "Glutes"],
  }),
  makeExercise({ id: "leg-curl", name: "Leg Curl", primaryMuscles: ["Hamstrings"] }),
  makeExercise({ id: "calf", name: "Calf Raise", primaryMuscles: ["Calves"] }),
  makeExercise({ id: "leg-ext", name: "Leg Extension", primaryMuscles: ["Quads"] }),
  makeExercise({ id: "glute", name: "Glute Kickback", primaryMuscles: ["Glutes"] }),
];

const laneExercises = [
  makeExercise({
    id: "plank",
    name: "Plank",
    movementPatterns: ["anti_rotation"],
    primaryMuscles: ["Core"],
    stimulusProfile: { core: 1 },
  }),
  makeExercise({
    id: "adduction",
    name: "Hip Adduction",
    movementPatterns: ["adduction"],
    primaryMuscles: ["Adductors"],
    stimulusProfile: { adductors: 1 },
  }),
  makeExercise({
    id: "abduction",
    name: "Hip Abduction",
    movementPatterns: ["abduction"],
    primaryMuscles: ["Abductors"],
    stimulusProfile: { abductors: 1 },
  }),
  makeExercise({
    id: "wrist-curl",
    name: "Wrist Curl",
    movementPatterns: ["flexion"],
    primaryMuscles: ["Forearms"],
    stimulusProfile: { forearms: 1 },
  }),
];

function decide(overrides: Partial<Parameters<typeof selectAccessoryLaneInsertion>[0]> = {}) {
  const workout = overrides.workout ?? makeWorkout(baseExercises);
  return selectAccessoryLaneInsertion({
    slotIntent: "lower",
    workout,
    exerciseLibrary: [...baseExercises, ...laneExercises],
    weeklyTargetByMuscle: makeTargets({ Core: 4 }),
    projectedEffectiveSetsByMuscle: makeTargets({ Core: 0 }),
    maxExercises: 6,
    weeklyInsertionCount: 0,
    slotInsertionCount: 0,
    slotQualityPreserved: true,
    ...overrides,
  });
}

describe("selectAccessoryLaneInsertion", () => {
  it("inserts an under-modeled lane muscle only when the slot has room", () => {
    const withRoom = decide();
    const fullSlot = decide({
      workout: makeWorkout([
        ...baseExercises,
        makeExercise({ id: "extra", name: "Extra Isolation", primaryMuscles: ["Quads"] }),
      ]),
    });

    expect(withRoom).toMatchObject({
      insert: true,
      insertion: { muscle: "Core", exercise: { id: "plank" } },
    });
    expect(fullSlot).toEqual({ insert: false, reason: "session_cap_reached" });
  });

  it("allows no more than one accessory-lane insertion per slot", () => {
    expect(decide({ slotInsertionCount: 1 })).toEqual({
      insert: false,
      reason: "slot_cap_reached",
    });
  });

  it("allows no more than two accessory-lane insertions per week", () => {
    expect(
      decide({ weeklyInsertionCount: MAX_ACCESSORY_LANE_INSERTIONS_PER_WEEK })
    ).toEqual({
      insert: false,
      reason: "weekly_cap_reached",
    });
  });

  it("skips insertion when main or protected slot quality is not preserved", () => {
    expect(decide({ slotQualityPreserved: false })).toEqual({
      insert: false,
      reason: "slot_quality_not_preserved",
    });
  });

  it("keeps forearms behind higher-priority lane deficits", () => {
    const decision = decide({
      slotIntent: "full_body",
      weeklyTargetByMuscle: makeTargets({ Core: 4, Forearms: 8 }),
      projectedEffectiveSetsByMuscle: makeTargets({ Core: 0, Forearms: 0 }),
    });

    expect(decision).toMatchObject({
      insert: true,
      insertion: { muscle: "Core", exercise: { id: "plank" } },
    });
  });

  it("skips core in hinge-heavy lower slots", () => {
    const rdl = makeExercise({
      id: "rdl",
      name: "Romanian Deadlift",
      movementPatterns: ["hinge"],
      splitTags: ["legs"],
      isMainLiftEligible: true,
      isCompound: true,
      fatigueCost: 4,
      primaryMuscles: ["Hamstrings", "Glutes"],
      stimulusProfile: { hamstrings: 1, glutes: 0.75, lower_back: 0.45 },
    });

    expect(
      decide({
        workout: makeWorkout([rdl, ...baseExercises.slice(1, 4)]),
        weeklyTargetByMuscle: makeTargets({ Core: 6 }),
        projectedEffectiveSetsByMuscle: makeTargets({ Core: 0 }),
      })
    ).toEqual({ insert: false, reason: "no_material_compatible_deficit" });
  });

  it("is deterministic for equivalent candidate pools", () => {
    const first = decide({
      exerciseLibrary: [
        ...baseExercises,
        makeExercise({
          id: "core-b",
          name: "Core B",
          movementPatterns: ["anti_rotation"],
          primaryMuscles: ["Core"],
          stimulusProfile: { core: 1 },
        }),
        makeExercise({
          id: "core-a",
          name: "Core A",
          movementPatterns: ["anti_rotation"],
          primaryMuscles: ["Core"],
          stimulusProfile: { core: 1 },
        }),
      ],
    });
    const second = decide({
      exerciseLibrary: [
        ...baseExercises,
        makeExercise({
          id: "core-b",
          name: "Core B",
          movementPatterns: ["anti_rotation"],
          primaryMuscles: ["Core"],
          stimulusProfile: { core: 1 },
        }),
        makeExercise({
          id: "core-a",
          name: "Core A",
          movementPatterns: ["anti_rotation"],
          primaryMuscles: ["Core"],
          stimulusProfile: { core: 1 },
        }),
      ],
    });

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      insert: true,
      insertion: { exercise: { id: "core-a" } },
    });
  });
});
