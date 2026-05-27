import { describe, expect, it } from "vitest";
import {
  buildRuntimeDoseAdjustmentDiagnostics,
  type RuntimeDoseAdjustmentDiagnostic,
  type RuntimeDoseGuidanceInput,
} from "./runtime-dose-guidance";

function buildInput(overrides: Partial<RuntimeDoseGuidanceInput> = {}): RuntimeDoseGuidanceInput {
  return {
    completedVolumeByMuscle: {},
    projectedSessions: [
      {
        slotId: "lower_a",
        intent: "lower",
        isNext: true,
        exerciseCount: 4,
        totalSets: 12,
        exercises: [
          {
            exerciseId: "belt-squat",
            name: "Belt Squat",
            setCount: 4,
            role: "primary",
            effectiveStimulusByMuscle: { Quads: 4, Glutes: 2 },
          },
          {
            exerciseId: "leg-extension",
            name: "Leg Extension",
            setCount: 2,
            role: "accessory",
            effectiveStimulusByMuscle: { Quads: 2 },
          },
          {
            exerciseId: "lying-leg-curl",
            name: "Lying Leg Curl",
            setCount: 2,
            role: "accessory",
            effectiveStimulusByMuscle: { Hamstrings: 2 },
          },
          {
            exerciseId: "seated-calf-raise",
            name: "Seated Calf Raise",
            setCount: 4,
            role: "accessory",
            effectiveStimulusByMuscle: { Calves: 4 },
          },
        ],
        estimatedMinutes: 60,
        movementPatternCounts: {
          squat: 1,
          isolation: 2,
        },
        projectedContributionByMuscle: {
          Quads: 6,
          Glutes: 2,
          Hamstrings: 2,
          Calves: 4,
        },
      },
    ],
    fullWeekByMuscle: [],
    ...overrides,
  };
}

function expectNonZeroSetDeltaActionsHaveCandidates(
  diagnostics: RuntimeDoseAdjustmentDiagnostic[]
): void {
  const nonZeroSetDeltaDiagnostics = diagnostics.filter(
    (diagnostic) => diagnostic.recommendedAction.setDelta !== 0
  );

  expect(nonZeroSetDeltaDiagnostics.length).toBeGreaterThan(0);
  for (const diagnostic of nonZeroSetDeltaDiagnostics) {
    expect(diagnostic.recommendedAction.slotId).toEqual(expect.any(String));
    expect(diagnostic.recommendedAction.slotId).not.toBe("");
    expect(diagnostic.recommendedAction.exerciseName).toEqual(expect.any(String));
    expect(diagnostic.recommendedAction.exerciseName).not.toBe("");
  }
}

describe("buildRuntimeDoseAdjustmentDiagnostics", () => {
  it("recommends a session-local Leg Extension +1 when Quads are below MEV", () => {
    const diagnostics = buildRuntimeDoseAdjustmentDiagnostics(
      buildInput({
        completedVolumeByMuscle: {
          Quads: { directSets: 1, indirectSets: 0, effectiveSets: 1 },
        },
        fullWeekByMuscle: [
          {
            muscle: "Quads",
            completedEffectiveSets: 1,
            projectedNextSessionEffectiveSets: 6,
            projectedRemainingWeekEffectiveSets: 0,
            projectedFullWeekEffectiveSets: 7,
            weeklyTarget: 12,
            mev: 8,
            mav: 16,
            mrv: 22,
            deltaToTarget: -5,
            deltaToMev: -1,
            deltaToMav: -5,
          },
        ],
      })
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      muscle: "Quads",
      targetStatus: "below_mev",
      plannedRemainingVolume: {
        effectiveSets: 6,
        bySlot: [
          {
            slotId: "lower_a",
            exerciseName: "Leg Extension",
            effectiveSets: 6,
          },
        ],
      },
      recommendedAction: {
        kind: "optional_add_set",
        slotId: "lower_a",
        exerciseName: "Leg Extension",
        setDelta: 1,
      },
      reasonCode: "close_low_volume_opportunity",
      guidance: "below MEV floor; bounded low-fatigue closure if readiness and time allow",
      readOnly: true,
      affectsAcceptedSeed: false,
    });
  });

  it("uses add_set for a larger below-MEV floor gap when a candidate exists", () => {
    const diagnostics = buildRuntimeDoseAdjustmentDiagnostics(
      buildInput({
        completedVolumeByMuscle: {
          Quads: { directSets: 0, indirectSets: 0, effectiveSets: 0 },
        },
        fullWeekByMuscle: [
          {
            muscle: "Quads",
            completedEffectiveSets: 0,
            projectedNextSessionEffectiveSets: 6,
            projectedRemainingWeekEffectiveSets: 0,
            projectedFullWeekEffectiveSets: 6,
            weeklyTarget: 12,
            mev: 8,
            mav: 16,
            mrv: 22,
            deltaToTarget: -6,
            deltaToMev: -2,
            deltaToMav: -10,
          },
        ],
      })
    );

    expect(diagnostics[0]).toMatchObject({
      muscle: "Quads",
      targetStatus: "below_mev",
      recommendedAction: {
        kind: "add_set",
        slotId: "lower_a",
        exerciseName: "Leg Extension",
        setDelta: 1,
      },
      reasonCode: "mev_floor_deficit",
    });
  });

  it("holds the seed with zero set delta when a below-MEV deficit has no exercise candidate", () => {
    const diagnostics = buildRuntimeDoseAdjustmentDiagnostics(
      buildInput({
        projectedSessions: [],
        completedVolumeByMuscle: {
          Abductors: { directSets: 0, indirectSets: 0, effectiveSets: 0 },
        },
        fullWeekByMuscle: [
          {
            muscle: "Abductors",
            completedEffectiveSets: 0,
            projectedNextSessionEffectiveSets: 0,
            projectedRemainingWeekEffectiveSets: 0,
            projectedFullWeekEffectiveSets: 0,
            weeklyTarget: 4,
            mev: 2,
            mav: 10,
            mrv: 14,
            deltaToTarget: -4,
            deltaToMev: -2,
            deltaToMav: -10,
          },
        ],
      })
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      muscle: "Abductors",
      targetStatus: "below_mev",
      plannedRemainingVolume: {
        effectiveSets: 0,
        bySlot: [],
      },
      recommendedAction: {
        kind: "hold_seed",
        setDelta: 0,
      },
      reasonCode: "no_candidate_hold_seed",
      guidance: "below MEV floor but no viable candidate; hold seed and do not recommend impossible add-ons",
    });
    expect(diagnostics[0].recommendedAction.slotId).toBeUndefined();
    expect(diagnostics[0].recommendedAction.exerciseName).toBeUndefined();
  });

  it("includes slot and exercise candidates for every add-set recommendation", () => {
    const diagnostics = buildRuntimeDoseAdjustmentDiagnostics(
      buildInput({
        completedVolumeByMuscle: {
          Quads: { directSets: 5, indirectSets: 0, effectiveSets: 5 },
          Calves: { directSets: 4, indirectSets: 0, effectiveSets: 4 },
        },
        fullWeekByMuscle: [
          {
            muscle: "Quads",
            completedEffectiveSets: 0,
            projectedNextSessionEffectiveSets: 6,
            projectedRemainingWeekEffectiveSets: 0,
            projectedFullWeekEffectiveSets: 6,
            weeklyTarget: 12,
            mev: 8,
            mav: 16,
            mrv: 22,
            deltaToTarget: -6,
            deltaToMev: -2,
            deltaToMav: -5,
          },
          {
            muscle: "Calves",
            completedEffectiveSets: 1,
            projectedNextSessionEffectiveSets: 4,
            projectedRemainingWeekEffectiveSets: 0,
            projectedFullWeekEffectiveSets: 5,
            weeklyTarget: 9,
            mev: 6,
            mav: 14,
            mrv: 20,
            deltaToTarget: -4,
            deltaToMev: -1,
            deltaToMav: -6,
          },
        ],
      })
    );

    const addSetDiagnostics = diagnostics.filter(
      (diagnostic) => diagnostic.recommendedAction.setDelta > 0
    );

    expect(addSetDiagnostics).toHaveLength(2);
    expect(addSetDiagnostics.map((diagnostic) => diagnostic.recommendedAction)).toEqual([
      expect.objectContaining({
        kind: "add_set",
        slotId: "lower_a",
        exerciseName: "Leg Extension",
        setDelta: 1,
      }),
      expect.objectContaining({
        kind: "optional_add_set",
        slotId: "lower_a",
        exerciseName: "Seated Calf Raise",
        setDelta: 1,
      }),
    ]);
    expectNonZeroSetDeltaActionsHaveCandidates(diagnostics);
  });

  it("recommends a calf raise +1 when Calves are slightly under target", () => {
    const diagnostics = buildRuntimeDoseAdjustmentDiagnostics(
      buildInput({
        completedVolumeByMuscle: {
          Calves: { directSets: 1, indirectSets: 0, effectiveSets: 1 },
        },
        fullWeekByMuscle: [
          {
            muscle: "Calves",
            completedEffectiveSets: 1,
            projectedNextSessionEffectiveSets: 4,
            projectedRemainingWeekEffectiveSets: 0,
            projectedFullWeekEffectiveSets: 5,
            weeklyTarget: 9,
            mev: 6,
            mav: 14,
            mrv: 20,
            deltaToTarget: -4,
            deltaToMev: -1,
            deltaToMav: -6,
          },
        ],
      })
    );

    expect(diagnostics[0]).toMatchObject({
      muscle: "Calves",
      recommendedAction: {
        kind: "optional_add_set",
        slotId: "lower_a",
        exerciseName: "Seated Calf Raise",
        setDelta: 1,
      },
      reasonCode: "close_low_volume_opportunity",
    });
  });

  it("does not recommend add sets solely for above-MEV below-target volume", () => {
    const diagnostics = buildRuntimeDoseAdjustmentDiagnostics(
      buildInput({
        completedVolumeByMuscle: {
          Quads: { directSets: 5, indirectSets: 0, effectiveSets: 5 },
        },
        fullWeekByMuscle: [
          {
            muscle: "Quads",
            completedEffectiveSets: 5,
            projectedNextSessionEffectiveSets: 6,
            projectedRemainingWeekEffectiveSets: 0,
            projectedFullWeekEffectiveSets: 11,
            weeklyTarget: 12,
            mev: 8,
            mav: 16,
            mrv: 22,
            deltaToTarget: -1,
            deltaToMev: 3,
            deltaToMav: -5,
          },
        ],
      })
    );

    expect(diagnostics[0]).toMatchObject({
      muscle: "Quads",
      targetStatus: "below_preferred",
      recommendedAction: {
        kind: "hold_seed",
        setDelta: 0,
      },
      reasonCode: "below_preferred_monitor",
      guidance: "productive floor achieved; below preferred target; monitor, no default add-on",
    });
  });

  it("labels above-MEV below-target MAV-adjacent misses as stretch misses", () => {
    const diagnostics = buildRuntimeDoseAdjustmentDiagnostics(
      buildInput({
        fullWeekByMuscle: [
          {
            muscle: "Rear Delts",
            completedEffectiveSets: 7,
            projectedNextSessionEffectiveSets: 2.5,
            projectedRemainingWeekEffectiveSets: 0,
            projectedFullWeekEffectiveSets: 9.5,
            weeklyTarget: 11,
            mev: 4,
            mav: 12,
            mrv: 16,
            deltaToTarget: -1.5,
            deltaToMev: 5.5,
            deltaToMav: -2.5,
          },
        ],
      })
    );

    expect(diagnostics[0]).toMatchObject({
      muscle: "Rear Delts",
      targetStatus: "stretch_miss",
      recommendedAction: {
        kind: "hold_seed",
        setDelta: 0,
      },
      reasonCode: "stretch_target_monitor",
      guidance: "productive floor achieved; below stretch target; monitor, no default add-on",
    });
  });

  it("suppresses add-ons for over-MAV rows and emits caution copy", () => {
    const diagnostics = buildRuntimeDoseAdjustmentDiagnostics(
      buildInput({
        fullWeekByMuscle: [
          {
            muscle: "Glutes",
            completedEffectiveSets: 12,
            projectedNextSessionEffectiveSets: 6,
            projectedRemainingWeekEffectiveSets: 0,
            projectedFullWeekEffectiveSets: 18,
            weeklyTarget: 12,
            mev: 8,
            mav: 16,
            mrv: 22,
            deltaToTarget: 6,
            deltaToMev: 10,
            deltaToMav: 2,
          },
        ],
      })
    );

    expect(diagnostics[0]).toMatchObject({
      muscle: "Glutes",
      targetStatus: "over_mav",
      recommendedAction: {
        kind: "hold_seed",
        setDelta: 0,
      },
      reasonCode: "over_mav_caution",
      guidance: "over MAV; caution and suppress add-ons",
    });
  });

  it("keeps on-target Hamstrings at hold or avoid-default-reduction instead of auto-reducing", () => {
    const diagnostics = buildRuntimeDoseAdjustmentDiagnostics(
      buildInput({
        completedVolumeByMuscle: {
          Hamstrings: { directSets: 6, indirectSets: 0, effectiveSets: 6 },
        },
        fullWeekByMuscle: [
          {
            muscle: "Hamstrings",
            completedEffectiveSets: 6,
            projectedNextSessionEffectiveSets: 2,
            projectedRemainingWeekEffectiveSets: 0,
            projectedFullWeekEffectiveSets: 8,
            weeklyTarget: 8,
            mev: 6,
            mav: 14,
            mrv: 20,
            deltaToTarget: 0,
            deltaToMev: 2,
            deltaToMav: -6,
          },
        ],
      })
    );

    expect(diagnostics[0]).toMatchObject({
      muscle: "Hamstrings",
      targetStatus: "productive_zone",
      recommendedAction: {
        kind: "avoid_default_reduction",
        exerciseName: "Lying Leg Curl",
        setDelta: 0,
      },
      reasonCode: "hamstrings_on_target_no_default_reduction",
    });
  });

  it("only reduces posterior-chain work when meaningful fatigue and readiness evidence exists", () => {
    const input = buildInput({
      projectedSessions: [
        {
          slotId: "lower_a",
          intent: "lower",
          isNext: true,
          exerciseCount: 2,
          totalSets: 8,
          exercises: [
            {
              exerciseId: "sldl",
              name: "Stiff-Legged Deadlift",
              setCount: 4,
              role: "primary",
              effectiveStimulusByMuscle: {
                Hamstrings: 4,
                Glutes: 2,
                "Lower Back": 1,
              },
            },
            {
              exerciseId: "lying-leg-curl",
              name: "Lying Leg Curl",
              setCount: 2,
              role: "accessory",
              effectiveStimulusByMuscle: { Hamstrings: 2 },
            },
          ],
          movementPatternCounts: { hinge: 1 },
          projectedContributionByMuscle: {
            Hamstrings: 6,
            Glutes: 2,
            "Lower Back": 1,
          },
        },
      ],
      completedVolumeByMuscle: {
        Hamstrings: { directSets: 2, indirectSets: 0, effectiveSets: 2 },
      },
      fullWeekByMuscle: [
        {
          muscle: "Hamstrings",
          completedEffectiveSets: 2,
          projectedNextSessionEffectiveSets: 6,
          projectedRemainingWeekEffectiveSets: 0,
          projectedFullWeekEffectiveSets: 8,
          weeklyTarget: 8,
          mev: 6,
          mav: 14,
          mrv: 20,
          deltaToTarget: 0,
          deltaToMev: 2,
          deltaToMav: -6,
        },
      ],
    });

    const withoutReadinessEvidence = buildRuntimeDoseAdjustmentDiagnostics(input);

    expect(withoutReadinessEvidence[0]).toMatchObject({
      fatigueDensityConcern: {
        level: "watch",
      },
      recommendedAction: {
        kind: "avoid_default_reduction",
        setDelta: 0,
      },
    });

    const withReadinessEvidence = buildRuntimeDoseAdjustmentDiagnostics(input, {
      readinessEvidence: {
        localSorenessMuscles: ["Hamstrings"],
        rationale: "Hamstrings are locally sore before the session.",
      },
      fatigueEvidence: [
        {
          muscle: "Hamstrings",
          slotId: "lower_a",
          exerciseName: "Stiff-Legged Deadlift",
          pattern: "hinge",
          fatigueCost: 4,
          level: "meaningful",
          rationale: "Posterior-chain fatigue is meaningful today.",
        },
      ],
    });

    expect(withReadinessEvidence[0]).toMatchObject({
      fatigueDensityConcern: {
        level: "meaningful",
        drivers: [
          {
            slotId: "lower_a",
            exerciseName: "Stiff-Legged Deadlift",
            pattern: "hinge",
            fatigueCost: 4,
          },
        ],
      },
      recoveryReadinessCaveat: {
        status: "local_soreness",
      },
      recommendedAction: {
        kind: "reduce_set_if_fatigue_meaningful",
        slotId: "lower_a",
        exerciseName: "Stiff-Legged Deadlift",
        setDelta: -1,
      },
      reasonCode: "posterior_fatigue_meaningful",
    });
    expectNonZeroSetDeltaActionsHaveCandidates(withReadinessEvidence);
  });

  it("includes slot and exercise candidates for every reduce-set recommendation", () => {
    const diagnostics = buildRuntimeDoseAdjustmentDiagnostics(
      buildInput({
        projectedSessions: [
          {
            slotId: "lower_b",
            intent: "lower",
            isNext: true,
            exerciseCount: 1,
            totalSets: 4,
            exercises: [
              {
                exerciseId: "sldl",
                name: "Stiff-Legged Deadlift",
                setCount: 4,
                role: "primary",
                effectiveStimulusByMuscle: {
                  Hamstrings: 4,
                  Glutes: 2,
                  "Lower Back": 1,
                },
              },
            ],
            movementPatternCounts: { hinge: 1 },
            projectedContributionByMuscle: {
              Hamstrings: 4,
              Glutes: 2,
              "Lower Back": 1,
            },
          },
        ],
        completedVolumeByMuscle: {
          Hamstrings: { directSets: 4, indirectSets: 0, effectiveSets: 4 },
        },
        fullWeekByMuscle: [
          {
            muscle: "Hamstrings",
            completedEffectiveSets: 4,
            projectedNextSessionEffectiveSets: 4,
            projectedRemainingWeekEffectiveSets: 0,
            projectedFullWeekEffectiveSets: 8,
            weeklyTarget: 8,
            mev: 6,
            mav: 14,
            mrv: 20,
            deltaToTarget: 0,
            deltaToMev: 2,
            deltaToMav: -6,
          },
        ],
      }),
      {
        readinessEvidence: {
          localSorenessMuscles: ["Hamstrings"],
        },
        fatigueEvidence: [
          {
            muscle: "Hamstrings",
            slotId: "lower_b",
            exerciseName: "Stiff-Legged Deadlift",
            pattern: "hinge",
            level: "meaningful",
          },
        ],
      }
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].recommendedAction).toEqual(
      expect.objectContaining({
        kind: "reduce_set_if_fatigue_meaningful",
        slotId: "lower_b",
        exerciseName: "Stiff-Legged Deadlift",
        setDelta: -1,
      })
    );
    expectNonZeroSetDeltaActionsHaveCandidates(diagnostics);
  });

  it("is read-only for every diagnostic and leaves accepted seed-shaped inputs unchanged", () => {
    const acceptedSeed = {
      slots: [
        {
          slotId: "lower_a",
          exercises: [
            { exerciseId: "belt-squat", role: "CORE_COMPOUND", setCount: 4 },
            { exerciseId: "leg-extension", role: "ACCESSORY", setCount: 2 },
          ],
        },
      ],
    };
    const input = buildInput({
      fullWeekByMuscle: [
        {
          muscle: "Quads",
          completedEffectiveSets: 5,
          projectedNextSessionEffectiveSets: 6,
          projectedRemainingWeekEffectiveSets: 0,
          projectedFullWeekEffectiveSets: 11,
          weeklyTarget: 12,
          mev: 8,
          mav: 16,
          deltaToTarget: -1,
          deltaToMev: 3,
          deltaToMav: -5,
        },
        {
          muscle: "Glutes",
          completedEffectiveSets: 0,
          projectedNextSessionEffectiveSets: 2,
          projectedRemainingWeekEffectiveSets: 0,
          projectedFullWeekEffectiveSets: 2,
          weeklyTarget: 2,
          mev: 0,
          mav: 12,
          deltaToTarget: 0,
          deltaToMev: 2,
          deltaToMav: -10,
        },
      ],
    });
    const inputBefore = JSON.parse(JSON.stringify(input));
    const seedBefore = JSON.parse(JSON.stringify(acceptedSeed));

    const diagnostics = buildRuntimeDoseAdjustmentDiagnostics(input);

    expect(input).toEqual(inputBefore);
    expect(acceptedSeed).toEqual(seedBefore);
    expect(diagnostics).toHaveLength(2);
    expect(diagnostics.every((diagnostic) => diagnostic.readOnly)).toBe(true);
    expect(diagnostics.every((diagnostic) => !diagnostic.affectsAcceptedSeed)).toBe(
      true
    );
  });
});
