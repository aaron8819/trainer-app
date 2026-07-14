import {
  buildPreSessionReadinessGymCardDto,
  type PreSessionReadinessGymCardDto,
} from "./pre-session-readiness-gym-card";
import {
  loadCurrentHomePreSessionReadinessContractCandidate,
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

export type LogWorkoutExecutionGuidanceByExercise = {
  byExerciseId: Record<string, LogWorkoutExecutionGuidance[]>;
  byExerciseName: Record<string, LogWorkoutExecutionGuidance[]>;
};

function emptyLogWorkoutExecutionGuidanceByExercise(): LogWorkoutExecutionGuidanceByExercise {
  return { byExerciseId: {}, byExerciseName: {} };
}

export function normalizeLogWorkoutGuidanceExerciseLabel(
  value: string | null | undefined
): string | null {
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

function buildUniquePreviewExerciseIdByLabel(
  preview: PreSessionReadinessGymCardDto["workoutPreview"]
): Map<string, string | null> {
  const previewExercises =
    preview.source === "generated_session_audit_snapshot"
      ? preview.exercises
      : [];
  const exerciseIdsByLabel = new Map<string, Set<string>>();

  for (const exercise of previewExercises) {
    const key = normalizeLogWorkoutGuidanceExerciseLabel(exercise.exerciseName);
    if (!key) {
      continue;
    }

    const ids = exerciseIdsByLabel.get(key) ?? new Set<string>();
    ids.add(exercise.exerciseId);
    exerciseIdsByLabel.set(key, ids);
  }

  return new Map(
    Array.from(exerciseIdsByLabel.entries()).map(([key, ids]) => [
      key,
      ids.size === 1 ? Array.from(ids)[0] : null,
    ])
  );
}

export function buildLogWorkoutExecutionGuidanceByExercise(
  card: PreSessionReadinessGymCardDto | null | undefined
): LogWorkoutExecutionGuidanceByExercise {
  if (!card) {
    return emptyLogWorkoutExecutionGuidanceByExercise();
  }

  const rows: LogWorkoutExecutionGuidanceByExercise = {
    byExerciseId: {},
    byExerciseName: {},
  };
  const previewExerciseIdByLabel = buildUniquePreviewExerciseIdByLabel(
    card.workoutPreview
  );

  for (const note of card.calibrationNotes) {
    const key = normalizeLogWorkoutGuidanceExerciseLabel(note.exerciseLabel);
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

    const exerciseId = previewExerciseIdByLabel.get(key);
    if (exerciseId) {
      rows.byExerciseId[exerciseId] = [
        ...(rows.byExerciseId[exerciseId] ?? []),
        guidance,
      ];
    } else if (exerciseId === undefined) {
      rows.byExerciseName[key] = [
        ...(rows.byExerciseName[key] ?? []),
        guidance,
      ];
    }
  }

  return rows;
}

export function getLogWorkoutExecutionGuidanceForExercise(
  guidanceByExercise: LogWorkoutExecutionGuidanceByExercise,
  exercise: {
    exerciseId?: string | null;
    name: string;
    hasAmbiguousName?: boolean;
  }
): LogWorkoutExecutionGuidance[] {
  const idGuidance = exercise.exerciseId
    ? guidanceByExercise.byExerciseId[exercise.exerciseId]
    : undefined;
  if (idGuidance) {
    return idGuidance;
  }

  if (exercise.hasAmbiguousName) {
    return [];
  }

  const key = normalizeLogWorkoutGuidanceExerciseLabel(exercise.name);
  return key ? guidanceByExercise.byExerciseName[key] ?? [] : [];
}

export async function loadLogWorkoutExecutionGuidance(input: {
  userId: string;
  workoutId: string;
}): Promise<LogWorkoutExecutionGuidanceByExercise> {
  const candidate = await loadCurrentHomePreSessionReadinessContractCandidate(input.userId);
  const contract = resolveHomePreSessionReadinessContract({
    userId: input.userId,
    candidate,
  });

  if (!contract || contract.nextSessionIdentity.existingWorkoutId !== input.workoutId) {
    return emptyLogWorkoutExecutionGuidanceByExercise();
  }

  return buildLogWorkoutExecutionGuidanceByExercise(
    buildPreSessionReadinessGymCardDto(contract)
  );
}
