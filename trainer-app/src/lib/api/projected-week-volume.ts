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
import type {
  MovementPatternV2,
  WorkoutHistoryEntry,
  WorkoutPlan,
} from "@/lib/engine/types";
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
  loadPersistedIncompleteWorkoutProjections,
  type IncompleteWorkoutProjection,
} from "./persisted-incomplete-workout-projection";
import {
  appendWorkoutHistoryEntryToMappedContext,
  buildMappedGenerationContextFromSnapshot,
  buildProjectedWorkoutHistoryEntry,
  computeWorkoutContributionByMuscle,
  generateProjectedSession,
  listWorkoutExerciseIds,
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
  workoutId?: string;
  slotId: string | null;
  intent: string;
  isNext: boolean;
  availability?: "available" | "completed" | "skipped" | "unavailable";
  evidenceSource?:
    | "immutable_workout_snapshot"
    | "accepted_seed_runtime_projection"
    | "current_policy_projection";
  evidenceReliable?: boolean;
  projectionCategory?:
    | "persisted_incomplete"
    | "unmaterialized_future";
  performedContributionByMuscle?: Record<string, number>;
  remainingContributionByMuscle?: Record<string, number>;
  immutableEvidence?: {
    snapshotVersions: number[];
    runtimeEditAttribution: IncompleteWorkoutProjection["evidence"]["runtimeEditAttribution"];
    reasons: string[];
  };
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
  movementPatterns?: string[];
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
  incompletePerformedEffectiveSets?: number;
  incompleteRemainingEffectiveSets?: number;
  unmaterializedFutureProjectedEffectiveSets?: number;
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

export type ProjectedWeekVolumeCategoryTotals = {
  completedPerformed: Record<string, number>;
  incompletePerformed: Record<string, number>;
  incompleteRemaining: Record<string, number>;
  unmaterializedFutureProjected: Record<string, number>;
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
  volumeByCategory: ProjectedWeekVolumeCategoryTotals;
  incompleteWorkoutProjections: IncompleteWorkoutProjection[];
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
        movementPatterns: [...(exercise.exercise.movementPatterns ?? [])],
        effectiveStimulusByMuscle: Object.fromEntries(
          Array.from(effectiveStimulusByMuscle.entries()).sort(([left], [right]) =>
            left.localeCompare(right)
          )
        ),
      };
    });
}

function summarizePersistedIncompleteProjection(
  projection: IncompleteWorkoutProjection,
  input: { isNext: boolean; consumeEvidence: boolean }
): ProjectedWeekVolumeSessionSummary {
  const exercises = projection.exercises
    .filter((exercise) => exercise.totalProjected.qualifyingSets > 0)
    .map((exercise) => ({
      exerciseId: exercise.exerciseId,
      name: exercise.exerciseName,
      setCount: exercise.totalProjected.qualifyingSets,
      role:
        exercise.section === "MAIN"
          ? ("primary" as const)
          : ("accessory" as const),
      movementPatterns: [...exercise.movementPatterns],
      effectiveStimulusByMuscle:
        exercise.totalProjected.contributionsByMuscle,
    }));
  const movementPatternCounts = new Map<string, number>();
  for (const exercise of exercises) {
    for (const pattern of exercise.movementPatterns ?? []) {
      movementPatternCounts.set(
        pattern,
        (movementPatternCounts.get(pattern) ?? 0) + 1
      );
    }
  }

  return {
    workoutId: projection.workoutId,
    slotId: projection.slotId,
    intent: projection.intent ?? "unknown",
    isNext: input.isNext,
    availability: projection.consumesWeeklyScheduleIntent
      ? "available"
      : "completed",
    evidenceSource: "immutable_workout_snapshot",
    evidenceReliable: input.consumeEvidence,
    projectionCategory: "persisted_incomplete",
    performedContributionByMuscle:
      projection.performed.contributionsByMuscle,
    remainingContributionByMuscle:
      projection.remaining.contributionsByMuscle,
    immutableEvidence: {
      snapshotVersions: projection.evidence.snapshotVersions,
      runtimeEditAttribution: projection.evidence.runtimeEditAttribution,
      reasons: projection.evidence.reasons,
    },
    exerciseCount: exercises.length,
    totalSets: projection.totalProjected.qualifyingSets,
    exercises,
    estimatedMinutes: null,
    movementPatternCounts: Object.fromEntries(
      Array.from(movementPatternCounts.entries()).sort(([left], [right]) =>
        left.localeCompare(right)
      )
    ),
    projectedContributionByMuscle:
      projection.totalProjected.contributionsByMuscle,
  };
}

function buildPersistedProjectionHistoryEntry(input: {
  projection: IncompleteWorkoutProjection;
  performedOnly: boolean;
  mesocycleId: string;
  week: number;
}): WorkoutHistoryEntry {
  return {
    date: input.projection.scheduledDate,
    completed: true,
    status: "COMPLETED",
    advancesSplit: input.projection.consumesWeeklyScheduleIntent,
    progressionEligible:
      input.projection.countsTowardProgressionHistory,
    performanceEligible:
      input.projection.countsTowardPerformanceHistory,
    selectionMode: "INTENT",
    sessionIntent: (input.projection.intent ?? "upper") as SessionIntent,
    mesocycleSnapshot: {
      mesocycleId: input.mesocycleId,
      week: input.week,
      session: input.projection.mesoSessionSnapshot ?? undefined,
      slotId: input.projection.slotId,
    },
    exercises: input.projection.exercises.flatMap((exercise) => {
      const sets = exercise.projectedSets.filter(
        (set) => !input.performedOnly || set.category === "performed"
      );
      return sets.length > 0
        ? [
            {
              exerciseId: exercise.exerciseId,
              primaryMuscles: [...exercise.primaryMuscles],
              sets: sets.map((set) => ({
                exerciseId: exercise.exerciseId,
                setIndex: set.setIndex,
                reps: set.targetReps,
                rpe: set.targetRpe ?? undefined,
                targetLoad: set.targetLoad ?? undefined,
              })),
            },
          ]
        : [];
    }),
  };
}

function withProjectionReason(
  projection: IncompleteWorkoutProjection,
  reason: string
): IncompleteWorkoutProjection {
  return {
    ...projection,
    status: "unreliable",
    evidence: {
      ...projection.evidence,
      runtimeEditAttribution:
        projection.evidence.runtimeEditAttribution === "not_needed"
          ? "not_needed"
          : "ambiguous",
      reasons: Array.from(
        new Set([...projection.evidence.reasons, reason])
      ).sort(),
    },
  };
}

function finalizeCategoryTotals(
  totals: Map<string, number>
): Record<string, number> {
  return Object.fromEntries(
    Array.from(totals.entries())
      .map(
        ([muscle, contribution]): [string, number] => [
          muscle,
          contribution === 0 ? 0 : Number(contribution.toFixed(6)),
        ]
      )
      .filter(([, contribution]) => contribution !== 0)
      .sort(([left], [right]) => left.localeCompare(right))
  );
}

function buildVolumeByCategory(input: {
  completedVolumeByMuscle: Record<string, ProjectedWeekVolumeByMuscle>;
  projectedSessions: ProjectedWeekVolumeSessionSummary[];
}): ProjectedWeekVolumeCategoryTotals {
  const incompletePerformed = new Map<string, number>();
  const incompleteRemaining = new Map<string, number>();
  const unmaterializedFutureProjected = new Map<string, number>();

  for (const session of input.projectedSessions) {
    if (session.evidenceReliable === false) {
      continue;
    }
    if (session.projectionCategory === "persisted_incomplete") {
      for (const [muscle, contribution] of Object.entries(
        session.performedContributionByMuscle ?? {}
      )) {
        incompletePerformed.set(
          muscle,
          (incompletePerformed.get(muscle) ?? 0) + contribution
        );
      }
      for (const [muscle, contribution] of Object.entries(
        session.remainingContributionByMuscle ?? {}
      )) {
        incompleteRemaining.set(
          muscle,
          (incompleteRemaining.get(muscle) ?? 0) + contribution
        );
      }
      continue;
    }
    for (const [muscle, contribution] of Object.entries(
      session.projectedContributionByMuscle
    )) {
      unmaterializedFutureProjected.set(
        muscle,
        (unmaterializedFutureProjected.get(muscle) ?? 0) + contribution
      );
    }
  }

  return {
    completedPerformed: Object.fromEntries(
      Object.entries(input.completedVolumeByMuscle)
        .map(
          ([muscle, row]): [string, number] => [muscle, row.effectiveSets]
        )
        .sort(([left], [right]) => left.localeCompare(right))
    ),
    incompletePerformed: finalizeCategoryTotals(incompletePerformed),
    incompleteRemaining: finalizeCategoryTotals(incompleteRemaining),
    unmaterializedFutureProjected: finalizeCategoryTotals(
      unmaterializedFutureProjected
    ),
  };
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
  volumeByCategory: ProjectedWeekVolumeCategoryTotals;
  includeImplicitRows?: boolean;
}): ProjectedWeekVolumeMuscleRow[] {
  const currentSession =
    input.projectedSessions.find((session) => session.isNext) ??
    input.projectedSessions[0];
  const nextSessionContribution = new Map<string, number>(
    Object.entries(
      currentSession?.evidenceReliable === false
        ? {}
        : currentSession?.projectedContributionByMuscle ?? {}
    )
  );
  const remainingWeekContribution = new Map<string, number>();
  const totalProjectedContribution = new Map<string, number>();

  for (const session of input.projectedSessions) {
    if (session.evidenceReliable === false) {
      continue;
    }
    mergeContributionTotals(totalProjectedContribution, session.projectedContributionByMuscle);
    if (session === currentSession) {
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
      const incompletePerformedEffectiveSets =
        input.volumeByCategory.incompletePerformed[muscle] ?? 0;
      const incompleteRemainingEffectiveSets =
        input.volumeByCategory.incompleteRemaining[muscle] ?? 0;
      const unmaterializedFutureProjectedEffectiveSets =
        input.volumeByCategory.unmaterializedFutureProjected[muscle] ?? 0;
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
        incompletePerformedEffectiveSets,
        incompleteRemainingEffectiveSets,
        unmaterializedFutureProjectedEffectiveSets,
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

  // Load incomplete rows first, then exclude those identities from the performed
  // query. If a workout transitions to PARTIAL between reads, this prevents the
  // same persisted workout from contributing through both categories.
  const loadedIncompleteWorkoutProjections =
    await loadPersistedIncompleteWorkoutProjections(prisma, {
      userId: input.userId,
      mesocycleId: activeMesocycle.id,
      targetWeek: currentWeek,
      requireSlotIdentity: activeMesocycle.slotSequenceJson != null,
    });

  const [
    snapshot,
    completedVolume,
    performedAdvancingSlots,
    nextWorkoutContext,
  ] =
    await Promise.all([
      loadPreloadedGenerationSnapshot(input.userId, {
        activeMesocycle,
      }),
      loadMesocycleWeekMuscleVolume(prisma, {
        userId: input.userId,
        mesocycleId: activeMesocycle.id,
        targetWeek: currentWeek,
        weekStart,
        excludeWorkoutIds: loadedIncompleteWorkoutProjections.map(
          (projection) => projection.workoutId
        ),
      }),
      loadPerformedAdvancingSlots({
        userId: input.userId,
        mesocycleId: activeMesocycle.id,
        week: currentWeek,
      }),
      loadNextWorkoutContext(input.userId),
    ]);

  const mapped = buildMappedGenerationContextFromSnapshot(input.userId, snapshot);
  const completedVolumeByMuscle =
    toProjectedWeekVolumeByMuscle(completedVolume);
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

    const projectedSessions = loadedIncompleteWorkoutProjections
      .filter(
        (projection) =>
          !projection.consumesWeeklyScheduleIntent &&
          projection.performed.qualifyingSets > 0
      )
      .map((projection) =>
        summarizePersistedIncompleteProjection(projection, {
          isNext: false,
          consumeEvidence: projection.status === "reliable",
        })
      );
    const volumeByCategory = buildVolumeByCategory({
      completedVolumeByMuscle,
      projectedSessions,
    });

    return {
      currentWeek: {
        mesocycleId: activeMesocycle.id,
        week: currentWeek,
        phase: mapped.cycleContext.phase,
        blockType: mapped.cycleContext.blockType,
      },
      projectionNotes,
      completedVolumeByMuscle,
      volumeByCategory,
      incompleteWorkoutProjections: loadedIncompleteWorkoutProjections,
      projectedSessions,
      fullWeekByMuscle: buildFullWeekRows({
        activeMesocycle,
        week: currentWeek,
        completedVolumeByMuscle,
        projectedSessions,
        volumeByCategory,
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

  const projectionNotes: string[] = [];
  let incompleteWorkoutProjections = [
    ...loadedIncompleteWorkoutProjections,
  ];
  const usedIncompleteWorkoutIds = new Set<string>();
  const projectedSessions: ProjectedWeekVolumeSessionSummary[] = [];
  const nonAdvancingIncompleteSessions: ProjectedWeekVolumeSessionSummary[] = [];
  const projectionStartTime = new Date();
  let downstreamEvidenceReliable = true;

  const replaceProjection = (
    nextProjection: IncompleteWorkoutProjection
  ): void => {
    incompleteWorkoutProjections = incompleteWorkoutProjections.map(
      (projection) =>
        projection.workoutId === nextProjection.workoutId
          ? nextProjection
          : projection
    );
  };

  for (const projection of incompleteWorkoutProjections.filter(
    (entry) => !entry.consumesWeeklyScheduleIntent
  )) {
    const consumeEvidence = projection.status === "reliable";
    if (projection.performed.qualifyingSets > 0) {
      nonAdvancingIncompleteSessions.push(
        summarizePersistedIncompleteProjection(projection, {
          isNext: false,
          consumeEvidence,
        })
      );
      if (consumeEvidence) {
        appendWorkoutHistoryEntryToMappedContext({
          mapped,
          historyEntry: buildPersistedProjectionHistoryEntry({
            projection,
            performedOnly: true,
            mesocycleId: activeMesocycle.id,
            week: currentWeek,
          }),
          occurredAt: new Date(projection.scheduledDate),
          rotationExerciseIds: projection.exercises
            .filter((exercise) => exercise.performed.qualifyingSets > 0)
            .map((exercise) => exercise.exerciseId),
        });
      }
    }
    usedIncompleteWorkoutIds.add(projection.workoutId);
  }

  for (const [index, slot] of orderedProjectedSlots.entries()) {
    const selectedIncompleteId =
      index === 0 && nextWorkoutContext.source === "existing_incomplete"
        ? nextWorkoutContext.existingWorkoutId
        : null;
    const slotCandidates = incompleteWorkoutProjections.filter(
      (projection) =>
        projection.consumesWeeklyScheduleIntent &&
        !usedIncompleteWorkoutIds.has(projection.workoutId) &&
        (selectedIncompleteId
          ? projection.workoutId === selectedIncompleteId
          : projection.slotId === slot.slotId)
    );
    let persistedProjection = slotCandidates[0];
    if (slotCandidates.length > 1 && persistedProjection) {
      persistedProjection = withProjectionReason(
        persistedProjection,
        `duplicate_materialized_slot:${slot.slotId ?? "unknown"}`
      );
      replaceProjection(persistedProjection);
    }
    if (
      persistedProjection &&
      (persistedProjection.slotId !== (slot.slotId ?? null) ||
        persistedProjection.intent !== slot.intent)
    ) {
      persistedProjection = withProjectionReason(
        persistedProjection,
        `runtime_slot_placement_mismatch:${slot.slotId ?? "unknown"}`
      );
      replaceProjection(persistedProjection);
    }

    if (persistedProjection) {
      usedIncompleteWorkoutIds.add(persistedProjection.workoutId);
      const consumeEvidence = persistedProjection.status === "reliable";
      projectedSessions.push(
        summarizePersistedIncompleteProjection(persistedProjection, {
          isNext: index === 0,
          consumeEvidence,
        })
      );
      projectionNotes.push(
        consumeEvidence
          ? `Projected persisted incomplete workout ${persistedProjection.workoutId} from immutable materialized sets, frozen stimulus snapshots, and performed logs.`
          : `Persisted incomplete workout ${persistedProjection.workoutId} remained fail-closed: ${persistedProjection.evidence.reasons.join(",") || "unreliable_immutable_evidence"}.`
      );
      if (consumeEvidence) {
        appendWorkoutHistoryEntryToMappedContext({
          mapped,
          historyEntry: buildPersistedProjectionHistoryEntry({
            projection: persistedProjection,
            performedOnly: false,
            mesocycleId: activeMesocycle.id,
            week: currentWeek,
          }),
          occurredAt: new Date(persistedProjection.scheduledDate),
          rotationExerciseIds: persistedProjection.exercises
            .filter(
              (exercise) => exercise.totalProjected.qualifyingSets > 0
            )
            .map((exercise) => exercise.exerciseId),
        });
      } else {
        downstreamEvidenceReliable = false;
      }
      continue;
    }

    if (selectedIncompleteId) {
      downstreamEvidenceReliable = false;
      projectionNotes.push(
        `Persisted incomplete workout ${selectedIncompleteId} could not be loaded from the active mesocycle and remains fail-closed.`
      );
      projectedSessions.push({
        workoutId: selectedIncompleteId,
        slotId: slot.slotId ?? null,
        intent: slot.intent,
        isNext: true,
        availability: "available",
        evidenceSource: "immutable_workout_snapshot",
        evidenceReliable: false,
        projectionCategory: "persisted_incomplete",
        performedContributionByMuscle: {},
        remainingContributionByMuscle: {},
        immutableEvidence: {
          snapshotVersions: [],
          runtimeEditAttribution: "ambiguous",
          reasons: ["persisted_incomplete_workout_not_loadable"],
        },
        exerciseCount: 0,
        totalSets: 0,
        exercises: [],
        estimatedMinutes: null,
        movementPatternCounts: {},
        projectedContributionByMuscle: {},
      });
      continue;
    }

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
    const compositionSource =
      generation.selection.sessionDecisionReceipt?.sessionProvenance
        ?.compositionSource;
    projectedSessions.push({
      slotId: slot.slotId ?? null,
      intent: slot.intent,
      isNext: index === 0,
      availability: "available",
      evidenceSource:
        compositionSource === "persisted_slot_plan_seed"
          ? "accepted_seed_runtime_projection"
          : "current_policy_projection",
      evidenceReliable: downstreamEvidenceReliable,
      projectionCategory: "unmaterialized_future",
      exerciseCount: countWorkoutExercises(projectedWorkout),
      totalSets: countWorkoutSets(projectedWorkout),
      exercises: summarizeWorkoutExercises(projectedWorkout),
      estimatedMinutes: projectedWorkout.estimatedMinutes ?? null,
      movementPatternCounts: countWorkoutMovementPatterns(projectedWorkout),
      projectedContributionByMuscle,
    });

    const projectedAt = new Date(
      projectionStartTime.getTime() + index * 60_000
    );
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
      rotationExerciseIds: listWorkoutExerciseIds(projectedWorkout),
    });
  }

  for (const projection of incompleteWorkoutProjections.filter(
    (entry) =>
      entry.consumesWeeklyScheduleIntent &&
      !usedIncompleteWorkoutIds.has(entry.workoutId)
  )) {
    const orphaned = withProjectionReason(
      projection,
      `materialized_incomplete_slot_not_projectable:${projection.slotId ?? "unknown"}`
    );
    replaceProjection(orphaned);
    projectedSessions.push(
      summarizePersistedIncompleteProjection(orphaned, {
        isNext: false,
        consumeEvidence: false,
      })
    );
    projectionNotes.push(
      `Persisted incomplete workout ${orphaned.workoutId} did not map to a remaining runtime slot and remains fail-closed.`
    );
  }
  projectedSessions.push(...nonAdvancingIncompleteSessions);

  const volumeByCategory = buildVolumeByCategory({
    completedVolumeByMuscle,
    projectedSessions,
  });

  return {
    currentWeek: {
      mesocycleId: activeMesocycle.id,
      week: currentWeek,
      phase: mapped.cycleContext.phase,
      blockType: mapped.cycleContext.blockType,
    },
    projectionNotes,
    completedVolumeByMuscle,
    volumeByCategory,
    incompleteWorkoutProjections,
    projectedSessions,
    fullWeekByMuscle: buildFullWeekRows({
      activeMesocycle,
      week: currentWeek,
      completedVolumeByMuscle,
      projectedSessions,
      volumeByCategory,
      includeImplicitRows: plannerDiagnosticsMode === "debug",
    }),
  };
}
