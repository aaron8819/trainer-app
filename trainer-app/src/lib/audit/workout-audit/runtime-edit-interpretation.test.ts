import { describe, expect, it } from "vitest";
import type { RuntimeEditReconciliation } from "@/lib/ui/selection-metadata";
import { interpretRuntimeEdits } from "./runtime-edit-interpretation";

const directives = {
  continuityAlias: "none",
  progressionAlias: "none",
  futureSessionGeneration: "ignore",
  futureSeedCarryForward: "ignore",
} as const;

function reconciliation(
  ops: RuntimeEditReconciliation["ops"]
): RuntimeEditReconciliation {
  return {
    version: 1,
    lastReconciledAt: "2026-04-01T12:00:00.000Z",
    ops,
    directives,
  };
}

const exerciseContexts = [
  {
    exerciseId: "cable-crunch",
    exerciseName: "Cable Crunch",
    primaryMuscles: ["Core"],
    secondaryMuscles: [],
  },
  {
    exerciseId: "calf-raise",
    exerciseName: "Standing Calf Raise",
    primaryMuscles: ["Calves"],
    secondaryMuscles: [],
  },
  {
    exerciseId: "row",
    exerciseName: "Chest-Supported Dumbbell Row",
    primaryMuscles: ["Upper Back", "Lats"],
    secondaryMuscles: ["Biceps"],
  },
  {
    exerciseId: "pec-deck",
    exerciseName: "Pec Deck Machine",
    primaryMuscles: ["Chest"],
    secondaryMuscles: [],
  },
  {
    exerciseId: "pushdown",
    exerciseName: "Cable Triceps Pushdown",
    primaryMuscles: ["Triceps"],
    secondaryMuscles: [],
  },
];

describe("interpretRuntimeEdits", () => {
  it("classifies add exercise with clear under-target muscle as high-confidence target gap closure", () => {
    const interpretations = interpretRuntimeEdits({
      runtimeEditReconciliation: reconciliation([
        {
          kind: "add_exercise",
          source: "api_workouts_add_exercise",
          appliedAt: "2026-04-01T12:00:00.000Z",
          scope: "current_workout_only",
          facts: {
            workoutExerciseId: "we-core",
            exerciseId: "cable-crunch",
            orderIndex: 5,
            section: "ACCESSORY",
            setCount: 3,
            prescriptionSource: "session_accessory_defaults",
          },
        },
      ]),
      exerciseContexts,
      targetContext: [
        {
          muscle: "Core",
          actualEffectiveSets: 5,
          weeklyTarget: 8,
          mev: 6,
        },
      ],
    });

    expect(interpretations[0]).toMatchObject({
      opKind: "add_exercise",
      intent: "target_gap_closure",
      confidence: "high",
      source: "persisted_op",
      setDelta: 3,
      exerciseId: "cable-crunch",
      workoutExerciseId: "we-core",
      muscles: ["Core"],
    });
  });

  it("classifies add set with clear under-target muscle as high-confidence target gap closure", () => {
    const interpretations = interpretRuntimeEdits({
      runtimeEditReconciliation: reconciliation([
        {
          kind: "add_set",
          source: "api_workouts_add_set",
          appliedAt: "2026-04-01T12:00:00.000Z",
          scope: "current_workout_only",
          facts: {
            workoutExerciseId: "we-calf",
            exerciseId: "calf-raise",
            workoutSetId: "set-4",
            setIndex: 4,
            clonedFromSetIndex: 3,
          },
        },
      ]),
      exerciseContexts,
      targetContext: [
        {
          muscle: "Calves",
          actualEffectiveSets: 7,
          weeklyTarget: 8,
          mev: 6,
        },
      ],
    });

    expect(interpretations[0]).toMatchObject({
      opKind: "add_set",
      intent: "target_gap_closure",
      confidence: "high",
      setDelta: 1,
      muscles: ["Calves"],
    });
  });

  it("does not infer target gap closure when target context is missing", () => {
    const interpretations = interpretRuntimeEdits({
      runtimeEditReconciliation: reconciliation([
        {
          kind: "add_exercise",
          source: "api_workouts_add_exercise",
          appliedAt: "2026-04-01T12:00:00.000Z",
          scope: "current_workout_only",
          facts: {
            workoutExerciseId: "we-core",
            exerciseId: "cable-crunch",
            orderIndex: 5,
            section: "ACCESSORY",
            setCount: 3,
            prescriptionSource: "session_accessory_defaults",
          },
        },
      ]),
      exerciseContexts,
    });

    expect(interpretations[0]).toMatchObject({
      intent: "unclassified",
      confidence: "low",
      evidence: ["missing_weekly_target_context"],
    });
  });

  it("classifies replace exercise as high-confidence substitution", () => {
    const interpretations = interpretRuntimeEdits({
      runtimeEditReconciliation: reconciliation([
        {
          kind: "replace_exercise",
          source: "api_workouts_swap_exercise",
          appliedAt: "2026-04-01T12:00:00.000Z",
          scope: "current_workout_only",
          facts: {
            workoutExerciseId: "we-row",
            fromExerciseId: "old-row",
            fromExerciseName: "Barbell Row",
            toExerciseId: "row",
            toExerciseName: "Chest-Supported Dumbbell Row",
            reason: "equipment_availability_equivalent_pull_swap",
            setCount: 4,
          },
        },
      ]),
      exerciseContexts,
    });

    expect(interpretations[0]).toMatchObject({
      opKind: "replace_exercise",
      intent: "substitution",
      confidence: "high",
      source: "persisted_op",
      setDelta: 0,
      exerciseId: "row",
      workoutExerciseId: "we-row",
    });
    expect(interpretations[0]?.evidence).toEqual(
      expect.arrayContaining(["from:Barbell Row", "to:Chest-Supported Dumbbell Row"])
    );
  });

  it("reconstructs legacy drift conservatively without persisted ops", () => {
    const interpretations = interpretRuntimeEdits({
      exerciseContexts,
      legacyReconciliation: {
        version: 1,
        comparisonState: "comparable",
        hasDrift: true,
        changedFields: ["exercise_added"],
        addedExerciseIds: ["cable-crunch"],
        removedExerciseIds: [],
        exercisesWithSetCountChanges: [],
        exercisesWithPrescriptionChanges: [],
      },
    });

    expect(interpretations[0]).toMatchObject({
      opKind: "legacy_reconciliation",
      source: "legacy_reconstructed",
      intent: "unclassified",
      confidence: "low",
    });
  });

  it("does not treat a companion rewrite as unclassified when specific ops explain it", () => {
    const interpretations = interpretRuntimeEdits({
      runtimeEditReconciliation: reconciliation([
        {
          kind: "add_exercise",
          source: "api_workouts_add_exercise",
          appliedAt: "2026-04-01T12:00:00.000Z",
          scope: "current_workout_only",
          facts: {
            workoutExerciseId: "we-core",
            exerciseId: "cable-crunch",
            orderIndex: 5,
            section: "ACCESSORY",
            setCount: 3,
            prescriptionSource: "session_accessory_defaults",
          },
        },
        {
          kind: "rewrite_structure",
          source: "api_workouts_save",
          appliedAt: "2026-04-01T12:01:00.000Z",
          scope: "current_workout_only",
          facts: {
            changedFields: ["exercise_added"],
            addedExerciseIds: ["cable-crunch"],
            removedExerciseIds: [],
            exercisesWithSetCountChanges: [],
            exercisesWithPrescriptionChanges: [],
          },
        },
      ]),
      exerciseContexts,
      targetContext: [
        {
          muscle: "Core",
          actualEffectiveSets: 5,
          weeklyTarget: 8,
          mev: 6,
        },
      ],
    });

    expect(interpretations.map((interpretation) => interpretation.intent)).toEqual([
      "target_gap_closure",
      "opportunistic_extra",
    ]);
    expect(interpretations).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          opKind: "rewrite_structure",
          intent: "unclassified",
        }),
      ])
    );
  });

  it("uses explicit pain and fatigue metadata only when supplied", () => {
    const withSignal = interpretRuntimeEdits({
      runtimeEditReconciliation: reconciliation([
        {
          kind: "add_set",
          source: "api_workouts_add_set",
          appliedAt: "2026-04-01T12:00:00.000Z",
          scope: "current_workout_only",
          facts: {
            workoutExerciseId: "we-row",
            exerciseId: "row",
            workoutSetId: "set-4",
            setIndex: 4,
            clonedFromSetIndex: 3,
          },
        },
      ]),
      exerciseContexts,
      targetContext: [
        {
          muscle: "Upper Back",
          actualEffectiveSets: 12,
          weeklyTarget: 10,
          mev: 6,
        },
      ],
      explicitSignals: [
        {
          opKind: "add_set",
          workoutExerciseId: "we-row",
          intent: "fatigue_adjustment",
          evidence: "explicit check-in fatigue note",
        },
      ],
    });
    const withoutSignal = interpretRuntimeEdits({
      runtimeEditReconciliation: reconciliation([
        {
          kind: "add_set",
          source: "api_workouts_add_set",
          appliedAt: "2026-04-01T12:00:00.000Z",
          scope: "current_workout_only",
          facts: {
            workoutExerciseId: "we-row",
            exerciseId: "row",
            workoutSetId: "set-4",
            setIndex: 4,
            clonedFromSetIndex: 3,
          },
        },
      ]),
      exerciseContexts,
      targetContext: [
        {
          muscle: "Upper Back",
          actualEffectiveSets: 12,
          weeklyTarget: 10,
          mev: 6,
        },
      ],
    });

    expect(withSignal[0]).toMatchObject({
      intent: "fatigue_adjustment",
      confidence: "high",
    });
    expect(withoutSignal[0]?.intent).not.toBe("fatigue_adjustment");
    expect(withoutSignal[0]?.intent).not.toBe("pain_avoidance");
  });

  it("classifies final-session isolation additions that close MEV as final weekly opportunity closures", () => {
    const interpretations = interpretRuntimeEdits({
      runtimeEditReconciliation: reconciliation([
        {
          kind: "add_exercise",
          source: "api_workouts_add_exercise",
          appliedAt: "2026-04-01T12:00:00.000Z",
          scope: "current_workout_only",
          facts: {
            workoutExerciseId: "we-pec",
            exerciseId: "pec-deck",
            orderIndex: 5,
            section: "ACCESSORY",
            setCount: 2,
            prescriptionSource: "session_accessory_defaults",
          },
        },
        {
          kind: "add_exercise",
          source: "api_workouts_add_exercise",
          appliedAt: "2026-04-01T12:05:00.000Z",
          scope: "current_workout_only",
          facts: {
            workoutExerciseId: "we-pushdown",
            exerciseId: "pushdown",
            orderIndex: 6,
            section: "ACCESSORY",
            setCount: 2,
            prescriptionSource: "session_accessory_defaults",
          },
        },
      ]),
      exerciseContexts,
      targetContext: [
        {
          muscle: "Chest",
          actualEffectiveSets: 10,
          weeklyTarget: 14,
          mev: 10,
        },
        {
          muscle: "Triceps",
          actualEffectiveSets: 7.6,
          weeklyTarget: 10,
          mev: 6,
        },
      ],
      weeklyOpportunity: {
        isFinalAdvancingSession: true,
      },
    });

    expect(interpretations).toEqual([
      expect.objectContaining({
        exerciseId: "pec-deck",
        intent: "final_weekly_opportunity_mev_closure",
        confidence: "high",
        muscles: ["Chest"],
      }),
      expect.objectContaining({
        exerciseId: "pushdown",
        intent: "final_weekly_opportunity_mev_closure",
        confidence: "high",
        muscles: ["Triceps"],
      }),
    ]);
  });

  it("keeps above-MEV random extras and non-final additions out of final MEV closure", () => {
    const randomExtra = interpretRuntimeEdits({
      runtimeEditReconciliation: reconciliation([
        {
          kind: "add_exercise",
          source: "api_workouts_add_exercise",
          appliedAt: "2026-04-01T12:00:00.000Z",
          scope: "current_workout_only",
          facts: {
            workoutExerciseId: "we-pushdown",
            exerciseId: "pushdown",
            orderIndex: 6,
            section: "ACCESSORY",
            setCount: 2,
            prescriptionSource: "session_accessory_defaults",
          },
        },
      ]),
      exerciseContexts,
      targetContext: [
        {
          muscle: "Triceps",
          actualEffectiveSets: 12,
          weeklyTarget: 10,
          mev: 6,
        },
      ],
      weeklyOpportunity: {
        isFinalAdvancingSession: true,
      },
    });
    const nonFinalTopUp = interpretRuntimeEdits({
      runtimeEditReconciliation: reconciliation([
        {
          kind: "add_exercise",
          source: "api_workouts_add_exercise",
          appliedAt: "2026-04-01T12:00:00.000Z",
          scope: "current_workout_only",
          facts: {
            workoutExerciseId: "we-pec",
            exerciseId: "pec-deck",
            orderIndex: 5,
            section: "ACCESSORY",
            setCount: 2,
            prescriptionSource: "session_accessory_defaults",
          },
        },
      ]),
      exerciseContexts,
      targetContext: [
        {
          muscle: "Chest",
          actualEffectiveSets: 10,
          weeklyTarget: 14,
          mev: 10,
        },
      ],
      weeklyOpportunity: {
        isFinalAdvancingSession: false,
      },
    });

    expect(randomExtra[0]).toMatchObject({
      intent: "opportunistic_extra",
      confidence: "medium",
    });
    expect(nonFinalTopUp[0]).toMatchObject({
      intent: "target_gap_closure",
      confidence: "high",
    });
  });
});
