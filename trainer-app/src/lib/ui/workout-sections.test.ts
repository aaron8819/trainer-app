import { describe, expect, it } from "vitest";

import { splitExercises } from "./workout-sections";

describe("splitExercises", () => {
  it("marks runtime-added exercises from canonical provenance for the log queue", () => {
    const result = splitExercises(
      [
        {
          id: "we-added",
          isMainLift: false,
          orderIndex: 0,
          section: "ACCESSORY",
          exercise: {
            name: "Pec Deck",
            exerciseEquipment: [{ equipment: { type: "MACHINE" } }],
          },
          sets: [
            {
              id: "set-1",
              setIndex: 1,
              targetReps: 12,
              targetRepMin: 10,
              targetRepMax: 14,
              targetLoad: 80,
              targetRpe: 6.5,
              restSeconds: 90,
            },
          ],
        },
      ],
      {
        runtimeEditReconciliation: {
          version: 1,
          lastReconciledAt: "2026-03-24T10:00:00.000Z",
          directives: {
            continuityAlias: "none",
            progressionAlias: "none",
            futureSessionGeneration: "ignore",
            futureSeedCarryForward: "ignore",
          },
          ops: [
            {
              kind: "add_exercise",
              source: "api_workouts_add_exercise",
              appliedAt: "2026-03-24T10:00:00.000Z",
              scope: "current_workout_only",
              facts: {
                workoutExerciseId: "we-added",
                exerciseId: "pec-deck",
                orderIndex: 0,
                section: "ACCESSORY",
                setCount: 1,
                prescriptionSource: "session_accessory_defaults",
              },
            },
          ],
        },
      }
    );

    expect(result.accessory).toHaveLength(1);
    expect(result.accessory[0]).toMatchObject({
      workoutExerciseId: "we-added",
      isRuntimeAdded: true,
      sessionNote: "Added during workout. Session-only; future planning ignores it.",
    });
  });

  it("marks replaced exercises as swaps instead of extras in the log queue", () => {
    const result = splitExercises(
      [
        {
          id: "we-row",
          isMainLift: false,
          orderIndex: 0,
          section: "MAIN",
          exercise: {
            name: "Chest-Supported Dumbbell Row",
            movementPatterns: ["HORIZONTAL_PULL"],
            exerciseEquipment: [{ equipment: { type: "DUMBBELL" } }],
          },
          sets: [
            {
              id: "set-1",
              setIndex: 1,
              targetReps: 10,
              targetRepMin: 8,
              targetRepMax: 12,
              targetLoad: 27.5,
              targetRpe: 8,
              restSeconds: 120,
            },
          ],
        },
      ],
      {
        runtimeEditReconciliation: {
          version: 1,
          lastReconciledAt: "2026-03-24T10:00:00.000Z",
          directives: {
            continuityAlias: "none",
            progressionAlias: "none",
            futureSessionGeneration: "ignore",
            futureSeedCarryForward: "ignore",
          },
          ops: [
            {
              kind: "replace_exercise",
              source: "api_workouts_swap_exercise",
              appliedAt: "2026-03-24T10:00:00.000Z",
              scope: "current_workout_only",
              facts: {
                workoutExerciseId: "we-row",
                fromExerciseId: "t-bar-row",
                fromExerciseName: "T-Bar Row",
                toExerciseId: "chest-supported-db-row",
                toExerciseName: "Chest-Supported Dumbbell Row",
                reason: "equipment_availability_equivalent_pull_swap",
                setCount: 1,
              },
            },
          ],
        },
      }
    );

    expect(result.main).toHaveLength(1);
    expect(result.main[0]).toMatchObject({
      workoutExerciseId: "we-row",
      isSwapped: true,
      isRuntimeAdded: false,
      sessionNote: "Swapped from T-Bar Row. Session-only; future progression stays exercise-specific.",
    });
  });
});
