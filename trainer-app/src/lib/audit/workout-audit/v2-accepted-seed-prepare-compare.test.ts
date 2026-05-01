import { describe, expect, it, vi } from "vitest";
import type { V2AcceptedSeedPreparationCompareResult } from "@/lib/api/mesocycle-handoff";
import { getSerializedJsonSizeBytes } from "./artifact-serialization";
import { buildV2AcceptedSeedPrepareCompareAuditPayload } from "./v2-accepted-seed-prepare-compare";

function makeProductionGates() {
  return {
    explicit: false,
    allProvided: false,
    values: {
      acceptancePathDesigned: false,
      slotPlanSeedJsonWriteGateDesigned: false,
      receiptContractDesigned: false,
      runtimeReplayContractVerified: false,
      auditSerializationContractDesigned: false,
      rollbackStrategyDefined: false,
    },
    missing: [
      "acceptancePathDesigned",
      "auditSerializationContractDesigned",
      "receiptContractDesigned",
      "rollbackStrategyDefined",
      "runtimeReplayContractVerified",
      "slotPlanSeedJsonWriteGateDesigned",
    ],
  };
}

function makeCompareFixture(): V2AcceptedSeedPreparationCompareResult {
  return {
    version: 1,
    source: "v2_accepted_seed_preparation_compare",
    readOnly: true,
    affectsScoringOrGeneration: false,
    wouldWriteTransaction: false,
    consumedByProduction: false,
    legacyPreparationAvailable: true,
    v2PreparationAvailable: true,
    v2WouldCallLegacyProjection: false,
    v2WouldCallLegacyRepair: false,
    seedSerializer: "buildMesocycleSlotPlanSeed",
    comparedPreparationAvailability: {
      legacy: {
        available: true,
        sourceLabel: "legacy_projection_seed",
        wouldCallLegacyProjection: true,
        wouldCallLegacyRepair: true,
        dbWriteOccurred: false,
      },
      v2: {
        available: true,
        sourceLabel: "v2_disabled",
        wouldCallLegacyProjection: false,
        wouldCallLegacyRepair: false,
        dbWriteOccurred: false,
        failClosed: false,
        blockers: [],
      },
    },
    seedShapeComparison: {
      classification: "unclear",
      slotCount: {
        legacy: 4,
        v2: 4,
        classification: "v2_preserves",
      },
      slotIdsInOrder: {
        legacy: ["upper_a", "lower_a", "upper_b", "lower_b"],
        v2: ["upper_a", "lower_a", "upper_b", "lower_b"],
        sameOrder: true,
        classification: "v2_preserves",
      },
      exerciseCountBySlot: [
        {
          slotId: "upper_a",
          legacy: 2,
          v2: 3,
          classification: "unclear",
        },
      ],
      totalSetCount: {
        legacy: 14,
        v2: 42,
        classification: "unclear",
      },
      setCountBySlot: [
        {
          slotId: "upper_a",
          legacy: 6,
          v2: 12,
          classification: "unclear",
        },
      ],
      executableFieldShape: {
        legacy: ["exerciseId", "role", "setCount"],
        v2: ["exerciseId", "role", "setCount"],
        classification: "v2_preserves",
      },
      seedSerializerIdentity: {
        legacy: "buildMesocycleSlotPlanSeed",
        v2: "buildMesocycleSlotPlanSeed",
        classification: "v2_preserves",
      },
    },
    exerciseIdentityComparison: {
      classification: "unclear",
      rows: [
        {
          slotId: "upper_a",
          relationship: "same_exercise",
          classification: "v2_preserves",
          legacyExerciseIds: ["bench"],
          v2ExerciseIds: ["bench"],
          sameExerciseIds: ["bench"],
          v2AddedExerciseIds: [],
          v2RemovedExerciseIds: [],
          evidence: ["bench retained"],
        },
        {
          slotId: "upper_a",
          relationship: "v2_added",
          classification: "v2_improves",
          legacyExerciseIds: [],
          v2ExerciseIds: ["lateral-raise"],
          sameExerciseIds: [],
          v2AddedExerciseIds: ["lateral-raise"],
          v2RemovedExerciseIds: [],
          evidence: ["side delt direct lane added"],
        },
        {
          slotId: "upper_b",
          relationship: "v2_removed",
          classification: "v2_improves",
          legacyExerciseIds: ["dirty-collateral"],
          v2ExerciseIds: [],
          sameExerciseIds: [],
          v2AddedExerciseIds: [],
          v2RemovedExerciseIds: ["dirty-collateral"],
          evidence: ["managed collateral omitted"],
        },
        {
          slotId: "lower_a",
          relationship: "replaced_with_clean_alternative",
          classification: "v2_improves",
          legacyExerciseIds: ["standing-calf"],
          v2ExerciseIds: ["seated-calf"],
          sameExerciseIds: [],
          v2AddedExerciseIds: ["seated-calf"],
          v2RemovedExerciseIds: ["standing-calf"],
          evidence: ["clean alternative"],
        },
        {
          slotId: "lower_b",
          relationship: "class_equivalent_difference",
          classification: "unclear",
          legacyExerciseIds: ["leg-curl-a"],
          v2ExerciseIds: ["leg-curl-b"],
          sameExerciseIds: [],
          v2AddedExerciseIds: ["leg-curl-b"],
          v2RemovedExerciseIds: ["leg-curl-a"],
          evidence: ["same class"],
        },
        {
          slotId: "upper_b",
          relationship: "unclear",
          classification: "unclear",
          legacyExerciseIds: ["row-a"],
          v2ExerciseIds: ["row-b"],
          sameExerciseIds: [],
          v2AddedExerciseIds: ["row-b"],
          v2RemovedExerciseIds: ["row-a"],
          evidence: ["comparison unclear"],
        },
        {
          slotId: "missing",
          relationship: "not_comparable",
          classification: "not_comparable",
          legacyExerciseIds: [],
          v2ExerciseIds: [],
          sameExerciseIds: [],
          v2AddedExerciseIds: [],
          v2RemovedExerciseIds: [],
          evidence: ["slot missing"],
        },
      ],
    },
    classLaneCoverageComparison: {
      classification: "v2_improves",
      rows: [
        "chest_distinct_exposure",
        "row_vertical_pull_balance",
        "side_delt_direct",
        "rear_delt_direct_support",
        "biceps_direct_support",
        "triceps_direct_support",
        "hamstrings_hinge_curl",
        "calves_direct_work",
        "optional_lane_omission",
        "managed_collateral_omission",
      ].map((item) => ({
        item:
          item as V2AcceptedSeedPreparationCompareResult["classLaneCoverageComparison"]["rows"][number]["item"],
        legacy: item === "optional_lane_omission" ? null : false,
        v2: true,
        classification: "v2_improves" as const,
        evidence: [`${item}:v2_available`],
      })),
    },
    repairLegacyDependencyComparison: {
      classification: "v2_improves",
      rows: [
        {
          item: "support_floor_closure",
          legacyPreparationPathMayUse: true,
          v2PreparationPathUses: false,
          v2AvoidsDependency: true,
          classification: "v2_improves",
          evidence: ["v2 path does not call repair"],
        },
      ],
    },
    provenanceNoWriteBoundary: {
      legacySourceLabel: "legacy_projection_seed",
      v2SourceLabel: "v2_disabled",
      baseValidationStatus: "pass",
      materializerStatus: "materialized",
      seedShapeCompatibility: {
        passed: true,
        compatible: true,
        slotCountMatches: true,
        rolesValid: true,
        setCountsValid: true,
        noDuplicateExerciseIdsWithinSlot: true,
        namesAvailable: true,
      },
      promotionReadinessStatus: "blocked",
      productionGates: makeProductionGates(),
      fallbackPolicy: {
        explicit: true,
        v2BlockedFailsClosed: true,
        silentlyFallsBackToLegacyProjection: false,
        allowedFallbackLabels: [
          "legacy_projection_seed",
          "fallback_existing_projection",
        ],
      },
      transactionStatus: "no_write",
      dbWriteOccurred: false,
      v2ProvenanceCanBeMistakenForPersistedSuccess: false,
      runtimeReplayContract: {
        unchanged: true,
        runtimeConsumedFields: ["exerciseId", "role", "setCount"],
        runtimeIgnoresPlannerMetadata: true,
      },
    },
    seedSerializationBoundary: {
      serializer: "buildMesocycleSlotPlanSeed",
      handcraftedSlotPlanSeedJson: false,
      executableRowFields: ["exerciseId", "role", "setCount"],
      acceptedPlannerIntentRuntimeInert: true,
      runtimeConsumesPlannerMetadata: false,
      previewExposedAsSlotPlanSeedJson: false,
    },
    guardrails: {
      readOnlyComparisonOnly: true,
      doesNotChangeAcceptRouteBehavior: true,
      doesNotEnableV2LiveWrites: true,
      doesNotChangeDefaultHandoffAcceptance: true,
      doesNotChangeRepairedProjectionBehavior: true,
      doesNotChangeRepairBehavior: true,
      doesNotChangeSeedSerialization: true,
      doesNotChangeRuntimeReplay: true,
      doesNotChangeReceipts: true,
      doesNotPersistAnything: true,
      v2PathDoesNotCallLegacyProjectionOrRepair: true,
      repairedOutputIsEvidenceNotTarget: true,
    },
    summary: {
      improvementCount: 8,
      preservationCount: 4,
      regressionCount: 0,
      unclearCount: 3,
      notComparableCount: 1,
    },
  };
}

function makeReader(candidate?: { id: string; state: string } | null) {
  return {
    mesocycle: {
      findFirst: vi.fn().mockResolvedValue(
        candidate === undefined
          ? { id: "meso-1", state: "AWAITING_HANDOFF" }
          : candidate,
      ),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    exercise: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    userPreference: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
  };
}

describe("buildV2AcceptedSeedPrepareCompareAuditPayload", () => {
  it("resolves a handoff candidate, invokes the compare helper, and reports compact read-only boundaries", async () => {
    const reader = makeReader();
    const prepareCompare = vi.fn().mockResolvedValue(makeCompareFixture());

    const payload = await buildV2AcceptedSeedPrepareCompareAuditPayload({
      userId: "user-1",
      ownerEmail: "owner@test.local",
      mesocycleId: "meso-1",
      requestedIdSource: "mesocycle_id",
      dependencies: {
        reader: reader as never,
        prepareCompare: prepareCompare as never,
      },
    });

    expect(reader.mesocycle.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "meso-1",
          state: "AWAITING_HANDOFF",
          macroCycle: { userId: "user-1" },
        }),
      }),
    );
    expect(reader.mesocycle.create).not.toHaveBeenCalled();
    expect(reader.mesocycle.update).not.toHaveBeenCalled();
    expect(reader.mesocycle.updateMany).not.toHaveBeenCalled();
    expect(prepareCompare).toHaveBeenCalledWith({
      userId: "user-1",
      mesocycleId: "meso-1",
      v2Probe: expect.objectContaining({
        liveNormalizedInventoryAvailable: false,
        inventory: [],
        constraints: {
          avoidExerciseIds: [],
          favoriteExerciseIds: [],
          painConflictExerciseIds: [],
        },
      }),
    });
    expect(payload.boundaryFacts).toEqual({
      readOnly: true,
      noWrite: true,
      consumedByProduction: false,
      v2PreviewAvailable: true,
      v2ProductionWriteEligible: false,
      seedSerializer: "buildMesocycleSlotPlanSeed",
      legacyProjectionCalledByV2Path: false,
      repairCalledByV2Path: false,
      transactionStatus: "no_write",
    });
    expect(payload.availability).toMatchObject({
      handoffCandidateFound: true,
      legacyPreparationAvailable: true,
      v2PreparationPreviewAvailable: true,
      v2BlockedFailClosed: false,
    });
    expect(payload.availability.missingEvidence).toEqual(
      expect.arrayContaining([
        "production_gate:acceptancePathDesigned",
        "production_gate:receiptContractDesigned",
      ]),
    );
    expect(payload.provenance).toMatchObject({
      legacySourceLabel: "legacy_projection_seed",
      v2SourceLabel: "v2_disabled",
      baseValidationStatus: "pass",
      materializerStatus: "materialized",
      seedShapeCompatibility: {
        compatible: true,
      },
      promotionReadinessStatus: "blocked",
      transactionStatus: "no_write",
    });
    expect(payload.identityCoverageComparison.identitySummary).toEqual({
      sameExercise: 1,
      v2Added: 1,
      v2Removed: 1,
      cleanAlternative: 1,
      classEquivalentDifference: 1,
      unclear: 1,
      notComparable: 1,
    });
    expect(payload.identityCoverageComparison.coverageRows.map((row) => row.item)).toEqual([
      "chest_distinct_exposure",
      "row_vertical_pull_balance",
      "side_delt_direct",
      "rear_delt_direct_support",
      "biceps_direct_support",
      "triceps_direct_support",
      "hamstrings_hinge_curl",
      "calves_direct_work",
      "optional_lane_omission",
      "managed_collateral_omission",
    ]);
    expect(payload.seedShapeComparison).toMatchObject({
      classification: "unclear",
      totalSetCount: {
        legacy: 14,
        v2: 42,
      },
      executableFieldShape: {
        legacy: ["exerciseId", "role", "setCount"],
        v2: ["exerciseId", "role", "setCount"],
      },
      seedSerializerIdentity: {
        legacy: "buildMesocycleSlotPlanSeed",
        v2: "buildMesocycleSlotPlanSeed",
      },
    });
    expect(payload.guardrails).toMatchObject({
      doesNotChangeAcceptRouteBehavior: true,
      doesNotChangeSeedSerialization: true,
      doesNotChangeRuntimeReplay: true,
      doesNotChangeReceipts: true,
      v2PathDoesNotCallLegacyProjectionOrRepair: true,
    });
    expect(getSerializedJsonSizeBytes(payload)).toBeLessThan(25_000);
  });

  it("handles a missing handoff candidate without invoking the compare path", async () => {
    const reader = makeReader(null);
    const prepareCompare = vi.fn();

    const payload = await buildV2AcceptedSeedPrepareCompareAuditPayload({
      userId: "user-1",
      dependencies: {
        reader: reader as never,
        prepareCompare: prepareCompare as never,
      },
    });

    expect(prepareCompare).not.toHaveBeenCalled();
    expect(reader.exercise.findMany).not.toHaveBeenCalled();
    expect(reader.userPreference.findUnique).not.toHaveBeenCalled();
    expect(payload.compareStatus).toBe("no_handoff_candidate");
    expect(payload.handoffCandidate).toEqual({
      found: false,
      resolvedBy: "not_found",
      missingReason: "no_pending_handoff_candidate",
    });
    expect(payload.boundaryFacts).toMatchObject({
      readOnly: true,
      noWrite: true,
      consumedByProduction: false,
      v2PreviewAvailable: false,
      v2ProductionWriteEligible: false,
      legacyProjectionCalledByV2Path: false,
      repairCalledByV2Path: false,
      transactionStatus: "no_write",
    });
    expect(payload.availability).toEqual({
      handoffCandidateFound: false,
      legacyPreparationAvailable: false,
      v2PreparationPreviewAvailable: false,
      v2BlockedFailClosed: true,
      missingEvidence: ["no_pending_handoff_candidate"],
    });
    expect(getSerializedJsonSizeBytes(payload)).toBeLessThan(12_000);
  });
});
