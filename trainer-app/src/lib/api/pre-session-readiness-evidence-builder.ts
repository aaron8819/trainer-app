import { prisma } from "@/lib/db/prisma";
import { getExposedVolumeLandmarkEntries } from "@/lib/engine/volume-landmarks";
import { getWeeklyVolumeTarget } from "@/lib/api/mesocycle-lifecycle-math";
import { loadProjectedWeekVolumeReport } from "@/lib/api/projected-week-volume";
import { buildRuntimeDoseAdjustmentDiagnostics } from "@/lib/api/runtime-dose-guidance";
import { loadMesocycleWeekMuscleVolume } from "@/lib/api/weekly-volume";
import type {
  PreSessionReadinessCurrentWeekAuditEvidence,
  PreSessionReadinessInterventionHintEvidence,
  PreSessionReadinessProjectedWeekEvidence,
  PreSessionReadinessSessionRiskEvidence,
  PreSessionReadinessWeeklyRetroEvidence,
} from "./pre-session-readiness-evidence";

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

type ProjectedWeekMuscleRow =
  PreSessionReadinessProjectedWeekEvidence["fullWeekByMuscle"][number];
type ProjectedWeekSession =
  PreSessionReadinessProjectedWeekEvidence["projectedSessions"][number];

function isHardWarningRow(row: ProjectedWeekMuscleRow): boolean {
  if (row.warningSeverity) {
    return row.warningSeverity === "hard";
  }
  return row.targetKind !== "soft";
}

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

function getSessionSlotId(session: ProjectedWeekSession, index: number): string {
  return session.slotId ?? `${session.intent}-${index + 1}`;
}

function buildSessionRisks(
  projectedSessions: PreSessionReadinessProjectedWeekEvidence["projectedSessions"]
): PreSessionReadinessSessionRiskEvidence[] {
  const risks: PreSessionReadinessSessionRiskEvidence[] = [];

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
  rows: PreSessionReadinessProjectedWeekEvidence["fullWeekByMuscle"]
): PreSessionReadinessInterventionHintEvidence[] {
  return rows
    .filter(isHardWarningRow)
    .map((row) => {
      const deficitToMev = roundToTenth(row.mev - row.projectedFullWeekEffectiveSets);
      const isBelowMev = deficitToMev > 0;

      if (!isBelowMev) {
        return null;
      }
      if (row.deltaToMav >= -NEAR_MAV_BUFFER_SETS) {
        return null;
      }
      if (HIGH_FATIGUE_MUSCLES.has(row.muscle) && row.deltaToTarget >= -1) {
        return null;
      }

      return {
        muscle: row.muscle,
        suggestedSets: Math.min(
          INTERVENTION_MAX_SETS,
          Math.max(2, Math.ceil(deficitToMev))
        ),
        reason: `below_mev: projected ${formatSets(deficitToMev)} below MEV; bounded floor closure only`,
        sortKey: deficitToMev + 100,
      };
    })
    .filter(
      (
        hint
      ): hint is PreSessionReadinessInterventionHintEvidence & {
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

export function buildPreSessionReadinessCurrentWeekEvidence(
  projectedWeekVolume: Pick<
    PreSessionReadinessProjectedWeekEvidence,
    "fullWeekByMuscle" | "projectedSessions"
  >
): {
  currentWeekAudit: PreSessionReadinessCurrentWeekAuditEvidence;
  interventionHints: PreSessionReadinessInterventionHintEvidence[];
  sessionRisks: PreSessionReadinessSessionRiskEvidence[];
} {
  const belowMevRows = projectedWeekVolume.fullWeekByMuscle
    .filter(isHardWarningRow)
    .filter((row) => row.deltaToMev < 0)
    .sort((left, right) => left.deltaToMev - right.deltaToMev || left.muscle.localeCompare(right.muscle));
  const overMavRows = projectedWeekVolume.fullWeekByMuscle
    .filter(isHardWarningRow)
    .filter((row) => row.deltaToMav > 0)
    .sort((left, right) => right.deltaToMav - left.deltaToMav || left.muscle.localeCompare(right.muscle));
  const underTargetClusters = projectedWeekVolume.fullWeekByMuscle
    .filter(isHardWarningRow)
    .map((row) => ({
      muscle: row.muscle,
      deficit: roundToTenth(row.mev - row.projectedFullWeekEffectiveSets),
    }))
    .filter((row) => row.deficit >= UNDER_TARGET_CLUSTER_DEFICIT)
    .sort((left, right) => right.deficit - left.deficit || left.muscle.localeCompare(right.muscle));
  const belowPreferred = projectedWeekVolume.fullWeekByMuscle
    .filter(isHardWarningRow)
    .map((row) => {
      const deficitToPreferred = roundToTenth(
        row.weeklyTarget - row.projectedFullWeekEffectiveSets
      );
      if (
        row.projectedFullWeekEffectiveSets < row.mev ||
        deficitToPreferred <= 0 ||
        row.projectedFullWeekEffectiveSets >= row.mav - NEAR_MAV_BUFFER_SETS
      ) {
        return null;
      }
      return {
        muscle: row.muscle,
        deficit: deficitToPreferred,
        status:
          row.weeklyTarget >= row.mav - NEAR_MAV_BUFFER_SETS
            ? ("stretch_miss" as const)
            : ("below_preferred" as const),
      };
    })
    .filter(
      (
        row
      ): row is NonNullable<PreSessionReadinessCurrentWeekAuditEvidence["belowPreferred"][number]> =>
        row != null
    )
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
      belowPreferred,
      fatigueRisks,
    },
    interventionHints: buildInterventionHints(projectedWeekVolume.fullWeekByMuscle),
    sessionRisks,
  };
}

export async function buildPreSessionReadinessProjectedWeekEvidence(input: {
  userId: string;
  plannerDiagnosticsMode: "standard" | "debug";
}): Promise<PreSessionReadinessProjectedWeekEvidence> {
  const report = await loadProjectedWeekVolumeReport({
    userId: input.userId,
    plannerDiagnosticsMode: input.plannerDiagnosticsMode,
  });
  const payload: PreSessionReadinessProjectedWeekEvidence = {
    version: 1,
    ...report,
  };

  return {
    ...payload,
    ...buildPreSessionReadinessCurrentWeekEvidence(payload),
    runtimeDoseAdjustmentDiagnostics:
      buildRuntimeDoseAdjustmentDiagnostics(payload),
  };
}

function computeMesoWeekStartDate(
  macroStartDate: Date,
  mesocycleStartWeek: number,
  week: number
): Date {
  const date = new Date(macroStartDate);
  date.setDate(date.getDate() + (mesocycleStartWeek + week - 1) * 7);
  return date;
}

export async function buildPreSessionReadinessWeeklyRetroEvidence(input: {
  userId: string;
  week: number;
  mesocycleId: string;
}): Promise<PreSessionReadinessWeeklyRetroEvidence> {
  const mesocycle = await prisma.mesocycle.findFirst({
    where: {
      id: input.mesocycleId,
      macroCycle: { userId: input.userId },
    },
    select: {
      durationWeeks: true,
      startWeek: true,
      blocks: {
        orderBy: { startWeek: "asc" },
        select: {
          blockType: true,
          startWeek: true,
          durationWeeks: true,
          volumeTarget: true,
          intensityBias: true,
        },
      },
      macroCycle: {
        select: {
          startDate: true,
        },
      },
    },
  });

  if (!mesocycle) {
    throw new Error(`No mesocycle found for pre-session readiness mesocycleId=${input.mesocycleId}.`);
  }

  const weeklyVolume = await loadMesocycleWeekMuscleVolume(prisma, {
    userId: input.userId,
    mesocycleId: input.mesocycleId,
    targetWeek: input.week,
    weekStart: computeMesoWeekStartDate(
      new Date(mesocycle.macroCycle.startDate),
      mesocycle.startWeek,
      input.week
    ),
  });
  const rows = getExposedVolumeLandmarkEntries()
    .map(([muscle, landmark]) => {
      const actualEffectiveSets = weeklyVolume[muscle]?.effectiveSets ?? 0;
      const weeklyTarget = getWeeklyVolumeTarget(mesocycle, muscle, input.week);
      const deltaToTarget = roundToTenth(actualEffectiveSets - weeklyTarget);
      const deltaToMev = roundToTenth(actualEffectiveSets - landmark.mev);
      const deltaToMav = roundToTenth(actualEffectiveSets - landmark.mav);
      const status =
        deltaToMev < 0
          ? "below_mev"
          : deltaToTarget < 0
            ? "under_target_only"
            : deltaToMav > 0
              ? "over_mav"
              : deltaToTarget > 0
                ? "over_target_only"
                : "within_target_band";

      return { muscle, actualEffectiveSets, weeklyTarget, status };
    })
    .filter((row) => row.weeklyTarget > 0 || row.actualEffectiveSets > 0);

  return {
    volumeTargeting: {
      overMav: rows
        .filter((row) => row.status === "over_mav")
        .map((row) => row.muscle),
      overTargetOnly: rows
        .filter((row) => row.status === "over_target_only")
        .map((row) => row.muscle),
    },
  };
}
