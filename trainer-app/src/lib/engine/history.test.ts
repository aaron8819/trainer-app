import { describe, expect, it } from "vitest";
import { filterPerformedHistory } from "./history";
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
