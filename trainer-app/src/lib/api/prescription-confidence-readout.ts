import {
  EXACT_HISTORY_TRANSLATED_CONTEXT_REASON_CODE,
  RUNTIME_ADDED_SAME_EXERCISE_CALIBRATION_REASON_CODE,
  type ApplyLoadsAudit,
} from "@/lib/engine/apply-loads";
import type {
  Exercise,
  WorkoutExercise,
  WorkoutPlan,
  WorkoutSet,
} from "@/lib/engine/types";
import { listWorkoutPlanExercisesInOrder } from "@/lib/engine/workout-plan-order";
import type { ProgressionDecisionTrace } from "@/lib/evidence/session-audit-types";
import type {
  PrescriptionConfidenceLoadSource,
  PrescriptionConfidenceReadout,
} from "@/lib/api/template-session/types";

const TARGET_EFFORT_MISMATCH_REP_GAP = 2;
const TARGET_EFFORT_MISMATCH_RPE_GAP = 1.5;
const TARGET_EFFORT_MISMATCH_MIN_PERFORMANCE_JUMP_RATIO = 1.05;

type RepresentativeTarget = {
  load: number | null;
  reps: number | null;
  repRange: { min: number; max: number } | null;
  rpe: number | null;
};

type TargetEffortLoadMismatchInput = {
  target: RepresentativeTarget;
  trace?: ProgressionDecisionTrace;
};

export type TargetEffortLoadMismatchClassification = {
  isMismatch: boolean;
  reasonCode:
    | "target_effort_load_mismatch"
    | typeof EXACT_HISTORY_TRANSLATED_CONTEXT_REASON_CODE
    | null;
};

export function classifyTargetEffortLoadMismatch(
  input: TargetEffortLoadMismatchInput
): TargetEffortLoadMismatchClassification {
  const trace = input.trace;
  const targetLoad = input.target.load;
  const targetReps = input.target.reps ?? input.target.repRange?.max ?? null;
  const targetRpe = input.target.rpe;

  if (
    !trace ||
    !Number.isFinite(targetLoad) ||
    !Number.isFinite(targetReps) ||
    !Number.isFinite(targetRpe)
  ) {
    return { isMismatch: false, reasonCode: null };
  }

  if (trace.outcome.reasonCodes.includes(EXACT_HISTORY_TRANSLATED_CONTEXT_REASON_CODE)) {
    return {
      isMismatch: true,
      reasonCode: EXACT_HISTORY_TRANSLATED_CONTEXT_REASON_CODE,
    };
  }

  const anchorLoad = trace.anchor.anchorLoad;
  const priorMedianReps = trace.metrics.medianReps;
  const priorModalRpe = trace.metrics.modalRpe;
  if (
    !Number.isFinite(anchorLoad) ||
    !Number.isFinite(priorMedianReps) ||
    !Number.isFinite(priorModalRpe)
  ) {
    return { isMismatch: false, reasonCode: null };
  }

  const targetLoadHoldsHigh = (targetLoad as number) >= anchorLoad;
  const repsGap = (targetReps as number) - priorMedianReps;
  const rpeGap = (priorModalRpe as number) - (targetRpe as number);
  const priorPerformance = anchorLoad * (1 + priorMedianReps / 30);
  const targetPerformance = (targetLoad as number) * (1 + (targetReps as number) / 30);
  const performanceJumpRatio =
    priorPerformance > 0 ? targetPerformance / priorPerformance : 0;

  const isMismatch =
    targetLoadHoldsHigh &&
    repsGap >= TARGET_EFFORT_MISMATCH_REP_GAP &&
    rpeGap >= TARGET_EFFORT_MISMATCH_RPE_GAP &&
    performanceJumpRatio >= TARGET_EFFORT_MISMATCH_MIN_PERFORMANCE_JUMP_RATIO;

  return {
    isMismatch,
    reasonCode: isMismatch ? "target_effort_load_mismatch" : null,
  };
}

export function buildPrescriptionConfidenceReadouts(input: {
  workout: WorkoutPlan;
  loadAudit?: Pick<
    ApplyLoadsAudit,
    "progressionTraces" | "resolvedLoads" | "selectedAnchorEvidence"
  >;
}): PrescriptionConfidenceReadout[] {
  return listWorkoutPlanExercisesInOrder(input.workout).flatMap(
    ({ section, exercise }) => {
      if (section === "warmup") {
        return [];
      }

      const exerciseId = exercise.exercise.id;
      const trace = input.loadAudit?.progressionTraces[exerciseId];
      const resolvedLoad = input.loadAudit?.resolvedLoads[exerciseId];
      const target = resolveRepresentativeTarget(exercise, trace);
      const loadSource = resolveLoadSource({
        exercise: exercise.exercise,
        targetLoad: target.load,
        source: resolvedLoad?.source,
      });
      const selectedAnchorEvidence =
        input.loadAudit?.selectedAnchorEvidence?.[exerciseId];
      const mismatch = classifyTargetEffortLoadMismatch({ target, trace });
      const confidence = resolveConfidence({ trace, loadSource, mismatch });
      const caution = resolveCaution({ confidence, loadSource, mismatch });

      return [{
        exerciseId,
        exerciseName: exercise.exercise.name,
        targetLoad: target.load,
        targetReps: target.reps,
        repRange: target.repRange,
        targetRpe: target.rpe,
        targetRir: resolveTargetRir(target.rpe),
        loadSource,
        confidence,
        cautionLevel: caution.level,
        cautionReason: caution.reason,
        suggestedAdjustmentRange: buildSuggestedAdjustmentRange({
          targetLoad: target.load,
          cautionReason: caution.reason,
        }),
        ...(selectedAnchorEvidence
          ? {
              selectedAnchorEvidence: {
                ...selectedAnchorEvidence,
                selectedExerciseName: exercise.exercise.name,
              },
            }
          : {}),
      }];
    }
  );
}

function resolveRepresentativeSet(exercise: WorkoutExercise): WorkoutSet | undefined {
  return exercise.sets.find((set) => set.setIndex === 1) ?? exercise.sets[0];
}

function resolveFiniteNumber(value: number | undefined): number | null {
  return Number.isFinite(value) ? (value as number) : null;
}

function resolveRepresentativeTarget(
  exercise: WorkoutExercise,
  trace: ProgressionDecisionTrace | undefined
): RepresentativeTarget {
  const set = resolveRepresentativeSet(exercise);
  const repRange =
    set?.targetRepRange ??
    (trace
      ? {
          min: trace.repRange.min,
          max: trace.repRange.max,
        }
      : null);
  const targetLoad = resolveFiniteNumber(set?.targetLoad) ?? trace?.metrics.nextLoad ?? null;

  return {
    load: Number.isFinite(targetLoad) ? targetLoad : null,
    reps: resolveFiniteNumber(set?.targetReps),
    repRange,
    rpe: resolveFiniteNumber(set?.targetRpe),
  };
}

function resolveLoadSource(input: {
  exercise: Exercise;
  targetLoad: number | null;
  source?: ApplyLoadsAudit["resolvedLoads"][string]["source"];
}): PrescriptionConfidenceLoadSource {
  if (input.targetLoad === 0) {
    return "bodyweight";
  }

  if (input.targetLoad == null) {
    return input.exercise.equipment.includes("bodyweight") ? "bodyweight" : "none";
  }

  return input.source ?? "unknown";
}

function resolveConfidence(input: {
  trace: ProgressionDecisionTrace | undefined;
  loadSource: PrescriptionConfidenceLoadSource;
  mismatch: TargetEffortLoadMismatchClassification;
}): PrescriptionConfidenceReadout["confidence"] {
  if (input.mismatch.isMismatch || input.loadSource === "estimate") {
    return "low";
  }

  if (input.loadSource === "bodyweight") {
    return "high";
  }

  const combinedScale = input.trace?.confidence.combinedScale;
  if (Number.isFinite(combinedScale)) {
    if ((combinedScale as number) >= 0.85) {
      return "high";
    }
    if ((combinedScale as number) >= 0.6) {
      return "medium";
    }
    return "low";
  }

  if (input.loadSource === "history") {
    return "medium";
  }
  if (input.loadSource === RUNTIME_ADDED_SAME_EXERCISE_CALIBRATION_REASON_CODE) {
    return "medium";
  }
  if (input.loadSource === "baseline" || input.loadSource === "existing_target_load") {
    return "medium";
  }
  return "low";
}

function resolveCaution(input: {
  confidence: PrescriptionConfidenceReadout["confidence"];
  loadSource: PrescriptionConfidenceLoadSource;
  mismatch: TargetEffortLoadMismatchClassification;
}): { level: PrescriptionConfidenceReadout["cautionLevel"]; reason: string | null } {
  if (input.mismatch.isMismatch) {
    return {
      level: "caution",
      reason:
        input.mismatch.reasonCode === EXACT_HISTORY_TRANSLATED_CONTEXT_REASON_CODE
          ? `${EXACT_HISTORY_TRANSLATED_CONTEXT_REASON_CODE}: prior high-effort lower-rep history was translated down for this easier target.`
          : "target_effort_load_mismatch: prior reps and effort do not clearly support the easier target at this load.",
    };
  }

  if (input.loadSource === "estimate") {
    return {
      level: "notice",
      reason: "estimate_load_no_exact_history",
    };
  }

  if (input.loadSource === RUNTIME_ADDED_SAME_EXERCISE_CALIBRATION_REASON_CODE) {
    return {
      level: "notice",
      reason: RUNTIME_ADDED_SAME_EXERCISE_CALIBRATION_REASON_CODE,
    };
  }

  if (input.confidence === "low") {
    return {
      level: "notice",
      reason: "low_progression_confidence",
    };
  }

  return { level: "none", reason: null };
}

function resolveTargetRir(targetRpe: number | null): number | null {
  if (!Number.isFinite(targetRpe)) {
    return null;
  }
  return Number((10 - (targetRpe as number)).toFixed(1));
}

function buildSuggestedAdjustmentRange(input: {
  targetLoad: number | null;
  cautionReason: string | null;
}): PrescriptionConfidenceReadout["suggestedAdjustmentRange"] {
  if (!input.cautionReason || !Number.isFinite(input.targetLoad) || (input.targetLoad ?? 0) <= 0) {
    return null;
  }

  const maxLoad = input.targetLoad as number;
  const minLoad = Math.max(0, maxLoad - resolveAdjustmentStep(maxLoad));
  return {
    minLoad,
    maxLoad,
    unit: "lb",
    basis: resolveAdjustmentBasis(input.cautionReason),
  };
}

function resolveAdjustmentBasis(cautionReason: string): string {
  if (cautionReason.startsWith("target_effort_load_mismatch")) {
    return "target_effort_load_mismatch";
  }
  if (cautionReason.startsWith(EXACT_HISTORY_TRANSLATED_CONTEXT_REASON_CODE)) {
    return EXACT_HISTORY_TRANSLATED_CONTEXT_REASON_CODE;
  }
  return cautionReason;
}

function resolveAdjustmentStep(load: number): number {
  if (load >= 100) {
    return 10;
  }
  if (load >= 50) {
    return 5;
  }
  return 2.5;
}
