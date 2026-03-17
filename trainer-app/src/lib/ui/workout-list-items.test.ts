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
      mesocycle: { sessionsPerWeek: 3, state: "ACTIVE_ACCUMULATION", isActive: true },
      _count: { exercises: 2 },
      exercises: [
        {
          sets: [
            { logs: [{ actualReps: 8, actualRpe: 8, actualLoad: 135, wasSkipped: false }] },
            { logs: [{ actualReps: 10, actualRpe: null, actualLoad: 95, wasSkipped: false }] },
            { logs: [{ actualReps: null, actualRpe: null, actualLoad: 95, wasSkipped: false }] },
          ],
        },
        {
          sets: [
            { logs: [{ actualReps: null, actualRpe: null, actualLoad: null, wasSkipped: true }] },
            { logs: [{ actualReps: null, actualRpe: null, actualLoad: null, wasSkipped: false }] },
            { logs: [{ actualReps: null, actualRpe: 7, actualLoad: null, wasSkipped: false }] },
          ],
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
      sessionIdentityLabel: "Push",
      mesocycleId: "meso-1",
      mesocycleState: "ACTIVE_ACCUMULATION",
      mesocycleIsActive: true,
      sessionSnapshot: {
        week: 3,
        session: 2,
        phase: "ACCUMULATION",
      },
      isDeload: false,
      isGapFill: false,
      isSupplementalDeficitSession: false,
      gapFillTargetMuscles: [],
      exerciseCount: 2,
      totalSetsLogged: 3,
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
      mesocycle: { sessionsPerWeek: 3, state: "ACTIVE_ACCUMULATION", isActive: true },
      _count: { exercises: 1 },
      exercises: [{ sets: [] }],
    });

    expect(summary.sessionSnapshot).toEqual({
      week: 3,
      session: 4,
      phase: "ACCUMULATION",
    });
    expect(summary.isDeload).toBe(false);
    expect(summary.isGapFill).toBe(true);
    expect(summary.isSupplementalDeficitSession).toBe(false);
    expect(summary.gapFillTargetMuscles).toEqual(["front delts", "rear delts", "biceps"]);
    expect(getWorkoutListPrimaryLabel(summary)).toBe("Gap Fill");
    expect(getWorkoutListSecondaryLabel(summary)).toBe("Front Delts, Rear Delts, Biceps");
  });

  it("uses slot-aware identity labels when a saved receipt includes a session slot", () => {
    const summary = buildWorkoutListSurfaceSummary({
      id: "workout-upper-2",
      scheduledDate: new Date("2026-03-04T10:00:00.000Z"),
      completedAt: null,
      status: "PLANNED",
      selectionMode: "INTENT",
      sessionIntent: "UPPER",
      mesocycleId: "meso-1",
      mesocycleWeekSnapshot: 2,
      mesoSessionSnapshot: 3,
      mesocyclePhaseSnapshot: "ACCUMULATION",
      selectionMetadata: {
        sessionDecisionReceipt: {
          version: 1,
          cycleContext: {
            weekInMeso: 2,
            weekInBlock: 2,
            phase: "accumulation",
            blockType: "accumulation",
            isDeload: false,
            source: "computed",
          },
          sessionSlot: {
            slotId: "upper_b",
            intent: "upper",
            sequenceIndex: 2,
            sequenceLength: 4,
            source: "mesocycle_slot_sequence",
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
      mesocycle: { sessionsPerWeek: 4, state: "ACTIVE_ACCUMULATION", isActive: true },
      _count: { exercises: 1 },
      exercises: [{ sets: [] }],
    });

    expect(summary.sessionIdentityLabel).toBe("Upper 2");
    expect(getWorkoutListPrimaryLabel(summary)).toBe("Upper 2");
  });

  it("marks strict supplemental deficit sessions without changing body-part primary labeling", () => {
    const summary = buildWorkoutListSurfaceSummary({
      id: "workout-supp",
      scheduledDate: new Date("2026-03-04T10:00:00.000Z"),
      completedAt: null,
      status: "PLANNED",
      selectionMode: "INTENT",
      sessionIntent: "BODY_PART",
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
          targetMuscles: ["rear delts"],
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
          exceptions: [
            {
              code: "supplemental_deficit_session",
              message: "Marked as supplemental deficit session.",
            },
          ],
        },
      },
      mesocycle: { sessionsPerWeek: 3, state: "ACTIVE_ACCUMULATION", isActive: true },
      _count: { exercises: 1 },
      exercises: [{ sets: [] }],
    });

    expect(summary.isGapFill).toBe(false);
    expect(summary.isSupplementalDeficitSession).toBe(true);
    expect(getWorkoutListPrimaryLabel(summary)).toBe("Body Part");
  });

  it("marks deload sessions explicitly for history and recent-workout surfaces", () => {
    const summary = buildWorkoutListSurfaceSummary({
      id: "workout-deload",
      scheduledDate: new Date("2026-03-04T10:00:00.000Z"),
      completedAt: new Date("2026-03-04T11:00:00.000Z"),
      status: "COMPLETED",
      selectionMode: "INTENT",
      sessionIntent: "PULL",
      mesocycleId: "meso-1",
      mesocycleWeekSnapshot: 5,
      mesoSessionSnapshot: 2,
      mesocyclePhaseSnapshot: "DELOAD",
      selectionMetadata: {
        sessionDecisionReceipt: {
          version: 1,
          cycleContext: {
            weekInMeso: 5,
            weekInBlock: 1,
            phase: "deload",
            blockType: "deload",
            isDeload: true,
            source: "computed",
          },
          lifecycleVolume: { source: "unknown" },
          sorenessSuppressedMuscles: [],
          deloadDecision: {
            mode: "scheduled",
            reason: ["Scheduled deload week for this cycle phase."],
            reductionPercent: 50,
            appliedTo: "both",
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
      mesocycle: { sessionsPerWeek: 3, state: "ACTIVE_DELOAD", isActive: true },
      _count: { exercises: 1 },
      exercises: [{ sets: [] }],
    });

    expect(summary.isDeload).toBe(true);
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
