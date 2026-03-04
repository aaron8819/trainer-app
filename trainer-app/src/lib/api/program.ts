/**
 * Program dashboard data loader.
 * Shared by the API route and the server-component page to avoid HTTP round-trips.
 */

import { WorkoutStatus, WorkoutSessionIntent } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { VOLUME_LANDMARKS } from "@/lib/engine/volume-landmarks";
import { PERFORMED_WORKOUT_STATUSES } from "@/lib/workout-status";
import {
  deriveNextAdvancingSession,
  getCurrentMesoWeek,
  getRirTarget,
  getWeeklyVolumeTarget,
} from "./mesocycle-lifecycle";

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
    (row) => row.mav > 0 && row.directSets >= Math.floor(row.mrv * 0.85)
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
  blockType: string;
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

export async function loadActiveBlockPhase(userId: string): Promise<ActiveBlockPhase | null> {
  const meso = await prisma.mesocycle.findFirst({
    where: { macroCycle: { userId }, isActive: true },
    select: {
      durationWeeks: true,
      completedSessions: true,
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
  const weekIndex = meso.startWeek + weekInMeso - 1;
  const currentBlock = meso.blocks.find(
    (block) => weekIndex >= block.startWeek && weekIndex < block.startWeek + block.durationWeeks
  );
  const blockType = currentBlock?.blockType?.toLowerCase() ?? "accumulation";
  const sessionsUntilDeload = Math.max(
    0,
    (meso.durationWeeks - 1) * meso.sessionsPerWeek - meso.accumulationSessionsCompleted
  );

  return {
    blockType,
    weekInMeso,
    mesoDurationWeeks: meso.durationWeeks,
    sessionsUntilDeload,
    coachingCue: BLOCK_COACHING_CUES[blockType] ?? BLOCK_COACHING_CUES.accumulation,
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
  mesoWeekStart: Date
): Promise<Record<string, { directSets: number; indirectSets: number }>> {
  const workouts = await prisma.workout.findMany({
    where: {
      userId,
      mesocycleId,
      status: { in: [...PERFORMED_WORKOUT_STATUSES] as WorkoutStatus[] },
      scheduledDate: { gte: mesoWeekStart },
    },
    include: {
      exercises: {
        include: {
          exercise: {
            include: {
              exerciseMuscles: { include: { muscle: true } },
            },
          },
          sets: { include: { logs: { orderBy: { completedAt: "desc" }, take: 1 } } },
        },
      },
    },
  });

  const muscles: Record<string, { directSets: number; indirectSets: number }> = {};
  for (const workout of workouts) {
    for (const workoutExercise of workout.exercises) {
      const completedSets = workoutExercise.sets.filter(
        (set) => set.logs.length > 0 && !set.logs[0].wasSkipped
      ).length;
      if (completedSets === 0) {
        continue;
      }

      const primaryMuscles = workoutExercise.exercise.exerciseMuscles
        .filter((mapping) => mapping.role === "PRIMARY")
        .map((mapping) => mapping.muscle.name);
      const secondaryMuscles = workoutExercise.exercise.exerciseMuscles
        .filter((mapping) => mapping.role === "SECONDARY")
        .map((mapping) => mapping.muscle.name);

      for (const muscle of primaryMuscles) {
        if (!muscles[muscle]) {
          muscles[muscle] = { directSets: 0, indirectSets: 0 };
        }
        muscles[muscle].directSets += completedSets;
      }
      for (const muscle of secondaryMuscles) {
        if (!muscles[muscle]) {
          muscles[muscle] = { directSets: 0, indirectSets: 0 };
        }
        muscles[muscle].indirectSets += completedSets;
      }
    }
  }

  return muscles;
}

async function loadTopIncompleteWorkout(userId: string) {
  const rawIncomplete = await prisma.workout.findMany({
    where: { userId, status: { in: ["IN_PROGRESS", "PARTIAL", "PLANNED"] as WorkoutStatus[] } },
    orderBy: { scheduledDate: "asc" },
    take: 20,
    select: { id: true, sessionIntent: true, status: true, scheduledDate: true },
  });

  const statusPriority: Record<string, number> = { IN_PROGRESS: 0, PARTIAL: 1, PLANNED: 2 };
  return [...rawIncomplete].sort((left, right) => {
    const leftPriority = statusPriority[left.status] ?? 3;
    const rightPriority = statusPriority[right.status] ?? 3;
    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority;
    }
    return left.scheduledDate.getTime() - right.scheduledDate.getTime();
  })[0] ?? null;
}

export async function loadHomeProgramSupport(userId: string): Promise<HomeProgramSupportData> {
  const [mesoRecord, constraints, topIncomplete] = await Promise.all([
    prisma.mesocycle.findFirst({
      where: { macroCycle: { userId }, isActive: true },
      select: {
        durationWeeks: true,
        completedSessions: true,
        accumulationSessionsCompleted: true,
        deloadSessionsCompleted: true,
        sessionsPerWeek: true,
        state: true,
      },
    }),
    prisma.constraints.findUnique({
      where: { userId },
      select: { weeklySchedule: true },
    }),
    loadTopIncompleteWorkout(userId),
  ]);

  const weeklySchedule = (constraints?.weeklySchedule ?? []).map((intent) =>
    (intent as string).toLowerCase()
  );

  const nextSession: NextSessionData = topIncomplete
    ? {
        intent: topIncomplete.sessionIntent?.toLowerCase() ?? null,
        workoutId: topIncomplete.id,
        isExisting: true,
      }
    : {
        intent: mesoRecord
          ? deriveNextAdvancingSession(mesoRecord, weeklySchedule).intent
          : weeklySchedule[0] ?? null,
        workoutId: null,
        isExisting: false,
      };

  const latestIncomplete = topIncomplete
    ? { id: topIncomplete.id, status: topIncomplete.status.toLowerCase() }
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

  return {
    nextSession,
    lastSessionSkipped,
    latestIncomplete,
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
  weekMuscles: Record<string, { directSets: number; indirectSets: number }>;
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
      const data = weekMuscles[muscle] ?? { directSets: 0, indirectSets: 0 };
      const target = mesoRecord ? getWeeklyVolumeTarget(mesoRecord, muscle, week) : landmarks.mev;
      return {
        muscle,
        directSets: data.directSets,
        indirectSets: data.indirectSets,
        target,
        mev: landmarks.mev,
        mav: landmarks.mav,
        mrv: landmarks.mrv,
      };
    })
    .filter((row) => row.mav > 0 && (row.target > 0 || row.directSets > 0))
    .sort((left, right) => {
      const leftRatio = left.target === 0 ? 0 : left.directSets / left.target;
      const rightRatio = right.target === 0 ? 0 : right.directSets / right.target;
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
      completedSessions: true,
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

  let currentBlockType: string | null = null;
  if (mesoRecord) {
    const absoluteWeek = mesoRecord.startWeek + currentWeek - 1;
    const currentBlock = mesoRecord.blocks.find(
      (block) => absoluteWeek >= block.startWeek && absoluteWeek < block.startWeek + block.durationWeeks
    );
    currentBlockType = currentBlock?.blockType?.toLowerCase() ?? null;
  }

  const sessionsUntilDeload = mesoRecord
    ? Math.max(
        0,
        (mesoRecord.durationWeeks - 1) * mesoRecord.sessionsPerWeek - mesoRecord.accumulationSessionsCompleted
      )
    : 0;

  let viewedWeekMuscles: Record<string, { directSets: number; indirectSets: number }> = {};
  let currentWeekMuscles: Record<string, { directSets: number; indirectSets: number }> = {};
  if (mesoRecord) {
    const mesoStart = new Date(mesoRecord.macroCycle.startDate);
    mesoStart.setDate(mesoStart.getDate() + mesoRecord.startWeek * 7);

    viewedWeekMuscles = await loadMesoWeekMuscleVolume(
      userId,
      mesoRecord.id,
      computeMesoWeekStart(mesoStart, effectiveViewWeek)
    );
    currentWeekMuscles =
      effectiveViewWeek === currentWeek
        ? viewedWeekMuscles
        : await loadMesoWeekMuscleVolume(
            userId,
            mesoRecord.id,
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

  const mesoBlocks: ProgramMesoBlock[] = mesoRecord?.blocks.map((block) => ({
    blockType: block.blockType.toLowerCase(),
    startWeek: block.startWeek - mesoRecord.startWeek + 1,
    durationWeeks: block.durationWeeks,
  })) ?? [];

  const blockTypeForCue = currentBlockType ?? "accumulation";

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
    coachingCue: BLOCK_COACHING_CUES[blockTypeForCue] ?? BLOCK_COACHING_CUES.accumulation,
  };
}

export type CycleAnchorAction = "deload" | "extend_phase" | "skip_phase" | "reset";

export async function applyCycleAnchor(userId: string, action: CycleAnchorAction): Promise<void> {
  const meso = await prisma.mesocycle.findFirst({
    where: { macroCycle: { userId }, isActive: true },
    select: { id: true, completedSessions: true, accumulationSessionsCompleted: true, durationWeeks: true },
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
      await prisma.mesocycle.update({
        where: { id: meso.id },
        data: {
          completedSessions: Math.max(meso.completedSessions, deloadThreshold),
          accumulationSessionsCompleted: Math.max(meso.accumulationSessionsCompleted, deloadThreshold),
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
        data: { completedSessions: 0, accumulationSessionsCompleted: 0 },
      });
      break;
    }
  }
}
