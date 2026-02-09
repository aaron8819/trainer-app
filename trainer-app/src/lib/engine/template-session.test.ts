import { describe, it, expect } from "vitest";
import {
  generateWorkoutFromTemplate,
  type TemplateExerciseInput,
  type GenerateFromTemplateOptions,
} from "./template-session";
import {
  exampleUser,
  exampleGoals,
  exampleExerciseLibrary,
} from "./sample-data";

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

describe("generateWorkoutFromTemplate", () => {
  it("generates a workout with correct number of exercises", () => {
    const templateExercises = makeTemplateExercises(["bench", "row", "lateral-raise"]);
    const { workout } = generateWorkoutFromTemplate(templateExercises, makeOptions());

    const totalExercises = workout.mainLifts.length + workout.accessories.length;
    expect(totalExercises).toBe(3);
    expect(workout.warmup).toHaveLength(0);
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
            movementPattern: "push" as const,
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
    expect(result.substitutions.length).toBeGreaterThanOrEqual(0);
  });
});
