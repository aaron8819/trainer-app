import { describe, expect, it } from "vitest";
import { buildWeeklyMuscleVolumeSeries } from "./analytics";
import { buildExerciseStimulusSnapshot } from "@/lib/stimulus-accounting/snapshot";

describe("buildWeeklyMuscleVolumeSeries", () => {
  it("keeps rolling analytics aligned with canonical weighted stimulus accounting", () => {
    const result = buildWeeklyMuscleVolumeSeries([
      {
        scheduledDate: new Date("2026-03-03T10:00:00.000Z"),
        exercises: [
          {
            exercise: {
              id: "pull-up",
              name: "Pull-Up",
              aliases: [],
              exerciseMuscles: [
                { role: "PRIMARY", muscle: { name: "Lats" } },
                { role: "SECONDARY", muscle: { name: "Biceps" } },
                { role: "SECONDARY", muscle: { name: "Upper Back" } },
              ],
            },
            sets: Array.from({ length: 2 }, () => ({
              logs: [{ actualReps: 8, actualRpe: 8, wasSkipped: false }],
            })),
          },
          {
            exercise: {
              id: "curl",
              name: "EZ-Bar Curl",
              aliases: [],
              exerciseMuscles: [
                { role: "PRIMARY", muscle: { name: "Biceps" } },
                { role: "SECONDARY", muscle: { name: "Forearms" } },
              ],
            },
            sets: Array.from({ length: 2 }, () => ({
              logs: [{ actualReps: 8, actualRpe: 8, wasSkipped: false }],
            })),
          },
        ],
      },
    ]);

    expect(result).toEqual([
      {
        weekStart: "2026-03-02",
        muscles: {
          Biceps: { directSets: 2, indirectSets: 2, effectiveSets: 2.9 },
          Forearms: { directSets: 0, indirectSets: 2, effectiveSets: 0.5 },
          Lats: { directSets: 2, indirectSets: 0, effectiveSets: 2 },
          "Upper Back": { directSets: 0, indirectSets: 2, effectiveSets: 0.7 },
        },
      },
    ]);
  });

  it("uses the exposed scope so rolling analytics emits Core instead of Abs", () => {
    const result = buildWeeklyMuscleVolumeSeries([
      {
        scheduledDate: new Date("2026-03-03T10:00:00.000Z"),
        exercises: [
          {
            exercise: {
              id: "plank",
              name: "Plank",
              aliases: [],
              exerciseMuscles: [
                { role: "PRIMARY", muscle: { name: "Abs" } },
                { role: "SECONDARY", muscle: { name: "Lower Back" } },
              ],
            },
            sets: Array.from({ length: 2 }, () => ({
              logs: [{ actualReps: 30, actualRpe: 8, wasSkipped: false }],
            })),
          },
        ],
      },
    ]);

    expect(result).toEqual([
      {
        weekStart: "2026-03-02",
        muscles: {
          Core: { directSets: 2, indirectSets: 0, effectiveSets: 2 },
          "Lower Back": { directSets: 0, indirectSets: 2, effectiveSets: 0 },
        },
      },
    ]);
  });

  it("keeps historical output on the stored policy while new materialization uses current policy", () => {
    const storedPolicy = buildExerciseStimulusSnapshot(
      {
        id: "exercise-1",
        name: "Original Press",
        primaryMuscles: ["Chest"],
        secondaryMuscles: ["Triceps"],
        stimulusProfile: { chest: 1, triceps: 0.5 },
      },
      "exact"
    );
    const changedCatalogExercise = {
      id: "exercise-1",
      name: "Renamed Quad Exercise",
      aliases: [],
      exerciseMuscles: [{ role: "PRIMARY", muscle: { name: "Quads" } }],
    };
    const set = { logs: [{ actualReps: 8, actualRpe: 8, wasSkipped: false }] };

    const historical = buildWeeklyMuscleVolumeSeries([
      {
        scheduledDate: new Date("2026-03-03T10:00:00.000Z"),
        exercises: [
          {
            stimulusAccountingSnapshot: storedPolicy,
            exercise: changedCatalogExercise,
            sets: [set, set],
          },
        ],
      },
    ]);
    const newlyMaterialized = buildWeeklyMuscleVolumeSeries([
      {
        scheduledDate: new Date("2026-03-03T10:00:00.000Z"),
        exercises: [
          {
            stimulusAccountingSnapshot: buildExerciseStimulusSnapshot(
              {
                id: "exercise-1",
                name: "Renamed Quad Exercise",
                primaryMuscles: ["Quads"],
                secondaryMuscles: [],
                stimulusProfile: { quads: 1 },
              },
              "exact"
            ),
            exercise: changedCatalogExercise,
            sets: [set, set],
          },
        ],
      },
    ]);

    expect(historical[0]?.muscles).toEqual({
      Chest: { directSets: 2, indirectSets: 0, effectiveSets: 2 },
      Triceps: { directSets: 0, indirectSets: 2, effectiveSets: 1 },
    });
    expect(newlyMaterialized[0]?.muscles).toEqual({
      Quads: { directSets: 2, indirectSets: 0, effectiveSets: 2 },
    });
  });
});
