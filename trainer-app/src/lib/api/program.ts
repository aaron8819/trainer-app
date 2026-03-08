/**
 * Program dashboard data loader.
 * Shared by the API route and the server-component page to avoid HTTP round-trips.
 */

import { WorkoutSessionIntent } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { VOLUME_LANDMARKS } from "@/lib/engine/volume-landmarks";
import {
  getCurrentMesoWeek,
  getRirTarget,
  getWeeklyVolumeTarget,
} from "./mesocycle-lifecycle-math";
import { loadNextWorkoutContext } from "./next-session";
import { findPendingWeekCloseForUser } from "./mesocycle-week-close";
import { loadMesocycleWeekMuscleVolume, type WeeklyMuscleVolumeRow } from "./weekly-volume";

export type ProgramMesoBlock = {
  blockType: string;
  startWeek: number;
  durationWeeks: number;
};

export type ProgramMesoSummary = {
  mesoNumber: number;
  focus: string;
  durationWeeks: number;
  completedSessions: number;
  volumeTarget: string;
  currentBlockType: string | null;
  blocks: ProgramMesoBlock[];
};

export type ProgramVolumeRow = {
  muscle: string;
  effectiveSets: number;
  directSets: number;
  indirectSets: number;
  target: number;
  mev: number;
  mav: number;
  mrv: number;
};

export type DeloadReadiness = {
  shouldDeload: boolean;
  urgency: "scheduled" | "recommended" | "urgent";
  reason: string;
};

export type NextSessionData = {
  intent: string | null;
  workoutId: string | null;
  isExisting: boolean;
};

export type ProgramDashboardData = {
  activeMeso: ProgramMesoSummary | null;
  currentWeek: number;
  viewedWeek: number;
  sessionsUntilDeload: number;
  volumeThisWeek: ProgramVolumeRow[];
  deloadReadiness: DeloadReadiness | null;
  rirTarget: { min: number; max: number } | null;
  coachingCue: string;
};

export type HomeProgramSupportData = {
  nextSession: NextSessionData;
  lastSessionSkipped: boolean;
  latestIncomplete: { id: string; status: string } | null;
  gapFill: GapFillSupportData;
};

export type GapFillDeficitRow = {
  muscle: string;
  target: number;
  actual: number;
  deficit: number;
};

export type GapFillPolicy = {
  requiredSessionsPerWeek: number;
  maxOptionalGapFillSessionsPerWeek: number;
  maxGeneratedHardSets: number;
  maxGeneratedExercises: number;
};

export type GapFillSupportData = {
  eligible: boolean;
  reason: string | null;
  weekCloseId: string | null;
  anchorWeek: number | null;
  targetWeek: number | null;
  targetPhase: "ACCUMULATION" | "DELOAD" | null;
  targetMuscles: string[];
  deficitSummary: GapFillDeficitRow[];
  alreadyUsedThisWeek: boolean;
  suppressedByStartedNextWeek: boolean;
  linkedWorkout: { id: string; status: string } | null;
  policy: GapFillPolicy;
};

export type CapabilityFlags = {
  whoopConnected: boolean;
  readinessEnabled: boolean;
};

export async function loadCapabilityFlags(userId: string): Promise<CapabilityFlags> {
  const whoopIntegration = await prisma.userIntegration.findFirst({
    where: { userId, provider: "whoop", isActive: true },
    select: { id: true },
  });

  return {
    whoopConnected: Boolean(whoopIntegration),
    readinessEnabled: process.env.ENABLE_READINESS_CHECKINS !== "0",
  };
}

export function computeDeloadReadiness(
  currentWeek: number,
  durationWeeks: number,
  volumeRows: ProgramVolumeRow[]
): DeloadReadiness {
  const isScheduled = currentWeek >= durationWeeks;

  const saturatedMuscles = volumeRows.filter(
    (row) => row.mav > 0 && row.effectiveSets >= row.mrv * 0.85
  );
  const isVolumeSaturated = saturatedMuscles.length >= 2;

  if (isScheduled && isVolumeSaturated) {
    return {
      shouldDeload: true,
      urgency: "urgent",
      reason: `Deload week + ${saturatedMuscles.map((row) => row.muscle).join(", ")} at or near MRV - take the deload now.`,
    };
  }

  if (isScheduled) {
    return {
      shouldDeload: true,
      urgency: "scheduled",
      reason: "Deload week - lighter loads, reduced volume, and focus on technique.",
    };
  }

  if (isVolumeSaturated) {
    const names = saturatedMuscles.map((row) => row.muscle).join(", ");
    return {
      shouldDeload: true,
      urgency: "recommended",
      reason: `${names} ${saturatedMuscles.length === 1 ? "is" : "are"} approaching MRV. Consider taking a deload this week.`,
    };
  }

  return { shouldDeload: false, urgency: "scheduled", reason: "" };
}

export type ActiveBlockPhase = {
  blockType: string | null;
  weekInMeso: number;
  mesoDurationWeeks: number;
  sessionsUntilDeload: number;
  coachingCue: string;
};

const BLOCK_COACHING_CUES: Record<string, string> = {
  accumulation: "Accumulation phase - build volume, work within 2-3 RIR.",
  intensification: "Intensification phase - heavier loads, push to 0-1 RIR.",
  realization: "Peak week - express your strength today.",
  deload: "Deload week - keep loads light, focus on technique and recovery.",
};

type ProgramBlockRecord = { blockType: string; startWeek: number; durationWeeks: number };

function normalizeMesoBlocks(input: {
  mesoStartWeek: number;
  durationWeeks: number;
  blocks: ProgramBlockRecord[];
}): ProgramBlockRecord[] {
  const { mesoStartWeek, durationWeeks, blocks } = input;
  if (durationWeeks <= 0) return [];

  const mesoEndWeek = mesoStartWeek + durationWeeks;
  const weekTypes: Array<string | null> = Array.from({ length: durationWeeks }, () => null);

  for (const block of blocks) {
    const blockStart = Math.max(mesoStartWeek, block.startWeek);
    const rawBlockEnd = block.startWeek + Math.max(0, block.durationWeeks);
    const blockEnd = Math.min(mesoEndWeek, rawBlockEnd);
    if (blockEnd <= blockStart) continue;

    for (let absoluteWeek = blockStart; absoluteWeek < blockEnd; absoluteWeek += 1) {
      const weekIndex = absoluteWeek - mesoStartWeek;
      if (weekTypes[weekIndex] == null) {
        weekTypes[weekIndex] = block.blockType.toLowerCase();
      }
    }
  }

  for (let weekIndex = 0; weekIndex < weekTypes.length; weekIndex += 1) {
    if (weekTypes[weekIndex] != null) continue;
    weekTypes[weekIndex] = weekIndex === weekTypes.length - 1 ? "deload" : "accumulation";
  }

  const normalized: ProgramBlockRecord[] = [];
  let segmentStart = 0;
  while (segmentStart < weekTypes.length) {
    const blockType = weekTypes[segmentStart] ?? "accumulation";
    let segmentEnd = segmentStart + 1;
    while (segmentEnd < weekTypes.length && weekTypes[segmentEnd] === blockType) {
      segmentEnd += 1;
    }
    normalized.push({
      blockType,
      startWeek: mesoStartWeek + segmentStart,
      durationWeeks: segmentEnd - segmentStart,
    });
    segmentStart = segmentEnd;
  }

  return normalized;
}

function resolveBlockTypeForWeek(input: {
  mesoStartWeek: number;
  weekInMeso: number;
  mesoState: "ACTIVE_ACCUMULATION" | "ACTIVE_DELOAD" | "COMPLETED";
  blocks: ProgramBlockRecord[];
}): string | null {
  const absoluteWeek = input.mesoStartWeek + input.weekInMeso - 1;
  const block = input.blocks.find(
    (candidate) =>
      absoluteWeek >= candidate.startWeek &&
      absoluteWeek < candidate.startWeek + candidate.durationWeeks
  );
  const normalizedBlockType = block?.blockType?.toLowerCase() ?? null;
  if (normalizedBlockType) {
    return normalizedBlockType;
  }
  if (input.mesoState === "ACTIVE_DELOAD") {
    return "deload";
  }
  return null;
}

function getCoachingCueForBlockType(blockType: string | null): string {
  if (!blockType) {
    return "Phase context unavailable for current week.";
  }
  return BLOCK_COACHING_CUES[blockType] ?? `Current phase: ${blockType}.`;
}

export async function loadActiveBlockPhase(userId: string): Promise<ActiveBlockPhase | null> {
  const meso = await prisma.mesocycle.findFirst({
    where: { macroCycle: { userId }, isActive: true },
    select: {
      durationWeeks: true,
      accumulationSessionsCompleted: true,
      sessionsPerWeek: true,
      state: true,
      startWeek: true,
      blocks: {
        orderBy: { blockNumber: "asc" },
        select: { blockType: true, startWeek: true, durationWeeks: true },
      },
      macroCycle: { select: { startDate: true } },
    },
  });

  if (!meso) {
    return null;
  }

  const weekInMeso = getCurrentMesoWeek(meso);
  const normalizedBlocks = normalizeMesoBlocks({
    mesoStartWeek: meso.startWeek,
    durationWeeks: meso.durationWeeks,
    blocks: meso.blocks,
  });
  const blockType = resolveBlockTypeForWeek({
    mesoStartWeek: meso.startWeek,
    weekInMeso,
    mesoState: meso.state,
    blocks: normalizedBlocks,
  });
  const sessionsUntilDeload = Math.max(
    0,
    (meso.durationWeeks - 1) * meso.sessionsPerWeek - meso.accumulationSessionsCompleted
  );

  return {
    blockType,
    weekInMeso,
    mesoDurationWeeks: meso.durationWeeks,
    sessionsUntilDeload,
    coachingCue: getCoachingCueForBlockType(blockType),
  };
}

export function computeMesoWeekStart(mesoStartDate: Date, currentWeek: number): Date {
  const date = new Date(mesoStartDate);
  date.setDate(date.getDate() + (currentWeek - 1) * 7);
  return date;
}

async function loadMesoWeekMuscleVolume(
  userId: string,
  mesocycleId: string,
  weekInMeso: number,
  mesoWeekStart: Date
): Promise<Record<string, WeeklyMuscleVolumeRow>> {
  return loadMesocycleWeekMuscleVolume(prisma, {
    userId,
    mesocycleId,
    targetWeek: weekInMeso,
    weekStart: mesoWeekStart,
  });
}

export async function loadHomeProgramSupport(userId: string): Promise<HomeProgramSupportData> {
  const [nextWorkoutContext, activeMesocycle] = await Promise.all([
    loadNextWorkoutContext(userId),
    prisma.mesocycle.findFirst({
      where: { macroCycle: { userId }, isActive: true },
      select: {
        id: true,
        durationWeeks: true,
        sessionsPerWeek: true,
        accumulationSessionsCompleted: true,
        deloadSessionsCompleted: true,
        volumeTarget: true,
        state: true,
        macroCycle: {
          select: {
            startDate: true,
          },
        },
      },
    }),
  ]);
  const nextSession: NextSessionData = {
    intent: nextWorkoutContext.intent,
    workoutId: nextWorkoutContext.existingWorkoutId,
    isExisting: nextWorkoutContext.isExisting,
  };
  const latestIncomplete = nextWorkoutContext.existingWorkoutId
    ? {
        id: nextWorkoutContext.existingWorkoutId,
        status: nextWorkoutContext.selectedIncompleteStatus ?? "planned",
      }
    : null;

  let lastSessionSkipped = false;
  if (!nextSession.isExisting && nextSession.intent) {
    const intentEnum = nextSession.intent.toUpperCase() as WorkoutSessionIntent;
    const latestForIntent = await prisma.workout.findFirst({
      where: { userId, sessionIntent: intentEnum },
      orderBy: { scheduledDate: "desc" },
      select: { status: true },
    });
    lastSessionSkipped = latestForIntent?.status === "SKIPPED";
  }

  const pendingWeekClose = activeMesocycle
    ? await findPendingWeekCloseForUser({
        userId,
        mesocycleId: activeMesocycle.id,
      })
    : null;
  const deficitSnapshot = pendingWeekClose?.deficitSnapshot;
  const policy: GapFillPolicy = {
    requiredSessionsPerWeek: Math.max(
      1,
      deficitSnapshot?.policy.requiredSessionsPerWeek ?? activeMesocycle?.sessionsPerWeek ?? 3
    ),
    maxOptionalGapFillSessionsPerWeek:
      deficitSnapshot?.policy.maxOptionalGapFillSessionsPerWeek ?? 1,
    maxGeneratedHardSets: deficitSnapshot?.policy.maxGeneratedHardSets ?? 12,
    maxGeneratedExercises: deficitSnapshot?.policy.maxGeneratedExercises ?? 4,
  };
  const deficitSummary: GapFillDeficitRow[] =
    deficitSnapshot?.muscles.slice(0, 3).map((row) => ({
      muscle: row.muscle,
      target: row.target,
      actual: row.actual,
      deficit: row.deficit,
    })) ?? [];
  const targetMuscles =
    deficitSnapshot?.summary.topTargetMuscles?.filter(Boolean) ??
    deficitSummary.map((row) => row.muscle);
  const linkedWorkout = pendingWeekClose?.optionalWorkout
    ? {
        id: pendingWeekClose.optionalWorkout.id,
        status: pendingWeekClose.optionalWorkout.status,
      }
    : null;

  const gapFill: GapFillSupportData = {
    eligible: Boolean(pendingWeekClose?.id && targetMuscles.length > 0),
    reason:
      !pendingWeekClose
        ? "no_pending_week_close"
        : targetMuscles.length === 0
          ? "missing_deficit_snapshot"
          : null,
    weekCloseId: pendingWeekClose?.id ?? null,
    anchorWeek: pendingWeekClose?.targetWeek ?? null,
    targetWeek: pendingWeekClose?.targetWeek ?? null,
    targetPhase: pendingWeekClose?.targetPhase ?? null,
    targetMuscles,
    deficitSummary,
    alreadyUsedThisWeek: false,
    suppressedByStartedNextWeek: false,
    linkedWorkout,
    policy,
  };

  return {
    nextSession,
    lastSessionSkipped,
    latestIncomplete,
    gapFill,
  };
}

function buildProgramVolumeRows(input: {
  mesoRecord: {
    durationWeeks: number;
    sessionsPerWeek: number;
    volumeTarget: string;
    accumulationSessionsCompleted: number;
    id: string;
  } | null;
  week: number;
  weekMuscles: Record<string, WeeklyMuscleVolumeRow>;
}): ProgramVolumeRow[] {
  const { mesoRecord, week, weekMuscles } = input;
  const researchBackedMuscles = new Set([
    "Chest",
    "Lats",
    "Upper Back",
    "Front Delts",
    "Side Delts",
    "Rear Delts",
    "Quads",
    "Hamstrings",
    "Glutes",
    "Biceps",
    "Triceps",
    "Calves",
  ]);

  return Object.entries(VOLUME_LANDMARKS)
    .filter(([muscle]) => researchBackedMuscles.has(muscle))
    .map(([muscle, landmarks]) => {
      const data = weekMuscles[muscle] ?? { directSets: 0, indirectSets: 0, effectiveSets: 0 };
      const target = mesoRecord ? getWeeklyVolumeTarget(mesoRecord, muscle, week) : landmarks.mev;
      return {
        muscle,
        effectiveSets: data.effectiveSets,
        directSets: data.directSets,
        indirectSets: data.indirectSets,
        target,
        mev: landmarks.mev,
        mav: landmarks.mav,
        mrv: landmarks.mrv,
      };
    })
    .filter((row) => row.mav > 0 && (row.target > 0 || row.effectiveSets > 0))
    .sort((left, right) => {
      const leftRatio = left.target === 0 ? 0 : left.effectiveSets / left.target;
      const rightRatio = right.target === 0 ? 0 : right.effectiveSets / right.target;
      return leftRatio - rightRatio;
    });
}

export async function loadProgramDashboardData(
  userId: string,
  viewWeek?: number
): Promise<ProgramDashboardData> {
  const mesoRecord = await prisma.mesocycle.findFirst({
    where: { macroCycle: { userId }, isActive: true },
    select: {
      id: true,
      mesoNumber: true,
      focus: true,
      durationWeeks: true,
      accumulationSessionsCompleted: true,
      deloadSessionsCompleted: true,
      sessionsPerWeek: true,
      volumeTarget: true,
      startWeek: true,
      state: true,
      blocks: {
        orderBy: { blockNumber: "asc" },
        select: {
          blockType: true,
          startWeek: true,
          durationWeeks: true,
        },
      },
      macroCycle: { select: { startDate: true } },
    },
  });

  let currentWeek = 1;
  if (mesoRecord) {
    currentWeek = getCurrentMesoWeek(mesoRecord);
  }

  const effectiveViewWeek = mesoRecord
    ? Math.max(1, Math.min(viewWeek ?? currentWeek, mesoRecord.durationWeeks))
    : 1;

  const normalizedBlocks = mesoRecord
    ? normalizeMesoBlocks({
        mesoStartWeek: mesoRecord.startWeek,
        durationWeeks: mesoRecord.durationWeeks,
        blocks: mesoRecord.blocks,
      })
    : [];

  const currentBlockType = mesoRecord
    ? resolveBlockTypeForWeek({
        mesoStartWeek: mesoRecord.startWeek,
        weekInMeso: currentWeek,
        mesoState: mesoRecord.state,
        blocks: normalizedBlocks,
      })
    : null;
  const viewedBlockType = mesoRecord
    ? resolveBlockTypeForWeek({
        mesoStartWeek: mesoRecord.startWeek,
        weekInMeso: effectiveViewWeek,
        mesoState: mesoRecord.state,
        blocks: normalizedBlocks,
      })
    : null;

  const sessionsUntilDeload = mesoRecord
    ? Math.max(
        0,
        (mesoRecord.durationWeeks - 1) * mesoRecord.sessionsPerWeek - mesoRecord.accumulationSessionsCompleted
      )
    : 0;

  let viewedWeekMuscles: Record<string, WeeklyMuscleVolumeRow> = {};
  let currentWeekMuscles: Record<string, WeeklyMuscleVolumeRow> = {};
  if (mesoRecord) {
    const mesoStart = new Date(mesoRecord.macroCycle.startDate);
    mesoStart.setDate(mesoStart.getDate() + mesoRecord.startWeek * 7);

    viewedWeekMuscles = await loadMesoWeekMuscleVolume(
      userId,
      mesoRecord.id,
      effectiveViewWeek,
      computeMesoWeekStart(mesoStart, effectiveViewWeek)
    );
    currentWeekMuscles =
      effectiveViewWeek === currentWeek
        ? viewedWeekMuscles
        : await loadMesoWeekMuscleVolume(
            userId,
            mesoRecord.id,
            currentWeek,
            computeMesoWeekStart(mesoStart, currentWeek)
          );
  }

  const volumeThisWeek = buildProgramVolumeRows({
    mesoRecord,
    week: effectiveViewWeek,
    weekMuscles: viewedWeekMuscles,
  });
  const liveCurrentWeekVolume = buildProgramVolumeRows({
    mesoRecord,
    week: currentWeek,
    weekMuscles: currentWeekMuscles,
  });
  const rirTarget = mesoRecord ? getRirTarget(mesoRecord, effectiveViewWeek) : null;
  const deloadReadiness = mesoRecord
    ? computeDeloadReadiness(currentWeek, mesoRecord.durationWeeks, liveCurrentWeekVolume)
    : null;

  const mesoBlocks: ProgramMesoBlock[] = mesoRecord ? normalizedBlocks.map((block) => ({
    blockType: block.blockType.toLowerCase(),
    startWeek: block.startWeek - mesoRecord.startWeek + 1,
    durationWeeks: block.durationWeeks,
  })) : [];

  return {
    activeMeso: mesoRecord
      ? {
          mesoNumber: mesoRecord.mesoNumber,
          focus: mesoRecord.focus,
          durationWeeks: mesoRecord.durationWeeks,
          completedSessions: mesoRecord.accumulationSessionsCompleted,
          volumeTarget: mesoRecord.volumeTarget.toLowerCase(),
          currentBlockType,
          blocks: mesoBlocks,
        }
      : null,
    currentWeek,
    viewedWeek: effectiveViewWeek,
    sessionsUntilDeload,
    volumeThisWeek,
    deloadReadiness,
    rirTarget,
    coachingCue: getCoachingCueForBlockType(viewedBlockType),
  };
}

export type CycleAnchorAction = "deload" | "extend_phase" | "skip_phase" | "reset";

export async function applyCycleAnchor(userId: string, action: CycleAnchorAction): Promise<void> {
  const meso = await prisma.mesocycle.findFirst({
    where: { macroCycle: { userId }, isActive: true },
    select: { id: true, accumulationSessionsCompleted: true, durationWeeks: true },
  });

  if (!meso) {
    throw new Error("No active mesocycle found");
  }

  const constraints = await prisma.constraints.findUnique({
    where: { userId },
    select: { daysPerWeek: true },
  });
  const daysPerWeek = Math.max(1, constraints?.daysPerWeek ?? 3);

  switch (action) {
    case "deload": {
      const deloadThreshold = (meso.durationWeeks - 1) * daysPerWeek;
      const nextAccumulationSessionsCompleted = Math.max(
        meso.accumulationSessionsCompleted,
        deloadThreshold
      );
      await prisma.mesocycle.update({
        where: { id: meso.id },
        data: {
          completedSessions: nextAccumulationSessionsCompleted,
          accumulationSessionsCompleted: nextAccumulationSessionsCompleted,
        },
      });
      break;
    }
    case "extend_phase": {
      await prisma.mesocycle.update({
        where: { id: meso.id },
        data: { durationWeeks: meso.durationWeeks + 1 },
      });
      break;
    }
    case "skip_phase": {
      break;
    }
    case "reset": {
      await prisma.mesocycle.update({
        where: { id: meso.id },
        data: { completedSessions: 0, accumulationSessionsCompleted: 0, deloadSessionsCompleted: 0 },
      });
      break;
    }
  }
}
