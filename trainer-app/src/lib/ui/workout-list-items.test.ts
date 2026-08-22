import { describe, expect, it } from "vitest";
import {
  buildWorkoutListSurfaceSummary,
  formatWorkoutListExerciseLabel,
  formatWorkoutListIntentLabel,
  formatWorkoutListLoggedSetsLabel,
  getWorkoutListDisplayStatusLabel,
  getWorkoutListPrimaryLabel,
  getWorkoutListSecondaryLabel,
  getWorkoutListStatusClasses,
  getWorkoutListStatusLabel,
} from "./workout-list-items";
import { formatWorkoutSessionSnapshotLabel } from "./workout-session-snapshot";

const V4_SLOT_SEQUENCE = {
  version: 1,
  source: "handoff_draft",
  sequenceMode: "ordered_flexible",
  slots: [
    { slotId: "lower-a", intent: "LOWER", label: "Lower A" },
    { slotId: "upper-a", intent: "UPPER", label: "Upper A" },
    { slotId: "lower-b", intent: "LOWER", label: "Lower B" },
    { slotId: "upper-b", intent: "UPPER", label: "Upper B" },
  ],
} as const;

function buildSessionLabelSummary(input: {
  slotId?: string | null;
  intent: "LOWER" | "UPPER";
  status?: "COMPLETED" | "PARTIAL" | "SKIPPED" | "PLANNED";
  slotSequenceJson?: unknown;
  hasMesocycle?: boolean;
}) {
  const slotId = input.slotId ?? null;
  const normalizedIntent = input.intent.toLowerCase() as "lower" | "upper";

  return buildWorkoutListSurfaceSummary({
    id: `workout-${slotId ?? normalizedIntent}`,
    revision: 1,
    scheduledDate: new Date("2026-08-20T10:00:00.000Z"),
    completedAt: new Date("2026-08-20T11:00:00.000Z"),
    status: input.status ?? "COMPLETED",
    selectionMode: "INTENT",
    sessionIntent: input.intent,
    mesocycleId: input.hasMesocycle === false ? null : "meso-v4",
    mesocycleWeekSnapshot: 5,
    mesoSessionSnapshot: 4,
    mesocyclePhaseSnapshot: "ACCUMULATION",
    selectionMetadata: {
      sessionDecisionReceipt: {
        version: 1,
        cycleContext: {
          weekInMeso: 5,
          weekInBlock: 1,
          phase: "accumulation",
          blockType: "accumulation",
          isDeload: false,
          source: "computed",
        },
        ...(slotId
          ? {
              sessionSlot: {
                slotId,
                intent: normalizedIntent,
                sequenceIndex: 0,
                sequenceLength: 4,
                source: "mesocycle_slot_sequence",
              },
            }
          : {}),
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
    mesocycle:
      input.hasMesocycle === false
        ? null
        : {
            macroCycleId: "plan-v4",
            sessionsPerWeek: 4,
            slotSequenceJson: (input.slotSequenceJson === undefined
              ? V4_SLOT_SEQUENCE
              : input.slotSequenceJson) as never,
            state: "ACTIVE_ACCUMULATION",
            isActive: true,
          },
    _count: { exercises: 0 },
    exercises: [],
  });
}

describe("buildWorkoutListSurfaceSummary", () => {
  it("derives session data and clears resumability for a switched-away plan", () => {
    const summary = buildWorkoutListSurfaceSummary({
      id: "workout-1",
      revision: 1,
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
      mesocycle: { macroCycleId: "plan-a", sessionsPerWeek: 3, slotSequenceJson: null, state: "ACTIVE_ACCUMULATION", isActive: true },
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
    }, { activeMacroCycleId: "plan-b" });

    expect(summary).toEqual({
      id: "workout-1",
      revision: 1,
      scheduledDate: "2026-03-04T10:00:00.000Z",
      completedAt: "2026-03-04T11:00:00.000Z",
      status: "COMPLETED",
      selectionMode: "INTENT",
      sessionIntent: "PUSH",
      sessionIdentityLabel: "Push",
      sessionSlotId: null,
      sessionTechnicalLabel: null,
      mesocycleId: "meso-1",
      mesocycleState: "ACTIVE_ACCUMULATION",
      mesocycleIsActive: false,
      sessionSnapshot: {
        week: 3,
        session: 2,
        phase: "ACCUMULATION",
      },
      isDeload: false,
      isGapFill: false,
      isCloseout: false,
      isCloseoutDismissed: false,
      isSupplementalDeficitSession: false,
      gapFillTargetMuscles: [],
      exerciseCount: 2,
      totalSetsLogged: 3,
    });
  });

  it("uses persisted gap-fill session snapshot and labels from canonical receipt", () => {
    const summary = buildWorkoutListSurfaceSummary({
      id: "workout-gap",
      revision: 1,
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
      mesocycle: { macroCycleId: "plan-a", sessionsPerWeek: 3, slotSequenceJson: null, state: "ACTIVE_ACCUMULATION", isActive: true },
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
    expect(summary.isCloseout).toBe(false);
    expect(summary.isCloseoutDismissed).toBe(false);
    expect(summary.isSupplementalDeficitSession).toBe(false);
    expect(summary.gapFillTargetMuscles).toEqual(["front delts", "rear delts", "biceps"]);
    expect(getWorkoutListPrimaryLabel(summary)).toBe("Gap Fill");
    expect(getWorkoutListSecondaryLabel(summary)).toBe("Front Delts, Rear Delts, Biceps");
  });

  it("labels closeout sessions explicitly and ignores stale slot identity for list surfaces", () => {
    const summary = buildWorkoutListSurfaceSummary({
      id: "workout-closeout",
      revision: 1,
      scheduledDate: new Date("2026-03-04T10:00:00.000Z"),
      completedAt: null,
      status: "PLANNED",
      selectionMode: "MANUAL",
      sessionIntent: null,
      mesocycleId: "meso-1",
      mesocycleWeekSnapshot: 3,
      mesoSessionSnapshot: 4,
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
          sessionSlot: {
            slotId: "upper_a",
            intent: "upper",
            sequenceIndex: 0,
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
          exceptions: [
            {
              code: "closeout_session",
              message: "Marked as closeout session.",
            },
          ],
        },
      },
      mesocycle: { macroCycleId: "plan-a", sessionsPerWeek: 3, slotSequenceJson: null, state: "ACTIVE_ACCUMULATION", isActive: true },
      _count: { exercises: 1 },
      exercises: [{ sets: [] }],
    });

    expect(summary.isCloseout).toBe(true);
    expect(summary.isCloseoutDismissed).toBe(false);
    expect(summary.sessionSlotId).toBeNull();
    expect(summary.sessionTechnicalLabel).toBeNull();
    expect(getWorkoutListPrimaryLabel(summary)).toBe("Manual session");
    expect(getWorkoutListSecondaryLabel(summary)).toBe("Optional manual session");
  });

  it("labels dismissed closeouts without changing the persisted workout status", () => {
    const summary = buildWorkoutListSurfaceSummary({
      id: "workout-closeout",
      revision: 1,
      scheduledDate: new Date("2026-03-04T10:00:00.000Z"),
      completedAt: null,
      status: "PLANNED",
      selectionMode: "MANUAL",
      sessionIntent: null,
      mesocycleId: "meso-1",
      mesocycleWeekSnapshot: 3,
      mesoSessionSnapshot: 4,
      mesocyclePhaseSnapshot: "ACCUMULATION",
      selectionMetadata: {
        closeoutDismissed: true,
        closeoutDismissedAt: "2026-04-09T12:00:00.000Z",
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
          exceptions: [
            {
              code: "closeout_session",
              message: "Marked as closeout session.",
            },
          ],
        },
      },
      mesocycle: { macroCycleId: "plan-a", sessionsPerWeek: 3, slotSequenceJson: null, state: "ACTIVE_ACCUMULATION", isActive: true },
      _count: { exercises: 1 },
      exercises: [{ sets: [] }],
    });

    expect(summary.status).toBe("PLANNED");
    expect(summary.isCloseout).toBe(true);
    expect(summary.isCloseoutDismissed).toBe(true);
    expect(getWorkoutListPrimaryLabel(summary)).toBe("Manual session");
    expect(getWorkoutListSecondaryLabel(summary)).toBe("Dismissed optional session");
    expect(getWorkoutListDisplayStatusLabel(summary)).toBe("Dismissed");
  });

  it("uses slot-aware identity labels when a saved receipt includes a session slot", () => {
    const summary = buildWorkoutListSurfaceSummary({
      id: "workout-upper-2",
      revision: 1,
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
      mesocycle: { macroCycleId: "plan-a", sessionsPerWeek: 4, slotSequenceJson: null, state: "ACTIVE_ACCUMULATION", isActive: true },
      _count: { exercises: 1 },
      exercises: [{ sets: [] }],
    });

    expect(summary.sessionIdentityLabel).toBe("Upper 2");
    expect(summary.sessionSlotId).toBe("upper_b");
    expect(summary.sessionTechnicalLabel).toBeNull();
    expect(getWorkoutListPrimaryLabel(summary)).toBe("Upper 2");
  });

  it("marks strict supplemental deficit sessions without changing body-part primary labeling", () => {
    const summary = buildWorkoutListSurfaceSummary({
      id: "workout-supp",
      revision: 1,
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
      mesocycle: { macroCycleId: "plan-a", sessionsPerWeek: 3, slotSequenceJson: null, state: "ACTIVE_ACCUMULATION", isActive: true },
      _count: { exercises: 1 },
      exercises: [{ sets: [] }],
    });

    expect(summary.isGapFill).toBe(false);
    expect(summary.isCloseout).toBe(false);
    expect(summary.isCloseoutDismissed).toBe(false);
    expect(summary.isSupplementalDeficitSession).toBe(true);
    expect(getWorkoutListPrimaryLabel(summary)).toBe("Body Part");
  });

  it("marks deload sessions explicitly for history and recent-workout surfaces", () => {
    const summary = buildWorkoutListSurfaceSummary({
      id: "workout-deload",
      revision: 1,
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
      mesocycle: { macroCycleId: "plan-a", sessionsPerWeek: 3, slotSequenceJson: null, state: "ACTIVE_DELOAD", isActive: true },
      _count: { exercises: 1 },
      exercises: [{ sets: [] }],
    });

    expect(summary.isDeload).toBe(true);
  });

  it.each([
    ["lower-a", "LOWER", "COMPLETED", "Lower A"],
    ["upper-a", "UPPER", "PARTIAL", "Upper A"],
    ["lower-b", "LOWER", "PLANNED", "Lower B"],
    ["upper-b", "UPPER", "SKIPPED", "Upper B"],
  ] as const)(
    "projects the persisted V4 authored label for %s",
    (slotId, intent, status, expectedLabel) => {
      const summary = buildSessionLabelSummary({ slotId, intent, status });

      expect(summary.sessionIdentityLabel).toBe(expectedLabel);
      expect(summary.status).toBe(status);
      expect(summary.sessionSlotId).toBe(slotId);
    },
  );

  it("prefers an authored label over both intent and legacy ordinal fallbacks", () => {
    const summary = buildSessionLabelSummary({
      slotId: "lower_b",
      intent: "LOWER",
      slotSequenceJson: {
        version: 1,
        source: "handoff_draft",
        sequenceMode: "ordered_flexible",
        slots: [{ slotId: "lower_b", intent: "LOWER", label: "Lower B" }],
      },
    });

    expect(summary.sessionIdentityLabel).toBe("Lower B");
  });

  it.each([
    ["lower_b", "LOWER", "Lower 2"],
    ["upper_b", "UPPER", "Upper 2"],
  ] as const)(
    "preserves the legacy ordinal fallback for %s without an authored label",
    (slotId, intent, expectedLabel) => {
      const summary = buildSessionLabelSummary({
        slotId,
        intent,
        slotSequenceJson: null,
      });

      expect(summary.sessionIdentityLabel).toBe(expectedLabel);
    },
  );

  it.each([
    ["LOWER", "Lower"],
    ["UPPER", "Upper"],
  ] as const)("keeps the generic %s intent fallback", (intent, expectedLabel) => {
    const summary = buildSessionLabelSummary({ intent, slotId: null });

    expect(summary.sessionIdentityLabel).toBe(expectedLabel);
  });

  it.each([
    ["missing sequence", null, true],
    ["malformed sequence", { version: 1, slots: "invalid" }, true],
    ["missing mesocycle", V4_SLOT_SEQUENCE, false],
  ] as const)("fails safely for a %s", (_case, slotSequenceJson, hasMesocycle) => {
    const summary = buildSessionLabelSummary({
      slotId: "lower-a",
      intent: "LOWER",
      slotSequenceJson,
      hasMesocycle,
    });

    expect(summary.sessionIdentityLabel).toBe("Lower");
  });

  it("keeps skipped workout identity and week/session subtitle independent", () => {
    const summary = buildSessionLabelSummary({
      slotId: "upper-b",
      intent: "UPPER",
      status: "SKIPPED",
    });

    expect(summary.sessionIdentityLabel).toBe("Upper B");
    expect(formatWorkoutSessionSnapshotLabel(summary.sessionSnapshot)).toBe("Wk5·S4");
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
