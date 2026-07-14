import { parseSlotPlanSeedJson } from "./slot-plan-seed-parser";
import { normalizeAcceptedSeedPayload } from "./mesocycle-seed-revision";

export const ACCEPTED_SEED_PROVENANCE_WARNING_CODES = [
  "SEED_SOURCE_LEGACY_WITH_V2_PLANNER_METADATA",
  "RUNTIME_REPLAY_PROVENANCE_NOT_AUTHORSHIP",
  "UI_SEED_SOURCE_NOT_AUTHORSHIP",
  "V2_DIAGNOSTICS_WITH_LEGACY_ACCEPTED_SEED",
  "V2_SOURCE_WITHOUT_V2_PLANNER_METADATA",
  "V2_PROVENANCE_REPORTED_WITHOUT_DB_WRITE",
  "UNKNOWN_ACCEPTED_SEED_SOURCE",
  "MISSING_EXECUTABLE_SET_COUNTS",
  "ACTIVE_MESOCYCLE_REVISION_MISSING",
  "CURRENT_REVISION_NOT_LATEST",
  "RECEIPT_SEED_PROVENANCE_MISSING",
  "RECEIPT_SEED_PROVENANCE_MISMATCH",
  "REVISION_PAYLOAD_HASH_MISMATCH",
] as const;

export type AcceptedSeedProvenanceWarningCode =
  (typeof ACCEPTED_SEED_PROVENANCE_WARNING_CODES)[number];

export type AcceptedSeedProvenanceWarningSeverity =
  | "info"
  | "warning"
  | "error";

export type AcceptedMesocycleSeedProvenanceInput = {
  mesocycleId: string;
  mesocycleState?: string;
  slotPlanSeedJson: unknown;
  receiptCompositionSource?: string | null;
  receiptSeedProvenance?: {
    revisionId: string;
    revision: number;
    hash: string;
  } | null;
  currentRevision?: {
    id: string;
    revision: number;
    payloadHash: string | null;
    provenanceStatus: string;
    seedPayload?: unknown;
  } | null;
  revisionHistory?: Array<{
    id: string;
    revision: number;
    payloadHash: string | null;
    provenanceStatus: string;
    creationReason: string;
    actorSource: string | null;
    sourceRevisionId: string | null;
    activatedAt: Date | string;
  }>;
  readModelExerciseSource?: string | null;
  v2DiagnosticSignals?: {
    dbWriteOccurred?: boolean;
    persistenceSource?: string;
    materializedSeedSource?: string;
    generationPath?: string;
  };
};

export type AcceptedMesocycleSeedProvenanceConsistency = {
  version: 1;
  readOnly: true;
  affectsScoringOrGeneration: false;
  consumedByProduction: false;
  status: "valid" | "suspicious" | "invalid";
  seed: {
    available: boolean;
    source?: string;
    plannerMetadataSource?: string;
    targetSkeletonId?: string;
    executableShape: "set_aware" | "identity_only" | "missing" | "unknown";
    provenance?: "exact" | "legacy_unknown" | "missing";
    activeRevision?: {
      revisionId: string;
      revision: number;
      hash: string | null;
    };
    revisionHistory?: Array<{
      revisionId: string;
      revision: number;
      hash: string | null;
      provenance: string;
      creationReason: string;
      actorSource: string | null;
      sourceRevisionId: string | null;
      activatedAt: string;
    }>;
  };
  warnings: Array<{
    code: AcceptedSeedProvenanceWarningCode;
    severity: AcceptedSeedProvenanceWarningSeverity;
    evidence: string;
  }>;
};

type Warning = AcceptedMesocycleSeedProvenanceConsistency["warnings"][number];

const LEGACY_SEED_SOURCES = new Set([
  "handoff_slot_plan_projection",
  "legacy_projection_seed",
]);

const RUNTIME_REPLAY_SOURCES = new Set([
  "persisted_slot_plan_seed",
  "deload_seed_replay",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function isLegacySeedSource(source: string | undefined): boolean {
  return source ? LEGACY_SEED_SOURCES.has(source) : false;
}

function isV2SeedSource(source: string | undefined): boolean {
  return source === "v2_planner_policy" || source?.startsWith("v2_") === true;
}

function isKnownSeedSource(source: string | undefined): boolean {
  return isLegacySeedSource(source) || isV2SeedSource(source);
}

function hasV2DiagnosticSignals(
  signals: AcceptedMesocycleSeedProvenanceInput["v2DiagnosticSignals"],
): boolean {
  return Boolean(signals && Object.keys(signals).length > 0);
}

function executableShape(input: {
  seedPresent: boolean;
  exerciseCount: number;
  missingSetCount: number;
}): AcceptedMesocycleSeedProvenanceConsistency["seed"]["executableShape"] {
  if (!input.seedPresent) {
    return "missing";
  }
  if (input.exerciseCount === 0) {
    return "missing";
  }
  if (input.missingSetCount === 0) {
    return "set_aware";
  }
  if (input.missingSetCount === input.exerciseCount) {
    return "identity_only";
  }
  return "unknown";
}

function statusForWarnings(warnings: Warning[]): AcceptedMesocycleSeedProvenanceConsistency["status"] {
  if (warnings.some((warning) => warning.severity === "error")) {
    return "invalid";
  }
  if (warnings.some((warning) => warning.severity === "warning")) {
    return "suspicious";
  }
  return "valid";
}

export function evaluateAcceptedMesocycleSeedProvenance(
  input: AcceptedMesocycleSeedProvenanceInput,
): AcceptedMesocycleSeedProvenanceConsistency {
  const rawSeed = isRecord(input.slotPlanSeedJson) ? input.slotPlanSeedJson : null;
  const parsedSeed = parseSlotPlanSeedJson(input.slotPlanSeedJson);
  const rawPlannerMetadata = isRecord(rawSeed?.acceptedPlannerIntent)
    ? rawSeed.acceptedPlannerIntent
    : null;
  const source = parsedSeed?.source ?? readString(rawSeed?.source);
  const plannerMetadataSource =
    parsedSeed?.acceptedPlannerIntent?.source ??
    readString(rawPlannerMetadata?.source);
  const targetSkeletonId =
    parsedSeed?.acceptedPlannerIntent?.targetSkeletonId ??
    readString(rawPlannerMetadata?.targetSkeletonId);
  const exercises = parsedSeed?.slots.flatMap((slot) => slot.exercises) ?? [];
  const missingSetCount = exercises.filter(
    (exercise) => !exercise.hasExplicitSetCount,
  ).length;
  const shape = executableShape({
    seedPresent: parsedSeed != null,
    exerciseCount: exercises.length,
    missingSetCount,
  });
  const seedAvailable = parsedSeed != null && exercises.length > 0;
  const legacySeedSource = isLegacySeedSource(source);
  const v2SeedSource = isV2SeedSource(source);
  const hasV2PlannerMetadata =
    plannerMetadataSource === "v2_planner_policy" && Boolean(targetSkeletonId);
  const v2SignalsPresent = hasV2DiagnosticSignals(input.v2DiagnosticSignals);
  const warnings: Warning[] = [];
  const currentRevision = input.currentRevision;
  const revisionHistory = input.revisionHistory ?? [];

  if (
    input.mesocycleState?.startsWith("ACTIVE_") &&
    seedAvailable &&
    !currentRevision
  ) {
    warnings.push({
      code: "ACTIVE_MESOCYCLE_REVISION_MISSING",
      severity: "error",
      evidence: `mesocycleId=${input.mesocycleId} has executable seed but no active accepted revision`,
    });
  }
  const highestRevision = revisionHistory.reduce(
    (highest, revision) => Math.max(highest, revision.revision),
    0,
  );
  if (currentRevision && highestRevision > currentRevision.revision) {
    warnings.push({
      code: "CURRENT_REVISION_NOT_LATEST",
      severity: "error",
      evidence: `currentRevision=${currentRevision.revision} highestRevision=${highestRevision}`,
    });
  }
  if (
    currentRevision?.provenanceStatus === "exact" &&
    currentRevision.payloadHash &&
    currentRevision.seedPayload !== undefined
  ) {
    let normalizedHash: string | null = null;
    try {
      normalizedHash = normalizeAcceptedSeedPayload(currentRevision.seedPayload).hash;
    } catch {
      normalizedHash = null;
    }
    if (normalizedHash !== currentRevision.payloadHash) {
      warnings.push({
        code: "REVISION_PAYLOAD_HASH_MISMATCH",
        severity: "error",
        evidence: `revisionId=${currentRevision.id} storedHash=${currentRevision.payloadHash} normalizedHash=${normalizedHash ?? "invalid_payload"}`,
      });
    }
  }
  if (
    input.receiptCompositionSource &&
    RUNTIME_REPLAY_SOURCES.has(input.receiptCompositionSource) &&
    currentRevision?.provenanceStatus === "exact" &&
    !input.receiptSeedProvenance
  ) {
    warnings.push({
      code: "RECEIPT_SEED_PROVENANCE_MISSING",
      severity: "error",
      evidence: `compositionSource=${input.receiptCompositionSource} currentRevision=${currentRevision.revision}`,
    });
  }
  const receiptRevision = input.receiptSeedProvenance
    ? [
        ...(currentRevision ? [currentRevision] : []),
        ...revisionHistory,
      ].find((revision) => revision.id === input.receiptSeedProvenance?.revisionId)
    : null;
  if (
    input.receiptSeedProvenance &&
    (!receiptRevision ||
      input.receiptSeedProvenance.revision !== receiptRevision.revision ||
      input.receiptSeedProvenance.hash !== receiptRevision.payloadHash)
  ) {
    warnings.push({
      code: "RECEIPT_SEED_PROVENANCE_MISMATCH",
      severity: "error",
      evidence: `receiptRevisionId=${input.receiptSeedProvenance.revisionId} receiptRevision=${input.receiptSeedProvenance.revision} referencedRevision=${receiptRevision?.revision ?? "missing"}`,
    });
  }

  if (legacySeedSource && plannerMetadataSource === "v2_planner_policy") {
    warnings.push({
      code: "SEED_SOURCE_LEGACY_WITH_V2_PLANNER_METADATA",
      severity: "warning",
      evidence: `mesocycleId=${input.mesocycleId} seed.source=${source} plannerMetadataSource=${plannerMetadataSource}`,
    });
  }

  if (
    input.receiptCompositionSource &&
    isV2SeedSource(input.receiptCompositionSource)
  ) {
    warnings.push({
      code: "RUNTIME_REPLAY_PROVENANCE_NOT_AUTHORSHIP",
      severity: "error",
      evidence: `compositionSource=${input.receiptCompositionSource} looks like planner authorship; runtime provenance must report replay path, not planner metadata`,
    });
  }

  if (
    input.receiptCompositionSource &&
    RUNTIME_REPLAY_SOURCES.has(input.receiptCompositionSource) &&
    (legacySeedSource || !source || !isKnownSeedSource(source))
  ) {
    warnings.push({
      code: "RUNTIME_REPLAY_PROVENANCE_NOT_AUTHORSHIP",
      severity: "info",
      evidence: `compositionSource=${input.receiptCompositionSource} replays the accepted seed; seed.source=${source ?? "missing"} remains the author label`,
    });
  }

  if (
    input.readModelExerciseSource === "persisted_slot_plan_seed" &&
    (legacySeedSource || !source || !isKnownSeedSource(source))
  ) {
    warnings.push({
      code: "UI_SEED_SOURCE_NOT_AUTHORSHIP",
      severity: "info",
      evidence: `exerciseSource=${input.readModelExerciseSource} is a read-model row source; seed.source=${source ?? "missing"} remains the author label`,
    });
  }

  if (v2SignalsPresent && legacySeedSource) {
    const signals = input.v2DiagnosticSignals;
    warnings.push({
      code: "V2_DIAGNOSTICS_WITH_LEGACY_ACCEPTED_SEED",
      severity: "warning",
      evidence: `seed.source=${source}; v2Signals=${[
        signals?.persistenceSource
          ? `persistenceSource=${signals.persistenceSource}`
          : null,
        signals?.materializedSeedSource
          ? `materializedSeedSource=${signals.materializedSeedSource}`
          : null,
        signals?.generationPath ? `generationPath=${signals.generationPath}` : null,
        signals?.dbWriteOccurred !== undefined
          ? `dbWriteOccurred=${signals.dbWriteOccurred}`
          : null,
      ]
        .filter(Boolean)
        .join(",")}`,
    });
  }

  if (v2SeedSource && source !== "v2_materialized_seed" && !hasV2PlannerMetadata) {
    warnings.push({
      code: "V2_SOURCE_WITHOUT_V2_PLANNER_METADATA",
      severity: "error",
      evidence: `seed.source=${source}; plannerMetadataSource=${plannerMetadataSource ?? "missing"} targetSkeletonId=${targetSkeletonId ?? "missing"}`,
    });
  }

  if (
    isV2SeedSource(input.v2DiagnosticSignals?.persistenceSource) &&
    input.v2DiagnosticSignals?.dbWriteOccurred === false
  ) {
    warnings.push({
      code: "V2_PROVENANCE_REPORTED_WITHOUT_DB_WRITE",
      severity: "error",
      evidence: `persistenceSource=${input.v2DiagnosticSignals.persistenceSource} dbWriteOccurred=false`,
    });
  }

  if (seedAvailable && (!source || !isKnownSeedSource(source))) {
    warnings.push({
      code: "UNKNOWN_ACCEPTED_SEED_SOURCE",
      severity: "warning",
      evidence: `mesocycleId=${input.mesocycleId} seed.source=${source ?? "missing"}`,
    });
  }

  if (seedAvailable && missingSetCount > 0) {
    warnings.push({
      code: "MISSING_EXECUTABLE_SET_COUNTS",
      severity: "error",
      evidence: `mesocycleId=${input.mesocycleId} missingSetCount=${missingSetCount} executableShape=${shape}`,
    });
  }

  return {
    version: 1,
    readOnly: true,
    affectsScoringOrGeneration: false,
    consumedByProduction: false,
    status: statusForWarnings(warnings),
    seed: {
      available: seedAvailable,
      ...(source ? { source } : {}),
      ...(plannerMetadataSource ? { plannerMetadataSource } : {}),
      ...(targetSkeletonId ? { targetSkeletonId } : {}),
      executableShape: shape,
      provenance:
        currentRevision?.provenanceStatus === "exact"
          ? "exact"
          : currentRevision
            ? "legacy_unknown"
            : "missing",
      ...(currentRevision
        ? {
            activeRevision: {
              revisionId: currentRevision.id,
              revision: currentRevision.revision,
              hash: currentRevision.payloadHash,
            },
          }
        : {}),
      revisionHistory: revisionHistory.map((revision) => ({
        revisionId: revision.id,
        revision: revision.revision,
        hash: revision.payloadHash,
        provenance: revision.provenanceStatus,
        creationReason: revision.creationReason,
        actorSource: revision.actorSource,
        sourceRevisionId: revision.sourceRevisionId,
        activatedAt:
          revision.activatedAt instanceof Date
            ? revision.activatedAt.toISOString()
            : revision.activatedAt,
      })),
    },
    warnings,
  };
}
