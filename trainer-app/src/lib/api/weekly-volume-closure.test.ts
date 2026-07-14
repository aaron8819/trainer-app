import { describe, expect, it } from "vitest";
import type {
  ProjectedWeekVolumeMuscleRow,
  ProjectedWeekVolumeSessionSummary,
} from "./projected-week-volume";
import {
  MIN_MEANINGFUL_FUTURE_EFFECTIVE_SETS,
  buildWeeklyMuscleClosureDecisions,
  type WeeklyMuscleClosureDecision,
} from "./weekly-volume-closure";

function muscleRow(
  muscle: string,
  overrides: Partial<ProjectedWeekVolumeMuscleRow> = {}
): ProjectedWeekVolumeMuscleRow {
  const mev = overrides.mev ?? 6;
  const completedEffectiveSets = overrides.completedEffectiveSets ?? 3;
  const projectedNextSessionEffectiveSets =
    overrides.projectedNextSessionEffectiveSets ?? 2;
  const projectedRemainingWeekEffectiveSets =
    overrides.projectedRemainingWeekEffectiveSets ?? 0;
  const projectedFullWeekEffectiveSets =
    overrides.projectedFullWeekEffectiveSets ??
    completedEffectiveSets +
      projectedNextSessionEffectiveSets +
      projectedRemainingWeekEffectiveSets;
  const mav = overrides.mav ?? 14;
  const weeklyTarget = overrides.weeklyTarget ?? 10;

  return {
    muscle,
    targetKind: "hard",
    targetTier: "A_PRIMARY",
    warningSeverity: "hard",
    completedEffectiveSets,
    projectedNextSessionEffectiveSets,
    projectedRemainingWeekEffectiveSets,
    projectedFullWeekEffectiveSets,
    weeklyTarget,
    mev,
    mav,
    mrv: overrides.mrv ?? 20,
    deltaToTarget: projectedFullWeekEffectiveSets - weeklyTarget,
    deltaToMev: projectedFullWeekEffectiveSets - mev,
    deltaToMav: projectedFullWeekEffectiveSets - mav,
    ...overrides,
  };
}

function session(input: {
  slotId: string;
  isNext: boolean;
  muscle?: string;
  contribution?: number;
  exerciseId?: string;
  exerciseName?: string;
  movementPatterns?: string[];
  effectiveStimulusByMuscle?: Record<string, number>;
  movementPatternCounts?: Record<string, number>;
  availability?: ProjectedWeekVolumeSessionSummary["availability"];
  evidenceSource?: ProjectedWeekVolumeSessionSummary["evidenceSource"];
  evidenceReliable?: boolean;
}): ProjectedWeekVolumeSessionSummary {
  const muscle = input.muscle ?? "Chest";
  const contribution = input.contribution ?? 2;
  const exerciseId = input.exerciseId ?? "candidate";
  const exerciseName = input.exerciseName ?? "Cable Fly";

  return {
    slotId: input.slotId,
    intent: "upper",
    isNext: input.isNext,
    exerciseCount: 1,
    totalSets: 2,
    availability: input.availability ?? "available",
    evidenceSource: input.evidenceSource ?? "accepted_seed_runtime_projection",
    evidenceReliable: input.evidenceReliable ?? true,
    movementPatternCounts: input.movementPatternCounts,
    exercises: [
      {
        exerciseId,
        name: exerciseName,
        setCount: 2,
        role: "accessory",
        movementPatterns: input.movementPatterns ?? ["isolation"],
        effectiveStimulusByMuscle:
          input.effectiveStimulusByMuscle ?? { [muscle]: contribution },
      },
    ],
    projectedContributionByMuscle: { [muscle]: contribution },
  };
}

function decisions(input: {
  rows: ProjectedWeekVolumeMuscleRow[];
  sessions: ProjectedWeekVolumeSessionSummary[];
  hardSuppressionReasonsByMuscle?: Record<string, string[]>;
}): WeeklyMuscleClosureDecision[] {
  return buildWeeklyMuscleClosureDecisions({
    fullWeekByMuscle: input.rows,
    projectedSessions: input.sessions,
    hardSuppressionReasonsByMuscle:
      input.hardSuppressionReasonsByMuscle ?? {},
  });
}

const ELIGIBLE_TARGETS = [
  ["Chest", "cable-fly", "Cable Fly", ["isolation"]],
  ["Lats", "lat-pulldown", "Lat Pulldown", ["vertical_pull"]],
  ["Upper Back", "cable-row", "Seated Cable Row", ["horizontal_pull"]],
  ["Quads", "leg-extension", "Leg Extension", ["isolation"]],
  ["Hamstrings", "leg-curl", "Seated Leg Curl", ["isolation"]],
  ["Glutes", "glute-kickback", "Cable Glute Kickback", ["isolation"]],
  ["Side Delts", "lateral-raise", "Cable Lateral Raise", ["isolation"]],
  ["Rear Delts", "rear-delt-fly", "Rear Delt Fly", ["isolation"]],
  ["Biceps", "curl", "Cable Curl", ["isolation"]],
  ["Triceps", "pushdown", "Cable Triceps Pushdown", ["isolation"]],
  ["Calves", "calf-raise", "Standing Calf Raise", ["isolation"]],
] as const;

describe("buildWeeklyMuscleClosureDecisions", () => {
  it.each(ELIGIBLE_TARGETS)(
    "emits one coherent eligible decision for %s",
    (muscle, exerciseId, exerciseName, movementPatterns) => {
      const [decision] = decisions({
        rows: [muscleRow(muscle)],
        sessions: [
          session({
            slotId: "current",
            isNext: true,
            muscle,
            exerciseId,
            exerciseName,
            movementPatterns: [...movementPatterns],
          }),
        ],
      });

      expect(decision).toMatchObject({
        muscle,
        status: "eligible",
        evidence: {
          performedEffectiveSets: 3,
          projectedCurrentSessionEffectiveSets: 2,
          projectedLaterEffectiveSets: 0,
          projectedWeekEffectiveSets: 5,
          mev: 6,
          deficitToMev: 1,
        },
        opportunity: {
          isFinalMeaningfulOpportunity: true,
          laterContributingSlots: [],
        },
        recommendation: {
          exerciseId,
          exerciseName,
          additionalSets: 1,
          projectedContribution: 1,
        },
      });
      expect(decision.constraints.hardSuppressed).toBe(false);
      expect(decision.recommendation?.additionalSets).toBeGreaterThan(0);
      expect(decision.recommendation?.projectedContribution).toBeGreaterThan(0);
      expect(decision.constraints.forbiddenExerciseIds).not.toContain(exerciseId);
      expect(decision.constraints.forbiddenMovementClasses).not.toContain(
        decision.recommendation?.movementClass
      );
    }
  );

  it("defers closure for a later meaningful target contribution, including fractional stimulus", () => {
    expect(MIN_MEANINGFUL_FUTURE_EFFECTIVE_SETS).toBeGreaterThan(0);

    const [meaningful] = decisions({
      rows: [
        muscleRow("Upper Back", {
          projectedRemainingWeekEffectiveSets:
            MIN_MEANINGFUL_FUTURE_EFFECTIVE_SETS,
          projectedFullWeekEffectiveSets:
            5 + MIN_MEANINGFUL_FUTURE_EFFECTIVE_SETS,
        }),
      ],
      sessions: [
        session({
          slotId: "upper_a",
          isNext: true,
          muscle: "Upper Back",
          exerciseName: "Seated Cable Row",
          movementPatterns: ["horizontal_pull"],
        }),
        session({
          slotId: "upper_b",
          isNext: false,
          muscle: "Upper Back",
          contribution: MIN_MEANINGFUL_FUTURE_EFFECTIVE_SETS,
          exerciseName: "Face Pull",
          movementPatterns: ["horizontal_pull"],
        }),
      ],
    });

    expect(meaningful).toMatchObject({
      status: "not_final_opportunity",
      opportunity: {
        isFinalMeaningfulOpportunity: false,
        laterContributingSlots: [
          {
            slotId: "upper_b",
            projectedContribution: MIN_MEANINGFUL_FUTURE_EFFECTIVE_SETS,
          },
        ],
      },
    });

    const [trivial] = decisions({
      rows: [muscleRow("Upper Back")],
      sessions: [
        session({
          slotId: "upper_a",
          isNext: true,
          muscle: "Upper Back",
          exerciseName: "Seated Cable Row",
          movementPatterns: ["horizontal_pull"],
        }),
        session({
          slotId: "upper_b",
          isNext: false,
          muscle: "Upper Back",
          contribution: MIN_MEANINGFUL_FUTURE_EFFECTIVE_SETS - 0.1,
          exerciseName: "Lat Pulldown",
          movementPatterns: ["vertical_pull"],
        }),
      ],
    });

    expect(trivial.status).toBe("eligible");
    expect(trivial.opportunity.laterContributingSlots).toEqual([]);
  });

  it("does not defer closure for a generic upper slot with zero target stimulus", () => {
    const [decision] = decisions({
      rows: [muscleRow("Lats")],
      sessions: [
        session({
          slotId: "upper_a",
          isNext: true,
          muscle: "Lats",
          exerciseName: "Lat Pulldown",
          movementPatterns: ["vertical_pull"],
        }),
        session({
          slotId: "upper_b",
          isNext: false,
          muscle: "Chest",
          exerciseName: "Cable Fly",
        }),
      ],
    });

    expect(decision.status).toBe("eligible");
    expect(decision.opportunity.laterContributingSlots).toEqual([]);
  });

  it.each(["completed", "skipped", "unavailable"] as const)(
    "ignores a later %s session as an opportunity",
    (availability) => {
      const [decision] = decisions({
        rows: [muscleRow("Lats")],
        sessions: [
          session({
            slotId: "upper_a",
            isNext: true,
            muscle: "Lats",
            exerciseName: "Lat Pulldown",
            movementPatterns: ["vertical_pull"],
          }),
          session({
            slotId: "upper_b",
            isNext: false,
            muscle: "Lats",
            contribution: 3,
            exerciseName: "Chest-Supported Row",
            movementPatterns: ["horizontal_pull"],
            availability,
          }),
        ],
      });

      expect(decision.status).toBe("eligible");
    }
  );

  it("counts an available accepted-seed future slot and preserves its evidence source", () => {
    const [decision] = decisions({
      rows: [
        muscleRow("Lats", {
          projectedRemainingWeekEffectiveSets: 3,
          projectedFullWeekEffectiveSets: 8,
          mev: 9,
        }),
      ],
      sessions: [
        session({
          slotId: "upper_a",
          isNext: true,
          muscle: "Lats",
          exerciseName: "Lat Pulldown",
          movementPatterns: ["vertical_pull"],
        }),
        session({
          slotId: "upper_b",
          isNext: false,
          muscle: "Lats",
          contribution: 3,
          exerciseName: "Chest-Supported Row",
          movementPatterns: ["horizontal_pull"],
          evidenceSource: "accepted_seed_runtime_projection",
        }),
      ],
    });

    expect(decision.opportunity.laterContributingSlots[0]).toMatchObject({
      slotId: "upper_b",
      projectedContribution: 3,
      evidenceSource: "accepted_seed_runtime_projection",
    });
  });

  it("uses a reliable immutable current-workout snapshot for an in-progress final opportunity", () => {
    const [decision] = decisions({
      rows: [muscleRow("Biceps")],
      sessions: [
        session({
          slotId: "upper_b",
          isNext: true,
          muscle: "Biceps",
          exerciseName: "Cable Curl",
          evidenceSource: "immutable_workout_snapshot",
        }),
      ],
    });

    expect(decision.status).toBe("eligible");
    expect(decision.opportunity.currentEvidenceSource).toBe(
      "immutable_workout_snapshot"
    );
  });

  it("includes performed sets from reliable incomplete workouts in closure evidence", () => {
    const [decision] = decisions({
      rows: [
        muscleRow("Biceps", {
          completedEffectiveSets: 3,
          incompletePerformedEffectiveSets: 1.5,
        }),
      ],
      sessions: [
        session({
          slotId: "upper_b",
          isNext: true,
          muscle: "Biceps",
          exerciseName: "Cable Curl",
          evidenceSource: "immutable_workout_snapshot",
        }),
      ],
    });

    expect(decision.evidence.performedEffectiveSets).toBe(4.5);
  });

  it("fails closed when current materialized evidence is unreliable", () => {
    const [decision] = decisions({
      rows: [muscleRow("Biceps")],
      sessions: [
        session({
          slotId: "upper_b",
          isNext: true,
          muscle: "Biceps",
          exerciseName: "Cable Curl",
          evidenceSource: "immutable_workout_snapshot",
          evidenceReliable: false,
        }),
      ],
    });

    expect(decision).toMatchObject({
      status: "suppressed",
      constraints: {
        hardSuppressed: true,
        reasons: expect.arrayContaining(["insufficient_current_session_evidence"]),
      },
    });
    expect(decision.recommendation).toBeUndefined();
  });

  it("filters first and ranks a chest fly over forbidden pressing", () => {
    const current = session({
      slotId: "upper_b",
      isNext: true,
      muscle: "Chest",
      exerciseId: "machine-press",
      exerciseName: "Machine Chest Press",
      movementPatterns: ["horizontal_push"],
      effectiveStimulusByMuscle: { Chest: 4, Triceps: 2 },
    });
    current.exercises?.push({
      exerciseId: "pec-deck",
      name: "Pec Deck",
      setCount: 2,
      role: "accessory",
      movementPatterns: ["isolation"],
      effectiveStimulusByMuscle: { Chest: 2 },
    });

    const [decision] = decisions({
      rows: [muscleRow("Chest")],
      sessions: [current],
    });

    expect(decision).toMatchObject({
      status: "eligible",
      constraints: {
        forbiddenMovementClasses: expect.arrayContaining(["horizontal_push"]),
        forbiddenExerciseIds: expect.arrayContaining(["machine-press"]),
      },
      recommendation: {
        exerciseId: "pec-deck",
        exerciseName: "Pec Deck",
        movementClass: "isolation",
      },
    });
  });

  it.each([
    ["Lats", "Lat Pulldown", "vertical_pull"],
    ["Upper Back", "Seated Cable Row", "horizontal_pull"],
  ] as const)(
    "returns no_valid_candidate for %s when the candidate violates the active pull restriction",
    (muscle, exerciseName, movementClass) => {
      const [decision] = decisions({
        rows: [muscleRow(muscle)],
        sessions: [
          session({
            slotId: "upper_b",
            isNext: true,
            muscle,
            exerciseName,
            movementPatterns: [movementClass],
            movementPatternCounts: {
              horizontal_pull: 2,
              vertical_pull: 2,
            },
          }),
        ],
      });

      expect(decision).toMatchObject({
        status: "no_valid_candidate",
        constraints: {
          forbiddenMovementClasses: expect.arrayContaining([
            "horizontal_pull",
            "vertical_pull",
          ]),
        },
      });
      expect(decision.recommendation).toBeUndefined();
    }
  );

  it("filters pressing for Triceps but permits a pushdown alternative", () => {
    const current = session({
      slotId: "upper_b",
      isNext: true,
      muscle: "Triceps",
      exerciseId: "close-grip-bench",
      exerciseName: "Close-Grip Bench Press",
      movementPatterns: ["horizontal_push"],
    });
    current.exercises?.push({
      exerciseId: "pushdown",
      name: "Cable Triceps Pushdown",
      setCount: 2,
      role: "accessory",
      movementPatterns: ["isolation"],
      effectiveStimulusByMuscle: { Triceps: 2 },
    });

    const [decision] = decisions({
      rows: [muscleRow("Triceps")],
      sessions: [current],
    });

    expect(decision.recommendation?.exerciseId).toBe("pushdown");
    expect(decision.constraints.forbiddenExerciseIds).toContain(
      "close-grip-bench"
    );
  });

  it("hard suppression always wins over an otherwise valid recommendation", () => {
    const [decision] = decisions({
      rows: [muscleRow("Rear Delts")],
      sessions: [
        session({
          slotId: "upper_b",
          isNext: true,
          muscle: "Rear Delts",
          exerciseName: "Rear Delt Fly",
        }),
      ],
      hardSuppressionReasonsByMuscle: {
        "Rear Delts": ["local_soreness"],
      },
    });

    expect(decision).toMatchObject({
      status: "suppressed",
      constraints: {
        hardSuppressed: true,
        reasons: expect.arrayContaining(["local_soreness"]),
      },
    });
    expect(decision.recommendation).toBeUndefined();
  });

  it("applies already-covered and later-opportunity checks before hard suppression", () => {
    const covered = decisions({
      rows: [
        muscleRow("Chest", {
          projectedFullWeekEffectiveSets: 6,
          mev: 6,
        }),
      ],
      sessions: [session({ slotId: "upper_a", isNext: true })],
      hardSuppressionReasonsByMuscle: { Chest: ["local_soreness"] },
    })[0];
    const deferred = decisions({
      rows: [
        muscleRow("Chest", {
          projectedRemainingWeekEffectiveSets: 2,
          projectedFullWeekEffectiveSets: 5,
        }),
      ],
      sessions: [
        session({ slotId: "upper_a", isNext: true }),
        session({ slotId: "upper_b", isNext: false }),
      ],
      hardSuppressionReasonsByMuscle: { Chest: ["local_soreness"] },
    })[0];

    expect(covered.status).toBe("not_needed");
    expect(covered.constraints.hardSuppressed).toBe(true);
    expect(deferred.status).toBe("not_final_opportunity");
    expect(deferred.constraints.hardSuppressed).toBe(true);
    expect(covered.recommendation).toBeUndefined();
    expect(deferred.recommendation).toBeUndefined();
  });

  it("rejects a candidate that adds stimulus to another hard-suppressed muscle", () => {
    const [decision] = decisions({
      rows: [muscleRow("Lats"), muscleRow("Biceps")],
      sessions: [
        session({
          slotId: "upper_b",
          isNext: true,
          muscle: "Lats",
          exerciseName: "Lat Pulldown",
          movementPatterns: ["vertical_pull"],
          effectiveStimulusByMuscle: { Lats: 2, Biceps: 1 },
        }),
      ],
      hardSuppressionReasonsByMuscle: {
        Biceps: ["local_soreness"],
      },
    });

    expect(decision).toMatchObject({
      muscle: "Lats",
      status: "no_valid_candidate",
      constraints: {
        reasons: expect.arrayContaining(["collateral_hard_suppression:Biceps"]),
      },
    });
  });

  it("returns not_needed without a recommendation when the target is already at MEV", () => {
    const result = decisions({
      rows: [
        muscleRow("Side Delts", {
          completedEffectiveSets: 4,
          projectedNextSessionEffectiveSets: 2,
          projectedFullWeekEffectiveSets: 6,
          mev: 6,
        }),
        muscleRow("Rear Delts", {
          completedEffectiveSets: 4,
          projectedNextSessionEffectiveSets: 2,
          projectedFullWeekEffectiveSets: 6,
          mev: 6,
        }),
      ],
      sessions: [
        session({
          slotId: "upper_b",
          isNext: true,
          muscle: "Side Delts",
          exerciseName: "Cable Lateral Raise",
        }),
      ],
    });

    expect(result.map((decision) => decision.status)).toEqual([
      "not_needed",
      "not_needed",
    ]);
    expect(result.every((decision) => decision.recommendation == null)).toBe(
      true
    );
  });

  it("is deterministic and never emits a recommendation that violates its own decision", () => {
    const input = {
      rows: ELIGIBLE_TARGETS.map(([muscle]) => muscleRow(muscle)),
      sessions: ELIGIBLE_TARGETS.map(
        ([muscle, exerciseId, exerciseName, movementPatterns], index) =>
          session({
            slotId: "current",
            isNext: index === 0,
            muscle,
            exerciseId,
            exerciseName,
            movementPatterns: [...movementPatterns],
          })
      ),
    };

    const first = decisions(input);
    const second = decisions(input);

    expect(second).toEqual(first);
    for (const decision of first) {
      if (!decision.recommendation) {
        continue;
      }
      expect(decision.status).toBe("eligible");
      expect(decision.opportunity.isFinalMeaningfulOpportunity).toBe(true);
      expect(decision.constraints.hardSuppressed).toBe(false);
      expect(decision.recommendation.additionalSets).toBeGreaterThan(0);
      expect(decision.recommendation.projectedContribution).toBeGreaterThan(0);
      expect(decision.constraints.forbiddenExerciseIds).not.toContain(
        decision.recommendation.exerciseId
      );
      expect(decision.constraints.forbiddenMovementClasses).not.toContain(
        decision.recommendation.movementClass
      );
    }
  });
});
