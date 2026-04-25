import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import {
  getExposedVolumeLandmarkEntries,
  getMuscleTargetSemantics,
  type VolumeSoftTargetRange,
  type VolumeTargetKind,
} from "@/lib/engine/volume-landmarks";
import { getCurrentMesoWeek, getWeeklyVolumeTarget } from "./mesocycle-lifecycle-math";
import {
  loadMesocycleWeekMuscleVolume,
  type WeeklyMuscleExerciseContribution,
  type WeeklyMuscleVolumeRow,
} from "./weekly-volume";

type MuscleOutcomeReviewReader =
  | Pick<Prisma.TransactionClient, "mesocycle" | "workout">
  | Pick<typeof prisma, "mesocycle" | "workout">;

export type MuscleOutcomeStatus =
  | "on_target"
  | "slightly_low"
  | "meaningfully_low"
  | "slightly_high"
  | "meaningfully_high";

export type WeeklyMuscleOutcomeRow = {
  muscle: string;
  targetKind?: VolumeTargetKind;
  targetRange?: VolumeSoftTargetRange | null;
  targetSets: number;
  actualEffectiveSets: number;
  delta: number;
  percentDelta: number;
  status: MuscleOutcomeStatus;
  contributingExerciseCount: number;
  topContributors: Array<
    Pick<WeeklyMuscleExerciseContribution, "exerciseId" | "exerciseName" | "effectiveSets">
  >;
};

export type WeeklyMuscleOutcomeReview = {
  mesocycleId: string;
  week: number;
  weekStart: string;
  rows: WeeklyMuscleOutcomeRow[];
};

type ActiveMesocycleRecord = {
  id: string;
  durationWeeks: number;
  startWeek: number;
  state: "ACTIVE_ACCUMULATION" | "ACTIVE_DELOAD" | "AWAITING_HANDOFF" | "COMPLETED";
  accumulationSessionsCompleted: number;
  deloadSessionsCompleted: number;
  sessionsPerWeek: number;
  blocks?: Array<{
    blockType: string;
    startWeek: number;
    durationWeeks: number;
    volumeTarget: string;
    intensityBias: string;
  }>;
  macroCycle: { startDate: Date };
};

function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

function computeMesoWeekStartDate(mesoStartDate: Date, week: number): Date {
  const date = new Date(mesoStartDate);
  date.setDate(date.getDate() + (week - 1) * 7);
  return date;
}

export function classifyMuscleOutcome(
  targetSets: number,
  actualEffectiveSets: number,
  options?: {
    targetKind?: VolumeTargetKind;
    targetRange?: VolumeSoftTargetRange | null;
  }
): Pick<WeeklyMuscleOutcomeRow, "delta" | "percentDelta" | "status"> {
  if (options?.targetKind === "soft" && options.targetRange) {
    const range = options.targetRange;
    if (actualEffectiveSets < range.min) {
      const delta = roundToTenth(actualEffectiveSets - range.min);
      const percentDelta = Number((delta / range.min).toFixed(3));
      return {
        delta,
        percentDelta,
        status: percentDelta < -0.25 ? "meaningfully_low" : "slightly_low",
      };
    }
    if (actualEffectiveSets > range.max) {
      const delta = roundToTenth(actualEffectiveSets - range.max);
      const percentDelta = Number((delta / range.max).toFixed(3));
      return {
        delta,
        percentDelta,
        status: percentDelta > 0.25 ? "meaningfully_high" : "slightly_high",
      };
    }
    return {
      delta: 0,
      percentDelta: 0,
      status: "on_target",
    };
  }

  const delta = roundToTenth(actualEffectiveSets - targetSets);

  if (targetSets <= 0) {
    if (actualEffectiveSets <= 0) {
      return {
        delta,
        percentDelta: 0,
        status: "on_target",
      };
    }

    return {
      delta,
      percentDelta: 1,
      status: "meaningfully_high",
    };
  }

  const percentDelta = Number((delta / targetSets).toFixed(3));
  if (Math.abs(percentDelta) <= 0.1) {
    return { delta, percentDelta, status: "on_target" };
  }
  if (percentDelta < -0.25) {
    return { delta, percentDelta, status: "meaningfully_low" };
  }
  if (percentDelta < -0.1) {
    return { delta, percentDelta, status: "slightly_low" };
  }
  if (percentDelta > 0.25) {
    return { delta, percentDelta, status: "meaningfully_high" };
  }
  return { delta, percentDelta, status: "slightly_high" };
}

function buildMuscleOutcomeRow(
  muscle: string,
  targetSets: number,
  weeklyVolumeRow: WeeklyMuscleVolumeRow | undefined
): WeeklyMuscleOutcomeRow {
  const actualEffectiveSets = weeklyVolumeRow?.effectiveSets ?? 0;
  const targetSemantics = getMuscleTargetSemantics(muscle);
  const outcome = classifyMuscleOutcome(targetSets, actualEffectiveSets, {
    targetKind: targetSemantics.targetKind,
    targetRange: targetSemantics.softTargetRange,
  });
  const contributions = weeklyVolumeRow?.contributions ?? [];

  return {
    muscle,
    targetKind: targetSemantics.targetKind,
    targetRange: targetSemantics.softTargetRange,
    targetSets,
    actualEffectiveSets,
    ...outcome,
    contributingExerciseCount: contributions.length,
    topContributors: contributions.slice(0, 3).map((contribution) => ({
      exerciseId: contribution.exerciseId,
      exerciseName: contribution.exerciseName,
      effectiveSets: contribution.effectiveSets,
    })),
  };
}

function sortOutcomeRows(rows: WeeklyMuscleOutcomeRow[]): WeeklyMuscleOutcomeRow[] {
  const severityRank: Record<MuscleOutcomeStatus, number> = {
    meaningfully_low: 0,
    meaningfully_high: 1,
    slightly_low: 2,
    slightly_high: 3,
    on_target: 4,
  };

  return [...rows].sort((left, right) => {
    const rankDelta = severityRank[left.status] - severityRank[right.status];
    if (rankDelta !== 0) {
      return rankDelta;
    }

    const magnitudeDelta = Math.abs(right.percentDelta) - Math.abs(left.percentDelta);
    if (magnitudeDelta !== 0) {
      return magnitudeDelta;
    }

    return left.muscle.localeCompare(right.muscle);
  });
}

export async function loadWeeklyMuscleOutcome(
  client: MuscleOutcomeReviewReader,
  userId: string
): Promise<WeeklyMuscleOutcomeReview | null> {
  const activeMesocycle = await client.mesocycle.findFirst({
    where: { macroCycle: { userId }, isActive: true },
    select: {
      id: true,
      durationWeeks: true,
      startWeek: true,
      state: true,
      accumulationSessionsCompleted: true,
      deloadSessionsCompleted: true,
      sessionsPerWeek: true,
      blocks: {
        orderBy: { blockNumber: "asc" },
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

  if (!activeMesocycle) {
    return null;
  }

  const currentWeek = getCurrentMesoWeek(activeMesocycle as ActiveMesocycleRecord);
  const mesoStart = new Date(activeMesocycle.macroCycle.startDate);
  mesoStart.setDate(mesoStart.getDate() + activeMesocycle.startWeek * 7);
  const weekStart = computeMesoWeekStartDate(mesoStart, currentWeek);
  const weeklyVolume = await loadMesocycleWeekMuscleVolume(client, {
    userId,
    mesocycleId: activeMesocycle.id,
    targetWeek: currentWeek,
    weekStart,
    includeBreakdowns: true,
  });

  const rows = sortOutcomeRows(
    getExposedVolumeLandmarkEntries()
      .map(([muscle]) => {
        const targetSets = getWeeklyVolumeTarget(activeMesocycle, muscle, currentWeek);
        const weeklyRow = weeklyVolume[muscle];
        return buildMuscleOutcomeRow(muscle, targetSets, weeklyRow);
      })
      .filter((row) => row.targetSets > 0 || row.actualEffectiveSets > 0)
  );

  return {
    mesocycleId: activeMesocycle.id,
    week: currentWeek,
    weekStart: weekStart.toISOString().slice(0, 10),
    rows,
  };
}

export async function loadWeeklyMuscleOutcomeFromPrisma(
  userId: string
): Promise<WeeklyMuscleOutcomeReview | null> {
  return loadWeeklyMuscleOutcome(prisma, userId);
}
