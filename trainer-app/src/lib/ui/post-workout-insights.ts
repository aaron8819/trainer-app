import type {
  NextExposureDecision,
  WorkoutExplanation,
} from "@/lib/engine/explainability";
import type { ProgressionReceipt } from "@/lib/evidence/types";
import { VOLUME_LANDMARKS } from "@/lib/engine/volume-landmarks";
import {
  getWeeklyMuscleStatus,
  type WeeklyMuscleStatus,
} from "@/lib/ui/weekly-muscle-status";

export type ReviewedExerciseMeta = {
  exerciseId: string;
  exerciseName: string;
  isMainLift: boolean;
};

export type PostWorkoutInsightTone = "positive" | "neutral" | "caution";

export type PostWorkoutOverviewItem = {
  label: string;
  value: string;
  tone: PostWorkoutInsightTone;
  emphasized?: boolean;
};

export type PostWorkoutKeyLiftInsight = {
  exerciseId: string;
  exerciseName: string;
  badge: string;
  tone: PostWorkoutInsightTone;
  performed: string;
  todayContext: string;
  nextTime: string;
};

export type PostWorkoutProgramSignal = {
  label: string;
  value: string;
  tone: PostWorkoutInsightTone;
};

export type PostWorkoutInsightsModel = {
  headline: string;
  summary: string;
  overview: PostWorkoutOverviewItem[];
  keyLifts: PostWorkoutKeyLiftInsight[];
  programSignals: PostWorkoutProgramSignal[];
};

const VOLUME_STATUS_PRIORITY: Record<WeeklyMuscleStatus, number> = {
  at_mrv: 0,
  near_mrv: 1,
  below_mev: 2,
  in_range: 3,
  near_target: 4,
  on_target: 5,
};

function formatSignedPercent(value: number | null | undefined): string | null {
  if (value == null || !Number.isFinite(value)) {
    return null;
  }
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function formatLoad(load: number | null | undefined): string {
  if (load == null || !Number.isFinite(load)) {
    return "your logged working load";
  }
  if (load === 0) {
    return "bodyweight";
  }
  return `${load} lbs`;
}

function formatExerciseNameList(names: string[]): string {
  if (names.length === 0) {
    return "your key lifts";
  }
  if (names.length === 1) {
    return names[0];
  }
  if (names.length === 2) {
    return `${names[0]} and ${names[1]}`;
  }
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

function describePerformedSignal(decision: NextExposureDecision): string {
  const parts = [
    `Today's performed signal centered on ${formatLoad(decision.anchorLoad)}`,
    decision.medianReps != null
      ? `median ${Number(decision.medianReps.toFixed(1))} reps`
      : null,
    decision.modalRpe != null ? `modal RPE ${decision.modalRpe}` : null,
  ].filter(Boolean);

  return `${parts.join(" at ")}.`;
}

function describeTodayTargetContext(receipt: ProgressionReceipt | undefined): string {
  if (!receipt) {
    return "Today's written target stayed close to plan because no clear progression trace was available.";
  }

  const previousLoad = receipt.lastPerformed?.load;
  const todayLoad = receipt.todayPrescription?.load;
  const deltaPercent = formatSignedPercent(receipt.delta.loadPercent);

  switch (receipt.trigger) {
    case "double_progression":
      if (previousLoad != null && todayLoad != null) {
        return `Today's written target moved from ${formatLoad(previousLoad)} to ${formatLoad(todayLoad)}${deltaPercent ? ` (${deltaPercent})` : ""}.`;
      }
      return "Today's written target moved up from your prior performed anchor.";
    case "hold":
      if (todayLoad != null) {
        return `Today's written target held at ${formatLoad(todayLoad)} because recent history did not justify a change.`;
      }
      return "Today's written target held your recent anchor.";
    case "readiness_scale":
      return "Today's written target was adjusted to match the readiness signal on the day.";
    case "deload":
      return "Today's written target was intentionally reduced for deload work.";
    default:
      return "Today's written target stayed close to the plan because recent performed history was limited.";
  }
}

function toneForAction(action: NextExposureDecision["action"]): PostWorkoutInsightTone {
  if (action === "increase") {
    return "positive";
  }
  if (action === "decrease") {
    return "caution";
  }
  return "neutral";
}

function badgeForAction(action: NextExposureDecision["action"]): string {
  if (action === "increase") {
    return "Likely increase";
  }
  if (action === "decrease") {
    return "Likely reduce";
  }
  return "Hold";
}

function describeVolumeSignal(status: WeeklyMuscleStatus, muscle: string): string {
  switch (status) {
    case "at_mrv":
      return `${muscle} is at MRV after this session.`;
    case "near_mrv":
      return `${muscle} is getting close to MRV after this session.`;
    case "on_target":
      return `${muscle} is on target for the week after this session.`;
    case "near_target":
      return `${muscle} is close to this week's target after this session.`;
    case "in_range":
      return `${muscle} is in range for the week after this session.`;
    case "below_mev":
      return `${muscle} is still below MEV after this session.`;
  }
}

function toneForVolumeStatus(status: WeeklyMuscleStatus): PostWorkoutInsightTone {
  if (status === "at_mrv" || status === "near_mrv" || status === "below_mev") {
    return "caution";
  }
  if (status === "on_target") {
    return "positive";
  }
  return "neutral";
}

function buildProgramSignals(explanation: WorkoutExplanation): PostWorkoutProgramSignal[] {
  const volumeSignals = [...explanation.volumeCompliance]
    .map((row) => {
      const landmarks = VOLUME_LANDMARKS[row.muscle];
      if (!landmarks) {
        return null;
      }

      const status = getWeeklyMuscleStatus({
        effectiveSets: row.projectedEffectiveVolume,
        target: row.weeklyTarget,
        mev: row.mev,
        mrv: landmarks.mrv,
      });

      return {
        muscle: row.muscle,
        status,
      };
    })
    .filter((row): row is { muscle: string; status: WeeklyMuscleStatus } => row !== null)
    .sort((left, right) => {
      const priorityDiff = VOLUME_STATUS_PRIORITY[left.status] - VOLUME_STATUS_PRIORITY[right.status];
      if (priorityDiff !== 0) {
        return priorityDiff;
      }
      return left.muscle.localeCompare(right.muscle);
    })
    .slice(0, 3)
    .map((row) => ({
      label: row.muscle,
      value: describeVolumeSignal(row.status, row.muscle),
      tone: toneForVolumeStatus(row.status),
    }));

  const readinessAdaptation = explanation.sessionContext.readinessStatus.adaptations[0];
  if (readinessAdaptation) {
    return [
      {
        label: "Readiness",
        value: readinessAdaptation,
        tone: "caution",
      },
      ...volumeSignals.slice(0, 2),
    ];
  }

  return volumeSignals;
}

function buildKeyLiftInsights(
  explanation: WorkoutExplanation,
  exercises: ReviewedExerciseMeta[]
): PostWorkoutKeyLiftInsight[] {
  const withDecision = exercises.filter((exercise) =>
    explanation.nextExposureDecisions.has(exercise.exerciseId)
  );
  const primary = withDecision.filter((exercise) => exercise.isMainLift);
  const selected = (primary.length > 0 ? primary : withDecision).slice(0, 3);

  return selected.flatMap((exercise) => {
    const decision = explanation.nextExposureDecisions.get(exercise.exerciseId);
    if (!decision) {
      return [];
    }
    const receipt = explanation.progressionReceipts.get(exercise.exerciseId);
    return [
      {
        exerciseId: exercise.exerciseId,
        exerciseName: exercise.exerciseName,
        badge: badgeForAction(decision.action),
        tone: toneForAction(decision.action),
        performed: describePerformedSignal(decision),
        todayContext: describeTodayTargetContext(receipt),
        nextTime: `${decision.summary} ${decision.reason}`,
      },
    ];
  });
}

function buildHeadline(keyLifts: PostWorkoutKeyLiftInsight[]): string {
  const increaseCount = keyLifts.filter((lift) => lift.badge === "Likely increase").length;
  const decreaseCount = keyLifts.filter((lift) => lift.badge === "Likely reduce").length;

  if (decreaseCount > 0) {
    return "At least one key lift needs a more conservative next exposure.";
  }
  if (increaseCount > 0 && increaseCount < keyLifts.length) {
    return "Some key lifts are ready to move up, while others should stay put.";
  }
  if (increaseCount > 0) {
    return "Key lift performance likely earned a load increase next time.";
  }
  if (keyLifts.length > 0) {
    return "Key lifts stayed on track, but nothing clearly earned a load jump yet.";
  }
  return "Session logged. Review the detailed set log below.";
}

function buildSummary(
  keyLifts: PostWorkoutKeyLiftInsight[],
  programSignals: PostWorkoutProgramSignal[]
): string {
  const increaseNames = keyLifts
    .filter((lift) => lift.badge === "Likely increase")
    .map((lift) => lift.exerciseName);
  const decreaseNames = keyLifts
    .filter((lift) => lift.badge === "Likely reduce")
    .map((lift) => lift.exerciseName);

  if (decreaseNames.length > 0) {
    return `Keep the next exposure conservative on ${formatExerciseNameList(decreaseNames)}.`;
  }
  if (increaseNames.length > 0) {
    return `The next exposure can likely move up on ${formatExerciseNameList(increaseNames)} if setup and readiness feel normal.`;
  }
  if (keyLifts.length > 0) {
    return "The session moved forward, but the next exposure still looks like a hold while reps keep building.";
  }
  if (programSignals.length > 0) {
    return programSignals[0].value;
  }
  return "The session is logged and ready for a deeper review if you need it.";
}

function buildOverview(
  keyLifts: PostWorkoutKeyLiftInsight[],
  programSignals: PostWorkoutProgramSignal[]
): PostWorkoutOverviewItem[] {
  const increaseNames = keyLifts
    .filter((lift) => lift.badge === "Likely increase")
    .map((lift) => lift.exerciseName);
  const holdNames = keyLifts
    .filter((lift) => lift.badge === "Hold")
    .map((lift) => lift.exerciseName);
  const reduceNames = keyLifts
    .filter((lift) => lift.badge === "Likely reduce")
    .map((lift) => lift.exerciseName);

  const howItWent =
    reduceNames.length > 0
      ? `${reduceNames.length} key lift${reduceNames.length === 1 ? "" : "s"} came back with a caution signal.`
      : increaseNames.length > 0
      ? `${increaseNames.length} key lift${increaseNames.length === 1 ? "" : "s"} likely earned more load next time.`
      : holdNames.length > 0
      ? `${holdNames.length} key lift${holdNames.length === 1 ? "" : "s"} stayed in hold territory.`
      : "No key-lift progression call was available.";

  const nextTime =
    reduceNames.length > 0
      ? `Reduce load or re-check setup on ${formatExerciseNameList(reduceNames)} next time.`
      : increaseNames.length > 0 && holdNames.length > 0
      ? `Increase ${formatExerciseNameList(increaseNames)}; hold ${formatExerciseNameList(holdNames)}.`
      : increaseNames.length > 0
      ? `Increase load on ${formatExerciseNameList(increaseNames)} next time.`
      : holdNames.length > 0
      ? `Hold load on ${formatExerciseNameList(holdNames)} and keep building reps.`
      : "Use the detailed lift cards below for the next-exposure read.";

  return [
    {
      label: "How it went",
      value: howItWent,
      tone: reduceNames.length > 0 ? "caution" : increaseNames.length > 0 ? "positive" : "neutral",
    },
    {
      label: "Next time",
      value: nextTime,
      tone: reduceNames.length > 0 ? "caution" : increaseNames.length > 0 ? "positive" : "neutral",
      emphasized: true,
    },
  ];
}

export function buildPostWorkoutInsightsModel(input: {
  explanation: WorkoutExplanation;
  exercises: ReviewedExerciseMeta[];
}): PostWorkoutInsightsModel {
  const keyLifts = buildKeyLiftInsights(input.explanation, input.exercises);
  const programSignals = buildProgramSignals(input.explanation);

  return {
    headline: buildHeadline(keyLifts),
    summary: buildSummary(keyLifts, programSignals),
    overview: buildOverview(keyLifts, programSignals),
    keyLifts,
    programSignals,
  };
}
