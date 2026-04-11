import { describe, expect, it } from "vitest";

import {
  attachCloseoutDismissalMetadata,
  attachCloseoutSessionMetadata,
  attachSupplementalSessionMetadata,
  buildWorkoutStructureState,
  buildCanonicalSelectionMetadata,
  readRuntimeAddedExerciseIds,
  readRuntimeAddedSetIds,
  readRuntimeEditReconciliation,
  readWorkoutStructureState,
  type SaveableSelectionMetadata,
  sanitizeSelectionMetadataForSave,
} from "./selection-metadata";

describe("sanitizeSelectionMetadataForSave", () => {
  it("keeps only canonical save-safe selection metadata fields", () => {
    const result = sanitizeSelectionMetadataForSave({
      rationale: {
        bench: {
          score: 0.9,
        },
      },
      selectedExerciseIds: ["bench"],
      perExerciseSetTargets: { bench: 3 },
      closeoutDismissed: true,
      closeoutDismissedAt: "2026-04-09T12:00:00.000Z",
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
      },
      cycleContext: {
        weekInMeso: 99,
      },
      deloadDecision: {
        mode: "reactive",
      },
      sorenessSuppressedMuscles: ["Chest"],
      lifecycleRirTarget: { min: 9, max: 9 },
      lifecycleVolumeTargets: { Chest: 99 },
      adaptiveDeloadApplied: true,
      periodizationWeek: 8,
    });

    expect(result).toEqual({
      rationale: {
        bench: {
          score: 0.9,
        },
      },
      selectedExerciseIds: ["bench"],
      perExerciseSetTargets: { bench: 3 },
      closeoutDismissed: true,
      closeoutDismissedAt: "2026-04-09T12:00:00.000Z",
      sessionDecisionReceipt: expect.objectContaining({
        version: 1,
      }),
    });
  });

  it("drops receipt-shaped objects that do not parse as canonical receipts", () => {
    const result = sanitizeSelectionMetadataForSave({
      sessionDecisionReceipt: {
        cycleContext: {
          weekInMeso: 2,
        },
      },
      selectedExerciseIds: ["bench"],
    });

    expect(result).toEqual({
      selectedExerciseIds: ["bench"],
    });
  });
});

describe("buildCanonicalSelectionMetadata", () => {
  it("stores generation readiness context only inside sessionDecisionReceipt", () => {
    const result = buildCanonicalSelectionMetadata(
      {
        selectedExerciseIds: ["bench"],
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
        },
      },
      {
        original: {
          id: "w1",
          scheduledDate: "2026-03-03T00:00:00.000Z",
          warmup: [],
          mainLifts: [],
          accessories: [],
          estimatedMinutes: 45,
        },
        adjusted: {
          id: "w1",
          scheduledDate: "2026-03-03T00:00:00.000Z",
          warmup: [],
          mainLifts: [],
          accessories: [],
          estimatedMinutes: 45,
        },
        modifications: [],
        fatigueScore: null,
        rationale: "Scaled session from recent readiness (signal 3.0h old)",
        wasAutoregulated: false,
        applied: false,
        reason: "Scaled session from recent readiness (signal 3.0h old)",
        signalAgeHours: 3,
      }
    );

    expect(result.sessionDecisionReceipt?.readiness).toEqual({
      wasAutoregulated: false,
      signalAgeHours: 3,
      fatigueScoreOverall: null,
      intensityScaling: {
        applied: false,
        exerciseIds: [],
        scaledUpCount: 0,
        scaledDownCount: 0,
      },
      rationale: "Scaled session from recent readiness (signal 3.0h old)",
    });
    expect((result as Record<string, unknown>).autoregulation).toBeUndefined();
  });
});

describe("workout structure reconciliation", () => {
  const generatedSelectionMetadata = {
    sessionAuditSnapshot: {
      version: 1,
      generated: {
        selectionMode: "INTENT",
        sessionIntent: "push",
        exerciseCount: 1,
        hardSetCount: 3,
        exercises: [
          {
            exerciseId: "bench",
            exerciseName: "Bench Press",
            orderIndex: 0,
            section: "main",
            isMainLift: true,
            prescribedSetCount: 3,
            prescribedSets: [{ setIndex: 1, targetReps: 8, targetRpe: 8 }],
          },
        ],
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
        traces: {
          progression: {},
        },
      },
    },
  };

  it("records current saved structure and drift when a mutation adds an exercise", () => {
    const result = buildWorkoutStructureState({
      selectionMetadata: generatedSelectionMetadata,
      selectionMode: "INTENT",
      sessionIntent: "PUSH",
      reconciledAt: "2026-03-05T10:00:00.000Z",
      persistedExercises: [
        {
          exerciseId: "bench",
          orderIndex: 0,
          section: "MAIN",
          exercise: { name: "Bench Press" },
          sets: [{ setIndex: 1, targetReps: 8 }],
        },
        {
          exerciseId: "fly",
          orderIndex: 1,
          section: "ACCESSORY",
          exercise: { name: "Cable Fly" },
          sets: [{ setIndex: 1, targetReps: 12 }],
        },
      ],
    });

    expect(result.currentExercises).toEqual([
      {
        exerciseId: "bench",
        orderIndex: 0,
        section: "MAIN",
        setCount: 1,
      },
      {
        exerciseId: "fly",
        orderIndex: 1,
        section: "ACCESSORY",
        setCount: 1,
      },
    ]);
    expect(result.reconciliation.hasDrift).toBe(true);
    expect(result.reconciliation.changedFields).toContain("exercise_added");
    expect(result.reconciliation.addedExerciseIds).toEqual(["fly"]);
  });

  it("preserves canonical workoutStructureState during sanitization", () => {
    const workoutStructureState = buildWorkoutStructureState({
      selectionMetadata: generatedSelectionMetadata,
      selectionMode: "INTENT",
      sessionIntent: "PUSH",
      persistedExercises: [
        {
          exerciseId: "bench",
          orderIndex: 0,
          section: "MAIN",
          exercise: { name: "Bench Press" },
          sets: [{ setIndex: 1, targetReps: 8 }],
        },
      ],
    });

    const result = sanitizeSelectionMetadataForSave({
      workoutStructureState,
      debugOnly: true,
    });

    expect(readWorkoutStructureState(result)).toEqual(workoutStructureState);
    expect((result as Record<string, unknown>).debugOnly).toBeUndefined();
  });

  it("preserves canonical runtimeEditReconciliation during sanitization", () => {
    const runtimeEditReconciliation = {
      version: 1 as const,
      lastReconciledAt: "2026-03-23T10:00:00.000Z",
      directives: {
        continuityAlias: "none" as const,
        progressionAlias: "none" as const,
        futureSessionGeneration: "ignore" as const,
        futureSeedCarryForward: "ignore" as const,
      },
      ops: [
        {
          kind: "add_exercise" as const,
          source: "api_workouts_add_exercise" as const,
          appliedAt: "2026-03-23T10:00:00.000Z",
          scope: "current_workout_only" as const,
          facts: {
            workoutExerciseId: "we-2",
            exerciseId: "fly",
            orderIndex: 1,
            section: "ACCESSORY" as const,
            setCount: 3,
            prescriptionSource: "session_accessory_defaults" as const,
          },
        },
      ],
    };

    const result = sanitizeSelectionMetadataForSave({
      runtimeEditReconciliation,
      debugOnly: true,
    });

    expect(readRuntimeEditReconciliation(result)).toEqual(runtimeEditReconciliation);
    expect((result as Record<string, unknown>).debugOnly).toBeUndefined();
  });

  it("reads runtime-added set ids from explicit add_set provenance only", () => {
    const runtimeEditReconciliation = {
      version: 1 as const,
      lastReconciledAt: "2026-03-23T10:00:00.000Z",
      directives: {
        continuityAlias: "none" as const,
        progressionAlias: "none" as const,
        futureSessionGeneration: "ignore" as const,
        futureSeedCarryForward: "ignore" as const,
      },
      ops: [
        {
          kind: "add_set" as const,
          source: "api_workouts_add_set" as const,
          appliedAt: "2026-03-23T10:00:00.000Z",
          scope: "current_workout_only" as const,
          facts: {
            workoutExerciseId: "we-1",
            exerciseId: "bench",
            workoutSetId: "set-4",
            setIndex: 4,
            clonedFromSetIndex: 3,
          },
        },
        {
          kind: "add_exercise" as const,
          source: "api_workouts_add_exercise" as const,
          appliedAt: "2026-03-23T10:00:00.000Z",
          scope: "current_workout_only" as const,
          facts: {
            workoutExerciseId: "we-2",
            exerciseId: "fly",
            orderIndex: 1,
            section: "ACCESSORY" as const,
            setCount: 3,
            prescriptionSource: "session_accessory_defaults" as const,
          },
        },
      ],
    };

    expect(
      readRuntimeAddedSetIds({
        runtimeEditReconciliation,
      })
    ).toEqual(new Set(["set-4"]));
  });

  it("reads runtime-added exercise ids from explicit add_exercise provenance only", () => {
    const runtimeEditReconciliation = {
      version: 1 as const,
      lastReconciledAt: "2026-03-23T10:00:00.000Z",
      directives: {
        continuityAlias: "none" as const,
        progressionAlias: "none" as const,
        futureSessionGeneration: "ignore" as const,
        futureSeedCarryForward: "ignore" as const,
      },
      ops: [
        {
          kind: "add_exercise" as const,
          source: "api_workouts_add_exercise" as const,
          appliedAt: "2026-03-23T10:00:00.000Z",
          scope: "current_workout_only" as const,
          facts: {
            workoutExerciseId: "we-2",
            exerciseId: "fly",
            orderIndex: 1,
            section: "ACCESSORY" as const,
            setCount: 3,
            prescriptionSource: "session_accessory_defaults" as const,
          },
        },
        {
          kind: "add_set" as const,
          source: "api_workouts_add_set" as const,
          appliedAt: "2026-03-23T10:00:00.000Z",
          scope: "current_workout_only" as const,
          facts: {
            workoutExerciseId: "we-2",
            exerciseId: "fly",
            workoutSetId: "set-4",
            setIndex: 4,
            clonedFromSetIndex: 3,
          },
        },
      ],
    };

    expect(
      readRuntimeAddedExerciseIds({
        runtimeEditReconciliation,
      })
    ).toEqual(new Set(["we-2"]));
  });

  it("removes runtime-added exercise ids when a remove_exercise op follows the add", () => {
    const runtimeEditReconciliation = {
      version: 1 as const,
      lastReconciledAt: "2026-03-23T10:05:00.000Z",
      directives: {
        continuityAlias: "none" as const,
        progressionAlias: "none" as const,
        futureSessionGeneration: "ignore" as const,
        futureSeedCarryForward: "ignore" as const,
      },
      ops: [
        {
          kind: "add_exercise" as const,
          source: "api_workouts_add_exercise" as const,
          appliedAt: "2026-03-23T10:00:00.000Z",
          scope: "current_workout_only" as const,
          facts: {
            workoutExerciseId: "we-2",
            exerciseId: "fly",
            orderIndex: 1,
            section: "ACCESSORY" as const,
            setCount: 2,
            prescriptionSource: "session_accessory_defaults" as const,
          },
        },
        {
          kind: "remove_exercise" as const,
          source: "api_workouts_remove_exercise" as const,
          appliedAt: "2026-03-23T10:05:00.000Z",
          scope: "current_workout_only" as const,
          facts: {
            workoutExerciseId: "we-2",
            exerciseId: "fly",
            orderIndex: 1,
            section: "ACCESSORY" as const,
            setCount: 2,
          },
        },
      ],
    };

    expect(
      readRuntimeAddedExerciseIds({
        runtimeEditReconciliation,
      })
    ).toEqual(new Set());
    expect(readRuntimeEditReconciliation({ runtimeEditReconciliation })).toEqual(
      runtimeEditReconciliation
    );
  });
});

describe("attachSupplementalSessionMetadata", () => {
  it("appends the supplemental marker without removing existing receipt exceptions", () => {
    const result = attachSupplementalSessionMetadata(
      {
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
          exceptions: [
            {
              code: "optional_gap_fill",
              message: "Marked as optional gap-fill session.",
            },
          ],
        },
      },
      {
        enabled: true,
        targetMuscles: ["Chest"],
        anchorWeek: 3,
      }
    );

    expect(result.sessionDecisionReceipt?.targetMuscles).toEqual(["Chest"]);
    expect(result.sessionDecisionReceipt?.exceptions).toEqual([
      {
        code: "optional_gap_fill",
        message: "Marked as optional gap-fill session.",
      },
      {
        code: "supplemental_deficit_session",
        message: "Marked as supplemental deficit session.",
      },
    ]);
  });

  it("does not stamp supplemental metadata when disabled", () => {
    const metadata = {
      selectedExerciseIds: ["bench"],
    };

    expect(
      attachSupplementalSessionMetadata(metadata, {
        enabled: false,
        targetMuscles: ["Chest"],
      })
    ).toBe(metadata);
  });
});

describe("attachCloseoutSessionMetadata", () => {
  it("stamps weekClose ownership, preserves retained exceptions, and strips slot identity", () => {
    const result = attachCloseoutSessionMetadata(
      {
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
            source: "mesocycle_slot_sequence",
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
          exceptions: [
            {
              code: "optional_gap_fill",
              message: "Marked as optional gap-fill session.",
            },
          ],
        },
      },
      {
        enabled: true,
        weekCloseId: "week-close-1",
      }
    );

    expect(result.weekCloseId).toBe("week-close-1");
    expect(result.sessionDecisionReceipt?.sessionSlot).toBeUndefined();
    expect(result.sessionDecisionReceipt?.exceptions).toEqual([
      {
        code: "optional_gap_fill",
        message: "Marked as optional gap-fill session.",
      },
      {
        code: "closeout_session",
        message: "Marked as closeout session.",
      },
    ]);
  });

  it("is a no-op when already marked closeout for the same context", () => {
    const metadata: SaveableSelectionMetadata = {
      weekCloseId: "week-close-1",
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
        exceptions: [
          {
            code: "closeout_session",
            message: "Marked as closeout session.",
          },
        ],
      },
    };

    expect(
      attachCloseoutSessionMetadata(metadata, {
        enabled: true,
        weekCloseId: "week-close-1",
      })
    ).toBe(metadata);
  });

  it("does not stamp closeout metadata when disabled", () => {
    const metadata = {
      selectedExerciseIds: ["bench"],
    };

    expect(
      attachCloseoutSessionMetadata(metadata, {
        enabled: false,
        weekCloseId: "week-close-1",
      })
    ).toBe(metadata);
  });
});

describe("attachCloseoutDismissalMetadata", () => {
  it("marks closeout dismissal without changing receipt truth", () => {
    const metadata: SaveableSelectionMetadata = {
      weekCloseId: "week-close-1",
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
        exceptions: [
          {
            code: "closeout_session",
            message: "Marked as closeout session.",
          },
        ],
      },
    };

    const result = attachCloseoutDismissalMetadata(metadata, {
      dismissedAt: new Date("2026-04-09T12:00:00.000Z"),
    });

    expect(result).toEqual({
      ...metadata,
      closeoutDismissed: true,
      closeoutDismissedAt: "2026-04-09T12:00:00.000Z",
    });
    expect(result.sessionDecisionReceipt).toBe(metadata.sessionDecisionReceipt);
  });
});
