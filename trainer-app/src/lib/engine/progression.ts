import { DELOAD_THRESHOLDS, PLATEAU_CRITERIA } from "./rules";
import type { TrainingAge, WorkoutHistoryEntry } from "./types";
import { roundLoad } from "./utils";
import { isPerformedHistoryEntry } from "./history";
import type { ProgressionDecisionTrace } from "@/lib/evidence/session-audit-types";

export type ProgressionSet = {
  setIndex?: number;
  reps: number;
  rpe?: number;
  load?: number;
  targetLoad?: number;
  targetReps?: number;
  targetRepRange?: { min: number; max: number };
  targetRepMin?: number;
  targetRepMax?: number;
};
type HistorySet = WorkoutHistoryEntry["exercises"][number]["sets"][number];
export type ProgressionEquipment = "barbell" | "dumbbell" | "cable" | "other";
export type ProgressionDecisionPath =
  | "path_1"
  | "path_2"
  | "path_3"
  | "path_4"
  | "path_5_overshoot"
  | "fallback_hold";
export type ProgressionDecision = {
  nextLoad: number;
  anchorLoad: number;
  path: ProgressionDecisionPath;
  decisionLog: string[];
  trace: ProgressionDecisionTrace;
};
export type DoubleProgressionDecisionOptions = {
  priorSessionCount?: number;
  historyConfidenceScale?: number;
  confidenceReasons?: string[];
  /** Canonical working-set load for this exposure when the caller has already
   *  resolved the representative working load. */
  workingSetLoad?: number;
  intentDeviation?: {
    flagged: boolean;
    targetLoadCeiling?: number;
  };
};

export const PROGRESSION_CONFIG = {
  // Treat >=20% intra-session spread as unstable enough to trim outliers.
  highVarianceThreshold: 0.2,
  // Trim sets outside +/-15% of session median when high variance is detected.
  outlierTrimRange: 0.15,
  // Three or more prior sessions provides full confidence for progression steps.
  minSessionsForFullConfidence: 3,
  // Single prior-session signal is directionally useful, but scaled to avoid overshooting.
  singleSessionConfidenceScale: 0.8,
  // Plateau needs at least three tracked exposures to avoid reacting to noise.
  minSessionsForPlateauEvidence: 3,
  // Treat <=1% e1RM drift as effectively flat rather than meaningful progress.
  plateauImprovementEpsilon: 0.01,
  // Earned-overshoot progression still requires controlled effort.
  overshootStandardRpeCeiling: 8,
  // Slightly harder sessions can still earn an increase if the evidence is stronger.
  overshootControlledRpeCeiling: 8.5,
  // Single-set overshoots are too easy to game; require session-level evidence.
  minOvershootSetCount: 2,
  // The relaxed 8.5-RPE lane needs broad coverage across the target-bearing sets.
  overshootControlledCoverageRatio: 0.75,
  overshootControlledMinSetCount: 3,
  // Catch-up is only allowed when the under-translation signal is both broad and well-controlled.
  catchUpRpeCeiling: 8,
  catchUpMinSetCount: 4,
  catchUpMedianGapMultiplier: 2,
} as const;
const EFFECTIVE_RPE_MIN = 6;

export type ComputeNextLoadOptions = {
  trainingAge?: TrainingAge;
  isUpperBody?: boolean;
  weekInBlock?: number;
  backOffMultiplier?: number;
  isDeloadWeek?: boolean;
  recentSessions?: ProgressionSet[][];
  equipment?: ProgressionEquipment;
};

export function computeNextLoad(
  lastSets: ProgressionSet[],
  repRange: [number, number],
  targetRpe: number,
  maxLoadIncreasePct = 0.07,
  options?: ComputeNextLoadOptions
): number | undefined {
  const lastLoad = lastSets.find((set) => set.load !== undefined)?.load;
  if (lastLoad === undefined) return undefined;

  const trainingAge = options?.trainingAge ?? "intermediate";
  const isUpperBody = options?.isUpperBody ?? true;
  const recentSessions = options?.recentSessions ?? [];
  const sessionHistory = [lastSets, ...recentSessions];

  const clampPct = (pct: number) => {
    const abs = Math.min(Math.abs(pct), maxLoadIncreasePct);
    return pct < 0 ? -abs : abs;
  };

  const applyChange = (pct: number) => roundLoad(lastLoad * (1 + clampPct(pct)));

  if (trainingAge === "beginner") {
    const shouldSwitchToDouble = hasBeginnerStall(sessionHistory);
    if (shouldSwitchToDouble) {
      return computeDoubleProgressionLoad(lastLoad, lastSets, repRange, targetRpe, applyChange);
    }
    const increment = resolveLinearIncrement(lastLoad, isUpperBody);
    return roundLoad(lastLoad + increment);
  }

  if (trainingAge === "advanced") {
    if (options?.isDeloadWeek) {
      const deloadMultiplier = options.backOffMultiplier ?? 0.75;
      return roundLoad(lastLoad * deloadMultiplier);
    }
    return computePeriodizedLoad(lastLoad, options?.weekInBlock, applyChange);
  }

  const shouldDeloadFromRegression = hasConsecutiveRepRegression(sessionHistory);
  if (shouldDeloadFromRegression) {
    return applyChange(-0.06);
  }

  const decision = computeDoubleProgressionDecision(lastSets, repRange, options?.equipment);
  if (decision) {
    return decision.nextLoad;
  }
  return computeDoubleProgressionLoad(lastLoad, lastSets, repRange, targetRpe, applyChange);
}

function resolveLinearIncrement(lastLoad: number, isUpperBody: boolean): number {
  if (isUpperBody) {
    return lastLoad >= 185 ? 5 : 2.5;
  }
  return lastLoad >= 275 ? 10 : 5;
}

function hasBeginnerStall(sessionHistory: ProgressionSet[][]): boolean {
  if (sessionHistory.length < 3) {
    return false;
  }
  const recentLoads = sessionHistory.slice(0, 3).map(sessionLoad);
  if (recentLoads.some((load) => load === undefined)) {
    return false;
  }
  const allSameLoad =
    recentLoads[0] === recentLoads[1] &&
    recentLoads[1] === recentLoads[2];
  if (!allSameLoad) {
    return false;
  }
  const totals = sessionHistory.slice(0, 3).map(totalReps);
  return totals[0] <= totals[1] && totals[1] <= totals[2];
}

function hasConsecutiveRepRegression(sessionHistory: ProgressionSet[][]): boolean {
  if (sessionHistory.length < 3) {
    return false;
  }
  const totals = sessionHistory.slice(0, 3).map(totalReps);
  return totals[0] < totals[1] && totals[1] < totals[2];
}

function computeDoubleProgressionLoad(
  lastLoad: number,
  lastSets: ProgressionSet[],
  repRange: [number, number],
  targetRpe: number,
  applyChange: (pct: number) => number
) {
  const allAtTop = lastSets.every((set) => set.reps >= repRange[1]);
  const rpeOk = lastSets.every((set) => set.rpe === undefined || set.rpe <= targetRpe);

  if (allAtTop && rpeOk) {
    return applyChange(0.025);
  }

  return roundLoad(lastLoad);
}

export function computeDoubleProgressionDecision(
  lastSets: ProgressionSet[],
  repRange: [number, number],
  equipment: ProgressionEquipment = "other",
  options?: DoubleProgressionDecisionOptions
): ProgressionDecision | undefined {
  const signalSets = lastSets.filter(
    (set) =>
      Number.isFinite(set.load) &&
      (set.load ?? 0) >= 0 &&
      Number.isFinite(set.reps) &&
      set.reps > 0 &&
      (set.rpe == null || set.rpe >= EFFECTIVE_RPE_MIN)
  );
  if (signalSets.length === 0) {
    return undefined;
  }

  const loadValues = signalSets.map((set) => set.load as number);
  const medianLoad = median(loadValues);
  if (!Number.isFinite(medianLoad)) {
    return undefined;
  }

  const maxLoad = Math.max(...loadValues);
  const minLoad = Math.min(...loadValues);
  const hasHighVariance =
    loadValues.length >= 4 &&
    medianLoad > 0 &&
    (maxLoad - minLoad) / medianLoad >= PROGRESSION_CONFIG.highVarianceThreshold;
  const trimmedSets = hasHighVariance
    ? signalSets.filter(
        (set) =>
          Math.abs((set.load as number) - medianLoad) / medianLoad <=
          PROGRESSION_CONFIG.outlierTrimRange
      )
    : signalSets;
  const effectiveSets = trimmedSets.length > 0 ? trimmedSets : signalSets;

  const anchorLoad =
    options?.workingSetLoad !== undefined
      ? options.workingSetLoad
      : resolveConservativeModalLoad(effectiveSets);
  if (anchorLoad == null) {
    return undefined;
  }

  const modalRpe = getModalRpe(effectiveSets);
  const medianReps = median(effectiveSets.map((set) => set.reps));
  const topOfRange = repRange[1];
  const increment = resolveIncrementByEquipment(equipment);
  const decisionLog: string[] = [];
  const sampleConfidenceScale = resolveSampleSizeConfidenceScale(options?.priorSessionCount);
  const historyConfidenceScale = clampConfidenceScale(options?.historyConfidenceScale);
  const progressionConfidenceScale = Number((sampleConfidenceScale * historyConfidenceScale).toFixed(2));
  const anchorSource =
    options?.workingSetLoad !== undefined ? "working_set" : "conservative_modal";

  if (hasHighVariance) {
    decisionLog.push(
      `High intra-session load variance detected (${minLoad}-${maxLoad}). Trimmed outlier sets before anchoring.`
    );
  }
  decisionLog.push(
    `Anchor load=${anchorLoad}, modal RPE=${modalRpe == null ? "n/a" : modalRpe}, median reps=${medianReps.toFixed(1)}, rep-range top=${topOfRange}.`
  );
  decisionLog.push(
    `Progression confidence scale=${progressionConfidenceScale.toFixed(2)} (sample=${sampleConfidenceScale.toFixed(2)}, history=${historyConfidenceScale.toFixed(2)}).`
  );
  if (options?.confidenceReasons && options.confidenceReasons.length > 0) {
    decisionLog.push(`Confidence notes: ${options.confidenceReasons.join(" | ")}`);
  }

  if (anchorLoad === 0) {
    const reasonCode =
      medianReps >= topOfRange
        ? "bodyweight_top_of_range_hold"
        : "bodyweight_hold_for_reps";
    decisionLog.push("bodyweight exercise — rep progression only");
    if (medianReps >= topOfRange) {
      decisionLog.push(
        "Top of rep range achieved at bodyweight load. Hold load at 0 and progress via reps until external load is added."
      );
    } else {
      decisionLog.push(
        "Below top of rep range for bodyweight load. Hold load at 0 and target more reps."
      );
    }
    return {
      nextLoad: 0,
      anchorLoad: 0,
      path: "fallback_hold",
      decisionLog,
      trace: buildProgressionDecisionTrace({
        anchorLoad: 0,
        nextLoad: 0,
        path: "fallback_hold",
        decisionLog,
        anchorSource,
        signalSetCount: signalSets.length,
        effectiveSetCount: effectiveSets.length,
        trimmedSetCount: signalSets.length - effectiveSets.length,
        hasHighVariance,
        minLoad,
        maxLoad,
        medianLoad,
        priorSessionCount: options?.priorSessionCount ?? 0,
        sampleConfidenceScale,
        historyConfidenceScale,
        progressionConfidenceScale,
        confidenceReasons: options?.confidenceReasons ?? [],
        repRange,
        equipment,
        medianReps,
        modalRpe: modalRpe ?? null,
        reasonCodes: ["bodyweight_rep_progression_only", reasonCode],
      }),
    };
  }

  const intentDeviationClamp = resolveIntentDeviationClamp({
    anchorLoad,
    targetLoadCeiling: options?.intentDeviation?.targetLoadCeiling,
    flagged: options?.intentDeviation?.flagged,
  });
  if (intentDeviationClamp) {
    decisionLog.push(
      `Intent drift detected: repeated high-load/low-rep history biases next exposure no higher than prescribed target ${intentDeviationClamp.targetLoadCeiling}.`
    );
    return {
      nextLoad: intentDeviationClamp.nextLoad,
      anchorLoad,
      path: "fallback_hold",
      decisionLog,
      trace: buildProgressionDecisionTrace({
        anchorLoad,
        nextLoad: intentDeviationClamp.nextLoad,
        path: "fallback_hold",
        decisionLog,
        anchorSource,
        signalSetCount: signalSets.length,
        effectiveSetCount: effectiveSets.length,
        trimmedSetCount: signalSets.length - effectiveSets.length,
        hasHighVariance,
        minLoad,
        maxLoad,
        medianLoad,
        priorSessionCount: options?.priorSessionCount ?? 0,
        sampleConfidenceScale,
        historyConfidenceScale,
        progressionConfidenceScale,
        confidenceReasons: options?.confidenceReasons ?? [],
        repRange,
        equipment,
        medianReps,
        modalRpe: modalRpe ?? null,
        reasonCodes: ["intent_drift_detected", "rep_range_restoration_bias"],
      }),
    };
  }

  if (modalRpe != null && modalRpe >= 9) {
    decisionLog.push("Path 1 fired: prior modal RPE >= 9. Hold load.");
    return {
      nextLoad: roundLoad(anchorLoad),
      anchorLoad,
      path: "path_1",
      decisionLog,
      trace: buildProgressionDecisionTrace({
        anchorLoad,
        nextLoad: roundLoad(anchorLoad),
        path: "path_1",
        decisionLog,
        anchorSource,
        signalSetCount: signalSets.length,
        effectiveSetCount: effectiveSets.length,
        trimmedSetCount: signalSets.length - effectiveSets.length,
        hasHighVariance,
        minLoad,
        maxLoad,
        medianLoad,
        priorSessionCount: options?.priorSessionCount ?? 0,
        sampleConfidenceScale,
        historyConfidenceScale,
        progressionConfidenceScale,
        confidenceReasons: options?.confidenceReasons ?? [],
        repRange,
        equipment,
        medianReps,
        modalRpe,
        reasonCodes: ["high_fatigue_hold"],
      }),
    };
  }

  if (medianReps >= topOfRange) {
    if (modalRpe != null && modalRpe <= 7) {
      const nextLoad = roundLoad(anchorLoad + increment * progressionConfidenceScale);
      decisionLog.push(
        `Path 2 fired: modal RPE <= 7 and median reps reached top of range. Increment +${(increment * progressionConfidenceScale).toFixed(1)}.`
      );
      return {
        nextLoad,
        anchorLoad,
        path: "path_2",
        decisionLog,
        trace: buildProgressionDecisionTrace({
          anchorLoad,
          nextLoad,
          path: "path_2",
          decisionLog,
          anchorSource,
          signalSetCount: signalSets.length,
          effectiveSetCount: effectiveSets.length,
          trimmedSetCount: signalSets.length - effectiveSets.length,
          hasHighVariance,
          minLoad,
          maxLoad,
          medianLoad,
          priorSessionCount: options?.priorSessionCount ?? 0,
          sampleConfidenceScale,
          historyConfidenceScale,
          progressionConfidenceScale,
          confidenceReasons: options?.confidenceReasons ?? [],
          repRange,
          equipment,
          medianReps,
          modalRpe,
          reasonCodes: ["top_of_range_reached", "low_effort_progression"],
        }),
      };
    }
    if (modalRpe == null || (modalRpe > 7 && modalRpe <= 8)) {
      const nextLoad = roundLoad(anchorLoad + increment * progressionConfidenceScale);
      decisionLog.push(
        `Path 3 fired: modal RPE in 7-8 range and median reps reached top of range. Increment +${(increment * progressionConfidenceScale).toFixed(1)}.`
      );
      return {
        nextLoad,
        anchorLoad,
        path: "path_3",
        decisionLog,
        trace: buildProgressionDecisionTrace({
          anchorLoad,
          nextLoad,
          path: "path_3",
          decisionLog,
          anchorSource,
          signalSetCount: signalSets.length,
          effectiveSetCount: effectiveSets.length,
          trimmedSetCount: signalSets.length - effectiveSets.length,
          hasHighVariance,
          minLoad,
          maxLoad,
          medianLoad,
          priorSessionCount: options?.priorSessionCount ?? 0,
          sampleConfidenceScale,
          historyConfidenceScale,
          progressionConfidenceScale,
          confidenceReasons: options?.confidenceReasons ?? [],
          repRange,
          equipment,
          medianReps,
          modalRpe: modalRpe ?? null,
          reasonCodes: ["top_of_range_reached", "moderate_effort_progression"],
        }),
      };
    }
  }

  const overshootEvidence = resolvePrescribedLoadOvershoot({
    sets: effectiveSets,
    increment,
  });
  const overshootEvaluation = evaluatePrescribedLoadOvershoot({
    overshootEvidence,
    modalRpe,
    hasHighVariance,
  });
  if (
    overshootEvaluation?.qualified === true &&
    medianReps >= repRange[0]
  ) {
    const overshootEvidenceDetail = overshootEvidence;
    if (!overshootEvidenceDetail) {
      throw new Error("Overshoot evaluation qualified without evidence.");
    }
    const catchUpEvaluation = evaluateCatchUpProgression({
      overshootEvidence: overshootEvidenceDetail,
      modalRpe,
      hasHighVariance,
      increment,
      priorSessionCount: options?.priorSessionCount ?? 0,
    });
    const scaledIncrement = increment * progressionConfidenceScale;
    const nextLoad = catchUpEvaluation
      ? roundLoad(anchorLoad + scaledIncrement + increment)
      : roundLoad(anchorLoad + scaledIncrement);
    decisionLog.push(
      overshootEvaluation.tier === "controlled_hard"
        ? `Path 5 fired: performed load beat prescription on ${overshootEvidenceDetail.qualifyingSetCount}/${overshootEvidenceDetail.targetBearingSetCount} signal sets by at least ${increment} lbs, and the broader coverage justified progression even at RPE ${modalRpe ?? "n/a"}. Increment +${(nextLoad - anchorLoad).toFixed(1)}.`
        : `Path 5 fired: performed load beat prescription on ${overshootEvidenceDetail.qualifyingSetCount}/${overshootEvidenceDetail.targetBearingSetCount} signal sets by at least ${increment} lbs while effort stayed manageable. Increment +${(nextLoad - anchorLoad).toFixed(1)}.`
    );
    if (catchUpEvaluation) {
      decisionLog.push(catchUpEvaluation.message);
    }
    return {
      nextLoad,
      anchorLoad,
      path: "path_5_overshoot",
      decisionLog,
      trace: buildProgressionDecisionTrace({
        anchorLoad,
        nextLoad,
        path: "path_5_overshoot",
        decisionLog,
        anchorSource,
        signalSetCount: signalSets.length,
        effectiveSetCount: effectiveSets.length,
        trimmedSetCount: signalSets.length - effectiveSets.length,
        hasHighVariance,
        minLoad,
        maxLoad,
        medianLoad,
        priorSessionCount: options?.priorSessionCount ?? 0,
        sampleConfidenceScale,
        historyConfidenceScale,
        progressionConfidenceScale,
        confidenceReasons: options?.confidenceReasons ?? [],
        repRange,
        equipment,
        medianReps,
        modalRpe: modalRpe ?? null,
        reasonCodes: [
          "performed_above_prescription",
          overshootEvaluation.tier === "controlled_hard"
            ? "controlled_hard_overshoot_progression"
            : "manageable_effort_progression",
          ...(catchUpEvaluation ? ["same_exercise_catch_up_progression"] : []),
        ],
      }),
    };
  }

  if (modalRpe != null && modalRpe >= 7 && modalRpe <= 8 && medianReps < topOfRange) {
    decisionLog.push("Path 4 fired: modal RPE in 7-8 range but reps below top. Hold load and target rep progression.");
    if (overshootEvaluation?.qualified === false) {
      decisionLog.push(overshootEvaluation.message);
    }
    return {
      nextLoad: roundLoad(anchorLoad),
      anchorLoad,
      path: "path_4",
      decisionLog,
      trace: buildProgressionDecisionTrace({
        anchorLoad,
        nextLoad: roundLoad(anchorLoad),
        path: "path_4",
        decisionLog,
        anchorSource,
        signalSetCount: signalSets.length,
        effectiveSetCount: effectiveSets.length,
        trimmedSetCount: signalSets.length - effectiveSets.length,
        hasHighVariance,
        minLoad,
        maxLoad,
        medianLoad,
        priorSessionCount: options?.priorSessionCount ?? 0,
        sampleConfidenceScale,
        historyConfidenceScale,
        progressionConfidenceScale,
        confidenceReasons: options?.confidenceReasons ?? [],
        repRange,
        equipment,
        medianReps,
        modalRpe,
        reasonCodes: [
          "below_top_of_range_hold",
          "rep_progression_targeted",
          ...(overshootEvaluation?.qualified === false ? [overshootEvaluation.reasonCode] : []),
        ],
      }),
    };
  }

  decisionLog.push("Fallback hold: progression conditions not met.");
  if (overshootEvaluation?.qualified === false) {
    decisionLog.push(overshootEvaluation.message);
  }
  return {
    nextLoad: roundLoad(anchorLoad),
    anchorLoad,
    path: "fallback_hold",
    decisionLog,
    trace: buildProgressionDecisionTrace({
      anchorLoad,
      nextLoad: roundLoad(anchorLoad),
      path: "fallback_hold",
      decisionLog,
      anchorSource,
      signalSetCount: signalSets.length,
      effectiveSetCount: effectiveSets.length,
      trimmedSetCount: signalSets.length - effectiveSets.length,
      hasHighVariance,
      minLoad,
      maxLoad,
      medianLoad,
      priorSessionCount: options?.priorSessionCount ?? 0,
      sampleConfidenceScale,
      historyConfidenceScale,
      progressionConfidenceScale,
      confidenceReasons: options?.confidenceReasons ?? [],
      repRange,
      equipment,
      medianReps,
      modalRpe: modalRpe ?? null,
      reasonCodes: [
        "progression_conditions_not_met",
        ...(overshootEvaluation?.qualified === false ? [overshootEvaluation.reasonCode] : []),
      ],
    }),
  };
}

function resolveIntentDeviationClamp(input: {
  anchorLoad: number;
  flagged?: boolean;
  targetLoadCeiling?: number;
}): { nextLoad: number; targetLoadCeiling: number } | null {
  if (input.flagged !== true) {
    return null;
  }
  if (!Number.isFinite(input.targetLoadCeiling) || (input.targetLoadCeiling ?? 0) < 0) {
    return null;
  }

  const targetLoadCeiling = input.targetLoadCeiling as number;
  return {
    nextLoad: Math.min(roundLoad(input.anchorLoad), targetLoadCeiling),
    targetLoadCeiling,
  };
}

function buildProgressionDecisionTrace(input: {
  anchorLoad: number;
  nextLoad: number;
  path: ProgressionDecisionPath;
  decisionLog: string[];
  anchorSource: "working_set" | "conservative_modal";
  signalSetCount: number;
  effectiveSetCount: number;
  trimmedSetCount: number;
  hasHighVariance: boolean;
  minLoad: number;
  maxLoad: number;
  medianLoad: number;
  priorSessionCount: number;
  sampleConfidenceScale: number;
  historyConfidenceScale: number;
  progressionConfidenceScale: number;
  confidenceReasons: string[];
  repRange: [number, number];
  equipment: ProgressionEquipment;
  medianReps: number;
  modalRpe: number | null;
  reasonCodes: string[];
}): ProgressionDecisionTrace {
  return {
    version: 1,
    decisionSource: "double_progression",
    repRange: {
      min: input.repRange[0],
      max: input.repRange[1],
    },
    equipment: input.equipment,
    anchor: {
      source: input.anchorSource,
      workingSetApplied: input.anchorSource === "working_set",
      anchorLoad: input.anchorLoad,
      signalSetCount: input.signalSetCount,
      effectiveSetCount: input.effectiveSetCount,
      trimmedSetCount: input.trimmedSetCount,
      highVarianceDetected: input.hasHighVariance,
      minSignalLoad: input.minLoad,
      maxSignalLoad: input.maxLoad,
      medianSignalLoad: input.medianLoad,
    },
    confidence: {
      priorSessionCount: input.priorSessionCount,
      sampleScale: input.sampleConfidenceScale,
      historyScale: input.historyConfidenceScale,
      combinedScale: input.progressionConfidenceScale,
      reasons: input.confidenceReasons,
    },
    metrics: {
      medianReps: Number(input.medianReps.toFixed(1)),
      modalRpe: input.modalRpe,
      nextLoad: input.nextLoad,
      loadDelta: Number((input.nextLoad - input.anchorLoad).toFixed(2)),
    },
    outcome: {
      path: input.path,
      action:
        input.nextLoad > input.anchorLoad
          ? "increase"
          : input.nextLoad < input.anchorLoad
            ? "decrease"
            : "hold",
      reasonCodes: [
        ...input.reasonCodes,
        ...(input.anchorSource === "working_set" ? ["working_set_anchor_applied"] : []),
        ...(input.hasHighVariance ? ["high_variance_trim_applied"] : []),
      ],
    },
    decisionLog: [...input.decisionLog],
  };
}

function computePeriodizedLoad(
  lastLoad: number,
  weekInBlock: number | undefined,
  applyChange: (pct: number) => number
) {
  const weekIndex = ((weekInBlock ?? 0) % 4 + 4) % 4;
  const weeklyPct: Record<number, number> = {
    0: -0.02,
    1: 0.0,
    2: 0.02,
    3: 0.03,
  };
  return applyChange(weeklyPct[weekIndex] ?? 0);
}

function totalReps(sets: ProgressionSet[]): number {
  return sets.reduce((sum, set) => sum + set.reps, 0);
}

function sessionLoad(sets: ProgressionSet[]): number | undefined {
  return sets.find((set) => set.load !== undefined)?.load;
}

export function shouldDeload(
  history: WorkoutHistoryEntry[],
  mainLiftExerciseIds?: Set<string>
): boolean {
  if (history.length < 2) return false;

  // Check for consecutive low readiness
  const recentForReadiness = history.slice(-DELOAD_THRESHOLDS.consecutiveLowReadiness);
  const lowReadinessStreak =
    recentForReadiness.length >= DELOAD_THRESHOLDS.consecutiveLowReadiness &&
    recentForReadiness.every(
      (entry) => (entry.readinessScore ?? 3) <= DELOAD_THRESHOLDS.lowReadinessScore
    );

  if (lowReadinessStreak) return true;

  // Check for plateau (no progress across N sessions)
  const recent = history.slice(-PLATEAU_CRITERIA.noProgressSessions);
  if (recent.length < PLATEAU_CRITERIA.noProgressSessions) return false;

  const allPerformed = recent.every(isPerformedHistoryEntry);
  if (!allPerformed) return false;
  if (!mainLiftExerciseIds?.size) {
    return false;
  }

  return hasMainLiftPlateau(recent, mainLiftExerciseIds);
}

function hasMainLiftPlateau(
  history: WorkoutHistoryEntry[],
  mainLiftExerciseIds: Set<string>
): boolean {
  const sortedByDate = [...history].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );
  const e1rmByExercise = new Map<string, number[]>();

  for (const entry of sortedByDate) {
    for (const exercise of entry.exercises) {
      if (!mainLiftExerciseIds.has(exercise.exerciseId)) {
        continue;
      }
      const topSet = resolveTopSet(exercise.sets);
      if (!topSet) {
        continue;
      }
      const e1rm = topSet.load * (1 + topSet.reps / 30);
      if (!e1rmByExercise.has(exercise.exerciseId)) {
        e1rmByExercise.set(exercise.exerciseId, []);
      }
      e1rmByExercise.get(exercise.exerciseId)?.push(e1rm);
    }
  }

  const tracked = Array.from(e1rmByExercise.entries()).filter(
    ([, values]) => values.length >= PROGRESSION_CONFIG.minSessionsForPlateauEvidence
  );
  if (tracked.length === 0) return false;

  return tracked.every(([, values]) => {
    const oldest = values[0];
    const max = Math.max(...values);
    return max <= oldest * (1 + PROGRESSION_CONFIG.plateauImprovementEpsilon);
  });
}

function resolveTopSet(sets: HistorySet[]) {
  let topSet: { reps: number; load: number; setIndex: number } | null = null;
  for (const set of sets) {
    if (!Number.isFinite(set.load) || !Number.isFinite(set.reps) || set.reps <= 0) {
      continue;
    }
    if (!topSet || set.setIndex < topSet.setIndex) {
      topSet = { reps: set.reps, load: set.load as number, setIndex: set.setIndex };
    }
  }
  return topSet;
}

function resolveIncrementByEquipment(equipment: ProgressionEquipment): number {
  if (equipment === "barbell") return 5;
  if (equipment === "dumbbell") return 2.5;
  if (equipment === "cable") return 2.5;
  return 2.5;
}

function resolvePrescribedLoadOvershoot(input: {
  sets: ProgressionSet[];
  increment: number;
}):
  | {
      qualifyingSetCount: number;
      targetBearingSetCount: number;
      standardRequiredSetCount: number;
      controlledRequiredSetCount: number;
      medianOvershootGap: number;
    }
  | null {
  const targetBearingSets = input.sets.filter(
    (set) =>
      Number.isFinite(set.load) &&
      (set.load ?? 0) >= 0 &&
      Number.isFinite(set.targetLoad) &&
      (set.targetLoad ?? 0) >= 0
  );
  if (targetBearingSets.length === 0) {
    return null;
  }

  const qualifyingOvershootGaps = targetBearingSets
    .map((set) => (set.load as number) - (set.targetLoad as number))
    .filter((gap) => gap >= input.increment);
  const qualifyingSetCount = qualifyingOvershootGaps.length;
  if (qualifyingSetCount === 0) {
    return null;
  }
  const requiredSetCount = Math.max(
    PROGRESSION_CONFIG.minOvershootSetCount,
    Math.ceil(targetBearingSets.length / 2)
  );
  const controlledRequiredSetCount = Math.min(
    targetBearingSets.length,
    Math.max(
      PROGRESSION_CONFIG.overshootControlledMinSetCount,
      Math.ceil(targetBearingSets.length * PROGRESSION_CONFIG.overshootControlledCoverageRatio)
    )
  );

  return {
    qualifyingSetCount,
    targetBearingSetCount: targetBearingSets.length,
    standardRequiredSetCount: requiredSetCount,
    controlledRequiredSetCount,
    medianOvershootGap: median(qualifyingOvershootGaps),
  };
}

function evaluatePrescribedLoadOvershoot(input: {
  overshootEvidence:
    | {
        qualifyingSetCount: number;
        targetBearingSetCount: number;
        standardRequiredSetCount: number;
        controlledRequiredSetCount: number;
        medianOvershootGap: number;
      }
    | null;
  modalRpe?: number;
  hasHighVariance: boolean;
}):
  | {
      qualified: true;
      tier: "standard" | "controlled_hard";
    }
  | {
      qualified: false;
      reasonCode:
        | "overshoot_blocked_by_effort"
        | "overshoot_blocked_by_variance"
        | "overshoot_blocked_by_coverage";
      message: string;
    }
  | null {
  const evidence = input.overshootEvidence;
  if (!evidence) {
    return null;
  }

  if (
    (input.modalRpe == null || input.modalRpe <= PROGRESSION_CONFIG.overshootStandardRpeCeiling) &&
    evidence.qualifyingSetCount >= evidence.standardRequiredSetCount
  ) {
    return { qualified: true, tier: "standard" };
  }

  if (
    input.modalRpe != null &&
    input.modalRpe <= PROGRESSION_CONFIG.overshootControlledRpeCeiling &&
    !input.hasHighVariance &&
    evidence.qualifyingSetCount >= evidence.controlledRequiredSetCount
  ) {
    return { qualified: true, tier: "controlled_hard" };
  }

  if (
    input.modalRpe != null &&
    input.modalRpe > PROGRESSION_CONFIG.overshootControlledRpeCeiling
  ) {
    return {
      qualified: false,
      reasonCode: "overshoot_blocked_by_effort",
      message: `Overshoot gate: you beat the written load, but modal RPE ${input.modalRpe} was too high to earn an increase.`,
    };
  }

  if (
    input.modalRpe != null &&
    input.modalRpe > PROGRESSION_CONFIG.overshootStandardRpeCeiling &&
    input.hasHighVariance
  ) {
    return {
      qualified: false,
      reasonCode: "overshoot_blocked_by_variance",
      message:
        "Overshoot gate: 8.5-RPE overshoot only progresses when load execution stays stable, and this session required variance trimming.",
    };
  }

  const requiredSetCount =
    input.modalRpe != null &&
    input.modalRpe > PROGRESSION_CONFIG.overshootStandardRpeCeiling
      ? evidence.controlledRequiredSetCount
      : evidence.standardRequiredSetCount;
  return {
    qualified: false,
    reasonCode: "overshoot_blocked_by_coverage",
    message: `Overshoot gate: ${evidence.qualifyingSetCount}/${evidence.targetBearingSetCount} target-bearing sets beat prescription, but ${requiredSetCount} were required at this effort level.`,
  };
}

function evaluateCatchUpProgression(input: {
  overshootEvidence: {
    qualifyingSetCount: number;
    targetBearingSetCount: number;
    standardRequiredSetCount: number;
    controlledRequiredSetCount: number;
    medianOvershootGap: number;
  };
  modalRpe?: number;
  hasHighVariance: boolean;
  increment: number;
  priorSessionCount: number;
}):
  | {
      message: string;
    }
  | null {
  if (input.priorSessionCount < 1) {
    return null;
  }
  if (input.modalRpe == null || input.modalRpe > PROGRESSION_CONFIG.catchUpRpeCeiling) {
    return null;
  }
  if (input.hasHighVariance) {
    return null;
  }
  if (input.overshootEvidence.targetBearingSetCount < PROGRESSION_CONFIG.catchUpMinSetCount) {
    return null;
  }
  if (input.overshootEvidence.qualifyingSetCount < input.overshootEvidence.controlledRequiredSetCount) {
    return null;
  }
  if (
    input.overshootEvidence.medianOvershootGap <
    input.increment * PROGRESSION_CONFIG.catchUpMedianGapMultiplier
  ) {
    return null;
  }

  return {
    message:
      `Catch-up lane fired: exact same-exercise overshoot stayed stable at valid RPE, and the median gap above prescription ` +
      `(${input.overshootEvidence.medianOvershootGap.toFixed(1)} lbs) justified one extra bounded increment.`,
  };
}

function resolveConservativeModalLoad(sets: ProgressionSet[]): number | undefined {
  const frequency = new Map<number, number>();
  for (const set of sets) {
    if (!Number.isFinite(set.load) || (set.load ?? 0) < 0) {
      continue;
    }
    const load = set.load as number;
    frequency.set(load, (frequency.get(load) ?? 0) + 1);
  }
  if (frequency.size === 0) {
    return undefined;
  }
  const center = median(Array.from(frequency.keys()));
  return Array.from(frequency.entries()).sort((a, b) => {
    if (b[1] !== a[1]) {
      return b[1] - a[1];
    }
    const distA = Math.abs(a[0] - center);
    const distB = Math.abs(b[0] - center);
    if (distA !== distB) {
      return distA - distB;
    }
    return a[0] - b[0];
  })[0]?.[0];
}

function getModalRpe(sets: ProgressionSet[]): number | undefined {
  const frequency = new Map<number, number>();
  for (const set of sets) {
    if (!Number.isFinite(set.rpe)) continue;
    const rounded = Number((set.rpe as number).toFixed(1));
    frequency.set(rounded, (frequency.get(rounded) ?? 0) + 1);
  }
  if (frequency.size === 0) {
    return undefined;
  }
  return Array.from(frequency.entries()).sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return a[0] - b[0];
  })[0][0];
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

function resolveSampleSizeConfidenceScale(priorSessionCount?: number): number {
  if (!Number.isFinite(priorSessionCount) || (priorSessionCount ?? 0) <= 0) {
    return 1;
  }
  if ((priorSessionCount as number) >= PROGRESSION_CONFIG.minSessionsForFullConfidence) {
    return 1;
  }
  if ((priorSessionCount as number) <= 1) {
    return PROGRESSION_CONFIG.singleSessionConfidenceScale;
  }
  if ((priorSessionCount as number) === PROGRESSION_CONFIG.minSessionsForFullConfidence - 1) {
    return 0.9;
  }
  return 1;
}

function clampConfidenceScale(value?: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.min(1, Math.max(0, value as number));
}
