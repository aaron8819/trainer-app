import { describe, expect, it, vi } from "vitest";
import { loadRecentMuscleStimulus } from "./recent-muscle-stimulus";

describe("loadRecentMuscleStimulus", () => {
  it("uses canonical weighted stimulus accounting for recent muscle stimulus", async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        scheduledDate: new Date("2026-03-08T00:00:00.000Z"),
        exercises: [
          {
            exercise: {
              id: "bench",
              name: "Bench Press",
              aliases: [],
              exerciseMuscles: [
                { role: "PRIMARY", muscle: { name: "Chest", sraHours: 60 } },
                { role: "SECONDARY", muscle: { name: "Front Delts", sraHours: 48 } },
                { role: "SECONDARY", muscle: { name: "Triceps", sraHours: 48 } },
              ],
            },
            sets: [{ logs: [{ wasSkipped: false }] }, { logs: [{ wasSkipped: false }] }],
          },
        ],
      },
    ]);

    const result = await loadRecentMuscleStimulus(
      { workout: { findMany } } as never,
      {
        userId: "user-1",
        targetByMuscle: {
          Chest: 10,
          "Front Delts": 5,
          Triceps: 6,
        },
        asOf: new Date("2026-03-08T12:00:00.000Z"),
      }
    );

    expect(result.Chest).toMatchObject({
      recentEffectiveSets: 2,
      recentStimulusRatio: 0.2,
      hoursSinceStimulus: 12,
      sraHours: 60,
    });
    expect(result["Front Delts"]).toMatchObject({
      recentEffectiveSets: 0.6,
      recentStimulusRatio: 0.1,
      hoursSinceStimulus: 12,
      sraHours: 48,
    });
    expect(result.Triceps).toMatchObject({
      recentEffectiveSets: 0.9,
      recentStimulusRatio: 0.2,
      hoursSinceStimulus: 12,
      sraHours: 48,
    });
  });
});
