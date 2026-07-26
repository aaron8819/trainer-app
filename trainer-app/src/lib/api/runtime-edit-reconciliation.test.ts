import { describe, expect, it } from "vitest";

import { reconcileRuntimeEditSelectionMetadata } from "./runtime-edit-reconciliation";

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
          prescribedSets: [
            { setIndex: 1, targetReps: 8, targetRpe: 8 },
            { setIndex: 2, targetReps: 8, targetRpe: 8 },
            { setIndex: 3, targetReps: 8, targetRpe: 8 },
          ],
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

describe("reconcileRuntimeEditSelectionMetadata", () => {
  it("records add_exercise ops with conservative directives", () => {
    const result = reconcileRuntimeEditSelectionMetadata({
      selectionMetadata: generatedSelectionMetadata,
      selectionMode: "INTENT",
      sessionIntent: "push",
      reconciledAt: "2026-03-23T10:00:00.000Z",
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
      mutation: {
        kind: "add_exercise",
        workoutExerciseId: "we-2",
        exerciseId: "fly",
        orderIndex: 1,
        section: "ACCESSORY",
        setCount: 1,
        prescriptionSource: "session_accessory_defaults",
      },
    });

    expect(result.appendedOpKind).toBe("add_exercise");
    expect(result.runtimeEditReconciliation).toEqual({
      version: 1,
      lastReconciledAt: "2026-03-23T10:00:00.000Z",
      directives: {
        continuityAlias: "none",
        progressionAlias: "none",
        futureSessionGeneration: "ignore",
        futureSeedCarryForward: "ignore",
      },
      ops: [
        {
          kind: "add_exercise",
          source: "api_workouts_add_exercise",
          appliedAt: "2026-03-23T10:00:00.000Z",
          scope: "current_workout_only",
          facts: {
            workoutExerciseId: "we-2",
            exerciseId: "fly",
            orderIndex: 1,
            section: "ACCESSORY",
            setCount: 1,
            prescriptionSource: "session_accessory_defaults",
          },
        },
      ],
    });
    expect(result.workoutStructureState.reconciliation.changedFields).toContain("exercise_added");
  });

  it("records add_set ops with explicit set provenance", () => {
    const result = reconcileRuntimeEditSelectionMetadata({
      selectionMetadata: generatedSelectionMetadata,
      selectionMode: "INTENT",
      sessionIntent: "push",
      reconciledAt: "2026-03-23T10:00:00.000Z",
      persistedExercises: [
        {
          exerciseId: "bench",
          orderIndex: 0,
          section: "MAIN",
          exercise: { name: "Bench Press" },
          sets: [
            { setIndex: 1, targetReps: 8, targetRpe: 8 },
            { setIndex: 2, targetReps: 8, targetRpe: 8 },
            { setIndex: 3, targetReps: 8, targetRpe: 8 },
            { setIndex: 4, targetReps: 8, targetRpe: 8 },
          ],
        },
      ],
      mutation: {
        kind: "add_set",
        workoutExerciseId: "we-1",
        exerciseId: "bench",
        workoutSetId: "set-4",
        setIndex: 4,
        clonedFromSetIndex: 3,
      },
    });

    expect(result.appendedOpKind).toBe("add_set");
    expect(result.runtimeEditReconciliation?.ops).toEqual([
      {
        kind: "add_set",
        source: "api_workouts_add_set",
        appliedAt: "2026-03-23T10:00:00.000Z",
        scope: "current_workout_only",
        facts: {
          workoutExerciseId: "we-1",
          exerciseId: "bench",
          workoutSetId: "set-4",
          setIndex: 4,
          clonedFromSetIndex: 3,
        },
      },
    ]);
    expect(result.workoutStructureState.reconciliation.changedFields).toContain(
      "exercise_set_count_changed"
    );
  });

  it("records remove_exercise ops with current-workout-only provenance", () => {
    const result = reconcileRuntimeEditSelectionMetadata({
      selectionMetadata: generatedSelectionMetadata,
      selectionMode: "INTENT",
      sessionIntent: "push",
      reconciledAt: "2026-03-23T10:00:00.000Z",
      persistedExercises: [
        {
          exerciseId: "bench",
          orderIndex: 0,
          section: "MAIN",
          exercise: { name: "Bench Press" },
          sets: [{ setIndex: 1, targetReps: 8 }],
        },
      ],
      mutation: {
        kind: "remove_exercise",
        workoutExerciseId: "we-2",
        exerciseId: "fly",
        orderIndex: 1,
        section: "ACCESSORY",
        setCount: 2,
      },
    });

    expect(result.appendedOpKind).toBe("remove_exercise");
    expect(result.runtimeEditReconciliation?.ops).toEqual([
      {
        kind: "remove_exercise",
        source: "api_workouts_remove_exercise",
        appliedAt: "2026-03-23T10:00:00.000Z",
        scope: "current_workout_only",
        facts: {
          workoutExerciseId: "we-2",
          exerciseId: "fly",
          orderIndex: 1,
          section: "ACCESSORY",
          setCount: 2,
        },
      },
    ]);
    expect(result.workoutStructureState.reconciliation.changedFields).not.toContain(
      "exercise_added"
    );
  });

  it("records replace_exercise ops with route-known reason values only", () => {
    const result = reconcileRuntimeEditSelectionMetadata({
      selectionMetadata: generatedSelectionMetadata,
      selectionMode: "INTENT",
      sessionIntent: "push",
      reconciledAt: "2026-03-23T10:00:00.000Z",
      persistedExercises: [
        {
          exerciseId: "incline-press",
          orderIndex: 0,
          section: "MAIN",
          exercise: { name: "Incline Press" },
          sets: [{ setIndex: 1, targetReps: 8 }],
        },
      ],
      mutation: {
        kind: "replace_exercise",
        workoutExerciseId: "we-1",
        fromExerciseId: "bench",
        fromExerciseName: "Bench Press",
        toExerciseId: "incline-press",
        toExerciseName: "Incline Press",
        reason: "equipment_availability_equivalent_pull_swap",
        setCount: 2,
      },
    });

    expect(result.appendedOpKind).toBe("replace_exercise");
    expect(result.runtimeEditReconciliation?.ops).toEqual([
      {
        kind: "replace_exercise",
        source: "api_workouts_swap_exercise",
        appliedAt: "2026-03-23T10:00:00.000Z",
        scope: "current_workout_only",
        facts: {
          workoutExerciseId: "we-1",
          fromExerciseId: "bench",
          fromExerciseName: "Bench Press",
          toExerciseId: "incline-press",
          toExerciseName: "Incline Press",
          reason: "equipment_availability_equivalent_pull_swap",
          setCount: 2,
        },
      },
    ]);
  });

  it("records rewrite_structure only when saved structure drifts from generated", () => {
    const result = reconcileRuntimeEditSelectionMetadata({
      selectionMetadata: generatedSelectionMetadata,
      selectionMode: "INTENT",
      sessionIntent: "push",
      reconciledAt: "2026-03-23T10:00:00.000Z",
      persistedExercises: [
        {
          exerciseId: "bench",
          orderIndex: 0,
          section: "MAIN",
          exercise: { name: "Bench Press" },
          sets: [{ setIndex: 1, targetReps: 10 }],
        },
      ],
      mutation: {
        kind: "rewrite_structure",
      },
    });

    expect(result.appendedOpKind).toBe("rewrite_structure");
    expect(result.runtimeEditReconciliation?.ops).toEqual([
      {
        kind: "rewrite_structure",
        source: "api_workouts_save",
        appliedAt: "2026-03-23T10:00:00.000Z",
        scope: "current_workout_only",
        facts: {
          changedFields: ["exercise_set_count_changed", "exercise_prescription_changed"],
          addedExerciseIds: [],
          removedExerciseIds: [],
          exercisesWithSetCountChanges: ["bench"],
          exercisesWithPrescriptionChanges: ["bench"],
        },
      },
    ]);
  });

  it("does not append rewrite_structure when save matches the generated workout", () => {
    const result = reconcileRuntimeEditSelectionMetadata({
      selectionMetadata: generatedSelectionMetadata,
      selectionMode: "INTENT",
      sessionIntent: "push",
      reconciledAt: "2026-03-23T10:00:00.000Z",
      persistedExercises: [
        {
          exerciseId: "bench",
          orderIndex: 0,
          section: "MAIN",
          exercise: { name: "Bench Press" },
          sets: [
            {
              setIndex: 1,
              targetReps: 8,
              targetRpe: 8,
            },
            {
              setIndex: 2,
              targetReps: 8,
              targetRpe: 8,
            },
            {
              setIndex: 3,
              targetReps: 8,
              targetRpe: 8,
            },
          ],
        },
      ],
      mutation: {
        kind: "rewrite_structure",
      },
    });

    expect(result.workoutStructureState.reconciliation.hasDrift).toBe(false);
    expect(result.appendedOpKind).toBeUndefined();
    expect(result.runtimeEditReconciliation).toBeUndefined();
    expect(result.nextSelectionMetadata.runtimeEditReconciliation).toBeUndefined();
  });

  it("suppresses only the initial rewrite fully explained by Short today", () => {
    const shortMetadata = {
      ...generatedSelectionMetadata,
      sessionAuditSnapshot: {
        ...generatedSelectionMetadata.sessionAuditSnapshot,
        generated: {
          ...generatedSelectionMetadata.sessionAuditSnapshot.generated,
          exerciseCount: 2,
          hardSetCount: 6,
          exercises: [
            ...generatedSelectionMetadata.sessionAuditSnapshot.generated.exercises,
            {
              exerciseId: "optional",
              exerciseName: "Optional Top-up",
              orderIndex: 1,
              section: "accessory",
              isMainLift: false,
              prescribedSetCount: 3,
              prescribedSets: [
                { setIndex: 1, targetReps: 12 },
                { setIndex: 2, targetReps: 12 },
                { setIndex: 3, targetReps: 12 },
              ],
            },
          ],
        },
      },
      runtimeEditReconciliation: {
        version: 1,
        lastReconciledAt: "2026-03-23T09:00:00.000Z",
        directives: {
          continuityAlias: "none",
          progressionAlias: "none",
          futureSessionGeneration: "ignore",
          futureSeedCarryForward: "ignore",
        },
        ops: [
          {
            kind: "reduce_session_capacity",
            source: "api_workouts_generate_from_intent",
            appliedAt: "2026-03-23T09:00:00.000Z",
            scope: "current_workout_only",
            facts: {
              workoutId: "workout-1",
              mode: "short_today",
              reason: "user_selected_temporary_capacity",
              transformVersion: "short_today_v1",
              seedRevisionId: "revision-1",
              seedRevisionNumber: 1,
              seedPayloadHash: "a".repeat(64),
              executableRowsHash: "b".repeat(64),
              plannedStructureFingerprint: "c".repeat(64),
              offeredStructureFingerprint: "d".repeat(64),
              omitted: [
                {
                  exerciseId: "optional",
                  exerciseName: "Optional Top-up",
                  plannedSetCount: 3,
                  retainedSetCount: 0,
                  omittedSetIndexes: [1, 2, 3],
                  omissionClass: "optional_top_up",
                  yieldOrder: 1,
                },
              ],
              retainedProtectionClaims: [],
            },
          },
        ],
      },
    };
    const initial = reconcileRuntimeEditSelectionMetadata({
      selectionMetadata: shortMetadata,
      selectionMode: "INTENT",
      sessionIntent: "push",
      reconciledAt: "2026-03-23T10:00:00.000Z",
      persistedExercises: [
        {
          exerciseId: "bench",
          orderIndex: 0,
          section: "MAIN",
          sets: [
            { setIndex: 1, targetReps: 8, targetRpe: 8 },
            { setIndex: 2, targetReps: 8, targetRpe: 8 },
            { setIndex: 3, targetReps: 8, targetRpe: 8 },
          ],
        },
      ],
      mutation: { kind: "rewrite_structure" },
    });
    expect(initial.appendedOpKind).toBeUndefined();
    expect(initial.runtimeEditReconciliation?.ops).toHaveLength(1);

    const laterEdit = reconcileRuntimeEditSelectionMetadata({
      selectionMetadata: initial.nextSelectionMetadata,
      selectionMode: "INTENT",
      sessionIntent: "push",
      reconciledAt: "2026-03-23T11:00:00.000Z",
      persistedExercises: [
        {
          exerciseId: "bench",
          orderIndex: 0,
          section: "MAIN",
          sets: [{ setIndex: 1, targetReps: 8, targetRpe: 8 }],
        },
      ],
      mutation: { kind: "rewrite_structure" },
    });
    expect(laterEdit.appendedOpKind).toBe("rewrite_structure");
    expect(laterEdit.runtimeEditReconciliation?.ops.map((op) => op.kind)).toEqual([
      "reduce_session_capacity",
      "rewrite_structure",
    ]);
  });
});
