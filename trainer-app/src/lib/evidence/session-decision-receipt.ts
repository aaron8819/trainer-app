import type { AutoregulationModification } from "@/lib/engine/readiness/types";
import type {
  CycleContextSnapshot,
  DeloadDecision,
  LifecycleRirTarget,
  SessionDecisionException,
  SessionDecisionReadinessScaling,
  SessionDecisionReceipt,
  SessionDecisionVolumeTargetSource,
} from "./types";

type JsonRecord = Record<string, unknown>;

type ReadinessReceiptInput = {
  wasAutoregulated?: boolean;
  signalAgeHours?: number | null;
  fatigueScoreOverall?: number | null;
  rationale?: string;
  modifications?: AutoregulationModification[];
  intensityScaling?: Partial<SessionDecisionReadinessScaling>;
};

const DEFAULT_DELOAD_DECISION: DeloadDecision = {
  mode: "none",
  reason: [],
  reductionPercent: 0,
  appliedTo: "none",
};

function toObject(value: unknown): JsonRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as JsonRecord;
}

function toFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

export function parseCycleContextSnapshot(value: unknown): CycleContextSnapshot | undefined {
  const record = toObject(value);
  if (!record) {
    return undefined;
  }
  if (
    typeof record.weekInMeso !== "number" ||
    typeof record.weekInBlock !== "number" ||
    typeof record.phase !== "string" ||
    typeof record.blockType !== "string" ||
    typeof record.isDeload !== "boolean" ||
    (record.source !== "computed" && record.source !== "fallback")
  ) {
    return undefined;
  }

  return {
    weekInMeso: record.weekInMeso,
    weekInBlock: record.weekInBlock,
    mesocycleLength:
      typeof record.mesocycleLength === "number" ? record.mesocycleLength : undefined,
    phase: record.phase as CycleContextSnapshot["phase"],
    blockType: record.blockType as CycleContextSnapshot["blockType"],
    isDeload: record.isDeload,
    source: record.source,
  };
}

export function parseDeloadDecision(value: unknown): DeloadDecision | undefined {
  const record = toObject(value);
  if (!record) {
    return undefined;
  }
  if (
    typeof record.mode !== "string" ||
    !Array.isArray(record.reason) ||
    typeof record.reductionPercent !== "number" ||
    typeof record.appliedTo !== "string"
  ) {
    return undefined;
  }

  return {
    mode: record.mode as DeloadDecision["mode"],
    reason: parseStringArray(record.reason),
    reductionPercent: record.reductionPercent,
    appliedTo: record.appliedTo as DeloadDecision["appliedTo"],
  };
}

export function parseLifecycleRirTarget(value: unknown): LifecycleRirTarget | undefined {
  const record = toObject(value);
  if (!record) {
    return undefined;
  }
  if (typeof record.min !== "number" || typeof record.max !== "number") {
    return undefined;
  }
  return { min: record.min, max: record.max };
}

function parseVolumeTargets(value: unknown): Record<string, number> | undefined {
  const record = toObject(value);
  if (!record) {
    return undefined;
  }

  const targets: Record<string, number> = {};
  for (const [key, entry] of Object.entries(record)) {
    if (typeof entry === "number" && Number.isFinite(entry)) {
      targets[key] = entry;
    }
  }
  return Object.keys(targets).length > 0 ? targets : undefined;
}

function parseVolumeTargetSource(value: unknown): SessionDecisionVolumeTargetSource | undefined {
  return value === "lifecycle" ||
    value === "soreness_adjusted_lifecycle" ||
    value === "unknown"
    ? value
    : undefined;
}

function summarizeIntensityScaling(
  modifications: AutoregulationModification[] | undefined,
  existing?: Partial<SessionDecisionReadinessScaling>
): SessionDecisionReadinessScaling {
  const scaledExerciseIds = new Set<string>(existing?.exerciseIds ?? []);
  let scaledUpCount = existing?.scaledUpCount ?? 0;
  let scaledDownCount = existing?.scaledDownCount ?? 0;

  for (const mod of modifications ?? []) {
    if (mod.type !== "intensity_scale") {
      continue;
    }
    if (mod.exerciseId) {
      scaledExerciseIds.add(mod.exerciseId);
    }
    if (mod.direction === "up") {
      scaledUpCount += 1;
    } else if (mod.direction === "down") {
      scaledDownCount += 1;
    }
  }

  const computedApplied = scaledExerciseIds.size > 0 || scaledUpCount > 0 || scaledDownCount > 0;
  const applied = existing?.applied === true || computedApplied;

  return {
    applied,
    exerciseIds: [...scaledExerciseIds],
    scaledUpCount,
    scaledDownCount,
  };
}

function buildExceptions(input: {
  sorenessSuppressedMuscles: string[];
  deloadDecision: DeloadDecision;
  intensityScaling: SessionDecisionReadinessScaling;
}): SessionDecisionException[] {
  const output: SessionDecisionException[] = [];
  if (input.sorenessSuppressedMuscles.length > 0) {
    output.push({
      code: "soreness_suppression",
      message: `Held back weekly volume for ${input.sorenessSuppressedMuscles.join(", ")} due to soreness.`,
    });
  }
  if (input.deloadDecision.mode !== "none") {
    output.push({
      code: "deload",
      message:
        input.deloadDecision.reason[0] ??
        `Applied ${input.deloadDecision.mode} deload (${input.deloadDecision.reductionPercent}% ${input.deloadDecision.appliedTo}).`,
    });
  }
  if (input.intensityScaling.applied) {
    output.push({
      code: "readiness_scale",
      message: `Readiness scaled ${input.intensityScaling.exerciseIds.length} exercise(s): ${input.intensityScaling.scaledDownCount} down, ${input.intensityScaling.scaledUpCount} up.`,
    });
  }
  return output;
}

export function buildSessionDecisionReceipt(input: {
  cycleContext: CycleContextSnapshot;
  lifecycleRirTarget?: LifecycleRirTarget;
  lifecycleVolumeTargets?: Record<string, number>;
  sorenessSuppressedMuscles?: string[];
  deloadDecision?: DeloadDecision | null;
  autoregulation?: ReadinessReceiptInput;
}): SessionDecisionReceipt {
  const sorenessSuppressedMuscles = input.sorenessSuppressedMuscles ?? [];
  const deloadDecision = input.deloadDecision ?? DEFAULT_DELOAD_DECISION;
  const intensityScaling = summarizeIntensityScaling(
    input.autoregulation?.modifications,
    input.autoregulation?.intensityScaling
  );
  const lifecycleVolumeSource: SessionDecisionVolumeTargetSource =
    input.lifecycleVolumeTargets
      ? sorenessSuppressedMuscles.length > 0
        ? "soreness_adjusted_lifecycle"
        : "lifecycle"
      : "unknown";

  return {
    version: 1,
    cycleContext: input.cycleContext,
    lifecycleRirTarget: input.lifecycleRirTarget,
    lifecycleVolume: {
      targets: input.lifecycleVolumeTargets,
      source: lifecycleVolumeSource,
    },
    sorenessSuppressedMuscles,
    deloadDecision,
    readiness: {
      wasAutoregulated:
        (input.autoregulation?.wasAutoregulated ?? false) || intensityScaling.applied,
      signalAgeHours: input.autoregulation?.signalAgeHours ?? null,
      fatigueScoreOverall: input.autoregulation?.fatigueScoreOverall ?? null,
      intensityScaling,
      rationale: input.autoregulation?.rationale,
    },
    exceptions: buildExceptions({
      sorenessSuppressedMuscles,
      deloadDecision,
      intensityScaling,
    }),
  };
}

function parsePersistedReceipt(value: unknown): SessionDecisionReceipt | undefined {
  const record = toObject(value);
  if (!record || record.version !== 1) {
    return undefined;
  }

  const cycleContext = parseCycleContextSnapshot(record.cycleContext);
  const deloadDecision = parseDeloadDecision(record.deloadDecision);
  const readinessRecord = toObject(record.readiness);
  const intensityScalingRecord = toObject(readinessRecord?.intensityScaling);
  if (!cycleContext || !deloadDecision || !readinessRecord || !intensityScalingRecord) {
    return undefined;
  }

  return {
    version: 1,
    cycleContext,
    lifecycleRirTarget: parseLifecycleRirTarget(record.lifecycleRirTarget),
    lifecycleVolume: {
      targets: parseVolumeTargets(toObject(record.lifecycleVolume)?.targets),
      source: parseVolumeTargetSource(toObject(record.lifecycleVolume)?.source) ?? "unknown",
    },
    sorenessSuppressedMuscles: parseStringArray(record.sorenessSuppressedMuscles),
    deloadDecision,
    readiness: {
      wasAutoregulated: readinessRecord.wasAutoregulated === true,
      signalAgeHours: toFiniteNumber(readinessRecord.signalAgeHours) ?? null,
      fatigueScoreOverall: toFiniteNumber(readinessRecord.fatigueScoreOverall) ?? null,
      intensityScaling: {
        applied: intensityScalingRecord.applied === true,
        exerciseIds: parseStringArray(intensityScalingRecord.exerciseIds),
        scaledUpCount: toFiniteNumber(intensityScalingRecord.scaledUpCount) ?? 0,
        scaledDownCount: toFiniteNumber(intensityScalingRecord.scaledDownCount) ?? 0,
      },
      rationale:
        typeof readinessRecord.rationale === "string" ? readinessRecord.rationale : undefined,
    },
    exceptions: Array.isArray(record.exceptions)
      ? record.exceptions.flatMap((entry) => {
          const item = toObject(entry);
          if (!item || typeof item.code !== "string" || typeof item.message !== "string") {
            return [];
          }
          return [
            {
              code: item.code as SessionDecisionException["code"],
              message: item.message,
            },
          ];
        })
      : [],
  };
}

export function extractSessionDecisionReceipt(value: unknown): SessionDecisionReceipt | undefined {
  const record = toObject(value);
  if (!record) {
    return undefined;
  }
  return parsePersistedReceipt(record.sessionDecisionReceipt);
}

export function readSessionDecisionReceipt(
  selectionMetadata: unknown,
  _autoregulationLog?: unknown
): SessionDecisionReceipt | undefined {
  return extractSessionDecisionReceipt(selectionMetadata);
}
