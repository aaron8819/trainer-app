import { prisma } from "@/lib/db/prisma";
import {
  prepareV2AcceptedSeedPreparationCompare,
  type V2AcceptedSeedPreparationCompareResult,
  type V2AcceptedSeedPreparationProbeInput,
} from "@/lib/api/mesocycle-handoff";
import {
  buildV2MaterializationPreparationEvidence,
  buildV2PlannerMesocyclePolicy,
  DEFAULT_V2_EXERCISE_CLASS_TAXONOMY,
} from "@/lib/engine/planning/v2";
import { V2_ACCEPTED_SEED_PREPARE_COMPARE_AUDIT_PAYLOAD_VERSION } from "./constants";
import {
  normalizeLiveInventoryForV2Materialization,
} from "./v2-materialization-live-context-dry-run";
import type { V2AcceptedSeedPrepareCompareAuditPayload } from "./types";

type LiveInventoryRows = Parameters<
  typeof normalizeLiveInventoryForV2Materialization
>[0];

type V2AcceptedSeedPrepareCompareReader = {
  mesocycle: {
    findFirst(args: unknown): Promise<{
      id: string;
      state: string;
    } | null>;
  };
  exercise: {
    findMany(args: unknown): Promise<LiveInventoryRows>;
  };
  userPreference: {
    findUnique(args: unknown): Promise<{
      avoidExerciseIds: string[];
      favoriteExerciseIds: string[];
    } | null>;
  };
};

type V2AcceptedSeedPrepareCompareDependencies = {
  prepareCompare?: typeof prepareV2AcceptedSeedPreparationCompare;
  reader?: V2AcceptedSeedPrepareCompareReader;
};

type ResolvedHandoffCandidate =
  | {
      found: true;
      resolvedBy:
        | "explicit_mesocycle_id"
        | "explicit_source_mesocycle_id"
        | "latest_pending_handoff";
      mesocycleId: string;
      state: string;
    }
  | {
      found: false;
      resolvedBy: "not_found";
      missingReason: "no_pending_handoff_candidate";
    };

const EVIDENCE_LIMIT = 3;

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort((left, right) =>
    left.localeCompare(right),
  );
}

function compactEvidence(evidence: string[]): {
  evidence: string[];
  omittedEvidenceCount?: number;
} {
  return {
    evidence: evidence.slice(0, EVIDENCE_LIMIT),
    ...(evidence.length > EVIDENCE_LIMIT
      ? { omittedEvidenceCount: evidence.length - EVIDENCE_LIMIT }
      : {}),
  };
}

async function resolveHandoffCandidate(input: {
  userId: string;
  mesocycleId?: string;
  requestedIdSource?: "mesocycle_id" | "source_mesocycle_id";
  reader: V2AcceptedSeedPrepareCompareReader;
}): Promise<ResolvedHandoffCandidate> {
  const row = await input.reader.mesocycle.findFirst({
    where: {
      ...(input.mesocycleId ? { id: input.mesocycleId } : {}),
      state: "AWAITING_HANDOFF",
      macroCycle: { userId: input.userId },
    },
    orderBy: input.mesocycleId
      ? undefined
      : [{ closedAt: "desc" }, { mesoNumber: "desc" }],
    select: {
      id: true,
      state: true,
    },
  });

  if (!row) {
    return {
      found: false,
      resolvedBy: "not_found",
      missingReason: "no_pending_handoff_candidate",
    };
  }

  return {
    found: true,
    resolvedBy:
      input.requestedIdSource === "source_mesocycle_id"
        ? "explicit_source_mesocycle_id"
        : input.mesocycleId
          ? "explicit_mesocycle_id"
          : "latest_pending_handoff",
    mesocycleId: row.id,
    state: row.state,
  };
}

async function buildLiveV2ProbeInput(input: {
  userId: string;
  reader: V2AcceptedSeedPrepareCompareReader;
}): Promise<V2AcceptedSeedPreparationProbeInput> {
  const [exercises, preferences] = await Promise.all([
    input.reader.exercise.findMany({
      orderBy: { name: "asc" },
      include: {
        aliases: true,
        exerciseEquipment: { include: { equipment: true } },
        exerciseMuscles: { include: { muscle: true } },
      },
    }),
    input.reader.userPreference.findUnique({ where: { userId: input.userId } }),
  ]);
  const plannerPolicy = buildV2PlannerMesocyclePolicy();
  const taxonomy = DEFAULT_V2_EXERCISE_CLASS_TAXONOMY;
  const inventory = normalizeLiveInventoryForV2Materialization(exercises);
  const constraints = {
    avoidExerciseIds: preferences?.avoidExerciseIds ?? [],
    favoriteExerciseIds: preferences?.favoriteExerciseIds ?? [],
    painConflictExerciseIds: [],
  };
  const preparationEvidence = buildV2MaterializationPreparationEvidence({
    plannerPolicy,
    taxonomy,
    inventory,
    constraints,
  });

  return {
    ...preparationEvidence,
  };
}

function summarizeIdentityRows(
  rows: V2AcceptedSeedPreparationCompareResult["exerciseIdentityComparison"]["rows"],
): V2AcceptedSeedPrepareCompareAuditPayload["identityCoverageComparison"]["identitySummary"] {
  return {
    sameExercise: rows.filter((row) => row.relationship === "same_exercise").length,
    v2Added: rows.filter((row) => row.relationship === "v2_added").length,
    v2Removed: rows.filter((row) => row.relationship === "v2_removed").length,
    cleanAlternative: rows.filter(
      (row) => row.relationship === "replaced_with_clean_alternative",
    ).length,
    classEquivalentDifference: rows.filter(
      (row) => row.relationship === "class_equivalent_difference",
    ).length,
    unclear: rows.filter((row) => row.relationship === "unclear").length,
    notComparable: rows.filter((row) => row.relationship === "not_comparable")
      .length,
  };
}

function missingEvidenceForCompare(
  compare: V2AcceptedSeedPreparationCompareResult,
): string[] {
  return uniqueSorted([
    ...compare.comparedPreparationAvailability.v2.blockers,
    ...compare.provenanceNoWriteBoundary.productionGates.missing.map(
      (gate) => `production_gate:${gate}`,
    ),
    ...(compare.legacyPreparationAvailable
      ? []
      : ["legacy_preparation_unavailable"]),
  ]);
}

function compareStatus(
  compare: V2AcceptedSeedPreparationCompareResult,
): V2AcceptedSeedPrepareCompareAuditPayload["compareStatus"] {
  if (compare.legacyPreparationAvailable && compare.v2PreparationAvailable) {
    return "available";
  }
  if (!compare.v2PreparationAvailable) {
    return "blocked";
  }
  return "not_comparable";
}

function buildNoCandidatePayload(
  candidate: Extract<ResolvedHandoffCandidate, { found: false }>,
): V2AcceptedSeedPrepareCompareAuditPayload {
  return {
    version: V2_ACCEPTED_SEED_PREPARE_COMPARE_AUDIT_PAYLOAD_VERSION,
    source: "v2_accepted_seed_prepare_compare_audit",
    readOnly: true,
    affectsScoringOrGeneration: false,
    consumedByProduction: false,
    wouldWriteTransaction: false,
    compareStatus: "no_handoff_candidate",
    handoffCandidate: {
      found: false,
      resolvedBy: candidate.resolvedBy,
      missingReason: candidate.missingReason,
    },
    boundaryFacts: {
      readOnly: true,
      noWrite: true,
      consumedByProduction: false,
      v2PreviewAvailable: false,
      v2ProductionWriteEligible: false,
      seedSerializer: "buildMesocycleSlotPlanSeed",
      legacyProjectionCalledByV2Path: false,
      repairCalledByV2Path: false,
      transactionStatus: "no_write",
    },
    availability: {
      handoffCandidateFound: false,
      legacyPreparationAvailable: false,
      v2PreparationPreviewAvailable: false,
      v2BlockedFailClosed: true,
      missingEvidence: ["no_pending_handoff_candidate"],
    },
    seedShapeComparison: {
      classification: "not_comparable",
      slotIdsInOrder: {
        legacy: [],
        v2: [],
        sameOrder: null,
        classification: "not_comparable",
      },
      exerciseCountBySlot: [],
      setCountBySlot: [],
      totalSetCount: {
        legacy: null,
        v2: null,
        classification: "not_comparable",
      },
      executableFieldShape: {
        legacy: null,
        v2: null,
        classification: "not_comparable",
      },
      seedSerializerIdentity: {
        legacy: null,
        v2: null,
        classification: "not_comparable",
      },
    },
    identityCoverageComparison: {
      identitySummary: {
        sameExercise: 0,
        v2Added: 0,
        v2Removed: 0,
        cleanAlternative: 0,
        classEquivalentDifference: 0,
        unclear: 0,
        notComparable: 0,
      },
      identityRows: [],
      coverageRows: [],
    },
    provenance: {
      legacySourceLabel: "not_available",
      v2SourceLabel: "v2_disabled",
      baseValidationStatus: "missing",
      materializerStatus: "blocked",
      seedShapeCompatibility: {
        passed: false,
        compatible: false,
        slotCountMatches: false,
        rolesValid: false,
        setCountsValid: false,
        noDuplicateExerciseIdsWithinSlot: false,
        namesAvailable: false,
      },
      promotionReadinessStatus: "blocked",
      productionGates: {
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
      },
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
      improvementCount: 0,
      preservationCount: 0,
      regressionCount: 0,
      unclearCount: 0,
      notComparableCount: 1,
    },
  };
}

function buildPayloadFromCompare(input: {
  candidate: Extract<ResolvedHandoffCandidate, { found: true }>;
  compare: V2AcceptedSeedPreparationCompareResult;
}): V2AcceptedSeedPrepareCompareAuditPayload {
  const compare = input.compare;
  const identityRows = compare.exerciseIdentityComparison.rows.map((row) => ({
    slotId: row.slotId,
    relationship: row.relationship,
    classification: row.classification,
    sameExerciseIds: row.sameExerciseIds,
    v2AddedExerciseIds: row.v2AddedExerciseIds,
    v2RemovedExerciseIds: row.v2RemovedExerciseIds,
    ...compactEvidence(row.evidence),
  }));
  const coverageRows = compare.classLaneCoverageComparison.rows.map((row) => ({
    item: row.item,
    legacy: row.legacy,
    v2: row.v2,
    classification: row.classification,
    ...compactEvidence(row.evidence),
  }));

  return {
    version: V2_ACCEPTED_SEED_PREPARE_COMPARE_AUDIT_PAYLOAD_VERSION,
    source: "v2_accepted_seed_prepare_compare_audit",
    readOnly: true,
    affectsScoringOrGeneration: false,
    consumedByProduction: false,
    wouldWriteTransaction: false,
    compareStatus: compareStatus(compare),
    handoffCandidate: {
      found: true,
      resolvedBy: input.candidate.resolvedBy,
      mesocycleId: input.candidate.mesocycleId,
      state: input.candidate.state,
    },
    boundaryFacts: {
      readOnly: true,
      noWrite: true,
      consumedByProduction: false,
      v2PreviewAvailable: compare.v2PreparationAvailable,
      v2ProductionWriteEligible: false,
      seedSerializer: compare.seedSerializer,
      legacyProjectionCalledByV2Path: compare.v2WouldCallLegacyProjection,
      repairCalledByV2Path: compare.v2WouldCallLegacyRepair,
      transactionStatus: compare.provenanceNoWriteBoundary.transactionStatus,
    },
    availability: {
      handoffCandidateFound: true,
      legacyPreparationAvailable: compare.legacyPreparationAvailable,
      v2PreparationPreviewAvailable: compare.v2PreparationAvailable,
      v2BlockedFailClosed:
        compare.comparedPreparationAvailability.v2.failClosed,
      missingEvidence: missingEvidenceForCompare(compare),
    },
    seedShapeComparison: {
      classification: compare.seedShapeComparison.classification,
      slotIdsInOrder: compare.seedShapeComparison.slotIdsInOrder,
      exerciseCountBySlot: compare.seedShapeComparison.exerciseCountBySlot,
      setCountBySlot: compare.seedShapeComparison.setCountBySlot,
      totalSetCount: compare.seedShapeComparison.totalSetCount,
      executableFieldShape: compare.seedShapeComparison.executableFieldShape,
      seedSerializerIdentity:
        compare.seedShapeComparison.seedSerializerIdentity,
    },
    identityCoverageComparison: {
      identitySummary: summarizeIdentityRows(
        compare.exerciseIdentityComparison.rows,
      ),
      identityRows,
      coverageRows,
    },
    provenance: {
      legacySourceLabel:
        compare.provenanceNoWriteBoundary.legacySourceLabel,
      v2SourceLabel: compare.provenanceNoWriteBoundary.v2SourceLabel,
      baseValidationStatus:
        compare.provenanceNoWriteBoundary.baseValidationStatus,
      materializerStatus:
        compare.provenanceNoWriteBoundary.materializerStatus,
      seedShapeCompatibility:
        compare.provenanceNoWriteBoundary.seedShapeCompatibility,
      promotionReadinessStatus:
        compare.provenanceNoWriteBoundary.promotionReadinessStatus,
      productionGates: compare.provenanceNoWriteBoundary.productionGates,
      fallbackPolicy: compare.provenanceNoWriteBoundary.fallbackPolicy,
      transactionStatus: compare.provenanceNoWriteBoundary.transactionStatus,
    },
    guardrails: compare.guardrails,
    summary: compare.summary,
  };
}

export async function buildV2AcceptedSeedPrepareCompareAuditPayload(input: {
  userId: string;
  ownerEmail?: string;
  mesocycleId?: string;
  requestedIdSource?: "mesocycle_id" | "source_mesocycle_id";
  dependencies?: V2AcceptedSeedPrepareCompareDependencies;
}): Promise<V2AcceptedSeedPrepareCompareAuditPayload> {
  const reader = (input.dependencies?.reader ??
    prisma) as V2AcceptedSeedPrepareCompareReader;
  const candidate = await resolveHandoffCandidate({
    userId: input.userId,
    mesocycleId: input.mesocycleId,
    requestedIdSource: input.requestedIdSource,
    reader,
  });

  if (!candidate.found) {
    return buildNoCandidatePayload(candidate);
  }

  const v2Probe = await buildLiveV2ProbeInput({
    userId: input.userId,
    reader,
  });
  const compare = await (input.dependencies?.prepareCompare ??
    prepareV2AcceptedSeedPreparationCompare)({
    userId: input.userId,
    mesocycleId: candidate.mesocycleId,
    v2Probe,
  });

  return buildPayloadFromCompare({ candidate, compare });
}
