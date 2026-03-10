import type { SessionIntent } from "@/lib/engine/session-types";
import { buildRemainingScheduleAfterPerformed } from "@/lib/api/template-session/remaining-week-planner";
import {
  isAnalyticsCompletedWorkoutStatus,
  isAnalyticsPerformedWorkoutStatus,
} from "@/lib/api/analytics-semantics";
import { isPerformedHistoryEntry } from "@/lib/engine/history";
import type { WorkoutHistoryEntry, WorkoutSelectionMode } from "@/lib/engine/types";
import { PERFORMED_WORKOUT_STATUSES } from "@/lib/workout-status";
import { WORKOUT_AUDIT_CONCLUSIONS } from "./conclusions";
import type { AuditConclusionBlock } from "./types";

export type SequencingScenarioInput = {
  name: string;
  weeklySchedule: SessionIntent[];
  performed: Array<{
    intent: SessionIntent;
    status?: (typeof PERFORMED_WORKOUT_STATUSES)[number];
    advancesSplit?: boolean;
  }>;
};

export type SequencingScenarioResult = {
  name: string;
  weeklySchedule: SessionIntent[];
  performed: Array<{
    intent: SessionIntent;
    status: string;
    advancesSplit: boolean;
    countsTowardWeeklyAccounting: boolean;
    countsTowardSplitAdvancement: boolean;
  }>;
  nextUnresolvedIntent: SessionIntent | null;
  remainingAdvancingSchedule: SessionIntent[];
  weeklyAccountingBasis: "performed_status";
  weekCloseBasis: "weekly_volume_snapshot";
  sequencingBasis: "advancing_performed_only";
};

export type AccountingClassificationInput = {
  status: WorkoutHistoryEntry["status"];
  selectionMode: WorkoutSelectionMode;
  advancesSplit: boolean;
  optionalGapFill: boolean;
};

export type AccountingClassificationResult = {
  classification: AccountingClassificationInput;
  countsTowardWeeklyVolume: boolean;
  countsTowardRecoveryRecentStimulus: boolean;
  countsTowardProgressionHistory: boolean;
  countsTowardWeekCloseClosure: boolean;
  canResolvePendingWeekClose: boolean;
  countsTowardAnalyticsGenerated: boolean;
  countsTowardAnalyticsPerformed: boolean;
  countsTowardAnalyticsCompleted: boolean;
  countsTowardSplitAdvancement: boolean;
  rationale: Record<string, string>;
};

export function analyzeSequencingScenario(
  input: SequencingScenarioInput
): SequencingScenarioResult {
  const normalizedPerformed = input.performed.map((entry) => {
    const status = entry.status ?? "COMPLETED";
    const advancesSplit = entry.advancesSplit !== false;
    const countsTowardWeeklyAccounting =
      status != null &&
      (PERFORMED_WORKOUT_STATUSES as readonly string[]).includes(status);

    return {
      intent: entry.intent,
      status,
      advancesSplit,
      countsTowardWeeklyAccounting,
      countsTowardSplitAdvancement: countsTowardWeeklyAccounting && advancesSplit,
    };
  });

  const advancingPerformedIntents = normalizedPerformed
    .filter((entry) => entry.countsTowardSplitAdvancement)
    .map((entry) => entry.intent);
  const remainingAdvancingSchedule = buildRemainingScheduleAfterPerformed(
    input.weeklySchedule,
    advancingPerformedIntents
  );

  return {
    name: input.name,
    weeklySchedule: input.weeklySchedule,
    performed: normalizedPerformed,
    nextUnresolvedIntent: remainingAdvancingSchedule[0] ?? null,
    remainingAdvancingSchedule,
    weeklyAccountingBasis: "performed_status",
    weekCloseBasis: "weekly_volume_snapshot",
    sequencingBasis: "advancing_performed_only",
  };
}

export function analyzeAccountingClassification(
  input: AccountingClassificationInput
): AccountingClassificationResult {
  const performedLike = isPerformedHistoryEntry({
    date: new Date().toISOString(),
    completed: input.status === "COMPLETED",
    status: input.status,
    exercises: [],
    selectionMode: input.selectionMode,
    advancesSplit: input.advancesSplit,
  });
  const analyticsPerformed = isAnalyticsPerformedWorkoutStatus(input.status);
  const analyticsCompleted = isAnalyticsCompletedWorkoutStatus(input.status);
  const splitAdvancement = analyticsCompleted && input.advancesSplit;

  return {
    classification: input,
    countsTowardWeeklyVolume: performedLike,
    countsTowardRecoveryRecentStimulus: performedLike,
    countsTowardProgressionHistory: performedLike,
    countsTowardWeekCloseClosure: performedLike,
    canResolvePendingWeekClose: input.optionalGapFill && analyticsCompleted,
    countsTowardAnalyticsGenerated: true,
    countsTowardAnalyticsPerformed: analyticsPerformed,
    countsTowardAnalyticsCompleted: analyticsCompleted,
    countsTowardSplitAdvancement: splitAdvancement,
    rationale: {
      weeklyVolume: WORKOUT_AUDIT_CONCLUSIONS.weekly_volume_basis.runtimeRule,
      recovery: WORKOUT_AUDIT_CONCLUSIONS.recovery_basis.runtimeRule,
      progression: WORKOUT_AUDIT_CONCLUSIONS.progression_basis.runtimeRule,
      weekClose: WORKOUT_AUDIT_CONCLUSIONS.week_close_basis.runtimeRule,
      analytics:
        "Analytics always count the persisted workout as generated, then add performed/completed counters from status semantics.",
      splitAdvancement: WORKOUT_AUDIT_CONCLUSIONS.advances_split_basis.runtimeRule,
    },
  };
}

export function buildScenarioConclusions(): AuditConclusionBlock {
  return WORKOUT_AUDIT_CONCLUSIONS;
}
