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
    },
    context: {
      workingSetLoad: input.workingSetLoad,
      priorSessionCount,
      historyConfidenceScale: combinedHistoryConfidenceScale,
      confidenceReasons,
    },
  };
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
