import { describe, it, expect } from "vitest";
import { estimateWorkoutMinutes, trimAccessoriesByPriority } from "./timeboxing";
import { exampleExerciseLibrary } from "./sample-data";
import type { WorkoutExercise } from "./types";

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
