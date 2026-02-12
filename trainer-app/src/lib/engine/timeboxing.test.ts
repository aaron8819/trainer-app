import { describe, it, expect } from "vitest";
import { estimateWorkoutMinutes } from "./timeboxing";
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

    // Per round: work(30) + work(30) + sharedRest(round(120 * 0.6)=72) = 132s
    // 3 rounds => 396s => round(6.6) = 7 min
    expect(estimateWorkoutMinutes([first, second])).toBe(7);
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
    // Per round: 30 + 30 + 60 = 120s. 3 rounds => 360s => 6 min.
    expect(estimateWorkoutMinutes([first, second])).toBe(6);
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
