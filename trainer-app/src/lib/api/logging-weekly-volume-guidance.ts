import { Prisma, WorkoutStatus } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import {
  getExposedVolumeLandmarkEntries,
  normalizeExposedMuscle,
} from "@/lib/engine/volume-landmarks";
import type { SessionIntent } from "@/lib/engine/session-types";
import { getEffectiveStimulusByMuscle } from "@/lib/engine/stimulus";
import type { WorkoutHistoryEntry } from "@/lib/engine/types";
import { readSessionSlotSnapshot } from "@/lib/evidence/session-decision-receipt";
import { deriveSessionSemantics } from "@/lib/session-semantics/derive-session-semantics";
import { classifySetLog } from "@/lib/session-semantics/set-classification";
import {
  readRuntimeAddedExerciseIds,
  readRuntimeAddedSetIds,
} from "@/lib/ui/selection-metadata";
import { PERFORMED_WORKOUT_STATUSES } from "@/lib/workout-status";
import {
  appendWorkoutHistoryEntryToMappedContext,
  buildMappedGenerationContextFromSnapshot,
  buildProjectedWorkoutHistoryEntry,
  computeWorkoutContributionByMuscle,
  generateProjectedSession,
  listWorkoutExerciseNames,
  loadPreloadedGenerationSnapshot,
} from "./projected-week-volume-shared";
import {
  computeMesoWeekStartDate,
  mergeContributionTotals,
  roundToTenth,
} from "./volume-read-model-helpers";
import {
  buildRemainingFutureSlotsFromRuntime,
  deriveNextRuntimeSlotSession,
} from "./mesocycle-slot-runtime";
import { getWeeklyVolumeTarget } from "./mesocycle-lifecycle-math";
import { buildAdvancingPerformedSlots } from "./next-session";
import { loadMesocycleWeekMuscleVolume } from "./weekly-volume";

type WorkoutForGuidance = Prisma.WorkoutGetPayload<{
  select: {
    id: true;
    userId: true;
    scheduledDate: true;
    status: true;
    selectionMetadata: true;
    selectionMode: true;
    sessionIntent: true;
    advancesSplit: true;
    templateId: true;
    mesocycleId: true;
    mesocycleWeekSnapshot: true;
    mesoSessionSnapshot: true;
    mesocyclePhaseSnapshot: true;
    mesocycle: {
      select: {
        id: true;
        startWeek: true;
        durationWeeks: true;
        accumulationSessionsCompleted: true;
        deloadSessionsCompleted: true;
        sessionsPerWeek: true;
        state: true;
        slotSequenceJson: true;
        blocks: true;
        macroCycle: {
          select: {
            startDate: true;
          };
        };
      };
    };
    exercises: {
      orderBy: [{ orderIndex: "asc" }, { id: "asc" }];
      select: {
        id: true;
        orderIndex: true;
        section: true;
        exerciseId: true;
        exercise: {
          select: {
            id: true;
            name: true;
            aliases: {
              select: {
                alias: true;
              };
            };
            exerciseMuscles: {
              select: {
                role: true;
                muscle: {
                  select: {
                    name: true;
                  };
                };
              };
            };
          };
        };
        sets: {
          orderBy: [{ setIndex: "asc" }, { id: "asc" }];
          select: {
            id: true;
            setIndex: true;
            targetReps: true;
            targetRepMin: true;
            targetRepMax: true;
            targetRpe: true;
            targetLoad: true;
            restSeconds: true;
            logs: {
              orderBy: {
                completedAt: "desc";
              };
              take: 1;
              select: {
                actualReps: true;
                actualRpe: true;
                actualLoad: true;
                wasSkipped: true;
              };
            };
          };
        };
      };
    };
  };
}>;

export type LoggingWeeklyVolumeProjectionStatus =
  | "floor_risk"
  | "on_track"
  | "productive"
  | "optional_floor_buffer"
  | "ahead_suppress_extras"
  | "near_cap"
  | "over_cap"
  | "no_addons_recommended";

export type LoggingWeeklyVolumeRecommendationKind =
  | "add_low_fatigue_buffer_optional"
  | "suppress_extras"
  | "no_action"
  | "watch";

export type LoggingWeeklyVolumeGuidanceRow = {
  muscle: string;
  performedSoFar: number;
  plannedRemaining: number;
  projectedFinish: number;
  MEV: number;
  MAV: number;
  status: LoggingWeeklyVolumeProjectionStatus;
  statusLabel: string;
  recommendationKind: LoggingWeeklyVolumeRecommendationKind;
  reasonCopy: string;
  optionalOrSuppress: boolean;
};

export type LoggingWeeklyVolumeGuidance = {
  workoutId: string;
  currentWeek: {
    mesocycleId: string;
    week: number;
    phase: string | null;
    blockType: string | null;
  } | null;
  shouldShow: boolean;
  summary: {
    status: "no_addons_recommended";
    recommendationKind: "no_action";
    reasonCopy: string;
  } | null;
  rows: LoggingWeeklyVolumeGuidanceRow[];
};

function computeCheckpointShouldShow(workout: WorkoutForGuidance): boolean {
  const runtimeAddedExerciseIds = readRuntimeAddedExerciseIds(workout.selectionMetadata);
  const runtimeAddedSetIds = readRuntimeAddedSetIds(workout.selectionMetadata);
  let plannedSetCount = 0;
  let resolvedPlannedSetCount = 0;

  for (const exercise of workout.exercises) {
    const isRuntimeAddedExercise = runtimeAddedExerciseIds.has(exercise.id);
    for (const set of exercise.sets) {
      if (isRuntimeAddedExercise || runtimeAddedSetIds.has(set.id)) {
        continue;
      }

      plannedSetCount += 1;
      if (classifySetLog(set.logs[0]).isResolved) {
        resolvedPlannedSetCount += 1;
      }
    }
  }

  return plannedSetCount > 0 && resolvedPlannedSetCount === plannedSetCount;
}

// Persisted workout actuals use set-log classification, unlike projected plans
// where every planned set contributes through computeWorkoutContributionByMuscle().
function computeWorkoutActualContributionByMuscle(
  workout: WorkoutForGuidance
): Record<string, number> {
  const byMuscle = new Map<string, number>();

  for (const workoutExercise of workout.exercises) {
    const completedSets = workoutExercise.sets.filter((set) =>
      classifySetLog(set.logs[0]).countsTowardVolume
    ).length;
    if (completedSets <= 0) {
      continue;
    }

    const primaryMuscles = workoutExercise.exercise.exerciseMuscles
      .filter((mapping) => mapping.role === "PRIMARY")
      .map((mapping) => mapping.muscle.name);
    const secondaryMuscles = workoutExercise.exercise.exerciseMuscles
      .filter((mapping) => mapping.role === "SECONDARY")
      .map((mapping) => mapping.muscle.name);

    for (const [muscle, effectiveSets] of getEffectiveStimulusByMuscle(
      {
        id: workoutExercise.exercise.id,
        name: workoutExercise.exercise.name,
        primaryMuscles,
        secondaryMuscles,
        aliases: workoutExercise.exercise.aliases.map((alias) => alias.alias),
      },
      completedSets
    )) {
      const exposedMuscle = normalizeExposedMuscle(muscle);
      byMuscle.set(
        exposedMuscle,
        roundToTenth((byMuscle.get(exposedMuscle) ?? 0) + effectiveSets)
      );
    }
  }

  return Object.fromEntries(
    Array.from(byMuscle.entries()).sort(([left], [right]) =>
      left.localeCompare(right)
    )
  );
}

function buildCurrentWorkoutHistoryEntry(input: {
  workout: WorkoutForGuidance;
  currentWeek: number;
  mappedMesocycleId: string | null | undefined;
  mappedPhase: string | null | undefined;
  semantics: ReturnType<typeof deriveSessionSemantics>;
}): {
  historyEntry: WorkoutHistoryEntry;
  occurredAt: Date;
  rotationExerciseNames: string[];
} {
  const runtimeAddedExerciseIds = readRuntimeAddedExerciseIds(
    input.workout.selectionMetadata
  );
  const allPersistedSetsResolved = input.workout.exercises.every((exercise) =>
    exercise.sets.every((set) => classifySetLog(set.logs[0]).isResolved)
  );
  const occurredAt = new Date(input.workout.scheduledDate);
  const sessionIntent =
    input.workout.sessionIntent?.toLowerCase() as SessionIntent | undefined;

  return {
    historyEntry: {
      date: occurredAt.toISOString(),
      completed: allPersistedSetsResolved,
      status: allPersistedSetsResolved ? "COMPLETED" : "PARTIAL",
      advancesSplit: input.semantics.advancesLifecycle,
      isDeload: input.semantics.isDeload,
      progressionEligible: input.semantics.countsTowardProgressionHistory,
      performanceEligible: input.semantics.countsTowardPerformanceHistory,
      selectionMode:
        (input.workout.selectionMode as WorkoutHistoryEntry["selectionMode"]) ??
        undefined,
      sessionIntent,
      mesocycleSnapshot: {
        mesocycleId: input.mappedMesocycleId,
        week: input.currentWeek,
        session: input.workout.mesoSessionSnapshot,
        phase: input.mappedPhase ?? input.workout.mesocyclePhaseSnapshot,
        slotId:
          readSessionSlotSnapshot(input.workout.selectionMetadata)?.slotId ?? null,
      },
      exercises: input.workout.exercises
        .filter((exercise) => !runtimeAddedExerciseIds.has(exercise.id))
        .map((exercise) => ({
          exerciseId: exercise.exerciseId,
          primaryMuscles: exercise.exercise.exerciseMuscles
            .filter((mapping) => mapping.role === "PRIMARY")
            .map((mapping) => mapping.muscle.name),
          sets: exercise.sets.flatMap((set) => {
            const log = set.logs[0];
            if (!classifySetLog(log).isSignal) {
              return [];
            }

            return [
              {
                exerciseId: exercise.exerciseId,
                setIndex: set.setIndex,
                reps: log?.actualReps ?? 0,
                rpe: log?.actualRpe ?? undefined,
                load: log?.actualLoad ?? undefined,
                targetLoad: set.targetLoad ?? undefined,
              },
            ];
          }),
        })),
    },
    occurredAt,
    rotationExerciseNames: input.workout.exercises
      .filter((exercise) => !runtimeAddedExerciseIds.has(exercise.id))
      .map((exercise) => exercise.exercise.name),
  };
}

const NEAR_MAV_BUFFER_SETS = 2;
const FLOOR_BUFFER_SETS = 1;

function classifyProjection(input: {
  projectedFinish: number;
  weeklyTarget: number;
  mev: number;
  mav: number;
}): LoggingWeeklyVolumeProjectionStatus {
  if (input.mav > 0 && input.projectedFinish > input.mav) {
    return "over_cap";
  }
  if (
    input.mav > 0 &&
    input.projectedFinish >= input.mav - NEAR_MAV_BUFFER_SETS
  ) {
    return "near_cap";
  }
  if (input.mev > 0 && input.projectedFinish < input.mev) {
    return "floor_risk";
  }
  if (
    input.mev > 0 &&
    input.projectedFinish <= input.mev + FLOOR_BUFFER_SETS
  ) {
    return "optional_floor_buffer";
  }
  if (input.weeklyTarget > 0 && input.projectedFinish > input.weeklyTarget) {
    return "ahead_suppress_extras";
  }
  if (input.weeklyTarget > 0 && input.projectedFinish >= input.weeklyTarget) {
    return "on_track";
  }
  return "productive";
}

function recommendationKindForStatus(
  status: LoggingWeeklyVolumeProjectionStatus
): LoggingWeeklyVolumeRecommendationKind {
  switch (status) {
    case "floor_risk":
    case "optional_floor_buffer":
      return "add_low_fatigue_buffer_optional";
    case "ahead_suppress_extras":
    case "near_cap":
    case "over_cap":
      return "suppress_extras";
    case "productive":
      return "watch";
    case "on_track":
    case "no_addons_recommended":
      return "no_action";
  }
}

function statusLabel(status: LoggingWeeklyVolumeProjectionStatus): string {
  switch (status) {
    case "floor_risk":
      return "Floor risk";
    case "on_track":
      return "On track";
    case "productive":
      return "Productive zone";
    case "optional_floor_buffer":
      return "Optional low-fatigue buffer";
    case "ahead_suppress_extras":
      return "Ahead — suppress extras";
    case "near_cap":
      return "Near cap";
    case "over_cap":
      return "Over cap";
    case "no_addons_recommended":
      return "No add-ons recommended";
  }
}

function reasonCopyForStatus(status: LoggingWeeklyVolumeProjectionStatus): string {
  switch (status) {
    case "floor_risk":
      return "Projected below the MEV floor. Optional low-fatigue isolation only if readiness and time allow; do not chase extra volume.";
    case "optional_floor_buffer":
      return "Projected right at the MEV floor. Optional +1 low-fatigue buffer only if it feels easy.";
    case "productive":
      return "MEV floor is covered. No add-ons recommended from this card.";
    case "on_track":
      return "Projected in the productive zone. No add-ons recommended.";
    case "ahead_suppress_extras":
      return "Projected ahead of useful weekly dose. Suppress extras here.";
    case "near_cap":
      return "Projected near MAV. Suppress extras to protect recovery.";
    case "over_cap":
      return "Projected over MAV. Avoid extra work here.";
    case "no_addons_recommended":
      return "Relevant muscles are covered by performed work and the remaining projection. No add-ons recommended.";
  }
}

function buildGuidanceRows(input: {
  activeMesocycle: NonNullable<WorkoutForGuidance["mesocycle"]>;
  currentWeek: number;
  performedSoFarByMuscle: Map<string, number>;
  projectedRemainingByMuscle: Map<string, number>;
}): LoggingWeeklyVolumeGuidanceRow[] {
  return getExposedVolumeLandmarkEntries()
    .map(([muscle, landmarks]) => {
      const performedSoFar = roundToTenth(
        input.performedSoFarByMuscle.get(muscle) ?? 0
      );
      const plannedRemaining = roundToTenth(
        input.projectedRemainingByMuscle.get(muscle) ?? 0
      );
      const projectedFinish = roundToTenth(performedSoFar + plannedRemaining);
      const weeklyTarget = getWeeklyVolumeTarget(
        input.activeMesocycle,
        muscle,
        input.currentWeek
      );
      const status = classifyProjection({
        projectedFinish,
        weeklyTarget,
        mev: landmarks.mev,
        mav: landmarks.mav,
      });
      const recommendationKind = recommendationKindForStatus(status);

      return {
        weeklyTarget,
        row: {
          muscle,
          performedSoFar,
          plannedRemaining,
          projectedFinish,
          MEV: landmarks.mev,
          MAV: landmarks.mav,
          status,
          statusLabel: statusLabel(status),
          recommendationKind,
          reasonCopy: reasonCopyForStatus(status),
          optionalOrSuppress:
            recommendationKind === "add_low_fatigue_buffer_optional" ||
            recommendationKind === "suppress_extras",
        } satisfies LoggingWeeklyVolumeGuidanceRow,
      };
    })
    .filter(({ row, weeklyTarget }) => {
      if (
        weeklyTarget <= 0 &&
        row.performedSoFar <= 0 &&
        row.projectedFinish <= 0
      ) {
        return false;
      }

      return row.status !== "on_track";
    })
    .map(({ row }) => row)
    .sort((left, right) => {
      const priority: Record<LoggingWeeklyVolumeProjectionStatus, number> = {
        floor_risk: 0,
        optional_floor_buffer: 1,
        near_cap: 2,
        over_cap: 3,
        ahead_suppress_extras: 4,
        productive: 5,
        on_track: 6,
        no_addons_recommended: 7,
      };
      const priorityDelta = priority[left.status] - priority[right.status];
      if (priorityDelta !== 0) {
        return priorityDelta;
      }
      return left.muscle.localeCompare(right.muscle);
    });
}

export async function loadLoggingWeeklyVolumeGuidance(input: {
  userId: string;
  workoutId: string;
  plannerDiagnosticsMode?: "standard" | "debug";
}): Promise<LoggingWeeklyVolumeGuidance> {
  const plannerDiagnosticsMode = input.plannerDiagnosticsMode ?? "standard";
  const workout = await prisma.workout.findFirst({
    where: {
      id: input.workoutId,
      userId: input.userId,
    },
    select: {
      id: true,
      userId: true,
      scheduledDate: true,
      status: true,
      selectionMetadata: true,
      selectionMode: true,
      sessionIntent: true,
      advancesSplit: true,
      templateId: true,
      mesocycleId: true,
      mesocycleWeekSnapshot: true,
      mesoSessionSnapshot: true,
      mesocyclePhaseSnapshot: true,
      mesocycle: {
        select: {
          id: true,
          startWeek: true,
          durationWeeks: true,
          accumulationSessionsCompleted: true,
          deloadSessionsCompleted: true,
          sessionsPerWeek: true,
          state: true,
          slotSequenceJson: true,
          blocks: true,
          macroCycle: {
            select: {
              startDate: true,
            },
          },
        },
      },
      exercises: {
        orderBy: [{ orderIndex: "asc" }, { id: "asc" }],
        select: {
          id: true,
          orderIndex: true,
          section: true,
          exerciseId: true,
          exercise: {
            select: {
              id: true,
              name: true,
              aliases: {
                select: {
                  alias: true,
                },
              },
              exerciseMuscles: {
                select: {
                  role: true,
                  muscle: {
                    select: {
                      name: true,
                    },
                  },
                },
              },
            },
          },
          sets: {
            orderBy: [{ setIndex: "asc" }, { id: "asc" }],
            select: {
              id: true,
              setIndex: true,
              targetReps: true,
              targetRepMin: true,
              targetRepMax: true,
              targetRpe: true,
              targetLoad: true,
              restSeconds: true,
              logs: {
                orderBy: {
                  completedAt: "desc",
                },
                take: 1,
                select: {
                  actualReps: true,
                  actualRpe: true,
                  actualLoad: true,
                  wasSkipped: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!workout) {
    throw new Error(`Workout ${input.workoutId} not found for weekly-volume guidance.`);
  }

  const shouldShow = computeCheckpointShouldShow(workout);
  if (!shouldShow || !workout.mesocycleId || !workout.mesocycle) {
    return {
      workoutId: workout.id,
      currentWeek: null,
      shouldShow,
      summary: null,
      rows: [],
    };
  }

  const currentWeek =
    workout.mesocycleWeekSnapshot ??
    Math.max(
      1,
      Math.floor(workout.mesocycle.accumulationSessionsCompleted / workout.mesocycle.sessionsPerWeek) + 1
    );
  const mesoStartDate = new Date(workout.mesocycle.macroCycle.startDate);
  mesoStartDate.setDate(mesoStartDate.getDate() + workout.mesocycle.startWeek * 7);
  const weekStart = computeMesoWeekStartDate(mesoStartDate, currentWeek);
  const currentSemantics = deriveSessionSemantics({
    advancesSplit: workout.advancesSplit,
    selectionMetadata: workout.selectionMetadata,
    selectionMode: workout.selectionMode,
    sessionIntent: workout.sessionIntent,
    templateId: workout.templateId,
    mesocyclePhase: workout.mesocyclePhaseSnapshot,
  });
  const currentIntent =
    workout.sessionIntent?.toLowerCase() as SessionIntent | undefined;
  const currentSlotId =
    readSessionSlotSnapshot(workout.selectionMetadata)?.slotId ?? null;

  const [snapshot, baselineVolume, performedWorkoutsThisWeek] = await Promise.all([
    loadPreloadedGenerationSnapshot(input.userId, {
      activeMesocycle:
        workout.mesocycle as unknown as NonNullable<
          NonNullable<Parameters<typeof loadPreloadedGenerationSnapshot>[1]>["activeMesocycle"]
        >,
    }),
    loadMesocycleWeekMuscleVolume(prisma, {
      userId: input.userId,
      mesocycleId: workout.mesocycle.id,
      targetWeek: currentWeek,
      weekStart,
      excludeWorkoutId: workout.id,
    }),
    prisma.workout.findMany({
      where: {
        userId: input.userId,
        mesocycleId: workout.mesocycle.id,
        mesocycleWeekSnapshot: currentWeek,
        status: { in: [...PERFORMED_WORKOUT_STATUSES] as WorkoutStatus[] },
        sessionIntent: { not: null },
        id: { not: workout.id },
      },
      orderBy: [{ mesoSessionSnapshot: "asc" }, { scheduledDate: "asc" }, { id: "asc" }],
      select: {
        advancesSplit: true,
        selectionMetadata: true,
        selectionMode: true,
        sessionIntent: true,
      },
    }),
  ]);

  const currentActualContribution = computeWorkoutActualContributionByMuscle(workout);
  const baselineDoneNowByMuscle = new Map<string, number>(
    Object.entries(baselineVolume).map(([muscle, row]) => [muscle, row.effectiveSets])
  );
  mergeContributionTotals(baselineDoneNowByMuscle, currentActualContribution);

  const performedAdvancingSlots = buildAdvancingPerformedSlots(performedWorkoutsThisWeek);
  const performedAfterCurrent =
    currentSemantics.consumesWeeklyScheduleIntent && currentIntent
      ? [
          ...performedAdvancingSlots,
          {
            slotId: currentSlotId,
            intent: currentIntent,
          },
        ]
      : performedAdvancingSlots;

  const mapped = buildMappedGenerationContextFromSnapshot(input.userId, snapshot);
  const currentHistory = buildCurrentWorkoutHistoryEntry({
    workout,
    currentWeek,
    mappedMesocycleId: mapped.activeMesocycle?.id,
    mappedPhase: mapped.cycleContext.phase,
    semantics: currentSemantics,
  });
  appendWorkoutHistoryEntryToMappedContext({
    mapped,
    historyEntry: currentHistory.historyEntry,
    occurredAt: currentHistory.occurredAt,
    rotationExerciseNames: currentHistory.rotationExerciseNames,
  });

  const performedAdvancingSlotIdsThisWeek = performedAfterCurrent
    .map((entry) => entry.slotId ?? null)
    .filter((slotId): slotId is string => typeof slotId === "string" && slotId.length > 0);
  const performedAdvancingIntentsThisWeek = performedAfterCurrent
    .map((entry) => entry.intent ?? null)
    .filter((intent): intent is string => typeof intent === "string" && intent.length > 0);
  const nextRuntimeSlot = deriveNextRuntimeSlotSession({
    mesocycle: workout.mesocycle,
    slotSequenceJson: workout.mesocycle.slotSequenceJson,
    weeklySchedule: mapped.mappedConstraints.weeklySchedule,
    performedAdvancingSlotIdsThisWeek,
    performedAdvancingIntentsThisWeek,
  });
  const orderedProjectedSlots =
    nextRuntimeSlot.intent == null
      ? []
      : [
          {
            slotId: nextRuntimeSlot.slotId,
            intent: nextRuntimeSlot.intent,
          },
          ...buildRemainingFutureSlotsFromRuntime({
            slotSequenceJson: workout.mesocycle.slotSequenceJson,
            weeklySchedule: mapped.mappedConstraints.weeklySchedule,
            performedAdvancingSlotsThisWeek: performedAfterCurrent,
            currentSlotId: nextRuntimeSlot.slotId,
            currentIntent: nextRuntimeSlot.intent,
          }).map((slot) => ({
            slotId: slot.slotId,
            intent: slot.intent,
          })),
        ];

  const projectedRemainingByMuscle = new Map<string, number>();
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
        `logging-weekly-volume guidance generation failed for slot ${slot.slotId ?? "unknown"} (${slot.intent}): ${generation.error}`
      );
    }

    mergeContributionTotals(
      projectedRemainingByMuscle,
      computeWorkoutContributionByMuscle(generation.workout)
    );

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

  const rows = buildGuidanceRows({
    activeMesocycle: workout.mesocycle,
    currentWeek,
    performedSoFarByMuscle: baselineDoneNowByMuscle,
    projectedRemainingByMuscle,
  });

  return {
    workoutId: workout.id,
    currentWeek: {
      mesocycleId: workout.mesocycle.id,
      week: currentWeek,
      phase: mapped.cycleContext.phase,
      blockType: mapped.cycleContext.blockType,
    },
    shouldShow: true,
    summary:
      rows.length === 0
        ? {
            status: "no_addons_recommended",
            recommendationKind: "no_action",
            reasonCopy: reasonCopyForStatus("no_addons_recommended"),
          }
        : null,
    rows,
  };
}
