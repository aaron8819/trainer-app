import { describe, expect, it } from "vitest";
import { buildWorkoutExecutionSummary } from "./workout-execution-summary";

describe("buildWorkoutExecutionSummary", () => {
  it("counts planned sets as planned when they were skipped", () => {
    const summary = buildWorkoutExecutionSummary([
      {
        sets: [
          { wasLogged: true, wasSkipped: true },
          { wasLogged: true, wasSkipped: true },
          { wasLogged: true, wasSkipped: true },
        ],
      },
    ]);

    expect(summary).toEqual({
      plannedSetCount: 3,
      completedSetCount: 0,
      skippedSetCount: 3,
      extraSetCount: 0,
    });
  });

  it("keeps completed and skipped planned sets separate", () => {
    const summary = buildWorkoutExecutionSummary([
      {
        sets: [
          { wasLogged: true, wasSkipped: false },
          { wasLogged: true, wasSkipped: false },
          { wasLogged: true, wasSkipped: true },
          { wasLogged: true, wasSkipped: true },
        ],
      },
    ]);

    expect(summary).toEqual({
      plannedSetCount: 4,
      completedSetCount: 2,
      skippedSetCount: 2,
      extraSetCount: 0,
    });
  });

  it("counts performed runtime-added sets as completed extras without inflating planned sets", () => {
    const summary = buildWorkoutExecutionSummary([
      {
        sets: [
          { wasLogged: true, wasSkipped: false },
          { wasLogged: true, wasSkipped: false },
        ],
      },
      {
        isRuntimeAdded: true,
        sets: [
          { wasLogged: true, wasSkipped: false },
          { wasLogged: true, wasSkipped: false },
          { wasLogged: true, wasSkipped: false },
        ],
      },
      {
        sets: [
          { isRuntimeAdded: true, wasLogged: true, wasSkipped: false },
          { isRuntimeAdded: true, wasLogged: false, wasSkipped: false },
        ],
      },
    ]);

    expect(summary).toEqual({
      plannedSetCount: 2,
      completedSetCount: 6,
      skippedSetCount: 0,
      extraSetCount: 4,
    });
  });

  it("counts fully skipped exercises without treating them as completed", () => {
    const summary = buildWorkoutExecutionSummary([
      {
        sets: [
          { wasLogged: true, wasSkipped: true },
          { wasLogged: true, wasSkipped: true },
        ],
      },
      {
        sets: [
          { wasLogged: true, wasSkipped: false },
        ],
      },
    ]);

    expect(summary).toEqual({
      plannedSetCount: 3,
      completedSetCount: 1,
      skippedSetCount: 2,
      extraSetCount: 0,
    });
  });
});
