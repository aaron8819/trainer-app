import { describe, expect, it } from "vitest";
import {
  buildAllTimeAnalyticsWindow,
  buildDateRangeAnalyticsWindow,
  buildRollingDaysAnalyticsWindow,
  buildRollingIsoWeeksAnalyticsWindow,
  countAnalyticsWorkoutStatuses,
  isAnalyticsCompletedWorkoutStatus,
  isAnalyticsPerformedWorkoutStatus,
} from "./analytics-semantics";

describe("analytics-semantics", () => {
  it("treats PARTIAL and COMPLETED as performed, but only COMPLETED as completed", () => {
    expect(isAnalyticsPerformedWorkoutStatus("COMPLETED")).toBe(true);
    expect(isAnalyticsPerformedWorkoutStatus("PARTIAL")).toBe(true);
    expect(isAnalyticsPerformedWorkoutStatus("PLANNED")).toBe(false);

    expect(isAnalyticsCompletedWorkoutStatus("COMPLETED")).toBe(true);
    expect(isAnalyticsCompletedWorkoutStatus("PARTIAL")).toBe(false);
  });

  it("counts generated, performed, and completed workouts from one shared status vocabulary", () => {
    expect(
      countAnalyticsWorkoutStatuses(["COMPLETED", "PARTIAL", "SKIPPED", "PLANNED"])
    ).toEqual({
      generated: 4,
      performed: 2,
      completed: 1,
      performedRate: 0.5,
      completionRate: 0.25,
    });
  });

  it("builds explicit rolling and date-range window semantics", () => {
    expect(buildAllTimeAnalyticsWindow("All generated workouts")).toEqual({
      kind: "all_time",
      label: "All generated workouts",
      dateField: "scheduledDate",
    });

    expect(buildRollingDaysAnalyticsWindow(14, "Last 14 days")).toEqual({
      kind: "rolling_days",
      label: "Last 14 days",
      dateField: "scheduledDate",
      days: 14,
      anchor: "today",
    });

    expect(buildRollingIsoWeeksAnalyticsWindow(8, "Rolling 8 ISO weeks")).toEqual({
      kind: "rolling_iso_weeks",
      label: "Rolling 8 ISO weeks",
      dateField: "scheduledDate",
      weeks: 8,
      anchor: "today",
    });

    expect(
      buildDateRangeAnalyticsWindow({
        label: "Selected completed window",
        dateField: "completedAt",
        dateFrom: new Date("2026-03-01T00:00:00.000Z"),
        dateTo: new Date("2026-03-04T00:00:00.000Z"),
      })
    ).toEqual({
      kind: "date_range",
      label: "Selected completed window",
      dateField: "completedAt",
      dateFrom: "2026-03-01T00:00:00.000Z",
      dateTo: "2026-03-04T00:00:00.000Z",
      anchor: "query",
    });
  });
});
