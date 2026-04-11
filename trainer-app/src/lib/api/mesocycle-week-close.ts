import type {
  MesocyclePhase,
  MesocycleWeekCloseResolution,
  Prisma,
  WorkoutSelectionMode,
  WorkoutSessionIntent,
  WorkoutStatus,
} from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { buildSessionDecisionReceipt } from "@/lib/evidence/session-decision-receipt";
import type { CycleContextSnapshot } from "@/lib/evidence/types";
import {
  getExposedVolumeLandmarkEntries,
  normalizeExposedMuscle,
} from "@/lib/engine/volume-landmarks";
import {
  isCloseoutSession,
  isDismissedCloseoutSession,
} from "@/lib/session-semantics/closeout-classifier";
import {
  attachCloseoutDismissalMetadata,
  attachCloseoutSessionMetadata,
  buildCanonicalSelectionMetadata,
  readWeekCloseIdFromSelectionMetadata,
} from "@/lib/ui/selection-metadata";
import { resolvePhaseBlockProfile } from "./generation-phase-block-context";
import { getCurrentMesoWeek } from "./mesocycle-lifecycle-math";
import { getWeeklyVolumeTarget } from "./mesocycle-lifecycle-math";
import { transitionMesocycleStateInTransaction } from "./mesocycle-lifecycle-state";
import { loadMesocycleWeekMuscleVolume } from "./weekly-volume";

type Tx = Prisma.TransactionClient;

export type WeekClosePolicySnapshot = {
  requiredSessionsPerWeek: number;
  maxOptionalGapFillSessionsPerWeek: number;
  maxGeneratedHardSets: number;
  maxGeneratedExercises: number;
};

export type WeekCloseDeficitSnapshotMuscle = {
  muscle: string;
  target: number;
  actual: number;
  deficit: number;
};

export type WeekCloseWorkflowState = "PENDING_OPTIONAL_GAP_FILL" | "COMPLETED";
export type WeekCloseDeficitState = "OPEN" | "PARTIAL" | "CLOSED";

export type WeekCloseOutcomeSnapshot = {
  workflowState: WeekCloseWorkflowState;
  deficitState: WeekCloseDeficitState;
  remainingDeficitSets: number;
  remainingQualifyingMuscleCount: number;
  remainingTopTargetMuscles: string[];
  remainingMuscles: WeekCloseDeficitSnapshotMuscle[];
};

export type WeekCloseDeficitSnapshot = {
  version: 1;
  policy: WeekClosePolicySnapshot;
  summary: {
    totalDeficitSets: number;
    qualifyingMuscleCount: number;
    topTargetMuscles: string[];
  };
  muscles: WeekCloseDeficitSnapshotMuscle[];
  outcome?: WeekCloseOutcomeSnapshot;
};

export type WeekCloseDisplayState = WeekCloseOutcomeSnapshot;

export type PendingWeekCloseRecord = {
  id: string;
  mesocycleId: string;
  targetWeek: number;
  targetPhase: MesocyclePhase;
  status: "PENDING_OPTIONAL_GAP_FILL";
  resolution: null;
  deficitSnapshot: WeekCloseDeficitSnapshot | null;
  weekCloseState: WeekCloseDisplayState;
  optionalWorkout: {
    id: string;
    status: WorkoutStatus;
    scheduledDate: Date;
  } | null;
};

export type WeekCloseRecord = {
  id: string;
  mesocycleId: string;
  targetWeek: number;
  targetPhase: MesocyclePhase;
  status: "PENDING_OPTIONAL_GAP_FILL" | "RESOLVED";
  resolution: MesocycleWeekCloseResolution | null;
  deficitSnapshot: WeekCloseDeficitSnapshot | null;
  weekCloseState: WeekCloseDisplayState;
  optionalWorkout: {
    id: string;
    status: WorkoutStatus;
    scheduledDate: Date;
  } | null;
};

export type BoundaryWeekCloseMesocycle = {
  id: string;
  durationWeeks: number;
  sessionsPerWeek: number;
  startWeek: number;
  blocks?: Array<{
    blockType: string;
    startWeek: number;
    durationWeeks: number;
    volumeTarget: string;
    intensityBias: string;
  }>;
  macroCycle: {
    startDate: Date;
  };
};

const DEFAULT_POLICY: WeekClosePolicySnapshot = {
  requiredSessionsPerWeek: 3,
  maxOptionalGapFillSessionsPerWeek: 1,
  maxGeneratedHardSets: 12,
  maxGeneratedExercises: 4,
};

function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

function summarizeWeekCloseMuscles(muscles: WeekCloseDeficitSnapshotMuscle[]) {
  return {
    totalDeficitSets: roundToTenth(muscles.reduce((sum, row) => sum + row.deficit, 0)),
    qualifyingMuscleCount: muscles.length,
    topTargetMuscles: muscles.slice(0, 3).map((row) => row.muscle),
  };
}

function normalizeWeekCloseMuscleRows(
  muscles: WeekCloseDeficitSnapshotMuscle[]
): WeekCloseDeficitSnapshotMuscle[] {
  const merged = new Map<string, WeekCloseDeficitSnapshotMuscle>();

  for (const row of muscles) {
    const muscle = normalizeExposedMuscle(row.muscle);
    const existing = merged.get(muscle);
    if (existing) {
      existing.target = roundToTenth(existing.target + row.target);
      existing.actual = roundToTenth(existing.actual + row.actual);
      existing.deficit = roundToTenth(existing.deficit + row.deficit);
      continue;
    }

    merged.set(muscle, {
      muscle,
      target: roundToTenth(row.target),
      actual: roundToTenth(row.actual),
      deficit: roundToTenth(row.deficit),
    });
  }

  return Array.from(merged.values()).sort((left, right) => {
    if (right.deficit !== left.deficit) {
      return right.deficit - left.deficit;
    }
    return left.muscle.localeCompare(right.muscle);
  });
}

function normalizeWeekCloseDeficitSnapshot(
  snapshot: WeekCloseDeficitSnapshot
): WeekCloseDeficitSnapshot {
  const muscles = normalizeWeekCloseMuscleRows(snapshot.muscles);
  const summary = summarizeWeekCloseMuscles(muscles);

  const outcome = snapshot.outcome
    ? (() => {
        const remainingMuscles = normalizeWeekCloseMuscleRows(snapshot.outcome.remainingMuscles);
        const remainingSummary = summarizeWeekCloseMuscles(remainingMuscles);
        return {
          ...snapshot.outcome,
          deficitState: deriveWeekCloseDeficitState(snapshot.outcome.workflowState, {
            summary: remainingSummary,
            muscles: remainingMuscles,
          }),
          remainingDeficitSets: remainingSummary.totalDeficitSets,
          remainingQualifyingMuscleCount: remainingSummary.qualifyingMuscleCount,
          remainingTopTargetMuscles: remainingSummary.topTargetMuscles,
          remainingMuscles,
        } satisfies WeekCloseOutcomeSnapshot;
      })()
    : undefined;

  return {
    ...snapshot,
    summary,
    muscles,
    ...(outcome ? { outcome } : {}),
  };
}

function computeMesoWeekStart(input: {
  macroStartDate: Date;
  mesocycleStartWeek: number;
  targetWeek: number;
}): Date {
  const date = new Date(input.macroStartDate);
  date.setDate(date.getDate() + (input.mesocycleStartWeek + input.targetWeek - 1) * 7);
  return date;
}

function buildCloseoutCycleContext(input: {
  mesocycleStartWeek: number;
  mesocycleLength: number;
  mesocycleState: "ACTIVE_ACCUMULATION" | "ACTIVE_DELOAD" | "AWAITING_HANDOFF" | "COMPLETED";
  blocks: Array<{
    blockType: string;
    startWeek: number;
    durationWeeks: number;
  }>;
  targetWeek: number;
}): CycleContextSnapshot {
  const absoluteWeek = input.mesocycleStartWeek + input.targetWeek - 1;
  const hasMatchingBlock = input.blocks.some((candidate) => {
    const blockEndWeek = candidate.startWeek + candidate.durationWeeks;
    return absoluteWeek >= candidate.startWeek && absoluteWeek < blockEndWeek;
  });
  const phaseProfile = resolvePhaseBlockProfile({
    mesocycleStartWeek: input.mesocycleStartWeek,
    mesocycleLength: input.mesocycleLength,
    mesocycleState: input.mesocycleState,
    weekInMeso: input.targetWeek,
    blocks: input.blocks.map((block) => ({
      blockType: block.blockType.toLowerCase(),
      startWeek: block.startWeek,
      durationWeeks: block.durationWeeks,
    })),
  });

  return {
    weekInMeso: input.targetWeek,
    weekInBlock: phaseProfile.weekInBlock,
    blockDurationWeeks: phaseProfile.blockDurationWeeks,
    mesocycleLength: input.mesocycleLength,
    phase: phaseProfile.blockType,
    blockType: phaseProfile.blockType,
    isDeload: phaseProfile.isDeload,
    source: hasMatchingBlock ? "computed" : "fallback",
  };
}

function buildCloseoutSelectionMetadata(input: {
  cycleContext: CycleContextSnapshot;
  weekCloseId: string;
}) {
  return attachCloseoutSessionMetadata(
    buildCanonicalSelectionMetadata({
      weekCloseId: input.weekCloseId,
      sessionDecisionReceipt: buildSessionDecisionReceipt({
        cycleContext: input.cycleContext,
        sorenessSuppressedMuscles: [],
        deloadDecision: {
          mode: "none",
          reason: [],
          reductionPercent: 0,
          appliedTo: "none",
        },
        autoregulation: {
          wasAutoregulated: false,
          signalAgeHours: null,
          fatigueScoreOverall: null,
        },
      }),
    }),
    {
      enabled: true,
      weekCloseId: input.weekCloseId,
    }
  );
}

async function loadWeekMuscleVolume(tx: Tx, input: {
  userId: string;
  mesocycleId: string;
  targetWeek: number;
  weekStart: Date;
}): Promise<Record<string, number>> {
  const weeklyVolume = await loadMesocycleWeekMuscleVolume(tx, input);
  return Object.fromEntries(
    Object.entries(weeklyVolume).map(([muscle, row]) => [muscle, row.effectiveSets])
  );
}

function deriveWeekCloseDeficitState(
  workflowState: WeekCloseWorkflowState,
  snapshot: Pick<WeekCloseDeficitSnapshot, "summary" | "muscles">
): WeekCloseDeficitState {
  if (snapshot.summary.totalDeficitSets <= 0 || snapshot.muscles.length === 0) {
    return "CLOSED";
  }
  return workflowState === "PENDING_OPTIONAL_GAP_FILL" ? "OPEN" : "PARTIAL";
}

function buildWeekCloseOutcomeSnapshot(input: {
  workflowState: WeekCloseWorkflowState;
  snapshot: Pick<WeekCloseDeficitSnapshot, "summary" | "muscles">;
}): WeekCloseOutcomeSnapshot {
  return {
    workflowState: input.workflowState,
    deficitState: deriveWeekCloseDeficitState(input.workflowState, input.snapshot),
    remainingDeficitSets: input.snapshot.summary.totalDeficitSets,
    remainingQualifyingMuscleCount: input.snapshot.summary.qualifyingMuscleCount,
    remainingTopTargetMuscles: input.snapshot.summary.topTargetMuscles,
    remainingMuscles: input.snapshot.muscles,
  };
}

function withWeekCloseOutcome(
  snapshot: WeekCloseDeficitSnapshot,
  workflowState: WeekCloseWorkflowState,
  outcomeSource?: Pick<WeekCloseDeficitSnapshot, "summary" | "muscles">
): WeekCloseDeficitSnapshot {
  const source = outcomeSource ?? snapshot;
  return {
    ...snapshot,
    outcome: buildWeekCloseOutcomeSnapshot({
      workflowState,
      snapshot: source,
    }),
  };
}

export async function buildWeekCloseDeficitSnapshot(tx: Tx, input: {
  userId: string;
  mesocycle: BoundaryWeekCloseMesocycle;
  targetWeek: number;
  policy?: Partial<WeekClosePolicySnapshot>;
}): Promise<WeekCloseDeficitSnapshot> {
  const policy: WeekClosePolicySnapshot = {
    ...DEFAULT_POLICY,
    requiredSessionsPerWeek: Math.max(1, input.mesocycle.sessionsPerWeek),
    ...input.policy,
  };
  const weekStart = computeMesoWeekStart({
    macroStartDate: input.mesocycle.macroCycle.startDate,
    mesocycleStartWeek: input.mesocycle.startWeek,
    targetWeek: input.targetWeek,
  });
  const actualByMuscle = await loadWeekMuscleVolume(tx, {
    userId: input.userId,
    mesocycleId: input.mesocycle.id,
    targetWeek: input.targetWeek,
    weekStart,
  });

  const muscles = getExposedVolumeLandmarkEntries()
    .map(([muscle, landmarks]) => {
      const actual = actualByMuscle[muscle] ?? 0;
      const target = getWeeklyVolumeTarget(input.mesocycle, muscle, input.targetWeek);
      return {
        muscle,
        target,
        actual,
        deficit: Math.max(0, target - actual),
        mav: landmarks.mav,
      };
    })
    .filter((row) => row.mav > 0 && row.deficit > 0)
    .sort((left, right) => right.deficit - left.deficit)
    .map(({ muscle, target, actual, deficit }) => ({
      muscle,
      target,
      actual,
      deficit,
    }));

  return {
    version: 1,
    policy,
    summary: {
      totalDeficitSets: muscles.reduce((sum, row) => sum + row.deficit, 0),
      qualifyingMuscleCount: muscles.length,
      topTargetMuscles: muscles.slice(0, 3).map((row) => row.muscle),
    },
    muscles,
  };
}

export function isAccumulationWeekBoundary(input: {
  snapshotPhase: "ACCUMULATION" | "DELOAD";
  snapshotSession: number;
  sessionsPerWeek: number;
}): boolean {
  return (
    input.snapshotPhase === "ACCUMULATION" &&
    input.snapshotSession === Math.max(1, input.sessionsPerWeek)
  );
}

export async function evaluateWeekCloseAtBoundary(tx: Tx, input: {
  userId: string;
  mesocycle: BoundaryWeekCloseMesocycle;
  targetWeek: number;
  targetPhase?: MesocyclePhase;
  deficitSnapshot?: WeekCloseDeficitSnapshot;
}): Promise<{
  weekCloseId: string;
  status: "PENDING_OPTIONAL_GAP_FILL" | "RESOLVED";
  resolution: MesocycleWeekCloseResolution | null;
  deficitSnapshot: WeekCloseDeficitSnapshot;
  weekCloseState: WeekCloseDisplayState;
  advancedLifecycle: boolean;
}> {
  const existingPending = await tx.mesocycleWeekClose.findFirst({
    where: {
      mesocycleId: input.mesocycle.id,
      status: "PENDING_OPTIONAL_GAP_FILL",
      NOT: { targetWeek: input.targetWeek },
    },
    select: { id: true },
  });
  if (existingPending) {
    throw new Error("PENDING_WEEK_CLOSE_EXISTS");
  }

  const deficitSnapshot =
    input.deficitSnapshot ??
    await buildWeekCloseDeficitSnapshot(tx, {
      userId: input.userId,
      mesocycle: input.mesocycle,
      targetWeek: input.targetWeek,
    });

  const hasDeficits = deficitSnapshot.summary.qualifyingMuscleCount > 0;
  const snapshotWithOutcome = withWeekCloseOutcome(
    deficitSnapshot,
    hasDeficits ? "PENDING_OPTIONAL_GAP_FILL" : "COMPLETED"
  );
  const now = new Date();
  const row = await tx.mesocycleWeekClose.upsert({
    where: {
      mesocycleId_targetWeek: {
        mesocycleId: input.mesocycle.id,
        targetWeek: input.targetWeek,
      },
    },
    update: hasDeficits
      ? {
          targetPhase: input.targetPhase ?? "ACCUMULATION",
          status: "PENDING_OPTIONAL_GAP_FILL",
          resolution: null,
          deficitSnapshotJson: snapshotWithOutcome as Prisma.InputJsonValue,
          resolvedAt: null,
        }
      : {
          targetPhase: input.targetPhase ?? "ACCUMULATION",
          status: "RESOLVED",
          resolution: "NO_GAP_FILL_NEEDED",
          deficitSnapshotJson: snapshotWithOutcome as Prisma.InputJsonValue,
          resolvedAt: now,
        },
    create: {
      mesocycleId: input.mesocycle.id,
      targetWeek: input.targetWeek,
      targetPhase: input.targetPhase ?? "ACCUMULATION",
      status: hasDeficits ? "PENDING_OPTIONAL_GAP_FILL" : "RESOLVED",
      resolution: hasDeficits ? undefined : "NO_GAP_FILL_NEEDED",
      deficitSnapshotJson: snapshotWithOutcome as Prisma.InputJsonValue,
      resolvedAt: hasDeficits ? undefined : now,
    },
    select: {
      id: true,
      status: true,
      resolution: true,
    },
  });

  let advancedLifecycle = false;
  if (!hasDeficits) {
    const transition = await transitionMesocycleStateInTransaction(tx, input.mesocycle.id);
    advancedLifecycle = transition.advanced;
  }

  return {
    weekCloseId: row.id,
    status: row.status,
    resolution: row.resolution,
    deficitSnapshot: snapshotWithOutcome,
    weekCloseState: deriveWeekCloseDisplayState({
      status: row.status,
      resolution: row.resolution,
      deficitSnapshot: snapshotWithOutcome,
    }),
    advancedLifecycle,
  };
}

export async function findPendingWeekCloseForMesocycle(tx: Tx, mesocycleId: string) {
  return tx.mesocycleWeekClose.findFirst({
    where: {
      mesocycleId,
      status: "PENDING_OPTIONAL_GAP_FILL",
    },
    orderBy: { targetWeek: "asc" },
    select: {
      id: true,
      targetWeek: true,
      status: true,
      resolution: true,
      deficitSnapshotJson: true,
    },
  });
}

export function readWeekCloseDeficitSnapshot(value: unknown): WeekCloseDeficitSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const candidate = value as Partial<WeekCloseDeficitSnapshot>;
  if (candidate.version !== 1 || !candidate.policy || !candidate.summary || !Array.isArray(candidate.muscles)) {
    return null;
  }
  return normalizeWeekCloseDeficitSnapshot(candidate as WeekCloseDeficitSnapshot);
}

export function deriveWeekCloseDisplayState(input: {
  status: "PENDING_OPTIONAL_GAP_FILL" | "RESOLVED" | null | undefined;
  resolution: MesocycleWeekCloseResolution | null | undefined;
  deficitSnapshot: WeekCloseDeficitSnapshot | null | undefined;
}): WeekCloseDisplayState {
  const workflowState: WeekCloseWorkflowState =
    input.status === "PENDING_OPTIONAL_GAP_FILL" ? "PENDING_OPTIONAL_GAP_FILL" : "COMPLETED";
  if (input.deficitSnapshot?.outcome) {
    return input.deficitSnapshot.outcome;
  }

  if (input.deficitSnapshot) {
    if (workflowState === "COMPLETED" && input.resolution === "NO_GAP_FILL_NEEDED") {
      return buildWeekCloseOutcomeSnapshot({
        workflowState,
        snapshot: {
          summary: {
            totalDeficitSets: 0,
            qualifyingMuscleCount: 0,
            topTargetMuscles: [],
          },
          muscles: [],
        },
      });
    }
    return buildWeekCloseOutcomeSnapshot({
      workflowState,
      snapshot: input.deficitSnapshot,
    });
  }

  return {
    workflowState,
    deficitState:
      workflowState === "PENDING_OPTIONAL_GAP_FILL"
        ? "OPEN"
        : input.resolution === "NO_GAP_FILL_NEEDED"
        ? "CLOSED"
        : "PARTIAL",
    remainingDeficitSets: 0,
    remainingQualifyingMuscleCount: 0,
    remainingTopTargetMuscles: [],
    remainingMuscles: [],
  };
}

function mapWeekCloseRecord(row: {
  id: string;
  mesocycleId: string;
  targetWeek: number;
  targetPhase: MesocyclePhase;
  status: "PENDING_OPTIONAL_GAP_FILL" | "RESOLVED";
  resolution: MesocycleWeekCloseResolution | null;
  deficitSnapshotJson: unknown;
  optionalWorkout: {
    id: string;
    status: WorkoutStatus;
    scheduledDate: Date;
  } | null;
}): WeekCloseRecord {
  const deficitSnapshot = readWeekCloseDeficitSnapshot(row.deficitSnapshotJson);
  return {
    id: row.id,
    mesocycleId: row.mesocycleId,
    targetWeek: row.targetWeek,
    targetPhase: row.targetPhase,
    status: row.status,
    resolution: row.resolution,
    deficitSnapshot,
    weekCloseState: deriveWeekCloseDisplayState({
      status: row.status,
      resolution: row.resolution,
      deficitSnapshot,
    }),
    optionalWorkout: row.optionalWorkout,
  };
}

export async function findPendingWeekCloseForUser(input: {
  userId: string;
  weekCloseId?: string;
  mesocycleId?: string;
}): Promise<PendingWeekCloseRecord | null> {
  const row = await prisma.mesocycleWeekClose.findFirst({
    where: {
      id: input.weekCloseId,
      mesocycleId: input.mesocycleId,
      status: "PENDING_OPTIONAL_GAP_FILL",
      mesocycle: {
        macroCycle: {
          userId: input.userId,
        },
      },
    },
    orderBy: input.weekCloseId ? undefined : { targetWeek: "asc" },
    select: {
      id: true,
      mesocycleId: true,
      targetWeek: true,
      targetPhase: true,
      status: true,
      resolution: true,
      deficitSnapshotJson: true,
      optionalWorkout: {
        select: {
          id: true,
          status: true,
          scheduledDate: true,
        },
      },
    },
  });

  if (!row) {
    return null;
  }

  return mapWeekCloseRecord(row) as PendingWeekCloseRecord;
}

export async function findRelevantWeekCloseForUser(input: {
  userId: string;
  mesocycleId: string;
}): Promise<WeekCloseRecord | null> {
  const baseWhere = {
    mesocycleId: input.mesocycleId,
    mesocycle: {
      macroCycle: {
        userId: input.userId,
      },
    },
  } as const;

  const select = {
    id: true,
    mesocycleId: true,
    targetWeek: true,
    targetPhase: true,
    status: true,
    resolution: true,
    deficitSnapshotJson: true,
    optionalWorkout: {
      select: {
        id: true,
        status: true,
        scheduledDate: true,
      },
    },
  } as const;

  const pending = await prisma.mesocycleWeekClose.findFirst({
    where: {
      ...baseWhere,
      status: "PENDING_OPTIONAL_GAP_FILL",
    },
    orderBy: { targetWeek: "desc" },
    select,
  });
  if (pending) {
    return mapWeekCloseRecord(pending);
  }

  const resolved = await prisma.mesocycleWeekClose.findFirst({
    where: {
      ...baseWhere,
      status: "RESOLVED",
    },
    orderBy: [{ targetWeek: "desc" }, { resolvedAt: "desc" }],
    select,
  });
  if (!resolved) {
    return null;
  }

  const mapped = mapWeekCloseRecord(resolved);
  return mapped.weekCloseState.deficitState === "PARTIAL" ? mapped : null;
}

export type WeekCloseResolutionResult = {
  weekCloseId: string | null;
  status: "PENDING_OPTIONAL_GAP_FILL" | "RESOLVED" | null;
  resolution: MesocycleWeekCloseResolution | null;
  weekCloseState: WeekCloseDisplayState | null;
  advancedLifecycle: boolean;
  outcome: "resolved" | "already_resolved" | "not_found" | "not_applicable";
};

export type CreatedCloseoutWorkout = {
  id: string;
  userId: string;
  scheduledDate: Date;
  status: WorkoutStatus;
  selectionMode: WorkoutSelectionMode;
  sessionIntent: WorkoutSessionIntent | null;
  selectionMetadata: unknown;
  advancesSplit: boolean;
  mesocycleId: string | null;
  mesocycleWeekSnapshot: number | null;
  mesocyclePhaseSnapshot: MesocyclePhase | null;
  mesoSessionSnapshot: number | null;
  revision: number;
};

export type DismissedCloseoutWorkout = {
  id: string;
  status: WorkoutStatus;
  selectionMetadata: unknown;
  revision: number;
  outcome: "dismissed" | "already_dismissed";
};

export async function createCloseoutSessionForWeek(
  tx: Tx,
  input: {
    userId: string;
    weekCloseId: string;
  }
): Promise<CreatedCloseoutWorkout> {
  const weekClose = await tx.mesocycleWeekClose.findFirst({
    where: {
      id: input.weekCloseId,
      mesocycle: {
        macroCycle: {
          userId: input.userId,
        },
      },
    },
    select: {
      id: true,
      targetWeek: true,
      targetPhase: true,
      mesocycle: {
        select: {
          id: true,
          isActive: true,
          state: true,
          durationWeeks: true,
          accumulationSessionsCompleted: true,
          deloadSessionsCompleted: true,
          sessionsPerWeek: true,
          startWeek: true,
          blocks: {
            select: {
              blockType: true,
              startWeek: true,
              durationWeeks: true,
            },
          },
        },
      },
    },
  });

  if (!weekClose) {
    throw new Error("WEEK_CLOSE_NOT_FOUND");
  }

  const activeMesocycle = weekClose.mesocycle;
  if (!activeMesocycle.isActive || activeMesocycle.state !== "ACTIVE_ACCUMULATION") {
    throw new Error("CLOSEOUT_ACTIVE_MESOCYCLE_REQUIRED");
  }

  if (weekClose.targetPhase === "DELOAD") {
    throw new Error("CLOSEOUT_DELOAD_WEEK_FORBIDDEN");
  }

  const activeWeek = getCurrentMesoWeek({
    state: activeMesocycle.state,
    accumulationSessionsCompleted: activeMesocycle.accumulationSessionsCompleted,
    sessionsPerWeek: activeMesocycle.sessionsPerWeek,
    durationWeeks: activeMesocycle.durationWeeks,
  });
  const isSupportedCloseoutWeek =
    weekClose.targetWeek === activeWeek || weekClose.targetWeek === activeWeek - 1;
  if (!isSupportedCloseoutWeek) {
    throw new Error("CLOSEOUT_ACTIVE_WEEK_REQUIRED");
  }

  const cycleContext = buildCloseoutCycleContext({
    mesocycleStartWeek: activeMesocycle.startWeek ?? 0,
    mesocycleLength: activeMesocycle.durationWeeks,
    mesocycleState: activeMesocycle.state,
    blocks: activeMesocycle.blocks,
    targetWeek: weekClose.targetWeek,
  });
  if (cycleContext.isDeload) {
    throw new Error("CLOSEOUT_DELOAD_WEEK_FORBIDDEN");
  }

  const existingWorkouts = await tx.workout.findMany({
    where: {
      userId: input.userId,
      mesocycleId: activeMesocycle.id,
    },
    select: {
      id: true,
      mesocycleWeekSnapshot: true,
      selectionMetadata: true,
    },
  });
  const existingCloseout = existingWorkouts.find(
    (workout) =>
      isCloseoutSession(workout.selectionMetadata) &&
      (readWeekCloseIdFromSelectionMetadata(workout.selectionMetadata) === weekClose.id ||
        workout.mesocycleWeekSnapshot === weekClose.targetWeek)
  );
  if (existingCloseout) {
    throw new Error("CLOSEOUT_ALREADY_EXISTS_FOR_WEEK");
  }

  return tx.workout.create({
    data: {
      userId: input.userId,
      scheduledDate: new Date(),
      status: "PLANNED",
      selectionMode: "MANUAL",
      sessionIntent: null,
      selectionMetadata: buildCloseoutSelectionMetadata({
        cycleContext,
        weekCloseId: weekClose.id,
      }) as Prisma.InputJsonValue,
      advancesSplit: false,
      mesocycleId: activeMesocycle.id,
      mesocycleWeekSnapshot: weekClose.targetWeek,
      mesocyclePhaseSnapshot: "ACCUMULATION",
      mesoSessionSnapshot: Math.max(1, activeMesocycle.sessionsPerWeek) + 1,
    },
    select: {
      id: true,
      userId: true,
      scheduledDate: true,
      status: true,
      selectionMode: true,
      sessionIntent: true,
      selectionMetadata: true,
      advancesSplit: true,
      mesocycleId: true,
      mesocycleWeekSnapshot: true,
      mesocyclePhaseSnapshot: true,
      mesoSessionSnapshot: true,
      revision: true,
    },
  });
}

export async function dismissCloseoutSession(
  tx: Tx,
  input: {
    userId: string;
    workoutId: string;
  }
): Promise<DismissedCloseoutWorkout> {
  const workout = await tx.workout.findFirst({
    where: {
      id: input.workoutId,
      userId: input.userId,
    },
    select: {
      id: true,
      status: true,
      selectionMetadata: true,
      revision: true,
    },
  });

  if (!workout) {
    throw new Error("CLOSEOUT_WORKOUT_NOT_FOUND");
  }
  if (!isCloseoutSession(workout.selectionMetadata)) {
    throw new Error("CLOSEOUT_DISMISSAL_NOT_CLOSEOUT");
  }
  if (isDismissedCloseoutSession(workout.selectionMetadata)) {
    return {
      ...workout,
      outcome: "already_dismissed",
    };
  }
  if (workout.status !== "PLANNED") {
    throw new Error("CLOSEOUT_DISMISSAL_REQUIRES_PLANNED");
  }

  const selectionMetadata = attachCloseoutDismissalMetadata(workout.selectionMetadata);
  const updated = await tx.workout.update({
    where: { id: workout.id },
    data: {
      selectionMetadata: selectionMetadata as Prisma.InputJsonValue,
      revision: { increment: 1 },
    },
    select: {
      id: true,
      status: true,
      selectionMetadata: true,
      revision: true,
    },
  });

  return {
    ...updated,
    outcome: "dismissed",
  };
}

async function resolveWeekCloseIfPending(
  tx: Tx,
  input: {
    weekCloseId: string;
    resolution: MesocycleWeekCloseResolution;
    throwIfAlreadyResolved?: boolean;
    deficitSnapshot?: WeekCloseDeficitSnapshot | null;
  }
): Promise<WeekCloseResolutionResult> {
  const existing = await tx.mesocycleWeekClose.findUnique({
    where: { id: input.weekCloseId },
    select: {
      id: true,
      mesocycleId: true,
      status: true,
      resolution: true,
      targetWeek: true,
      targetPhase: true,
      deficitSnapshotJson: true,
    },
  });

  if (!existing) {
    return {
      weekCloseId: null,
      status: null,
      resolution: null,
      weekCloseState: null,
      advancedLifecycle: false,
      outcome: "not_found",
    };
  }

  if (existing.status !== "PENDING_OPTIONAL_GAP_FILL") {
    if (input.throwIfAlreadyResolved) {
      throw new Error("WEEK_CLOSE_NOT_PENDING");
    }
    return {
      weekCloseId: existing.id,
      status: existing.status,
      resolution: existing.resolution,
      weekCloseState: deriveWeekCloseDisplayState({
        status: existing.status,
        resolution: existing.resolution,
        deficitSnapshot: readWeekCloseDeficitSnapshot(existing.deficitSnapshotJson),
      }),
      advancedLifecycle: false,
      outcome: "already_resolved",
    };
  }

  const existingSnapshot = readWeekCloseDeficitSnapshot(existing.deficitSnapshotJson);
  const resolvedSnapshot =
    input.deficitSnapshot ??
    (existingSnapshot ? withWeekCloseOutcome(existingSnapshot, "COMPLETED") : null);
  const resolvedAt = new Date();
  const updateResult = await tx.mesocycleWeekClose.updateMany({
    where: {
      id: existing.id,
      status: "PENDING_OPTIONAL_GAP_FILL",
    },
    data: {
      status: "RESOLVED",
      resolution: input.resolution,
      resolvedAt,
      ...(resolvedSnapshot
        ? { deficitSnapshotJson: resolvedSnapshot as Prisma.InputJsonValue }
        : {}),
    },
  });

  if (updateResult.count !== 1) {
    const current = await tx.mesocycleWeekClose.findUnique({
      where: { id: existing.id },
      select: {
        id: true,
        status: true,
        resolution: true,
        deficitSnapshotJson: true,
      },
    });

    if (current?.status !== "PENDING_OPTIONAL_GAP_FILL") {
      if (input.throwIfAlreadyResolved) {
        throw new Error("WEEK_CLOSE_NOT_PENDING");
      }
      return {
        weekCloseId: current?.id ?? existing.id,
        status: current?.status ?? null,
        resolution: current?.resolution ?? null,
        weekCloseState: deriveWeekCloseDisplayState({
          status: current?.status ?? null,
          resolution: current?.resolution ?? null,
          deficitSnapshot: readWeekCloseDeficitSnapshot(current?.deficitSnapshotJson),
        }),
        advancedLifecycle: false,
        outcome: current ? "already_resolved" : "not_found",
      };
    }
  }

  const transition = await transitionMesocycleStateInTransaction(tx, existing.mesocycleId);
  return {
    weekCloseId: existing.id,
    status: "RESOLVED",
    resolution: input.resolution,
    weekCloseState: deriveWeekCloseDisplayState({
      status: "RESOLVED",
      resolution: input.resolution,
      deficitSnapshot: resolvedSnapshot,
    }),
    advancedLifecycle: transition.advanced,
    outcome: "resolved",
  };
}

export async function linkOptionalWorkoutToWeekClose(
  tx: Tx,
  input: {
    weekCloseId: string;
    workoutId: string;
  }
): Promise<"linked" | "already_linked" | "not_found" | "not_pending" | "conflict"> {
  const updateResult = await tx.mesocycleWeekClose.updateMany({
    where: {
      id: input.weekCloseId,
      status: "PENDING_OPTIONAL_GAP_FILL",
      OR: [
        { optionalWorkoutId: null },
        { optionalWorkoutId: input.workoutId },
      ],
    },
    data: {
      optionalWorkoutId: input.workoutId,
    },
  });

  if (updateResult.count === 1) {
    return "linked";
  }

  const existing = await tx.mesocycleWeekClose.findUnique({
    where: { id: input.weekCloseId },
    select: {
      status: true,
      optionalWorkoutId: true,
    },
  });

  if (!existing) {
    return "not_found";
  }
  if (existing.status !== "PENDING_OPTIONAL_GAP_FILL") {
    return "not_pending";
  }
  if (existing.optionalWorkoutId === input.workoutId) {
    return "already_linked";
  }
  return "conflict";
}

export async function resolveWeekCloseOnOptionalGapFillCompletion(
  tx: Tx,
  input: {
    workoutId: string;
    weekCloseId?: string;
  }
): Promise<WeekCloseResolutionResult> {
  const linked =
    input.weekCloseId
      ? await tx.mesocycleWeekClose.findUnique({
          where: { id: input.weekCloseId },
          select: {
            id: true,
            optionalWorkoutId: true,
            targetWeek: true,
            targetPhase: true,
            deficitSnapshotJson: true,
            mesocycle: {
              select: {
                id: true,
                durationWeeks: true,
                sessionsPerWeek: true,
                startWeek: true,
                macroCycle: {
                  select: {
                    startDate: true,
                    userId: true,
                  },
                },
              },
            },
          },
        })
      : await tx.mesocycleWeekClose.findFirst({
          where: { optionalWorkoutId: input.workoutId },
          select: {
            id: true,
            optionalWorkoutId: true,
            targetWeek: true,
            targetPhase: true,
            deficitSnapshotJson: true,
            mesocycle: {
              select: {
                id: true,
                durationWeeks: true,
                sessionsPerWeek: true,
                startWeek: true,
                macroCycle: {
                  select: {
                    startDate: true,
                    userId: true,
                  },
                },
              },
            },
          },
        });

  if (!linked?.id) {
    return {
      weekCloseId: null,
      status: null,
      resolution: null,
      weekCloseState: null,
      advancedLifecycle: false,
      outcome: "not_found",
    };
  }

  if (!linked.optionalWorkoutId) {
    const linkResult = await linkOptionalWorkoutToWeekClose(tx, {
      weekCloseId: linked.id,
      workoutId: input.workoutId,
    });
    if (linkResult === "conflict") {
      throw new Error("WEEK_CLOSE_OPTIONAL_WORKOUT_CONFLICT");
    }
  } else if (linked.optionalWorkoutId !== input.workoutId) {
    return {
      weekCloseId: linked.id,
      status: null,
      resolution: null,
      weekCloseState: null,
      advancedLifecycle: false,
      outcome: "not_applicable",
    };
  }

  const persistedSnapshot = readWeekCloseDeficitSnapshot(linked.deficitSnapshotJson);
  const recomputedSnapshot = await buildWeekCloseDeficitSnapshot(tx, {
    userId: linked.mesocycle.macroCycle.userId,
    mesocycle: {
      id: linked.mesocycle.id,
      durationWeeks: linked.mesocycle.durationWeeks,
      sessionsPerWeek: linked.mesocycle.sessionsPerWeek,
      startWeek: linked.mesocycle.startWeek ?? 0,
      macroCycle: {
        startDate: linked.mesocycle.macroCycle.startDate,
      },
    },
    targetWeek: linked.targetWeek,
    policy: persistedSnapshot?.policy,
  });
  const resolvedSnapshot = withWeekCloseOutcome(
    persistedSnapshot ?? recomputedSnapshot,
    "COMPLETED",
    recomputedSnapshot
  );

  return resolveWeekCloseIfPending(tx, {
    weekCloseId: linked.id,
    resolution: "GAP_FILL_COMPLETED",
    throwIfAlreadyResolved: true,
    deficitSnapshot: resolvedSnapshot,
  });
}

export async function dismissPendingWeekClose(
  tx: Tx,
  input: {
    weekCloseId: string;
  }
): Promise<WeekCloseResolutionResult> {
  return resolveWeekCloseIfPending(tx, {
    weekCloseId: input.weekCloseId,
    resolution: "GAP_FILL_DISMISSED",
  });
}

export async function autoDismissPendingWeekCloseOnForwardProgress(
  tx: Tx,
  input: {
    mesocycleId: string;
    workoutWeek: number | null | undefined;
  }
): Promise<WeekCloseResolutionResult> {
  if (input.workoutWeek == null) {
    return {
      weekCloseId: null,
      status: null,
      resolution: null,
      weekCloseState: null,
      advancedLifecycle: false,
      outcome: "not_applicable",
    };
  }

  const pending = await findPendingWeekCloseForMesocycle(tx, input.mesocycleId);
  if (!pending || input.workoutWeek <= pending.targetWeek) {
    const pendingSnapshot = readWeekCloseDeficitSnapshot(pending?.deficitSnapshotJson);
    return {
      weekCloseId: pending?.id ?? null,
      status: pending?.status ?? null,
      resolution: pending?.resolution ?? null,
      weekCloseState: pending
        ? deriveWeekCloseDisplayState({
            status: pending.status,
            resolution: pending.resolution,
            deficitSnapshot: pendingSnapshot,
          })
        : null,
      advancedLifecycle: false,
      outcome: pending ? "not_applicable" : "not_found",
    };
  }

  return resolveWeekCloseIfPending(tx, {
    weekCloseId: pending.id,
    resolution: "AUTO_DISMISSED",
  });
}
