import type {
  DoubleProgressionDecisionOptions,
  ProgressionEquipment,
  ProgressionSet,
} from "../engine/progression";
import type { WorkoutHistoryEntry } from "../engine/types";

export type CanonicalProgressionHistorySession = {
  confidence: number;
  selectionMode?: WorkoutHistoryEntry["selectionMode"];
  confidenceNotes: string[];
  sets?: ProgressionSet[];
};

export type IntentDeviationSeverity = "none" | "moderate" | "strong";

export type IntentDeviationSignal = {
  detected: boolean;
  severity: IntentDeviationSeverity;
};

type IntentDeviationResolution = {
  signal: IntentDeviationSignal;
  targetLoadCeiling?: number;
};

export type CanonicalProgressionEvaluationInput = {
  lastSets: ProgressionSet[];
  repRange: [number, number];
  equipment: ProgressionEquipment;
  currentTarget?: DoubleProgressionDecisionOptions["currentTarget"];
  decisionOptions: DoubleProgressionDecisionOptions;
  context: {
    workingSetLoad?: number;
    priorSessionCount: number;
    historyConfidenceScale: number;
    confidenceReasons: string[];
    intentDeviation: IntentDeviationSignal;
    intentDeviationTargetLoadCeiling?: number;
    currentTarget?: DoubleProgressionDecisionOptions["currentTarget"];
  };
};

export function buildCanonicalProgressionEvaluationInput(input: {
  lastSets: ProgressionSet[];
  repRange: [number, number];
  equipment: ProgressionEquipment;
  currentTarget?: DoubleProgressionDecisionOptions["currentTarget"];
  workingSetLoad?: number;
  historySessions?: CanonicalProgressionHistorySession[];
  calibrationConfidenceScale?: number;
  calibrationConfidenceReason?: string;
}): CanonicalProgressionEvaluationInput {
  const historySessions = input.historySessions ?? [];
  const intentDeviation = resolveIntentDeviationSignal({
    sessions: historySessions,
    repRange: input.repRange,
    equipment: input.equipment,
  });
  const priorSessionCount = Math.max(historySessions.length, 1);
  const historyConfidenceScale =
    historySessions.length > 0 ? resolveProgressionHistoryConfidenceScale(historySessions) : 1;
  const calibrationConfidenceScale = clampConfidenceScale(input.calibrationConfidenceScale);
  const combinedHistoryConfidenceScale = Number(
    (historyConfidenceScale * calibrationConfidenceScale).toFixed(2)
  );
  const confidenceReasons = [
    ...(historySessions.length > 0 ? collectProgressionConfidenceNotes(historySessions) : []),
    ...(
      calibrationConfidenceScale < 1 && input.calibrationConfidenceReason
        ? [input.calibrationConfidenceReason]
        : []
    ),
  ];

  return {
    lastSets: input.lastSets,
    repRange: input.repRange,
    equipment: input.equipment,
    ...(input.currentTarget ? { currentTarget: input.currentTarget } : {}),
    decisionOptions: {
      workingSetLoad: input.workingSetLoad,
      priorSessionCount,
      historyConfidenceScale: combinedHistoryConfidenceScale,
      confidenceReasons,
      intentDeviation: intentDeviation.signal,
      ...(input.currentTarget ? { currentTarget: input.currentTarget } : {}),
      ...(intentDeviation.targetLoadCeiling != null
        ? { intentDeviationTargetLoadCeiling: intentDeviation.targetLoadCeiling }
        : {}),
    },
    context: {
      workingSetLoad: input.workingSetLoad,
      priorSessionCount,
      historyConfidenceScale: combinedHistoryConfidenceScale,
      confidenceReasons,
      intentDeviation: intentDeviation.signal,
      ...(input.currentTarget ? { currentTarget: input.currentTarget } : {}),
      ...(intentDeviation.targetLoadCeiling != null
        ? { intentDeviationTargetLoadCeiling: intentDeviation.targetLoadCeiling }
        : {}),
    },
  };
}

function resolveIntentDeviationSignal(input: {
  sessions: CanonicalProgressionHistorySession[];
  repRange: [number, number];
  equipment: ProgressionEquipment;
}): IntentDeviationResolution {
  const validEvaluations = input.sessions
    .map((session) =>
      evaluateIntentDeviationExposure({
        sets: session.sets ?? [],
        repRange: input.repRange,
        equipment: input.equipment,
      })
    )
    .filter((evaluation) => evaluation.valid)
    .slice(0, 3);

  if (validEvaluations.length < 3) {
    return buildIntentDeviationResolution("none");
  }

  const latest = validEvaluations[0];
  const deviatedCount = validEvaluations.filter((evaluation) => evaluation.deviated).length;
  const severity =
    latest?.deviated !== true
      ? "none"
      : deviatedCount === 3
        ? "strong"
        : deviatedCount === 2
          ? "moderate"
          : "none";

  if (severity === "none" || !Number.isFinite(latest?.targetLoadCeiling)) {
    return buildIntentDeviationResolution("none");
  }

  return buildIntentDeviationResolution(severity, latest.targetLoadCeiling as number);
}

function buildIntentDeviationResolution(
  severity: IntentDeviationSeverity,
  targetLoadCeiling?: number
): IntentDeviationResolution {
  return {
    signal: {
      detected: severity !== "none",
      severity,
    },
    ...(targetLoadCeiling != null ? { targetLoadCeiling } : {}),
  };
}

function evaluateIntentDeviationExposure(input: {
  sets: ProgressionSet[];
  repRange: [number, number];
  equipment: ProgressionEquipment;
}): { valid: boolean; deviated: boolean; targetLoadCeiling?: number } {
  const targetBearingSets = input.sets.filter(
    (set) =>
      Number.isFinite(set.load) &&
      (set.load ?? 0) >= 0 &&
      Number.isFinite(set.targetLoad) &&
      (set.targetLoad ?? 0) >= 0 &&
      Number.isFinite(set.reps) &&
      set.reps > 0 &&
      Number.isFinite(set.rpe) &&
      (set.rpe as number) >= 6
  );
  if (targetBearingSets.length === 0) {
    return { valid: false, deviated: false };
  }

  const loads = targetBearingSets.map((set) => set.load as number);
  const targetLoads = targetBearingSets.map((set) => set.targetLoad as number);
  const repFloors = targetBearingSets.map((set) => resolveSetRepFloor(set, input.repRange[0]));
  const belowFloorCount = targetBearingSets.filter(
    (set, index) => set.reps < repFloors[index]
  ).length;
  const belowFloorRatio = belowFloorCount / targetBearingSets.length;
  const representativeLoad = median(loads);
  const representativeTargetLoad = median(targetLoads);
  const materiallyAbovePrescription =
    representativeLoad - representativeTargetLoad >=
    resolveMateriallyAboveThreshold(representativeTargetLoad, input.equipment);

  return {
    valid: true,
    deviated: belowFloorRatio >= 0.6 && materiallyAbovePrescription,
    targetLoadCeiling: resolveModalNumber(targetLoads) ?? representativeTargetLoad,
  };
}

function resolveSetRepFloor(set: ProgressionSet, fallback: number): number {
  if (
    set.targetRepRange &&
    Number.isFinite(set.targetRepRange.min) &&
    set.targetRepRange.min > 0
  ) {
    return set.targetRepRange.min;
  }
  if (Number.isFinite(set.targetRepMin) && (set.targetRepMin ?? 0) > 0) {
    return set.targetRepMin as number;
  }
  if (Number.isFinite(set.targetReps) && (set.targetReps ?? 0) > 0) {
    return set.targetReps as number;
  }
  return fallback;
}

function resolveIntentDeviationIncrement(equipment: ProgressionEquipment): number {
  if (equipment === "barbell") return 5;
  if (equipment === "dumbbell") return 2.5;
  if (equipment === "cable") return 2.5;
  return 2.5;
}

function resolveMateriallyAboveThreshold(
  prescribedLoad: number,
  equipment: ProgressionEquipment
): number {
  return Math.max(resolveIntentDeviationIncrement(equipment) * 2, prescribedLoad * 0.12);
}

function resolveModalNumber(values: number[]): number | undefined {
  if (values.length === 0) {
    return undefined;
  }
  const frequency = new Map<number, number>();
  for (const value of values) {
    frequency.set(value, (frequency.get(value) ?? 0) + 1);
  }
  const center = median(values);
  return Array.from(frequency.entries()).sort((left, right) => {
    if (right[1] !== left[1]) {
      return right[1] - left[1];
    }
    const leftDistance = Math.abs(left[0] - center);
    const rightDistance = Math.abs(right[0] - center);
    if (leftDistance !== rightDistance) {
      return leftDistance - rightDistance;
    }
    return left[0] - right[0];
  })[0]?.[0];
}

function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }
  return sorted[middle];
}

function resolveProgressionHistoryConfidenceScale(
  sessions: CanonicalProgressionHistorySession[]
): number {
  if (sessions.length <= 1) {
    return 1;
  }
  const hasIntentHistory = sessions.some((session) => session.selectionMode === "INTENT");
  if (!hasIntentHistory && sessions.every((session) => session.selectionMode === "MANUAL")) {
    return 1;
  }
  const total = sessions.reduce(
    (sum, session) => sum + Math.min(1, Math.max(0, session.confidence)),
    0
  );
  return Number((total / sessions.length).toFixed(2));
}

function collectProgressionConfidenceNotes(
  sessions: CanonicalProgressionHistorySession[]
): string[] {
  return [...new Set(sessions.flatMap((session) => session.confidenceNotes ?? []))];
}

function clampConfidenceScale(value?: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.min(1, Math.max(0, value as number));
}
