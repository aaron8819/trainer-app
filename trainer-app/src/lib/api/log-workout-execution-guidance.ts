import {
  buildPreSessionReadinessGymCardDto,
  type PreSessionReadinessGymCardDto,
} from "./pre-session-readiness-gym-card";
import {
  loadLatestHomePreSessionReadinessContractCandidate,
  resolveHomePreSessionReadinessContract,
} from "./home-pre-session-readiness";

export type LogWorkoutExecutionGuidance = {
  title: "Prescription guidance";
  message: string;
  confidenceLabel?: string;
  sourceLabel?: string;
  cautionLabel?: string;
  adjustmentRangeLabel?: string;
};

export type LogWorkoutExecutionGuidanceByExercise = Record<
  string,
  LogWorkoutExecutionGuidance[]
>;

function normalizeExerciseLabel(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLocaleLowerCase();
  return normalized ? normalized : null;
}

function formatLoad(value: number): string {
  return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1);
}

function formatConfidenceLabel(
  value: PreSessionReadinessGymCardDto["calibrationNotes"][number]["loadConfidence"]
): string | undefined {
  if (value === "high") {
    return "High confidence";
  }
  if (value === "medium") {
    return "Medium confidence";
  }
  if (value === "low") {
    return "Low confidence";
  }
  return undefined;
}

function formatSourceLabel(
  value: PreSessionReadinessGymCardDto["calibrationNotes"][number]["loadSource"]
): string | undefined {
  switch (value) {
    case "history":
      return "History";
    case "baseline":
      return "Baseline";
    case "estimate":
      return "Estimated";
    case "existing_target_load":
      return "Saved target";
    case "runtime_added_same_exercise_calibration_anchor":
      return "Same-exercise calibration";
    case "bodyweight":
      return "Bodyweight";
    case "none":
    case "unknown":
    case undefined:
      return undefined;
    default:
      return undefined;
  }
}

function formatCautionLabel(
  value: PreSessionReadinessGymCardDto["calibrationNotes"][number]["cautionLevel"]
): string | undefined {
  if (value === "caution") {
    return "Caution";
  }
  if (value === "notice") {
    return "Notice";
  }
  return undefined;
}

function formatAdjustmentRangeLabel(
  range: PreSessionReadinessGymCardDto["calibrationNotes"][number]["suggestedAdjustmentRange"]
): string | undefined {
  if (!range) {
    return undefined;
  }

  return `${formatLoad(range.minLoad)}-${formatLoad(range.maxLoad)} ${range.unit}`;
}

function hasUsefulDisplaySignal(
  note: PreSessionReadinessGymCardDto["calibrationNotes"][number]
): boolean {
  return Boolean(
    note.displayActionCode ||
      note.loadConfidence ||
      note.loadSource ||
      note.cautionLevel === "notice" ||
      note.cautionLevel === "caution" ||
      note.suggestedAdjustmentRange
  );
}

export function buildLogWorkoutExecutionGuidanceByExercise(
  card: PreSessionReadinessGymCardDto | null | undefined
): LogWorkoutExecutionGuidanceByExercise {
  if (!card) {
    return {};
  }

  const rows: LogWorkoutExecutionGuidanceByExercise = {};
  for (const note of card.calibrationNotes) {
    const key = normalizeExerciseLabel(note.exerciseLabel);
    if (note.kind !== "prescription_confidence" || !key || !hasUsefulDisplaySignal(note)) {
      continue;
    }

    const guidance: LogWorkoutExecutionGuidance = {
      title: "Prescription guidance",
      message: note.message,
      ...(formatConfidenceLabel(note.loadConfidence)
        ? { confidenceLabel: formatConfidenceLabel(note.loadConfidence) }
        : {}),
      ...(formatSourceLabel(note.loadSource)
        ? { sourceLabel: formatSourceLabel(note.loadSource) }
        : {}),
      ...(formatCautionLabel(note.cautionLevel)
        ? { cautionLabel: formatCautionLabel(note.cautionLevel) }
        : {}),
      ...(formatAdjustmentRangeLabel(note.suggestedAdjustmentRange)
        ? { adjustmentRangeLabel: formatAdjustmentRangeLabel(note.suggestedAdjustmentRange) }
        : {}),
    };

    rows[key] = [...(rows[key] ?? []), guidance];
  }

  return rows;
}

export function getLogWorkoutExecutionGuidanceForExercise(
  guidanceByExercise: LogWorkoutExecutionGuidanceByExercise,
  exerciseName: string
): LogWorkoutExecutionGuidance[] {
  const key = normalizeExerciseLabel(exerciseName);
  return key ? guidanceByExercise[key] ?? [] : [];
}

export async function loadLogWorkoutExecutionGuidance(input: {
  userId: string;
  workoutId: string;
}): Promise<LogWorkoutExecutionGuidanceByExercise> {
  const candidate = await loadLatestHomePreSessionReadinessContractCandidate(input.userId);
  const contract = resolveHomePreSessionReadinessContract({
    userId: input.userId,
    candidate,
  });

  if (!contract || contract.nextSessionIdentity.existingWorkoutId !== input.workoutId) {
    return {};
  }

  return buildLogWorkoutExecutionGuidanceByExercise(
    buildPreSessionReadinessGymCardDto(contract)
  );
}
