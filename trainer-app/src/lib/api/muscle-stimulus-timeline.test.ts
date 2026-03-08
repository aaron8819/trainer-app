import { describe, expect, it } from "vitest";
import { buildMuscleStimulusTimeline } from "./muscle-stimulus-timeline";

describe("buildMuscleStimulusTimeline", () => {
  it("uses canonical weighted stimulus accounting for daily muscle timelines", () => {
    const result = buildMuscleStimulusTimeline(
      [
        {
          scheduledDate: new Date("2026-03-07T10:00:00.000Z"),
          exercises: [
            {
              exercise: {
                id: "bench",
                name: "Bench Press",
                aliases: [],
                exerciseMuscles: [
                  { role: "PRIMARY", muscle: { name: "Chest" } },
                  { role: "SECONDARY", muscle: { name: "Front Delts" } },
                  { role: "SECONDARY", muscle: { name: "Triceps" } },
                ],
              },
              sets: [{ logs: [{ wasSkipped: false }] }, { logs: [{ wasSkipped: false }] }],
            },
          ],
        },
      ],
      {
        asOf: new Date("2026-03-08T12:00:00.000Z"),
        muscles: ["Chest", "Front Delts", "Triceps"],
      }
    );

    expect(result.Chest.days.at(-2)).toEqual({
      date: "2026-03-07",
      effectiveSets: 2,
      intensityBand: 2,
    });
    expect(result["Front Delts"].days.at(-2)).toEqual({
      date: "2026-03-07",
      effectiveSets: 0.6,
      intensityBand: 1,
    });
    expect(result.Triceps.days.at(-2)).toEqual({
      date: "2026-03-07",
      effectiveSets: 0.9,
      intensityBand: 1,
    });
  });

  it("returns buckets in oldest-to-newest order and preserves empty days", () => {
    const result = buildMuscleStimulusTimeline(
      [
        {
          scheduledDate: new Date("2026-03-03T09:00:00.000Z"),
          exercises: [
            {
              exercise: {
                id: "row",
                name: "Barbell Row",
                aliases: [],
                exerciseMuscles: [
                  { role: "PRIMARY", muscle: { name: "Upper Back" } },
                  { role: "SECONDARY", muscle: { name: "Biceps" } },
                ],
              },
              sets: [{ logs: [{ wasSkipped: false }] }],
            },
          ],
        },
      ],
      {
        asOf: new Date("2026-03-08T12:00:00.000Z"),
        muscles: ["Upper Back", "Chest"],
      }
    );

    expect(result["Upper Back"].days.map((day) => day.date)).toEqual([
      "2026-03-02",
      "2026-03-03",
      "2026-03-04",
      "2026-03-05",
      "2026-03-06",
      "2026-03-07",
      "2026-03-08",
    ]);
    expect(result.Chest.days.every((day) => day.effectiveSets === 0)).toBe(true);
  });
});
