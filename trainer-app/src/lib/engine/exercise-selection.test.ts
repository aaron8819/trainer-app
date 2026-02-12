import { describe, expect, it } from "vitest";
import type { Exercise, WorkoutHistoryEntry } from "./types";
import {
  rankCandidatesForCalibration,
  selectExercises,
  type SelectionInput,
} from "./exercise-selection";

function makeExercise(
  overrides: Partial<Exercise> & Pick<Exercise, "id" | "name">
): Exercise {
  return {
    id: overrides.id,
    name: overrides.name,
    movementPatterns: overrides.movementPatterns ?? [],
    jointStress: overrides.jointStress ?? "low",
    isMainLiftEligible: overrides.isMainLiftEligible ?? false,
    isCompound: overrides.isCompound ?? false,
    fatigueCost: overrides.fatigueCost ?? 3,
    equipment: overrides.equipment ?? ["dumbbell"],
    primaryMuscles: overrides.primaryMuscles ?? [],
    secondaryMuscles: overrides.secondaryMuscles ?? [],
    sfrScore: overrides.sfrScore ?? 3,
    lengthPositionScore: overrides.lengthPositionScore ?? 3,
    repRangeMin: overrides.repRangeMin,
    repRangeMax: overrides.repRangeMax,
    timePerSetSec: overrides.timePerSetSec,
    contraindications: overrides.contraindications,
    stimulusBias: overrides.stimulusBias,
    splitTags: overrides.splitTags ?? ["push"],
    isUnilateral: overrides.isUnilateral,
    difficulty: overrides.difficulty,
    muscleSraHours: overrides.muscleSraHours,
  };
}

function makeHistoryEntry(
  date: string,
  exerciseId: string,
  movementPattern: "push" | "pull" | "squat" | "hinge" | "lunge" | "carry" | "rotate" | "push_pull",
  primaryMuscles: string[],
  setCount: number,
  forcedSplit?: "push" | "pull" | "legs" | "upper" | "lower" | "full_body"
): WorkoutHistoryEntry {
  return {
    date,
    completed: true,
    status: "COMPLETED",
    forcedSplit,
    exercises: [
      {
        exerciseId,
        movementPattern,
        primaryMuscles,
        sets: Array.from({ length: setCount }, (_, index) => ({
          exerciseId,
          setIndex: index + 1,
          reps: 10,
        })),
      },
    ],
  };
}

function makeInput(overrides?: Partial<SelectionInput>): SelectionInput {
  return {
    mode: "intent",
    intent: "pull",
    weekInBlock: 2,
    mesocycleLength: 4,
    sessionMinutes: 60,
    trainingAge: "intermediate",
    goals: { primary: "hypertrophy", secondary: "none" },
    constraints: {
      availableEquipment: ["dumbbell", "cable", "machine", "barbell", "bench", "rack"],
      daysPerWeek: 4,
    },
    fatigueState: { readinessScore: 3 },
    history: [],
    exerciseLibrary: [],
    ...overrides,
  };
}

describe("selectExercises", () => {
  it("caps pins based on target slot count", () => {
    const library = [
      makeExercise({ id: "bench", name: "Bench", isMainLiftEligible: true, movementPatterns: ["horizontal_push"], primaryMuscles: ["Chest"] }),
      makeExercise({ id: "incline", name: "Incline Press", isMainLiftEligible: true, movementPatterns: ["horizontal_push"], primaryMuscles: ["Chest"] }),
      makeExercise({ id: "lateral", name: "Lateral Raise", movementPatterns: ["vertical_push"], primaryMuscles: ["Side Delts"] }),
      makeExercise({ id: "fly", name: "Cable Fly", movementPatterns: ["horizontal_push"], primaryMuscles: ["Chest"] }),
      makeExercise({ id: "tri", name: "Triceps Pushdown", movementPatterns: ["vertical_push"], primaryMuscles: ["Triceps"] }),
    ];

    const result = selectExercises(
      makeInput({
        mode: "template",
        intent: "push",
        exerciseLibrary: library,
        templateExerciseIds: ["bench", "incline", "lateral", "fly", "tri"],
        pinnedExerciseIds: ["bench", "incline", "lateral", "fly"],
      })
    );

    expect(result.selectedExerciseIds.length).toBeGreaterThan(0);
    const pinnedSteps = Object.values(result.rationale).filter(
      (entry) => entry.selectedStep === "pin"
    );
    expect(pinnedSteps.length).toBeLessThanOrEqual(3);
  });

  it("lets biceps-focused accessory outrank lat work when lats are already saturated", () => {
    const row = makeExercise({
      id: "row-main",
      name: "Row Main",
      isMainLiftEligible: true,
      isCompound: true,
      movementPatterns: ["horizontal_pull"],
      primaryMuscles: ["Lats", "Upper Back"],
      secondaryMuscles: ["Biceps"],
      fatigueCost: 4,
    });
    const latPulldown = makeExercise({
      id: "lat-pull",
      name: "Lat Pulldown",
      movementPatterns: ["vertical_pull"],
      primaryMuscles: ["Lats"],
      secondaryMuscles: ["Biceps"],
      fatigueCost: 3,
    });
    const curl = makeExercise({
      id: "curl",
      name: "Cable Curl",
      movementPatterns: ["horizontal_pull"],
      primaryMuscles: ["Biceps"],
      fatigueCost: 2,
      sfrScore: 4,
    });
    const facePull = makeExercise({
      id: "face-pull",
      name: "Face Pull",
      movementPatterns: ["horizontal_pull"],
      primaryMuscles: ["Rear Delts", "Upper Back"],
      fatigueCost: 2,
    });

    const history = [
      makeHistoryEntry(
        new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
        "row-main",
        "pull",
        ["Lats", "Upper Back"],
        20,
        "pull"
      ),
    ];

    const result = selectExercises(
      makeInput({
        intent: "pull",
        exerciseLibrary: [row, latPulldown, curl, facePull],
        history,
      })
    );

    expect(result.accessoryIds.length).toBeGreaterThan(0);
    expect(result.accessoryIds[0]).toBe("curl");
  });

  it("supports body_part sessions with zero main lifts when no main-eligible target exists", () => {
    const curl = makeExercise({
      id: "curl",
      name: "Cable Curl",
      movementPatterns: ["horizontal_pull"],
      primaryMuscles: ["Biceps"],
      fatigueCost: 2,
    });
    const preacherCurl = makeExercise({
      id: "preacher",
      name: "Preacher Curl",
      movementPatterns: ["horizontal_pull"],
      primaryMuscles: ["Biceps"],
      fatigueCost: 2,
    });
    const hammerCurl = makeExercise({
      id: "hammer",
      name: "Hammer Curl",
      movementPatterns: ["horizontal_pull"],
      primaryMuscles: ["Biceps", "Forearms"],
      fatigueCost: 2,
    });

    const result = selectExercises(
      makeInput({
        intent: "body_part",
        targetMuscles: ["Biceps"],
        exerciseLibrary: [curl, preacherCurl, hammerCurl],
      })
    );

    expect(result.mainLiftIds).toHaveLength(0);
    expect(result.accessoryIds.length).toBeGreaterThan(0);
  });

  it("allocates intent-mode set targets and respects beginner max-set cap", () => {
    const squat = makeExercise({
      id: "squat",
      name: "Back Squat",
      isMainLiftEligible: true,
      isCompound: true,
      movementPatterns: ["squat"],
      primaryMuscles: ["Quads", "Glutes"],
      fatigueCost: 4,
    });
    const splitSquat = makeExercise({
      id: "split-squat",
      name: "Split Squat",
      movementPatterns: ["lunge"],
      primaryMuscles: ["Quads", "Glutes"],
      fatigueCost: 3,
    });
    const legExtension = makeExercise({
      id: "leg-extension",
      name: "Leg Extension",
      movementPatterns: ["squat"],
      primaryMuscles: ["Quads"],
      fatigueCost: 2,
    });

    const result = selectExercises(
      makeInput({
        intent: "legs",
        trainingAge: "beginner",
        sessionMinutes: 75,
        exerciseLibrary: [squat, splitSquat, legExtension],
      })
    );

    const setTargets = Object.values(result.perExerciseSetTargets);
    expect(setTargets.length).toBeGreaterThan(0);
    expect(Math.max(...setTargets)).toBeLessThanOrEqual(4);
    expect(setTargets.some((sets) => sets > 2)).toBe(true);
  });

  it("stage-0 cold start uses starter fallback session picks", () => {
    const bench = makeExercise({
      id: "bench",
      name: "Bench Press",
      isMainLiftEligible: true,
      movementPatterns: ["horizontal_push"],
      primaryMuscles: ["Chest"],
      fatigueCost: 3,
    });
    const lateralRaise = makeExercise({
      id: "lat-raise",
      name: "Lateral Raise",
      movementPatterns: ["vertical_push"],
      primaryMuscles: ["Side Delts"],
      fatigueCost: 2,
    });

    const result = selectExercises(
      makeInput({
        intent: "push",
        exerciseLibrary: [bench, lateralRaise],
        coldStart: { stage: 0 },
      })
    );

    expect(result.selectedExerciseIds.length).toBeGreaterThan(0);
  });

  it("stage-1 cold start limits auto-selection to accessory slots", () => {
    const row = makeExercise({
      id: "row",
      name: "Barbell Row",
      isMainLiftEligible: true,
      movementPatterns: ["horizontal_pull"],
      primaryMuscles: ["Lats", "Upper Back"],
      fatigueCost: 3,
    });
    const curl = makeExercise({
      id: "curl",
      name: "Cable Curl",
      movementPatterns: ["horizontal_pull"],
      primaryMuscles: ["Biceps"],
      fatigueCost: 2,
    });

    const result = selectExercises(
      makeInput({
        intent: "pull",
        exerciseLibrary: [row, curl],
        coldStart: { stage: 1 },
      })
    );

    expect(result.mainLiftIds).toHaveLength(0);
    expect(result.accessoryIds.length).toBeGreaterThan(0);
  });

  it("enforces primary-muscle overlap hard filter for body_part intent", () => {
    const chestPress = makeExercise({
      id: "chest-press",
      name: "Machine Chest Press",
      movementPatterns: ["horizontal_push"],
      isMainLiftEligible: true,
      isCompound: true,
      primaryMuscles: ["Chest", "Triceps"],
      secondaryMuscles: ["Front Delts"],
      fatigueCost: 3,
    });
    const tricepsExtension = makeExercise({
      id: "tri-ext",
      name: "Overhead Cable Triceps Extension",
      movementPatterns: ["vertical_push"],
      primaryMuscles: ["Triceps"],
      fatigueCost: 2,
    });
    const pullover = makeExercise({
      id: "pullover",
      name: "Dumbbell Pullover",
      movementPatterns: ["vertical_pull"],
      primaryMuscles: ["Lats"],
      secondaryMuscles: ["Chest"],
      fatigueCost: 2,
    });

    const result = selectExercises(
      makeInput({
        intent: "body_part",
        targetMuscles: ["Chest", "Triceps"],
        exerciseLibrary: [chestPress, tricepsExtension, pullover],
      })
    );

    expect(result.selectedExerciseIds).toContain("chest-press");
    expect(result.selectedExerciseIds).toContain("tri-ext");
    expect(result.selectedExerciseIds).not.toContain("pullover");
  });

  it("applies low-SFR accessory hard filter only for hypertrophy/fat_loss goals", () => {
    const lowSfr = makeExercise({
      id: "low-sfr",
      name: "Dead Hang",
      movementPatterns: ["vertical_pull"],
      primaryMuscles: ["Forearms"],
      fatigueCost: 1,
      sfrScore: 1,
      isMainLiftEligible: true,
    });
    const mediumSfr = makeExercise({
      id: "medium-sfr",
      name: "Cable Curl",
      movementPatterns: ["horizontal_pull"],
      primaryMuscles: ["Biceps"],
      fatigueCost: 2,
      sfrScore: 2,
    });
    const missingSfr = makeExercise({
      id: "missing-sfr",
      name: "Rear Delt Fly",
      movementPatterns: ["horizontal_pull"],
      primaryMuscles: ["Rear Delts"],
      fatigueCost: 2,
    });
    delete missingSfr.sfrScore;

    const library = [lowSfr, mediumSfr, missingSfr];
    const hypertrophyInput = makeInput({
      intent: "pull",
      goals: { primary: "hypertrophy", secondary: "none" },
      exerciseLibrary: library,
    });
    const strengthInput = makeInput({
      intent: "pull",
      goals: { primary: "strength", secondary: "none" },
      exerciseLibrary: library,
    });

    const hypertrophyAccessory = rankCandidatesForCalibration(hypertrophyInput, "accessory");
    expect(hypertrophyAccessory.some((entry) => entry.exerciseId === "low-sfr")).toBe(false);
    expect(hypertrophyAccessory.some((entry) => entry.exerciseId === "medium-sfr")).toBe(true);
    expect(hypertrophyAccessory.some((entry) => entry.exerciseId === "missing-sfr")).toBe(true);

    const strengthAccessory = rankCandidatesForCalibration(strengthInput, "accessory");
    expect(strengthAccessory.some((entry) => entry.exerciseId === "low-sfr")).toBe(true);
    expect(strengthAccessory.some((entry) => entry.exerciseId === "medium-sfr")).toBe(true);
    expect(strengthAccessory.some((entry) => entry.exerciseId === "missing-sfr")).toBe(true);
  });

  it("enforces full_body push/pull/lower compound coverage floor when available", () => {
    const pushCompound = makeExercise({
      id: "push-main",
      name: "Incline Dumbbell Press",
      movementPatterns: ["horizontal_push"],
      isMainLiftEligible: true,
      isCompound: true,
      primaryMuscles: ["Chest", "Triceps"],
      fatigueCost: 4,
    });
    const pullCompound = makeExercise({
      id: "pull-main",
      name: "Weighted Pull-Up",
      movementPatterns: ["vertical_pull"],
      isMainLiftEligible: true,
      isCompound: true,
      primaryMuscles: ["Lats", "Biceps"],
      fatigueCost: 4,
    });
    const lowerCompound = makeExercise({
      id: "lower-main",
      name: "Belt Squat",
      movementPatterns: ["squat"],
      isMainLiftEligible: true,
      isCompound: true,
      primaryMuscles: ["Quads", "Glutes"],
      fatigueCost: 5,
    });
    const pullAccessory = makeExercise({
      id: "pull-a",
      name: "Chest-Supported Row",
      movementPatterns: ["horizontal_pull"],
      isCompound: false,
      primaryMuscles: ["Lats", "Upper Back"],
      fatigueCost: 1,
      sfrScore: 5,
    });

    const result = selectExercises(
      makeInput({
        intent: "full_body",
        trainingAge: "advanced",
        sessionMinutes: 50,
        exerciseLibrary: [pushCompound, pullCompound, lowerCompound, pullAccessory],
      })
    );

    expect(result.selectedExerciseIds).toContain("push-main");
    expect(result.selectedExerciseIds).toContain("pull-main");
    expect(result.selectedExerciseIds).toContain("lower-main");
  });

  it("filters same-muscle same-pattern accessory duplicates in intent mode", () => {
    const dbRow = makeExercise({
      id: "db-row",
      name: "Chest-Supported Dumbbell Row",
      movementPatterns: ["horizontal_pull"],
      primaryMuscles: ["Lats", "Upper Back"],
      fatigueCost: 2,
      isCompound: true,
    });
    const tbarRow = makeExercise({
      id: "tbar-row",
      name: "Chest-Supported T-Bar Row",
      movementPatterns: ["horizontal_pull"],
      primaryMuscles: ["Lats", "Upper Back"],
      fatigueCost: 2,
      isCompound: true,
    });
    const curl = makeExercise({
      id: "curl",
      name: "Cable Curl",
      movementPatterns: ["horizontal_pull"],
      primaryMuscles: ["Biceps"],
      fatigueCost: 2,
    });

    const ranked = rankCandidatesForCalibration(
      makeInput({
        intent: "pull",
        sessionMinutes: 50,
        exerciseLibrary: [dbRow, tbarRow, curl],
      }),
      "accessory",
      [{ exerciseId: "db-row", role: "accessory" }]
    );
    const tbar = ranked.find((entry) => entry.exerciseId === "tbar-row");
    expect(tbar).toBeUndefined();
  });

  it("soft-rebalances full_body set totals so one category does not exceed 3x the lowest", () => {
    const pushCompound = makeExercise({
      id: "push-main",
      name: "Dumbbell Bench Press",
      movementPatterns: ["horizontal_push"],
      isMainLiftEligible: true,
      isCompound: true,
      primaryMuscles: ["Chest", "Triceps"],
      fatigueCost: 4,
    });
    const pullCompound = makeExercise({
      id: "pull-main",
      name: "Chin-Up",
      movementPatterns: ["vertical_pull"],
      isMainLiftEligible: true,
      isCompound: true,
      primaryMuscles: ["Lats", "Biceps"],
      fatigueCost: 3,
    });
    const lowerCompound = makeExercise({
      id: "lower-main",
      name: "Romanian Deadlift",
      movementPatterns: ["hinge"],
      isMainLiftEligible: true,
      isCompound: true,
      primaryMuscles: ["Hamstrings", "Glutes"],
      fatigueCost: 5,
    });
    const pullAccessory = makeExercise({
      id: "pull-a",
      name: "Chest-Supported Dumbbell Row",
      movementPatterns: ["horizontal_pull"],
      primaryMuscles: ["Lats", "Upper Back"],
      fatigueCost: 1,
      sfrScore: 5,
    });

    const result = selectExercises(
      makeInput({
        intent: "full_body",
        trainingAge: "advanced",
        sessionMinutes: 50,
        exerciseLibrary: [pushCompound, pullCompound, lowerCompound, pullAccessory],
      })
    );

    const totals = { push: 0, pull: 0, lower: 0 };
    for (const id of result.selectedExerciseIds) {
      const sets = result.perExerciseSetTargets[id] ?? 2;
      const exercise = [pushCompound, pullCompound, lowerCompound, pullAccessory].find(
        (item) => item.id === id
      );
      if (!exercise) continue;
      const patterns = exercise.movementPatterns ?? [];
      if (patterns.some((pattern) => pattern === "squat" || pattern === "hinge" || pattern === "lunge")) {
        totals.lower += sets;
      } else if (patterns.some((pattern) => pattern === "horizontal_push" || pattern === "vertical_push")) {
        totals.push += sets;
      } else if (patterns.some((pattern) => pattern === "horizontal_pull" || pattern === "vertical_pull")) {
        totals.pull += sets;
      }
    }

    const values = [totals.push, totals.pull, totals.lower].filter((value) => value > 0);
    expect(values.length).toBe(3);
    const max = Math.max(...values);
    const min = Math.min(...values);
    expect(max).toBeLessThanOrEqual(min * 3);
  });
});
