import type { AutoregulationResult } from "@/lib/api/autoregulation";
import type { AutoregulationModification } from "@/lib/engine/readiness/types";
import type { CycleContextSnapshot, DeloadDecision } from "./types";
import {
  buildSessionDecisionReceipt,
  extractSessionDecisionReceipt,
  parseDeloadDecision,
} from "./session-decision-receipt";

type JsonObject = Record<string, unknown>;

export type SessionDecisionCompatibilityAutoregulationLog = {
  applied?: boolean;
  reason?: string;
  rationale?: string;
  wasAutoregulated?: boolean;
  signalAgeHours?: number | null;
  fatigueScore?: {
    overall?: number | null;
  } | null;
  modifications?: AutoregulationModification[];
  deloadDecision?: DeloadDecision;
};

type CompatibilityAutoregulationSource = Pick<
  AutoregulationResult,
  "applied" | "reason" | "rationale" | "wasAutoregulated" | "signalAgeHours" | "fatigueScore" | "modifications"
>;

function toObject(value: unknown): JsonObject | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as JsonObject;
}

function parseCompatibilityAutoregulationLog(
  value: unknown
): SessionDecisionCompatibilityAutoregulationLog | undefined {
  const record = toObject(value);
  if (!record) {
    return undefined;
  }

  const fatigueScore = toObject(record.fatigueScore);
  const modifications = Array.isArray(record.modifications)
    ? (record.modifications as AutoregulationModification[])
    : undefined;
  const deloadDecision = parseDeloadDecision(record.deloadDecision);

  const parsed: SessionDecisionCompatibilityAutoregulationLog = {
    applied: record.applied === true,
    reason: typeof record.reason === "string" ? record.reason : undefined,
    rationale: typeof record.rationale === "string" ? record.rationale : undefined,
    wasAutoregulated: record.wasAutoregulated === true,
    signalAgeHours:
      typeof record.signalAgeHours === "number" && Number.isFinite(record.signalAgeHours)
        ? record.signalAgeHours
        : undefined,
    fatigueScore: fatigueScore
      ? {
          overall:
            typeof fatigueScore.overall === "number" && Number.isFinite(fatigueScore.overall)
              ? fatigueScore.overall
              : undefined,
    }
      : undefined,
    modifications,
    deloadDecision,
  };

  const hasMeaningfulField =
    parsed.applied === true ||
    parsed.wasAutoregulated === true ||
    parsed.reason != null ||
    parsed.rationale != null ||
    parsed.signalAgeHours != null ||
    parsed.fatigueScore?.overall != null ||
    (parsed.modifications?.length ?? 0) > 0 ||
    parsed.deloadDecision != null;

  return hasMeaningfulField ? parsed : undefined;
}

export function buildCompatibilityAutoregulationLog(
  autoregulation: CompatibilityAutoregulationSource | null | undefined
): SessionDecisionCompatibilityAutoregulationLog | undefined {
  if (!autoregulation) {
    return undefined;
  }

  const hasReadinessDeload = autoregulation.modifications.some(
    (mod) => mod.type === "deload_trigger"
  );

  return {
    applied: autoregulation.applied,
    reason: autoregulation.reason,
    rationale: autoregulation.rationale,
    wasAutoregulated: autoregulation.wasAutoregulated,
    signalAgeHours: autoregulation.signalAgeHours,
    fatigueScore: autoregulation.fatigueScore
      ? {
          overall: autoregulation.fatigueScore.overall,
        }
      : null,
    modifications: autoregulation.modifications,
    deloadDecision: hasReadinessDeload
      ? {
          mode: "readiness",
          reason: [autoregulation.reason],
          reductionPercent: 50,
          appliedTo: "both",
        }
      : undefined,
  };
}

export function normalizeSessionDecisionForSave(input: {
  selectionMetadata: unknown;
  autoregulationLog: unknown;
  wasAutoregulated?: boolean;
  cycleContext: CycleContextSnapshot;
}): {
  selectionMetadata: JsonObject;
} {
  const incomingSelectionMetadata = toObject(input.selectionMetadata) ?? {};
  const compatibilityAutoregulationLog = parseCompatibilityAutoregulationLog(input.autoregulationLog);
  const existingReceipt = extractSessionDecisionReceipt(incomingSelectionMetadata);
  const wasAutoregulated =
    input.wasAutoregulated ?? compatibilityAutoregulationLog?.wasAutoregulated === true;

  const sessionDecisionReceipt = buildSessionDecisionReceipt({
    cycleContext: input.cycleContext,
    lifecycleRirTarget: existingReceipt?.lifecycleRirTarget,
    lifecycleVolumeTargets: existingReceipt?.lifecycleVolume.targets,
    sorenessSuppressedMuscles: existingReceipt?.sorenessSuppressedMuscles ?? [],
    deloadDecision: existingReceipt?.deloadDecision ?? compatibilityAutoregulationLog?.deloadDecision,
    autoregulation: {
      wasAutoregulated,
      signalAgeHours:
        compatibilityAutoregulationLog?.signalAgeHours ??
        existingReceipt?.readiness.signalAgeHours,
      fatigueScoreOverall:
        compatibilityAutoregulationLog?.fatigueScore?.overall ??
        existingReceipt?.readiness.fatigueScoreOverall,
      rationale:
        compatibilityAutoregulationLog?.rationale ??
        compatibilityAutoregulationLog?.reason ??
        existingReceipt?.readiness.rationale,
      modifications: compatibilityAutoregulationLog?.modifications,
      intensityScaling: existingReceipt?.readiness.intensityScaling,
    },
  });

  return {
    selectionMetadata: {
      ...incomingSelectionMetadata,
      sessionDecisionReceipt,
    },
  };
}
