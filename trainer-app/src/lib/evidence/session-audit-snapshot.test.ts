import { describe, expect, it } from "vitest";

import {
  attachSessionAuditSnapshotToSelectionMetadata,
  buildGeneratedSessionAuditSnapshot,
  buildSessionAuditMutationSummary,
  buildSavedSessionAuditSnapshot,
  readSessionAuditSnapshot,
} from "./session-audit-snapshot";
import type { SessionDecisionReceipt } from "./types";
import type { WorkoutPlan } from "@/lib/engine/types";

const baseReceipt: SessionDecisionReceipt = {
  version: 1,
  cycleContext: {
    weekInMeso: 4,
    weekInBlock: 4,
    phase: "accumulation",
    blockType: "accumulation",
    isDeload: false,
    source: "computed",
  },
  lifecycleVolume: {
    source: "unknown",
  },
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
};

const workout = {
  id: "workout-1",
  scheduledDate: "2026-03-10T00:00:00.000Z",
  warmup: [],
  mainLifts: [
    {
      id: "bench-entry",
      exercise: {
        id: "bench",
        name: "Bench Press",
      },
      orderIndex: 0,
      isMainLift: true,
      role: "main" as const,
      sets: [
        {
          setIndex: 1,
          targetReps: 8,
          targetRpe: 8,
          targetLoad: 200,
          role: "main" as const,
        },
      ],
    },
  ],
  accessories: [],
  estimatedMinutes: 45,
} as unknown as WorkoutPlan;

describe("session-audit-snapshot", () => {
  it("builds generated and saved snapshot layers for the same workout", () => {
    const generated = buildGeneratedSessionAuditSnapshot({
      workout,
      selectionMode: "INTENT",
      sessionIntent: "PUSH",
      selectionMetadata: {
        sessionDecisionReceipt: baseReceipt,
      },
      advancesSplit: true,
      progressionTraces: {
        bench: {
          version: 1,
          decisionSource: "double_progression",
          repRange: { min: 6, max: 8 },
          equipment: "barbell",
          anchor: {
            source: "working_set",
            workingSetApplied: true,
            anchorLoad: 200,
            signalSetCount: 3,
            effectiveSetCount: 3,
            trimmedSetCount: 0,
            highVarianceDetected: false,
            minSignalLoad: 200,
            maxSignalLoad: 200,
            medianSignalLoad: 200,
          },
          confidence: {
            priorSessionCount: 3,
            sampleScale: 1,
            historyScale: 1,
            combinedScale: 1,
            reasons: [],
          },
          metrics: {
            medianReps: 8,
            modalRpe: 8,
            nextLoad: 205,
            loadDelta: 5,
          },
          outcome: {
            path: "path_3",
            action: "increase",
            reasonCodes: ["top_of_range_reached", "moderate_effort_progression"],
          },
          decisionLog: ["Path 3 fired"],
        },
      },
    });

    const saved = buildSavedSessionAuditSnapshot({
      selectionMetadata: attachSessionAuditSnapshotToSelectionMetadata(
        { sessionDecisionReceipt: baseReceipt },
        generated
      ),
      workoutId: "workout-1",
      revision: 2,
      status: "COMPLETED",
      advancesSplit: true,
      selectionMode: "INTENT",
      sessionIntent: "PUSH",
      mesocycleId: "meso-1",
      mesocycleWeekSnapshot: 4,
      mesoSessionSnapshot: 2,
      mesocyclePhaseSnapshot: "ACCUMULATION",
    });

    expect(saved.generated?.exerciseCount).toBe(1);
    expect(saved.generated?.traces.progression.bench.metrics.nextLoad).toBe(205);
    expect(saved.saved).toMatchObject({
      workoutId: "workout-1",
      revision: 2,
      status: "COMPLETED",
      advancesSplit: true,
    });
  });

  it("normalizes legacy progression trace vocabulary when reading persisted snapshots", () => {
    const snapshot = readSessionAuditSnapshot({
      sessionAuditSnapshot: {
        version: 1,
        generated: {
          selectionMode: "INTENT",
          sessionIntent: "PUSH",
          semantics: {
            kind: "advancing",
            effectiveSelectionMode: "INTENT",
            isDeload: false,
            isStrictGapFill: false,
            isStrictSupplemental: false,
            advancesLifecycle: true,
            consumesWeeklyScheduleIntent: true,
            countsTowardCompliance: true,
            countsTowardRecentStimulus: true,
            countsTowardWeeklyVolume: true,
            countsTowardProgressionHistory: true,
            countsTowardPerformanceHistory: true,
            updatesProgressionAnchor: true,
            eligibleForUniqueIntentSubtraction: true,
            reasons: [],
            trace: {
              advancesSplitInput: true,
            },
          },
          exerciseCount: 0,
          hardSetCount: 0,
          exercises: [],
          traces: {
            progression: {
              bench: {
                version: 1,
                decisionSource: "double_progression",
                repRange: { min: 6, max: 8 },
                equipment: "barbell",
                anchor: {
                  source: "top_set_override",
                  overrideApplied: true,
                  anchorLoad: 200,
                  signalSetCount: 3,
                  effectiveSetCount: 3,
                  trimmedSetCount: 0,
                  highVarianceDetected: false,
                  minSignalLoad: 200,
                  maxSignalLoad: 200,
                  medianSignalLoad: 200,
                },
                confidence: {
                  priorSessionCount: 3,
                  sampleScale: 1,
                  historyScale: 1,
                  combinedScale: 1,
                  reasons: [],
                },
                metrics: {
                  medianReps: 8,
                  modalRpe: 8,
                  nextLoad: 205,
                  loadDelta: 5,
                },
                outcome: {
                  path: "path_3",
                  action: "increase",
                  reasonCodes: ["top_of_range_reached", "anchor_override_applied"],
                },
                decisionLog: ["Path 3 fired"],
              },
            },
          },
        },
      },
    });

    expect(snapshot?.generated?.traces.progression.bench.anchor).toMatchObject({
      source: "working_set",
      workingSetApplied: true,
    });
    expect(snapshot?.generated?.traces.progression.bench.outcome.reasonCodes).toContain(
      "working_set_anchor_applied"
    );
  });

  it("emits gap-fill and supplemental semantics traces from canonical markers", () => {
    const gapFillMetadata = {
      sessionDecisionReceipt: {
        ...baseReceipt,
        exceptions: [
          {
            code: "optional_gap_fill" as const,
            message: "Marked as optional gap-fill session.",
          },
        ],
      },
    };
    const supplementalMetadata = {
      sessionDecisionReceipt: {
        ...baseReceipt,
        exceptions: [
          {
            code: "supplemental_deficit_session" as const,
            message: "Marked as supplemental deficit session.",
          },
        ],
      },
    };

    const gapFill = buildGeneratedSessionAuditSnapshot({
      workout,
      selectionMode: "INTENT",
      sessionIntent: "BODY_PART",
      selectionMetadata: gapFillMetadata,
      advancesSplit: false,
    });
    const supplemental = buildGeneratedSessionAuditSnapshot({
      workout,
      selectionMode: "INTENT",
      sessionIntent: "BODY_PART",
      selectionMetadata: supplementalMetadata,
      advancesSplit: false,
    });

    expect(gapFill.generated?.semantics.kind).toBe("gap_fill");
    expect(gapFill.generated?.semantics.reasons.map((reason) => reason.code)).toContain(
      "strict_gap_fill_marker"
    );
    expect(gapFill.generated?.semantics.reasons.map((reason) => reason.code)).toContain(
      "advances_split_false"
    );

    expect(supplemental.generated?.semantics.kind).toBe("supplemental");
    expect(supplemental.generated?.semantics.countsTowardProgressionHistory).toBe(false);
    expect(
      supplemental.generated?.semantics.reasons.map((reason) => reason.code)
    ).toContain("progression_history_excluded_for_supplemental");

    const stored = attachSessionAuditSnapshotToSelectionMetadata(
      supplementalMetadata,
      supplemental
    );
    expect(readSessionAuditSnapshot(stored)?.generated?.semantics.kind).toBe("supplemental");
  });

  it("summarizes generated-vs-saved drift without mutating the snapshot layers", () => {
    const generated = buildGeneratedSessionAuditSnapshot({
      workout,
      selectionMode: "INTENT",
      sessionIntent: "PUSH",
      selectionMetadata: {
        sessionDecisionReceipt: baseReceipt,
      },
      advancesSplit: true,
    });
    const savedSelectionMetadata = attachSessionAuditSnapshotToSelectionMetadata(
      {
        sessionDecisionReceipt: {
          ...baseReceipt,
          cycleContext: {
            ...baseReceipt.cycleContext,
            phase: "deload",
            blockType: "deload",
            isDeload: true,
          },
          deloadDecision: {
            mode: "scheduled",
            reason: ["deload"],
            reductionPercent: 50,
            appliedTo: "both",
          },
        },
      },
      generated
    );
    const saved = buildSavedSessionAuditSnapshot({
      selectionMetadata: savedSelectionMetadata,
      workoutId: "workout-1",
      status: "COMPLETED",
      advancesSplit: false,
      selectionMode: "MANUAL",
      sessionIntent: "PULL",
      mesocyclePhaseSnapshot: "DELOAD",
    });

    const mutation = buildSessionAuditMutationSummary({
      snapshot: saved,
      savedSelectionMode: "MANUAL",
      savedSessionIntent: "PULL",
      persistedExercises: [
        {
          exerciseId: "bench",
          exercise: { name: "Bench Press" },
          orderIndex: 0,
          section: "MAIN",
          isMainLift: true,
          role: "main",
          sets: [
            {
              setIndex: 1,
              targetReps: 6,
              targetRpe: 8,
              targetLoad: 205,
              role: "main",
            },
          ],
        },
        {
          exerciseId: "curl",
          exercise: { name: "Curl" },
          orderIndex: 1,
          section: "ACCESSORY",
          isMainLift: false,
          role: "accessory",
          sets: [{ setIndex: 1, targetReps: 12, targetLoad: 25 }],
        },
      ],
    });

    expect(mutation.comparisonState).toBe("comparable");
    expect(mutation.hasDrift).toBe(true);
    expect(mutation.changedFields).toEqual(
      expect.arrayContaining([
        "selection_mode",
        "session_intent",
        "semantics_kind",
        "progression_history_eligibility",
        "exercise_added",
        "exercise_prescription_changed",
      ])
    );
    expect(mutation.addedExerciseIds).toEqual(["curl"]);
    expect(mutation.exercisesWithPrescriptionChanges).toEqual(["bench"]);
    expect(saved.generated?.sessionIntent).toBe("PUSH");
    expect(saved.saved?.status).toBe("COMPLETED");
  });
});
