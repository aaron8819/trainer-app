import type { Prisma } from "@prisma/client";
import { WorkoutSessionIntent, WorkoutStatus } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import {
  getExposedVolumeLandmarkEntries,
  getMuscleTargetSemantics,
  normalizeExposedMuscle,
  type MuscleDashboardGroup,
  type MuscleTargetTier,
  type MuscleTargetWarningSeverity,
  type VolumeSoftTargetRange,
  type VolumeTargetKind,
} from "@/lib/engine/volume-landmarks";
import { getEffectiveStimulusByMuscle } from "@/lib/engine/stimulus";
import {
  getWeeklyMuscleDashboardGroup,
  getWeeklyMuscleDisplayGroup,
  type WeeklyMuscleDisplayGroup,
} from "@/lib/ui/weekly-muscle-status";
import type { SessionIntent } from "@/lib/engine/session-types";
import type { MovementPatternV2, WorkoutPlan } from "@/lib/engine/types";
import { listWorkoutPlanExercisesInOrder } from "@/lib/engine/workout-plan-order";
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
import { buildSlotSequenceEntries } from "./mesocycle-handoff-slot-plan-projection.coverage-evaluation";
import { applyFinalMinimumViableSetRedistribution } from "./mesocycle-handoff-slot-plan-projection.repair-engine";
import { loadMesocycleWeekMuscleVolume } from "./weekly-volume";
import {
  computeMesoWeekStartDate,
  mergeContributionTotals,
  roundToTenth,
} from "./volume-read-model-helpers";

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
  exercises?: ProjectedWeekVolumeExerciseSummary[];
  estimatedMinutes?: number | null;
  movementPatternCounts?: Record<string, number>;
  projectedContributionByMuscle: Record<string, number>;
};

export type ProjectedWeekVolumeExerciseSummary = {
  exerciseId: string;
  name: string;
  setCount: number;
  role: "primary" | "accessory";
  effectiveStimulusByMuscle?: Record<string, number>;
};

export type ProjectedWeekVolumeMuscleRow = {
  muscle: string;
  targetKind?: VolumeTargetKind;
  targetRange?: VolumeSoftTargetRange | null;
  displayGroup?: WeeklyMuscleDisplayGroup;
  targetTier?: MuscleTargetTier | null;
  warningSeverity?: MuscleTargetWarningSeverity;
  dashboardGroup?: MuscleDashboardGroup | null;
  completedEffectiveSets: number;
  projectedNextSessionEffectiveSets: number;
  projectedRemainingWeekEffectiveSets: number;
  projectedFullWeekEffectiveSets: number;
  weeklyTarget: number;
  mev: number;
  mav: number;
  mrv?: number;
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

function countWorkoutExercises(workout: WorkoutPlan): number {
  return workout.mainLifts.length + workout.accessories.length;
}

function countWorkoutSets(workout: WorkoutPlan): number {
  return listWorkoutPlanExercisesInOrder(workout)
    .filter(({ section }) => section !== "warmup")
    .reduce(
      (sum, { exercise }) => sum + exercise.sets.length,
      0
    );
}

function countWorkoutMovementPatterns(workout: WorkoutPlan): Record<string, number> {
  const counts = new Map<MovementPatternV2, number>();

  for (const { exercise: workoutExercise, section } of listWorkoutPlanExercisesInOrder(workout)) {
    if (section === "warmup") {
      continue;
    }
    for (const pattern of workoutExercise.exercise.movementPatterns ?? []) {
      counts.set(pattern, (counts.get(pattern) ?? 0) + 1);
    }
  }

  return Object.fromEntries(
    Array.from(counts.entries()).sort(([left], [right]) => left.localeCompare(right))
  );
}

function toWorkoutSessionIntent(intent: string): WorkoutSessionIntent {
  return intent.toUpperCase() as WorkoutSessionIntent;
}

function enforceProjectedSessionMinimumSets(input: {
  workout: WorkoutPlan;
  slotId: string | null;
  intent: string;
  orderedProjectedSlots: ReadonlyArray<{ slotId: string | null; intent: string }>;
}): WorkoutPlan {
  const fallbackSlotId = input.slotId ?? "projected_slot";
  const [projectedSlot] = applyFinalMinimumViableSetRedistribution({
    projectedSlots: [
      {
        slotPlan: {
          slotId: fallbackSlotId,
          intent: toWorkoutSessionIntent(input.intent),
          exercises: [],
        },
        workout: input.workout,
        projectedContributionByMuscle: new Map(
          Object.entries(computeWorkoutContributionByMuscle(input.workout))
        ),
        repairMuscles: [],
      },
    ],
    slotSequenceEntries: buildSlotSequenceEntries(
      input.orderedProjectedSlots.map((slot, index) => ({
        slotId: slot.slotId ?? `projected_slot_${index + 1}`,
        intent: toWorkoutSessionIntent(slot.intent),
      }))
    ),
  });

  return projectedSlot?.workout ?? input.workout;
}

function summarizeWorkoutExercises(workout: WorkoutPlan): ProjectedWeekVolumeExerciseSummary[] {
  return listWorkoutPlanExercisesInOrder(workout)
    .filter(({ section }) => section !== "warmup")
    .map(({ exercise, section }) => {
      const effectiveStimulusByMuscle = new Map<string, number>();
      for (const [muscle, effectiveSets] of getEffectiveStimulusByMuscle(
        exercise.exercise,
        exercise.sets.length
      )) {
        const exposedMuscle = normalizeExposedMuscle(muscle);
        effectiveStimulusByMuscle.set(
          exposedMuscle,
          roundToTenth((effectiveStimulusByMuscle.get(exposedMuscle) ?? 0) + effectiveSets)
        );
      }

      return {
        exerciseId: exercise.exercise.id,
        name: exercise.exercise.name,
        setCount: exercise.sets.length,
        role: section === "main" ? ("primary" as const) : ("accessory" as const),
        effectiveStimulusByMuscle: Object.fromEntries(
          Array.from(effectiveStimulusByMuscle.entries()).sort(([left], [right]) =>
            left.localeCompare(right)
          )
        ),
      };
    });
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

function buildFullWeekRows(input: {
  activeMesocycle: NonNullable<ActiveMesocycleForProjection>;
  week: number;
  completedVolumeByMuscle: Record<string, ProjectedWeekVolumeByMuscle>;
  projectedSessions: ProjectedWeekVolumeSessionSummary[];
  includeImplicitRows?: boolean;
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
    .flatMap(([muscle, landmarks]) => {
      const completedVolume = input.completedVolumeByMuscle[muscle];
      const completedEffectiveSets =
        completedVolume?.effectiveSets ?? 0;
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
      const targetSemantics = getMuscleTargetSemantics(muscle);
      const dashboardGroup = getWeeklyMuscleDashboardGroup({
        dashboardGroup: targetSemantics.dashboardGroup,
        targetKind: targetSemantics.targetKind,
      });
      const hasCompletedActual =
        completedEffectiveSets > 0 ||
        (completedVolume?.directSets ?? 0) > 0 ||
        (completedVolume?.indirectSets ?? 0) > 0;
      const shouldInclude =
        dashboardGroup === "implicit"
          ? Boolean(input.includeImplicitRows || hasCompletedActual)
          : weeklyTarget > 0 ||
            completedEffectiveSets > 0 ||
            projectedFullWeekEffectiveSets > 0;

      if (!shouldInclude) {
        return [];
      }

      return [{
        muscle,
        targetKind: targetSemantics.targetKind,
        targetRange: targetSemantics.softTargetRange,
        displayGroup: getWeeklyMuscleDisplayGroup(targetSemantics.targetKind),
        targetTier: targetSemantics.targetTier,
        warningSeverity: targetSemantics.warningSeverity,
        dashboardGroup,
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
        mrv: landmarks.mrv,
        deltaToTarget: roundToTenth(projectedFullWeekEffectiveSets - weeklyTarget),
        deltaToMev: roundToTenth(projectedFullWeekEffectiveSets - landmarks.mev),
        deltaToMav: roundToTenth(projectedFullWeekEffectiveSets - landmarks.mav),
      } satisfies ProjectedWeekVolumeMuscleRow];
    })
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
    .filter((workout) => {
      const semantics = deriveSessionSemantics({
        advancesSplit: workout.advancesSplit,
        selectionMetadata: workout.selectionMetadata,
        selectionMode: workout.selectionMode,
        sessionIntent: workout.sessionIntent,
      });

      return !semantics.isCloseout && semantics.consumesWeeklyScheduleIntent;
    })
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

  if (nextWorkoutContext.source === "final_week_close_pending") {
    const projectionNotes = [
      nextWorkoutContext.lifecycleBlocker?.message ??
        "Final accumulation closeout is pending. Resolve or dismiss the optional gap-fill before generating the deload.",
    ];

    return {
      currentWeek: {
        mesocycleId: activeMesocycle.id,
        week: currentWeek,
        phase: mapped.cycleContext.phase,
        blockType: mapped.cycleContext.blockType,
      },
      projectionNotes,
      completedVolumeByMuscle: toProjectedWeekVolumeByMuscle(completedVolume),
      projectedSessions: [],
      fullWeekByMuscle: buildFullWeekRows({
        activeMesocycle,
        week: currentWeek,
        completedVolumeByMuscle: toProjectedWeekVolumeByMuscle(completedVolume),
        projectedSessions: [],
        includeImplicitRows: plannerDiagnosticsMode === "debug",
      }),
    };
  }

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

    const projectedWorkout = enforceProjectedSessionMinimumSets({
      workout: generation.workout,
      slotId: slot.slotId ?? null,
      intent: slot.intent,
      orderedProjectedSlots,
    });
    const projectedContributionByMuscle = computeWorkoutContributionByMuscle(
      projectedWorkout
    );
    projectedSessions.push({
      slotId: slot.slotId ?? null,
      intent: slot.intent,
      isNext: index === 0,
      exerciseCount: countWorkoutExercises(projectedWorkout),
      totalSets: countWorkoutSets(projectedWorkout),
      exercises: summarizeWorkoutExercises(projectedWorkout),
      estimatedMinutes: projectedWorkout.estimatedMinutes ?? null,
      movementPatternCounts: countWorkoutMovementPatterns(projectedWorkout),
      projectedContributionByMuscle,
    });

    const projectedAt = new Date(projectionStartTime.getTime() + index * 60_000);
    appendWorkoutHistoryEntryToMappedContext({
      mapped,
      historyEntry: buildProjectedWorkoutHistoryEntry({
        mapped,
        workout: projectedWorkout,
        slotId: slot.slotId ?? null,
        intent: slot.intent as SessionIntent,
        week: currentWeek,
        sessionNumber: nextRuntimeSlot.session + index,
        occurredAt: projectedAt,
      }),
      occurredAt: projectedAt,
      rotationExerciseNames: listWorkoutExerciseNames(projectedWorkout),
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
      includeImplicitRows: plannerDiagnosticsMode === "debug",
    }),
  };
}
