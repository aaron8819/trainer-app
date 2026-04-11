import { describe, expect, it } from "vitest";

import { splitExercises } from "./workout-sections";

describe("splitExercises", () => {
  it("shapes compact target muscle tags from canonical exercise metadata", () => {
    const result = splitExercises(
      [
        {
          id: "we-squat",
          isMainLift: true,
          orderIndex: 0,
          section: "MAIN",
          exercise: {
            id: "barbell-back-squat",
            name: "Barbell Back Squat",
            exerciseMuscles: [
              { role: "PRIMARY", muscle: { name: "Quads" } },
              { role: "PRIMARY", muscle: { name: "Glutes" } },
              { role: "SECONDARY", muscle: { name: "Hamstrings" } },
              { role: "SECONDARY", muscle: { name: "Core" } },
              { role: "SECONDARY", muscle: { name: "Lower Back" } },
              { role: "SECONDARY", muscle: { name: "Adductors" } },
            ],
            exerciseEquipment: [{ equipment: { type: "BARBELL" } }],
          },
          sets: [
            {
              id: "set-squat-1",
              setIndex: 1,
              targetReps: 8,
              targetRepMin: 6,
              targetRepMax: 10,
              targetLoad: 210,
              targetRpe: 8,
              restSeconds: 180,
            },
          ],
        },
        {
          id: "we-curl",
          isMainLift: false,
          orderIndex: 1,
          section: "ACCESSORY",
          exercise: {
            id: "seated-leg-curl",
            name: "Seated Leg Curl",
            exerciseMuscles: [{ role: "PRIMARY", muscle: { name: "Hamstrings" } }],
            exerciseEquipment: [{ equipment: { type: "MACHINE" } }],
          },
          sets: [
            {
              id: "set-curl-1",
              setIndex: 1,
              targetReps: 12,
              targetRepMin: 10,
              targetRepMax: 15,
              targetLoad: 90,
              targetRpe: 8,
              restSeconds: 90,
            },
          ],
        },
        {
          id: "we-calf",
          isMainLift: false,
          orderIndex: 2,
          section: "ACCESSORY",
          exercise: {
            id: "seated-calf-raise",
            name: "Seated Calf Raise",
            exerciseMuscles: [{ role: "PRIMARY", muscle: { name: "Calves" } }],
            exerciseEquipment: [{ equipment: { type: "MACHINE" } }],
          },
          sets: [
            {
              id: "set-calf-1",
              setIndex: 1,
              targetReps: 15,
              targetRepMin: 12,
              targetRepMax: 20,
              targetLoad: 75,
              targetRpe: 8,
              restSeconds: 90,
            },
          ],
        },
      ],
      {}
    );

    expect(result.main[0]?.muscleTags).toEqual(["Quads", "Glutes", "Core", "Adductors"]);
    expect(result.accessory[0]?.muscleTags).toEqual(["Hamstrings"]);
    expect(result.accessory[1]?.muscleTags).toEqual(["Calves"]);
  });

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
