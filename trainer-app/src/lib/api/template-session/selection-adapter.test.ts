import { describe, expect, it } from "vitest";
import {
  buildSelectionObjective,
  SESSION_CAPS,
  SUPPLEMENTAL_SESSION_CAPS,
} from "./selection-adapter";
import { DEFAULT_SELECTION_WEIGHTS } from "@/lib/engine/selection-v2";
import { selectExercisesOptimized } from "@/lib/engine/selection-v2";
import type { MappedGenerationContext } from "./types";
import type { WorkoutHistoryEntry, Exercise } from "@/lib/engine/types";

function makeExercise(
  id: string,
  name: string,
  movementPatterns: Exercise["movementPatterns"],
  splitTags: Exercise["splitTags"],
  primaryMuscles: string[],
  secondaryMuscles: string[] = [],
  options?: Partial<Pick<Exercise, "isMainLiftEligible" | "isCompound" | "fatigueCost" | "equipment">>
): Exercise {
  return {
    id,
    name,
    movementPatterns,
    splitTags,
    jointStress: "medium",
    isMainLiftEligible: options?.isMainLiftEligible ?? true,
    isCompound: options?.isCompound ?? true,
    fatigueCost: options?.fatigueCost ?? 3,
    equipment: options?.equipment ?? ["machine"],
    primaryMuscles,
    secondaryMuscles,
    sfrScore: 3,
    lengthPositionScore: 3,
  };
}

function makeMappedContext(
  history: WorkoutHistoryEntry[],
  options?: {
    exerciseLibrary?: Exercise[];
    weeklySchedule?: MappedGenerationContext["mappedConstraints"]["weeklySchedule"];
    splitType?: MappedGenerationContext["mappedConstraints"]["splitType"];
    lifecycleVolumeTargets?: MappedGenerationContext["lifecycleVolumeTargets"];
  }
): MappedGenerationContext {
  const exerciseLibrary = options?.exerciseLibrary ?? [
    makeExercise("tbar-row", "T-Bar Row", ["horizontal_pull"], ["pull"], ["Lats", "Upper Back"], ["Biceps"]),
    makeExercise("cable-pullover", "Cable Pullover", ["vertical_pull"], ["pull"], ["Lats"]),
    makeExercise("barbell-row", "Barbell Row", ["horizontal_pull"], ["pull"], ["Lats", "Upper Back"], ["Biceps"]),
  ];

  return {
    mappedProfile: {
      id: "user-1",
      trainingAge: "intermediate",
      injuries: [],
      weightKg: 80,
    },
    mappedGoals: {
      primary: "hypertrophy",
      secondary: "none",
      isHypertrophyFocused: true,
      isStrengthFocused: false,
    },
    mappedConstraints: {
      daysPerWeek: 4,
      splitType: options?.splitType ?? "upper_lower",
      weeklySchedule: options?.weeklySchedule ?? ["push", "pull", "legs", "pull"],
    },
    mappedCheckIn: undefined,
    mappedPreferences: undefined,
    exerciseLibrary: exerciseLibrary as MappedGenerationContext["exerciseLibrary"],
    history,
    rawExercises: [],
    rawWorkouts: [],
    weekInBlock: 2,
    lifecycleWeek: 2,
    lifecycleRirTarget: { min: 2, max: 3 },
    lifecycleVolumeTargets: options?.lifecycleVolumeTargets ?? {
      Lats: 12,
      "Upper Back": 12,
      Biceps: 10,
      "Rear Delts": 10,
    },
    sorenessSuppressedMuscles: [],
    activeMesocycle: null,
    mesocycleLength: 4,
    effectivePeriodization: {
      setMultiplier: 1.1,
      rpeOffset: 0,
      isDeload: false,
      backOffMultiplier: 0.9,
      lifecycleSetTargets: { main: 4, accessory: 3 },
    },
    adaptiveDeload: false,
    deloadDecision: {
      mode: "none",
      reason: [],
      reductionPercent: 0,
      appliedTo: "none",
    },
    blockContext: null,
    rotationContext: new Map(),
    cycleContext: {
      weekInMeso: 2,
      weekInBlock: 2,
      phase: "accumulation",
      blockType: "accumulation",
      isDeload: false,
      source: "computed",
    },
    mesocycleRoleMapByIntent: {
      push: new Map(),
      pull: new Map(),
      legs: new Map(),
      upper: new Map(),
      lower: new Map(),
      full_body: new Map(),
      body_part: new Map(),
    },
  };
}

function countSelectedCompoundPattern(
  selected: ReturnType<typeof selectExercisesOptimized>,
  pattern: NonNullable<Exercise["movementPatterns"]>[number]
): number {
  return selected.selected.filter(
    (candidate) =>
      (candidate.exercise.isCompound ?? false) &&
      (candidate.exercise.movementPatterns ?? []).includes(pattern)
  ).length;
}

function selectedCompoundPatterns(
  selected: ReturnType<typeof selectExercisesOptimized>
): NonNullable<Exercise["movementPatterns"]>[number][] {
  return selected.selected
    .filter((candidate) => candidate.exercise.isCompound ?? false)
    .flatMap((candidate) => candidate.exercise.movementPatterns ?? []);
}

describe("buildSelectionObjective continuity bias", () => {
  it("uses the most recent performed workout of the same intent as continuity favorites", () => {
    const history: WorkoutHistoryEntry[] = [
      {
        date: "2026-02-23T23:06:00.357Z",
        completed: false,
        status: "PLANNED",
        sessionIntent: "pull",
        exercises: [{ exerciseId: "barbell-row", sets: [] }],
      },
      {
        date: "2026-03-03T01:40:25.252Z",
        completed: true,
        status: "COMPLETED",
        sessionIntent: "pull",
        exercises: [
          {
            exerciseId: "tbar-row",
            sets: [{ exerciseId: "tbar-row", setIndex: 1, reps: 10, load: 135 }],
          },
          {
            exerciseId: "cable-pullover",
            sets: [{ exerciseId: "cable-pullover", setIndex: 1, reps: 12, load: 70 }],
          },
        ],
      },
    ];

    const objective = buildSelectionObjective(makeMappedContext(history), "pull");

    expect(objective.preferences.favoriteExerciseIds.has("tbar-row")).toBe(true);
    expect(objective.preferences.favoriteExerciseIds.has("cable-pullover")).toBe(true);
    expect(objective.preferences.favoriteExerciseIds.has("barbell-row")).toBe(false);
  });

  it("reduces rotation novelty weight and increases preference weight when continuity history exists", () => {
    const history: WorkoutHistoryEntry[] = [
      {
        date: "2026-02-17T01:40:25.252Z",
        completed: true,
        status: "COMPLETED",
        sessionIntent: "pull",
        exercises: [{ exerciseId: "tbar-row", sets: [{ exerciseId: "tbar-row", setIndex: 1, reps: 10, load: 135 }] }],
      },
    ];

    const objective = buildSelectionObjective(makeMappedContext(history), "pull");

    expect(objective.weights.userPreference).toBeGreaterThan(0.01);
    expect(objective.weights.rotationNovelty).toBeLessThan(0.22);
    expect(objective.weights.userPreference).toBeCloseTo(0.22, 6);
    expect(objective.weights.rotationNovelty).toBeCloseTo(0.01, 6);
    expect(objective.constraints.lifecycleSetTargets).toEqual({ main: 4, accessory: 3 });
  });

  it("prefers prior same-slot continuity over a more recent same-intent different slot", () => {
    const history: WorkoutHistoryEntry[] = [
      {
        date: "2026-03-12T01:40:25.252Z",
        completed: true,
        status: "COMPLETED",
        sessionIntent: "upper",
        mesocycleSnapshot: {
          week: 2,
          session: 1,
          mesocycleId: "meso-1",
          slotId: "upper_a",
        },
        exercises: [
          {
            exerciseId: "machine-chest-press",
            sets: [{ exerciseId: "machine-chest-press", setIndex: 1, reps: 10, load: 180 }],
          },
        ],
      },
      {
        date: "2026-03-05T01:40:25.252Z",
        completed: true,
        status: "COMPLETED",
        sessionIntent: "upper",
        mesocycleSnapshot: {
          week: 1,
          session: 3,
          mesocycleId: "meso-1",
          slotId: "upper_b",
        },
        exercises: [
          {
            exerciseId: "incline-db-press",
            sets: [
              { exerciseId: "incline-db-press", setIndex: 1, reps: 10, load: 70 },
              { exerciseId: "incline-db-press", setIndex: 2, reps: 9, load: 70 },
            ],
          },
        ],
      },
    ];

    const mapped = makeMappedContext(history);
    mapped.activeMesocycle = {
      id: "meso-1",
      slotSequenceJson: {
        version: 1,
        source: "handoff_draft",
        sequenceMode: "ordered_flexible",
        slots: [
          { slotId: "upper_a", intent: "UPPER" },
          { slotId: "lower_a", intent: "LOWER" },
          { slotId: "upper_b", intent: "UPPER" },
          { slotId: "lower_b", intent: "LOWER" },
        ],
      },
    } as unknown as MappedGenerationContext["activeMesocycle"];
    mapped.mappedConstraints.weeklySchedule = ["upper", "lower", "upper", "lower"];

    const objective = buildSelectionObjective(mapped, "upper", undefined, {
      sessionSlotId: "upper_b",
    });

    expect(objective.constraints.preferredContinuityExerciseIds?.has("incline-db-press")).toBe(true);
    expect(objective.constraints.preferredContinuityExerciseIds?.has("machine-chest-press")).toBe(false);
    expect(objective.preferences.favoriteExerciseIds.has("incline-db-press")).toBe(true);
    expect(objective.preferences.favoriteExerciseIds.has("machine-chest-press")).toBe(false);
    expect(objective.constraints.continuityMinSetsByExerciseId?.get("incline-db-press")).toBe(2);
    expect(objective.constraints.continuityMinSetsByExerciseId?.has("machine-chest-press")).toBe(false);
  });

  it("uses lifecycle weekly volume target for pull musculature (week 2 back = 12)", () => {
    const objective = buildSelectionObjective(makeMappedContext([]), "pull");
    expect(objective.volumeContext.weeklyTarget.get("Lats")).toBe(12);
    expect(objective.volumeContext.weeklyTarget.get("Upper Back")).toBe(12);
  });

  it("routes upper and body_part muscle targeting through the centralized opportunity profile", () => {
    const objectiveUpper = buildSelectionObjective(makeMappedContext([]), "upper");
    const objectiveBodyPart = buildSelectionObjective(makeMappedContext([]), "body_part", ["Biceps"]);

    expect(objectiveUpper.volumeContext.weeklyTarget.get("Lats")).toBe(12);
    expect(objectiveUpper.volumeContext.weeklyTarget.get("Upper Back")).toBe(12);
    expect(objectiveUpper.volumeContext.weeklyTarget.has("Quads")).toBe(false);

    expect(objectiveBodyPart.volumeContext.weeklyTarget.get("Biceps")).toBe(10);
    expect(objectiveBodyPart.volumeContext.weeklyTarget.has("Lats")).toBe(false);
  });

  it("keeps normal body_part caps unchanged and applies smaller supplemental caps only when requested", () => {
    const standardObjective = buildSelectionObjective(makeMappedContext([]), "body_part", ["Biceps"]);
    const supplementalObjective = buildSelectionObjective(
      makeMappedContext([]),
      "body_part",
      ["Biceps"],
      { supplementalPlannerProfile: true }
    );

    expect(standardObjective.constraints.minExercises).toBe(SESSION_CAPS.minExercises);
    expect(standardObjective.constraints.maxExercises).toBe(SESSION_CAPS.maxExercises);
    expect(standardObjective.constraints.maxMainLifts).toBe(3);
    expect(standardObjective.constraints.minAccessories).toBe(2);

    expect(supplementalObjective.constraints.minExercises).toBe(
      SUPPLEMENTAL_SESSION_CAPS.minExercisesSingleTarget
    );
    expect(supplementalObjective.constraints.maxExercises).toBe(
      SUPPLEMENTAL_SESSION_CAPS.maxExercisesSingleTarget
    );
    expect(supplementalObjective.constraints.maxMainLifts).toBe(0);
    expect(supplementalObjective.constraints.minAccessories).toBe(1);
    expect(supplementalObjective.constraints.supplementalPlannerProfile).toBe(true);
  });

  it("derives a remaining-week context from schedule order and current-week performed sessions", () => {
    const history: WorkoutHistoryEntry[] = [
      {
        date: new Date().toISOString(),
        completed: true,
        status: "COMPLETED",
        sessionIntent: "push",
        mesocycleSnapshot: { week: 2, session: 1, mesocycleId: "meso-1" },
        exercises: [
          {
            exerciseId: "tbar-row",
            sets: [{ exerciseId: "tbar-row", setIndex: 1, reps: 10, load: 135 }],
          },
        ],
      },
    ];

    const mapped = makeMappedContext(history);
    mapped.activeMesocycle = { id: "meso-1" } as MappedGenerationContext["activeMesocycle"];
    mapped.mappedConstraints.weeklySchedule = ["push", "pull", "legs", "pull"];

    const objective = buildSelectionObjective(mapped, "pull");

    expect(objective.volumeContext.remainingWeek?.futureSlots).toEqual(["legs", "pull"]);
    expect(objective.volumeContext.remainingWeek?.futureSlotCounts.get("pull")).toBe(1);
    expect(objective.volumeContext.remainingWeek?.futureSlotCounts.get("legs")).toBe(1);
  });

  it("does not let non-advancing sessions consume future schedule slots", () => {
    const history: WorkoutHistoryEntry[] = [
      {
        date: new Date().toISOString(),
        completed: true,
        status: "COMPLETED",
        sessionIntent: "push",
        advancesSplit: false,
        mesocycleSnapshot: { week: 2, session: 1, mesocycleId: "meso-1" },
        exercises: [
          {
            exerciseId: "tbar-row",
            sets: [{ exerciseId: "tbar-row", setIndex: 1, reps: 10, load: 135 }],
          },
        ],
      },
    ];

    const mapped = makeMappedContext(history);
    mapped.activeMesocycle = { id: "meso-1" } as MappedGenerationContext["activeMesocycle"];
    mapped.mappedConstraints.weeklySchedule = ["push", "pull", "legs", "pull"];

    const objective = buildSelectionObjective(mapped, "pull");

    expect(objective.volumeContext.remainingWeek?.futureSlots).toEqual(["push", "legs", "pull"]);
    expect(objective.volumeContext.remainingWeek?.futureSlotCounts.get("pull")).toBe(1);
    expect(objective.volumeContext.remainingWeek?.futureSlotCounts.get("push")).toBe(1);
    expect(objective.volumeContext.remainingWeek?.futureSlotCounts.get("legs")).toBe(1);
  });

  it("does not let a current-week upper_a workout become continuity favorites bias for upper_b", () => {
    const history: WorkoutHistoryEntry[] = [
      {
        date: "2026-03-12T01:40:25.252Z",
        completed: true,
        status: "COMPLETED",
        sessionIntent: "upper",
        mesocycleSnapshot: {
          week: 2,
          session: 1,
          mesocycleId: "meso-1",
          slotId: "upper_a",
        },
        exercises: [
          {
            exerciseId: "machine-chest-press",
            sets: [{ exerciseId: "machine-chest-press", setIndex: 1, reps: 10, load: 180 }],
          },
        ],
      },
    ];

    const mapped = makeMappedContext(history);
    mapped.activeMesocycle = {
      id: "meso-1",
      slotSequenceJson: {
        version: 1,
        source: "handoff_draft",
        sequenceMode: "ordered_flexible",
        slots: [
          { slotId: "upper_a", intent: "UPPER" },
          { slotId: "lower_a", intent: "LOWER" },
          { slotId: "upper_b", intent: "UPPER" },
          { slotId: "lower_b", intent: "LOWER" },
        ],
      },
    } as unknown as MappedGenerationContext["activeMesocycle"];
    mapped.mappedConstraints.weeklySchedule = ["upper", "lower", "upper", "lower"];

    const objective = buildSelectionObjective(mapped, "upper", undefined, {
      sessionSlotId: "upper_b",
    });

    expect(objective.constraints.preferredContinuityExerciseIds?.size).toBe(0);
    expect(objective.constraints.continuityMinSetsByExerciseId?.size).toBe(0);
    expect(objective.preferences.favoriteExerciseIds.has("machine-chest-press")).toBe(false);
    expect(objective.weights.userPreference).toBeCloseTo(DEFAULT_SELECTION_WEIGHTS.userPreference, 6);
    expect(objective.weights.rotationNovelty).toBeCloseTo(
      DEFAULT_SELECTION_WEIGHTS.rotationNovelty,
      6
    );
  });

  it("uses persisted slot ids to keep duplicate-intent future slots unambiguous without same-week repeated-slot continuity carryover", () => {
    const history: WorkoutHistoryEntry[] = [
      {
        date: new Date().toISOString(),
        completed: true,
        status: "COMPLETED",
        sessionIntent: "upper",
        mesocycleSnapshot: {
          week: 2,
          session: 1,
          mesocycleId: "meso-1",
          slotId: "upper_a",
        },
        exercises: [
          {
            exerciseId: "machine-chest-press",
            sets: [{ exerciseId: "machine-chest-press", setIndex: 1, reps: 10, load: 180 }],
          },
        ],
      },
      {
        date: new Date(Date.now() + 1000).toISOString(),
        completed: true,
        status: "COMPLETED",
        sessionIntent: "lower",
        mesocycleSnapshot: {
          week: 2,
          session: 2,
          mesocycleId: "meso-1",
          slotId: "lower_a",
        },
        exercises: [
          {
            exerciseId: "tbar-row",
            sets: [{ exerciseId: "tbar-row", setIndex: 1, reps: 10, load: 135 }],
          },
        ],
      },
    ];

    const mapped = makeMappedContext(history);
    mapped.activeMesocycle = {
      id: "meso-1",
      slotSequenceJson: {
        version: 1,
        source: "handoff_draft",
        sequenceMode: "ordered_flexible",
        slots: [
          { slotId: "upper_a", intent: "UPPER" },
          { slotId: "lower_a", intent: "LOWER" },
          { slotId: "upper_b", intent: "UPPER" },
          { slotId: "lower_b", intent: "LOWER" },
        ],
      },
    } as unknown as MappedGenerationContext["activeMesocycle"];
    mapped.mappedConstraints.weeklySchedule = ["upper", "lower", "upper", "lower"];

    const objective = buildSelectionObjective(mapped, "upper", undefined, {
      sessionSlotId: "upper_b",
    });

    expect(objective.volumeContext.remainingWeek?.futureSlots).toEqual(["lower"]);
    expect(objective.volumeContext.remainingWeek?.futureSlotCounts.get("lower")).toBe(1);
    expect(objective.constraints.preferredContinuityExerciseIds?.size).toBe(0);
    expect(objective.preferences.favoriteExerciseIds.has("machine-chest-press")).toBe(false);
  });

  it("resolves the canonical slot policy into the selection objective", () => {
    const mapped = makeMappedContext([], {
      weeklySchedule: ["upper", "lower", "upper", "lower"],
      lifecycleVolumeTargets: {
        Chest: 10,
        Lats: 10,
        "Upper Back": 10,
        Biceps: 8,
        Quads: 10,
        Hamstrings: 10,
        Glutes: 10,
      },
    });
    mapped.activeMesocycle = {
      id: "meso-1",
      slotSequenceJson: {
        version: 1,
        source: "handoff_draft",
        sequenceMode: "ordered_flexible",
        slots: [
          { slotId: "upper_a", intent: "UPPER" },
          { slotId: "lower_a", intent: "LOWER" },
          { slotId: "upper_b", intent: "UPPER" },
          { slotId: "lower_b", intent: "LOWER" },
        ],
      },
    } as unknown as MappedGenerationContext["activeMesocycle"];

    const objective = buildSelectionObjective(mapped, "lower", undefined, {
      sessionSlotId: "lower_b",
    });

    expect(objective.slotPolicy?.currentSession).toEqual({
      sessionIntent: "lower",
      slotId: "lower_b",
      sequenceIndex: 3,
      slotArchetype: "lower_hinge_dominant",
      continuityScope: "slot",
      repeatedSlot: {
        occurrenceIndex: 1,
        totalSlots: 2,
      },
      compoundBias: {
        preferredMovementPatterns: ["hinge"],
        preferredPrimaryMuscles: ["Hamstrings", "Glutes"],
      },
      sessionShape: {
        id: "lower_hinge_dominant",
        preferredAccessoryPrimaryMuscles: ["Hamstrings", "Glutes"],
        requiredMovementPatterns: ["squat"],
        avoidDuplicatePatterns: ["hinge"],
        supportPenaltyPatterns: ["squat"],
        maxPreferredSupportPerPattern: 1,
      },
      compoundControl: {
        lanes: [
          {
            key: "primary",
            preferredMovementPatterns: ["hinge"],
            compatibleMovementPatterns: [],
            fallbackOnlyMovementPatterns: ["squat"],
            preferredPrimaryMuscles: ["Hamstrings", "Glutes"],
          },
        ],
      },
    });
    expect(objective.slotPolicy?.futurePlanning.futureSlots.map((slot) => slot.slotId)).toEqual([
      "upper_a",
      "lower_a",
      "upper_b",
    ]);
  });

  it("drops out-of-lane compound continuity favorites when viable in-lane options exist", () => {
    const exerciseLibrary = [
      makeExercise("bench", "Bench Press", ["horizontal_push"], ["push"], ["Chest"], ["Triceps", "Front Delts"]),
      makeExercise("ohp", "Overhead Press", ["vertical_push"], ["push"], ["Chest", "Front Delts"], ["Triceps"]),
      makeExercise("row", "Chest-Supported Row", ["horizontal_pull"], ["pull"], ["Lats", "Upper Back"], ["Biceps"]),
      makeExercise("pulldown", "Lat Pulldown", ["vertical_pull"], ["pull"], ["Lats"], ["Biceps"]),
      makeExercise("rear-delt", "Rear Delt Fly", ["isolation"], ["pull"], ["Rear Delts"], [], {
        isMainLiftEligible: false,
        isCompound: false,
        fatigueCost: 2,
      }),
      makeExercise("lateral", "Lateral Raise", ["isolation"], ["push"], ["Side Delts"], [], {
        isMainLiftEligible: false,
        isCompound: false,
        fatigueCost: 2,
      }),
      makeExercise("curl", "Cable Curl", ["isolation"], ["pull"], ["Biceps"], [], {
        isMainLiftEligible: false,
        isCompound: false,
        fatigueCost: 2,
      }),
      makeExercise("triceps", "Triceps Pressdown", ["isolation"], ["push"], ["Triceps"], [], {
        isMainLiftEligible: false,
        isCompound: false,
        fatigueCost: 2,
      }),
    ];
    const history: WorkoutHistoryEntry[] = [
      {
        date: "2026-03-05T01:40:25.252Z",
        completed: true,
        status: "COMPLETED",
        sessionIntent: "upper",
        mesocycleSnapshot: {
          week: 1,
          session: 3,
          mesocycleId: "meso-1",
          slotId: "upper_b",
        },
        exercises: [
          {
            exerciseId: "bench",
            sets: [
              { exerciseId: "bench", setIndex: 1, reps: 8, load: 185 },
              { exerciseId: "bench", setIndex: 2, reps: 8, load: 185 },
            ],
          },
        ],
      },
    ];
    const mapped = makeMappedContext(history, {
      exerciseLibrary,
      weeklySchedule: ["upper", "lower", "upper", "lower"],
      lifecycleVolumeTargets: {
        Chest: 10,
        Lats: 10,
        "Upper Back": 10,
        Biceps: 8,
        "Front Delts": 8,
        "Rear Delts": 8,
        "Side Delts": 8,
        Triceps: 8,
      },
    });
    mapped.activeMesocycle = {
      id: "meso-1",
      slotSequenceJson: {
        version: 1,
        source: "handoff_draft",
        sequenceMode: "ordered_flexible",
        slots: [
          { slotId: "upper_a", intent: "UPPER" },
          { slotId: "lower_a", intent: "LOWER" },
          { slotId: "upper_b", intent: "UPPER" },
          { slotId: "lower_b", intent: "LOWER" },
        ],
      },
    } as unknown as MappedGenerationContext["activeMesocycle"];

    const objective = buildSelectionObjective(mapped, "upper", undefined, {
      sessionSlotId: "upper_b",
    });

    expect(objective.constraints.preferredContinuityExerciseIds?.has("bench")).toBe(false);
    expect(objective.preferences.favoriteExerciseIds.has("bench")).toBe(false);
    expect(objective.constraints.continuityMinSetsByExerciseId?.has("bench")).toBe(false);
    expect(objective.resolvedCompoundControl?.lanes.map((lane) => [lane.key, lane.activeTier])).toEqual([
      ["press", "preferred"],
      ["pull", "preferred"],
    ]);
  });

  it("threads distinct repeated-slot session-shape refinement through the selection objective", () => {
    const mapped = makeMappedContext([], {
      weeklySchedule: ["upper", "lower", "upper", "lower"],
      lifecycleVolumeTargets: {
        Chest: 10,
        Lats: 10,
        "Upper Back": 10,
        "Front Delts": 8,
        "Rear Delts": 8,
        "Side Delts": 8,
        Biceps: 8,
        Triceps: 8,
      },
    });
    mapped.activeMesocycle = {
      id: "meso-1",
      slotSequenceJson: {
        version: 1,
        source: "handoff_draft",
        sequenceMode: "ordered_flexible",
        slots: [
          { slotId: "upper_a", intent: "UPPER" },
          { slotId: "lower_a", intent: "LOWER" },
          { slotId: "upper_b", intent: "UPPER" },
          { slotId: "lower_b", intent: "LOWER" },
        ],
      },
    } as unknown as MappedGenerationContext["activeMesocycle"];

    const upperAObjective = buildSelectionObjective(mapped, "upper", undefined, {
      sessionSlotId: "upper_a",
    });
    const upperBObjective = buildSelectionObjective(mapped, "upper", undefined, {
      sessionSlotId: "upper_b",
    });

    expect(upperAObjective.slotPolicy?.currentSession?.sessionShape).toEqual({
      id: "upper_horizontal_balanced",
      preferredAccessoryPrimaryMuscles: ["Chest", "Upper Back", "Rear Delts"],
      requiredMovementPatterns: ["vertical_pull", "horizontal_pull"],
      avoidDuplicatePatterns: ["horizontal_pull"],
    });
    expect(upperBObjective.slotPolicy?.currentSession?.sessionShape).toEqual({
      id: "upper_vertical_balanced",
      preferredAccessoryPrimaryMuscles: ["Lats", "Front Delts", "Side Delts"],
      requiredMovementPatterns: ["horizontal_pull"],
      avoidDuplicatePatterns: ["vertical_pull"],
      supportPenaltyPatterns: ["vertical_push"],
      maxPreferredSupportPerPattern: 1,
    });
  });

  it("gives repeated upper slots distinct upstream compound spines when valid alternatives exist", () => {
    const exerciseLibrary = [
      makeExercise("bench", "Bench Press", ["horizontal_push"], ["push"], ["Chest"], ["Triceps", "Front Delts"]),
      makeExercise("incline", "Incline Press", ["vertical_push"], ["push"], ["Chest", "Front Delts"], ["Triceps"]),
      makeExercise("row", "Chest-Supported Row", ["horizontal_pull"], ["pull"], ["Lats", "Upper Back"], ["Biceps"]),
      makeExercise("pulldown", "Lat Pulldown", ["vertical_pull"], ["pull"], ["Lats"], ["Biceps"]),
      makeExercise("rear-delt", "Rear Delt Fly", ["isolation"], ["pull"], ["Rear Delts"], [], {
        isMainLiftEligible: false,
        isCompound: false,
        fatigueCost: 2,
      }),
      makeExercise("curl", "Cable Curl", ["isolation"], ["pull"], ["Biceps"], [], {
        isMainLiftEligible: false,
        isCompound: false,
        fatigueCost: 2,
      }),
      makeExercise("lateral", "Lateral Raise", ["isolation"], ["push"], ["Side Delts"], [], {
        isMainLiftEligible: false,
        isCompound: false,
        fatigueCost: 2,
      }),
      makeExercise("triceps", "Triceps Pressdown", ["isolation"], ["push"], ["Triceps"], [], {
        isMainLiftEligible: false,
        isCompound: false,
        fatigueCost: 2,
      }),
    ];
    const mapped = makeMappedContext([], {
      exerciseLibrary,
      weeklySchedule: ["upper", "lower", "upper", "lower"],
      lifecycleVolumeTargets: {
        Chest: 10,
        Lats: 10,
        "Upper Back": 10,
        Biceps: 8,
        "Front Delts": 8,
        "Rear Delts": 8,
        "Side Delts": 8,
        Triceps: 8,
      },
    });
    mapped.activeMesocycle = {
      id: "meso-1",
      slotSequenceJson: {
        version: 1,
        source: "handoff_draft",
        sequenceMode: "ordered_flexible",
        slots: [
          { slotId: "upper_a", intent: "UPPER" },
          { slotId: "lower_a", intent: "LOWER" },
          { slotId: "upper_b", intent: "UPPER" },
          { slotId: "lower_b", intent: "LOWER" },
        ],
      },
    } as unknown as MappedGenerationContext["activeMesocycle"];

    const upperAObjective = buildSelectionObjective(mapped, "upper", undefined, {
      sessionSlotId: "upper_a",
    });
    const upperBObjective = buildSelectionObjective(mapped, "upper", undefined, {
      sessionSlotId: "upper_b",
    });

    const upperA = selectExercisesOptimized(exerciseLibrary, upperAObjective);
    const upperB = selectExercisesOptimized(exerciseLibrary, upperBObjective);

    expect(countSelectedCompoundPattern(upperA, "horizontal_push")).toBeGreaterThan(0);
    expect(countSelectedCompoundPattern(upperA, "horizontal_pull")).toBeGreaterThan(0);
    expect(countSelectedCompoundPattern(upperB, "vertical_push")).toBeGreaterThan(0);
    expect(countSelectedCompoundPattern(upperB, "vertical_pull")).toBeGreaterThan(0);
    expect(
      upperA.selected
        .filter((candidate) => candidate.exercise.isCompound ?? false)
        .map((candidate) => candidate.exercise.id)
    ).not.toEqual(
      upperB.selected
        .filter((candidate) => candidate.exercise.isCompound ?? false)
        .map((candidate) => candidate.exercise.id)
    );
  });

  it("trends lower_a squat-dominant and lower_b hinge-dominant when valid alternatives exist", () => {
    const exerciseLibrary = [
      makeExercise("back-squat", "Back Squat", ["squat"], ["legs"], ["Quads", "Glutes"]),
      makeExercise("hack-squat", "Hack Squat", ["squat"], ["legs"], ["Quads", "Glutes"], [], {
        isMainLiftEligible: false,
      }),
      makeExercise("rdl", "Romanian Deadlift", ["hinge"], ["legs"], ["Hamstrings", "Glutes"]),
      makeExercise("hip-thrust", "Hip Thrust", ["hinge"], ["legs"], ["Glutes", "Hamstrings"], [], {
        isMainLiftEligible: false,
      }),
      makeExercise("leg-curl", "Leg Curl", ["isolation"], ["legs"], ["Hamstrings"], [], {
        isMainLiftEligible: false,
        isCompound: false,
        fatigueCost: 2,
      }),
      makeExercise("leg-extension", "Leg Extension", ["isolation"], ["legs"], ["Quads"], [], {
        isMainLiftEligible: false,
        isCompound: false,
        fatigueCost: 2,
      }),
      makeExercise("calf-raise", "Calf Raise", ["isolation"], ["legs"], ["Calves"], [], {
        isMainLiftEligible: false,
        isCompound: false,
        fatigueCost: 2,
      }),
    ];
    const mapped = makeMappedContext([], {
      exerciseLibrary,
      weeklySchedule: ["upper", "lower", "upper", "lower"],
      lifecycleVolumeTargets: {
        Quads: 10,
        Hamstrings: 10,
        Glutes: 10,
        Calves: 6,
      },
    });
    mapped.activeMesocycle = {
      id: "meso-1",
      slotSequenceJson: {
        version: 1,
        source: "handoff_draft",
        sequenceMode: "ordered_flexible",
        slots: [
          { slotId: "upper_a", intent: "UPPER" },
          { slotId: "lower_a", intent: "LOWER" },
          { slotId: "upper_b", intent: "UPPER" },
          { slotId: "lower_b", intent: "LOWER" },
        ],
      },
    } as unknown as MappedGenerationContext["activeMesocycle"];

    const lowerA = selectExercisesOptimized(
      exerciseLibrary,
      buildSelectionObjective(mapped, "lower", undefined, { sessionSlotId: "lower_a" })
    );
    const lowerB = selectExercisesOptimized(
      exerciseLibrary,
      buildSelectionObjective(mapped, "lower", undefined, { sessionSlotId: "lower_b" })
    );

    expect(selectedCompoundPatterns(lowerA).slice(0, 2)).toEqual(["squat", "squat"]);
    expect(selectedCompoundPatterns(lowerB).slice(0, 2)).toEqual(["hinge", "hinge"]);
  });

  it("falls back cleanly when the preferred repeated-slot compound pattern is unavailable", () => {
    const exerciseLibrary = [
      makeExercise("back-squat", "Back Squat", ["squat"], ["legs"], ["Quads", "Glutes"]),
      makeExercise("leg-curl", "Leg Curl", ["isolation"], ["legs"], ["Hamstrings"], [], {
        isMainLiftEligible: false,
        isCompound: false,
        fatigueCost: 2,
      }),
      makeExercise("leg-extension", "Leg Extension", ["isolation"], ["legs"], ["Quads"], [], {
        isMainLiftEligible: false,
        isCompound: false,
        fatigueCost: 2,
      }),
      makeExercise("calf-raise", "Calf Raise", ["isolation"], ["legs"], ["Calves"], [], {
        isMainLiftEligible: false,
        isCompound: false,
        fatigueCost: 2,
      }),
    ];
    const mapped = makeMappedContext([], {
      exerciseLibrary,
      weeklySchedule: ["upper", "lower", "upper", "lower"],
      lifecycleVolumeTargets: {
        Quads: 10,
        Hamstrings: 10,
        Glutes: 10,
        Calves: 6,
      },
    });
    mapped.activeMesocycle = {
      id: "meso-1",
      slotSequenceJson: {
        version: 1,
        source: "handoff_draft",
        sequenceMode: "ordered_flexible",
        slots: [
          { slotId: "upper_a", intent: "UPPER" },
          { slotId: "lower_a", intent: "LOWER" },
          { slotId: "upper_b", intent: "UPPER" },
          { slotId: "lower_b", intent: "LOWER" },
        ],
      },
    } as unknown as MappedGenerationContext["activeMesocycle"];

    const constrainedLowerB = selectExercisesOptimized(
      exerciseLibrary,
      buildSelectionObjective(mapped, "lower", undefined, { sessionSlotId: "lower_b" })
    );

    expect(constrainedLowerB.constraintsSatisfied).toBe(true);
    expect(countSelectedCompoundPattern(constrainedLowerB, "squat")).toBeGreaterThan(0);
    expect(countSelectedCompoundPattern(constrainedLowerB, "hinge")).toBe(0);
  });


  it("builds effectiveActual from the shared stimulus helper instead of binary primary credit", () => {
    const recentDate = new Date().toISOString();
    const history: WorkoutHistoryEntry[] = [
      {
        date: recentDate,
        completed: true,
        status: "COMPLETED",
        sessionIntent: "pull",
        mesocycleSnapshot: { week: 2, mesocycleId: "meso-1" },
        exercises: [
          {
            exerciseId: "tbar-row",
            sets: [
              { exerciseId: "tbar-row", setIndex: 1, reps: 10, load: 135 },
              { exerciseId: "tbar-row", setIndex: 2, reps: 10, load: 135 },
            ],
          },
        ],
      },
    ];

    const objective = buildSelectionObjective(makeMappedContext(history), "pull");

    expect(objective.volumeContext.weeklyActual.get("Biceps")).toBe(0);
    expect(objective.volumeContext.effectiveActual.get("Lats")).toBeCloseTo(1.6, 6);
    expect(objective.volumeContext.effectiveActual.get("Upper Back")).toBe(2);
    expect(objective.volumeContext.effectiveActual.get("Biceps")).toBeCloseTo(0.8, 6);
  });

  it("uses lifecycle set targets as the canonical weekly set progression", () => {
    const history: WorkoutHistoryEntry[] = [
      {
        date: "2026-02-17T01:40:25.252Z",
        completed: true,
        status: "COMPLETED",
        sessionIntent: "pull",
        exercises: [{ exerciseId: "tbar-row", sets: [{ exerciseId: "tbar-row", setIndex: 1, reps: 10, load: 135 }] }],
      },
    ];
    const mapped = makeMappedContext(history);
    mapped.lifecycleWeek = 3;
    mapped.weekInBlock = 3;
    mapped.cycleContext.weekInMeso = 3;
    mapped.cycleContext.weekInBlock = 3;
    mapped.effectivePeriodization.lifecycleSetTargets = { main: 5, accessory: 4 };
    const objective = buildSelectionObjective(mapped, "pull");
    expect(objective.constraints.lifecycleSetTargets).toEqual({ main: 5, accessory: 4 });
  });

  it("exports documented session cap policy values", () => {
    expect(SESSION_CAPS.minExercises).toBe(3);
    expect(SESSION_CAPS.maxExercises).toBe(6);
    expect(SESSION_CAPS.maxDirectSetsPerMuscle).toBe(12);
  });
});

