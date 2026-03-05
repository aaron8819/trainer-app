/**
 * Program dashboard data loader.
 * Shared by the API route and the server-component page to avoid HTTP round-trips.
 */

import { WorkoutStatus, WorkoutSessionIntent } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { VOLUME_LANDMARKS } from "@/lib/engine/volume-landmarks";
import { PERFORMED_WORKOUT_STATUSES } from "@/lib/workout-status";
import {
  getCurrentMesoWeek,
  getRirTarget,
  getWeeklyVolumeTarget,
} from "./mesocycle-lifecycle-math";
import { loadNextWorkoutContext } from "./next-session";

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
  excludedDuringDeload: boolean;
  minSingleMuscleDeficitSets: number;
  minTotalDeficitSets: number;
};

export type GapFillSupportData = {
  eligible: boolean;
  reason: string | null;
  anchorWeek: number | null;
  targetMuscles: string[];
  deficitSummary: GapFillDeficitRow[];
  alreadyUsedThisWeek: boolean;
  suppressedByStartedNextWeek: boolean;
  policy: {
    requiredSessionsPerWeek: number;
    maxOptionalGapFillSessionsPerWeek: number;
    maxGeneratedHardSets: number;
    maxGeneratedExercises: number;
  };
};

const DEFAULT_GAP_FILL_POLICY = {
  maxOptionalGapFillSessionsPerWeek: 1,
  maxGeneratedHardSets: 12,
  maxGeneratedExercises: 4,
  excludedDuringDeload: true,
  minSingleMuscleDeficitSets: 2,
  minTotalDeficitSets: 6,
} as const;

function toObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function toNumberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function deriveGapFillPolicy(input: {
  sessionsPerWeek: number;
  volumeRampConfig: unknown;
}): GapFillPolicy {
  const config = toObject(input.volumeRampConfig);
  const optionalSessions = toObject(config.optionalSessions);
  const gapFill = toObject(optionalSessions.gapFill);

  return {
    requiredSessionsPerWeek: input.sessionsPerWeek,
    maxOptionalGapFillSessionsPerWeek:
      toNumberOrUndefined(gapFill.maxOptionalGapFillSessionsPerWeek) ??
      DEFAULT_GAP_FILL_POLICY.maxOptionalGapFillSessionsPerWeek,
    maxGeneratedHardSets:
      toNumberOrUndefined(gapFill.maxGeneratedHardSets) ??
      DEFAULT_GAP_FILL_POLICY.maxGeneratedHardSets,
    maxGeneratedExercises:
      toNumberOrUndefined(gapFill.maxGeneratedExercises) ??
      DEFAULT_GAP_FILL_POLICY.maxGeneratedExercises,
    excludedDuringDeload:
      typeof gapFill.excludedDuringDeload === "boolean"
        ? gapFill.excludedDuringDeload
        : DEFAULT_GAP_FILL_POLICY.excludedDuringDeload,
    minSingleMuscleDeficitSets:
      toNumberOrUndefined(gapFill.minSingleMuscleDeficitSets) ??
      DEFAULT_GAP_FILL_POLICY.minSingleMuscleDeficitSets,
    minTotalDeficitSets:
      toNumberOrUndefined(gapFill.minTotalDeficitSets) ??
      DEFAULT_GAP_FILL_POLICY.minTotalDeficitSets,
  };
}

function emptyGapFillSupport(policy: GapFillPolicy, reason: string | null): GapFillSupportData {
  return {
    eligible: false,
    reason,
    anchorWeek: null,
    targetMuscles: [],
    deficitSummary: [],
    alreadyUsedThisWeek: false,
    suppressedByStartedNextWeek: false,
    policy: {
      requiredSessionsPerWeek: policy.requiredSessionsPerWeek,
      maxOptionalGapFillSessionsPerWeek: policy.maxOptionalGapFillSessionsPerWeek,
      maxGeneratedHardSets: policy.maxGeneratedHardSets,
      maxGeneratedExercises: policy.maxGeneratedExercises,
    },
  };
}

function hasOptionalGapFillReceiptMarker(selectionMetadata: unknown): boolean {
  const metadata = toObject(selectionMetadata);
  const receipt = toObject(metadata.sessionDecisionReceipt);
  const exceptions = Array.isArray(receipt.exceptions) ? receipt.exceptions : [];
  return exceptions.some((entry) => {
    const exception = toObject(entry);
    return exception.code === "optional_gap_fill";
  });
}

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

export function computeMesoWeekEnd(mesoWeekStart: Date): Date {
  const date = new Date(mesoWeekStart);
  date.setDate(date.getDate() + 7);
  return date;
}

async function loadMesoWeekMuscleVolume(
  userId: string,
  mesocycleId: string,
  mesoWeekStart: Date,
  mesoWeekEnd: Date
): Promise<Record<string, { directSets: number; indirectSets: number }>> {
  const workouts = await prisma.workout.findMany({
    where: {
      userId,
      mesocycleId,
      status: { in: [...PERFORMED_WORKOUT_STATUSES] as WorkoutStatus[] },
      scheduledDate: { gte: mesoWeekStart, lt: mesoWeekEnd },
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

async function loadGapFillSupport(userId: string): Promise<GapFillSupportData> {
  const activeMeso = await prisma.mesocycle.findFirst({
    where: { macroCycle: { userId }, isActive: true },
    select: {
      id: true,
      state: true,
      durationWeeks: true,
      volumeTarget: true,
      startWeek: true,
      sessionsPerWeek: true,
      accumulationSessionsCompleted: true,
      volumeRampConfig: true,
      macroCycle: { select: { startDate: true } },
    },
  });

  const fallbackPolicy = deriveGapFillPolicy({
    sessionsPerWeek: activeMeso?.sessionsPerWeek ?? 3,
    volumeRampConfig: activeMeso?.volumeRampConfig,
  });
  if (!activeMeso) {
    return emptyGapFillSupport(fallbackPolicy, "no_active_mesocycle");
  }

  const policy = deriveGapFillPolicy({
    sessionsPerWeek: activeMeso.sessionsPerWeek,
    volumeRampConfig: activeMeso.volumeRampConfig,
  });

  if (policy.excludedDuringDeload && activeMeso.state === "ACTIVE_DELOAD") {
    return emptyGapFillSupport(policy, "in_deload");
  }

  const anchorEligible =
    activeMeso.accumulationSessionsCompleted > 0 &&
    activeMeso.accumulationSessionsCompleted % activeMeso.sessionsPerWeek === 0;
  if (!anchorEligible) {
    return emptyGapFillSupport(policy, "not_end_of_required_rotation");
  }

  const anchorWeek = activeMeso.accumulationSessionsCompleted / activeMeso.sessionsPerWeek;
  const baseResponse: GapFillSupportData = {
    ...emptyGapFillSupport(policy, null),
    anchorWeek,
  };

  const startedIncomplete = await prisma.workout.findFirst({
    where: {
      userId,
      status: { in: ["IN_PROGRESS", "PARTIAL"] },
    },
    select: { id: true },
  });
  if (startedIncomplete) {
    return { ...baseResponse, reason: "started_incomplete_workout" };
  }

  const nextWeekStartedOrPerformedAdvancing = await prisma.workout.findFirst({
    where: {
      userId,
      mesocycleId: activeMeso.id,
      mesocycleWeekSnapshot: anchorWeek + 1,
      status: { in: ["IN_PROGRESS", "PARTIAL", ...PERFORMED_WORKOUT_STATUSES] as WorkoutStatus[] },
      advancesSplit: { not: false },
    },
    select: { id: true },
  });
  if (nextWeekStartedOrPerformedAdvancing) {
    return {
      ...baseResponse,
      reason: "started_next_week_advancing_workout",
      suppressedByStartedNextWeek: true,
    };
  }

  const candidateGapFillSessions = await prisma.workout.findMany({
    where: {
      userId,
      mesocycleId: activeMeso.id,
      mesocycleWeekSnapshot: anchorWeek,
      status: { in: [...PERFORMED_WORKOUT_STATUSES] as WorkoutStatus[] },
      selectionMode: "INTENT",
      sessionIntent: "BODY_PART",
      advancesSplit: false,
    },
    select: { selectionMetadata: true },
  });
  const performedGapFillCount = candidateGapFillSessions.filter((entry) =>
    hasOptionalGapFillReceiptMarker(entry.selectionMetadata)
  ).length;
  if (performedGapFillCount >= policy.maxOptionalGapFillSessionsPerWeek) {
    return {
      ...baseResponse,
      reason: "already_used_gap_fill",
      alreadyUsedThisWeek: true,
    };
  }

  const mesoStartDate = activeMeso.macroCycle?.startDate;
  if (!(mesoStartDate instanceof Date) || Number.isNaN(mesoStartDate.getTime())) {
    return { ...baseResponse, reason: "insufficient_week_scoping_data" };
  }
  const mesoStart = new Date(mesoStartDate);
  mesoStart.setDate(mesoStart.getDate() + activeMeso.startWeek * 7);
  const anchorWeekStart = computeMesoWeekStart(mesoStart, anchorWeek);
  const anchorWeekEnd = computeMesoWeekEnd(anchorWeekStart);
  const weekMuscles = await loadMesoWeekMuscleVolume(
    userId,
    activeMeso.id,
    anchorWeekStart,
    anchorWeekEnd
  );

  const researchBackedMuscles = [
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
  ];

  const deficits = researchBackedMuscles
    .map((muscle) => {
      const target = getWeeklyVolumeTarget(
        {
          durationWeeks: activeMeso.durationWeeks,
          sessionsPerWeek: activeMeso.sessionsPerWeek,
          volumeTarget: activeMeso.volumeTarget,
          accumulationSessionsCompleted: activeMeso.accumulationSessionsCompleted,
          id: activeMeso.id,
        },
        muscle,
        anchorWeek
      );
      const actual = weekMuscles[muscle]?.directSets ?? 0;
      const deficit = Math.max(0, target - actual);
      const deficitRatio = deficit / Math.max(target, 1);
      return { muscle, target, actual, deficit, deficitRatio };
    })
    .filter((row) => row.target > 0);

  const anyLargeDeficit = deficits.some((row) => row.deficit >= policy.minSingleMuscleDeficitSets);
  const totalDeficit = deficits.reduce((sum, row) => sum + row.deficit, 0);
  if (!anyLargeDeficit && totalDeficit < policy.minTotalDeficitSets) {
    return {
      ...baseResponse,
      reason: "deficit_below_threshold",
      deficitSummary: deficits
        .filter((row) => row.deficit > 0)
        .sort((a, b) => b.deficit - a.deficit)
        .map((row) => ({
          muscle: row.muscle,
          target: row.target,
          actual: row.actual,
          deficit: row.deficit,
        })),
    };
  }

  const sortedDeficits = deficits
    .filter((row) => row.deficit > 0)
    .sort((left, right) => {
      if (right.deficit !== left.deficit) {
        return right.deficit - left.deficit;
      }
      return right.deficitRatio - left.deficitRatio;
    });

  return {
    ...baseResponse,
    eligible: true,
    reason: null,
    targetMuscles: sortedDeficits.slice(0, 3).map((row) => row.muscle),
    deficitSummary: sortedDeficits.map((row) => ({
      muscle: row.muscle,
      target: row.target,
      actual: row.actual,
      deficit: row.deficit,
    })),
    alreadyUsedThisWeek: performedGapFillCount > 0,
  };
}

export async function loadHomeProgramSupport(userId: string): Promise<HomeProgramSupportData> {
  const [nextWorkoutContext, gapFill] = await Promise.all([
    loadNextWorkoutContext(userId),
    loadGapFillSupport(userId),
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

  let viewedWeekMuscles: Record<string, { directSets: number; indirectSets: number }> = {};
  let currentWeekMuscles: Record<string, { directSets: number; indirectSets: number }> = {};
  if (mesoRecord) {
    const mesoStart = new Date(mesoRecord.macroCycle.startDate);
    mesoStart.setDate(mesoStart.getDate() + mesoRecord.startWeek * 7);

    const viewedWeekStart = computeMesoWeekStart(mesoStart, effectiveViewWeek);
    const currentWeekStart = computeMesoWeekStart(mesoStart, currentWeek);
    viewedWeekMuscles = await loadMesoWeekMuscleVolume(
      userId,
      mesoRecord.id,
      viewedWeekStart,
      computeMesoWeekEnd(viewedWeekStart)
    );
    currentWeekMuscles =
      effectiveViewWeek === currentWeek
        ? viewedWeekMuscles
        : await loadMesoWeekMuscleVolume(
            userId,
            mesoRecord.id,
            currentWeekStart,
            computeMesoWeekEnd(currentWeekStart)
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
