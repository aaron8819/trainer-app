import { describe, expect, it, vi } from "vitest";
import { buildV2MesocycleStrategyDiagnostic } from "@/lib/engine/planning/v2";
import type { ReadinessSignal } from "@/lib/engine/readiness/types";
import type { MesocycleHandoffSummary } from "./mesocycle-handoff-contract";
import type { MesocycleReviewData } from "./mesocycle-review";
import {
  buildV2MesocycleStrategyInputFromReadModels,
  loadV2MesocycleStrategyHistoricalReviewEvidence,
} from "./v2-mesocycle-strategy-input-adapter";

function makeHandoffSummary(): MesocycleHandoffSummary {
  return {
    version: 1,
    mesocycleId: "meso-future-user-1",
    macroCycleId: "macro-future-user-1",
    mesoNumber: 2,
    closedAt: "2026-04-01T00:00:00.000Z",
    lifecycle: {
      terminalState: "AWAITING_HANDOFF",
      durationWeeks: 5,
      accumulationSessionsCompleted: 16,
      deloadSessionsCompleted: 1,
      deloadExcludedFromNextBaseline: true,
    },
    training: {
      focus: "Hypertrophy",
      splitType: "UPPER_LOWER",
      sessionsPerWeek: 4,
      daysPerWeek: 4,
      weeklySequence: ["UPPER", "LOWER", "UPPER", "LOWER"],
    },
    carryForwardRecommendations: [],
    recommendedNextSeed: {
      version: 1,
      sourceMesocycleId: "meso-future-user-1",
      createdAt: "2026-04-01T00:00:00.000Z",
      structure: {
        splitType: "UPPER_LOWER",
        sessionsPerWeek: 4,
        daysPerWeek: 4,
        sequenceMode: "ordered_flexible",
        slots: [
          { slotId: "upper_a", intent: "UPPER" },
          { slotId: "lower_a", intent: "LOWER" },
        ],
      },
      startingPoint: {
        volumeEntry: "conservative",
        baselineSource: "accumulation_preferred",
        allowNonDeloadFallback: true,
      },
      carryForwardSelections: [],
    },
    recommendedDesign: {
      version: 1,
      designedAt: "2026-04-01T00:00:00.000Z",
      sourceMesocycleId: "meso-future-user-1",
      profile: {
        focus: "Hypertrophy",
        durationWeeks: 5,
        volumeTarget: "MODERATE",
        intensityBias: "HYPERTROPHY",
        blocks: [
          {
            blockNumber: 1,
            blockType: "ACCUMULATION",
            durationWeeks: 4,
            volumeTarget: "MODERATE",
            intensityBias: "HYPERTROPHY",
            adaptationType: "SARCOPLASMIC_HYPERTROPHY",
          },
        ],
      },
      structure: {
        splitType: "UPPER_LOWER",
        sessionsPerWeek: 4,
        daysPerWeek: 4,
        sequenceMode: "ordered_flexible",
        slots: [
          {
            slotId: "upper_a",
            intent: "UPPER",
            authoredSemantics: {
              slotArchetype: "upper_horizontal_balanced",
              primaryLaneContract: null,
              supportCoverageContract: null,
              continuityScope: "slot",
            },
          },
          {
            slotId: "lower_a",
            intent: "LOWER",
            authoredSemantics: {
              slotArchetype: "lower_squat_dominant",
              primaryLaneContract: null,
              supportCoverageContract: null,
              continuityScope: "slot",
            },
          },
        ],
      },
      carryForward: { decisions: [] },
      startingPoint: {
        volumeEntry: "conservative",
        baselineSource: "accumulation_preferred",
        allowNonDeloadFallback: true,
      },
      explainability: {
        profileReasonCodes: ["profile_reused_with_constraints"],
        profileSignalQuality: "medium",
        structureReasonCodes: ["preferred_upper_lower_honored"],
        structureSignalQuality: "medium",
        startingPointReasonCodes: ["conservative_after_deload"],
        startingPointSignalQuality: "medium",
      },
    },
  };
}

function makeReview(): MesocycleReviewData {
  return {
    mesocycleId: "meso-future-user-1",
    mesoNumber: 2,
    focus: "Hypertrophy",
    closedAt: "2026-04-01T00:00:00.000Z",
    archive: {
      currentState: "COMPLETED",
      reviewState: "historical_closeout",
      isEditableHandoff: false,
    },
    frozenSummary: makeHandoffSummary(),
    recommendation: {} as MesocycleReviewData["recommendation"],
    derived: {
      scopedWorkoutCount: 17,
      performedWorkoutCount: 16,
      adherence: {
        plannedSessions: 16,
        performedSessions: 15,
        coreCompletedSessions: 14,
        partialSessions: 1,
        skippedSessions: 1,
        adherenceRate: 0.938,
        completionRate: 0.875,
        optionalPerformedSessions: 1,
      },
      weeklyBreakdown: [],
      topProgressedExercises: [
        {
          exerciseId: "incline-db-press",
          exerciseName: "Incline Dumbbell Press",
          sessionIntent: "UPPER",
          exposureCount: 3,
          signal: "estimated_strength",
          changePct: 0.06,
          summary: "Estimated strength up 6% across 3 exposures.",
          latestBestSet: "8 reps @ 80 lb",
        },
      ],
      muscleVolumeSummary: [
        {
          muscle: "Chest",
          targetSets: 40,
          actualEffectiveSets: 37,
          delta: -3,
          percentDelta: -0.075,
          status: "on_target",
          topContributors: [
            {
              exerciseId: "incline-db-press",
              exerciseName: "Incline Dumbbell Press",
              effectiveSets: 16,
            },
          ],
        },
        {
          muscle: "Side Delts",
          targetSets: 20,
          actualEffectiveSets: 12,
          delta: -8,
          percentDelta: -0.4,
          status: "meaningfully_low",
          topContributors: [],
        },
      ],
    },
  };
}

function makeReadiness(): ReadinessSignal {
  return {
    timestamp: new Date("2026-04-02T12:00:00.000Z"),
    userId: "future-user-1",
    subjective: {
      readiness: 2,
      motivation: 3,
      soreness: { shoulder: 2, quads: 1 },
      stress: 3,
    },
    performance: {
      rpeDeviation: 1.2,
      stallCount: 1,
      volumeComplianceRate: 0.75,
    },
  };
}

function makeLegacySeedJson(exerciseId = "old-prescribed-plan-only") {
  return {
    version: 1,
    slots: [
      {
        slotId: "upper_a",
        exercises: [
          {
            exerciseId,
            role: "CORE_COMPOUND",
            setCount: 3,
          },
        ],
      },
    ],
  };
}

function makeHistoricalDbRow(input: {
  id: string;
  mesoNumber: number;
  closedAt: string;
  validReview?: boolean;
  slotPlanSeedJson?: unknown;
}) {
  const handoffSummary = makeHandoffSummary();
  return {
    id: input.id,
    state: "COMPLETED",
    mesoNumber: input.mesoNumber,
    focus: "Hypertrophy",
    closedAt: new Date(input.closedAt),
    handoffSummaryJson:
      input.validReview === false
        ? null
        : {
            ...handoffSummary,
            mesocycleId: input.id,
            closedAt: input.closedAt,
          },
    nextSeedDraftJson: null,
    startWeek: input.mesoNumber * 5,
    durationWeeks: 5,
    sessionsPerWeek: 4,
    slotPlanSeedJson:
      input.slotPlanSeedJson === undefined
        ? makeLegacySeedJson()
        : input.slotPlanSeedJson,
    macroCycle: {
      startDate: new Date("2026-01-01T00:00:00.000Z"),
    },
    blocks: [],
  };
}

function makeHistoricalWorkout(input: {
  id: string;
  scheduledDate: string;
  status: "COMPLETED" | "SKIPPED";
  load?: number;
  reps?: number;
  rpe?: number;
  week?: number;
  phase?: "ACCUMULATION" | "DELOAD";
  skippedSetCount?: number;
  exerciseId?: string;
  exerciseName?: string;
  primaryMuscles?: string[];
}) {
  const exerciseId = input.exerciseId ?? "performed-reality-press";
  const exerciseName = input.exerciseName ?? "Performed Reality Press";
  const primaryMuscles = input.primaryMuscles ?? ["Chest"];
  const completedSets =
    input.status === "COMPLETED"
      ? [
          {
            setIndex: 0,
            logs: [
              {
                wasSkipped: false,
                actualReps: input.reps ?? 8,
                actualLoad: input.load ?? 80,
                actualRpe: input.rpe ?? 8,
              },
            ],
          },
          {
            setIndex: 1,
            logs: [
              {
                wasSkipped: false,
                actualReps: input.reps ?? 8,
                actualLoad: input.load ?? 80,
                actualRpe: input.rpe ?? 8,
              },
            ],
          },
        ]
      : [];
  const skippedSets = Array.from(
    { length: input.skippedSetCount ?? 0 },
    (_, index) => ({
      setIndex: completedSets.length + index,
      logs: [
        {
          wasSkipped: true,
          actualReps: null,
          actualLoad: null,
          actualRpe: null,
        },
      ],
    }),
  );

  return {
    id: input.id,
    scheduledDate: new Date(input.scheduledDate),
    completedAt:
      input.status === "COMPLETED" ? new Date(input.scheduledDate) : null,
    status: input.status,
    sessionIntent: "UPPER",
    selectionMode: "INTENT",
    selectionMetadata: null,
    advancesSplit: true,
    mesocyclePhaseSnapshot: input.phase ?? "ACCUMULATION",
    mesocycleWeekSnapshot: input.week ?? 1,
    exercises:
      input.status === "COMPLETED" || skippedSets.length > 0
        ? [
            {
              exerciseId,
              exercise: {
                id: exerciseId,
                name: exerciseName,
                aliases: [],
                exerciseMuscles: primaryMuscles.map((muscle) => ({
                    role: "PRIMARY",
                    muscle: { name: muscle },
                  })),
              },
              sets: [...completedSets, ...skippedSets],
            },
          ]
        : [],
  };
}

function makeHistoricalReader(input: {
  rows: Array<ReturnType<typeof makeHistoricalDbRow>>;
  workoutsByMesocycle: Record<string, unknown[]>;
}) {
  return {
    mesocycle: {
      findMany: vi.fn(async () => input.rows),
      findFirst: vi.fn(async (args: { where?: { id?: string } }) => {
        const id = args.where?.id;
        return input.rows.find((row) => row.id === id) ?? null;
      }),
    },
    workout: {
      findMany: vi.fn(async (args: { where?: { mesocycleId?: string } }) => {
        const mesocycleId = args.where?.mesocycleId ?? "";
        return input.workoutsByMesocycle[mesocycleId] ?? [];
      }),
    },
  };
}

describe("buildV2MesocycleStrategyInputFromReadModels", () => {
  it("labels missing evidence honestly instead of fabricating profile, history, or readiness", () => {
    const input = buildV2MesocycleStrategyInputFromReadModels({});

    expect(input).toMatchObject({
      version: 1,
      userProfile: {
        confidence: "low",
      },
      currentTrainingContext: {},
      historicalMesocycles: [],
    });
    expect(input.readinessAndRecoverySignals.available).toEqual([]);
    expect(input.readinessAndRecoverySignals.missing).toEqual(
      expect.arrayContaining([
        "latest_readiness_signal",
        "wearable_recovery_signal",
      ]),
    );
    expect(input.evidenceLimitations).toEqual(
      expect.arrayContaining([
        "user_profile_evidence_missing",
        "historical_mesocycle_review_missing",
        "readiness_signal_missing_or_stale",
        "strategy_input_does_not_feed_mesocycle_demand",
      ]),
    );
  });

  it("maps handoff, review, profile, and readiness evidence into an owner-agnostic DTO", () => {
    const input = buildV2MesocycleStrategyInputFromReadModels({
      userProfile: {
        trainingGoal: "hypertrophy",
        trainingAge: "advanced",
        availableTrainingDays: 4,
        equipmentProfile: ["cable", "dumbbell"],
        constraints: ["split:upper_lower", "sessions_per_week:4"],
        preferences: ["favorite_exercise_count:2"],
        painOrToleranceFlags: ["shoulder_history"],
      },
      handoffSummary: makeHandoffSummary(),
      historicalMesocycleReviews: [
        {
          review: makeReview(),
          sourcePlanner: "legacy_projection",
        },
      ],
      readiness: makeReadiness(),
    });

    expect(input.userProfile).toMatchObject({
      trainingGoal: "hypertrophy",
      trainingAge: "advanced",
      availableTrainingDays: 4,
      confidence: "high",
    });
    expect(input.currentTrainingContext).toMatchObject({
      split: "upper_lower",
      currentMesocycleStatus: "AWAITING_HANDOFF",
      weekCount: 5,
      slotSequence: ["upper_a", "lower_a"],
      volumeTarget: "MODERATE",
      intensityBias: "HYPERTROPHY",
    });
    expect(input.historicalMesocycles).toHaveLength(1);
    expect(input.historicalMesocycles[0]).toMatchObject({
      mesocycleId: "meso-future-user-1",
      sourcePlanner: "legacy_projection",
      adherenceSummary: {
        plannedSessions: 16,
        completedSessions: 14,
        partialSessions: 1,
        skippedSessions: 1,
      },
      performedVolumeSummary: expect.arrayContaining([
        expect.objectContaining({
          muscle: "Chest",
          performedSets: 37,
          status: "within",
        }),
        expect.objectContaining({
          muscle: "Side Delts",
          status: "under",
        }),
      ]),
      performanceSignals: [
        expect.objectContaining({
          exerciseId: "incline-db-press",
          signal: "progressed",
          confidence: "medium",
        }),
      ],
    });
    expect(input.readinessAndRecoverySignals).toMatchObject({
      available: expect.arrayContaining([
        "subjective_readiness",
        "performance_stalls",
      ]),
      fatigueFlags: expect.arrayContaining([
        "low_subjective_readiness",
        "performance_stalls:1",
      ]),
      painFlags: ["soreness:shoulder:2"],
    });
    expect(input.evidenceLimitations).toContain(
      "historical_mesocycles_are_validation_data_not_policy_targets",
    );
    expect(JSON.stringify(input)).not.toContain("aaron8819@gmail.com");
    expect(JSON.stringify(input)).not.toContain("ownerEmail");
  });
});

describe("loadV2MesocycleStrategyHistoricalReviewEvidence", () => {
  it("loads multiple legacy historical mesocycles as performed evidence without owner-specific policy", async () => {
    const reader = makeHistoricalReader({
      rows: [
        makeHistoricalDbRow({
          id: "historical-1",
          mesoNumber: 1,
          closedAt: "2026-03-01T00:00:00.000Z",
        }),
        makeHistoricalDbRow({
          id: "historical-2",
          mesoNumber: 2,
          closedAt: "2026-04-01T00:00:00.000Z",
        }),
      ],
      workoutsByMesocycle: {
        "historical-1": [
          makeHistoricalWorkout({
            id: "historical-1-session-1",
            scheduledDate: "2026-02-01T00:00:00.000Z",
            status: "COMPLETED",
            load: 80,
          }),
          makeHistoricalWorkout({
            id: "historical-1-session-2",
            scheduledDate: "2026-02-08T00:00:00.000Z",
            status: "COMPLETED",
            load: 90,
          }),
          makeHistoricalWorkout({
            id: "historical-1-session-3",
            scheduledDate: "2026-02-15T00:00:00.000Z",
            status: "SKIPPED",
          }),
        ],
        "historical-2": [
          makeHistoricalWorkout({
            id: "historical-2-session-1",
            scheduledDate: "2026-03-01T00:00:00.000Z",
            status: "COMPLETED",
            load: 85,
          }),
          makeHistoricalWorkout({
            id: "historical-2-session-2",
            scheduledDate: "2026-03-08T00:00:00.000Z",
            status: "COMPLETED",
            load: 95,
          }),
        ],
      },
    });

    const loaded = await loadV2MesocycleStrategyHistoricalReviewEvidence(
      reader as unknown as Parameters<
        typeof loadV2MesocycleStrategyHistoricalReviewEvidence
      >[0],
      { userId: "future-user-1" },
    );
    const input = buildV2MesocycleStrategyInputFromReadModels({
      historicalMesocycleReviews: loaded.historicalMesocycleReviews,
      evidenceLimitations: loaded.evidenceLimitations,
    });
    const diagnostic = buildV2MesocycleStrategyDiagnostic({
      strategyInput: input,
    });

    expect(loaded.historicalMesocycleReviews).toHaveLength(2);
    expect(input.historicalMesocycles.map((row) => row.sourcePlanner)).toEqual([
      "legacy_projection",
      "legacy_projection",
    ]);
    expect(input.historicalMesocycles[0]?.adherenceSummary).toMatchObject({
      plannedSessions: expect.any(Number),
      completedSessions: expect.any(Number),
    });
    expect(input.historicalMesocycles[0]?.performedVolumeSummary).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          muscle: "Chest",
          performedSets: expect.any(Number),
        }),
      ]),
    );
    expect(input.historicalMesocycles[0]?.performanceSignals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          exerciseId: "performed-reality-press",
          signal: "progressed",
        }),
      ]),
    );
    expect(input.blockResponseSignals[0]).toMatchObject({
      mesocycleId: "historical-1",
      sourcePlanner: "legacy_projection",
      strategyImplications: expect.arrayContaining([
        "preserve_successful_progression",
      ]),
    });
    expect(input.exerciseResponseSignals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          exerciseId: "performed-reality-press",
          signal: "progressed",
          evidence: expect.objectContaining({
            loadTrend: "rising",
            notes: expect.arrayContaining([
              "derived_from_performed_logs_not_prescribed_plan_shape",
            ]),
          }),
        }),
      ]),
    );
    expect(input.evidenceLimitations).toEqual(
      expect.arrayContaining([
        "historical_review_loader_uses_performed_reality_not_prescribed_plan_shape",
        "historical_prescribed_plan_shape_excluded_from_strategy_policy",
        "historical_mesocycles_are_validation_data_not_policy_targets",
      ]),
    );
    expect(JSON.stringify(input)).toContain("performed-reality-press");
    expect(JSON.stringify(input)).not.toContain("old-prescribed-plan-only");
    expect(JSON.stringify(input)).not.toContain("aaron8819@gmail.com");
    expect(JSON.stringify(diagnostic.strategyRecommendation)).toContain(
      "Performed Reality Press",
    );
    expect(JSON.stringify(diagnostic.strategyRecommendation)).not.toContain(
      "old-prescribed-plan-only",
    );
    expect(
      JSON.stringify(diagnostic.strategyHypothesisPromotionReadiness),
    ).not.toContain("old-prescribed-plan-only");
    expect(diagnostic.strategyRecommendation.hypotheses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "preserve_successful_progression",
          mustNotYetInfluence: [
            "generation",
            "selection",
            "repair",
            "seed",
            "runtime",
            "receipts",
          ],
        }),
      ]),
    );
    expect(
      diagnostic.strategyHypothesisPromotionReadiness.hypothesisReadiness,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          hypothesisId: "preserve_successful_progression",
          proposedOwner: "ExerciseSelectionStrategy",
          readiness: "ready_for_read_only_diff",
          nextSafeAction: "add_read_only_diff",
        }),
      ]),
    );
    expect(reader.mesocycle.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          macroCycle: { userId: "future-user-1" },
        }),
      }),
    );
  });

  it("labels unavailable historical review evidence honestly", async () => {
    const reader = makeHistoricalReader({
      rows: [
        makeHistoricalDbRow({
          id: "missing-review",
          mesoNumber: 3,
          closedAt: "2026-04-15T00:00:00.000Z",
          validReview: false,
          slotPlanSeedJson: null,
        }),
      ],
      workoutsByMesocycle: {},
    });

    const loaded = await loadV2MesocycleStrategyHistoricalReviewEvidence(
      reader as unknown as Parameters<
        typeof loadV2MesocycleStrategyHistoricalReviewEvidence
      >[0],
      { userId: "future-user-2" },
    );
    const input = buildV2MesocycleStrategyInputFromReadModels({
      historicalMesocycleReviews: loaded.historicalMesocycleReviews,
      evidenceLimitations: loaded.evidenceLimitations,
    });

    expect(input.historicalMesocycles).toEqual([
      expect.objectContaining({
        mesocycleId: "missing-review",
        sourcePlanner: "legacy_projection",
        status: "COMPLETED",
      }),
    ]);
    expect(input.historicalMesocycles[0]?.adherenceSummary).toBeUndefined();
    expect(input.historicalMesocycles[0]?.performedVolumeSummary).toBeUndefined();
    expect(input.evidenceLimitations).toEqual(
      expect.arrayContaining([
        "historical_mesocycle_review_unavailable:missing-review",
      ]),
    );
  });

  it("represents late skipped-set spikes and deload non-execution as evidence only", async () => {
    const reader = makeHistoricalReader({
      rows: [
        makeHistoricalDbRow({
          id: "late-skip-history",
          mesoNumber: 4,
          closedAt: "2026-04-22T00:00:00.000Z",
        }),
      ],
      workoutsByMesocycle: {
        "late-skip-history": [
          makeHistoricalWorkout({
            id: "late-skip-w1",
            scheduledDate: "2026-04-01T00:00:00.000Z",
            status: "COMPLETED",
            week: 1,
            load: 80,
            rpe: 7,
            exerciseId: "skip-prone-calf",
            exerciseName: "Skip Prone Calf Raise",
            primaryMuscles: ["Calves"],
          }),
          makeHistoricalWorkout({
            id: "late-skip-w3",
            scheduledDate: "2026-04-15T00:00:00.000Z",
            status: "COMPLETED",
            week: 3,
            load: 80,
            rpe: 8.5,
            skippedSetCount: 2,
            exerciseId: "skip-prone-calf",
            exerciseName: "Skip Prone Calf Raise",
            primaryMuscles: ["Calves"],
          }),
          makeHistoricalWorkout({
            id: "late-skip-w4",
            scheduledDate: "2026-04-22T00:00:00.000Z",
            status: "COMPLETED",
            week: 4,
            load: 80,
            rpe: 9,
            skippedSetCount: 2,
            exerciseId: "skip-prone-calf",
            exerciseName: "Skip Prone Calf Raise",
            primaryMuscles: ["Calves"],
          }),
          makeHistoricalWorkout({
            id: "late-skip-deload",
            scheduledDate: "2026-04-29T00:00:00.000Z",
            status: "SKIPPED",
            week: 5,
            phase: "DELOAD",
          }),
        ],
      },
    });

    const loaded = await loadV2MesocycleStrategyHistoricalReviewEvidence(
      reader as unknown as Parameters<
        typeof loadV2MesocycleStrategyHistoricalReviewEvidence
      >[0],
      { userId: "future-user-3" },
    );
    const input = buildV2MesocycleStrategyInputFromReadModels({
      historicalMesocycleReviews: loaded.historicalMesocycleReviews,
      evidenceLimitations: loaded.evidenceLimitations,
    });

    expect(input.blockResponseSignals).toHaveLength(1);
    expect(input.blockResponseSignals[0]).toMatchObject({
      mesocycleId: "late-skip-history",
      adherence: {
        skippedSetCount: 4,
        skippedSetTrend: "rising",
      },
      effortProgression: {
        hardWeekEffortReached: true,
        deloadExecuted: false,
      },
      strategyImplications: expect.arrayContaining([
        "cap_late_block_volume",
        "improve_deload_execution",
      ]),
    });
    expect(input.exerciseResponseSignals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          exerciseId: "skip-prone-calf",
          signal: "skipped_often",
          evidence: expect.objectContaining({
            completedExposureCount: 3,
            skippedExposureCount: 2,
          }),
        }),
      ]),
    );
    expect(JSON.stringify(input)).not.toContain("aaron8819@gmail.com");
  });

  it("keeps thin, pain, and swapped evidence explicit instead of inventing certainty", () => {
    const input = buildV2MesocycleStrategyInputFromReadModels({
      historicalMesocycleReviews: [
        {
          mesocycleId: "thin-history",
          sourcePlanner: "unknown",
        },
        {
          mesocycleId: "explicit-response-history",
          sourcePlanner: "legacy_projection",
          exerciseResponseSignals: [
            {
              exerciseId: "shoulder-raise",
              exerciseName: "Shoulder Raise",
              signal: "pain_or_tolerance_issue",
              evidence: {
                mesocycleIds: ["explicit-response-history"],
                completedExposureCount: 2,
                skippedExposureCount: 0,
                loadTrend: "unknown",
                repTrend: "unknown",
                rpeTrend: "unknown",
                notes: ["explicit_tolerance_note:shoulder_discomfort"],
              },
              confidence: "medium",
            },
            {
              exerciseId: "old-curl",
              exerciseName: "Old Curl",
              signal: "swapped_out",
              evidence: {
                mesocycleIds: ["explicit-response-history"],
                completedExposureCount: 0,
                skippedExposureCount: 0,
                swappedExposureCount: 2,
                loadTrend: "unknown",
                repTrend: "unknown",
                rpeTrend: "unknown",
                notes: ["explicit_swap_evidence"],
              },
              confidence: "medium",
            },
          ],
        },
      ],
    });

    expect(input.blockResponseSignals[0]).toMatchObject({
      mesocycleId: "thin-history",
      strategyImplications: ["unknown"],
      confidence: "low",
    });
    expect(input.exerciseResponseSignals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          signal: "pain_or_tolerance_issue",
          confidence: "medium",
        }),
        expect.objectContaining({
          signal: "swapped_out",
          evidence: expect.objectContaining({
            swappedExposureCount: 2,
          }),
        }),
      ]),
    );
    expect(input.evidenceLimitations).toEqual(
      expect.arrayContaining([
        "pain_or_tolerance_requires_explicit_evidence",
        "historical_mesocycles_are_validation_data_not_policy_targets",
      ]),
    );
  });
});
