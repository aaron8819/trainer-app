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

export type IntentDeviationSignal = {
  flagged: boolean;
  targetLoadCeiling?: number;
};

export type CanonicalProgressionEvaluationInput = {
  lastSets: ProgressionSet[];
  repRange: [number, number];
  equipment: ProgressionEquipment;
  decisionOptions: DoubleProgressionDecisionOptions;
  context: {
    workingSetLoad?: number;
    priorSessionCount: number;
    historyConfidenceScale: number;
    confidenceReasons: string[];
    intentDeviation: IntentDeviationSignal;
  };
};

export function buildCanonicalProgressionEvaluationInput(input: {
  lastSets: ProgressionSet[];
  repRange: [number, number];
  equipment: ProgressionEquipment;
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
    decisionOptions: {
      workingSetLoad: input.workingSetLoad,
      priorSessionCount,
      historyConfidenceScale: combinedHistoryConfidenceScale,
      confidenceReasons,
      intentDeviation,
    },
    context: {
      workingSetLoad: input.workingSetLoad,
      priorSessionCount,
      historyConfidenceScale: combinedHistoryConfidenceScale,
      confidenceReasons,
      intentDeviation,
    },
  };
}

function resolveIntentDeviationSignal(input: {
  sessions: CanonicalProgressionHistorySession[];
  repRange: [number, number];
  equipment: ProgressionEquipment;
}): IntentDeviationSignal {
  const recent = input.sessions.slice(0, 3);
  if (recent.length === 0) {
    return { flagged: false };
  }

  const evaluations = recent.map((session) =>
    evaluateIntentDeviationExposure({
      sets: session.sets ?? [],
      repRange: input.repRange,
      equipment: input.equipment,
    })
  );
  const latest = evaluations[0];
  const validCount = evaluations.filter((evaluation) => evaluation.valid).length;
  const deviatedCount = evaluations.filter((evaluation) => evaluation.deviated).length;

  if (
    validCount >= 2 &&
    latest?.deviated === true &&
    deviatedCount >= 2 &&
    Number.isFinite(latest.targetLoadCeiling)
  ) {
    return {
      flagged: true,
      targetLoadCeiling: latest.targetLoadCeiling,
    };
  }

  return { flagged: false };
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
  const medianLoad = median(loads);
  const medianTargetLoad = median(targetLoads);
  const medianReps = median(targetBearingSets.map((set) => set.reps));
  const repFloor = median(repFloors);
  const equipmentIncrement = resolveIntentDeviationIncrement(input.equipment);
  const requiredLoadOvershoot = Math.max(equipmentIncrement, medianTargetLoad * 0.05);
  const materiallyAbovePrescription =
    medianLoad - medianTargetLoad >= requiredLoadOvershoot;
  const materiallyBelowRepFloor =
    medianReps <= repFloor - 2 || medianReps <= repFloor * 0.75;
  const belowFloorCount = targetBearingSets.filter(
    (set, index) => set.reps < repFloors[index]
  ).length;
  const broadRepMiss = belowFloorCount >= Math.ceil(targetBearingSets.length / 2);

  return {
    valid: true,
    deviated:
      materiallyAbovePrescription &&
      materiallyBelowRepFloor &&
      broadRepMiss,
    targetLoadCeiling: resolveModalNumber(targetLoads),
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
