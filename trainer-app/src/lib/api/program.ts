/**
 * Program Dashboard data loader.
 * Shared by the API route and the server-component page to avoid HTTP round-trips.
 */

import { prisma } from "@/lib/db/prisma";
import { VOLUME_LANDMARKS, computeWeeklyVolumeTarget } from "@/lib/engine/volume-landmarks";
import { getCurrentMesoWeek, getRirTarget } from "./mesocycle-lifecycle";
import { WorkoutStatus, WorkoutSessionIntent } from "@prisma/client";
import { PERFORMED_WORKOUT_STATUSES } from "@/lib/workout-status";

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

export type NextSessionData = {
  /** Lowercase session intent, e.g. "push". Null when no schedule configured. */
  intent: string | null;
  /** ID of the existing incomplete workout, or null when rotation-derived. */
  workoutId: string | null;
  /** True when an existing IN_PROGRESS / PARTIAL / PLANNED workout was found. */
  isExisting: boolean;
};

export type ProgramDashboardData = {
  activeMeso: ProgramMesoSummary | null;
  currentWeek: number;
  /** The week whose volume data is shown. Equals currentWeek unless a historical week is requested. */
  viewedWeek: number;
  sessionsUntilDeload: number;
  daysPerWeek: number;
  /** Backward-compat alias for nextSession.intent. */
  nextSessionIntent: string | null;
  nextSession: NextSessionData;
  lastSessionSkipped: boolean;
  latestIncomplete: { id: string; status: string } | null;
  volumeThisWeek: ProgramVolumeRow[];
  recentWorkouts: ProgramRecentWorkout[];
  deloadReadiness: DeloadReadiness | null;
  rirTarget: { min: number; max: number } | null;
  capabilities: CapabilityFlags;
  coachingCue: string;
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
      accumulationSessionsCompleted: true,
      sessionsPerWeek: true,
      state: true,
      startWeek: true,
      blocks: { orderBy: { blockNumber: "asc" }, select: { blockType: true, startWeek: true, durationWeeks: true } },
      macroCycle: { select: { startDate: true } },
    },
  });

  if (!meso) return null;

  const weekInMeso = getCurrentMesoWeek(meso);

  const weekIndex = meso.startWeek + weekInMeso - 1; // absolute 0-indexed
  const currentBlock = meso.blocks.find(
    (b) => weekIndex >= b.startWeek && weekIndex < b.startWeek + b.durationWeeks
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

/**
 * Returns the Date on which the given meso week starts.
 * mesoStartDate is the first day of the mesocycle (week 1, day 1).
 * currentWeek is 1-indexed.
 */
export function computeMesoWeekStart(mesoStartDate: Date, currentWeek: number): Date {
  const d = new Date(mesoStartDate);
  d.setDate(d.getDate() + (currentWeek - 1) * 7);
  return d;
}

/**
 * Load direct + indirect set counts per muscle for all performed workouts
 * in the given mesocycle that fall on or after mesoWeekStart.
 * Uses the same set-counting semantics as analytics.ts (non-skipped logs).
 */
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
    for (const we of workout.exercises) {
      const completedSets = we.sets.filter(
        (s) => s.logs.length > 0 && !s.logs[0].wasSkipped
      ).length;
      if (completedSets === 0) continue;

      const primaryMuscles = we.exercise.exerciseMuscles
        .filter((m) => m.role === "PRIMARY")
        .map((m) => m.muscle.name);
      const secondaryMuscles = we.exercise.exerciseMuscles
        .filter((m) => m.role === "SECONDARY")
        .map((m) => m.muscle.name);

      for (const muscle of primaryMuscles) {
        if (!muscles[muscle]) muscles[muscle] = { directSets: 0, indirectSets: 0 };
        muscles[muscle].directSets += completedSets;
      }
      for (const muscle of secondaryMuscles) {
        if (!muscles[muscle]) muscles[muscle] = { directSets: 0, indirectSets: 0 };
        muscles[muscle].indirectSets += completedSets;
      }
    }
  }
  return muscles;
}

export async function loadProgramDashboardData(
  userId: string,
  viewWeek?: number
): Promise<ProgramDashboardData> {
  const capabilities = await loadCapabilityFlags(userId);
  // Load active mesocycle with blocks + macro start date
  const mesoRecord = await prisma.mesocycle.findFirst({
    where: { macroCycle: { userId }, isActive: true },
    select: {
      id: true,
      mesoNumber: true,
      focus: true,
      durationWeeks: true,
      completedSessions: true,
      accumulationSessionsCompleted: true,
      sessionsPerWeek: true,
      volumeTarget: true,
      startWeek: true,
      state: true,
      rirBandConfig: true,
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
    select: { daysPerWeek: true, weeklySchedule: true },
  });
  const daysPerWeek = constraints?.daysPerWeek ?? 3;
  const weeklySchedule = (constraints?.weeklySchedule ?? []).map((intent) =>
    (intent as string).toLowerCase()
  );
  const completedSessions = mesoRecord?.completedSessions ?? 0;

  // N1/N2/N3: Priority-aware incomplete workout query.
  // Serves both the Next Session card (intent) and the Resume Workout card (id/status).
  // Priority: IN_PROGRESS (0) → PARTIAL (1) → PLANNED (2), then scheduledDate asc.
  const rawIncomplete = await prisma.workout.findMany({
    where: { userId, status: { in: ["IN_PROGRESS", "PARTIAL", "PLANNED"] as WorkoutStatus[] } },
    orderBy: { scheduledDate: "asc" },
    take: 20,
    select: { id: true, sessionIntent: true, status: true, scheduledDate: true },
  });

  const STATUS_PRIORITY: Record<string, number> = { IN_PROGRESS: 0, PARTIAL: 1, PLANNED: 2 };
  const sortedIncomplete = [...rawIncomplete].sort((a, b) => {
    const pa = STATUS_PRIORITY[a.status] ?? 3;
    const pb = STATUS_PRIORITY[b.status] ?? 3;
    if (pa !== pb) return pa - pb;
    return a.scheduledDate.getTime() - b.scheduledDate.getTime();
  });
  const topIncomplete = sortedIncomplete[0] ?? null;

  // Derive next session: existing incomplete workout takes precedence over rotation.
  let nextSession: NextSessionData;
  if (topIncomplete) {
    nextSession = {
      intent: topIncomplete.sessionIntent?.toLowerCase() ?? null,
      workoutId: topIncomplete.id,
      isExisting: true,
    };
  } else {
    nextSession = {
      intent:
        weeklySchedule.length > 0
          ? weeklySchedule[completedSessions % weeklySchedule.length]
          : null,
      workoutId: null,
      isExisting: false,
    };
  }
  const nextSessionIntent = nextSession.intent; // backward-compat alias

  const latestIncomplete = topIncomplete
    ? { id: topIncomplete.id, status: topIncomplete.status.toLowerCase() }
    : null;

  // N4: Detect a stalled rotation (last workout for this intent was SKIPPED).
  // Only applies when the intent comes from the rotation (no existing incomplete workout).
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

  // Compute current week (1-indexed) using the lifecycle counter as canonical source.
  // getCurrentMesoWeek uses accumulationSessionsCompleted / sessionsPerWeek and has no
  // calendar guard, so it reflects the actual session progression without date skew.
  let currentWeek = 1;
  if (mesoRecord) {
    currentWeek = getCurrentMesoWeek(mesoRecord);
  }

  // Effective week for volume/RIR display — clamped to [1, durationWeeks].
  // Defaults to currentWeek; overridden by caller when navigating historical weeks.
  const effectiveViewWeek = mesoRecord
    ? Math.max(1, Math.min(viewWeek ?? currentWeek, mesoRecord.durationWeeks))
    : 1;

  // Find current block type (blocks use absolute startWeek within macro)
  let currentBlockType: string | null = null;
  if (mesoRecord) {
    const absoluteWeek = mesoRecord.startWeek + currentWeek - 1;
    const currentBlock = mesoRecord.blocks.find(
      (b) => absoluteWeek >= b.startWeek && absoluteWeek < b.startWeek + b.durationWeeks
    );
    currentBlockType = currentBlock?.blockType?.toLowerCase() ?? null;
  }

  // Sessions until deload: last week of meso is deload → accumulation sessions = (durationWeeks-1) * sessionsPerWeek.
  // Use accumulationSessionsCompleted (lifecycle counter) not completedSessions (may diverge via manual imports).
  const sessionsUntilDeload = mesoRecord
    ? Math.max(0, (mesoRecord.durationWeeks - 1) * mesoRecord.sessionsPerWeek - mesoRecord.accumulationSessionsCompleted)
    : 0;

  // Volume for the viewed week — scoped to the viewed meso week's date window, not ISO calendar week.
  // When navigating historical weeks, effectiveViewWeek may differ from currentWeek.
  let thisWeekMuscles: Record<string, { directSets: number; indirectSets: number }> = {};
  if (mesoRecord) {
    const mesoStart = new Date(mesoRecord.macroCycle.startDate);
    mesoStart.setDate(mesoStart.getDate() + mesoRecord.startWeek * 7);
    const mesoWeekStart = computeMesoWeekStart(mesoStart, effectiveViewWeek);
    thisWeekMuscles = await loadMesoWeekMuscleVolume(userId, mesoRecord.id, mesoWeekStart);
  }

  const mesoLength = mesoRecord?.durationWeeks ?? 4;
  // isDeload is true only when the viewed week IS the deload week (last week of meso).
  // Using the viewed week (not meso state) so historical accumulation weeks show ramp targets.
  const isDeload = effectiveViewWeek >= mesoLength;

  // Only display muscles with research-backed MEV/MAV landmarks (Israetel RP model).
  // The remaining muscles in VOLUME_LANDMARKS (Core, Lower Back, Forearms, etc.) are
  // retained for engine use (indirect volume counting) but excluded from the dashboard.
  const RESEARCH_BACKED_MUSCLES = new Set([
    "Chest", "Lats", "Upper Back",
    "Front Delts", "Side Delts", "Rear Delts",
    "Quads", "Hamstrings", "Glutes",
    "Biceps", "Triceps", "Calves",
  ]);

  const volumeThisWeek: ProgramVolumeRow[] = Object.entries(VOLUME_LANDMARKS)
    .filter(([muscle]) => RESEARCH_BACKED_MUSCLES.has(muscle))
    .map(([muscle, landmarks]) => {
      const data = thisWeekMuscles[muscle] ?? { directSets: 0, indirectSets: 0 };
      const target = computeWeeklyVolumeTarget(landmarks, effectiveViewWeek, mesoLength, isDeload);
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
    // Show muscles that are tracked (mav > 0) AND have a programmed target this week OR logged sets.
    // MEV=0 is valid (e.g., Glutes trained indirectly via squat/RDL) — do not filter on MEV alone.
    .filter((v) => v.mav > 0 && (v.target > 0 || v.directSets > 0))
    // Sort most-lagging first (lowest ratio of sets completed vs weekly target)
    .sort((a, b) => {
      const ratioA = a.target === 0 ? 0 : a.directSets / a.target;
      const ratioB = b.target === 0 ? 0 : b.directSets / b.target;
      return ratioA - ratioB;
    });

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

  const rirTarget = mesoRecord ? getRirTarget(mesoRecord, effectiveViewWeek) : null;

  // deloadReadiness is always anchored to currentWeek (live state, not historical view)
  const deloadReadiness = mesoRecord
    ? computeDeloadReadiness(currentWeek, mesoRecord.durationWeeks, volumeThisWeek)
    : null;

  // Convert blocks to meso-relative 1-indexed weeks for the timeline
  const mesoBlocks: ProgramMesoBlock[] = mesoRecord?.blocks.map((b) => ({
    blockType: b.blockType.toLowerCase(),
    startWeek: b.startWeek - mesoRecord.startWeek + 1, // absolute → meso-relative 1-indexed
    durationWeeks: b.durationWeeks,
  })) ?? [];

  const blockTypeForCue = currentBlockType ?? "accumulation";

  return {
    activeMeso: mesoRecord
      ? {
          mesoNumber: mesoRecord.mesoNumber,
          focus: mesoRecord.focus,
          durationWeeks: mesoRecord.durationWeeks,
          // Use accumulationSessionsCompleted: the canonical lifecycle counter.
          // completedSessions may diverge from it when workouts are imported manually.
          completedSessions: mesoRecord.accumulationSessionsCompleted,
          volumeTarget: mesoRecord.volumeTarget.toLowerCase(),
          currentBlockType,
          blocks: mesoBlocks,
        }
      : null,
    currentWeek,
    viewedWeek: effectiveViewWeek,
    sessionsUntilDeload,
    daysPerWeek,
    nextSessionIntent,
    nextSession,
    lastSessionSkipped,
    latestIncomplete,
    volumeThisWeek,
    deloadReadiness,
    rirTarget,
    capabilities,
    coachingCue: BLOCK_COACHING_CUES[blockTypeForCue] ?? BLOCK_COACHING_CUES.accumulation,
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
 * - skip_phase: Mark a session as skipped — neither counter increments (skipped ≠ performed)
 * - reset: Reset completedSessions to 0
 *
 * All actions are reversible via reset.
 */
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
      // Jump both counters to the start of the deload week atomically
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
      // Add +1 week to the meso duration so the current phase lasts one more week
      await prisma.mesocycle.update({
        where: { id: meso.id },
        data: { durationWeeks: meso.durationWeeks + 1 },
      });
      break;
    }
    case "skip_phase": {
      // A skipped session is not a performed session — neither counter increments.
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
