/**
 * Program Dashboard data loader.
 * Shared by the API route and the server-component page to avoid HTTP round-trips.
 */

import { prisma } from "@/lib/db/prisma";
import { VOLUME_LANDMARKS, computeWeeklyVolumeTarget } from "@/lib/engine/volume-landmarks";
import { computeWeeklyMuscleVolume } from "./analytics";
import { computeCurrentMesoWeek } from "./periodization";

export type ProgramMesoBlock = {
  blockType: string;       // "accumulation" | "intensification" | "realization" | "deload"
  startWeek: number;       // 1-indexed week within the meso where this block starts
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

export type ProgramRecentWorkout = {
  id: string;
  scheduledDate: string;
  completedAt: string | null;
  status: string;
  sessionIntent: string | null;
  advancesSplit: boolean;
};

export type DeloadReadiness = {
  shouldDeload: boolean;
  urgency: "scheduled" | "recommended" | "urgent";
  reason: string;
};

export type ProgramDashboardData = {
  activeMeso: ProgramMesoSummary | null;
  currentWeek: number;
  sessionsUntilDeload: number;
  volumeThisWeek: ProgramVolumeRow[];
  recentWorkouts: ProgramRecentWorkout[];
  deloadReadiness: DeloadReadiness | null;
  capabilities: CapabilityFlags;
};

export type CapabilityFlags = {
  whoopConnected: boolean;
  readinessEnabled: boolean;
};

export async function loadCapabilityFlags(userId: string): Promise<CapabilityFlags> {
  const [whoopIntegration] = await Promise.all([
    prisma.userIntegration.findFirst({
      where: { userId, provider: "whoop", isActive: true },
      select: { id: true },
    }),
  ]);

  return {
    whoopConnected: Boolean(whoopIntegration),
    readinessEnabled: process.env.ENABLE_READINESS_CHECKINS !== "0",
  };
}

/**
 * Compute a unified deload readiness signal from:
 * 1. Scheduled: current week is the last week of the mesocycle
 * 2. Volume saturation: ≥2 muscles at ≥85% MRV (approaching overreaching)
 *
 * Returns null when there is no active mesocycle.
 */
export function computeDeloadReadiness(
  currentWeek: number,
  durationWeeks: number,
  volumeRows: ProgramVolumeRow[]
): DeloadReadiness {
  const isScheduled = currentWeek >= durationWeeks;

  // Count muscles that are tracked (mav > 0) and at/near MRV
  const saturatedMuscles = volumeRows.filter(
    (v) => v.mav > 0 && v.directSets >= Math.floor(v.mrv * 0.85)
  );
  const isVolumeSaturated = saturatedMuscles.length >= 2;

  if (isScheduled && isVolumeSaturated) {
    return {
      shouldDeload: true,
      urgency: "urgent",
      reason: `Deload week + ${saturatedMuscles.map((v) => v.muscle).join(", ")} at or near MRV — take the deload now.`,
    };
  }

  if (isScheduled) {
    return {
      shouldDeload: true,
      urgency: "scheduled",
      reason: "Deload week — lighter loads, reduced volume, and focus on technique.",
    };
  }

  if (isVolumeSaturated) {
    const names = saturatedMuscles.map((v) => v.muscle).join(", ");
    return {
      shouldDeload: true,
      urgency: "recommended",
      reason: `${names} ${saturatedMuscles.length === 1 ? "is" : "are"} approaching MRV. Consider taking a deload this week.`,
    };
  }

  return { shouldDeload: false, urgency: "scheduled", reason: "" };
}

export type ActiveBlockPhase = {
  blockType: string;         // "accumulation" | "intensification" | "realization" | "deload"
  weekInMeso: number;        // 1-indexed
  mesoDurationWeeks: number;
  sessionsUntilDeload: number;
  coachingCue: string;
};

const BLOCK_COACHING_CUES: Record<string, string> = {
  accumulation: "Accumulation phase — build volume, work within 2–3 RIR.",
  intensification: "Intensification phase — heavier loads, push to 0–1 RIR.",
  realization: "Peak week — express your strength today.",
  deload: "Deload week — keep loads light, focus on technique and recovery.",
};

/**
 * Lightweight block phase loader for the home page / generate card.
 * Returns null when no active mesocycle exists.
 */
export async function loadActiveBlockPhase(userId: string): Promise<ActiveBlockPhase | null> {
  const meso = await prisma.mesocycle.findFirst({
    where: { macroCycle: { userId }, isActive: true },
    select: {
      durationWeeks: true,
      completedSessions: true,
      startWeek: true,
      blocks: { orderBy: { blockNumber: "asc" }, select: { blockType: true, startWeek: true, durationWeeks: true } },
      macroCycle: { select: { startDate: true } },
    },
  });

  if (!meso) return null;

  const constraints = await prisma.constraints.findUnique({
    where: { userId },
    select: { daysPerWeek: true },
  });
  const daysPerWeek = constraints?.daysPerWeek ?? 3;

  const mesoStart = new Date(meso.macroCycle.startDate);
  mesoStart.setDate(mesoStart.getDate() + meso.startWeek * 7);

  const weekInMeso = computeCurrentMesoWeek(
    { completedSessions: meso.completedSessions, durationWeeks: meso.durationWeeks, startDate: mesoStart },
    daysPerWeek
  );

  const weekIndex = meso.startWeek + weekInMeso - 1; // absolute 0-indexed
  const currentBlock = meso.blocks.find(
    (b) => weekIndex >= b.startWeek && weekIndex < b.startWeek + b.durationWeeks
  );
  const blockType = currentBlock?.blockType?.toLowerCase() ?? "accumulation";

  const sessionsUntilDeload = Math.max(
    0,
    (meso.durationWeeks - 1) * daysPerWeek - meso.completedSessions
  );

  return {
    blockType,
    weekInMeso,
    mesoDurationWeeks: meso.durationWeeks,
    sessionsUntilDeload,
    coachingCue: BLOCK_COACHING_CUES[blockType] ?? BLOCK_COACHING_CUES.accumulation,
  };
}

export async function loadProgramDashboardData(userId: string): Promise<ProgramDashboardData> {
  const capabilities = await loadCapabilityFlags(userId);
  // Load active mesocycle with blocks + macro start date
  const mesoRecord = await prisma.mesocycle.findFirst({
    where: { macroCycle: { userId }, isActive: true },
    select: {
      mesoNumber: true,
      focus: true,
      durationWeeks: true,
      completedSessions: true,
      volumeTarget: true,
      startWeek: true,
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

  // daysPerWeek from constraints (fallback 3)
  const constraints = await prisma.constraints.findUnique({
    where: { userId },
    select: { daysPerWeek: true },
  });
  const daysPerWeek = constraints?.daysPerWeek ?? 3;

  // Compute current week (1-indexed)
  let currentWeek = 1;
  if (mesoRecord) {
    const mesoStart = new Date(mesoRecord.macroCycle.startDate);
    mesoStart.setDate(mesoStart.getDate() + mesoRecord.startWeek * 7);
    currentWeek = computeCurrentMesoWeek(
      { completedSessions: mesoRecord.completedSessions, durationWeeks: mesoRecord.durationWeeks, startDate: mesoStart },
      daysPerWeek
    );
  }

  // Find current block type (blocks use absolute startWeek within macro)
  let currentBlockType: string | null = null;
  if (mesoRecord) {
    const absoluteWeek = mesoRecord.startWeek + currentWeek - 1;
    const currentBlock = mesoRecord.blocks.find(
      (b) => absoluteWeek >= b.startWeek && absoluteWeek < b.startWeek + b.durationWeeks
    );
    currentBlockType = currentBlock?.blockType?.toLowerCase() ?? null;
  }

  // Sessions until deload: last week of meso is deload → accumulation sessions = (durationWeeks-1) * daysPerWeek
  const sessionsUntilDeload = mesoRecord
    ? Math.max(0, (mesoRecord.durationWeeks - 1) * daysPerWeek - mesoRecord.completedSessions)
    : 0;

  // Volume this week
  const weeklyVolume = await computeWeeklyMuscleVolume(userId, 1);
  const thisWeekMuscles = weeklyVolume[weeklyVolume.length - 1]?.muscles ?? {};

  const mesoLength = mesoRecord?.durationWeeks ?? 4;
  const isDeload = mesoRecord ? currentWeek >= mesoRecord.durationWeeks : false;

  const volumeThisWeek: ProgramVolumeRow[] = Object.entries(VOLUME_LANDMARKS)
    .map(([muscle, landmarks]) => {
      const data = thisWeekMuscles[muscle] ?? { directSets: 0, indirectSets: 0 };
      const target = computeWeeklyVolumeTarget(landmarks, currentWeek, mesoLength, isDeload);
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
    .filter((v) => v.mav > 0); // Only muscles the system tracks (mav > 0)

  // Recent workouts (last 10)
  const recentWorkouts = await prisma.workout.findMany({
    where: { userId },
    orderBy: { scheduledDate: "desc" },
    take: 10,
    select: {
      id: true,
      scheduledDate: true,
      completedAt: true,
      status: true,
      sessionIntent: true,
      advancesSplit: true,
    },
  });

  const deloadReadiness = mesoRecord
    ? computeDeloadReadiness(currentWeek, mesoRecord.durationWeeks, volumeThisWeek)
    : null;

  // Convert blocks to meso-relative 1-indexed weeks for the timeline
  const mesoBlocks: ProgramMesoBlock[] = mesoRecord?.blocks.map((b) => ({
    blockType: b.blockType.toLowerCase(),
    startWeek: b.startWeek - mesoRecord.startWeek + 1, // absolute → meso-relative 1-indexed
    durationWeeks: b.durationWeeks,
  })) ?? [];

  return {
    activeMeso: mesoRecord
      ? {
          mesoNumber: mesoRecord.mesoNumber,
          focus: mesoRecord.focus,
          durationWeeks: mesoRecord.durationWeeks,
          completedSessions: mesoRecord.completedSessions,
          volumeTarget: mesoRecord.volumeTarget.toLowerCase(),
          currentBlockType,
          blocks: mesoBlocks,
        }
      : null,
    currentWeek,
    sessionsUntilDeload,
    volumeThisWeek,
    deloadReadiness,
    capabilities,
    recentWorkouts: recentWorkouts.map((w) => ({
      id: w.id,
      scheduledDate: w.scheduledDate.toISOString(),
      completedAt: w.completedAt?.toISOString() ?? null,
      status: w.status.toLowerCase(),
      sessionIntent: w.sessionIntent?.toLowerCase() ?? null,
      advancesSplit: w.advancesSplit,
    })),
  };
}

export type CycleAnchorAction = "deload" | "extend_phase" | "skip_phase" | "reset";

/**
 * Apply a manual cycle-anchor action to the active mesocycle.
 *
 * - deload: Mark next session as deload by bumping completedSessions to the deload threshold
 * - extend_phase: Add +1 week to the current block
 * - skip_phase: Advance completedSessions by one full week (daysPerWeek sessions)
 * - reset: Reset completedSessions to 0
 *
 * All actions are reversible via reset.
 */
export async function applyCycleAnchor(userId: string, action: CycleAnchorAction): Promise<void> {
  const meso = await prisma.mesocycle.findFirst({
    where: { macroCycle: { userId }, isActive: true },
    select: { id: true, completedSessions: true, durationWeeks: true },
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
      // Jump completedSessions to the start of the deload week
      const deloadThreshold = (meso.durationWeeks - 1) * daysPerWeek;
      await prisma.mesocycle.update({
        where: { id: meso.id },
        data: { completedSessions: Math.max(meso.completedSessions, deloadThreshold) },
      });
      break;
    }
    case "extend_phase": {
      // Add +1 week to the meso duration so the current phase lasts one more week
      await prisma.mesocycle.update({
        where: { id: meso.id },
        data: { durationWeeks: meso.durationWeeks + 1 },
      });
      break;
    }
    case "skip_phase": {
      // Advance session count by one full week of training
      await prisma.mesocycle.update({
        where: { id: meso.id },
        data: { completedSessions: Math.min(meso.completedSessions + daysPerWeek, meso.durationWeeks * daysPerWeek) },
      });
      break;
    }
    case "reset": {
      await prisma.mesocycle.update({
        where: { id: meso.id },
        data: { completedSessions: 0 },
      });
      break;
    }
  }
}
