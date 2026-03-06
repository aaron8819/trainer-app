import { describe, expect, it } from "vitest";
import {
  buildWorkoutListSurfaceSummary,
  formatWorkoutListExerciseLabel,
  formatWorkoutListIntentLabel,
  formatWorkoutListLoggedSetsLabel,
  getWorkoutListPrimaryLabel,
  getWorkoutListSecondaryLabel,
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
      selectionMetadata: {
        sessionDecisionReceipt: {
          version: 1,
          cycleContext: {
            weekInMeso: 3,
            weekInBlock: 3,
            phase: "accumulation",
            blockType: "accumulation",
            isDeload: false,
            source: "computed",
          },
          lifecycleVolume: { source: "unknown" },
          sorenessSuppressedMuscles: [],
          deloadDecision: {
            mode: "none",
            reason: [],
            reductionPercent: 0,
            appliedTo: "none",
          },
          readiness: {
            wasAutoregulated: false,
            signalAgeHours: null,
            fatigueScoreOverall: null,
            intensityScaling: {
              applied: false,
              exerciseIds: [],
              scaledUpCount: 0,
              scaledDownCount: 0,
            },
          },
          exceptions: [],
        },
      },
      mesocycle: { sessionsPerWeek: 3 },
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
      isGapFill: false,
      gapFillTargetMuscles: [],
      exerciseCount: 2,
      totalSetsLogged: 6,
    });
  });

  it("uses persisted gap-fill session snapshot and labels from canonical receipt", () => {
    const summary = buildWorkoutListSurfaceSummary({
      id: "workout-gap",
      scheduledDate: new Date("2026-03-04T10:00:00.000Z"),
      completedAt: null,
      status: "PLANNED",
      selectionMode: "INTENT",
      sessionIntent: "BODY_PART",
      mesocycleId: "meso-1",
      mesocycleWeekSnapshot: 3,
      mesoSessionSnapshot: 4,
      mesocyclePhaseSnapshot: "ACCUMULATION",
      selectionMetadata: {
        sessionDecisionReceipt: {
          version: 1,
          cycleContext: {
            weekInMeso: 4,
            weekInBlock: 1,
            phase: "accumulation",
            blockType: "accumulation",
            isDeload: false,
            source: "computed",
          },
          targetMuscles: ["front delts", "rear delts", "biceps"],
          lifecycleVolume: { source: "unknown" },
          sorenessSuppressedMuscles: [],
          deloadDecision: {
            mode: "none",
            reason: [],
            reductionPercent: 0,
            appliedTo: "none",
          },
          readiness: {
            wasAutoregulated: false,
            signalAgeHours: null,
            fatigueScoreOverall: null,
            intensityScaling: {
              applied: false,
              exerciseIds: [],
              scaledUpCount: 0,
              scaledDownCount: 0,
            },
          },
          exceptions: [{ code: "optional_gap_fill", message: "Marked as optional gap-fill session." }],
        },
      },
      mesocycle: { sessionsPerWeek: 3 },
      _count: { exercises: 1 },
      exercises: [{ sets: [] }],
    });

    expect(summary.sessionSnapshot).toEqual({
      week: 3,
      session: 4,
      phase: "ACCUMULATION",
    });
    expect(summary.isGapFill).toBe(true);
    expect(summary.gapFillTargetMuscles).toEqual(["front delts", "rear delts", "biceps"]);
    expect(getWorkoutListPrimaryLabel(summary)).toBe("Gap Fill");
    expect(getWorkoutListSecondaryLabel(summary)).toBe("Front Delts, Rear Delts, Biceps");
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
