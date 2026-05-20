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
      uncoveredSkippedSetCount: 3,
      extraSetCount: 0,
      duplicateCoveredSkippedSetCount: 0,
      duplicateAddedExercises: [],
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
      uncoveredSkippedSetCount: 2,
      extraSetCount: 0,
      duplicateCoveredSkippedSetCount: 0,
      duplicateAddedExercises: [],
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
      uncoveredSkippedSetCount: 0,
      extraSetCount: 4,
      duplicateCoveredSkippedSetCount: 0,
      duplicateAddedExercises: [],
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
      uncoveredSkippedSetCount: 2,
      extraSetCount: 0,
      duplicateCoveredSkippedSetCount: 0,
      duplicateAddedExercises: [],
    });
  });

  it("classifies skipped planned sets covered by performed runtime-added same-exercise work", () => {
    const summary = buildWorkoutExecutionSummary([
      {
        exerciseId: "rear-delt-fly",
        name: "Cable Rear Delt Fly",
        sets: [
          { wasLogged: true, wasSkipped: true },
          { wasLogged: true, wasSkipped: true },
        ],
      },
      {
        exerciseId: "rear-delt-fly",
        name: "Cable Rear Delt Fly",
        isRuntimeAdded: true,
        sets: [
          { wasLogged: true, wasSkipped: false },
          { wasLogged: true, wasSkipped: false },
          { wasLogged: true, wasSkipped: false },
        ],
      },
    ]);

    expect(summary).toEqual({
      plannedSetCount: 2,
      completedSetCount: 3,
      skippedSetCount: 2,
      uncoveredSkippedSetCount: 0,
      extraSetCount: 3,
      duplicateCoveredSkippedSetCount: 2,
      duplicateAddedExercises: [
        {
          exerciseId: "rear-delt-fly",
          exerciseName: "Cable Rear Delt Fly",
          plannedSkippedSetCount: 2,
          addedPerformedSetCount: 3,
          coveredSkippedSetCount: 2,
        },
      ],
    });
  });

  it("does not classify different added exercises as same-exercise duplicate coverage", () => {
    const summary = buildWorkoutExecutionSummary([
      {
        exerciseId: "rear-delt-fly",
        name: "Cable Rear Delt Fly",
        sets: [{ wasLogged: true, wasSkipped: true }],
      },
      {
        exerciseId: "face-pull",
        name: "Cable Face Pull",
        isRuntimeAdded: true,
        sets: [{ wasLogged: true, wasSkipped: false }],
      },
    ]);

    expect(summary.uncoveredSkippedSetCount).toBe(1);
    expect(summary.duplicateAddedExercises).toEqual([]);
  });

  it("falls back to exercise name for legacy summaries without canonical exercise ids", () => {
    const summary = buildWorkoutExecutionSummary([
      {
        name: "Cable Rear Delt Fly",
        sets: [{ wasLogged: true, wasSkipped: true }],
      },
      {
        name: " cable   rear delt fly ",
        isRuntimeAdded: true,
        sets: [{ wasLogged: true, wasSkipped: false }],
      },
    ]);

    expect(summary.uncoveredSkippedSetCount).toBe(0);
    expect(summary.duplicateAddedExercises).toEqual([
      expect.objectContaining({
        exerciseName: "Cable Rear Delt Fly",
        coveredSkippedSetCount: 1,
      }),
    ]);
  });

  it("does not classify normally performed planned work as duplicate coverage", () => {
    const summary = buildWorkoutExecutionSummary([
      {
        exerciseId: "rear-delt-fly",
        name: "Cable Rear Delt Fly",
        sets: [{ wasLogged: true, wasSkipped: false }],
      },
      {
        exerciseId: "rear-delt-fly",
        name: "Cable Rear Delt Fly",
        isRuntimeAdded: true,
        sets: [{ wasLogged: true, wasSkipped: false }],
      },
    ]);

    expect(summary.skippedSetCount).toBe(0);
    expect(summary.uncoveredSkippedSetCount).toBe(0);
    expect(summary.duplicateAddedExercises).toEqual([]);
  });
});
