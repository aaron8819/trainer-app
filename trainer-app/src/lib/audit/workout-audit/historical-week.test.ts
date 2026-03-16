import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const workoutFindMany = vi.fn();
  const mesocycleWeekCloseFindMany = vi.fn();
  return {
    workoutFindMany,
    mesocycleWeekCloseFindMany,
    prisma: {
      workout: {
        findMany: workoutFindMany,
      },
      mesocycleWeekClose: {
        findMany: mesocycleWeekCloseFindMany,
      },
    },
  };
});

vi.mock("@/lib/db/prisma", () => ({
  prisma: mocks.prisma,
}));

import {
  attachSessionAuditSnapshotToSelectionMetadata,
  buildGeneratedSessionAuditSnapshot,
  buildSavedSessionAuditSnapshot,
} from "@/lib/evidence/session-audit-snapshot";
import type { SessionDecisionReceipt } from "@/lib/evidence/types";
import type { WorkoutPlan } from "@/lib/engine/types";
import { buildHistoricalWeekAuditPayload } from "./historical-week";

const receipt: SessionDecisionReceipt = {
  version: 1,
  cycleContext: {
    weekInMeso: 4,
    weekInBlock: 4,
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
};

const workoutPlan = {
  id: "workout-1",
  scheduledDate: "2026-03-10T00:00:00.000Z",
  warmup: [],
  mainLifts: [
    {
      id: "bench-entry",
      exercise: { id: "bench", name: "Bench Press" },
      orderIndex: 0,
      isMainLift: true,
      role: "main",
      sets: [{ setIndex: 1, targetReps: 8, targetRpe: 8, targetLoad: 200, role: "main" }],
    },
  ],
  accessories: [],
  estimatedMinutes: 45,
} as unknown as WorkoutPlan;

describe("buildHistoricalWeekAuditPayload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("includes per-workout evidence, week-close state, and mutation reconciliation", async () => {
    const generated = buildGeneratedSessionAuditSnapshot({
      workout: workoutPlan,
      selectionMode: "INTENT",
      sessionIntent: "PUSH",
      selectionMetadata: {
        sessionDecisionReceipt: receipt,
        weekCloseId: "wc-1",
      },
      advancesSplit: true,
    });
    const savedSelectionMetadata = attachSessionAuditSnapshotToSelectionMetadata(
      {
        weekCloseId: "wc-1",
        sessionDecisionReceipt: {
          ...receipt,
          cycleContext: {
            ...receipt.cycleContext,
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
      revision: 2,
      status: "COMPLETED",
      advancesSplit: false,
      selectionMode: "MANUAL",
      sessionIntent: "PULL",
      mesocycleId: "meso-1",
      mesocycleWeekSnapshot: 4,
      mesoSessionSnapshot: 3,
      mesocyclePhaseSnapshot: "DELOAD",
    });

    mocks.workoutFindMany.mockResolvedValue([
      {
        id: "workout-1",
        scheduledDate: new Date("2026-03-10T00:00:00.000Z"),
        status: "COMPLETED",
        revision: 2,
        advancesSplit: false,
        selectionMode: "MANUAL",
        sessionIntent: "PULL",
        selectionMetadata: {
          weekCloseId: "wc-1",
          sessionAuditSnapshot: saved,
        },
        mesocycleId: "meso-1",
        mesocycleWeekSnapshot: 4,
        mesoSessionSnapshot: 3,
        mesocyclePhaseSnapshot: "DELOAD",
        exercises: [
          {
            exerciseId: "bench",
            orderIndex: 0,
            section: "MAIN",
            isMainLift: true,
            role: "main",
            exercise: { name: "Bench Press" },
            sets: [{ setIndex: 1, targetReps: 6, targetRpe: 8, targetLoad: 205, role: "main" }],
          },
          {
            exerciseId: "curl",
            orderIndex: 1,
            section: "ACCESSORY",
            isMainLift: false,
            role: "accessory",
            exercise: { name: "Curl" },
            sets: [{ setIndex: 1, targetReps: 12, targetLoad: 25, role: "accessory" }],
          },
        ],
      },
    ]);
    mocks.mesocycleWeekCloseFindMany.mockResolvedValue([
      {
        id: "wc-1",
        mesocycleId: "meso-1",
        targetWeek: 4,
        targetPhase: "ACCUMULATION",
        status: "PENDING_OPTIONAL_GAP_FILL",
        resolution: null,
        optionalWorkoutId: "workout-1",
        deficitSnapshotJson: {
          version: 1,
          policy: {
            requiredSessionsPerWeek: 3,
            maxOptionalGapFillSessionsPerWeek: 1,
            maxGeneratedHardSets: 12,
            maxGeneratedExercises: 4,
          },
          summary: {
            totalDeficitSets: 5,
            qualifyingMuscleCount: 1,
            topTargetMuscles: ["Chest"],
          },
          muscles: [
            {
              muscle: "Chest",
              target: 16,
              actual: 11,
              deficit: 5,
            },
          ],
        },
      },
    ]);

    const payload = await buildHistoricalWeekAuditPayload({
      userId: "user-1",
      week: 4,
      mesocycleId: "meso-1",
    });

    expect(payload.summary.sessionCount).toBe(1);
    expect(payload.summary.progressionExcludedCount).toBe(1);
    expect(payload.summary.weekCloseRelevantCount).toBe(1);
    expect(payload.summary.mutationDriftCount).toBe(1);
    expect(payload.comparabilityCoverage).toEqual({
      comparableSessionCount: 1,
      missingGeneratedSnapshotCount: 0,
      persistedSnapshotCount: 1,
      reconstructedSnapshotCount: 0,
      generatedLayerCoverage: "full",
      limitations: [],
    });
    expect(payload.sessions[0]).toMatchObject({
      workoutId: "workout-1",
      snapshotSource: "persisted",
      progressionEvidence: {
        countsTowardProgressionHistory: false,
        updatesProgressionAnchor: false,
      },
      weekClose: {
        weekCloseId: "wc-1",
        relation: [
          "target_week",
          "linked_selection_metadata",
          "linked_optional_workout",
        ],
        workflowState: "PENDING_OPTIONAL_GAP_FILL",
        deficitState: "OPEN",
        remainingDeficitSets: 5,
      },
      reconciliation: {
        comparisonState: "comparable",
        hasDrift: true,
        addedExerciseIds: ["curl"],
      },
    });
    expect(payload.sessions[0]?.reconciliation.changedFields).toEqual(
      expect.arrayContaining([
        "selection_mode",
        "session_intent",
        "progression_history_eligibility",
        "exercise_added",
        "exercise_prescription_changed",
      ])
    );
  });

  it("summarizes reconstructed legacy coverage when generated snapshots are missing", async () => {
    mocks.workoutFindMany.mockResolvedValue([
      {
        id: "legacy-workout-1",
        scheduledDate: new Date("2026-03-11T00:00:00.000Z"),
        status: "COMPLETED",
        revision: 1,
        advancesSplit: true,
        selectionMode: "INTENT",
        sessionIntent: "PULL",
        selectionMetadata: {},
        mesocycleId: "meso-1",
        mesocycleWeekSnapshot: 4,
        mesoSessionSnapshot: 2,
        mesocyclePhaseSnapshot: "ACCUMULATION",
        exercises: [
          {
            exerciseId: "row",
            orderIndex: 0,
            section: "MAIN",
            isMainLift: true,
            role: "main",
            exercise: { name: "Row" },
            sets: [{ setIndex: 1, targetReps: 8, targetLoad: 120, role: "main" }],
          },
        ],
      },
    ]);
    mocks.mesocycleWeekCloseFindMany.mockResolvedValue([]);

    const payload = await buildHistoricalWeekAuditPayload({
      userId: "user-1",
      week: 4,
      mesocycleId: "meso-1",
    });

    expect(payload.sessions[0]?.snapshotSource).toBe("reconstructed_saved_only");
    expect(payload.sessions[0]?.reconciliation.comparisonState).toBe("missing_generated_snapshot");
    expect(payload.comparabilityCoverage).toEqual({
      comparableSessionCount: 0,
      missingGeneratedSnapshotCount: 1,
      persistedSnapshotCount: 0,
      reconstructedSnapshotCount: 1,
      generatedLayerCoverage: "none",
      limitations: [
        "1 session(s) are missing generated-layer snapshots, so generated-vs-saved drift and generation-time traces are unavailable for those legacy workouts.",
        "1 session(s) were reconstructed from saved workout state only.",
      ],
    });
  });
});
