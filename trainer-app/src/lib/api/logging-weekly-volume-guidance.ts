import { Prisma, WorkoutStatus } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { VOLUME_LANDMARKS } from "@/lib/engine/volume-landmarks";
import type { SessionIntent } from "@/lib/engine/session-types";
import { getEffectiveStimulusByMuscle } from "@/lib/engine/stimulus";
import type { WorkoutHistoryEntry } from "@/lib/engine/types";
import { readSessionSlotSnapshot } from "@/lib/evidence/session-decision-receipt";
import { deriveSessionSemantics } from "@/lib/session-semantics/derive-session-semantics";
import { classifySetLog } from "@/lib/session-semantics/set-classification";
import {
  formatWeeklyMuscleStatusLabel,
  getWeeklyMuscleStatus,
  type WeeklyMuscleStatus,
} from "@/lib/ui/weekly-muscle-status";
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

export type LoggingWeeklyVolumeGuidanceRow = {
  muscle: string;
  doneNow: number;
  projectedRemainingWeek: number;
  projectedEndOfWeek: number;
  weeklyTarget: number;
  deltaToTarget: number;
  mev: number;
  mav: number;
  mrv: number;
  status: WeeklyMuscleStatus;
  statusLabel: string;
  topUpHint: string | null;
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
  rows: LoggingWeeklyVolumeGuidanceRow[];
};

function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

function computeMesoWeekStartDate(mesoStartDate: Date, week: number): Date {
  const date = new Date(mesoStartDate);
  date.setDate(date.getDate() + (week - 1) * 7);
  return date;
}

function mergeContributionTotals(
  totals: Map<string, number>,
  contribution: Record<string, number>
): void {
  for (const [muscle, effectiveSets] of Object.entries(contribution)) {
    totals.set(muscle, roundToTenth((totals.get(muscle) ?? 0) + effectiveSets));
  }
}

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
      byMuscle.set(
        muscle,
        roundToTenth((byMuscle.get(muscle) ?? 0) + effectiveSets)
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

function buildTopUpHint(deltaToTarget: number): string | null {
  const deficit = roundToTenth(Math.max(0, -deltaToTarget));
  if (deficit <= 0) {
    return null;
  }
  if (deficit <= 1.25) {
    return "Likely needs ~1 more hard set";
  }
  if (deficit <= 2.5) {
    return "Likely needs ~1-2 more hard sets";
  }
  return null;
}

function buildGuidanceRows(input: {
  activeMesocycle: NonNullable<WorkoutForGuidance["mesocycle"]>;
  currentWeek: number;
  doneNowByMuscle: Map<string, number>;
  projectedRemainingByMuscle: Map<string, number>;
}): LoggingWeeklyVolumeGuidanceRow[] {
  return Object.entries(VOLUME_LANDMARKS)
    .map(([muscle, landmarks]) => {
      const doneNow = roundToTenth(input.doneNowByMuscle.get(muscle) ?? 0);
      const projectedRemainingWeek = roundToTenth(
        input.projectedRemainingByMuscle.get(muscle) ?? 0
      );
      const projectedEndOfWeek = roundToTenth(doneNow + projectedRemainingWeek);
      const weeklyTarget = getWeeklyVolumeTarget(
        input.activeMesocycle,
        muscle,
        input.currentWeek
      );
      const deltaToTarget = roundToTenth(projectedEndOfWeek - weeklyTarget);
      const status = getWeeklyMuscleStatus({
        effectiveSets: projectedEndOfWeek,
        target: weeklyTarget,
        mev: landmarks.mev,
        mrv: landmarks.mrv,
      });

      return {
        muscle,
        doneNow,
        projectedRemainingWeek,
        projectedEndOfWeek,
        weeklyTarget,
        deltaToTarget,
        mev: landmarks.mev,
        mav: landmarks.mav,
        mrv: landmarks.mrv,
        status,
        statusLabel: formatWeeklyMuscleStatusLabel(status),
        topUpHint: buildTopUpHint(deltaToTarget),
      } satisfies LoggingWeeklyVolumeGuidanceRow;
    })
    .filter((row) => {
      if (
        row.weeklyTarget <= 0 &&
        row.doneNow <= 0 &&
        row.projectedEndOfWeek <= 0
      ) {
        return false;
      }

      return row.projectedEndOfWeek < row.weeklyTarget || row.status === "below_mev";
    })
    .sort((left, right) => {
      if (left.deltaToTarget !== right.deltaToTarget) {
        return left.deltaToTarget - right.deltaToTarget;
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

  return {
    workoutId: workout.id,
    currentWeek: {
      mesocycleId: workout.mesocycle.id,
      week: currentWeek,
      phase: mapped.cycleContext.phase,
      blockType: mapped.cycleContext.blockType,
    },
    shouldShow: true,
    rows: buildGuidanceRows({
      activeMesocycle: workout.mesocycle,
      currentWeek,
      doneNowByMuscle: baselineDoneNowByMuscle,
      projectedRemainingByMuscle,
    }),
  };
}
