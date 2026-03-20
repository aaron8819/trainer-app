import { describe, expect, it, vi } from "vitest";

const composeIntentSessionFromMappedContextSpy = vi.fn();

vi.mock("./template-session", async (importOriginal) => {
  const original = await importOriginal<typeof import("./template-session")>();
  return {
    ...original,
    composeIntentSessionFromMappedContext: (...args: Parameters<typeof original.composeIntentSessionFromMappedContext>) => {
      composeIntentSessionFromMappedContextSpy(...args);
      return original.composeIntentSessionFromMappedContext(...args);
    },
  };
});

import type { NextCycleSeedDraft } from "./mesocycle-handoff-contract";
import {
  projectSuccessorSlotPlansFromSnapshot,
} from "./mesocycle-handoff-slot-plan-projection";
import type { PreloadedGenerationSnapshot } from "./template-session/context-loader";

function makeRawExercise(input: {
  id: string;
  name: string;
  movementPatterns: string[];
  splitTags: string[];
  equipment?: string[];
  primaryMuscles: string[];
  secondaryMuscles?: string[];
  isMainLiftEligible?: boolean;
  isCompound?: boolean;
  fatigueCost?: number;
}) {
  return {
    id: input.id,
    name: input.name,
    movementPatterns: input.movementPatterns,
    splitTags: input.splitTags,
    jointStress: "MEDIUM",
    isMainLiftEligible: input.isMainLiftEligible ?? true,
    isCompound: input.isCompound ?? true,
    fatigueCost: input.fatigueCost ?? 3,
    sfrScore: 4,
    lengthPositionScore: 3,
    exerciseEquipment: (input.equipment ?? ["MACHINE"]).map((type) => ({
      equipment: { type },
    })),
    exerciseMuscles: [
      ...input.primaryMuscles.map((name) => ({
        role: "PRIMARY",
        muscle: { name, sraHours: 48 },
      })),
      ...(input.secondaryMuscles ?? []).map((name) => ({
        role: "SECONDARY",
        muscle: { name, sraHours: 48 },
      })),
    ],
    aliases: [],
  };
}

function buildSnapshot(): PreloadedGenerationSnapshot {
  return {
    context: {
      profile: {
        id: "profile-1",
        userId: "user-1",
        trainingAge: "INTERMEDIATE",
        age: 30,
        sex: "MALE",
        heightIn: 72,
        weightLb: 185,
      },
      goals: {
        userId: "user-1",
        primaryGoal: "HYPERTROPHY",
        secondaryGoal: "NONE",
      },
      constraints: {
        userId: "user-1",
        daysPerWeek: 4,
        splitType: "UPPER_LOWER",
        weeklySchedule: ["UPPER", "LOWER", "UPPER", "LOWER"],
      },
      injuries: [],
      exercises: [
        makeRawExercise({
          id: "bench",
          name: "Bench Press",
          movementPatterns: ["horizontal_push"],
          splitTags: ["push"],
          equipment: ["BARBELL"],
          primaryMuscles: ["Chest"],
          secondaryMuscles: ["Triceps", "Front Delts"],
        }),
        makeRawExercise({
          id: "incline-press",
          name: "Incline Dumbbell Press",
          movementPatterns: ["vertical_push"],
          splitTags: ["push"],
          equipment: ["DUMBBELL"],
          primaryMuscles: ["Chest", "Front Delts"],
          secondaryMuscles: ["Triceps"],
          isMainLiftEligible: false,
        }),
        makeRawExercise({
          id: "cable-fly",
          name: "Cable Fly",
          movementPatterns: ["isolation"],
          splitTags: ["push"],
          equipment: ["CABLE"],
          primaryMuscles: ["Chest"],
          isMainLiftEligible: false,
          isCompound: false,
          fatigueCost: 2,
        }),
        makeRawExercise({
          id: "machine-press",
          name: "Machine Chest Press",
          movementPatterns: ["horizontal_push"],
          splitTags: ["push"],
          equipment: ["MACHINE"],
          primaryMuscles: ["Chest"],
          secondaryMuscles: ["Triceps"],
          isMainLiftEligible: false,
        }),
        makeRawExercise({
          id: "row",
          name: "Chest-Supported Row",
          movementPatterns: ["horizontal_pull"],
          splitTags: ["pull"],
          equipment: ["MACHINE"],
          primaryMuscles: ["Upper Back", "Lats"],
          secondaryMuscles: ["Biceps"],
        }),
        makeRawExercise({
          id: "pulldown",
          name: "Lat Pulldown",
          movementPatterns: ["vertical_pull"],
          splitTags: ["pull"],
          equipment: ["CABLE"],
          primaryMuscles: ["Lats"],
          secondaryMuscles: ["Biceps"],
          isMainLiftEligible: false,
        }),
        makeRawExercise({
          id: "seated-row",
          name: "Seated Cable Row",
          movementPatterns: ["horizontal_pull"],
          splitTags: ["pull"],
          equipment: ["CABLE"],
          primaryMuscles: ["Upper Back", "Lats"],
          secondaryMuscles: ["Biceps"],
          isMainLiftEligible: false,
        }),
        makeRawExercise({
          id: "curl",
          name: "Cable Curl",
          movementPatterns: ["isolation"],
          splitTags: ["pull"],
          equipment: ["CABLE"],
          primaryMuscles: ["Biceps"],
          isMainLiftEligible: false,
          isCompound: false,
          fatigueCost: 2,
        }),
        makeRawExercise({
          id: "rear-delt-fly",
          name: "Reverse Pec Deck",
          movementPatterns: ["isolation"],
          splitTags: ["pull"],
          equipment: ["MACHINE"],
          primaryMuscles: ["Rear Delts"],
          isMainLiftEligible: false,
          isCompound: false,
          fatigueCost: 2,
        }),
        makeRawExercise({
          id: "lateral-raise",
          name: "Lateral Raise",
          movementPatterns: ["isolation"],
          splitTags: ["push"],
          equipment: ["DUMBBELL"],
          primaryMuscles: ["Side Delts"],
          isMainLiftEligible: false,
          isCompound: false,
          fatigueCost: 2,
        }),
        makeRawExercise({
          id: "squat",
          name: "Back Squat",
          movementPatterns: ["squat"],
          splitTags: ["legs"],
          equipment: ["BARBELL"],
          primaryMuscles: ["Quads", "Glutes"],
        }),
        makeRawExercise({
          id: "rdl",
          name: "Romanian Deadlift",
          movementPatterns: ["hinge"],
          splitTags: ["legs"],
          equipment: ["BARBELL"],
          primaryMuscles: ["Hamstrings", "Glutes"],
        }),
        makeRawExercise({
          id: "hack-squat",
          name: "Hack Squat",
          movementPatterns: ["squat"],
          splitTags: ["legs"],
          equipment: ["MACHINE"],
          primaryMuscles: ["Quads", "Glutes"],
          isMainLiftEligible: false,
        }),
        makeRawExercise({
          id: "leg-curl",
          name: "Seated Leg Curl",
          movementPatterns: ["isolation"],
          splitTags: ["legs"],
          equipment: ["MACHINE"],
          primaryMuscles: ["Hamstrings"],
          isMainLiftEligible: false,
          isCompound: false,
          fatigueCost: 2,
        }),
        makeRawExercise({
          id: "leg-extension",
          name: "Leg Extension",
          movementPatterns: ["isolation"],
          splitTags: ["legs"],
          equipment: ["MACHINE"],
          primaryMuscles: ["Quads"],
          isMainLiftEligible: false,
          isCompound: false,
          fatigueCost: 2,
        }),
        makeRawExercise({
          id: "hip-thrust",
          name: "Barbell Hip Thrust",
          movementPatterns: ["hinge"],
          splitTags: ["legs"],
          equipment: ["BARBELL"],
          primaryMuscles: ["Glutes"],
          secondaryMuscles: ["Hamstrings"],
          isMainLiftEligible: false,
        }),
        makeRawExercise({
          id: "calf-raise",
          name: "Standing Calf Raise",
          movementPatterns: ["isolation"],
          splitTags: ["legs"],
          equipment: ["MACHINE"],
          primaryMuscles: ["Calves"],
          isMainLiftEligible: false,
          isCompound: false,
          fatigueCost: 2,
        }),
      ],
      workouts: [],
      preferences: null,
      checkIns: [],
    },
    activeMesocycle: null,
    rotationContext: new Map(),
    mesocycleRoleRows: [],
    phaseBlockContext: undefined,
  } as unknown as PreloadedGenerationSnapshot;
}

function buildDraft(): NextCycleSeedDraft {
  return {
    version: 1,
    sourceMesocycleId: "meso-1",
    createdAt: "2026-03-01T00:00:00.000Z",
    structure: {
      splitType: "UPPER_LOWER",
      sessionsPerWeek: 4,
      daysPerWeek: 4,
      sequenceMode: "ordered_flexible",
      slots: [
        { slotId: "upper_a", intent: "UPPER" },
        { slotId: "lower_a", intent: "LOWER" },
        { slotId: "upper_b", intent: "UPPER" },
        { slotId: "lower_b", intent: "LOWER" },
      ],
    },
    startingPoint: {
      volumePreset: "conservative_productive",
      baselineRule: "peak_accumulation_else_highest_accumulation_else_non_deload",
      excludeDeload: true,
    },
    carryForwardSelections: [
      {
        exerciseId: "bench",
        exerciseName: "Bench Press",
        sessionIntent: "UPPER",
        role: "CORE_COMPOUND",
        action: "keep",
      },
      {
        exerciseId: "squat",
        exerciseName: "Back Squat",
        sessionIntent: "LOWER",
        role: "CORE_COMPOUND",
        action: "keep",
      },
      {
        exerciseId: "row",
        exerciseName: "Chest-Supported Row",
        sessionIntent: "UPPER",
        role: "ACCESSORY",
        action: "rotate",
      },
    ],
  };
}

function buildSource() {
  return {
    macroCycleId: "macro-1",
    mesoNumber: 1,
    startWeek: 0,
    durationWeeks: 5,
    focus: "Upper Lower Hypertrophy",
    volumeTarget: "HIGH" as const,
    intensityBias: "HYPERTROPHY" as const,
    blocks: [
      {
        blockNumber: 1,
        blockType: "ACCUMULATION" as const,
        startWeek: 5,
        durationWeeks: 4,
        volumeTarget: "HIGH" as const,
        intensityBias: "HYPERTROPHY" as const,
        adaptationType: "MYOFIBRILLAR_HYPERTROPHY" as const,
      },
      {
        blockNumber: 2,
        blockType: "DELOAD" as const,
        startWeek: 9,
        durationWeeks: 1,
        volumeTarget: "LOW" as const,
        intensityBias: "HYPERTROPHY" as const,
        adaptationType: "RECOVERY" as const,
      },
    ],
  };
}

describe("projectSuccessorSlotPlansFromSnapshot", () => {
  it("is deterministic for the same snapshot and draft inputs", () => {
    const input = {
      userId: "user-1",
      source: buildSource(),
      draft: buildDraft(),
      snapshot: buildSnapshot(),
      now: new Date("2026-03-19T12:00:00.000Z"),
    };

    const first = projectSuccessorSlotPlansFromSnapshot(input);
    const second = projectSuccessorSlotPlansFromSnapshot(input);

    expect(first).toEqual(second);
  });

  it("projects repeated intents into distinct slot plans in slot order", () => {
    const projected = projectSuccessorSlotPlansFromSnapshot({
      userId: "user-1",
      source: buildSource(),
      draft: buildDraft(),
      snapshot: buildSnapshot(),
      now: new Date("2026-03-19T12:00:00.000Z"),
    });

    expect("error" in projected).toBe(false);
    if ("error" in projected) return;

    const upperA = projected.slotPlans.find((slot) => slot.slotId === "upper_a");
    const upperB = projected.slotPlans.find((slot) => slot.slotId === "upper_b");
    const lowerA = projected.slotPlans.find((slot) => slot.slotId === "lower_a");
    const lowerB = projected.slotPlans.find((slot) => slot.slotId === "lower_b");

    expect(upperA?.exercises.length).toBeGreaterThan(0);
    expect(upperB?.exercises.length).toBeGreaterThan(0);
    expect(lowerA?.exercises.length).toBeGreaterThan(0);
    expect(lowerB?.exercises.length).toBeGreaterThan(0);
    expect(upperA?.slotId).toBe("upper_a");
    expect(upperB?.slotId).toBe("upper_b");
    expect(upperA?.exercises.map((exercise) => exercise.exerciseId)).not.toEqual(
      upperB?.exercises.map((exercise) => exercise.exerciseId)
    );
  });

  it("reuses the extracted generation seam for each projected slot", () => {
    composeIntentSessionFromMappedContextSpy.mockClear();

    const projected = projectSuccessorSlotPlansFromSnapshot({
      userId: "user-1",
      source: buildSource(),
      draft: buildDraft(),
      snapshot: buildSnapshot(),
      now: new Date("2026-03-19T12:00:00.000Z"),
    });

    expect("error" in projected).toBe(false);
    expect(composeIntentSessionFromMappedContextSpy).toHaveBeenCalledTimes(4);
    expect(
      composeIntentSessionFromMappedContextSpy.mock.calls.map(([, input]) => input.slotId)
    ).toEqual(["upper_a", "lower_a", "upper_b", "lower_b"]);
  });

  it("keeps later duplicate-intent slots sensitive to earlier projected work", () => {
    const projected = projectSuccessorSlotPlansFromSnapshot({
      userId: "user-1",
      source: buildSource(),
      draft: buildDraft(),
      snapshot: buildSnapshot(),
      now: new Date("2026-03-19T12:00:00.000Z"),
    });

    expect("error" in projected).toBe(false);
    if ("error" in projected) return;

    const upperA = projected.slotPlans.find((slot) => slot.slotId === "upper_a");
    const upperB = projected.slotPlans.find((slot) => slot.slotId === "upper_b");
    const lowerA = projected.slotPlans.find((slot) => slot.slotId === "lower_a");
    const lowerB = projected.slotPlans.find((slot) => slot.slotId === "lower_b");

    expect(upperA?.exercises.map((exercise) => exercise.exerciseId)).toContain("bench");
    expect(upperB?.exercises.map((exercise) => exercise.exerciseId)).toContain("bench");
    expect(lowerA?.exercises.map((exercise) => exercise.exerciseId)).toContain("squat");
    expect(lowerB?.exercises.map((exercise) => exercise.exerciseId)).toContain("squat");
    expect(upperA?.exercises.map((exercise) => exercise.exerciseId)).not.toEqual(
      upperB?.exercises.map((exercise) => exercise.exerciseId)
    );
    expect(lowerA?.exercises.map((exercise) => exercise.exerciseId)).not.toEqual(
      lowerB?.exercises.map((exercise) => exercise.exerciseId)
    );
  });

  it("fails clearly for unsupported BODY_PART successor slots", () => {
    const bodyPartDraft: NextCycleSeedDraft = {
      ...buildDraft(),
      structure: {
        splitType: "CUSTOM",
        sessionsPerWeek: 1,
        daysPerWeek: 1,
        sequenceMode: "ordered_flexible",
        slots: [{ slotId: "body_part_a", intent: "BODY_PART" }],
      },
      carryForwardSelections: [],
    };

    const projected = projectSuccessorSlotPlansFromSnapshot({
      userId: "user-1",
      source: buildSource(),
      draft: bodyPartDraft,
      snapshot: buildSnapshot(),
      now: new Date("2026-03-19T12:00:00.000Z"),
    });

    expect(projected).toEqual({
      error:
        "MESOCYCLE_HANDOFF_SLOT_PLAN_UNSUPPORTED: BODY_PART slot body_part_a requires target muscles for deterministic projection.",
    });
  });
});
