import { describe, expect, it } from "vitest";
import {
  buildNextMesocyclePostAcceptVerificationFromEvidence,
} from "./next-mesocycle-post-accept-verification";

function makePassingEvidence(): Parameters<
  typeof buildNextMesocyclePostAcceptVerificationFromEvidence
>[0] {
  return {
    sourceMesocycleId: "source-1",
    requestedSuccessorMesocycleId: "successor-1",
    sourceMesocycle: {
      id: "source-1",
      state: "COMPLETED",
      isActive: false,
      macroCycleId: "macro-1",
      mesoNumber: 1,
    },
    successorMesocycle: {
      id: "successor-1",
      state: "ACTIVE_ACCUMULATION",
      isActive: true,
      macroCycleId: "macro-1",
      mesoNumber: 2,
      durationWeeks: 5,
      accumulationSessionsCompleted: 0,
      deloadSessionsCompleted: 0,
      sessionsPerWeek: 1,
      slotSequenceJson: {
        version: 1,
        source: "handoff_draft",
        sequenceMode: "ordered_flexible",
        slots: [{ slotId: "upper_a", intent: "UPPER" }],
      },
      slotPlanSeedJson: {
        version: 1,
        source: "handoff_slot_plan_projection",
        slots: [
          {
            slotId: "upper_a",
            exercises: [
              { exerciseId: "bench", role: "CORE_COMPOUND", setCount: 4 },
            ],
          },
        ],
      },
    },
    activeMesocycleId: "successor-1",
    weeklySchedule: ["upper"],
    seedExerciseNameById: {
      bench: "Bench Press",
    },
    nextSession: {
      intent: "upper",
      slotId: "upper_a",
      slotSequenceIndex: 0,
      slotSequenceLength: 1,
      slotSource: "mesocycle_slot_sequence",
      existingWorkoutId: null,
      isExisting: false,
      source: "rotation",
      weekInMeso: 1,
      sessionInWeek: 1,
      derivationTrace: [],
      selectedIncompleteStatus: null,
    },
    generationResult: {
      workout: {
        id: "workout-1",
        scheduledDate: "2026-03-04",
        warmup: [],
        mainLifts: [
          {
            id: "we-1",
            orderIndex: 0,
            exercise: { id: "bench", name: "Bench Press" },
            sets: [{ id: "set-1" }, { id: "set-2" }, { id: "set-3" }, { id: "set-4" }],
          },
        ],
        accessories: [],
        estimatedMinutes: 45,
      },
      selectionMode: "INTENT",
      sessionIntent: "upper",
      sraWarnings: [],
      substitutions: [],
      volumePlanByMuscle: {},
      selection: {
        selectedExerciseIds: ["bench"],
        mainLiftIds: ["bench"],
        accessoryIds: [],
        perExerciseSetTargets: {},
        rationale: {},
        volumePlanByMuscle: {},
        sessionDecisionReceipt: {
          sessionProvenance: {
            mesocycleId: "successor-1",
            compositionSource: "persisted_slot_plan_seed",
          },
        },
      },
      audit: {
        progressionTraces: {
          bench: {},
        },
      },
    } as never,
    generationPath: {
      requestedMode: "next-mesocycle-post-accept-verification",
      executionMode: "standard_generation",
      generator: "generateSessionFromIntent",
      reason: "standard_future_week_or_preview",
    },
    projectedWeekVolume: {
      version: 1,
      currentWeek: {
        mesocycleId: "successor-1",
        week: 1,
        phase: "accumulation",
        blockType: "accumulation",
      },
      projectionNotes: [],
      completedVolumeByMuscle: {},
      projectedSessions: [
        {
          slotId: "upper_a",
          intent: "upper",
          isNext: true,
          exerciseCount: 1,
          totalSets: 4,
          exercises: [
            {
              exerciseId: "bench",
              name: "Bench Press",
              setCount: 4,
              role: "primary",
              effectiveStimulusByMuscle: { Chest: 4 },
            },
          ],
          projectedContributionByMuscle: { Chest: 4 },
        },
      ],
      fullWeekByMuscle: [],
    },
  };
}

describe("buildNextMesocyclePostAcceptVerificationFromEvidence", () => {
  it("passes when the accepted successor replays from the persisted seed across runtime, projection, and read models", () => {
    const payload = buildNextMesocyclePostAcceptVerificationFromEvidence(
      makePassingEvidence(),
    );

    expect(payload.verificationResult).toBe("safe_to_train");
    expect(payload.safety).toMatchObject({
      dbMutated: false,
      mesocycleCreated: false,
      seedRuntimeBehaviorChanged: false,
      transactionExecuted: false,
    });
    expect(payload.seedContract).toMatchObject({
      slotPlanSeedJson: "available",
      minimalExecutableRowsOnly: true,
    });
    expect(payload.futureWeekReplay).toMatchObject({
      compositionSource: "persisted_slot_plan_seed",
      exerciseOrderMatchesSeed: true,
    });
    expect(payload.projectedWeekVolume.allProjectedSessionsSeedBacked).toBe(true);
    expect(payload.readModels.allProgramRowsSeedBacked).toBe(true);
    expect(payload.checks.every((row) => row.status === "pass")).toBe(true);
  });

  it("blocks Week 1 when executable seed rows contain extra runtime fields", () => {
    const evidence = makePassingEvidence();
    const seed = evidence.successorMesocycle?.slotPlanSeedJson;
    if (
      !seed ||
      typeof seed !== "object" ||
      !("slots" in seed) ||
      !Array.isArray(seed.slots)
    ) {
      throw new Error("expected seed fixture");
    }
    seed.slots[0].exercises[0].laneId = "debug_lane";

    const payload = buildNextMesocyclePostAcceptVerificationFromEvidence(evidence);

    expect(payload.verificationResult).toBe("blocked");
    expect(payload.seedContract).toMatchObject({
      minimalExecutableRowsOnly: false,
      extraExecutableRowFieldCount: 1,
    });
    expect(payload.checks).toContainEqual(
      expect.objectContaining({
        check: "slotPlanSeedJson exists with minimal executable rows",
        status: "fail",
        mustFixBeforeWeek1: true,
      }),
    );
  });
});
