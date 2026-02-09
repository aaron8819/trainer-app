import { describe, expect, it } from "vitest";
import { generateWorkout } from "./engine";
import { computeNextLoad, shouldDeload } from "./progression";
import {
  exampleConstraints,
  exampleExerciseLibrary,
  exampleGoals,
  exampleHistory,
  exampleUser,
} from "./sample-data";
import type { Exercise } from "./types";

const baseGoals = { ...exampleGoals };

function buildHistory(entries: number) {
  return Array.from({ length: entries }).map((_, index) => ({
    date: new Date(Date.now() - index * 86400000).toISOString(),
    completed: true,
    readinessScore: 3 as const,
    exercises: [
      {
        exerciseId: "bench",
        movementPattern: "push" as const,
        sets: [
          { exerciseId: "bench", setIndex: 1, reps: 8 },
          { exerciseId: "bench", setIndex: 2, reps: 8 },
        ],
      },
    ],
  }));
}

describe("engine core", () => {
  it("assigns more sets for advanced lifters than beginners", () => {
    const beginner = { ...exampleUser, trainingAge: "beginner" as const };
    const advanced = { ...exampleUser, trainingAge: "advanced" as const };

    const beginnerWorkout = generateWorkout(
      beginner,
      baseGoals,
      exampleConstraints,
      [],
      exampleExerciseLibrary
    );
    const advancedWorkout = generateWorkout(
      advanced,
      baseGoals,
      exampleConstraints,
      [],
      exampleExerciseLibrary
    );

    const beginnerSets = beginnerWorkout.mainLifts[0].sets.length;
    const advancedSets = advancedWorkout.mainLifts[0].sets.length;

    expect(advancedSets).toBeGreaterThanOrEqual(beginnerSets);
  });

  it("reduces volume when the last session was missed", () => {
    const missedHistory = [
      {
        date: new Date().toISOString(),
        completed: false,
        status: "SKIPPED" as const,
        readinessScore: 3 as const,
        exercises: [],
      },
    ];

    const workout = generateWorkout(
      exampleUser,
      baseGoals,
      exampleConstraints,
      missedHistory,
      exampleExerciseLibrary
    );

    expect(workout.mainLifts[0].sets.length).toBeLessThanOrEqual(3);
  });

  it("detects deload need after repeated plateau", () => {
    const plateauHistory = buildHistory(5).map((entry) => ({
      ...entry,
      exercises: [
        {
          exerciseId: "bench",
          movementPattern: "push" as const,
          sets: [
            { exerciseId: "bench", setIndex: 1, reps: 6 },
            { exerciseId: "bench", setIndex: 2, reps: 6 },
          ],
        },
      ],
    }));

    expect(shouldDeload(plateauHistory)).toBe(true);
  });

  it("avoids high joint stress lifts when injuries are active", () => {
    const injured = {
      ...exampleUser,
      injuries: [{ bodyPart: "elbow", severity: 3 as const, isActive: true }],
    };

    const workout = generateWorkout(
      injured,
      baseGoals,
      exampleConstraints,
      exampleHistory,
      exampleExerciseLibrary
    );

    const allExercises = [...workout.mainLifts, ...workout.accessories];
    expect(allExercises.every((exercise) => exercise.exercise.jointStress !== "high")).toBe(true);
  });

  it("limits selection to available equipment", () => {
    const constraints = {
      ...exampleConstraints,
      availableEquipment: ["dumbbell", "bodyweight"],
    };

    const workout = generateWorkout(
      exampleUser,
      baseGoals,
      constraints,
      exampleHistory,
      exampleExerciseLibrary
    );

    const allExercises = [...workout.mainLifts, ...workout.accessories, ...workout.warmup];
    expect(
      allExercises.every((exercise) =>
        exercise.exercise.equipment.some((equipment) => constraints.availableEquipment.includes(equipment))
      )
    ).toBe(true);
  });

  it("uses role-specific rep ranges for fat loss", () => {
    const fatLossGoals = { ...baseGoals, primary: "fat_loss" as const };
    const workout = generateWorkout(
      exampleUser,
      fatLossGoals,
      exampleConstraints,
      exampleHistory,
      exampleExerciseLibrary
    );

    expect(workout.mainLifts[0].sets[0].targetReps).toBe(8);
    expect(workout.accessories[0].sets[0].targetReps).toBe(12);
  });

  it("computes next load conservatively", () => {
    const next = computeNextLoad(
      [
        { reps: 12, rpe: 7, load: 100 },
        { reps: 12, rpe: 7, load: 100 },
      ],
      [8, 12],
      7.5
    );

    expect(next).toBeGreaterThan(100);
    expect(next).toBeLessThanOrEqual(107);
  });

  it("respects avoid list preferences when selecting exercises", () => {
    const workout = generateWorkout(
      exampleUser,
      baseGoals,
      exampleConstraints,
      exampleHistory,
      exampleExerciseLibrary,
      undefined,
      {
        preferences: {
          avoidExercises: ["Barbell Bench Press"],
        },
      }
    );

    const allExercises = [...workout.mainLifts, ...workout.accessories, ...workout.warmup];
    expect(
      allExercises.some((exercise) => exercise.exercise.name === "Barbell Bench Press")
    ).toBe(false);
  });

  it("biases toward favorite exercises when available", () => {
    const library: Exercise[] = [
      {
        id: "push-1",
        name: "Push Main A",
        movementPatterns: ["horizontal_push"],
        splitTags: ["push"],
        jointStress: "medium",
        isMainLiftEligible: true,
        equipment: ["barbell"],
      },
      {
        id: "push-2",
        name: "Push Main Favorite",
        movementPatterns: ["horizontal_push"],
        splitTags: ["push"],
        jointStress: "medium",
        isMainLiftEligible: true,
        equipment: ["barbell"],
      },
    ];

    const workout = generateWorkout(
      exampleUser,
      baseGoals,
      { ...exampleConstraints, availableEquipment: ["barbell"], splitType: "ppl", daysPerWeek: 3 },
      [],
      library,
      undefined,
      {
        preferences: { favoriteExercises: ["Push Main Favorite"] },
        randomSeed: 42,
      }
    );

    expect(workout.mainLifts[0].exercise.name).toBe("Push Main Favorite");
  });

  it("uses RPE targets from preferences when rep range matches", () => {
    const workout = generateWorkout(
      exampleUser,
      baseGoals,
      exampleConstraints,
      [],
      exampleExerciseLibrary,
      undefined,
      {
        preferences: {
          rpeTargets: [
            { min: 6, max: 10, targetRpe: 8.25 },
          ],
        },
      }
    );

    expect(workout.mainLifts[0].sets[0].targetRpe).toBe(8.25);
  });

  it("uses completed advancing workouts to determine split day", () => {
    const library: Exercise[] = [
      {
        id: "push-main",
        name: "Push Main",
        movementPatterns: ["horizontal_push"],
        splitTags: ["push"],
        jointStress: "medium",
        isMainLiftEligible: true,
        equipment: ["barbell"],
      },
      {
        id: "pull-main",
        name: "Pull Main",
        movementPatterns: ["horizontal_pull"],
        splitTags: ["pull"],
        jointStress: "medium",
        isMainLiftEligible: true,
        equipment: ["barbell"],
      },
      {
        id: "squat-main",
        name: "Squat Main",
        movementPatterns: ["squat"],
        splitTags: ["legs"],
        jointStress: "medium",
        isMainLiftEligible: true,
        equipment: ["barbell"],
      },
      {
        id: "hinge-main",
        name: "Hinge Main",
        movementPatterns: ["hinge"],
        splitTags: ["legs"],
        jointStress: "medium",
        isMainLiftEligible: true,
        equipment: ["barbell"],
      },
    ];

    const history = [
      {
        date: new Date().toISOString(),
        completed: true,
        status: "COMPLETED" as const,
        advancesSplit: true,
        exercises: [],
      },
    ];

    const workout = generateWorkout(
      exampleUser,
      baseGoals,
      { ...exampleConstraints, availableEquipment: ["barbell"], splitType: "ppl", daysPerWeek: 3 },
      history,
      library
    );

    expect(workout.mainLifts[0].exercise.name).toBe("Pull Main");
  });

  it("does not advance split on skipped workouts", () => {
    const library: Exercise[] = [
      {
        id: "push-main",
        name: "Push Main",
        movementPatterns: ["horizontal_push"],
        splitTags: ["push"],
        jointStress: "medium",
        isMainLiftEligible: true,
        equipment: ["barbell"],
      },
      {
        id: "pull-main",
        name: "Pull Main",
        movementPatterns: ["horizontal_pull"],
        splitTags: ["pull"],
        jointStress: "medium",
        isMainLiftEligible: true,
        equipment: ["barbell"],
      },
    ];

    const history = [
      {
        date: new Date().toISOString(),
        completed: false,
        status: "SKIPPED" as const,
        advancesSplit: true,
        exercises: [],
      },
    ];

    const workout = generateWorkout(
      exampleUser,
      baseGoals,
      { ...exampleConstraints, availableEquipment: ["barbell"], splitType: "ppl", daysPerWeek: 3 },
      history,
      library
    );

    expect(workout.mainLifts[0].exercise.name).toBe("Push Main");
  });

  it("keeps the PPL split queue perpetual across weeks", () => {
    const library: Exercise[] = [
      {
        id: "push-main-a",
        name: "Push Main A",
        movementPatterns: ["horizontal_push"],
        splitTags: ["push"],
        jointStress: "medium",
        isMainLiftEligible: true,
        primaryMuscles: ["Chest", "Triceps"],
        equipment: ["barbell"],
      },
      {
        id: "push-main-b",
        name: "Push Main B",
        movementPatterns: ["vertical_push"],
        splitTags: ["push"],
        jointStress: "medium",
        isMainLiftEligible: true,
        primaryMuscles: ["Front Delts", "Triceps"],
        equipment: ["barbell"],
      },
      {
        id: "pull-main-a",
        name: "Pull Main A",
        movementPatterns: ["vertical_pull"],
        splitTags: ["pull"],
        jointStress: "medium",
        isMainLiftEligible: true,
        primaryMuscles: ["Back", "Biceps"],
        equipment: ["barbell"],
      },
      {
        id: "pull-main-b",
        name: "Pull Main B",
        movementPatterns: ["horizontal_pull"],
        splitTags: ["pull"],
        jointStress: "medium",
        isMainLiftEligible: true,
        primaryMuscles: ["Upper Back", "Biceps"],
        equipment: ["barbell"],
      },
      {
        id: "legs-main-a",
        name: "Legs Main A",
        movementPatterns: ["squat"],
        splitTags: ["legs"],
        jointStress: "medium",
        isMainLiftEligible: true,
        primaryMuscles: ["Quads", "Glutes"],
        equipment: ["barbell"],
      },
      {
        id: "legs-main-b",
        name: "Legs Main B",
        movementPatterns: ["hinge"],
        splitTags: ["legs"],
        jointStress: "medium",
        isMainLiftEligible: true,
        primaryMuscles: ["Hamstrings", "Glutes"],
        equipment: ["barbell"],
      },
    ];

    // History: most recent = pull, then legs → push is least recently trained
    const history = [
      {
        date: new Date(Date.now() - 1 * 86400000).toISOString(),
        completed: true,
        status: "COMPLETED" as const,
        advancesSplit: true,
        exercises: [
          { exerciseId: "pull-main-a", movementPattern: "pull" as const, primaryMuscles: ["Back", "Biceps"], sets: [{ exerciseId: "pull-main-a", setIndex: 1, reps: 8 }] },
        ],
      },
      {
        date: new Date(Date.now() - 2 * 86400000).toISOString(),
        completed: true,
        status: "COMPLETED" as const,
        advancesSplit: true,
        exercises: [
          { exerciseId: "legs-main-a", movementPattern: "squat" as const, primaryMuscles: ["Quads", "Glutes"], sets: [{ exerciseId: "legs-main-a", setIndex: 1, reps: 8 }] },
        ],
      },
      {
        date: new Date(Date.now() - 3 * 86400000).toISOString(),
        completed: true,
        status: "COMPLETED" as const,
        advancesSplit: true,
        exercises: [
          { exerciseId: "push-main-a", movementPattern: "push" as const, primaryMuscles: ["Chest", "Triceps"], sets: [{ exerciseId: "push-main-a", setIndex: 1, reps: 8 }] },
        ],
      },
    ];

    const workout = generateWorkout(
      exampleUser,
      baseGoals,
      { ...exampleConstraints, availableEquipment: ["barbell"], splitType: "ppl", daysPerWeek: 3 },
      history,
      library
    );

    // Push was trained least recently (3 days ago), so next workout should be push
    expect(workout.mainLifts[0].exercise.name).toBe("Push Main A");
  });

  it("scales rest periods by exercise type", () => {
    const library: Exercise[] = [
      {
        id: "push-main-a",
        name: "Barbell Bench Press",
        movementPatterns: ["horizontal_push"],
        splitTags: ["push"],
        jointStress: "medium",
        isMainLiftEligible: true,
        isCompound: true,
        fatigueCost: 4,
        equipment: ["barbell"],
      },
      {
        id: "push-main-b",
        name: "Overhead Press",
        movementPatterns: ["vertical_push"],
        splitTags: ["push"],
        jointStress: "medium",
        isMainLiftEligible: true,
        isCompound: true,
        fatigueCost: 4,
        equipment: ["barbell"],
      },
      {
        id: "push-accessory-compound",
        name: "Dumbbell Bench Press",
        movementPatterns: ["horizontal_push"],
        splitTags: ["push"],
        jointStress: "medium",
        isMainLiftEligible: false,
        isCompound: true,
        fatigueCost: 3,
        equipment: ["dumbbell"],
      },
      {
        id: "push-accessory-isolation",
        name: "Lateral Raise",
        movementPatterns: ["vertical_push"],
        splitTags: ["push"],
        jointStress: "low",
        isMainLiftEligible: false,
        isCompound: false,
        fatigueCost: 2,
        equipment: ["dumbbell"],
      },
      {
        id: "push-accessory-fatigue",
        name: "Triceps Pushdown",
        movementPatterns: ["horizontal_push"],
        splitTags: ["push"],
        jointStress: "low",
        isMainLiftEligible: false,
        isCompound: false,
        fatigueCost: 3,
        equipment: ["cable"],
      },
    ];

    const workout = generateWorkout(
      exampleUser,
      baseGoals,
      { ...exampleConstraints, availableEquipment: ["barbell", "dumbbell", "cable"], splitType: "ppl", daysPerWeek: 3 },
      [],
      library
    );

    const bench = workout.mainLifts.find((item) => item.exercise.name === "Barbell Bench Press");
    expect(bench?.sets[0].restSeconds).toBe(180);

    const dbPress = workout.accessories.find((item) => item.exercise.name === "Dumbbell Bench Press");
    expect(dbPress).toBeDefined();
    expect(dbPress?.sets[0].restSeconds).toBe(120);

    const lateralRaise = workout.accessories.find((item) => item.exercise.name === "Lateral Raise");
    expect(lateralRaise?.sets[0].restSeconds).toBe(60);

    const pushdown = workout.accessories.find((item) => item.exercise.name === "Triceps Pushdown");
    expect(pushdown?.sets[0].restSeconds).toBe(90);
  });

  it("trims accessories by fatigue priority when timeboxed", () => {
    const library: Exercise[] = [
      {
        id: "push-main-a",
        name: "Barbell Bench Press",
        movementPatterns: ["horizontal_push"],
        splitTags: ["push"],
        jointStress: "medium",
        isMainLiftEligible: true,
        isCompound: true,
        fatigueCost: 4,
        equipment: ["barbell"],
      },
      {
        id: "push-accessory-cable",
        name: "Cable Fly",
        movementPatterns: ["horizontal_push"],
        splitTags: ["push"],
        jointStress: "low",
        isMainLiftEligible: false,
        isCompound: false,
        fatigueCost: 2,
        equipment: ["cable"],
        primaryMuscles: ["Chest"],
        stimulusBias: ["stretch"],
      },
      {
        id: "push-accessory-side",
        name: "Lateral Raise",
        movementPatterns: ["vertical_push"],
        splitTags: ["push"],
        jointStress: "low",
        isMainLiftEligible: false,
        isCompound: false,
        fatigueCost: 2,
        equipment: ["dumbbell"],
        primaryMuscles: ["Side Delts"],
        stimulusBias: ["metabolic"],
      },
      {
        id: "push-accessory-tri",
        name: "Triceps Pushdown",
        movementPatterns: ["horizontal_push"],
        splitTags: ["push"],
        jointStress: "low",
        isMainLiftEligible: false,
        isCompound: false,
        fatigueCost: 3,
        equipment: ["cable"],
        primaryMuscles: ["Triceps"],
        stimulusBias: ["metabolic"],
      },
      {
        id: "push-main-b",
        name: "Overhead Press",
        movementPatterns: ["vertical_push"],
        splitTags: ["push"],
        jointStress: "medium",
        isMainLiftEligible: true,
        isCompound: true,
        fatigueCost: 4,
        equipment: ["barbell"],
      },
      {
        id: "accessory-high",
        name: "Dumbbell Bench Press",
        movementPatterns: ["horizontal_push"],
        splitTags: ["push"],
        jointStress: "medium",
        isMainLiftEligible: false,
        isCompound: true,
        fatigueCost: 3,
        equipment: ["dumbbell"],
        primaryMuscles: ["Upper Chest"],
        stimulusBias: ["mechanical"],
      },
    ];

    const baseWorkout = generateWorkout(
      exampleUser,
      baseGoals,
      { ...exampleConstraints, availableEquipment: ["barbell", "dumbbell", "cable"], splitType: "ppl", daysPerWeek: 3, sessionMinutes: 0 },
      [],
      library,
      undefined,
      { randomSeed: 42 }
    );
    const baseAccessories = baseWorkout.accessories.map((item) => item.exercise.name);
    expect(baseAccessories).toContain("Cable Fly");
    expect(baseAccessories).toContain("Dumbbell Bench Press");

    const timeboxed = generateWorkout(
      exampleUser,
      baseGoals,
      { ...exampleConstraints, availableEquipment: ["barbell", "dumbbell", "cable"], splitType: "ppl", daysPerWeek: 3, sessionMinutes: 46 },
      [],
      library,
      undefined,
      { randomSeed: 42 }
    );
    const trimmedNames = timeboxed.accessories.map((item) => item.exercise.name);
    expect(trimmedNames).toContain("Dumbbell Bench Press");
    expect(trimmedNames).not.toContain("Cable Fly");
  });

  it("enforces strict PPL patterns on push day", () => {
    const library: Exercise[] = [
      {
        id: "push-main",
        name: "Barbell Bench Press",
        movementPatterns: ["horizontal_push"],
        splitTags: ["push"],
        jointStress: "medium",
        isMainLiftEligible: true,
        equipment: ["barbell"],
      },
      {
        id: "push-main-2",
        name: "Overhead Press",
        movementPatterns: ["vertical_push"],
        splitTags: ["push"],
        jointStress: "medium",
        isMainLiftEligible: true,
        equipment: ["barbell"],
      },
      {
        id: "pull-main",
        name: "Barbell Row",
        movementPatterns: ["horizontal_pull"],
        splitTags: ["pull"],
        jointStress: "medium",
        isMainLiftEligible: true,
        equipment: ["barbell"],
      },
      {
        id: "squat-main",
        name: "Back Squat",
        movementPatterns: ["squat"],
        splitTags: ["legs"],
        jointStress: "medium",
        isMainLiftEligible: true,
        equipment: ["barbell"],
      },
      {
        id: "push-accessory",
        name: "Cable Fly",
        movementPatterns: ["horizontal_push"],
        splitTags: ["push"],
        jointStress: "low",
        equipment: ["cable"],
      },
      {
        id: "push-accessory-2",
        name: "Lateral Raise",
        movementPatterns: ["vertical_push"],
        splitTags: ["push"],
        jointStress: "low",
        equipment: ["dumbbell"],
      },
      {
        id: "push-accessory-3",
        name: "Triceps Pushdown",
        movementPatterns: ["horizontal_push"],
        splitTags: ["push"],
        jointStress: "low",
        equipment: ["cable"],
      },
    ];

    const workout = generateWorkout(
      exampleUser,
      baseGoals,
      { ...exampleConstraints, availableEquipment: ["barbell", "cable", "dumbbell"], splitType: "ppl", daysPerWeek: 3 },
      [],
      library
    );

    const allExercises = [...workout.mainLifts, ...workout.accessories, ...workout.warmup];
    const pullLegV2 = [
      "horizontal_pull", "vertical_pull", "squat", "hinge", "lunge",
    ];
    const invalid = allExercises.filter((exercise) =>
      exercise.exercise.movementPatterns?.some((p) => pullLegV2.includes(p))
    );
    expect(invalid.length).toBe(0);
    expect(workout.mainLifts.length).toBeGreaterThanOrEqual(2);
    expect(workout.accessories.length).toBeGreaterThanOrEqual(3);
    expect(workout.accessories.length).toBeLessThanOrEqual(5);
  });

  it("keeps core and conditioning exercises out of general accessories", () => {
    const library: Exercise[] = [
      {
        id: "push-main",
        name: "Barbell Bench Press",
        movementPatterns: ["horizontal_push"],
        splitTags: ["push"],
        jointStress: "medium",
        isMainLiftEligible: true,
        equipment: ["barbell"],
      },
      {
        id: "push-main-2",
        name: "Overhead Press",
        movementPatterns: ["vertical_push"],
        splitTags: ["push"],
        jointStress: "medium",
        isMainLiftEligible: true,
        equipment: ["barbell"],
      },
      {
        id: "push-accessory",
        name: "Cable Fly",
        movementPatterns: ["horizontal_push"],
        splitTags: ["push"],
        jointStress: "low",
        equipment: ["cable"],
      },
      {
        id: "core-ex",
        name: "Plank",
        movementPatterns: ["anti_rotation"],
        splitTags: ["core"],
        jointStress: "low",
        equipment: ["bodyweight"],
      },
      {
        id: "conditioning-ex",
        name: "Farmer's Carry",
        movementPatterns: ["carry"],
        splitTags: ["conditioning"],
        jointStress: "low",
        equipment: ["dumbbell"],
      },
    ];

    const workout = generateWorkout(
      exampleUser,
      baseGoals,
      { ...exampleConstraints, availableEquipment: ["barbell", "cable", "bodyweight", "dumbbell"], splitType: "ppl", daysPerWeek: 3 },
      [],
      library
    );

    const accessoryNames = workout.accessories.map((exercise) => exercise.exercise.name);
    expect(accessoryNames).not.toContain("Plank");
    expect(accessoryNames).not.toContain("Farmer's Carry");
  });

  it("avoids stalled exercises when alternatives exist", () => {
    const history = [
      {
        date: new Date(Date.now() - 2 * 86400000).toISOString(),
        completed: true,
        status: "COMPLETED" as const,
        exercises: [
          {
            exerciseId: "push-stall",
            movementPattern: "push" as const,
            sets: [
              { exerciseId: "push-stall", setIndex: 1, reps: 8, load: 100 },
              { exerciseId: "push-stall", setIndex: 2, reps: 8, load: 100 },
            ],
          },
        ],
      },
      {
        date: new Date(Date.now() - 1 * 86400000).toISOString(),
        completed: true,
        status: "COMPLETED" as const,
        exercises: [
          {
            exerciseId: "push-stall",
            movementPattern: "push" as const,
            sets: [
              { exerciseId: "push-stall", setIndex: 1, reps: 8, load: 100 },
              { exerciseId: "push-stall", setIndex: 2, reps: 8, load: 100 },
            ],
          },
        ],
      },
      {
        date: new Date().toISOString(),
        completed: true,
        status: "COMPLETED" as const,
        exercises: [
          {
            exerciseId: "push-stall",
            movementPattern: "push" as const,
            sets: [
              { exerciseId: "push-stall", setIndex: 1, reps: 8, load: 100 },
              { exerciseId: "push-stall", setIndex: 2, reps: 8, load: 100 },
            ],
          },
        ],
      },
    ];

    const library: Exercise[] = [
      {
        id: "push-stall",
        name: "Stalled Bench",
        movementPatterns: ["horizontal_push"],
        splitTags: ["push"],
        jointStress: "medium",
        isMainLiftEligible: true,
        equipment: ["barbell"],
      },
      {
        id: "push-alt",
        name: "Machine Chest Press",
        movementPatterns: ["horizontal_push"],
        splitTags: ["push"],
        jointStress: "low",
        isMainLiftEligible: true,
        equipment: ["machine"],
      },
      {
        id: "push-vert",
        name: "Overhead Press",
        movementPatterns: ["vertical_push"],
        splitTags: ["push"],
        jointStress: "medium",
        isMainLiftEligible: true,
        equipment: ["barbell"],
      },
    ];

    const workout = generateWorkout(
      exampleUser,
      baseGoals,
      { ...exampleConstraints, availableEquipment: ["barbell", "machine"], splitType: "ppl", daysPerWeek: 3 },
      history,
      library
    );

    const mainNames = workout.mainLifts.map((exercise) => exercise.exercise.name);
    expect(mainNames).not.toContain("Stalled Bench");
  });
});
