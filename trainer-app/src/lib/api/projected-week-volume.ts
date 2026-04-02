import type { Prisma } from "@prisma/client";
import { WorkoutStatus } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getExposedVolumeLandmarkEntries } from "@/lib/engine/volume-landmarks";
import type { SessionIntent } from "@/lib/engine/session-types";
import type { WorkoutPlan } from "@/lib/engine/types";
import { readSessionSlotSnapshot } from "@/lib/evidence/session-decision-receipt";
import { deriveSessionSemantics } from "@/lib/session-semantics/derive-session-semantics";
import { PERFORMED_WORKOUT_STATUSES } from "@/lib/workout-status";
import {
  buildRemainingFutureSlotsFromRuntime,
  deriveNextRuntimeSlotSession,
} from "./mesocycle-slot-runtime";
import { deriveCurrentMesocycleSession, getWeeklyVolumeTarget } from "./mesocycle-lifecycle";
import { loadNextWorkoutContext } from "./next-session";
import {
  appendWorkoutHistoryEntryToMappedContext,
  buildMappedGenerationContextFromSnapshot,
  buildProjectedWorkoutHistoryEntry,
  computeWorkoutContributionByMuscle,
  generateProjectedSession,
  listWorkoutExerciseNames,
  loadPreloadedGenerationSnapshot,
} from "./projected-week-volume-shared";
import { loadMesocycleWeekMuscleVolume } from "./weekly-volume";

type ProjectedWeekVolumeByMuscle = {
  directSets: number;
  indirectSets: number;
  effectiveSets: number;
};

export type ProjectedWeekVolumeSessionSummary = {
  slotId: string | null;
  intent: string;
  isNext: boolean;
  exerciseCount: number;
  totalSets: number;
  projectedContributionByMuscle: Record<string, number>;
};

export type ProjectedWeekVolumeMuscleRow = {
  muscle: string;
  completedEffectiveSets: number;
  projectedNextSessionEffectiveSets: number;
  projectedRemainingWeekEffectiveSets: number;
  projectedFullWeekEffectiveSets: number;
  weeklyTarget: number;
  mev: number;
  mav: number;
  deltaToTarget: number;
  deltaToMev: number;
  deltaToMav: number;
};

export type ProjectedWeekVolumeReport = {
  currentWeek: {
    mesocycleId: string;
    week: number;
    phase: string;
    blockType: string | null;
  };
  projectionNotes: string[];
  completedVolumeByMuscle: Record<string, ProjectedWeekVolumeByMuscle>;
  projectedSessions: ProjectedWeekVolumeSessionSummary[];
  fullWeekByMuscle: ProjectedWeekVolumeMuscleRow[];
};

type ActiveMesocycleForProjection = Prisma.MesocycleGetPayload<{
  include: {
    blocks: true;
    macroCycle: {
      select: {
        startDate: true;
      };
    };
  };
}>;

function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

function computeMesoWeekStartDate(mesoStartDate: Date, week: number): Date {
  const date = new Date(mesoStartDate);
  date.setDate(date.getDate() + (week - 1) * 7);
  return date;
}

function countWorkoutExercises(workout: WorkoutPlan): number {
  return workout.mainLifts.length + workout.accessories.length;
}

function countWorkoutSets(workout: WorkoutPlan): number {
  return [...workout.mainLifts, ...workout.accessories].reduce(
    (sum, exercise) => sum + exercise.sets.length,
    0
  );
}

function toProjectedWeekVolumeByMuscle(
  rows: Awaited<ReturnType<typeof loadMesocycleWeekMuscleVolume>>
): Record<string, ProjectedWeekVolumeByMuscle> {
  return Object.fromEntries(
    Object.entries(rows).map(([muscle, row]) => [
      muscle,
      {
        directSets: row.directSets,
        indirectSets: row.indirectSets,
        effectiveSets: row.effectiveSets,
      },
    ])
  );
}

function mergeContributionTotals(
  totals: Map<string, number>,
  contribution: Record<string, number>
): void {
  for (const [muscle, effectiveSets] of Object.entries(contribution)) {
    totals.set(muscle, roundToTenth((totals.get(muscle) ?? 0) + effectiveSets));
  }
}

function buildFullWeekRows(input: {
  activeMesocycle: NonNullable<ActiveMesocycleForProjection>;
  week: number;
  completedVolumeByMuscle: Record<string, ProjectedWeekVolumeByMuscle>;
  projectedSessions: ProjectedWeekVolumeSessionSummary[];
}): ProjectedWeekVolumeMuscleRow[] {
  const nextSessionContribution = new Map<string, number>(
    Object.entries(input.projectedSessions[0]?.projectedContributionByMuscle ?? {})
  );
  const remainingWeekContribution = new Map<string, number>();
  const totalProjectedContribution = new Map<string, number>();

  for (const [index, session] of input.projectedSessions.entries()) {
    mergeContributionTotals(totalProjectedContribution, session.projectedContributionByMuscle);
    if (index === 0) {
      continue;
    }
    mergeContributionTotals(remainingWeekContribution, session.projectedContributionByMuscle);
  }

  return getExposedVolumeLandmarkEntries()
    .map(([muscle, landmarks]) => {
      const completedEffectiveSets =
        input.completedVolumeByMuscle[muscle]?.effectiveSets ?? 0;
      const projectedNextSessionEffectiveSets =
        nextSessionContribution.get(muscle) ?? 0;
      const projectedRemainingWeekEffectiveSets =
        remainingWeekContribution.get(muscle) ?? 0;
      const projectedFullWeekEffectiveSets = roundToTenth(
        completedEffectiveSets + (totalProjectedContribution.get(muscle) ?? 0)
      );
      const weeklyTarget = getWeeklyVolumeTarget(
        input.activeMesocycle,
        muscle,
        input.week
      );

      return {
        muscle,
        completedEffectiveSets,
        projectedNextSessionEffectiveSets: roundToTenth(
          projectedNextSessionEffectiveSets
        ),
        projectedRemainingWeekEffectiveSets: roundToTenth(
          projectedRemainingWeekEffectiveSets
        ),
        projectedFullWeekEffectiveSets,
        weeklyTarget,
        mev: landmarks.mev,
        mav: landmarks.mav,
        deltaToTarget: roundToTenth(projectedFullWeekEffectiveSets - weeklyTarget),
        deltaToMev: roundToTenth(projectedFullWeekEffectiveSets - landmarks.mev),
        deltaToMav: roundToTenth(projectedFullWeekEffectiveSets - landmarks.mav),
      } satisfies ProjectedWeekVolumeMuscleRow;
    })
    .filter(
      (row) =>
        row.weeklyTarget > 0 ||
        row.completedEffectiveSets > 0 ||
        row.projectedFullWeekEffectiveSets > 0
    )
    .sort((left, right) => {
      const leftProjected = Math.abs(left.deltaToTarget);
      const rightProjected = Math.abs(right.deltaToTarget);
      if (rightProjected !== leftProjected) {
        return rightProjected - leftProjected;
      }
      return left.muscle.localeCompare(right.muscle);
    });
}

async function loadActiveMesocycleForProjection(
  userId: string
): Promise<NonNullable<ActiveMesocycleForProjection>> {
  const activeMesocycle = await prisma.mesocycle.findFirst({
    where: {
      isActive: true,
      macroCycle: { userId },
    },
    orderBy: [{ mesoNumber: "desc" }],
    include: {
      blocks: {
        orderBy: { blockNumber: "asc" },
      },
      macroCycle: {
        select: {
          startDate: true,
        },
      },
    },
  });

  if (!activeMesocycle) {
    throw new Error("No active mesocycle found for projected-week-volume audit.");
  }

  return activeMesocycle;
}

async function loadPerformedAdvancingSlots(input: {
  userId: string;
  mesocycleId: string;
  week: number;
}): Promise<Array<{ slotId?: string | null; intent?: string | null }>> {
  const workouts = await prisma.workout.findMany({
    where: {
      userId: input.userId,
      mesocycleId: input.mesocycleId,
      mesocycleWeekSnapshot: input.week,
      status: { in: [...PERFORMED_WORKOUT_STATUSES] as WorkoutStatus[] },
      sessionIntent: { not: null },
    },
    orderBy: [{ mesoSessionSnapshot: "asc" }, { scheduledDate: "asc" }, { id: "asc" }],
    select: {
      advancesSplit: true,
      selectionMetadata: true,
      selectionMode: true,
      sessionIntent: true,
    },
  });

  return workouts
    .filter((workout) =>
      deriveSessionSemantics({
        advancesSplit: workout.advancesSplit,
        selectionMetadata: workout.selectionMetadata,
        selectionMode: workout.selectionMode,
        sessionIntent: workout.sessionIntent,
      }).consumesWeeklyScheduleIntent
    )
    .map((workout) => ({
      slotId: readSessionSlotSnapshot(workout.selectionMetadata)?.slotId ?? null,
      intent: workout.sessionIntent?.toLowerCase() ?? null,
    }));
}

export async function loadProjectedWeekVolumeReport(input: {
  userId: string;
  plannerDiagnosticsMode?: "standard" | "debug";
}): Promise<ProjectedWeekVolumeReport> {
  const plannerDiagnosticsMode = input.plannerDiagnosticsMode ?? "standard";
  const activeMesocycle = await loadActiveMesocycleForProjection(input.userId);
  const currentSession = deriveCurrentMesocycleSession(activeMesocycle);
  const currentWeek = currentSession.week;
  const mesoStartDate = new Date(activeMesocycle.macroCycle.startDate);
  mesoStartDate.setDate(mesoStartDate.getDate() + activeMesocycle.startWeek * 7);
  const weekStart = computeMesoWeekStartDate(mesoStartDate, currentWeek);

  const [snapshot, completedVolume, performedAdvancingSlots, nextWorkoutContext] =
    await Promise.all([
      loadPreloadedGenerationSnapshot(input.userId, {
        activeMesocycle,
      }),
      loadMesocycleWeekMuscleVolume(prisma, {
        userId: input.userId,
        mesocycleId: activeMesocycle.id,
        targetWeek: currentWeek,
        weekStart,
      }),
      loadPerformedAdvancingSlots({
        userId: input.userId,
        mesocycleId: activeMesocycle.id,
        week: currentWeek,
      }),
      loadNextWorkoutContext(input.userId),
    ]);

  const mapped = buildMappedGenerationContextFromSnapshot(input.userId, snapshot);
  const performedAdvancingSlotIdsThisWeek = performedAdvancingSlots
    .map((entry) => entry.slotId ?? null)
    .filter((slotId): slotId is string => typeof slotId === "string" && slotId.length > 0);
  const performedAdvancingIntentsThisWeek = performedAdvancingSlots
    .map((entry) => entry.intent ?? null)
    .filter((intent): intent is string => typeof intent === "string" && intent.length > 0);

  const nextRuntimeSlot = deriveNextRuntimeSlotSession({
    mesocycle: activeMesocycle,
    slotSequenceJson: activeMesocycle.slotSequenceJson,
    weeklySchedule: mapped.mappedConstraints.weeklySchedule,
    performedAdvancingSlotIdsThisWeek,
    performedAdvancingIntentsThisWeek,
  });

  const futureSlots =
    nextRuntimeSlot.intent == null
      ? []
      : buildRemainingFutureSlotsFromRuntime({
          slotSequenceJson: activeMesocycle.slotSequenceJson,
          weeklySchedule: mapped.mappedConstraints.weeklySchedule,
          performedAdvancingSlotsThisWeek: performedAdvancingSlots,
          currentSlotId: nextRuntimeSlot.slotId,
          currentIntent: nextRuntimeSlot.intent,
        });
  const orderedProjectedSlots = nextRuntimeSlot.intent
    ? [
        {
          slotId: nextRuntimeSlot.slotId,
          intent: nextRuntimeSlot.intent,
        },
        ...futureSlots.map((slot) => ({
          slotId: slot.slotId,
          intent: slot.intent,
        })),
      ]
    : [];

  const projectedSessions: ProjectedWeekVolumeSessionSummary[] = [];
  const projectionStartTime = new Date();

  for (const [index, slot] of orderedProjectedSlots.entries()) {
    const generation = await generateProjectedSession({
      userId: input.userId,
      mapped,
      intent: slot.intent as SessionIntent,
      slotId: slot.slotId ?? null,
      plannerDiagnosticsMode,
    });
    if ("error" in generation) {
      throw new Error(
        `projected-week-volume generation failed for slot ${slot.slotId ?? "unknown"} (${slot.intent}): ${generation.error}`
      );
    }

    const projectedContributionByMuscle = computeWorkoutContributionByMuscle(
      generation.workout
    );
    projectedSessions.push({
      slotId: slot.slotId ?? null,
      intent: slot.intent,
      isNext: index === 0,
      exerciseCount: countWorkoutExercises(generation.workout),
      totalSets: countWorkoutSets(generation.workout),
      projectedContributionByMuscle,
    });

    const projectedAt = new Date(projectionStartTime.getTime() + index * 60_000);
    appendWorkoutHistoryEntryToMappedContext({
      mapped,
      historyEntry: buildProjectedWorkoutHistoryEntry({
        mapped,
        workout: generation.workout,
        slotId: slot.slotId ?? null,
        intent: slot.intent as SessionIntent,
        week: currentWeek,
        sessionNumber: nextRuntimeSlot.session + index,
        occurredAt: projectedAt,
      }),
      occurredAt: projectedAt,
      rotationExerciseNames: listWorkoutExerciseNames(generation.workout),
    });
  }

  const projectionNotes: string[] = [];
  if (nextWorkoutContext.source === "existing_incomplete") {
    projectionNotes.push(
      `Generation-centric projection ignored persisted incomplete workout ${nextWorkoutContext.existingWorkoutId ?? "unknown"} and projected remaining current-week advancing slots from canonical performed runtime state only.`
    );
  }

  return {
    currentWeek: {
      mesocycleId: activeMesocycle.id,
      week: currentWeek,
      phase: mapped.cycleContext.phase,
      blockType: mapped.cycleContext.blockType,
    },
    projectionNotes,
    completedVolumeByMuscle: toProjectedWeekVolumeByMuscle(completedVolume),
    projectedSessions,
    fullWeekByMuscle: buildFullWeekRows({
      activeMesocycle,
      week: currentWeek,
      completedVolumeByMuscle: toProjectedWeekVolumeByMuscle(completedVolume),
      projectedSessions,
    }),
  };
}
