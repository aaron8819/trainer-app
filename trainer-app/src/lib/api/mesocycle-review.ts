import type { MesocyclePhase, Prisma, WorkoutStatus } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { VOLUME_LANDMARKS } from "@/lib/engine/volume-landmarks";
import { getEffectiveStimulusByMuscle } from "@/lib/engine/stimulus";
import { deriveSessionSemantics } from "@/lib/session-semantics/derive-session-semantics";
import { PERFORMED_WORKOUT_STATUSES } from "@/lib/workout-status";
import {
  loadClosedMesocycleArchive,
  type ClosedMesocycleArchive,
  type MesocycleHandoffSummary,
} from "./mesocycle-handoff";
import {
  buildFrozenRecommendationPresentation,
  type FrozenRecommendationPresentation,
} from "./mesocycle-handoff-presentation";
import { getWeeklyVolumeTarget } from "./mesocycle-lifecycle-math";
import { classifyMuscleOutcome, type MuscleOutcomeStatus } from "./muscle-outcome-review";
import { countCompletedSets } from "./weekly-volume";

type MesocycleReviewReader =
  | Pick<Prisma.TransactionClient, "mesocycle" | "workout">
  | Pick<typeof prisma, "mesocycle" | "workout">;

type ReviewMesocycleRow = {
  id: string;
  mesoNumber: number;
  focus: string;
  state: "ACTIVE_ACCUMULATION" | "ACTIVE_DELOAD" | "AWAITING_HANDOFF" | "COMPLETED";
  startWeek: number;
  durationWeeks: number;
  sessionsPerWeek: number;
  closedAt: Date | null;
  handoffSummaryJson: unknown;
  macroCycle: {
    startDate: Date;
  };
  blocks: Array<{
    blockType: string;
    startWeek: number;
    durationWeeks: number;
    volumeTarget: string;
    intensityBias: string;
  }>;
};

type ReviewWorkoutRow = {
  id: string;
  scheduledDate: Date;
  completedAt: Date | null;
  status: WorkoutStatus;
  sessionIntent: string | null;
  selectionMode: string | null;
  selectionMetadata: unknown;
  advancesSplit: boolean;
  mesocyclePhaseSnapshot: MesocyclePhase | null;
  mesocycleWeekSnapshot: number | null;
  exercises: Array<{
    exerciseId: string;
    exercise: {
      id: string;
      name: string;
      aliases: Array<{ alias: string }>;
      exerciseMuscles: Array<{
        role: "PRIMARY" | "SECONDARY";
        muscle: { name: string };
      }>;
    };
    sets: Array<{
      setIndex: number;
      logs: Array<{
        wasSkipped: boolean;
        actualReps: number | null;
        actualLoad: number | null;
        actualRpe: number | null;
      }>;
    }>;
  }>;
};

type MuscleContributionAccumulator = {
  exerciseId?: string;
  exerciseName: string;
  effectiveSets: number;
};

type MuscleVolumeAccumulator = {
  effectiveSets: number;
  contributionMap: Map<string, MuscleContributionAccumulator>;
};

type ExercisePerformanceSignal = "estimated_strength" | "top_reps";

type ExerciseExposure = {
  scheduledDate: string;
  signal: ExercisePerformanceSignal;
  value: number;
  bestSet: string;
  sessionIntent: string | null;
};

export type MesocycleReviewAdherence = {
  plannedSessions: number;
  performedSessions: number;
  coreCompletedSessions: number;
  partialSessions: number;
  skippedSessions: number;
  adherenceRate: number | null;
  completionRate: number | null;
  optionalPerformedSessions: number;
};

export type MesocycleReviewWeekRow = {
  week: number;
  phase: "ACCUMULATION" | "DELOAD";
  plannedSessions: number;
  performedSessions: number;
};

export type MesocycleReviewProgressRow = {
  exerciseId: string;
  exerciseName: string;
  sessionIntent: string | null;
  exposureCount: number;
  signal: ExercisePerformanceSignal;
  changePct: number;
  summary: string;
  latestBestSet: string;
};

export type MesocycleReviewMuscleRow = {
  muscle: string;
  targetSets: number;
  actualEffectiveSets: number;
  delta: number;
  percentDelta: number;
  status: MuscleOutcomeStatus;
  topContributors: Array<{
    exerciseId?: string;
    exerciseName: string;
    effectiveSets: number;
  }>;
};

export type MesocycleReviewData = {
  mesocycleId: string;
  mesoNumber: number;
  focus: string;
  closedAt: string | null;
  archive: {
    currentState: ClosedMesocycleArchive["currentState"];
    reviewState: ClosedMesocycleArchive["reviewState"];
    isEditableHandoff: boolean;
  };
  frozenSummary: MesocycleHandoffSummary;
  recommendation: FrozenRecommendationPresentation;
  derived: {
    scopedWorkoutCount: number;
    performedWorkoutCount: number;
    adherence: MesocycleReviewAdherence;
    weeklyBreakdown: MesocycleReviewWeekRow[];
    topProgressedExercises: MesocycleReviewProgressRow[];
    muscleVolumeSummary: MesocycleReviewMuscleRow[];
  };
};

function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

function formatWholePercent(value: number | null): string {
  if (value == null) {
    return "n/a";
  }
  return `${Math.round(value * 100)}%`;
}

function formatLoad(value: number | null): string | null {
  if (value == null) {
    return null;
  }
  return Number.isInteger(value) ? `${value}` : value.toFixed(1);
}

function buildMesoStartDate(macroStartDate: Date, mesocycleStartWeek: number): Date {
  const date = new Date(macroStartDate);
  date.setUTCDate(date.getUTCDate() + mesocycleStartWeek * 7);
  return date;
}

function resolveWorkoutWeek(
  workout: Pick<ReviewWorkoutRow, "mesocycleWeekSnapshot" | "scheduledDate">,
  mesocycle: Pick<ReviewMesocycleRow, "durationWeeks"> & { mesoStartDate: Date }
): number | null {
  if (
    typeof workout.mesocycleWeekSnapshot === "number" &&
    workout.mesocycleWeekSnapshot >= 1 &&
    workout.mesocycleWeekSnapshot <= mesocycle.durationWeeks
  ) {
    return workout.mesocycleWeekSnapshot;
  }

  const diffMs = workout.scheduledDate.getTime() - mesocycle.mesoStartDate.getTime();
  const computedWeek = Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000)) + 1;
  if (computedWeek < 1 || computedWeek > mesocycle.durationWeeks) {
    return null;
  }
  return computedWeek;
}

function resolveWeekPhase(
  week: number,
  durationWeeks: number,
  phaseSnapshot: MesocyclePhase | null | undefined
): "ACCUMULATION" | "DELOAD" {
  if (phaseSnapshot === "DELOAD") {
    return "DELOAD";
  }
  if (phaseSnapshot === "ACCUMULATION") {
    return "ACCUMULATION";
  }
  return week >= durationWeeks ? "DELOAD" : "ACCUMULATION";
}

function isPerformedWorkoutStatus(status: WorkoutStatus): boolean {
  return (PERFORMED_WORKOUT_STATUSES as readonly string[]).includes(status);
}

function getReviewWorkoutSemantics(
  workout: Pick<
    ReviewWorkoutRow,
    "advancesSplit" | "selectionMode" | "sessionIntent" | "selectionMetadata" | "mesocyclePhaseSnapshot"
  >
) {
  return deriveSessionSemantics({
    advancesSplit: workout.advancesSplit,
    selectionMode: workout.selectionMode,
    sessionIntent: workout.sessionIntent,
    selectionMetadata: workout.selectionMetadata,
    mesocyclePhase: workout.mesocyclePhaseSnapshot,
  });
}

function buildWeekRows(
  workouts: ReviewWorkoutRow[],
  mesocycle: ReviewMesocycleRow & { mesoStartDate: Date }
): MesocycleReviewWeekRow[] {
  const weeks = Array.from({ length: mesocycle.durationWeeks }, (_, index) => ({
    week: index + 1,
    phase: index + 1 >= mesocycle.durationWeeks ? "DELOAD" : "ACCUMULATION",
    plannedSessions: 0,
    performedSessions: 0,
  })) satisfies MesocycleReviewWeekRow[];

  for (const workout of workouts) {
    const week = resolveWorkoutWeek(workout, mesocycle);
    if (!week) {
      continue;
    }

    const semantics = getReviewWorkoutSemantics(workout);
    const row = weeks[week - 1];
    row.phase = resolveWeekPhase(week, mesocycle.durationWeeks, workout.mesocyclePhaseSnapshot);

    if (semantics.consumesWeeklyScheduleIntent) {
      row.plannedSessions += 1;
      if (isPerformedWorkoutStatus(workout.status)) {
        row.performedSessions += 1;
      }
    }
  }

  return weeks;
}

function buildAdherenceSummary(workouts: ReviewWorkoutRow[]): MesocycleReviewAdherence {
  const coreWorkouts = workouts.filter(
    (workout) => getReviewWorkoutSemantics(workout).consumesWeeklyScheduleIntent
  );

  const optionalPerformedSessions = workouts.filter((workout) => {
    const semantics = getReviewWorkoutSemantics(workout);
    return !semantics.consumesWeeklyScheduleIntent && isPerformedWorkoutStatus(workout.status);
  }).length;

  const plannedSessions = coreWorkouts.length;
  const performedSessions = coreWorkouts.filter((workout) => isPerformedWorkoutStatus(workout.status)).length;
  const coreCompletedSessions = coreWorkouts.filter((workout) => workout.status === "COMPLETED").length;
  const partialSessions = coreWorkouts.filter((workout) => workout.status === "PARTIAL").length;
  const skippedSessions = coreWorkouts.filter((workout) => workout.status === "SKIPPED").length;

  return {
    plannedSessions,
    performedSessions,
    coreCompletedSessions,
    partialSessions,
    skippedSessions,
    adherenceRate:
      plannedSessions > 0 ? Number((performedSessions / plannedSessions).toFixed(3)) : null,
    completionRate:
      plannedSessions > 0 ? Number((coreCompletedSessions / plannedSessions).toFixed(3)) : null,
    optionalPerformedSessions,
  };
}

function buildExerciseBestSetLabel(log: {
  actualReps: number | null;
  actualLoad: number | null;
  actualRpe: number | null;
}): string {
  const reps = typeof log.actualReps === "number" ? `${log.actualReps} reps` : "logged set";
  const load = formatLoad(log.actualLoad);
  const rpe = typeof log.actualRpe === "number" ? ` @ RPE ${log.actualRpe}` : "";
  return load ? `${reps} @ ${load} lb${rpe}` : `${reps}${rpe}`;
}

function buildExerciseExposure(
  workoutExercise: ReviewWorkoutRow["exercises"][number]
): ExerciseExposure | null {
  const loggedSets = workoutExercise.sets
    .map((set) => set.logs[0] ?? null)
    .filter(
      (log): log is NonNullable<typeof log> =>
        Boolean(log) &&
        !log.wasSkipped &&
        typeof log.actualReps === "number" &&
        log.actualReps > 0
    );

  if (loggedSets.length === 0) {
    return null;
  }

  const weightedSets = loggedSets
    .filter((log) => typeof log.actualLoad === "number" && log.actualLoad > 0)
    .map((log) => ({
      log,
      value: (log.actualLoad ?? 0) * (1 + (log.actualReps ?? 0) / 30),
    }))
    .sort((left, right) => right.value - left.value);

  if (weightedSets.length > 0) {
    return {
      scheduledDate: "",
      signal: "estimated_strength",
      value: weightedSets[0]?.value ?? 0,
      bestSet: buildExerciseBestSetLabel(weightedSets[0].log),
      sessionIntent: null,
    };
  }

  const bestRepSet = [...loggedSets].sort((left, right) => (right.actualReps ?? 0) - (left.actualReps ?? 0))[0];
  if (!bestRepSet) {
    return null;
  }

  return {
    scheduledDate: "",
    signal: "top_reps",
    value: bestRepSet.actualReps ?? 0,
    bestSet: buildExerciseBestSetLabel(bestRepSet),
    sessionIntent: null,
  };
}

function buildTopProgressedExercises(workouts: ReviewWorkoutRow[]): MesocycleReviewProgressRow[] {
  const exposuresByExercise = new Map<
    string,
    {
      exerciseId: string;
      exerciseName: string;
      exposures: ExerciseExposure[];
    }
  >();

  const orderedWorkouts = [...workouts].sort(
    (left, right) => left.scheduledDate.getTime() - right.scheduledDate.getTime()
  );

  for (const workout of orderedWorkouts) {
    if (!isPerformedWorkoutStatus(workout.status)) {
      continue;
    }

    const semantics = getReviewWorkoutSemantics(workout);
    if (!semantics.countsTowardPerformanceHistory) {
      continue;
    }

    for (const workoutExercise of workout.exercises) {
      const exposure = buildExerciseExposure(workoutExercise);
      if (!exposure) {
        continue;
      }

      const existing = exposuresByExercise.get(workoutExercise.exerciseId) ?? {
        exerciseId: workoutExercise.exerciseId,
        exerciseName: workoutExercise.exercise.name,
        exposures: [] as ExerciseExposure[],
      };

      existing.exposures.push({
        ...exposure,
        scheduledDate: workout.scheduledDate.toISOString(),
        sessionIntent: workout.sessionIntent,
      });
      exposuresByExercise.set(workoutExercise.exerciseId, {
        exerciseId: existing.exerciseId,
        exerciseName: existing.exerciseName,
        exposures: existing.exposures,
      });
    }
  }

  return Array.from(exposuresByExercise.values())
    .flatMap((entry) => {
      const preferredSignal: ExercisePerformanceSignal = entry.exposures.some(
        (exposure) => exposure.signal === "estimated_strength"
      )
        ? "estimated_strength"
        : "top_reps";
      const comparableExposures = entry.exposures.filter(
        (exposure) => exposure.signal === preferredSignal
      );
      if (comparableExposures.length < 2) {
        return [];
      }

      const first = comparableExposures[0];
      const last = comparableExposures[comparableExposures.length - 1];
      if (!first || !last || last.value <= first.value) {
        return [];
      }

      const changePct = Number((((last.value - first.value) / Math.max(first.value, 1)) as number).toFixed(3));
      const changeValue = roundToTenth(last.value - first.value);
      const isMeaningful =
        preferredSignal === "estimated_strength" ? changePct >= 0.03 : changeValue >= 1;
      if (!isMeaningful) {
        return [];
      }

      return [
        {
          exerciseId: entry.exerciseId,
          exerciseName: entry.exerciseName,
          sessionIntent: last.sessionIntent,
          exposureCount: comparableExposures.length,
          signal: preferredSignal,
          changePct,
          summary:
            preferredSignal === "estimated_strength"
              ? `Estimated strength up ${Math.round(changePct * 100)}% across ${comparableExposures.length} exposures.`
              : `Top reps up ${changeValue.toFixed(1)} across ${comparableExposures.length} exposures.`,
          latestBestSet: last.bestSet,
        } satisfies MesocycleReviewProgressRow,
      ];
    })
    .sort((left, right) => {
      if (right.changePct !== left.changePct) {
        return right.changePct - left.changePct;
      }
      if (right.exposureCount !== left.exposureCount) {
        return right.exposureCount - left.exposureCount;
      }
      return left.exerciseName.localeCompare(right.exerciseName);
    })
    .slice(0, 5);
}

function getOrCreateMuscleAccumulator(
  map: Map<string, MuscleVolumeAccumulator>,
  muscle: string
): MuscleVolumeAccumulator {
  const existing = map.get(muscle);
  if (existing) {
    return existing;
  }

  const created: MuscleVolumeAccumulator = {
    effectiveSets: 0,
    contributionMap: new Map<string, MuscleContributionAccumulator>(),
  };
  map.set(muscle, created);
  return created;
}

function getOrCreateContributionAccumulator(
  row: MuscleVolumeAccumulator,
  exerciseId: string | undefined,
  exerciseName: string
): MuscleContributionAccumulator {
  const key = exerciseId ?? exerciseName;
  const existing = row.contributionMap.get(key);
  if (existing) {
    return existing;
  }

  const created: MuscleContributionAccumulator = {
    exerciseId,
    exerciseName,
    effectiveSets: 0,
  };
  row.contributionMap.set(key, created);
  return created;
}

function buildMuscleVolumeSummary(
  workouts: ReviewWorkoutRow[],
  mesocycle: ReviewMesocycleRow
): MesocycleReviewMuscleRow[] {
  const actualByMuscle = new Map<string, MuscleVolumeAccumulator>();

  for (const workout of workouts) {
    if (!isPerformedWorkoutStatus(workout.status)) {
      continue;
    }

    for (const workoutExercise of workout.exercises) {
      const completedSets = countCompletedSets(workoutExercise.sets);
      if (completedSets <= 0) {
        continue;
      }

      const primaryMuscles = workoutExercise.exercise.exerciseMuscles
        .filter((mapping) => mapping.role === "PRIMARY")
        .map((mapping) => mapping.muscle.name);
      const secondaryMuscles = workoutExercise.exercise.exerciseMuscles
        .filter((mapping) => mapping.role === "SECONDARY")
        .map((mapping) => mapping.muscle.name);

      const effectiveContribution = getEffectiveStimulusByMuscle(
        {
          id: workoutExercise.exercise.id,
          name: workoutExercise.exercise.name,
          primaryMuscles,
          secondaryMuscles,
          aliases: workoutExercise.exercise.aliases.map((alias) => alias.alias),
        },
        completedSets
      );

      for (const [muscle, effectiveSets] of effectiveContribution) {
        const row = getOrCreateMuscleAccumulator(actualByMuscle, muscle);
        row.effectiveSets += effectiveSets;
        const contribution = getOrCreateContributionAccumulator(
          row,
          workoutExercise.exercise.id,
          workoutExercise.exercise.name
        );
        contribution.effectiveSets += effectiveSets;
      }
    }
  }

  return Object.keys(VOLUME_LANDMARKS)
    .map((muscle) => {
      let targetSets = 0;
      for (let week = 1; week <= mesocycle.durationWeeks; week += 1) {
        targetSets += getWeeklyVolumeTarget(mesocycle, muscle, week);
      }

      const actual = actualByMuscle.get(muscle);
      const actualEffectiveSets = roundToTenth(actual?.effectiveSets ?? 0);
      const outcome = classifyMuscleOutcome(targetSets, actualEffectiveSets);
      const topContributors = actual
        ? Array.from(actual.contributionMap.values())
            .map((contribution) => ({
              exerciseId: contribution.exerciseId,
              exerciseName: contribution.exerciseName,
              effectiveSets: roundToTenth(contribution.effectiveSets),
            }))
            .sort((left, right) => right.effectiveSets - left.effectiveSets)
            .slice(0, 3)
        : [];

      return {
        muscle,
        targetSets,
        actualEffectiveSets,
        ...outcome,
        topContributors,
      } satisfies MesocycleReviewMuscleRow;
    })
    .filter((row) => row.targetSets > 0 || row.actualEffectiveSets > 0)
    .sort((left, right) => {
      if (right.targetSets !== left.targetSets) {
        return right.targetSets - left.targetSets;
      }
      if (right.actualEffectiveSets !== left.actualEffectiveSets) {
        return right.actualEffectiveSets - left.actualEffectiveSets;
      }
      return left.muscle.localeCompare(right.muscle);
    });
}

async function loadMesocycleRow(
  client: MesocycleReviewReader,
  userId: string,
  mesocycleId: string
): Promise<ReviewMesocycleRow | null> {
  return client.mesocycle.findFirst({
    where: {
      id: mesocycleId,
      state: { in: ["AWAITING_HANDOFF", "COMPLETED"] },
      macroCycle: { userId },
    },
    select: {
      id: true,
      mesoNumber: true,
      focus: true,
      state: true,
      startWeek: true,
      durationWeeks: true,
      sessionsPerWeek: true,
      closedAt: true,
      handoffSummaryJson: true,
      macroCycle: {
        select: {
          startDate: true,
        },
      },
      blocks: {
        orderBy: { blockNumber: "asc" },
        select: {
          blockType: true,
          startWeek: true,
          durationWeeks: true,
          volumeTarget: true,
          intensityBias: true,
        },
      },
    },
  });
}

async function loadMesocycleWorkouts(
  client: MesocycleReviewReader,
  userId: string,
  mesocycleId: string
): Promise<ReviewWorkoutRow[]> {
  return client.workout.findMany({
    where: {
      userId,
      mesocycleId,
    },
    orderBy: [{ scheduledDate: "asc" }, { id: "asc" }],
    select: {
      id: true,
      scheduledDate: true,
      completedAt: true,
      status: true,
      sessionIntent: true,
      selectionMode: true,
      selectionMetadata: true,
      advancesSplit: true,
      mesocyclePhaseSnapshot: true,
      mesocycleWeekSnapshot: true,
      exercises: {
        orderBy: { orderIndex: "asc" },
        select: {
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
            orderBy: { setIndex: "asc" },
            select: {
              setIndex: true,
              logs: {
                orderBy: { completedAt: "desc" },
                take: 1,
                select: {
                  wasSkipped: true,
                  actualReps: true,
                  actualLoad: true,
                  actualRpe: true,
                },
              },
            },
          },
        },
      },
    },
  });
}

export async function loadMesocycleReview(
  client: MesocycleReviewReader,
  input: {
    userId: string;
    mesocycleId: string;
  }
): Promise<MesocycleReviewData | null> {
  const archive = await loadClosedMesocycleArchive(client, input);
  if (!archive?.summary) {
    return null;
  }

  const mesocycle = await loadMesocycleRow(client, input.userId, input.mesocycleId);
  if (!mesocycle) {
    return null;
  }

  const workouts = await loadMesocycleWorkouts(client, input.userId, mesocycle.id);
  const mesoStartDate = buildMesoStartDate(mesocycle.macroCycle.startDate, mesocycle.startWeek);
  const scopedMesocycle = { ...mesocycle, mesoStartDate };

  return {
    mesocycleId: mesocycle.id,
    mesoNumber: mesocycle.mesoNumber,
    focus: mesocycle.focus,
    closedAt: mesocycle.closedAt?.toISOString() ?? null,
    archive: {
      currentState: archive.currentState,
      reviewState: archive.reviewState,
      isEditableHandoff: archive.isEditableHandoff,
    },
    frozenSummary: archive.summary,
    recommendation: buildFrozenRecommendationPresentation({
      recommendationDraft: archive.summary.recommendedNextSeed,
      recommendedDesign: archive.summary.recommendedDesign,
    }),
    derived: {
      scopedWorkoutCount: workouts.length,
      performedWorkoutCount: workouts.filter((workout) => isPerformedWorkoutStatus(workout.status)).length,
      adherence: buildAdherenceSummary(workouts),
      weeklyBreakdown: buildWeekRows(workouts, scopedMesocycle),
      topProgressedExercises: buildTopProgressedExercises(workouts),
      muscleVolumeSummary: buildMuscleVolumeSummary(workouts, mesocycle),
    },
  };
}

export async function loadMesocycleReviewFromPrisma(input: {
  userId: string;
  mesocycleId: string;
}): Promise<MesocycleReviewData | null> {
  return loadMesocycleReview(prisma, input);
}

export function buildMesocycleReviewPlainEnglishSummary(review: MesocycleReviewData): string {
  const closedSessionCount =
    review.frozenSummary.lifecycle.accumulationSessionsCompleted +
    review.frozenSummary.lifecycle.deloadSessionsCompleted;
  return [
    `${review.frozenSummary.lifecycle.durationWeeks} weeks closed`,
    `${closedSessionCount} sessions finished`,
    `core adherence ${formatWholePercent(review.derived.adherence.adherenceRate)}`,
  ].join(" • ");
}
