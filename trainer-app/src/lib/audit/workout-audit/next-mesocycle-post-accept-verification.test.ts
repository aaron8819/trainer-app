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
      currentSeedRevision: {
        id: "seed-revision-1",
        revision: 1,
        payloadHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        provenanceStatus: "exact",
      },
      seedRevisions: [{
        id: "seed-revision-1",
        revision: 1,
        payloadHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        provenanceStatus: "exact",
        creationReason: "handoff_acceptance",
        actorSource: "test",
        sourceRevisionId: null,
        activatedAt: new Date("2026-04-01T00:00:00.000Z"),
      }],
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
            seedProvenance: {
              revisionId: "seed-revision-1",
              revision: 1,
              hash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            },
          },
        },
      },
      audit: {
        progressionTraces: {
          bench: {},
        },
      },
      prescriptionReadouts: [
        {
          exerciseId: "bench",
          exerciseName: "Bench Press",
          targetLoad: 205,
          targetReps: null,
          repRange: { min: 6, max: 10 },
          targetRpe: 8,
          targetRir: 2,
          loadSource: "history",
          confidence: "high",
          cautionLevel: "none",
          cautionReason: null,
          suggestedAdjustmentRange: null,
        },
      ],
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
    expect(payload.acceptedSeedIdentity).toMatchObject({
      preAcceptPersistedDraftSeedHash: null,
      successorSlotPlanSeedHash: expect.any(String),
      hashesMatch: false,
    });
    expect(payload.futureWeekReplay).toMatchObject({
      compositionSource: "persisted_slot_plan_seed",
      exerciseOrderMatchesSeed: true,
    });
    expect(payload.prescriptionConfidence.summary.classificationCounts).toEqual({
      exact_history: 1,
    });
    expect(payload.prescriptionConfidence.rows).toContainEqual(
      expect.objectContaining({
        exerciseName: "Bench Press",
        classification: "exact_history",
        ownerSeam: "future-week prescription readout",
      }),
    );
    expect(payload.projectedWeekVolume.allProjectedSessionsSeedBacked).toBe(true);
    expect(payload.readModels.allProgramRowsSeedBacked).toBe(true);
    expect(payload.checks.every((row) => row.status === "pass")).toBe(true);
  });

  it("compares pre-accept persisted V2 draft seed identity against the accepted successor seed", () => {
    const evidence = makePassingEvidence();
    const sourceMesocycle = evidence.sourceMesocycle;
    const successorMesocycle = evidence.successorMesocycle;
    const nextSession = evidence.nextSession;
    const generationResult = evidence.generationResult;
    const projectedWeekVolume = evidence.projectedWeekVolume;
    if (
      !sourceMesocycle ||
      !successorMesocycle ||
      !nextSession ||
      !generationResult ||
      "error" in generationResult ||
      !projectedWeekVolume
    ) {
      throw new Error("post-accept verification fixture is incomplete");
    }
    const v2Seed = {
      version: 1,
      source: "v2_materialized_seed",
      slots: [
        {
          slotId: "upper_a",
          exercises: [
            {
              exerciseId: "barbell-bench-press",
              role: "CORE_COMPOUND",
              setCount: 4,
            },
          ],
        },
        {
          slotId: "lower_a",
          exercises: [
            {
              exerciseId: "barbell-back-squat",
              role: "CORE_COMPOUND",
              setCount: 4,
            },
          ],
        },
      ],
    };
    sourceMesocycle.nextSeedDraftJson = {
      acceptedSeedDraft: {
        slotPlanSeedJson: v2Seed,
      },
    };
    successorMesocycle.slotSequenceJson = {
      version: 1,
      source: "handoff_draft",
      sequenceMode: "ordered_flexible",
      slots: [
        { slotId: "upper_a", intent: "UPPER" },
        { slotId: "lower_a", intent: "LOWER" },
      ],
    };
    successorMesocycle.slotPlanSeedJson = v2Seed;
    successorMesocycle.sessionsPerWeek = 2;
    evidence.weeklySchedule = ["upper", "lower"];
    evidence.seedExerciseNameById = {
      "barbell-bench-press": "Barbell Bench Press",
      "barbell-back-squat": "Barbell Back Squat",
    };
    nextSession.slotId = "upper_a";
    generationResult.workout.mainLifts[0].exercise = {
      id: "barbell-bench-press",
      name: "Barbell Bench Press",
    } as never;
    generationResult.selection.selectedExerciseIds = ["barbell-bench-press"];
    generationResult.selection.mainLiftIds = ["barbell-bench-press"];
    generationResult.audit!.progressionTraces = {
      "barbell-bench-press": {} as never,
    };
    generationResult.prescriptionReadouts![0].exerciseId =
      "barbell-bench-press";
    generationResult.prescriptionReadouts![0].exerciseName = "Barbell Bench Press";
    projectedWeekVolume.projectedSessions = [
      {
        slotId: "upper_a",
        intent: "upper",
        isNext: true,
        exerciseCount: 1,
        totalSets: 4,
        exercises: [
          {
            exerciseId: "barbell-bench-press",
            name: "Barbell Bench Press",
            setCount: 4,
            role: "primary",
            effectiveStimulusByMuscle: { Chest: 4 },
          },
        ],
        projectedContributionByMuscle: { Chest: 4 },
      },
      {
        slotId: "lower_a",
        intent: "lower",
        isNext: false,
        exerciseCount: 1,
        totalSets: 4,
        exercises: [
          {
            exerciseId: "barbell-back-squat",
            name: "Barbell Back Squat",
            setCount: 4,
            role: "primary",
            effectiveStimulusByMuscle: { Quads: 4 },
          },
        ],
        projectedContributionByMuscle: { Quads: 4 },
      },
    ];

    const payload = buildNextMesocyclePostAcceptVerificationFromEvidence(evidence);

    expect(payload.acceptedSeedIdentity).toMatchObject({
      hashesMatch: true,
      source: {
        preAccept: "v2_materialized_seed",
        successor: "v2_materialized_seed",
        matches: true,
      },
      rowCount: {
        preAccept: 2,
        successor: 2,
        matches: true,
      },
      slotOrder: {
        preAccept: ["upper_a", "lower_a"],
        successor: ["upper_a", "lower_a"],
        matches: true,
      },
    });
    expect(payload.acceptedSeedIdentity.anchorRows.preAccept).toEqual([
      {
        slotId: "upper_a",
        exerciseId: "barbell-bench-press",
        exerciseName: "Barbell Bench Press",
        setCount: 4,
      },
      {
        slotId: "lower_a",
        exerciseId: "barbell-back-squat",
        exerciseName: "Barbell Back Squat",
        setCount: 4,
      },
    ]);
    expect(payload.checks).toContainEqual(
      expect.objectContaining({
        check: "successor seed matches pre-accept persisted draft seed when present",
        status: "pass",
      }),
    );
    expect(payload.verificationResult).toBe("safe_to_train");
  });

  it("blocks when the successor seed does not match the pre-accept persisted V2 draft seed", () => {
    const evidence = makePassingEvidence();
    const sourceMesocycle = evidence.sourceMesocycle;
    if (!sourceMesocycle) {
      throw new Error("post-accept verification fixture is incomplete");
    }
    sourceMesocycle.nextSeedDraftJson = {
      acceptedSeedDraft: {
        slotPlanSeedJson: {
          version: 1,
          source: "v2_materialized_seed",
          slots: [
            {
              slotId: "upper_a",
              exercises: [
                {
                  exerciseId: "barbell-bench-press",
                  role: "CORE_COMPOUND",
                  setCount: 4,
                },
              ],
            },
          ],
        },
      },
    };
    evidence.seedExerciseNameById = {
      bench: "Incline Dumbbell Bench Press",
      "barbell-bench-press": "Barbell Bench Press",
    };

    const payload = buildNextMesocyclePostAcceptVerificationFromEvidence(evidence);

    expect(payload.acceptedSeedIdentity).toMatchObject({
      hashesMatch: false,
      source: {
        preAccept: "v2_materialized_seed",
        successor: "handoff_slot_plan_projection",
        matches: false,
      },
      anchorRows: {
        preAccept: [
          {
            slotId: "upper_a",
            exerciseId: "barbell-bench-press",
            exerciseName: "Barbell Bench Press",
            setCount: 4,
          },
        ],
        successor: [
          {
            slotId: "upper_a",
            exerciseId: "bench",
            exerciseName: "Incline Dumbbell Bench Press",
            setCount: 4,
          },
        ],
        matches: false,
      },
    });
    expect(payload.checks).toContainEqual(
      expect.objectContaining({
        check: "successor seed matches pre-accept persisted draft seed when present",
        status: "fail",
        mustFixBeforeWeek1: true,
      }),
    );
    expect(payload.verificationResult).toBe("blocked");
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
