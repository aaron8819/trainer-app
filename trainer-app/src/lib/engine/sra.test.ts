import { describe, expect, it } from "vitest";
import { buildMuscleRecoveryMap } from "./sra";
import type { Exercise, WorkoutHistoryEntry } from "./types";

const EXERCISES: Exercise[] = [
  {
    id: "bench",
    name: "Bench Press",
    movementPatterns: ["horizontal_push"],
    splitTags: ["push"],
    jointStress: "medium",
    equipment: ["barbell"],
    primaryMuscles: ["Chest"],
    secondaryMuscles: ["Triceps", "Front Delts"],
  },
];

describe("buildMuscleRecoveryMap", () => {
  it("treats PARTIAL workouts as performed history for recovery timing", () => {
    const history: WorkoutHistoryEntry[] = [
      {
        date: "2026-03-07T12:00:00.000Z",
        completed: false,
        status: "PARTIAL",
        exercises: [
          {
            exerciseId: "bench",
            primaryMuscles: ["Chest"],
            sets: [{ exerciseId: "bench", setIndex: 0, reps: 10, rpe: 8 }],
          },
        ],
      },
    ];

    const recovery = buildMuscleRecoveryMap(
      history,
      EXERCISES,
      new Date("2026-03-08T00:00:00.000Z")
    );

    expect(recovery.get("Chest")).toMatchObject({
      muscle: "Chest",
      lastTrainedHoursAgo: 12,
      sraWindowHours: 60,
      isRecovered: false,
      recoveryPercent: 20,
    });
  });
});
