import { describe, expect, it } from "vitest";
import { buildWorkoutListSurfaceSummary } from "./workout-list-items";

describe("buildWorkoutListSurfaceSummary", () => {
  it("derives session snapshot and logged-set counts from the shared row shape", () => {
    const summary = buildWorkoutListSurfaceSummary({
      id: "workout-1",
      scheduledDate: new Date("2026-03-04T10:00:00.000Z"),
      completedAt: new Date("2026-03-04T11:00:00.000Z"),
      status: "COMPLETED",
      selectionMode: "INTENT",
      sessionIntent: "PUSH",
      mesocycleId: "meso-1",
      mesocycleWeekSnapshot: 3,
      mesoSessionSnapshot: 2,
      mesocyclePhaseSnapshot: "ACCUMULATION",
      _count: { exercises: 2 },
      exercises: [
        {
          sets: [{ _count: { logs: 2 } }, { _count: { logs: 1 } }],
        },
        {
          sets: [{ _count: { logs: 3 } }],
        },
      ],
    });

    expect(summary).toEqual({
      id: "workout-1",
      scheduledDate: "2026-03-04T10:00:00.000Z",
      completedAt: "2026-03-04T11:00:00.000Z",
      status: "COMPLETED",
      selectionMode: "INTENT",
      sessionIntent: "PUSH",
      mesocycleId: "meso-1",
      sessionSnapshot: {
        week: 3,
        session: 2,
        phase: "ACCUMULATION",
      },
      exerciseCount: 2,
      totalSetsLogged: 6,
    });
  });
});
