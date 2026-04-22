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
import { buildFallbackDesignFromDraft } from "./mesocycle-genesis-policy";
import {
  buildMesocycleSlotPlanSeed,
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

function buildRepairSensitiveSnapshot(): PreloadedGenerationSnapshot {
  const snapshot = buildSnapshot();
  snapshot.context.exercises.push(
    makeRawExercise({
      id: "triceps-pressdown",
      name: "Cable Triceps Pressdown",
      movementPatterns: ["isolation"],
      splitTags: ["push"],
      equipment: ["CABLE"],
      primaryMuscles: ["Triceps"],
      isMainLiftEligible: false,
      isCompound: false,
      fatigueCost: 1,
    }) as never,
    makeRawExercise({
      id: "seated-calf-raise",
      name: "Seated Calf Raise",
      movementPatterns: ["isolation"],
      splitTags: ["legs"],
      equipment: ["MACHINE"],
      primaryMuscles: ["Calves"],
      isMainLiftEligible: false,
      isCompound: false,
      fatigueCost: 1,
    }) as never,
    makeRawExercise({
      id: "donkey-calf-raise",
      name: "Donkey Calf Raise",
      movementPatterns: ["isolation"],
      splitTags: ["legs"],
      equipment: ["MACHINE"],
      primaryMuscles: ["Calves"],
      isMainLiftEligible: false,
      isCompound: false,
      fatigueCost: 1,
    }) as never
  );
  return snapshot;
}

function buildProtectedCoverageSatisfiedSnapshot(): PreloadedGenerationSnapshot {
  const snapshot = buildRepairSensitiveSnapshot();
  snapshot.context.exercises.push(
    makeRawExercise({
      id: "overhead-triceps-extension",
      name: "Overhead Triceps Extension",
      movementPatterns: ["isolation"],
      splitTags: ["push"],
      equipment: ["CABLE"],
      primaryMuscles: ["Triceps"],
      isMainLiftEligible: false,
      isCompound: false,
      fatigueCost: 1,
    }) as never,
    makeRawExercise({
      id: "seated-leg-curl",
      name: "Seated Leg Curl",
      movementPatterns: ["isolation"],
      splitTags: ["legs"],
      equipment: ["MACHINE"],
      primaryMuscles: ["Hamstrings"],
      isMainLiftEligible: false,
      isCompound: false,
      fatigueCost: 1,
    }) as never
  );
  return snapshot;
}

function buildNoHingeCompoundSnapshot(): PreloadedGenerationSnapshot {
  const snapshot = buildSnapshot();
  snapshot.context.exercises = snapshot.context.exercises.filter(
    (exercise) =>
      !(exercise.isCompound ?? false) ||
      !(exercise.movementPatterns ?? []).includes("hinge" as (typeof exercise.movementPatterns)[number])
  );
  return snapshot;
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
      volumeEntry: "conservative",
      baselineSource: "accumulation_preferred",
      allowNonDeloadFallback: true,
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

function buildDesign(draft: NextCycleSeedDraft = buildDraft()) {
  return buildFallbackDesignFromDraft({
    sourceMesocycleId: "meso-1",
    designedAt: draft.createdAt,
    profile: {
      focus: "Upper Lower Hypertrophy",
      durationWeeks: 5,
      volumeTarget: "HIGH",
      intensityBias: "HYPERTROPHY",
      blocks: [
        {
          blockNumber: 1,
          blockType: "ACCUMULATION",
          durationWeeks: 4,
          volumeTarget: "HIGH",
          intensityBias: "HYPERTROPHY",
          adaptationType: "MYOFIBRILLAR_HYPERTROPHY",
        },
        {
          blockNumber: 2,
          blockType: "DELOAD",
          durationWeeks: 1,
          volumeTarget: "LOW",
          intensityBias: "HYPERTROPHY",
          adaptationType: "RECOVERY",
        },
      ],
    },
    draft,
  });
}

function buildRepairSensitiveDraft(): NextCycleSeedDraft {
  const draft = buildDraft();
  return {
    ...draft,
    carryForwardSelections: draft.carryForwardSelections.filter(
      (selection) => selection.exerciseId !== "row"
    ),
  };
}

function getProjectedSlotPlans(
  projected: ReturnType<typeof projectSuccessorSlotPlansFromSnapshot>
) {
  return "error" in projected ? projected.slotPlans ?? [] : projected.slotPlans;
}

function getProtectedCoverageDiagnostics(
  projected: ReturnType<typeof projectSuccessorSlotPlansFromSnapshot>
) {
  return projected.diagnostics?.protectedCoverage;
}

describe("projectSuccessorSlotPlansFromSnapshot", () => {
  it("is deterministic for the same snapshot and draft inputs", () => {
    const input = {
      userId: "user-1",
      source: buildSource(),
      design: buildDesign(),
      snapshot: buildSnapshot(),
      now: new Date("2026-03-19T12:00:00.000Z"),
    };

    const first = projectSuccessorSlotPlansFromSnapshot(input);
    const second = projectSuccessorSlotPlansFromSnapshot(input);

    expect(first).toEqual(second);
  });

  it("keeps projected slot-plan seeds on the existing minimal exercise shape", () => {
    const design = buildDesign();
    const slotSequence = {
      version: 1 as const,
      source: "handoff_draft" as const,
      sequenceMode: "ordered_flexible" as const,
      slots: design.structure.slots,
    };
    const seed = buildMesocycleSlotPlanSeed({
      slotSequence,
      slotPlans: design.structure.slots.map((slot, index) => ({
        slotId: slot.slotId,
        intent: slot.intent,
        exercises: [
          {
            exerciseId: index === 0 ? "plank" : `exercise-${index}`,
            role: "ACCESSORY",
          },
        ],
      })),
    });

    expect(seed.slots[0]?.exercises[0]).toEqual({
      exerciseId: "plank",
      role: "ACCESSORY",
    });
    expect(seed.slots[0]?.exercises[0]).not.toHaveProperty("setCount");
    expect(seed.slots[0]).not.toHaveProperty("intent");
  });

  it("projects repeated intents into distinct slot plans in slot order", () => {
    const projected = projectSuccessorSlotPlansFromSnapshot({
      userId: "user-1",
      source: buildSource(),
      design: buildDesign(),
      snapshot: buildSnapshot(),
      now: new Date("2026-03-19T12:00:00.000Z"),
    });

    const slotPlans = getProjectedSlotPlans(projected);
    const upperA = slotPlans.find((slot) => slot.slotId === "upper_a");
    const upperB = slotPlans.find((slot) => slot.slotId === "upper_b");
    const lowerA = slotPlans.find((slot) => slot.slotId === "lower_a");
    const lowerB = slotPlans.find((slot) => slot.slotId === "lower_b");

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

    projectSuccessorSlotPlansFromSnapshot({
      userId: "user-1",
      source: buildSource(),
      design: buildDesign(),
      snapshot: buildSnapshot(),
      now: new Date("2026-03-19T12:00:00.000Z"),
    });

    const slotIds = composeIntentSessionFromMappedContextSpy.mock.calls.map(([, input]) => input.slotId);

    expect(slotIds.length).toBeGreaterThanOrEqual(14);
    expect(slotIds[0]).toBe("upper_a");
    expect(slotIds.at(-1)).toBe("lower_b");
    expect(slotIds).toEqual(
      expect.arrayContaining(["upper_a", "lower_a", "upper_b", "lower_b"])
    );

    const firstLowerA = slotIds.indexOf("lower_a");
    const firstUpperB = slotIds.indexOf("upper_b");
    const firstLowerB = slotIds.indexOf("lower_b");

    expect(firstLowerA).toBeGreaterThan(slotIds.indexOf("upper_a"));
    expect(firstUpperB).toBeGreaterThan(firstLowerA);
    expect(firstLowerB).toBeGreaterThan(firstUpperB);
  });

  it("keeps later duplicate-intent slots sensitive to earlier projected work", () => {
    const projected = projectSuccessorSlotPlansFromSnapshot({
      userId: "user-1",
      source: buildSource(),
      design: buildDesign(),
      snapshot: buildSnapshot(),
      now: new Date("2026-03-19T12:00:00.000Z"),
    });

    const slotPlans = getProjectedSlotPlans(projected);
    const upperA = slotPlans.find((slot) => slot.slotId === "upper_a");
    const upperB = slotPlans.find((slot) => slot.slotId === "upper_b");
    const lowerA = slotPlans.find((slot) => slot.slotId === "lower_a");
    const lowerB = slotPlans.find((slot) => slot.slotId === "lower_b");

    expect(upperA?.exercises.map((exercise) => exercise.exerciseId)).toContain("bench");
    expect(upperB?.exercises.map((exercise) => exercise.exerciseId)).toContain("bench");
    expect(lowerA?.exercises.map((exercise) => exercise.exerciseId)).toContain("squat");
    expect(
      (lowerB?.exercises.map((exercise) => exercise.exerciseId) ?? []).some((exerciseId) =>
        ["rdl", "hack-squat", "hip-thrust"].includes(exerciseId)
      )
    ).toBe(true);
    expect(upperA?.exercises.map((exercise) => exercise.exerciseId)).not.toEqual(
      upperB?.exercises.map((exercise) => exercise.exerciseId)
    );
    expect(lowerA?.exercises.map((exercise) => exercise.exerciseId)).not.toEqual(
      lowerB?.exercises.map((exercise) => exercise.exerciseId)
    );
  });

  it("rebalances repeated upper slots toward push support without flattening or inflating them", () => {
    const projected = projectSuccessorSlotPlansFromSnapshot({
      userId: "user-1",
      source: buildSource(),
      design: buildDesign(buildRepairSensitiveDraft()),
      snapshot: buildProtectedCoverageSatisfiedSnapshot(),
      now: new Date("2026-03-19T12:00:00.000Z"),
    });

    const upperA = getProjectedSlotPlans(projected).find((slot) => slot.slotId === "upper_a");
    const upperB = getProjectedSlotPlans(projected).find((slot) => slot.slotId === "upper_b");
    const upperAExerciseIds = upperA?.exercises.map((exercise) => exercise.exerciseId) ?? [];
    const upperBExerciseIds = upperB?.exercises.map((exercise) => exercise.exerciseId) ?? [];
    const upperPairExerciseIds = [...upperAExerciseIds, ...upperBExerciseIds];

    expect(upperAExerciseIds).not.toEqual(upperBExerciseIds);
    expect(upperPairExerciseIds).toEqual(expect.arrayContaining(["bench"]));
    expect(
      upperPairExerciseIds.some((exerciseId) =>
        ["machine-press", "incline-press", "cable-fly"].includes(exerciseId)
      )
    ).toBe(true);
    expect(
      upperPairExerciseIds.some((exerciseId) =>
        ["triceps-pressdown", "overhead-triceps-extension"].includes(exerciseId)
      )
    ).toBe(true);
    expect(
      upperPairExerciseIds.some((exerciseId) =>
        ["row", "seated-row", "pulldown"].includes(exerciseId)
      )
    ).toBe(true);
    expect(
      upperAExerciseIds.some((exerciseId) =>
        ["row", "seated-row", "pulldown"].includes(exerciseId)
      ) || upperBExerciseIds.some((exerciseId) =>
        ["row", "seated-row", "pulldown"].includes(exerciseId)
      )
    ).toBe(true);
    expect(upperAExerciseIds.length).toBeLessThanOrEqual(6);
    expect(upperBExerciseIds.length).toBeLessThanOrEqual(6);
  });

  it("forwards protected repair muscles into upper-slot projection candidates", () => {
    composeIntentSessionFromMappedContextSpy.mockClear();

    projectSuccessorSlotPlansFromSnapshot({
      userId: "user-1",
      source: buildSource(),
      design: buildDesign(buildRepairSensitiveDraft()),
      snapshot: buildRepairSensitiveSnapshot(),
      now: new Date("2026-03-19T12:00:00.000Z"),
    });

    const upperRepairCalls = composeIntentSessionFromMappedContextSpy.mock.calls
      .map(([, input]) => input)
      .filter(
        (input) =>
          (input.slotId === "upper_a" || input.slotId === "upper_b") &&
          Array.isArray(input.projectionRepairMuscles) &&
          input.projectionRepairMuscles.length > 0
      );

    expect(upperRepairCalls.length).toBeGreaterThan(0);
    expect(
      upperRepairCalls.some((input) =>
        ["Chest", "Triceps"].every((muscle) =>
          (input.projectionRepairMuscles ?? []).includes(muscle)
        )
      )
    ).toBe(true);
  });

  it("persists lower_b with a hinge-led core anchor when a hinge compound is viable", () => {
    const projected = projectSuccessorSlotPlansFromSnapshot({
      userId: "user-1",
      source: buildSource(),
      design: buildDesign(),
      snapshot: buildSnapshot(),
      now: new Date("2026-03-19T12:00:00.000Z"),
    });

    const lowerB = getProjectedSlotPlans(projected).find((slot) => slot.slotId === "lower_b");
    const firstCoreCompound = lowerB?.exercises.find((exercise) => exercise.role === "CORE_COMPOUND");

    expect(firstCoreCompound?.exerciseId).toBe("rdl");
  });

  it("keeps lower_b hinge-led while adding one meaningful quad-support option without inflating the slot", () => {
    const projected = projectSuccessorSlotPlansFromSnapshot({
      userId: "user-1",
      source: buildSource(),
      design: buildDesign(buildRepairSensitiveDraft()),
      snapshot: buildProtectedCoverageSatisfiedSnapshot(),
      now: new Date("2026-03-19T12:00:00.000Z"),
    });

    const slotPlans = getProjectedSlotPlans(projected);
    const lowerA = slotPlans.find((slot) => slot.slotId === "lower_a");
    const lowerB = slotPlans.find((slot) => slot.slotId === "lower_b");
    const lowerBExerciseIds = lowerB?.exercises.map((exercise) => exercise.exerciseId) ?? [];

    expect(lowerBExerciseIds[0]).toBe("rdl");
    expect(
      lowerBExerciseIds.some((exerciseId) =>
        ["hack-squat", "leg-extension"].includes(exerciseId)
      )
    ).toBe(true);
    expect(lowerBExerciseIds).not.toEqual(lowerA?.exercises.map((exercise) => exercise.exerciseId));
    expect(lowerBExerciseIds.length).toBeLessThanOrEqual(6);
  });

  it("allows lower_b squat fallback when no hinge compound anchor is viable", () => {
    const projected = projectSuccessorSlotPlansFromSnapshot({
      userId: "user-1",
      source: buildSource(),
      design: buildDesign(),
      snapshot: buildNoHingeCompoundSnapshot(),
      now: new Date("2026-03-19T12:00:00.000Z"),
    });

    const lowerB = getProjectedSlotPlans(projected).find((slot) => slot.slotId === "lower_b");
    const firstCoreCompound = lowerB?.exercises.find((exercise) => exercise.role === "CORE_COMPOUND");

    expect(firstCoreCompound?.exerciseId).toBe("squat");
  });

  it("keeps upper_b on a compound horizontal pull when only a supportive accessory shares that pattern", () => {
    const snapshot = buildSnapshot();
    snapshot.context.exercises.push(
      makeRawExercise({
        id: "face-pull",
        name: "Face Pull",
        movementPatterns: ["horizontal_pull"],
        splitTags: ["pull"],
        equipment: ["CABLE"],
        primaryMuscles: ["Rear Delts"],
        secondaryMuscles: ["Upper Back"],
        isMainLiftEligible: false,
        isCompound: false,
        fatigueCost: 2,
      }) as never
    );

    const projected = projectSuccessorSlotPlansFromSnapshot({
      userId: "user-1",
      source: buildSource(),
      design: buildDesign(),
      snapshot,
      now: new Date("2026-03-19T12:00:00.000Z"),
    });

    const upperB = getProjectedSlotPlans(projected).find((slot) => slot.slotId === "upper_b");
    const upperBExerciseIds = upperB?.exercises.map((exercise) => exercise.exerciseId) ?? [];

    expect(
      upperBExerciseIds.some((exerciseId) => ["row", "seated-row"].includes(exerciseId))
    ).toBe(true);
    expect(
      !upperBExerciseIds.includes("face-pull") ||
        upperBExerciseIds.some((exerciseId) => ["row", "seated-row"].includes(exerciseId))
    ).toBe(true);
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
      design: buildDesign(bodyPartDraft),
      snapshot: buildSnapshot(),
      now: new Date("2026-03-19T12:00:00.000Z"),
    });

    expect(projected).toEqual({
      error:
        "MESOCYCLE_HANDOFF_SLOT_PLAN_UNSUPPORTED: BODY_PART slot body_part_a requires target muscles for deterministic projection.",
    });
  });

  it("constructs against protected coverage obligations and improves protected coverage when compatibility is available", async () => {
    const input = {
      userId: "user-1",
      source: buildSource(),
      design: buildDesign(buildRepairSensitiveDraft()),
      snapshot: buildRepairSensitiveSnapshot(),
      now: new Date("2026-03-19T12:00:00.000Z"),
    };

    const repaired = projectSuccessorSlotPlansFromSnapshot(input);

    vi.resetModules();
    vi.doMock("@/lib/planning/session-slot-profile", async (importOriginal) => {
      const original =
        await importOriginal<typeof import("@/lib/planning/session-slot-profile")>();
      return {
        ...original,
        getProjectionRepairCompatibleMuscles: () => [],
      };
    });
    const { projectSuccessorSlotPlansFromSnapshot: projectWithoutRepairCompatibility } =
      await import("./mesocycle-handoff-slot-plan-projection");
    const unrepaired = projectWithoutRepairCompatibility(input);
    vi.resetModules();
    vi.doUnmock("@/lib/planning/session-slot-profile");

    const repairedDiagnostics = getProtectedCoverageDiagnostics(repaired);
    const unrepairedDiagnostics = getProtectedCoverageDiagnostics(unrepaired);
    expect(repairedDiagnostics?.slotRepairMuscles).toEqual(
      expect.objectContaining({
        upper_a: expect.arrayContaining(["Chest", "Triceps"]),
        lower_b: expect.arrayContaining(["Calves"]),
      })
    );
    const repairedMevShortfall =
      repairedDiagnostics?.afterRepair.muscles.reduce(
        (sum, row) => sum + row.deficitToMev,
        0
      ) ?? 0;
    const unrepairedMevShortfall =
      unrepairedDiagnostics?.afterRepair.muscles.reduce(
        (sum, row) => sum + row.deficitToMev,
        0
      ) ?? 0;
    expect(repairedMevShortfall).toBeLessThan(unrepairedMevShortfall);
    expect(repairedDiagnostics?.afterRepair.unresolvedProtectedMuscles).not.toContain("Triceps");

    const repairedSlotPlans = getProjectedSlotPlans(repaired);
    const upperA = repairedSlotPlans.find((slot) => slot.slotId === "upper_a");
    const upperB = repairedSlotPlans.find((slot) => slot.slotId === "upper_b");
    const lowerA = repairedSlotPlans.find((slot) => slot.slotId === "lower_a");
    const lowerB = repairedSlotPlans.find((slot) => slot.slotId === "lower_b");

    expect(upperA?.exercises.map((exercise) => exercise.exerciseId)).not.toEqual(
      upperB?.exercises.map((exercise) => exercise.exerciseId)
    );
    expect(lowerA?.exercises.map((exercise) => exercise.exerciseId)).not.toEqual(
      lowerB?.exercises.map((exercise) => exercise.exerciseId)
    );
    expect(
      upperB?.exercises.some((exercise) => ["row", "seated-row", "pulldown"].includes(exercise.exerciseId))
    ).toBe(true);
    expect(
      lowerB?.exercises.some((exercise) =>
        ["rdl", "hack-squat", "leg-curl", "hip-thrust"].includes(exercise.exerciseId)
      )
    ).toBe(true);
  });

  it("returns a constructor failure with diagnostics when protected viability still cannot be satisfied", async () => {
    const projected = projectSuccessorSlotPlansFromSnapshot({
      userId: "user-1",
      source: buildSource(),
      design: buildDesign(),
      snapshot: buildSnapshot(),
      now: new Date("2026-03-19T12:00:00.000Z"),
    });

    expect("error" in projected).toBe(true);
    if (!("error" in projected)) return;

    expect(projected.error).toContain("MESOCYCLE_HANDOFF_SLOT_PLAN_PROTECTED_COVERAGE_UNSATISFIED");
    expect(projected.slotPlans?.length).toBe(4);
    expect(projected.diagnostics?.protectedCoverage.unresolvedProtectedMuscles.length).toBeGreaterThan(0);
  });

  it("still rejects the seed when lowered MEV would clear but practical protected week-one targets remain underbuilt", async () => {
    vi.resetModules();
    vi.doMock("@/lib/engine/volume-landmarks", async (importOriginal) => {
      const original =
        await importOriginal<typeof import("@/lib/engine/volume-landmarks")>();
      return {
        ...original,
        VOLUME_LANDMARKS: {
          ...original.VOLUME_LANDMARKS,
          Chest: { ...original.VOLUME_LANDMARKS.Chest, mev: 2 },
          "Side Delts": { ...original.VOLUME_LANDMARKS["Side Delts"], mev: 1 },
          Triceps: { ...original.VOLUME_LANDMARKS.Triceps, mev: 1 },
          Hamstrings: { ...original.VOLUME_LANDMARKS.Hamstrings, mev: 2 },
          Calves: { ...original.VOLUME_LANDMARKS.Calves, mev: 2 },
        },
      };
    });
    vi.doMock("./mesocycle-lifecycle", async (importOriginal) => {
      const original =
        await importOriginal<typeof import("./mesocycle-lifecycle")>();
      return {
        ...original,
        getWeeklyVolumeTarget: (
          _mesocycle: unknown,
          muscle: string
        ) => {
          switch (muscle) {
            case "Chest":
            case "Side Delts":
            case "Triceps":
            case "Hamstrings":
            case "Calves":
              return 8;
            default:
              return 0;
          }
        },
      };
    });
    const { projectSuccessorSlotPlansFromSnapshot: projectWithTargetFloor } =
      await import("./mesocycle-handoff-slot-plan-projection");
    const projected = projectWithTargetFloor({
      userId: "user-1",
      source: buildSource(),
      design: buildDesign(buildRepairSensitiveDraft()),
      snapshot: buildRepairSensitiveSnapshot(),
      now: new Date("2026-03-19T12:00:00.000Z"),
    });
    vi.resetModules();
    vi.doUnmock("@/lib/engine/volume-landmarks");
    vi.doUnmock("./mesocycle-lifecycle");

    expect("error" in projected).toBe(true);
    if (!("error" in projected)) return;

    expect(projected.error).toContain("MESOCYCLE_HANDOFF_SLOT_PLAN_PROTECTED_COVERAGE_UNSATISFIED");
    expect(projected.diagnostics?.protectedCoverage.unresolvedProtectedMuscles).toEqual(
      expect.arrayContaining(["Hamstrings"])
    );
  });

  it("still rejects the seed when extra triceps options are present but hamstring protected viability remains unsatisfied", async () => {
    vi.resetModules();
    vi.doMock("@/lib/engine/volume-landmarks", async (importOriginal) => {
      const original =
        await importOriginal<typeof import("@/lib/engine/volume-landmarks")>();
      return {
        ...original,
        VOLUME_LANDMARKS: {
          ...original.VOLUME_LANDMARKS,
          Chest: { ...original.VOLUME_LANDMARKS.Chest, mev: 6 },
          Triceps: { ...original.VOLUME_LANDMARKS.Triceps, mev: 3 },
          Hamstrings: { ...original.VOLUME_LANDMARKS.Hamstrings, mev: 6 },
          Calves: { ...original.VOLUME_LANDMARKS.Calves, mev: 4 },
        },
      };
    });
    vi.doMock("./mesocycle-lifecycle", async (importOriginal) => {
      const original =
        await importOriginal<typeof import("./mesocycle-lifecycle")>();
      return {
        ...original,
        getWeeklyVolumeTarget: (
          _mesocycle: unknown,
          muscle: string
        ) => {
          switch (muscle) {
            case "Chest":
              return 8;
            case "Triceps":
              return 6;
            case "Hamstrings":
              return 10;
            case "Calves":
              return 6;
            default:
              return 0;
          }
        },
      };
    });
    const { projectSuccessorSlotPlansFromSnapshot: projectWithLoweredMevTrigger } =
      await import("./mesocycle-handoff-slot-plan-projection");
    const snapshot = buildProtectedCoverageSatisfiedSnapshot();
    snapshot.context.exercises = snapshot.context.exercises.filter(
      (exercise) => !["leg-curl", "seated-leg-curl"].includes(exercise.id)
    );
    const projected = projectWithLoweredMevTrigger({
      userId: "user-1",
      source: buildSource(),
      design: buildDesign(buildRepairSensitiveDraft()),
      snapshot,
      now: new Date("2026-03-19T12:00:00.000Z"),
    });
    vi.resetModules();
    vi.doUnmock("@/lib/engine/volume-landmarks");
    vi.doUnmock("./mesocycle-lifecycle");

    expect("error" in projected).toBe(true);
    if (!("error" in projected)) return;

    expect(projected.error).toContain("MESOCYCLE_HANDOFF_SLOT_PLAN_PROTECTED_COVERAGE_UNSATISFIED");
    expect(projected.diagnostics?.protectedCoverage.attemptedRepair).toBe(false);
    expect(projected.diagnostics?.protectedCoverage.unresolvedProtectedMuscles).toEqual(
      expect.arrayContaining(["Hamstrings"])
    );
  });
});
