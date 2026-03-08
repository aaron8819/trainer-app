import { describe, expect, it } from "vitest";
import { buildSelectionObjective, SESSION_CAPS } from "./selection-adapter";
import type { MappedGenerationContext } from "./types";
import type { WorkoutHistoryEntry, Exercise } from "@/lib/engine/types";

function makeExercise(
  id: string,
  name: string,
  movementPatterns: Exercise["movementPatterns"],
  splitTags: Exercise["splitTags"],
  primaryMuscles: string[],
  secondaryMuscles: string[] = []
): Exercise {
  return {
    id,
    name,
    movementPatterns,
    splitTags,
    jointStress: "medium",
    isMainLiftEligible: true,
    isCompound: true,
    fatigueCost: 3,
    equipment: ["machine"],
    primaryMuscles,
    secondaryMuscles,
    sfrScore: 3,
    lengthPositionScore: 3,
  };
}

function makeMappedContext(history: WorkoutHistoryEntry[]): MappedGenerationContext {
  const exerciseLibrary = [
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
      splitType: "upper_lower",
      weeklySchedule: ["push", "pull", "legs", "pull"],
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
    lifecycleVolumeTargets: {
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

