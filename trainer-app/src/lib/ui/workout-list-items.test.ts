import { describe, expect, it } from "vitest";
import {
  buildWorkoutListSurfaceSummary,
  formatWorkoutListExerciseLabel,
  formatWorkoutListIntentLabel,
  formatWorkoutListLoggedSetsLabel,
  getWorkoutListStatusClasses,
  getWorkoutListStatusLabel,
} from "./workout-list-items";

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

describe("workout-list display helpers", () => {
  it("formats intent labels consistently across recent and history surfaces", () => {
    expect(formatWorkoutListIntentLabel("FULL_BODY")).toBe("Full Body");
    expect(formatWorkoutListIntentLabel("push")).toBe("Push");
    expect(formatWorkoutListIntentLabel(null)).toBe("Workout");
  });

  it("formats status labels and classes from one shared mapping", () => {
    expect(getWorkoutListStatusLabel("IN_PROGRESS")).toBe("In progress");
    expect(getWorkoutListStatusClasses("PARTIAL")).toBe("bg-orange-50 text-orange-700");
    expect(getWorkoutListStatusClasses("UNKNOWN")).toBe("bg-slate-100 text-slate-600");
  });

  it("formats exercise and logged-set copy consistently", () => {
    expect(formatWorkoutListExerciseLabel(1)).toBe("1 exercise");
    expect(formatWorkoutListExerciseLabel(3)).toBe("3 exercises");
    expect(formatWorkoutListLoggedSetsLabel(1)).toBe("1 set logged");
    expect(formatWorkoutListLoggedSetsLabel(4)).toBe("4 sets logged");
  });
});
