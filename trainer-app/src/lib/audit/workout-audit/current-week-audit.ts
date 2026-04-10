import type {
  CurrentWeekAuditEvaluation,
  CurrentWeekAuditInterventionHint,
  CurrentWeekAuditSessionRisk,
  ProjectedWeekVolumeAuditPayload,
} from "./types";

const UNDER_TARGET_CLUSTER_DEFICIT = 3;
const INTERVENTION_MAX_SETS = 3;
const NEAR_MAV_BUFFER_SETS = 2;
const LONG_SESSION_MINUTES = 80;
const HIGH_FATIGUE_MUSCLES = new Set(["Glutes", "Lower Back"]);
const PUSH_PATTERNS = ["horizontal_push", "vertical_push"];
const PULL_PATTERNS = ["horizontal_pull", "vertical_pull"];
const STACKING_PATTERNS = [
  "horizontal_push",
  "vertical_push",
  "horizontal_pull",
  "vertical_pull",
  "squat",
  "hinge",
  "lunge",
] as const;

function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

function formatSets(value: number): string {
  return `${roundToTenth(value).toFixed(1)} sets`;
}

function getPatternCount(
  counts: Record<string, number> | undefined,
  pattern: string
): number {
  return counts?.[pattern] ?? 0;
}

function sumPatternCounts(
  counts: Record<string, number> | undefined,
  patterns: readonly string[]
): number {
  return patterns.reduce((sum, pattern) => sum + getPatternCount(counts, pattern), 0);
}

function formatPattern(pattern: string): string {
  return pattern.replace(/_/g, " ");
}

function getSessionSlotId(
  session: ProjectedWeekVolumeAuditPayload["projectedSessions"][number],
  index: number
): string {
  return session.slotId ?? `${session.intent}-${index + 1}`;
}

function buildSessionRisks(
  projectedSessions: ProjectedWeekVolumeAuditPayload["projectedSessions"]
): CurrentWeekAuditSessionRisk[] {
  const risks: CurrentWeekAuditSessionRisk[] = [];

  for (const [index, session] of projectedSessions.entries()) {
    const slotId = getSessionSlotId(session, index);
    const movementPatternCounts = session.movementPatternCounts;

    if ((session.estimatedMinutes ?? 0) > LONG_SESSION_MINUTES) {
      risks.push({
        slotId,
        issue: `projected duration ${session.estimatedMinutes} min exceeds ~80 min`,
      });
    }

    for (const pattern of STACKING_PATTERNS) {
      const count = getPatternCount(movementPatternCounts, pattern);
      if (count >= 3) {
        risks.push({
          slotId,
          issue: `redundant pattern stacking: ${formatPattern(pattern)} appears ${count} times`,
        });
      }
    }

    const pullCount = sumPatternCounts(movementPatternCounts, PULL_PATTERNS);
    const pushCount = sumPatternCounts(movementPatternCounts, PUSH_PATTERNS);
    if (
      (session.intent === "upper" || session.intent === "full_body") &&
      pullCount >= 4 &&
      pullCount >= pushCount + 2
    ) {
      risks.push({
        slotId,
        issue: `excessive pull vs push imbalance: pull-pattern exercises ${pullCount} vs push ${pushCount}`,
      });
    }

    const lowerSystemicPatternCount =
      getPatternCount(movementPatternCounts, "squat") +
      getPatternCount(movementPatternCounts, "hinge") +
      getPatternCount(movementPatternCounts, "lunge");
    const gluteLowerBackStimulus =
      (session.projectedContributionByMuscle.Glutes ?? 0) +
      (session.projectedContributionByMuscle["Lower Back"] ?? 0);
    if (lowerSystemicPatternCount >= 3 && gluteLowerBackStimulus >= 6) {
      risks.push({
        slotId,
        issue:
          "high systemic fatigue pattern: squat/hinge/lunge stacking with glutes/lower back stimulus",
      });
    }
  }

  return risks;
}

function buildInterventionHints(
  rows: ProjectedWeekVolumeAuditPayload["fullWeekByMuscle"]
): CurrentWeekAuditInterventionHint[] {
  return rows
    .map((row) => {
      const deficitToTarget = roundToTenth(
        row.weeklyTarget - row.projectedFullWeekEffectiveSets
      );
      const deficitToMev = roundToTenth(row.mev - row.projectedFullWeekEffectiveSets);
      const isBelowMev = deficitToMev > 0;
      const hasMeaningfulTargetDeficit =
        deficitToTarget >= UNDER_TARGET_CLUSTER_DEFICIT;

      if (!isBelowMev && !hasMeaningfulTargetDeficit) {
        return null;
      }
      if (row.deltaToMav >= -NEAR_MAV_BUFFER_SETS) {
        return null;
      }
      if (HIGH_FATIGUE_MUSCLES.has(row.muscle) && row.deltaToTarget >= -1) {
        return null;
      }

      const actionableDeficit = isBelowMev ? deficitToMev : deficitToTarget;
      return {
        muscle: row.muscle,
        suggestedSets: Math.min(
          INTERVENTION_MAX_SETS,
          Math.max(2, Math.ceil(actionableDeficit))
        ),
        reason: isBelowMev
          ? `Projected ${formatSets(deficitToMev)} below MEV`
          : `Projected ${formatSets(deficitToTarget)} below target`,
        sortKey: isBelowMev ? deficitToMev + 100 : deficitToTarget,
      };
    })
    .filter(
      (
        hint
      ): hint is CurrentWeekAuditInterventionHint & {
        sortKey: number;
      } => hint != null
    )
    .sort((left, right) => right.sortKey - left.sortKey || left.muscle.localeCompare(right.muscle))
    .slice(0, 3)
    .map((hint) => ({
      muscle: hint.muscle,
      suggestedSets: hint.suggestedSets,
      reason: hint.reason,
    }));
}

export function buildCurrentWeekAuditEvaluation(
  projectedWeekVolume: ProjectedWeekVolumeAuditPayload
): {
  currentWeekAudit: CurrentWeekAuditEvaluation;
  interventionHints: CurrentWeekAuditInterventionHint[];
  sessionRisks: CurrentWeekAuditSessionRisk[];
} {
  const belowMevRows = projectedWeekVolume.fullWeekByMuscle
    .filter((row) => row.deltaToMev < 0)
    .sort((left, right) => left.deltaToMev - right.deltaToMev || left.muscle.localeCompare(right.muscle));
  const overMavRows = projectedWeekVolume.fullWeekByMuscle
    .filter((row) => row.deltaToMav > 0)
    .sort((left, right) => right.deltaToMav - left.deltaToMav || left.muscle.localeCompare(right.muscle));
  const underTargetClusters = projectedWeekVolume.fullWeekByMuscle
    .map((row) => ({
      muscle: row.muscle,
      deficit: roundToTenth(row.weeklyTarget - row.projectedFullWeekEffectiveSets),
    }))
    .filter((row) => row.deficit >= UNDER_TARGET_CLUSTER_DEFICIT)
    .sort((left, right) => right.deficit - left.deficit || left.muscle.localeCompare(right.muscle));
  const sessionRisks = buildSessionRisks(projectedWeekVolume.projectedSessions);
  const fatigueRisks = [
    ...overMavRows
      .filter((row) => HIGH_FATIGUE_MUSCLES.has(row.muscle))
      .map((row) => `${row.muscle} projects ${formatSets(row.deltaToMav)} over MAV`),
    ...sessionRisks
      .filter((risk) => risk.issue.startsWith("high systemic fatigue pattern"))
      .map((risk) => `${risk.slotId}: ${risk.issue}`),
  ];

  return {
    currentWeekAudit: {
      belowMEV: belowMevRows.map((row) => row.muscle),
      overMAV: overMavRows.map((row) => row.muscle),
      underTargetClusters,
      fatigueRisks,
    },
    interventionHints: buildInterventionHints(projectedWeekVolume.fullWeekByMuscle),
    sessionRisks,
  };
}
