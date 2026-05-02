import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const counts = {
    workout: 0,
    completedOrPartial: 0,
    workoutExercise: 0,
    workoutSet: 0,
    setLog: 0,
    performedSetLog: 0,
  };
  const readiness = {
    status: "eligible_for_guarded_write",
    safe: true,
  };
  const txMesocycleFindFirst = vi.fn();
  const txMesocycleUpdate = vi.fn();
  const txWorkoutFindMany = vi.fn();
  const txWorkoutCount = vi.fn(async (args: { where?: { status?: unknown } }) =>
    args.where?.status ? counts.completedOrPartial : counts.workout,
  );
  const txWorkoutExerciseCount = vi.fn(async () => counts.workoutExercise);
  const txWorkoutSetCount = vi.fn(async () => counts.workoutSet);
  const txSetLogCount = vi.fn(async (args: { where?: { wasSkipped?: boolean } }) =>
    args.where?.wasSkipped === false ? counts.performedSetLog : counts.setLog,
  );
  const txExerciseFindMany = vi.fn();
  const txUserPreferenceFindUnique = vi.fn();
  const transaction = vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
    callback({
      mesocycle: {
        findFirst: txMesocycleFindFirst,
        update: txMesocycleUpdate,
      },
      workout: {
        count: txWorkoutCount,
        findMany: txWorkoutFindMany,
      },
      workoutExercise: {
        count: txWorkoutExerciseCount,
      },
      workoutSet: {
        count: txWorkoutSetCount,
      },
      setLog: {
        count: txSetLogCount,
      },
      exercise: {
        findMany: txExerciseFindMany,
      },
      userPreference: {
        findUnique: txUserPreferenceFindUnique,
      },
    }),
  );

  return {
    counts,
    readiness,
    txMesocycleFindFirst,
    txMesocycleUpdate,
    txWorkoutFindMany,
    txWorkoutCount,
    txWorkoutExerciseCount,
    txWorkoutSetCount,
    txSetLogCount,
    txExerciseFindMany,
    txUserPreferenceFindUnique,
    transaction,
    prisma: {
      $transaction: transaction,
    },
  };
});

vi.mock("@/lib/db/prisma", () => ({
  prisma: mocks.prisma,
}));

vi.mock("@/lib/engine/planning/v2", async () => {
  const productionWriteGates = {
    acceptancePathDesigned: true,
    slotPlanSeedJsonWriteGateDesigned: true,
    receiptContractDesigned: true,
    runtimeReplayContractVerified: true,
    auditSerializationContractDesigned: true,
    rollbackStrategyDefined: true,
  };
  const seedShapeCompatibility = {
    compatible: true,
    slotCount: 1,
    exerciseCount: 1,
    missingNameCount: 0,
    duplicateExerciseIdWithinSlotCount: 0,
    invalidRoleCount: 0,
    invalidSetCount: 0,
    unsupportedClassCount: 0,
  };

  return {
    DEFAULT_V2_EXERCISE_CLASS_TAXONOMY: {},
    buildV2PlannerMesocyclePolicy: vi.fn(() => ({
      exerciseSelectionPlan: {},
    })),
    buildV2ExerciseMaterializationPlan: vi.fn(() => ({ slots: [] })),
    buildV2BasePlanValidation: vi.fn(() => ({
      status: "pass",
      summary: {
        blockerCount: 0,
        warningCount: 0,
      },
      nextSafeAction: "none",
    })),
    buildV2MaterializationPreparationEvidence: vi.fn((input) => ({
      plannerPolicy: input.plannerPolicy,
      exerciseSelectionPlan: input.plannerPolicy.exerciseSelectionPlan,
      taxonomy: input.taxonomy,
      inventory: input.inventory,
      constraints: input.constraints ?? {},
      materializedPlan: input.inventory.length > 0 ? { slots: [] } : null,
      basePlanValidation: {
        status: "pass",
        summary: {
          blockerCount: 0,
          warningCount: 0,
        },
        nextSafeAction: "none",
      },
      liveNormalizedInventoryAvailable: input.inventory.length > 0,
    })),
    buildV2MaterializationDryRunReport: vi.fn(() => ({
      version: 1,
      status: "ready",
      plannerPolicyAvailable: true,
      exerciseSelectionPlanAvailable: true,
      taxonomyAvailable: true,
      inventoryAvailable: true,
      materializer: {
        status: "materialized",
        blockerCount: 0,
        omissionCount: 0,
      },
      seedShapeCompatibility,
      requiredLaneCoverageBySlot: [
        {
          slotId: "upper_a",
          requiredLaneCount: 1,
          materializedRequiredLaneCount: 1,
          blockedRequiredLaneCount: 0,
          missingRequiredLaneIds: [],
        },
      ],
      executableSeedPreview: [
        {
          slotId: "upper_a",
          intent: "UPPER",
          exercises: [
            {
              exerciseId: "v2-bench",
              name: "V2 Bench",
              role: "CORE_COMPOUND",
              setCount: 3,
              laneIds: ["chest_press"],
            },
          ],
        },
      ],
      candidateIdentitySummary: {
        available: true,
        rowCount: 1,
        detailLevel: "selected_identity",
        rankingDetailAvailability: {
          topAlternatives: "not_available",
          scoreTuple: "not_available",
          selectedReason: "not_available",
          reason: "materializer_does_not_emit_candidate_ranking",
        },
        rows: [
          {
            slotId: "upper_a",
            laneId: "chest_press",
            laneRole: "anchor",
            seedRole: "CORE_COMPOUND",
            selectedExercise: {
              exerciseId: "v2-bench",
              name: "V2 Bench",
            },
            setCount: 3,
            topAlternatives: [],
          },
        ],
      },
      strippedMaterializerFields: [],
      blockers: [],
      omissions: [],
      readiness: {
        missingBeforePromotion: [],
      },
      safeToPromoteToProductionWrite: false,
    })),
    buildV2MaterializationPromotionReadiness: vi.fn(() => ({
      version: 1,
      source: "v2_materialization_promotion_readiness",
      readOnly: true,
      affectsScoringOrGeneration: false,
      status: mocks.readiness.status,
      safeToPromoteToProductionWrite: mocks.readiness.safe,
      requiredMaterialization: {
        status: "passed",
        requiredLaneCoveragePassed: true,
        requiredBlockerCount: 0,
      },
      optionalOmissions: {
        count: 0,
        affectsPromotion: false,
        reasons: [],
      },
      seedShape: {
        compatible: true,
        slotCountMatches: true,
        noDuplicateExerciseIdsWithinSlot: true,
        rolesValid: true,
        setCountsValid: true,
        namesAvailable: true,
      },
      productionWriteGates,
      blockers: mocks.readiness.safe
        ? []
        : [{ category: "production_gate", reason: "runtimeReplayContractVerified" }],
      nonBlockingOmissions: [],
    })),
    buildV2AcceptedPlannerIntentDto: vi.fn(() => undefined),
  };
});

import { replaceEmptyMesocycleWithV2 } from "./replace-empty-mesocycle-with-v2";

function safeMesocycle() {
  return {
    id: "meso-1",
    state: "ACTIVE_ACCUMULATION",
    isActive: true,
    closedAt: null,
    accumulationSessionsCompleted: 0,
    deloadSessionsCompleted: 0,
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
            {
              exerciseId: "legacy-bench",
              role: "CORE_COMPOUND",
              setCount: 3,
            },
          ],
        },
      ],
    },
    macroCycle: {
      userId: "user-1",
      user: {
        email: "owner@test.local",
      },
    },
  };
}

async function runReplacement(
  overrides: Partial<Parameters<typeof replaceEmptyMesocycleWithV2>[0]> = {},
) {
  return replaceEmptyMesocycleWithV2({
    userId: "user-1",
    ownerEmail: "owner@test.local",
    mesocycleId: "meso-1",
    replaceEmptyActiveMesocycleWithV2: true,
    ...overrides,
  });
}

describe("replaceEmptyMesocycleWithV2", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.counts.workout = 0;
    mocks.counts.completedOrPartial = 0;
    mocks.counts.workoutExercise = 0;
    mocks.counts.workoutSet = 0;
    mocks.counts.setLog = 0;
    mocks.counts.performedSetLog = 0;
    mocks.readiness.status = "eligible_for_guarded_write";
    mocks.readiness.safe = true;
    mocks.txMesocycleFindFirst.mockResolvedValue(safeMesocycle());
    mocks.txWorkoutFindMany.mockResolvedValue([]);
    mocks.txExerciseFindMany.mockResolvedValue([
      {
        id: "v2-bench",
        name: "V2 Bench",
        aliases: [],
        movementPatterns: ["horizontal_push"],
        isCompound: true,
        isMainLiftEligible: true,
        exerciseEquipment: [],
        exerciseMuscles: [
          { role: "PRIMARY", muscle: { name: "Chest" } },
        ],
      },
    ]);
    mocks.txUserPreferenceFindUnique.mockResolvedValue(null);
  });

  it("blocks without an explicit owner email", async () => {
    await expect(runReplacement({ ownerEmail: "" })).rejects.toThrow(
      "REPLACE_EMPTY_MESOCYCLE_WITH_V2_OWNER_EMAIL_REQUIRED",
    );
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("blocks without an explicit mesocycle id", async () => {
    await expect(runReplacement({ mesocycleId: "" })).rejects.toThrow(
      "REPLACE_EMPTY_MESOCYCLE_WITH_V2_MESOCYCLE_ID_REQUIRED",
    );
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("blocks without the explicit replacement intent flag", async () => {
    await expect(
      runReplacement({ replaceEmptyActiveMesocycleWithV2: false }),
    ).rejects.toThrow("REPLACE_EMPTY_MESOCYCLE_WITH_V2_EXPLICIT_FLAG_REQUIRED");
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("blocks write mode without the explicit confirmation flag", async () => {
    await expect(runReplacement({ write: true })).rejects.toThrow(
      "REPLACE_EMPTY_MESOCYCLE_WITH_V2_CONFIRMATION_REQUIRED",
    );
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("blocks replacement if workout rows exist", async () => {
    mocks.counts.workout = 1;

    const result = await runReplacement();

    expect(result.candidateSafety.allowed).toBe(false);
    expect(result.candidateSafety.blockers).toContain("workouts_exist");
    expect(result.write.eligible).toBe(false);
    expect(mocks.txMesocycleUpdate).not.toHaveBeenCalled();
  });

  it("blocks replacement if completed or partial sessions exist", async () => {
    mocks.counts.completedOrPartial = 1;

    const result = await runReplacement();

    expect(result.candidateSafety.allowed).toBe(false);
    expect(result.candidateSafety.blockers).toContain(
      "completed_or_partial_sessions_exist",
    );
    expect(result.candidateSafety.evidence.performedRealityEmpty).toBe(false);
    expect(mocks.txMesocycleUpdate).not.toHaveBeenCalled();
  });

  it("blocks replacement if performed set logs exist", async () => {
    mocks.counts.setLog = 1;
    mocks.counts.performedSetLog = 1;

    const result = await runReplacement();

    expect(result.candidateSafety.allowed).toBe(false);
    expect(result.candidateSafety.blockers).toContain("performed_set_logs_exist");
    expect(result.candidateSafety.evidence.performedRealityEmpty).toBe(false);
    expect(mocks.txMesocycleUpdate).not.toHaveBeenCalled();
  });

  it("blocks replacement if runtime deviations exist", async () => {
    mocks.counts.workout = 1;
    mocks.txWorkoutFindMany.mockResolvedValue([
      {
        id: "workout-1",
        status: "PLANNED",
        selectionMetadata: {
          runtimeEditReconciliation: {
            ops: [{ kind: "exercise_added" }],
          },
        },
      },
    ]);

    const result = await runReplacement();

    expect(result.candidateSafety.allowed).toBe(false);
    expect(result.candidateSafety.blockers).toContain("runtime_deviations_exist");
    expect(result.candidateSafety.evidence.runtimeDeviationCount).toBe(1);
    expect(mocks.txMesocycleUpdate).not.toHaveBeenCalled();
  });

  it("keeps dry-run mode read-only and reports the seed/runtime boundary", async () => {
    const result = await runReplacement();

    expect(result.dryRun).toBe(true);
    expect(result.write.dbWriteOccurred).toBe(false);
    expect(result.write.transactionStatus).toBe("not_requested");
    expect(mocks.txMesocycleUpdate).not.toHaveBeenCalled();
    expect(result.seedRuntimeBoundary).toMatchObject({
      serializer: "buildMesocycleSlotPlanSeed",
      handcraftedSlotPlanSeedJson: false,
      acceptedPlannerIntentRuntimeInert: true,
      runtimeReplayUnchanged: true,
      runtimeConsumesPlannerMetadata: false,
    });
  });

  it("surfaces compact V2 candidate identities without exposing them as seed truth", async () => {
    const result = await runReplacement();

    expect(result.v2Preparation.candidateIdentitySummary).toEqual({
      available: true,
      rowCount: 1,
      detailLevel: "selected_identity",
      rankingDetailAvailability: {
        topAlternatives: "not_available",
        scoreTuple: "not_available",
        selectedReason: "not_available",
        reason: "materializer_does_not_emit_candidate_ranking",
      },
      rows: [
        {
          slotId: "upper_a",
          laneId: "chest_press",
          laneRole: "anchor",
          seedRole: "CORE_COMPOUND",
          selectedExercise: {
            exerciseId: "v2-bench",
            name: "V2 Bench",
          },
          setCount: 3,
          topAlternatives: [],
        },
      ],
    });
    expect(result.seedRuntimeBoundary.executableRowFields).toEqual([
      "exerciseId",
      "role",
      "setCount",
    ]);
    expect(mocks.txMesocycleUpdate).not.toHaveBeenCalled();
  });

  it("write mode delegates seed construction to the existing serializer", async () => {
    const serializerSeed = {
      version: 1 as const,
      source: "v2_materialized_seed" as const,
      slots: [
        {
          slotId: "upper_a",
          exercises: [
            {
              exerciseId: "v2-bench",
              role: "CORE_COMPOUND" as const,
              setCount: 3,
            },
          ],
        },
      ],
    };
    const buildSlotPlanSeed = vi.fn(() => serializerSeed);

    const result = await runReplacement({
      write: true,
      confirmEmptyMesocycleReplacement: true,
      dependencies: { buildSlotPlanSeed },
    });

    expect(buildSlotPlanSeed).toHaveBeenCalledTimes(1);
    expect(buildSlotPlanSeed).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "v2_materialized_seed",
      }),
    );
    expect(mocks.txMesocycleUpdate).toHaveBeenCalledWith({
      where: { id: "meso-1" },
      data: { slotPlanSeedJson: serializerSeed },
    });
    expect(JSON.stringify(serializerSeed)).not.toContain("laneIds");
    expect(result.provenance).toMatchObject({
      source: "v2_materialized_seed",
      dbWriteOccurred: true,
      transactionStatus: "success",
      fallbackStatus: "none",
    });
  });

  it("fails closed when V2 readiness is blocked and never labels fallback as V2 success", async () => {
    mocks.readiness.status = "blocked";
    mocks.readiness.safe = false;

    const result = await runReplacement({
      write: true,
      confirmEmptyMesocycleReplacement: true,
    });

    expect(result.v2Preparation.status).toBe("blocked");
    expect(result.write.dbWriteOccurred).toBe(false);
    expect(result.write.transactionStatus).toBe("no_write");
    expect(result.provenance).toMatchObject({
      source: "v2_blocked_fail_closed",
      fallbackStatus: "blocked_no_fallback",
      dbWriteOccurred: false,
    });
    expect(mocks.txMesocycleUpdate).not.toHaveBeenCalled();
  });
});
