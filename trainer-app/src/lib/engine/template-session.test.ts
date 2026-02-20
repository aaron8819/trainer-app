import { describe, it, expect } from "vitest";
import {
  generateWorkoutFromTemplate,
  estimateWorkoutMinutes,
  type TemplateExerciseInput,
  type GenerateFromTemplateOptions,
} from "./template-session";
import {
  exampleUser,
  exampleGoals,
  exampleExerciseLibrary,
} from "./sample-data";
import type { Exercise } from "./types";

function makeOptions(
  overrides?: Partial<GenerateFromTemplateOptions>
): GenerateFromTemplateOptions {
  return {
    profile: exampleUser,
    goals: exampleGoals,
    history: [],
    exerciseLibrary: exampleExerciseLibrary,
    ...overrides,
  };
}

function makeTemplateExercises(ids: string[]): TemplateExerciseInput[] {
  return ids.map((id, index) => {
    const exercise = exampleExerciseLibrary.find((e) => e.id === id);
    if (!exercise) throw new Error(`Exercise ${id} not found`);
    return { exercise, orderIndex: index };
  });
}

function makeTemplateExercisesWithSuperset(
  entries: { id: string; supersetGroup?: number }[]
): TemplateExerciseInput[] {
  return entries.map((entry, index) => {
    const exercise = exampleExerciseLibrary.find((e) => e.id === entry.id);
    if (!exercise) throw new Error(`Exercise ${entry.id} not found`);
    return {
      exercise,
      orderIndex: index,
      supersetGroup: entry.supersetGroup,
    };
  });
}

describe("generateWorkoutFromTemplate", () => {
  it("generates a workout with correct number of exercises", () => {
    const templateExercises = makeTemplateExercises(["bench", "row", "lateral-raise"]);
    const { workout } = generateWorkoutFromTemplate(templateExercises, makeOptions());

    const totalExercises = workout.mainLifts.length + workout.accessories.length;
    expect(totalExercises).toBe(3);
    expect(workout.warmup).toHaveLength(0);
    expect(workout.mainLifts.every((exercise) => exercise.role === "main")).toBe(true);
    expect(workout.accessories.every((exercise) => exercise.role === "accessory")).toBe(true);
  });

  it("partitions main lifts vs accessories by isMainLiftEligible", () => {
    const templateExercises = makeTemplateExercises(["bench", "squat", "lateral-raise", "face-pull"]);
    const { workout } = generateWorkoutFromTemplate(templateExercises, makeOptions());

    // bench and squat are mainLiftEligible
    expect(workout.mainLifts.length).toBe(2);
    expect(workout.mainLifts.map((e) => e.exercise.id).sort()).toEqual(["bench", "squat"]);
    // lateral-raise and face-pull are not
    expect(workout.accessories.length).toBe(2);
  });

  it("caps template main lifts to the first two eligible exercises by order", () => {
    const templateExercises = makeTemplateExercises(["bench", "row", "squat"]);
    const { workout } = generateWorkoutFromTemplate(templateExercises, makeOptions());

    expect(workout.mainLifts.map((entry) => entry.exercise.id)).toEqual(["bench", "row"]);
    expect(workout.accessories.map((entry) => entry.exercise.id)).toContain("squat");
  });

  it("prescribes more sets for main lifts than accessories", () => {
    const templateExercises = makeTemplateExercises(["bench", "lateral-raise"]);
    const { workout } = generateWorkoutFromTemplate(templateExercises, makeOptions());

    const mainSets = workout.mainLifts[0].sets.length;
    const accessorySets = workout.accessories[0].sets.length;
    expect(mainSets).toBeGreaterThanOrEqual(accessorySets);
  });

  it("reduces sets when readiness is low", () => {
    const templateExercises = makeTemplateExercises(["bench"]);
    const normalResult = generateWorkoutFromTemplate(templateExercises, makeOptions());

    const lowReadinessResult = generateWorkoutFromTemplate(
      templateExercises,
      makeOptions({
        checkIn: { date: new Date().toISOString(), readiness: 1 },
      })
    );

    const normalSets = normalResult.workout.mainLifts[0].sets.length;
    const lowSets = lowReadinessResult.workout.mainLifts[0].sets.length;
    expect(lowSets).toBeLessThanOrEqual(normalSets);
  });

  it("generates SRA warnings when muscles were recently trained", () => {
    const recentHistory = [
      {
        date: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(),
        completed: true,
        exercises: [
          {
            exerciseId: "bench",

            primaryMuscles: ["Chest", "Triceps"],
            sets: [{ exerciseId: "bench", setIndex: 1, reps: 8, load: 175 }],
          },
        ],
        readinessScore: 3 as const,
      },
    ];

    const templateExercises = makeTemplateExercises(["bench"]);
    const { sraWarnings } = generateWorkoutFromTemplate(
      templateExercises,
      makeOptions({ history: recentHistory })
    );

    expect(sraWarnings.length).toBeGreaterThan(0);
    const warnedMuscles = sraWarnings.map((w) => w.muscle);
    expect(warnedMuscles).toContain("Chest");
  });

  it("estimates minutes as a reasonable value", () => {
    const templateExercises = makeTemplateExercises([
      "bench",
      "row",
      "squat",
      "lateral-raise",
      "face-pull",
    ]);
    const { workout } = generateWorkoutFromTemplate(templateExercises, makeOptions());

    expect(workout.estimatedMinutes).toBeGreaterThan(0);
    expect(workout.estimatedMinutes).toBeLessThan(180);
  });

  it("includes projected warmup ramp time for load-resolvable template main lifts", () => {
    const templateExercises = makeTemplateExercises(["bench", "row", "db-press", "lateral-raise"]);
    const { workout } = generateWorkoutFromTemplate(
      templateExercises,
      makeOptions({ sessionMinutes: 0 })
    );

    const withoutProjectedRamps = estimateWorkoutMinutes([
      ...workout.mainLifts,
      ...workout.accessories,
    ]);

    expect(workout.estimatedMinutes).toBeGreaterThan(withoutProjectedRamps);
  });

  it("skips projected warmup ramp time for bodyweight-only template main lifts", () => {
    const pullupMain: Exercise = {
      id: "pullup-main",
      name: "Pull-Up",
      movementPatterns: ["vertical_pull"],
      splitTags: ["pull"],
      jointStress: "medium",
      isMainLiftEligible: true,
      isCompound: true,
      equipment: ["bodyweight"],
      primaryMuscles: ["Lats"],
    };
    const bodyweightAccessory: Exercise = {
      id: "bw-row",
      name: "Inverted Row",
      movementPatterns: ["horizontal_pull"],
      splitTags: ["pull"],
      jointStress: "low",
      isMainLiftEligible: false,
      isCompound: true,
      equipment: ["bodyweight", "rack"],
      primaryMuscles: ["Upper Back"],
    };

    const { workout } = generateWorkoutFromTemplate(
      [
        { exercise: pullupMain, orderIndex: 0 },
        { exercise: bodyweightAccessory, orderIndex: 1 },
      ],
      makeOptions({
        sessionMinutes: 0,
        exerciseLibrary: [pullupMain, bodyweightAccessory],
      })
    );

    const withoutProjectedRamps = estimateWorkoutMinutes([
      ...workout.mainLifts,
      ...workout.accessories,
    ]);

    expect(workout.mainLifts[0]?.exercise.id).toBe("pullup-main");
    expect(workout.estimatedMinutes).toBe(withoutProjectedRamps);
  });

  // Removed: "timeboxes template accessories pre-load using projected warmup ramps"
  // Reason: Legacy timeboxing removed in ADR-040 clean cut-over to selection-v2
  // Timeboxing enforcement will be redesigned and moved to beam search constraints

  it("returns a valid empty plan for empty template", () => {
    const { workout } = generateWorkoutFromTemplate([], makeOptions());

    expect(workout.mainLifts).toHaveLength(0);
    expect(workout.accessories).toHaveLength(0);
    expect(workout.warmup).toHaveLength(0);
    expect(workout.estimatedMinutes).toBe(0);
    expect(workout.id).toBeTruthy();
  });

  it("assigns rest seconds to all sets", () => {
    const templateExercises = makeTemplateExercises(["bench", "lateral-raise"]);
    const { workout } = generateWorkoutFromTemplate(templateExercises, makeOptions());

    const allExercises = [...workout.mainLifts, ...workout.accessories];
    for (const exercise of allExercises) {
      for (const set of exercise.sets) {
        expect(set.restSeconds).toBeGreaterThan(0);
      }
    }
  });

  it("adds autoregulation note when readiness is low", () => {
    const templateExercises = makeTemplateExercises(["bench"]);
    const { workout } = generateWorkoutFromTemplate(
      templateExercises,
      makeOptions({
        checkIn: { date: new Date().toISOString(), readiness: 1 },
      })
    );

    expect(workout.notes).toContain("Autoregulated for recovery");
  });

  it("returns no substitutions in strict mode", () => {
    const templateExercises = makeTemplateExercises(["bench"]);
    const result = generateWorkoutFromTemplate(
      templateExercises,
      makeOptions({
        isStrict: true,
        checkIn: { date: new Date().toISOString(), readiness: 3, painFlags: { knee: 2 } },
      })
    );
    expect(result.substitutions).toEqual([]);
  });

  it("suggests substitutions in flexible mode with pain flags", () => {
    const exWithContra = {
      ...exampleExerciseLibrary[0],
      contraindications: { knee: { avoidAbove: 1 } },
    };
    const result = generateWorkoutFromTemplate(
      [{ exercise: exWithContra, orderIndex: 0 }],
      makeOptions({
        isStrict: false,
        checkIn: { date: new Date().toISOString(), readiness: 3, painFlags: { knee: 2 } },
      })
    );
    expect(result.substitutions.length).toBeGreaterThan(0);
    expect(result.substitutions[0]?.originalExerciseId).toBe(exWithContra.id);
    expect(result.substitutions[0]?.reason).toBe("Knee pain flagged");
    expect(result.substitutions[0]?.alternatives.length).toBeGreaterThan(0);
  });

  it("removes substitutions for exercises trimmed from the final workout", () => {
    const contraindicatedPress: Exercise = {
      ...exampleExerciseLibrary.find((e) => e.id === "db-press")!,
      contraindications: { knee: { avoidAbove: 1 } },
    };
    const templateExercises: TemplateExerciseInput[] = [
      { exercise: exampleExerciseLibrary.find((e) => e.id === "bench")!, orderIndex: 0 },
      { exercise: contraindicatedPress, orderIndex: 1 },
    ];
    const makeSets = (count: number) =>
      Array.from({ length: count }, (_, idx) => ({
        exerciseId: "bench",
        setIndex: idx + 1,
        reps: 8,
      }));
    const history = [
      {
        date: new Date(Date.now() - 1 * 86400000).toISOString(),
        completed: true,
        status: "COMPLETED" as const,
        exercises: [
          {
            exerciseId: "bench",

            primaryMuscles: ["Chest", "Triceps"],
            sets: makeSets(20),
          },
        ],
      },
      {
        date: new Date(Date.now() - 8 * 86400000).toISOString(),
        completed: true,
        status: "COMPLETED" as const,
        exercises: [
          {
            exerciseId: "bench",

            primaryMuscles: ["Chest", "Triceps"],
            sets: makeSets(30),
          },
        ],
      },
    ];

    const result = generateWorkoutFromTemplate(
      templateExercises,
      makeOptions({
        history,
        weekInBlock: 0,
        mesocycleLength: 4,
        isStrict: false,
        checkIn: { date: new Date().toISOString(), readiness: 3, painFlags: { knee: 2 } },
      })
    );

    expect(result.workout.accessories.map((exercise) => exercise.exercise.id)).not.toContain(
      contraindicatedPress.id
    );
    expect(
      result.substitutions.find(
        (suggestion) => suggestion.originalExerciseId === contraindicatedPress.id
      )
    ).toBeUndefined();
  });

  it("applies hypertrophy isolation RPE bump for template accessories", () => {
    const templateExercises = makeTemplateExercises(["lateral-raise"]);
    const { workout } = generateWorkoutFromTemplate(templateExercises, makeOptions());

    expect(workout.accessories[0].sets[0].targetRpe).toBe(8.5);
  });

  it("applies periodization offsets in template generation", () => {
    const templateExercises = makeTemplateExercises(["bench"]);
    const { workout } = generateWorkoutFromTemplate(
      templateExercises,
      makeOptions({
        periodization: {
          rpeOffset: -1,
          setMultiplier: 1,
          backOffMultiplier: 0.85,
          isDeload: false,
        },
      })
    );

    expect(workout.mainLifts[0].sets[0].targetRpe).toBe(7);
  });

  it("applies set-count overrides when provided", () => {
    const templateExercises = makeTemplateExercises(["bench", "lateral-raise"]);
    const { workout } = generateWorkoutFromTemplate(
      templateExercises,
      makeOptions({
        setCountOverrides: {
          bench: 2,
          "lateral-raise": 5,
        },
      })
    );

    expect(workout.mainLifts[0].sets).toHaveLength(2);
    expect(workout.accessories[0].sets).toHaveLength(5);
  });

  it("carries superset groups for accessory pairs only", () => {
    const templateExercises = makeTemplateExercisesWithSuperset([
      { id: "bench", supersetGroup: 1 },
      { id: "lateral-raise", supersetGroup: 2 },
      { id: "face-pull", supersetGroup: 2 },
    ]);
    const { workout } = generateWorkoutFromTemplate(templateExercises, makeOptions());

    expect(workout.mainLifts[0].supersetGroup).toBeUndefined();
    expect(workout.accessories.map((e) => e.supersetGroup)).toEqual([2, 2]);
    expect(workout.accessories[0].notes).toContain("Superset");
  });

  it("respects exercise-specific rep range bounds in template prescriptions", () => {
    const templateExercises: TemplateExerciseInput[] = [
      {
        exercise: {
          ...exampleExerciseLibrary.find((e) => e.id === "bench")!,
          repRangeMin: 8,
          repRangeMax: 12,
        },
        orderIndex: 0,
      },
      {
        exercise: {
          ...exampleExerciseLibrary.find((e) => e.id === "lateral-raise")!,
          repRangeMin: 12,
          repRangeMax: 20,
        },
        orderIndex: 1,
      },
    ];

    const { workout } = generateWorkoutFromTemplate(templateExercises, makeOptions());
    // Week 1 (no periodization → blockProgress=0): topSetReps = effectiveMain[1] = 10
    // effectiveMain = clampRepRange([6,10], {min:8,max:12}) = [8,10]; upper bound at week 1
    expect(workout.mainLifts[0].sets[0].targetReps).toBe(10);
    expect(workout.accessories[0].sets[0].targetRepRange).toEqual({ min: 12, max: 15 });
  });

  it("demotes out-of-range main-lift-eligible exercises to accessory prescription", () => {
    const templateExercises: TemplateExerciseInput[] = [
      {
        exercise: {
          ...exampleExerciseLibrary.find((e) => e.id === "bench")!,
          isMainLiftEligible: true,
          repRangeMin: 10,
          repRangeMax: 20,
        },
        orderIndex: 0,
      },
    ];

    const { workout } = generateWorkoutFromTemplate(
      templateExercises,
      makeOptions({ goals: { primary: "strength", secondary: "none" } })
    );

    expect(workout.mainLifts).toHaveLength(0);
    expect(workout.accessories).toHaveLength(1);
    expect(workout.accessories[0].sets).toHaveLength(3);
    expect(workout.accessories[0].sets[0].targetRepRange).toEqual({ min: 10, max: 12 });
    expect(workout.accessories[0].sets[0].targetReps).toBe(10);
  });

  it("enforces enhanced volume caps when mesocycle context is provided", () => {
    const templateExercises = makeTemplateExercises(["bench", "db-press"]);
    const makeSets = (count: number) =>
      Array.from({ length: count }, (_, idx) => ({
        exerciseId: "bench",
        setIndex: idx + 1,
        reps: 8,
      }));
    const history = [
      {
        date: new Date(Date.now() - 1 * 86400000).toISOString(),
        completed: true,
        status: "COMPLETED" as const,
        exercises: [
          {
            exerciseId: "bench",

            primaryMuscles: ["Chest", "Triceps"],
            sets: makeSets(20),
          },
        ],
      },
      {
        date: new Date(Date.now() - 8 * 86400000).toISOString(),
        completed: true,
        status: "COMPLETED" as const,
        exercises: [
          {
            exerciseId: "bench",

            primaryMuscles: ["Chest", "Triceps"],
            sets: makeSets(30),
          },
        ],
      },
    ];

    const standard = generateWorkoutFromTemplate(
      templateExercises,
      makeOptions({ history })
    );
    const enhanced = generateWorkoutFromTemplate(
      templateExercises,
      makeOptions({ history, weekInBlock: 1, mesocycleLength: 4 })
    );

    expect(standard.workout.accessories.map((e) => e.exercise.id)).toContain("db-press");
    expect(enhanced.workout.accessories.map((e) => e.exercise.id)).not.toContain("db-press");
  });

  it("returns advisory volumePlanByMuscle for template generation", () => {
    const templateExercises = makeTemplateExercises(["bench"]);
    const { volumePlanByMuscle } = generateWorkoutFromTemplate(
      templateExercises,
      makeOptions({ weekInBlock: 1, mesocycleLength: 4 })
    );

    expect(volumePlanByMuscle.Chest).toEqual({
      target: 12,
      planned: 4,
      delta: 8,
    });
    expect(volumePlanByMuscle["Front Delts"]).toEqual({
      target: 2.3,
      planned: 1.2,
      delta: 1.1,
    });
  });

});
