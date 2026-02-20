import { describe, expect, it } from "vitest";
import {
  buildVolumeContext,
  deriveFatigueState,
  effectiveWeeklySets,
  enforceVolumeCaps,
} from "./volume";
import type { Exercise, WorkoutExercise, WorkoutHistoryEntry } from "./types";
import { INDIRECT_SET_MULTIPLIER } from "./volume-constants";

function makeWorkoutExercise(
  id: string,
  primaryMuscles: string[],
  fatigueCost: number,
  sets: number,
  secondaryMuscles: string[] = []
): WorkoutExercise {
  return {
    id,
    exercise: {
      id,
      name: id,
      movementPatterns: [],
      splitTags: ["push"],
      jointStress: "low",
      isCompound: false,
      fatigueCost,
      equipment: ["cable"],
      primaryMuscles,
      secondaryMuscles,
    },
    orderIndex: 0,
    isMainLift: false,
    sets: Array.from({ length: sets }, (_, i) => ({
      setIndex: i + 1,
      targetReps: 10,
    })),
  };
}

const USE_EFFECTIVE_VOLUME_CAPS_ENV = "USE_EFFECTIVE_VOLUME_CAPS";

function withEffectiveVolumeCapsFlag(value: string | undefined, run: () => void) {
  const previous = process.env[USE_EFFECTIVE_VOLUME_CAPS_ENV];
  if (value === undefined) {
    delete process.env[USE_EFFECTIVE_VOLUME_CAPS_ENV];
  } else {
    process.env[USE_EFFECTIVE_VOLUME_CAPS_ENV] = value;
  }
  try {
    run();
  } finally {
    if (previous === undefined) {
      delete process.env[USE_EFFECTIVE_VOLUME_CAPS_ENV];
    } else {
      process.env[USE_EFFECTIVE_VOLUME_CAPS_ENV] = previous;
    }
  }
}

describe("enforceVolumeCaps", () => {
  it("removes the lowest-scored accessory, not just the last one", () => {
    const mainLifts: WorkoutExercise[] = [
      makeWorkoutExercise("bench", ["chest", "triceps"], 4, 4),
    ];
    // acc-redundant: targets chest (covered by bench) → uncovered=0, novelty=0
    //   score = fatigueCost(3) + novelty(0) - redundancy(0) = 3
    // acc-unique: targets biceps (NOT covered by bench) → uncovered=1, novelty=2
    //   score = fatigueCost(3) + novelty(2) - redundancy(0) = 5
    // Place redundant FIRST and unique LAST to prove we don't just .pop()
    const accessories: WorkoutExercise[] = [
      makeWorkoutExercise("acc-redundant", ["chest"], 3, 3),
      makeWorkoutExercise("acc-unique", ["biceps"], 3, 3),
    ];

    // recent=3, main adds 4 chest sets, acc-redundant adds 3 → planned chest = 10
    // previous chest = 8 → cap = 8 * 1.2 = 9.6 → 10 > 9.6 → exceeds
    // After removing acc-redundant (score 3 < score 5): planned chest = 3 + 4 = 7 < 9.6 → OK
    const volumeContext = {
      recent: { chest: 3 },
      previous: { chest: 8 },
    };

    const result = enforceVolumeCaps(accessories, mainLifts, volumeContext);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("acc-unique");
  });

  it("returns accessories unchanged when no cap is exceeded", () => {
    const mainLifts: WorkoutExercise[] = [
      makeWorkoutExercise("bench", ["chest"], 4, 4),
    ];
    const accessories: WorkoutExercise[] = [
      makeWorkoutExercise("fly", ["chest"], 2, 3),
    ];
    const volumeContext = {
      recent: {},
      previous: {},
    };

    const result = enforceVolumeCaps(accessories, mainLifts, volumeContext);
    expect(result).toEqual(accessories);
  });

  it("returns empty array when all accessories exceed cap", () => {
    const mainLifts: WorkoutExercise[] = [
      makeWorkoutExercise("bench", ["chest"], 4, 4),
    ];
    const accessories: WorkoutExercise[] = [
      makeWorkoutExercise("fly", ["chest"], 2, 3),
    ];
    // previous has very low baseline, everything exceeds
    const volumeContext = {
      recent: { chest: 10 },
      previous: { chest: 1 },
    };

    const result = enforceVolumeCaps(accessories, mainLifts, volumeContext);
    expect(result).toHaveLength(0);
  });

  it("enforces hard MRV caps in enhanced mode", () => {
    const mainLifts: WorkoutExercise[] = [
      makeWorkoutExercise("bench", ["Chest"], 4, 4),
    ];
    const accessories: WorkoutExercise[] = [
      makeWorkoutExercise("fly", ["Chest"], 2, 3),
    ];
    const enhancedBase = buildVolumeContext([], [], { week: 0, length: 4 });
    if (!("muscleVolume" in enhancedBase)) {
      throw new Error("Expected enhanced volume context");
    }
    const volumeContext = {
      ...enhancedBase,
      recent: { Chest: 18 },
      previous: { Chest: 40 },
    };

    const result = enforceVolumeCaps(accessories, mainLifts, volumeContext);
    expect(result).toHaveLength(0);
  });

  it("keeps spike cap as a secondary safety net in enhanced mode", () => {
    const mainLifts: WorkoutExercise[] = [
      makeWorkoutExercise("bench", ["Chest"], 4, 4),
    ];
    const accessories: WorkoutExercise[] = [
      makeWorkoutExercise("fly", ["Chest"], 2, 3),
    ];
    const enhancedBase = buildVolumeContext([], [], { week: 0, length: 4 });
    if (!("muscleVolume" in enhancedBase)) {
      throw new Error("Expected enhanced volume context");
    }
    const volumeContext = {
      ...enhancedBase,
      recent: { Chest: 6 },
      previous: { Chest: 5 },
    };

    const result = enforceVolumeCaps(accessories, mainLifts, volumeContext);
    expect(result).toHaveLength(0);
  });

  it("effective-cap-under-mrv", () => {
    withEffectiveVolumeCapsFlag("true", () => {
      const mainLifts: WorkoutExercise[] = [];
      const accessories: WorkoutExercise[] = [
        makeWorkoutExercise("good-morning", ["Quads"], 3, 12, ["Hamstrings"]),
      ];
      const enhancedBase = buildVolumeContext([], [], { week: 0, length: 4 });
      if (!("muscleVolume" in enhancedBase)) {
        throw new Error("Expected enhanced volume context");
      }
      const volumeContext = {
        ...enhancedBase,
        recent: { Hamstrings: 6 },
        previous: { Hamstrings: 50, Quads: 50 },
      };

      const result = enforceVolumeCaps(accessories, mainLifts, volumeContext);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("good-morning");
    });
  });

  it("effective-cap-over-mrv", () => {
    withEffectiveVolumeCapsFlag("true", () => {
      const mainLifts: WorkoutExercise[] = [];
      const accessories: WorkoutExercise[] = [
        makeWorkoutExercise("ham-overlap", ["Quads"], 4, 20, ["Hamstrings"]),
        makeWorkoutExercise("keep-this", ["Upper Back", "Rear Delts"], 2, 3),
      ];
      const enhancedBase = buildVolumeContext([], [], { week: 0, length: 4 });
      if (!("muscleVolume" in enhancedBase)) {
        throw new Error("Expected enhanced volume context");
      }
      const volumeContext = {
        ...enhancedBase,
        recent: { Hamstrings: 16 },
        previous: { Hamstrings: 50, Quads: 50, "Upper Back": 50 },
      };

      const result = enforceVolumeCaps(accessories, mainLifts, volumeContext);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("keep-this");
    });
  });

  it("effective-cap-flag-off", () => {
    withEffectiveVolumeCapsFlag("false", () => {
      const mainLifts: WorkoutExercise[] = [];
      const accessories: WorkoutExercise[] = [
        makeWorkoutExercise("ham-overlap", ["Quads"], 4, 20, ["Hamstrings"]),
        makeWorkoutExercise("keep-this", ["Upper Back", "Rear Delts"], 2, 3),
      ];
      const enhancedBase = buildVolumeContext([], [], { week: 0, length: 4 });
      if (!("muscleVolume" in enhancedBase)) {
        throw new Error("Expected enhanced volume context");
      }
      const volumeContext = {
        ...enhancedBase,
        recent: { Hamstrings: 16 },
        previous: { Hamstrings: 50, Quads: 50, "Upper Back": 50 },
      };

      const result = enforceVolumeCaps(accessories, mainLifts, volumeContext);

      expect(result).toHaveLength(2);
      expect(result.map((exercise) => exercise.id)).toEqual(["ham-overlap", "keep-this"]);
    });
  });
});

describe("buildVolumeContext", () => {
  it("excludes non-completed workouts from recent and previous volume", () => {
    const exerciseLibrary: Exercise[] = [
      {
        id: "bench",
        name: "Bench Press",
        movementPatterns: ["horizontal_push"],
        splitTags: ["push"],
        jointStress: "medium",
        equipment: ["barbell"],
        primaryMuscles: ["Chest"],
      },
    ];
    const history: WorkoutHistoryEntry[] = [
      {
        date: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        completed: true,
        status: "COMPLETED",
        exercises: [
          {
            exerciseId: "bench",

            sets: [
              { exerciseId: "bench", setIndex: 1, reps: 8 },
              { exerciseId: "bench", setIndex: 2, reps: 8 },
            ],
          },
        ],
      },
      {
        date: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
        completed: false,
        status: "PLANNED",
        exercises: [
          {
            exerciseId: "bench",

            sets: [
              { exerciseId: "bench", setIndex: 1, reps: 8 },
              { exerciseId: "bench", setIndex: 2, reps: 8 },
              { exerciseId: "bench", setIndex: 3, reps: 8 },
            ],
          },
        ],
      },
    ];

    const context = buildVolumeContext(history, exerciseLibrary);

    expect(context.recent.Chest).toBe(2);
  });
});

describe("deriveFatigueState", () => {
  it("uses the most recent workout by date regardless of input array order", () => {
    const history: WorkoutHistoryEntry[] = [
      {
        date: "2026-02-10T00:00:00Z",
        completed: true,
        status: "COMPLETED",
        readinessScore: 1,
        exercises: [],
      },
      {
        date: "2026-02-01T00:00:00Z",
        completed: false,
        status: "SKIPPED",
        readinessScore: 5,
        exercises: [],
      },
    ];

    const state = deriveFatigueState(history);

    expect(state.readinessScore).toBe(1);
    expect(state.missedLastSession).toBe(false);
  });
});

describe("effectiveWeeklySets", () => {
  it("uses the shared indirect multiplier constant", () => {
    const state = {
      weeklyDirectSets: 10,
      weeklyIndirectSets: 10,
      plannedSets: 0,
      landmark: { mv: 0, mev: 0, mav: 0, mrv: 99, sraHours: 48 },
    };

    expect(effectiveWeeklySets(state)).toBe(10 + 10 * INDIRECT_SET_MULTIPLIER);
  });
});
