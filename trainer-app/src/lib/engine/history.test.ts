import { describe, expect, it } from "vitest";
import { filterPerformanceHistory, filterPerformedHistory, filterProgressionHistory } from "./history";
import type { WorkoutHistoryEntry } from "./types";

describe("filterPerformedHistory", () => {
  it("excludes malformed legacy entries with completed=true but missing status", () => {
    const history: WorkoutHistoryEntry[] = [
      {
        date: "2026-02-21T00:00:00.000Z",
        completed: true,
        exercises: [],
      },
      {
        date: "2026-02-22T00:00:00.000Z",
        completed: false,
        status: "PARTIAL",
        exercises: [],
      },
    ];

    const filtered = filterPerformedHistory(history);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].status).toBe("PARTIAL");
  });
});

describe("filterProgressionHistory", () => {
  it("keeps supplemental sessions in performed history but excludes them from progression history", () => {
    const history: WorkoutHistoryEntry[] = [
      {
        date: "2026-02-21T00:00:00.000Z",
        completed: true,
        status: "COMPLETED",
        progressionEligible: false,
        exercises: [],
      },
      {
        date: "2026-02-22T00:00:00.000Z",
        completed: true,
        status: "COMPLETED",
        progressionEligible: true,
        exercises: [],
      },
    ];

    expect(filterPerformedHistory(history)).toHaveLength(2);
    expect(filterProgressionHistory(history)).toHaveLength(1);
    expect(filterProgressionHistory(history)[0].date).toBe("2026-02-22T00:00:00.000Z");
  });
});

describe("filterPerformanceHistory", () => {
  it("keeps deload sessions in performed history but excludes them from canonical performance history", () => {
    const history: WorkoutHistoryEntry[] = [
      {
        date: "2026-02-21T00:00:00.000Z",
        completed: true,
        status: "COMPLETED",
        isDeload: true,
        performanceEligible: false,
        exercises: [],
      },
      {
        date: "2026-02-22T00:00:00.000Z",
        completed: true,
        status: "COMPLETED",
        performanceEligible: true,
        exercises: [],
      },
    ];

    expect(filterPerformedHistory(history)).toHaveLength(2);
    expect(filterPerformanceHistory(history)).toHaveLength(1);
    expect(filterPerformanceHistory(history)[0].date).toBe("2026-02-22T00:00:00.000Z");
  });
});
