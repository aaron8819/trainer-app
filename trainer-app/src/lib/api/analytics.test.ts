import { describe, expect, it } from "vitest";
import { buildWeeklyMuscleVolumeSeries } from "./analytics";

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
            sets: Array.from({ length: 2 }, () => ({ logs: [{ wasSkipped: false }] })),
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
            sets: Array.from({ length: 2 }, () => ({ logs: [{ wasSkipped: false }] })),
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
});
