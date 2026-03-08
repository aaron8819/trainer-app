import { describe, expect, it } from "vitest";
import { buildAnalyticsSummary } from "./analytics-summary";

describe("buildAnalyticsSummary", () => {
  it("promotes training consistency metrics without losing workout telemetry", () => {
    const result = buildAnalyticsSummary({
      workouts: [
        {
          status: "COMPLETED",
          scheduledDate: new Date("2026-02-03T12:00:00.000Z"),
          selectionMode: "AUTO",
          sessionIntent: "PUSH",
        },
        {
          status: "PARTIAL",
          scheduledDate: new Date("2026-02-05T12:00:00.000Z"),
          selectionMode: "MANUAL",
          sessionIntent: "PULL",
        },
        {
          status: "COMPLETED",
          scheduledDate: new Date("2026-02-10T12:00:00.000Z"),
          selectionMode: "BONUS",
          sessionIntent: "LEGS",
        },
        {
          status: "COMPLETED",
          scheduledDate: new Date("2026-02-12T12:00:00.000Z"),
          selectionMode: "AUTO",
          sessionIntent: "PUSH",
        },
        {
          status: "COMPLETED",
          scheduledDate: new Date("2026-02-14T12:00:00.000Z"),
          selectionMode: "INTENT",
          sessionIntent: "PULL",
        },
        {
          status: "COMPLETED",
          scheduledDate: new Date("2026-02-18T12:00:00.000Z"),
          selectionMode: "AUTO",
          sessionIntent: "PUSH",
        },
        {
          status: "PLANNED",
          scheduledDate: new Date("2026-02-25T12:00:00.000Z"),
          selectionMode: "MANUAL",
          sessionIntent: "LEGS",
        },
        {
          status: "COMPLETED",
          scheduledDate: new Date("2026-03-03T12:00:00.000Z"),
          selectionMode: "AUTO",
          sessionIntent: "PULL",
        },
      ],
      trackedSelectionModes: ["AUTO", "MANUAL", "BONUS", "INTENT"],
      targetSessionsPerWeek: 3,
      totalSets: 42,
      now: new Date("2026-03-08T12:00:00.000Z"),
    });

    expect(result.totals).toEqual({
      workoutsGenerated: 8,
      workoutsPerformed: 7,
      workoutsCompleted: 6,
      totalSets: 42,
    });
    expect(result.consistency).toEqual({
      targetSessionsPerWeek: 3,
      thisWeekPerformed: 1,
      rollingFourWeekAverage: 1.3,
      currentTrainingStreakWeeks: 1,
      weeksMeetingTarget: 1,
      trackedWeeks: 5,
    });
    expect(result.kpis.selectionModes).toEqual([
      {
        mode: "AUTO",
        generated: 4,
        performed: 4,
        completed: 4,
        performedRate: 1,
        completionRate: 1,
      },
      {
        mode: "MANUAL",
        generated: 2,
        performed: 1,
        completed: 0,
        performedRate: 0.5,
        completionRate: 0,
      },
      {
        mode: "BONUS",
        generated: 1,
        performed: 1,
        completed: 1,
        performedRate: 1,
        completionRate: 1,
      },
      {
        mode: "INTENT",
        generated: 1,
        performed: 1,
        completed: 1,
        performedRate: 1,
        completionRate: 1,
      },
    ]);
  });
});
