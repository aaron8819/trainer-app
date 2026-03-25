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
        toExerciseId: "incline-press",
        reason: "gap_fill_equivalent_accessory_swap",
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
          toExerciseId: "incline-press",
          reason: "gap_fill_equivalent_accessory_swap",
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
});
