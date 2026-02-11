import { describe, expect, it } from "vitest";
import { buildMuscleRecoveryMap, generateSraWarnings } from "./sra";
import type { Exercise, WorkoutHistoryEntry } from "./types";

const makeExercise = (id: string, primaryMuscles: string[]): Exercise => ({
  id,
  name: id,
  movementPatterns: ["horizontal_push"],
  splitTags: ["push"],
  jointStress: "low",
  equipment: ["cable"],
  primaryMuscles,
});

const makeExerciseWithSra = (
  id: string,
  primaryMuscles: string[],
  muscleSraHours: Record<string, number>
): Exercise => ({
  ...makeExercise(id, primaryMuscles),
  muscleSraHours,
});

const library: Exercise[] = [
  makeExercise("bench", ["Chest", "Triceps"]),
  makeExercise("squat", ["Quads", "Glutes"]),
  makeExercise("curl", ["Biceps"]),
];

describe("buildMuscleRecoveryMap", () => {
  it("returns 100% recovery for all muscles when no history", () => {
    const map = buildMuscleRecoveryMap([], library);
    const chest = map.get("Chest")!;
    expect(chest.isRecovered).toBe(true);
    expect(chest.recoveryPercent).toBe(100);
    expect(chest.lastTrainedHoursAgo).toBeNull();
  });

  it("shows partial recovery for recently trained muscle", () => {
    const now = new Date();
    const hoursAgo = 24;
    const history: WorkoutHistoryEntry[] = [
      {
        date: new Date(now.getTime() - hoursAgo * 60 * 60 * 1000).toISOString(),
        completed: true,
        exercises: [
          {
            exerciseId: "bench",
            movementPattern: "push",
            sets: [{ exerciseId: "bench", setIndex: 1, reps: 10 }],
          },
        ],
      },
    ];

    const map = buildMuscleRecoveryMap(history, library, now);
    const chest = map.get("Chest")!;
    // Chest SRA = 60 hours, trained 24h ago → ~40% recovered
    expect(chest.isRecovered).toBe(false);
    expect(chest.recoveryPercent).toBe(40);
    expect(chest.lastTrainedHoursAgo).toBe(24);
  });

  it("shows fully recovered when enough time has passed", () => {
    const now = new Date();
    const hoursAgo = 72; // 3 days
    const history: WorkoutHistoryEntry[] = [
      {
        date: new Date(now.getTime() - hoursAgo * 60 * 60 * 1000).toISOString(),
        completed: true,
        exercises: [
          {
            exerciseId: "bench",
            movementPattern: "push",
            sets: [{ exerciseId: "bench", setIndex: 1, reps: 10 }],
          },
        ],
      },
    ];

    const map = buildMuscleRecoveryMap(history, library, now);
    const chest = map.get("Chest")!;
    // Chest SRA = 60 hours, trained 72h ago → 100% recovered
    expect(chest.isRecovered).toBe(true);
    expect(chest.recoveryPercent).toBe(100);
  });

  it("ignores incomplete workouts", () => {
    const now = new Date();
    const history: WorkoutHistoryEntry[] = [
      {
        date: new Date(now.getTime() - 1 * 60 * 60 * 1000).toISOString(),
        completed: false,
        exercises: [
          {
            exerciseId: "bench",
            movementPattern: "push",
            sets: [{ exerciseId: "bench", setIndex: 1, reps: 10 }],
          },
        ],
      },
    ];

    const map = buildMuscleRecoveryMap(history, library, now);
    const chest = map.get("Chest")!;
    expect(chest.isRecovered).toBe(true);
    expect(chest.lastTrainedHoursAgo).toBeNull();
  });

  it("uses DB-provided sraHours when available on exercises", () => {
    const now = new Date();
    const history: WorkoutHistoryEntry[] = [
      {
        date: new Date(now.getTime() - 18 * 60 * 60 * 1000).toISOString(),
        completed: true,
        exercises: [
          {
            exerciseId: "bench",
            movementPattern: "push",
            sets: [{ exerciseId: "bench", setIndex: 1, reps: 10 }],
          },
        ],
      },
    ];
    const dbBackedLibrary: Exercise[] = [
      makeExerciseWithSra("bench", ["Chest", "Triceps"], {
        Chest: 36,
        Triceps: 36,
      }),
    ];

    const map = buildMuscleRecoveryMap(history, dbBackedLibrary, now);
    const chest = map.get("Chest")!;
    expect(chest.sraWindowHours).toBe(36);
    expect(chest.recoveryPercent).toBe(50);
  });

  it("falls back to engine constants when DB windows are disabled", () => {
    const now = new Date();
    const history: WorkoutHistoryEntry[] = [
      {
        date: new Date(now.getTime() - 18 * 60 * 60 * 1000).toISOString(),
        completed: true,
        exercises: [
          {
            exerciseId: "bench",
            movementPattern: "push",
            sets: [{ exerciseId: "bench", setIndex: 1, reps: 10 }],
          },
        ],
      },
    ];
    const dbBackedLibrary: Exercise[] = [
      makeExerciseWithSra("bench", ["Chest", "Triceps"], {
        Chest: 36,
        Triceps: 36,
      }),
    ];
    const previous = process.env.USE_DB_SRA_WINDOWS;
    process.env.USE_DB_SRA_WINDOWS = "false";

    try {
      const map = buildMuscleRecoveryMap(history, dbBackedLibrary, now);
      const chest = map.get("Chest")!;
      expect(chest.sraWindowHours).toBe(60);
      expect(chest.recoveryPercent).toBe(30);
    } finally {
      if (previous === undefined) {
        delete process.env.USE_DB_SRA_WINDOWS;
      } else {
        process.env.USE_DB_SRA_WINDOWS = previous;
      }
    }
  });

  it("matches DB-provided sraHours case-insensitively", () => {
    const now = new Date();
    const history: WorkoutHistoryEntry[] = [
      {
        date: new Date(now.getTime() - 18 * 60 * 60 * 1000).toISOString(),
        completed: true,
        exercises: [
          {
            exerciseId: "row",
            movementPattern: "pull",
            sets: [{ exerciseId: "row", setIndex: 1, reps: 10 }],
          },
        ],
      },
    ];
    const dbBackedLibrary: Exercise[] = [
      makeExerciseWithSra("row", ["Upper Back"], {
        "upper back": 36,
      }),
    ];

    const map = buildMuscleRecoveryMap(history, dbBackedLibrary, now);
    const upperBack = map.get("Upper Back")!;
    expect(upperBack.sraWindowHours).toBe(36);
    expect(upperBack.recoveryPercent).toBe(50);
  });
});

describe("generateSraWarnings", () => {
  it("returns warnings for under-recovered target muscles", () => {
    const now = new Date();
    const history: WorkoutHistoryEntry[] = [
      {
        date: new Date(now.getTime() - 20 * 60 * 60 * 1000).toISOString(),
        completed: true,
        exercises: [
          {
            exerciseId: "bench",
            movementPattern: "push",
            sets: [{ exerciseId: "bench", setIndex: 1, reps: 10 }],
          },
        ],
      },
    ];

    const map = buildMuscleRecoveryMap(history, library, now);
    const warnings = generateSraWarnings(map, ["Chest", "Biceps"]);

    expect(warnings).toHaveLength(1);
    expect(warnings[0].muscle).toBe("Chest");
    expect(warnings[0].recoveryPercent).toBeLessThan(100);
  });

  it("returns empty array when all muscles recovered", () => {
    const map = buildMuscleRecoveryMap([], library);
    const warnings = generateSraWarnings(map, ["Chest", "Biceps"]);
    expect(warnings).toHaveLength(0);
  });

  it("matches target muscles case-insensitively in constants fallback mode", () => {
    const now = new Date();
    const history: WorkoutHistoryEntry[] = [
      {
        date: new Date(now.getTime() - 18 * 60 * 60 * 1000).toISOString(),
        completed: true,
        exercises: [
          {
            exerciseId: "row",
            movementPattern: "pull",
            primaryMuscles: ["UPPER BACK"],
            sets: [{ exerciseId: "row", setIndex: 1, reps: 10 }],
          },
        ],
      },
    ];
    const fallbackLibrary: Exercise[] = [
      makeExerciseWithSra("row", ["UPPER BACK"], {}),
    ];
    const previous = process.env.USE_DB_SRA_WINDOWS;
    process.env.USE_DB_SRA_WINDOWS = "false";

    try {
      const map = buildMuscleRecoveryMap(history, fallbackLibrary, now);
      const warnings = generateSraWarnings(map, ["Upper Back"]);
      expect(warnings).toHaveLength(1);
      expect(warnings[0].sraWindowHours).toBe(48);
    } finally {
      if (previous === undefined) {
        delete process.env.USE_DB_SRA_WINDOWS;
      } else {
        process.env.USE_DB_SRA_WINDOWS = previous;
      }
    }
  });
});
