import type { AutoregulationResult } from "@/lib/api/autoregulation";
import {
  buildSessionDecisionReceipt,
  extractSessionDecisionReceipt,
} from "@/lib/evidence/session-decision-receipt";
import type { SessionDecisionReceipt } from "@/lib/evidence/types";

export type SaveableSelectionMetadata = {
  rationale?: Record<string, unknown>;
  selectedExerciseIds?: string[];
  perExerciseSetTargets?: Record<string, number>;
  sessionDecisionReceipt?: SessionDecisionReceipt;
};

function toObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function toStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const items = value.filter((entry): entry is string => typeof entry === "string");
  return items.length > 0 ? items : [];
}

function toNumberRecord(value: unknown): Record<string, number> | undefined {
  const record = toObject(value);
  if (!record) {
    return undefined;
  }

  const entries = Object.entries(record).filter(
    (entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1])
  );
  return entries.length > 0 ? Object.fromEntries(entries) : {};
}

export function sanitizeSelectionMetadataForSave(value: unknown): SaveableSelectionMetadata | undefined {
  const record = toObject(value);
  if (!record) {
    return undefined;
  }

  const output: SaveableSelectionMetadata = {};
  if (record.rationale && typeof record.rationale === "object" && !Array.isArray(record.rationale)) {
    output.rationale = record.rationale as Record<string, unknown>;
  }

  const selectedExerciseIds = toStringArray(record.selectedExerciseIds);
  if (selectedExerciseIds) {
    output.selectedExerciseIds = selectedExerciseIds;
  }

  const perExerciseSetTargets = toNumberRecord(record.perExerciseSetTargets);
  if (perExerciseSetTargets) {
    output.perExerciseSetTargets = perExerciseSetTargets;
  }

  const sessionDecisionReceipt = toObject(record.sessionDecisionReceipt);
  if (sessionDecisionReceipt) {
    const canonicalReceipt = extractSessionDecisionReceipt({
      sessionDecisionReceipt,
    });
    if (canonicalReceipt) {
      output.sessionDecisionReceipt = canonicalReceipt;
    }
  }

  return Object.keys(output).length > 0 ? output : {};
}

export function buildCanonicalSelectionMetadata(
  value: unknown,
  autoregulation?: AutoregulationResult
): SaveableSelectionMetadata {
  const record = toObject(value) ?? {};
  const priorReceipt = extractSessionDecisionReceipt(record);

  return (
    sanitizeSelectionMetadataForSave({
      ...record,
      sessionDecisionReceipt: priorReceipt
        ? buildSessionDecisionReceipt({
            cycleContext: priorReceipt.cycleContext,
            lifecycleRirTarget: priorReceipt.lifecycleRirTarget,
            lifecycleVolumeTargets: priorReceipt.lifecycleVolume.targets,
            sorenessSuppressedMuscles: priorReceipt.sorenessSuppressedMuscles,
            deloadDecision: priorReceipt.deloadDecision,
            plannerDiagnostics: priorReceipt.plannerDiagnostics,
            plannerDiagnosticsMode: "standard",
            autoregulation: autoregulation
              ? {
                  wasAutoregulated: autoregulation.wasAutoregulated,
                  signalAgeHours: autoregulation.signalAgeHours,
                  fatigueScoreOverall: autoregulation.fatigueScore?.overall ?? null,
                  rationale: autoregulation.rationale,
                  modifications: autoregulation.modifications,
                }
              : undefined,
          })
        : undefined,
    }) ?? {}
  );
}
