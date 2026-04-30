import type { ReadinessSignal } from "@/lib/engine/readiness/types";
import type { V2MesocycleStrategyInput } from "@/lib/engine/planning/v2";
import type { MesocycleHandoffSummary } from "./mesocycle-handoff-contract";
import type {
  MesocycleReviewData,
  MesocycleReviewMuscleRow,
} from "./mesocycle-review";

type StrategyTrainingAge =
  V2MesocycleStrategyInput["userProfile"]["trainingAge"];
type HistoricalSourcePlanner =
  V2MesocycleStrategyInput["historicalMesocycles"][number]["sourcePlanner"];
type HistoricalVolumeStatus = NonNullable<
  V2MesocycleStrategyInput["historicalMesocycles"][number]["performedVolumeSummary"]
>[number]["status"];

export type V2MesocycleStrategyProfileEvidence = {
  trainingGoal?: string | null;
  trainingAge?: string | null;
  availableTrainingDays?: number | null;
  equipmentProfile?: string[] | null;
  constraints?: string[] | null;
  preferences?: string[] | null;
  painOrToleranceFlags?: string[] | null;
};

export type V2MesocycleStrategyCurrentContextEvidence = {
  splitType?: string | null;
  currentPhase?: string | null;
  currentMesocycleStatus?: string | null;
  weekCount?: number | null;
  slotSequence?: string[] | null;
  volumeTarget?: string | null;
  intensityBias?: string | null;
};

export type V2MesocycleStrategyHistoricalReviewEvidence = {
  review: MesocycleReviewData;
  sourcePlanner?: HistoricalSourcePlanner;
  startedAt?: string | null;
};

export type V2MesocycleStrategyInputAdapterInput = {
  userProfile?: V2MesocycleStrategyProfileEvidence | null;
  currentTrainingContext?: V2MesocycleStrategyCurrentContextEvidence | null;
  handoffSummary?: MesocycleHandoffSummary | null;
  historicalMesocycleReviews?: V2MesocycleStrategyHistoricalReviewEvidence[];
  readiness?: ReadinessSignal | null;
  evidenceLimitations?: string[];
};

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(values.filter((value): value is string => Boolean(value))),
  ).sort((left, right) => left.localeCompare(right));
}

function uniqueStringsInOrder(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(values.filter((value): value is string => Boolean(value))),
  );
}

function normalizeTrainingAge(value: string | null | undefined): StrategyTrainingAge {
  const normalized = value?.trim().toLowerCase();
  if (
    normalized === "beginner" ||
    normalized === "intermediate" ||
    normalized === "advanced"
  ) {
    return normalized;
  }
  return value ? "unknown" : undefined;
}

function normalizeSplit(
  value: string | null | undefined,
): V2MesocycleStrategyInput["currentTrainingContext"]["split"] | undefined {
  if (value?.toLowerCase() === "upper_lower") {
    return "upper_lower";
  }
  return value ? "unknown" : undefined;
}

function normalizeNumber(value: number | null | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function profileConfidence(
  profile: V2MesocycleStrategyProfileEvidence | null | undefined,
): V2MesocycleStrategyInput["userProfile"]["confidence"] {
  if (!profile) {
    return "low";
  }

  let score = 0;
  if (profile.trainingGoal) score += 1;
  if (normalizeTrainingAge(profile.trainingAge) != null) score += 1;
  if (normalizeNumber(profile.availableTrainingDays) != null) score += 1;
  if ((profile.equipmentProfile?.length ?? 0) > 0) score += 1;
  if ((profile.constraints?.length ?? 0) > 0) score += 1;
  if ((profile.preferences?.length ?? 0) > 0) score += 1;
  if ((profile.painOrToleranceFlags?.length ?? 0) > 0) score += 1;

  if (score >= 5) {
    return "high";
  }
  return score >= 2 ? "medium" : "low";
}

function buildUserProfile(
  profile: V2MesocycleStrategyProfileEvidence | null | undefined,
): V2MesocycleStrategyInput["userProfile"] {
  const trainingAge = normalizeTrainingAge(profile?.trainingAge);
  return {
    ...(profile?.trainingGoal ? { trainingGoal: profile.trainingGoal } : {}),
    ...(trainingAge ? { trainingAge } : {}),
    ...(normalizeNumber(profile?.availableTrainingDays) != null
      ? { availableTrainingDays: normalizeNumber(profile?.availableTrainingDays) }
      : {}),
    ...((profile?.equipmentProfile?.length ?? 0) > 0
      ? { equipmentProfile: uniqueStrings(profile?.equipmentProfile ?? []) }
      : {}),
    ...((profile?.constraints?.length ?? 0) > 0
      ? { constraints: uniqueStrings(profile?.constraints ?? []) }
      : {}),
    ...((profile?.preferences?.length ?? 0) > 0
      ? { preferences: uniqueStrings(profile?.preferences ?? []) }
      : {}),
    ...((profile?.painOrToleranceFlags?.length ?? 0) > 0
      ? {
          painOrToleranceFlags: uniqueStrings(
            profile?.painOrToleranceFlags ?? [],
          ),
        }
      : {}),
    confidence: profileConfidence(profile),
  };
}

function contextFromHandoff(
  handoffSummary: MesocycleHandoffSummary | null | undefined,
): V2MesocycleStrategyCurrentContextEvidence {
  const design = handoffSummary?.recommendedDesign;
  return {
    splitType:
      design?.structure?.splitType ??
      handoffSummary?.recommendedNextSeed?.structure?.splitType ??
      handoffSummary?.training?.splitType,
    currentMesocycleStatus: handoffSummary?.lifecycle?.terminalState,
    weekCount:
      design?.profile?.durationWeeks ??
      handoffSummary?.lifecycle?.durationWeeks ??
      undefined,
    slotSequence:
      design?.structure?.slots?.map((slot) => slot.slotId) ??
      handoffSummary?.recommendedNextSeed?.structure?.slots?.map(
        (slot) => slot.slotId,
      ),
    volumeTarget: design?.profile?.volumeTarget,
    intensityBias: design?.profile?.intensityBias,
  };
}

function buildCurrentTrainingContext(input: {
  explicit?: V2MesocycleStrategyCurrentContextEvidence | null;
  handoffSummary?: MesocycleHandoffSummary | null;
}): V2MesocycleStrategyInput["currentTrainingContext"] {
  const handoff = contextFromHandoff(input.handoffSummary);
  const explicit = input.explicit ?? {};
  const slotSequence = explicit.slotSequence ?? handoff.slotSequence;
  const split = normalizeSplit(explicit.splitType ?? handoff.splitType);
  const status =
    explicit.currentMesocycleStatus ?? handoff.currentMesocycleStatus;
  const weekCount = normalizeNumber(explicit.weekCount ?? handoff.weekCount);
  const volumeTarget = explicit.volumeTarget ?? handoff.volumeTarget;
  const intensityBias = explicit.intensityBias ?? handoff.intensityBias;
  return {
    ...(split ? { split } : {}),
    ...(explicit.currentPhase ? { currentPhase: explicit.currentPhase } : {}),
    ...(status ? { currentMesocycleStatus: status } : {}),
    ...(weekCount != null ? { weekCount } : {}),
    ...((slotSequence?.length ?? 0) > 0
      ? { slotSequence: uniqueStringsInOrder(slotSequence ?? []) }
      : {}),
    ...(volumeTarget ? { volumeTarget } : {}),
    ...(intensityBias ? { intensityBias } : {}),
  };
}

function mapVolumeStatus(
  row: MesocycleReviewMuscleRow,
): HistoricalVolumeStatus {
  if (row.status === "on_target") {
    return "within";
  }
  if (row.status === "slightly_low" || row.status === "meaningfully_low") {
    return "under";
  }
  if (row.status === "slightly_high" || row.status === "meaningfully_high") {
    return "over";
  }
  return "unknown";
}

function buildHistoricalMesocycle(
  input: V2MesocycleStrategyHistoricalReviewEvidence,
): V2MesocycleStrategyInput["historicalMesocycles"][number] {
  const review = input.review;
  return {
    mesocycleId: review.mesocycleId,
    sourcePlanner: input.sourcePlanner ?? "unknown",
    status: review.archive.currentState,
    ...(input.startedAt ? { startedAt: input.startedAt } : {}),
    ...(review.closedAt ? { completedAt: review.closedAt } : {}),
    adherenceSummary: {
      plannedSessions: review.derived.adherence.plannedSessions,
      completedSessions: review.derived.adherence.coreCompletedSessions,
      partialSessions: review.derived.adherence.partialSessions,
      skippedSessions: review.derived.adherence.skippedSessions,
    },
    performedVolumeSummary: review.derived.muscleVolumeSummary.map((row) => ({
      muscle: row.muscle,
      plannedSets: row.targetSets,
      performedSets: row.actualEffectiveSets,
      targetRange: `target:${row.targetSets}`,
      status: mapVolumeStatus(row),
    })),
    performanceSignals: review.derived.topProgressedExercises.map((row) => ({
      exerciseId: row.exerciseId,
      exerciseName: row.exerciseName,
      signal: "progressed" as const,
      confidence: row.exposureCount >= 2 ? "medium" : "low",
    })),
  };
}

function buildReadinessAndRecoverySignals(input: {
  readiness?: ReadinessSignal | null;
  historicalMesocycles: V2MesocycleStrategyInput["historicalMesocycles"];
}): V2MesocycleStrategyInput["readinessAndRecoverySignals"] {
  const readiness = input.readiness;
  const available = readiness
    ? [
        "subjective_readiness",
        "subjective_motivation",
        "subjective_soreness",
        "performance_rpe_deviation",
        "performance_stalls",
        "performance_compliance",
        ...(readiness.whoop ? ["wearable_recovery"] : []),
      ]
    : [];
  const fatigueFlags = readiness
    ? uniqueStrings([
        readiness.subjective.readiness <= 2 ? "low_subjective_readiness" : null,
        readiness.performance.rpeDeviation > 1 ? "elevated_rpe_deviation" : null,
        readiness.performance.stallCount > 0
          ? `performance_stalls:${readiness.performance.stallCount}`
          : null,
        readiness.performance.volumeComplianceRate < 0.8
          ? "low_recent_volume_compliance"
          : null,
      ])
    : [];
  const soreness = readiness?.subjective.soreness ?? {};
  const painFlags = uniqueStrings(
    Object.entries(soreness).flatMap(([bodyPart, severity]) =>
      severity >= 2 ? [`soreness:${bodyPart}:${severity}`] : [],
    ),
  );
  const adherenceFlags = uniqueStrings(
    input.historicalMesocycles.flatMap((mesocycle) => {
      const adherence = mesocycle.adherenceSummary;
      const planned = adherence?.plannedSessions ?? 0;
      const completed = adherence?.completedSessions ?? 0;
      if (planned <= 0) {
        return [];
      }
      return completed / planned < 0.8
        ? [`historical_adherence_below_80_percent:${mesocycle.mesocycleId}`]
        : [];
    }),
  );

  return {
    available,
    missing: uniqueStrings([
      readiness ? null : "latest_readiness_signal",
      readiness?.whoop ? null : "wearable_recovery_signal",
      "exercise_level_pain_or_tolerance_history",
    ]),
    ...(fatigueFlags.length > 0 ? { fatigueFlags } : {}),
    ...(painFlags.length > 0 ? { painFlags } : {}),
    ...(adherenceFlags.length > 0 ? { adherenceFlags } : {}),
  };
}

function buildEvidenceLimitations(input: {
  profile?: V2MesocycleStrategyProfileEvidence | null;
  currentTrainingContext: V2MesocycleStrategyInput["currentTrainingContext"];
  historicalMesocycles: V2MesocycleStrategyInput["historicalMesocycles"];
  readiness?: ReadinessSignal | null;
  explicitLimitations?: string[];
}): string[] {
  return uniqueStrings([
    ...(input.explicitLimitations ?? []),
    "strategy_input_adapter_is_read_only",
    "strategy_input_does_not_feed_mesocycle_demand",
    "adapter_does_not_use_owner_identity",
    input.profile ? null : "user_profile_evidence_missing",
    input.profile?.trainingGoal ? null : "training_goal_missing",
    input.profile?.trainingAge ? null : "training_age_missing",
    input.profile?.equipmentProfile?.length
      ? null
      : "equipment_profile_missing",
    input.currentTrainingContext.split ? null : "current_split_missing",
    input.currentTrainingContext.slotSequence?.length
      ? null
      : "slot_sequence_missing",
    input.historicalMesocycles.length > 0
      ? "historical_mesocycles_are_validation_data_not_policy_targets"
      : "historical_mesocycle_review_missing",
    input.readiness ? null : "readiness_signal_missing_or_stale",
  ]);
}

export function buildV2MesocycleStrategyInputFromReadModels(
  input: V2MesocycleStrategyInputAdapterInput,
): V2MesocycleStrategyInput {
  const historicalMesocycles = (input.historicalMesocycleReviews ?? []).map(
    buildHistoricalMesocycle,
  );
  const currentTrainingContext = buildCurrentTrainingContext({
    explicit: input.currentTrainingContext,
    handoffSummary: input.handoffSummary,
  });

  return {
    version: 1,
    userProfile: buildUserProfile(input.userProfile),
    currentTrainingContext,
    historicalMesocycles,
    readinessAndRecoverySignals: buildReadinessAndRecoverySignals({
      readiness: input.readiness,
      historicalMesocycles,
    }),
    evidenceLimitations: buildEvidenceLimitations({
      profile: input.userProfile,
      currentTrainingContext,
      historicalMesocycles,
      readiness: input.readiness,
      explicitLimitations: input.evidenceLimitations,
    }),
  };
}
