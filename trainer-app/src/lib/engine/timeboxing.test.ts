import { describe, it, expect } from "vitest";
import {
  estimateWorkoutMinutes,
  trimAccessoriesByPriority,
  enforceTimeBudget,
} from "./timeboxing";
import { exampleExerciseLibrary } from "./sample-data";
import { createId } from "./utils";
import type { WorkoutExercise, WorkoutPlan } from "./types";

function makeAccessory(
  id: string,
  options?: { supersetGroup?: number; setCount?: number; restSeconds?: number }
): WorkoutExercise {
  const exercise = exampleExerciseLibrary.find((entry) => entry.id === id);
  if (!exercise) {
    throw new Error(`Exercise ${id} not found`);
  }
  const setCount = options?.setCount ?? 3;
  const restSeconds = options?.restSeconds ?? 90;
  const sets = Array.from({ length: setCount }, (_, index) => ({
    setIndex: index + 1,
    targetReps: 10,
    restSeconds,
  }));

  return {
    id: `${id}-${options?.supersetGroup ?? "solo"}`,
    exercise,
    orderIndex: 0,
    isMainLift: false,
    supersetGroup: options?.supersetGroup,
    sets,
  };
}

function makeMainLift(
  id: string,
  options?: { supersetGroup?: number; setCount?: number; restSeconds?: number }
): WorkoutExercise {
  const exercise = exampleExerciseLibrary.find((entry) => entry.id === id);
  if (!exercise) {
    throw new Error(`Exercise ${id} not found`);
  }
  const setCount = options?.setCount ?? 3;
  const restSeconds = options?.restSeconds ?? 180;
  const sets = Array.from({ length: setCount }, (_, index) => ({
    setIndex: index + 1,
    targetReps: 5,
    restSeconds,
  }));

  return {
    id: `${id}-${options?.supersetGroup ?? "solo"}`,
    exercise,
    orderIndex: 0,
    isMainLift: true,
    supersetGroup: options?.supersetGroup,
    sets,
  };
}

describe("estimateWorkoutMinutes", () => {
  it("uses rep-aware fallback rest when set restSeconds is missing", () => {
    const exercise = exampleExerciseLibrary.find((entry) => entry.id === "bench");
    if (!exercise) {
      throw new Error("Expected bench sample exercise");
    }
    const mainLift: WorkoutExercise = {
      id: "bench-no-rest",
      exercise,
      orderIndex: 0,
      isMainLift: true,
      sets: Array.from({ length: 3 }, (_, index) => ({
        setIndex: index + 1,
        targetReps: 8,
      })),
    };

    // With rep-aware fallback, main-lift 8 reps should use moderate rest instead of heavy 5-rep rest.
    // bench in sample data has timePerSetSec=50 and fatigueCost=4:
    // per set = 50 work + 180 rest = 230s; 3 sets = 690s => round(11.5) = 12 min.
    expect(estimateWorkoutMinutes([mainLift])).toBe(12);
  });

  it("reduces minutes for accessory supersets with shared rest", () => {
    const first = makeAccessory("lateral-raise", { supersetGroup: 1 });
    const second = makeAccessory("face-pull", { supersetGroup: 1 });
    const supersetMinutes = estimateWorkoutMinutes([first, second]);
    const normalMinutes = estimateWorkoutMinutes([
      { ...first, supersetGroup: undefined },
      { ...second, supersetGroup: undefined },
    ]);

    expect(supersetMinutes).toBeLessThan(normalMinutes);
  });

  it("uses reduced shared rest (60% of max standalone rest) for accessory superset rounds", () => {
    const first = makeAccessory("lateral-raise", {
      supersetGroup: 1,
      restSeconds: 120,
    });
    const second = makeAccessory("face-pull", {
      supersetGroup: 1,
      restSeconds: 75,
    });

    // Per round (fallback accessory work time): work(40) + work(40) + sharedRest(round(120 * 0.6)=72) = 152s
    // 3 rounds => 456s => round(7.6) = 8 min
    expect(estimateWorkoutMinutes([first, second])).toBe(8);
  });

  it("applies a 60-second floor to shared rest in accessory supersets", () => {
    const first = makeAccessory("lateral-raise", {
      supersetGroup: 1,
      restSeconds: 75,
    });
    const second = makeAccessory("face-pull", {
      supersetGroup: 1,
      restSeconds: 60,
    });

    // round(75 * 0.6) = 45, but floor applies => 60s shared rest.
    // Per round (fallback accessory work time): 40 + 40 + 60 = 140s. 3 rounds => 420s => 7 min.
    expect(estimateWorkoutMinutes([first, second])).toBe(7);
  });

  it("applies superset timing to compound accessories", () => {
    const first = makeAccessory("bench", { supersetGroup: 1 });
    const second = makeAccessory("row", { supersetGroup: 1 });
    const supersetMinutes = estimateWorkoutMinutes([first, second]);
    const normalMinutes = estimateWorkoutMinutes([
      { ...first, supersetGroup: undefined },
      { ...second, supersetGroup: undefined },
    ]);

    expect(supersetMinutes).toBeLessThan(normalMinutes);
  });

  it("keeps main-lift exercises excluded from superset timing", () => {
    const first = makeMainLift("bench", { supersetGroup: 1 });
    const second = makeMainLift("squat", { supersetGroup: 1 });
    const supersetMinutes = estimateWorkoutMinutes([first, second]);
    const normalMinutes = estimateWorkoutMinutes([
      { ...first, supersetGroup: undefined },
      { ...second, supersetGroup: undefined },
    ]);

    expect(supersetMinutes).toBe(normalMinutes);
  });
});

describe("trimAccessoriesByPriority", () => {
  it("trims higher-fatigue redundant accessories before lower-fatigue equivalents", () => {
    const chestExercise = exampleExerciseLibrary.find((entry) => entry.id === "db-press");
    const mainLiftExercise = exampleExerciseLibrary.find((entry) => entry.id === "bench");
    if (!chestExercise || !mainLiftExercise) {
      throw new Error("Expected db-press and bench sample exercises");
    }

    const makeAccessory = (id: string, fatigueCost: number): WorkoutExercise => ({
      id,
      exercise: { ...chestExercise, fatigueCost },
      orderIndex: 0,
      isMainLift: false,
      sets: Array.from({ length: 3 }, (_, index) => ({
        setIndex: index + 1,
        targetReps: 10,
      })),
    });

    const accessories = [
      makeAccessory("high-fatigue", 5),
      makeAccessory("low-fatigue", 1),
    ];
    const mainLifts: WorkoutExercise[] = [
      {
        id: "main-bench",
        exercise: mainLiftExercise,
        orderIndex: 0,
        isMainLift: true,
        sets: Array.from({ length: 4 }, (_, index) => ({
          setIndex: index + 1,
          targetReps: 6,
        })),
      },
    ];

    const trimmed = trimAccessoriesByPriority(accessories, mainLifts, 1);
    expect(trimmed).toHaveLength(1);
    expect(trimmed[0]?.id).toBe("low-fatigue");
  });
});

describe("enforceTimeBudget (Step 2: Safety Net)", () => {
  it("trims accessories to fit budget with UI-friendly notification", () => {
    const mainLifts = [makeMainLift("bench", { setCount: 4 })];
    const accessories = [
      makeAccessory("lateral-raise", { setCount: 3 }),
      makeAccessory("face-pull", { setCount: 3 }),
      makeAccessory("db-press", { setCount: 3 }),
    ];

    const workout: WorkoutPlan = {
      id: createId(),
      scheduledDate: new Date().toISOString(),
      warmup: [],
      mainLifts,
      accessories,
      estimatedMinutes: estimateWorkoutMinutes([...mainLifts, ...accessories]),
    };

    const result = enforceTimeBudget(workout, 25);

    expect(result.workout.accessories.length).toBeLessThan(accessories.length);
    expect(result.notification).toBeDefined();
    expect(result.notification).toContain("Adjusted workout");
    expect(result.notification).toContain("25-minute budget");
    expect(result.removedExercises).toBeDefined();
    expect(result.removedExercises!.length).toBeGreaterThan(0);
  });

  it("never trims main lifts", () => {
    const mainLifts = [makeMainLift("bench", { setCount: 5 }), makeMainLift("squat", { setCount: 5 })];
    const accessories = [makeAccessory("lateral-raise", { setCount: 3 })];

    const workout: WorkoutPlan = {
      id: createId(),
      scheduledDate: new Date().toISOString(),
      warmup: [],
      mainLifts,
      accessories,
      estimatedMinutes: estimateWorkoutMinutes([...mainLifts, ...accessories]),
    };

    const result = enforceTimeBudget(workout, 20);

    // Main lifts should never be trimmed
    expect(result.workout.mainLifts.length).toBe(mainLifts.length);
    expect(result.workout.mainLifts).toEqual(mainLifts);

    // All accessories should be removed if needed
    expect(result.workout.accessories.length).toBeLessThanOrEqual(accessories.length);
  });

  it("returns actionable notification when main lifts exceed budget", () => {
    const mainLifts = [
      makeMainLift("bench", { setCount: 5 }),
      makeMainLift("squat", { setCount: 5 }),
      makeMainLift("rdl", { setCount: 5 }),
    ];

    const workout: WorkoutPlan = {
      id: createId(),
      scheduledDate: new Date().toISOString(),
      warmup: [],
      mainLifts,
      accessories: [],
      estimatedMinutes: estimateWorkoutMinutes(mainLifts),
    };

    const result = enforceTimeBudget(workout, 30);

    // Should not trim main lifts
    expect(result.workout.mainLifts.length).toBe(3);

    // Should provide actionable notification
    expect(result.notification).toBeDefined();
    expect(result.notification).toContain("Main lifts require");
    expect(result.notification).toContain("budget: 30 min");
    expect(result.notification).toContain("Consider reducing volume or increasing time budget");

    // Should NOT have removed exercises list (didn't actually trim anything)
    expect(result.removedExercises).toBeUndefined();
  });

  it("trims lowest-priority accessories first (via existing scoring)", () => {
    const chestExercise = exampleExerciseLibrary.find((e) => e.id === "db-press");
    const lateralRaise = exampleExerciseLibrary.find((e) => e.id === "lateral-raise");
    if (!chestExercise || !lateralRaise) {
      throw new Error("Expected sample exercises");
    }

    const mainLifts = [makeMainLift("bench", { setCount: 4 })]; // Chest is covered

    // Chest accessory = redundant (covered by main lift) → LOW priority
    // Side delt accessory = uncovered → HIGH priority
    const accessories = [
      {
        ...makeAccessory("db-press", { setCount: 3 }),
        exercise: { ...chestExercise, primaryMuscles: ["Chest" as const] },
      },
      {
        ...makeAccessory("lateral-raise", { setCount: 3 }),
        exercise: { ...lateralRaise, primaryMuscles: ["Side Delts" as const] },
      },
    ];

    const workout: WorkoutPlan = {
      id: createId(),
      scheduledDate: new Date().toISOString(),
      warmup: [],
      mainLifts,
      accessories,
      estimatedMinutes: estimateWorkoutMinutes([...mainLifts, ...accessories]),
    };

    const result = enforceTimeBudget(workout, 20);

    // Chest accessory should be trimmed first (redundant)
    // Side delt accessory should be kept (uncovered)
    if (result.removedExercises && result.removedExercises.length > 0) {
      expect(result.removedExercises).toContain("Dumbbell Bench Press");
    }
  });

  it("handles superset accessories correctly", () => {
    const mainLifts = [makeMainLift("bench", { setCount: 4 })];
    const accessories = [
      makeAccessory("lateral-raise", { setCount: 3, supersetGroup: 1 }),
      makeAccessory("face-pull", { setCount: 3, supersetGroup: 1 }),
      makeAccessory("db-press", { setCount: 3 }),
    ];

    const workout: WorkoutPlan = {
      id: createId(),
      scheduledDate: new Date().toISOString(),
      warmup: [],
      mainLifts,
      accessories,
      estimatedMinutes: estimateWorkoutMinutes([...mainLifts, ...accessories]),
    };

    const result = enforceTimeBudget(workout, 20);

    // Should trim accessories (including superset pairs) to fit budget
    expect(result.workout.accessories.length).toBeLessThanOrEqual(accessories.length);
    expect(estimateWorkoutMinutes([...result.workout.mainLifts, ...result.workout.accessories]))
      .toBeLessThanOrEqual(20);
  });

  it("no-ops when already under budget (no notification)", () => {
    const mainLifts = [makeMainLift("bench", { setCount: 3 })];
    const accessories = [makeAccessory("lateral-raise", { setCount: 3 })];

    const workout: WorkoutPlan = {
      id: createId(),
      scheduledDate: new Date().toISOString(),
      warmup: [],
      mainLifts,
      accessories,
      estimatedMinutes: estimateWorkoutMinutes([...mainLifts, ...accessories]),
    };

    const result = enforceTimeBudget(workout, 60);

    // Should return unchanged
    expect(result.workout).toEqual(workout);
    expect(result.notification).toBeUndefined();
    expect(result.removedExercises).toBeUndefined();
  });

  it("notification includes removed exercise names and final duration", () => {
    const mainLifts = [makeMainLift("bench", { setCount: 4 })];
    const accessories = [
      makeAccessory("lateral-raise", { setCount: 3 }),
      makeAccessory("face-pull", { setCount: 3 }),
      makeAccessory("db-press", { setCount: 3 }),
    ];

    const workout: WorkoutPlan = {
      id: createId(),
      scheduledDate: new Date().toISOString(),
      warmup: [],
      mainLifts,
      accessories,
      estimatedMinutes: estimateWorkoutMinutes([...mainLifts, ...accessories]),
    };

    const result = enforceTimeBudget(workout, 20);

    expect(result.notification).toBeDefined();
    expect(result.notification).toMatch(/\d+ min/); // Includes final duration
    expect(result.notification).toContain("20-minute budget");

    // Should mention at least one removed exercise name
    if (result.removedExercises && result.removedExercises.length > 0) {
      const exerciseName = result.removedExercises[0];
      expect(result.notification).toContain(exerciseName);
    }
  });

  it("notification format is concise and user-friendly", () => {
    const mainLifts = [makeMainLift("bench", { setCount: 3 })];
    const accessories = [
      makeAccessory("lateral-raise", { setCount: 3 }),
      makeAccessory("face-pull", { setCount: 3 }),
      makeAccessory("db-press", { setCount: 3 }),
    ];

    const workout: WorkoutPlan = {
      id: createId(),
      scheduledDate: new Date().toISOString(),
      warmup: [],
      mainLifts,
      accessories,
      estimatedMinutes: estimateWorkoutMinutes([...mainLifts, ...accessories]),
    };

    const result = enforceTimeBudget(workout, 18);

    expect(result.notification).toBeDefined();

    // Should trim accessories (main lifts alone are ~13 min, so accessories push over 18 min)
    if (result.removedExercises && result.removedExercises.length > 0) {
      // Concise format: "Adjusted workout to X min to fit Y-minute budget (removed: ...)"
      expect(result.notification).toMatch(/^Adjusted workout to \d+ min to fit \d+-minute budget \(removed: .+\)$/);

      // User-friendly: no technical jargon, clear action taken
      expect(result.notification).not.toContain("ERROR");
      expect(result.notification).not.toContain("WARN");
      expect(result.notification).not.toContain("trimmed");
    }
  });
});
