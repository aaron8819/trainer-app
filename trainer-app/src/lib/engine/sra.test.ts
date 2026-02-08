import { describe, expect, it } from "vitest";
import { buildMuscleRecoveryMap, generateSraWarnings } from "./sra";
import type { Exercise, WorkoutHistoryEntry } from "./types";

const makeExercise = (id: string, primaryMuscles: string[]): Exercise => ({
  id,
  name: id,
  movementPattern: "push",
  movementPatternsV2: ["horizontal_push"],
  splitTags: ["push"],
  jointStress: "low",
  isMainLift: false,
  equipment: ["cable"],
  primaryMuscles,
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
});
