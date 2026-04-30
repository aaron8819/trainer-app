import type { Prisma } from "@prisma/client";
import type { ReadinessSignal } from "@/lib/engine/readiness/types";
import { getMuscleTargetSemantics } from "@/lib/engine/volume-landmarks";
import type {
  V2BlockResponseSignal,
  V2BlockStrategyImplication,
  V2ExerciseResponseSignal,
  V2ExerciseResponseSignalType,
  V2MesocycleStrategyInput,
  V2ResponseTrend,
} from "@/lib/engine/planning/v2";
import type { MesocycleHandoffSummary } from "./mesocycle-handoff-contract";
import { parseSlotPlanSeedJson } from "./slot-plan-seed-parser";
import {
  loadMesocycleReview,
  type MesocycleReviewData,
  type MesocycleReviewMuscleRow,
} from "./mesocycle-review";

type V2MesocycleStrategyHistoricalReviewReader = Pick<
  Prisma.TransactionClient,
  "mesocycle" | "workout"
>;

type HistoricalMesocycleSeedRow = {
  id: string;
  state: string;
  startWeek: number;
  durationWeeks: number;
  closedAt: Date | null;
  slotPlanSeedJson: unknown;
  macroCycle: {
    startDate: Date;
  };
};

type HistoricalPerformedWorkoutRow = {
  id: string;
  scheduledDate: Date;
  status: string;
  sessionIntent: string | null;
  mesocyclePhaseSnapshot: string | null;
  mesocycleWeekSnapshot: number | null;
  exercises: Array<{
    exerciseId: string;
    exercise: {
      id: string;
      name: string;
      exerciseMuscles: Array<{
        role: "PRIMARY" | "SECONDARY";
        muscle: { name: string };
      }>;
    };
    sets: Array<{
      logs: Array<{
        wasSkipped: boolean;
        actualReps: number | null;
        actualLoad: number | null;
        actualRpe: number | null;
      }>;
    }>;
  }>;
};

type HistoricalPerformedEvidence = {
  skippedSetCount: number;
  skippedSetCountByWeek: Array<{ week: number; skippedSetCount: number }>;
  averageRpeByWeek: Array<{ week: number; averageRpe: number }>;
  exerciseResponseSignals: V2ExerciseResponseSignal[];
  evidenceLimitations: string[];
};

type StrategyTrainingAge =
  V2MesocycleStrategyInput["userProfile"]["trainingAge"];
type HistoricalSourcePlanner =
  V2MesocycleStrategyInput["historicalMesocycles"][number]["sourcePlanner"];
type HistoricalVolumeStatus = NonNullable<
  V2MesocycleStrategyInput["historicalMesocycles"][number]["performedVolumeSummary"]
>[number]["status"];

export type V2MesocycleStrategyProfileEvidence = {
  trainingGoal?: string | null;
  trainingAge?: string | null;
  availableTrainingDays?: number | null;
  equipmentProfile?: string[] | null;
  constraints?: string[] | null;
  preferences?: string[] | null;
  painOrToleranceFlags?: string[] | null;
};

export type V2MesocycleStrategyCurrentContextEvidence = {
  splitType?: string | null;
  currentPhase?: string | null;
  currentMesocycleStatus?: string | null;
  weekCount?: number | null;
  slotSequence?: string[] | null;
  volumeTarget?: string | null;
  intensityBias?: string | null;
};

export type V2MesocycleStrategyHistoricalReviewEvidence = {
  review?: MesocycleReviewData | null;
  mesocycleId?: string;
  sourcePlanner?: HistoricalSourcePlanner;
  status?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  performedEvidence?: HistoricalPerformedEvidence | null;
  blockResponseSignal?: V2BlockResponseSignal | null;
  exerciseResponseSignals?: V2ExerciseResponseSignal[];
  evidenceLimitations?: string[];
};

export type V2MesocycleStrategyHistoricalReviewLoadResult = {
  historicalMesocycleReviews: V2MesocycleStrategyHistoricalReviewEvidence[];
  evidenceLimitations: string[];
};

export type V2MesocycleStrategyInputAdapterInput = {
  userProfile?: V2MesocycleStrategyProfileEvidence | null;
  currentTrainingContext?: V2MesocycleStrategyCurrentContextEvidence | null;
  handoffSummary?: MesocycleHandoffSummary | null;
  historicalMesocycleReviews?: V2MesocycleStrategyHistoricalReviewEvidence[];
  readiness?: ReadinessSignal | null;
  evidenceLimitations?: string[];
};

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(values.filter((value): value is string => Boolean(value))),
  ).sort((left, right) => left.localeCompare(right));
}

function uniqueStringsInOrder(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(values.filter((value): value is string => Boolean(value))),
  );
}

function addWeeks(date: Date, weeks: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + weeks * 7);
  return result;
}

function classifyHistoricalSourcePlanner(
  row: Pick<HistoricalMesocycleSeedRow, "slotPlanSeedJson" | "state">,
): HistoricalSourcePlanner {
  const seed = parseSlotPlanSeedJson(row.slotPlanSeedJson);
  if (!seed) {
    return row.state === "COMPLETED" ? "legacy_projection" : "unknown";
  }
  if (
    seed.acceptedPlannerIntent?.source === "v2_planner_policy" ||
    seed.source === "v2_materialized_seed"
  ) {
    return "v2";
  }
  return "legacy_projection";
}

const FATIGUE_OVERLAP_MUSCLES = new Set([
  "Lower Back",
  "Glutes",
  "Front Delts",
  "Triceps",
  "Lats",
  "Biceps",
]);

function isStrategyRelevantUnderHitMuscle(muscle: string): boolean {
  const targetTier = getMuscleTargetSemantics(muscle).targetTier;
  return targetTier === "A_PRIMARY" || targetTier === "B_SUPPORT";
}

function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

function resolveHistoricalWorkoutWeek(
  workout: Pick<
    HistoricalPerformedWorkoutRow,
    "mesocycleWeekSnapshot" | "scheduledDate"
  >,
  mesocycle: Pick<
    HistoricalMesocycleSeedRow,
    "macroCycle" | "startWeek" | "durationWeeks"
  >,
): number | null {
  if (
    typeof workout.mesocycleWeekSnapshot === "number" &&
    workout.mesocycleWeekSnapshot >= 1 &&
    workout.mesocycleWeekSnapshot <= mesocycle.durationWeeks
  ) {
    return workout.mesocycleWeekSnapshot;
  }

  const start = addWeeks(mesocycle.macroCycle.startDate, mesocycle.startWeek);
  const diffMs = workout.scheduledDate.getTime() - start.getTime();
  const computedWeek = Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000)) + 1;
  return computedWeek >= 1 && computedWeek <= mesocycle.durationWeeks
    ? computedWeek
    : null;
}

function pushMapNumber(
  map: Map<number, number>,
  key: number,
  value: number,
): void {
  map.set(key, (map.get(key) ?? 0) + value);
}

function resolveCountTrend(
  rows: Array<{ week: number; skippedSetCount: number }>,
): V2ResponseTrend {
  if (rows.length === 0) {
    return "unknown";
  }
  const early = rows
    .filter((row) => row.week <= 2)
    .reduce((sum, row) => sum + row.skippedSetCount, 0);
  const late = rows
    .filter((row) => row.week >= 3)
    .reduce((sum, row) => sum + row.skippedSetCount, 0);
  if (early === 0 && late === 0) {
    return "stable";
  }
  if (late >= early + 2 || late >= early * 2) {
    return "rising";
  }
  if (early >= late + 2 || early >= late * 2) {
    return "falling";
  }
  return "stable";
}

function resolveNumericTrend(
  values: number[],
  threshold: number,
): V2ResponseTrend {
  if (values.length < 2) {
    return "unknown";
  }
  const first = values[0];
  const last = values[values.length - 1];
  if (first == null || last == null) {
    return "unknown";
  }
  if (last >= first + threshold) {
    return "rising";
  }
  if (last <= first - threshold) {
    return "falling";
  }
  return "stable";
}

function combineProgressTrend(
  loadTrend: V2ResponseTrend,
  repTrend: V2ResponseTrend,
): V2ResponseTrend {
  if (loadTrend === "rising" || repTrend === "rising") {
    return "rising";
  }
  if (loadTrend === "falling" || repTrend === "falling") {
    return "falling";
  }
  if (loadTrend === "stable" || repTrend === "stable") {
    return "stable";
  }
  return "unknown";
}

function classifyExerciseResponseSignal(input: {
  completedExposureCount: number;
  skippedExposureCount: number;
  loadTrend: V2ResponseTrend;
  repTrend: V2ResponseTrend;
  rpeTrend: V2ResponseTrend;
}): V2ExerciseResponseSignalType {
  if (input.skippedExposureCount >= 2) {
    return "skipped_often";
  }
  if (input.completedExposureCount < 2) {
    return input.completedExposureCount > 0 ? "low_confidence" : "unknown";
  }

  const progressTrend = combineProgressTrend(input.loadTrend, input.repTrend);
  if (progressTrend === "rising") {
    return "progressed";
  }
  if (progressTrend === "falling") {
    return "regressed";
  }
  if (input.rpeTrend === "rising") {
    return "regressed";
  }
  if (input.completedExposureCount >= 3 && progressTrend === "stable") {
    return "stalled";
  }
  return "low_confidence";
}

function confidenceForExerciseResponse(input: {
  signal: V2ExerciseResponseSignalType;
  completedExposureCount: number;
  skippedExposureCount: number;
}): V2MesocycleStrategyInput["userProfile"]["confidence"] {
  if (input.signal === "unknown" || input.signal === "low_confidence") {
    return "low";
  }
  if (
    input.completedExposureCount >= 4 ||
    input.skippedExposureCount >= 3
  ) {
    return "high";
  }
  return input.completedExposureCount >= 2 || input.skippedExposureCount >= 2
    ? "medium"
    : "low";
}

async function loadHistoricalPerformedEvidence(
  reader: V2MesocycleStrategyHistoricalReviewReader,
  input: {
    userId: string;
    mesocycle: HistoricalMesocycleSeedRow;
  },
): Promise<HistoricalPerformedEvidence> {
  const workouts = (await reader.workout.findMany({
    where: {
      userId: input.userId,
      mesocycleId: input.mesocycle.id,
    },
    orderBy: [{ scheduledDate: "asc" }, { id: "asc" }],
    select: {
      id: true,
      scheduledDate: true,
      status: true,
      sessionIntent: true,
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
  })) as HistoricalPerformedWorkoutRow[];

  return buildHistoricalPerformedEvidence({
    mesocycleId: input.mesocycle.id,
    mesocycle: input.mesocycle,
    workouts,
  });
}

function buildHistoricalPerformedEvidence(input: {
  mesocycleId: string;
  mesocycle: HistoricalMesocycleSeedRow;
  workouts: HistoricalPerformedWorkoutRow[];
}): HistoricalPerformedEvidence {
  const skippedSetCountByWeek = new Map<number, number>();
  const rpeByWeek = new Map<number, { total: number; count: number }>();
  const exposuresByExercise = new Map<
    string,
    {
      exerciseId: string;
      exerciseName: string;
      muscleTargets: string[];
      completedLoads: number[];
      completedReps: number[];
      averageRpes: number[];
      completedExposureCount: number;
      skippedExposureCount: number;
    }
  >();

  for (const workout of input.workouts) {
    const week = resolveHistoricalWorkoutWeek(workout, input.mesocycle);
    if (!week) {
      continue;
    }

    for (const workoutExercise of workout.exercises) {
      const key = workoutExercise.exerciseId;
      const muscleTargets = uniqueStringsInOrder(
        workoutExercise.exercise.exerciseMuscles
          .filter((mapping) => mapping.role === "PRIMARY")
          .map((mapping) => mapping.muscle.name),
      );
      const existing = exposuresByExercise.get(key) ?? {
        exerciseId: workoutExercise.exerciseId,
        exerciseName: workoutExercise.exercise.name,
        muscleTargets,
        completedLoads: [] as number[],
        completedReps: [] as number[],
        averageRpes: [] as number[],
        completedExposureCount: 0,
        skippedExposureCount: 0,
      };
      let completedSetCount = 0;
      let skippedSetCount = 0;
      let topLoad: number | null = null;
      let topReps: number | null = null;
      let rpeTotal = 0;
      let rpeCount = 0;

      for (const set of workoutExercise.sets) {
        const log = set.logs[0];
        if (!log) {
          continue;
        }
        if (log.wasSkipped) {
          skippedSetCount += 1;
          continue;
        }
        if (typeof log.actualReps === "number" && log.actualReps > 0) {
          completedSetCount += 1;
          topReps = Math.max(topReps ?? 0, log.actualReps);
        }
        if (typeof log.actualLoad === "number" && log.actualLoad > 0) {
          topLoad = Math.max(topLoad ?? 0, log.actualLoad);
        }
        if (typeof log.actualRpe === "number") {
          rpeTotal += log.actualRpe;
          rpeCount += 1;
          const weekRpe = rpeByWeek.get(week) ?? { total: 0, count: 0 };
          weekRpe.total += log.actualRpe;
          weekRpe.count += 1;
          rpeByWeek.set(week, weekRpe);
        }
      }

      if (skippedSetCount > 0) {
        pushMapNumber(skippedSetCountByWeek, week, skippedSetCount);
        existing.skippedExposureCount += 1;
      }
      if (completedSetCount > 0) {
        existing.completedExposureCount += 1;
        if (topLoad != null) {
          existing.completedLoads.push(topLoad);
        }
        if (topReps != null) {
          existing.completedReps.push(topReps);
        }
        if (rpeCount > 0) {
          existing.averageRpes.push(rpeTotal / rpeCount);
        }
      }
      if (completedSetCount > 0 || skippedSetCount > 0) {
        exposuresByExercise.set(key, existing);
      }
    }
  }

  const skippedRows = Array.from(skippedSetCountByWeek.entries())
    .map(([week, skippedSetCount]) => ({ week, skippedSetCount }))
    .sort((left, right) => left.week - right.week);
  const averageRpeByWeek = Array.from(rpeByWeek.entries())
    .map(([week, row]) => ({
      week,
      averageRpe: roundToTenth(row.total / Math.max(row.count, 1)),
    }))
    .sort((left, right) => left.week - right.week);
  const exerciseResponseSignals = Array.from(exposuresByExercise.values())
    .map((entry): V2ExerciseResponseSignal => {
      const loadTrend = resolveNumericTrend(entry.completedLoads, 2.5);
      const repTrend = resolveNumericTrend(entry.completedReps, 1);
      const rpeTrend = resolveNumericTrend(entry.averageRpes, 1);
      const signal = classifyExerciseResponseSignal({
        completedExposureCount: entry.completedExposureCount,
        skippedExposureCount: entry.skippedExposureCount,
        loadTrend,
        repTrend,
        rpeTrend,
      });
      return {
        exerciseId: entry.exerciseId,
        exerciseName: entry.exerciseName,
        muscleTargets: entry.muscleTargets,
        signal,
        evidence: {
          mesocycleIds: [input.mesocycleId],
          completedExposureCount: entry.completedExposureCount,
          skippedExposureCount: entry.skippedExposureCount,
          loadTrend,
          repTrend,
          rpeTrend,
          notes: [
            "derived_from_performed_logs_not_prescribed_plan_shape",
            signal === "pain_or_tolerance_issue"
              ? "explicit_pain_or_tolerance_evidence_present"
              : "",
          ].filter(Boolean),
        },
        confidence: confidenceForExerciseResponse({
          signal,
          completedExposureCount: entry.completedExposureCount,
          skippedExposureCount: entry.skippedExposureCount,
        }),
      };
    })
    .filter((signal) => signal.signal !== "unknown")
    .sort((left, right) => {
      if (right.confidence !== left.confidence) {
        const rank = { high: 3, medium: 2, low: 1 };
        return rank[right.confidence] - rank[left.confidence];
      }
      return (left.exerciseName ?? "").localeCompare(right.exerciseName ?? "");
    })
    .slice(0, 24);

  return {
    skippedSetCount: skippedRows.reduce(
      (sum, row) => sum + row.skippedSetCount,
      0,
    ),
    skippedSetCountByWeek: skippedRows,
    averageRpeByWeek,
    exerciseResponseSignals,
    evidenceLimitations: uniqueStrings([
      "performed_workout_logs_read_only",
      "exercise_response_uses_performed_exposures_not_prescribed_shape",
      input.workouts.length > 0 ? null : "performed_workout_evidence_missing",
    ]),
  };
}

export async function loadV2MesocycleStrategyHistoricalReviewEvidence(
  reader: V2MesocycleStrategyHistoricalReviewReader,
  input: {
    userId: string;
    limit?: number;
    excludeMesocycleIds?: string[];
  },
): Promise<V2MesocycleStrategyHistoricalReviewLoadResult> {
  const excludedIds = input.excludeMesocycleIds?.filter(Boolean) ?? [];
  const rows = (await reader.mesocycle.findMany({
    where: {
      state: "COMPLETED",
      macroCycle: { userId: input.userId },
      ...(excludedIds.length > 0 ? { id: { notIn: excludedIds } } : {}),
    },
    orderBy: [{ closedAt: "desc" }, { mesoNumber: "desc" }],
    take: input.limit ?? 6,
    select: {
      id: true,
      state: true,
      startWeek: true,
      durationWeeks: true,
      closedAt: true,
      slotPlanSeedJson: true,
      macroCycle: {
        select: {
          startDate: true,
        },
      },
    },
  })) as HistoricalMesocycleSeedRow[];

  const historicalMesocycleReviews = await Promise.all(
    rows.map(async (row) => {
      const [review, performedEvidence] = await Promise.all([
        loadMesocycleReview(reader, {
          userId: input.userId,
          mesocycleId: row.id,
        }),
        loadHistoricalPerformedEvidence(reader, {
          userId: input.userId,
          mesocycle: row,
        }),
      ]);
      const unavailableLimitations = review
        ? []
        : [`historical_mesocycle_review_unavailable:${row.id}`];
      return {
        review,
        mesocycleId: row.id,
        sourcePlanner: classifyHistoricalSourcePlanner(row),
        status: row.state,
        startedAt: addWeeks(row.macroCycle.startDate, row.startWeek).toISOString(),
        completedAt: row.closedAt?.toISOString() ?? null,
        performedEvidence,
        evidenceLimitations: unavailableLimitations,
      } satisfies V2MesocycleStrategyHistoricalReviewEvidence;
    }),
  );

  return {
    historicalMesocycleReviews,
    evidenceLimitations: uniqueStrings([
      "historical_review_loader_read_only",
      "historical_review_loader_uses_performed_reality_not_prescribed_plan_shape",
      "historical_prescribed_plan_shape_excluded_from_strategy_policy",
      "completed_non_v2_historical_mesocycles_labeled_legacy_projection",
      rows.length > 0 ? null : "historical_mesocycle_review_missing",
      ...historicalMesocycleReviews.flatMap(
        (row) => row.evidenceLimitations ?? [],
      ),
    ]),
  };
}

function normalizeTrainingAge(value: string | null | undefined): StrategyTrainingAge {
  const normalized = value?.trim().toLowerCase();
  if (
    normalized === "beginner" ||
    normalized === "intermediate" ||
    normalized === "advanced"
  ) {
    return normalized;
  }
  return value ? "unknown" : undefined;
}

function normalizeSplit(
  value: string | null | undefined,
): V2MesocycleStrategyInput["currentTrainingContext"]["split"] | undefined {
  if (value?.toLowerCase() === "upper_lower") {
    return "upper_lower";
  }
  return value ? "unknown" : undefined;
}

function normalizeNumber(value: number | null | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function profileConfidence(
  profile: V2MesocycleStrategyProfileEvidence | null | undefined,
): V2MesocycleStrategyInput["userProfile"]["confidence"] {
  if (!profile) {
    return "low";
  }

  let score = 0;
  if (profile.trainingGoal) score += 1;
  if (normalizeTrainingAge(profile.trainingAge) != null) score += 1;
  if (normalizeNumber(profile.availableTrainingDays) != null) score += 1;
  if ((profile.equipmentProfile?.length ?? 0) > 0) score += 1;
  if ((profile.constraints?.length ?? 0) > 0) score += 1;
  if ((profile.preferences?.length ?? 0) > 0) score += 1;
  if ((profile.painOrToleranceFlags?.length ?? 0) > 0) score += 1;

  if (score >= 5) {
    return "high";
  }
  return score >= 2 ? "medium" : "low";
}

function buildUserProfile(
  profile: V2MesocycleStrategyProfileEvidence | null | undefined,
): V2MesocycleStrategyInput["userProfile"] {
  const trainingAge = normalizeTrainingAge(profile?.trainingAge);
  return {
    ...(profile?.trainingGoal ? { trainingGoal: profile.trainingGoal } : {}),
    ...(trainingAge ? { trainingAge } : {}),
    ...(normalizeNumber(profile?.availableTrainingDays) != null
      ? { availableTrainingDays: normalizeNumber(profile?.availableTrainingDays) }
      : {}),
    ...((profile?.equipmentProfile?.length ?? 0) > 0
      ? { equipmentProfile: uniqueStrings(profile?.equipmentProfile ?? []) }
      : {}),
    ...((profile?.constraints?.length ?? 0) > 0
      ? { constraints: uniqueStrings(profile?.constraints ?? []) }
      : {}),
    ...((profile?.preferences?.length ?? 0) > 0
      ? { preferences: uniqueStrings(profile?.preferences ?? []) }
      : {}),
    ...((profile?.painOrToleranceFlags?.length ?? 0) > 0
      ? {
          painOrToleranceFlags: uniqueStrings(
            profile?.painOrToleranceFlags ?? [],
          ),
        }
      : {}),
    confidence: profileConfidence(profile),
  };
}

function contextFromHandoff(
  handoffSummary: MesocycleHandoffSummary | null | undefined,
): V2MesocycleStrategyCurrentContextEvidence {
  const design = handoffSummary?.recommendedDesign;
  return {
    splitType:
      design?.structure?.splitType ??
      handoffSummary?.recommendedNextSeed?.structure?.splitType ??
      handoffSummary?.training?.splitType,
    currentMesocycleStatus: handoffSummary?.lifecycle?.terminalState,
    weekCount:
      design?.profile?.durationWeeks ??
      handoffSummary?.lifecycle?.durationWeeks ??
      undefined,
    slotSequence:
      design?.structure?.slots?.map((slot) => slot.slotId) ??
      handoffSummary?.recommendedNextSeed?.structure?.slots?.map(
        (slot) => slot.slotId,
      ),
    volumeTarget: design?.profile?.volumeTarget,
    intensityBias: design?.profile?.intensityBias,
  };
}

function buildCurrentTrainingContext(input: {
  explicit?: V2MesocycleStrategyCurrentContextEvidence | null;
  handoffSummary?: MesocycleHandoffSummary | null;
}): V2MesocycleStrategyInput["currentTrainingContext"] {
  const handoff = contextFromHandoff(input.handoffSummary);
  const explicit = input.explicit ?? {};
  const slotSequence = explicit.slotSequence ?? handoff.slotSequence;
  const split = normalizeSplit(explicit.splitType ?? handoff.splitType);
  const status =
    explicit.currentMesocycleStatus ?? handoff.currentMesocycleStatus;
  const weekCount = normalizeNumber(explicit.weekCount ?? handoff.weekCount);
  const volumeTarget = explicit.volumeTarget ?? handoff.volumeTarget;
  const intensityBias = explicit.intensityBias ?? handoff.intensityBias;
  return {
    ...(split ? { split } : {}),
    ...(explicit.currentPhase ? { currentPhase: explicit.currentPhase } : {}),
    ...(status ? { currentMesocycleStatus: status } : {}),
    ...(weekCount != null ? { weekCount } : {}),
    ...((slotSequence?.length ?? 0) > 0
      ? { slotSequence: uniqueStringsInOrder(slotSequence ?? []) }
      : {}),
    ...(volumeTarget ? { volumeTarget } : {}),
    ...(intensityBias ? { intensityBias } : {}),
  };
}

function mapVolumeStatus(
  row: MesocycleReviewMuscleRow,
): HistoricalVolumeStatus {
  if (row.status === "on_target") {
    return "within";
  }
  if (row.status === "slightly_low" || row.status === "meaningfully_low") {
    return "under";
  }
  if (row.status === "slightly_high" || row.status === "meaningfully_high") {
    return "over";
  }
  return "unknown";
}

function resolveDeloadExecuted(
  review: MesocycleReviewData | null | undefined,
): boolean | undefined {
  const deloadWeeks = review?.derived.weeklyBreakdown.filter(
    (row) => row.phase === "DELOAD",
  );
  if (!deloadWeeks || deloadWeeks.length === 0) {
    return undefined;
  }
  const plannedDeloadSessions = deloadWeeks.reduce(
    (sum, row) => sum + row.plannedSessions,
    0,
  );
  if (plannedDeloadSessions <= 0) {
    return undefined;
  }
  return (
    deloadWeeks.reduce((sum, row) => sum + row.performedSessions, 0) > 0
  );
}

function confidenceForBlockResponse(input: {
  reviewAvailable: boolean;
  hasPerformedLogEvidence: boolean;
  implicationCount: number;
}): V2MesocycleStrategyInput["userProfile"]["confidence"] {
  if (!input.reviewAvailable && !input.hasPerformedLogEvidence) {
    return "low";
  }
  return input.implicationCount >= 2 && input.hasPerformedLogEvidence
    ? "medium"
    : "low";
}

function buildStrategyImplications(input: {
  hasProgressionEvidence: boolean;
  underHitMuscles: string[];
  fatigueDrivers: string[];
  skippedSetTrend: V2ResponseTrend;
  hardWeekEffortReached: boolean | undefined;
  deloadExecuted: boolean | undefined;
}): V2BlockStrategyImplication[] {
  const implications: V2BlockStrategyImplication[] = [];
  if (input.hasProgressionEvidence) {
    implications.push("preserve_successful_progression");
  }
  if (input.skippedSetTrend === "rising") {
    implications.push("cap_late_block_volume");
  }
  if (input.underHitMuscles.length > 0) {
    implications.push("protect_lagging_muscles_earlier");
  }
  if (
    input.fatigueDrivers.length > 0 &&
    (input.skippedSetTrend === "rising" || input.hardWeekEffortReached === true)
  ) {
    implications.push("reduce_axial_or_overlap_fatigue");
  }
  if (input.deloadExecuted === false) {
    implications.push("improve_deload_execution");
  }
  return implications.length > 0 ? implications : ["unknown"];
}

function buildBlockResponseSignal(
  input: V2MesocycleStrategyHistoricalReviewEvidence,
  historicalMesocycle: V2MesocycleStrategyInput["historicalMesocycles"][number],
): V2BlockResponseSignal {
  if (input.blockResponseSignal) {
    return input.blockResponseSignal;
  }

  const performedEvidence = input.performedEvidence ?? null;
  const skippedSetTrend = performedEvidence
    ? resolveCountTrend(performedEvidence.skippedSetCountByWeek)
    : "unknown";
  const averageRpeByWeek = performedEvidence?.averageRpeByWeek ?? [];
  const hardWeekEffortReached =
    averageRpeByWeek.length > 0
      ? averageRpeByWeek.some(
          (row) => row.week >= 3 && row.averageRpe >= 8,
        )
      : undefined;
  const underHitMuscles = uniqueStringsInOrder(
    (historicalMesocycle.performedVolumeSummary ?? []).flatMap((row) =>
      row.status === "under" && isStrategyRelevantUnderHitMuscle(row.muscle)
        ? [row.muscle]
        : [],
    ),
  );
  const overConcentratedMuscles = uniqueStringsInOrder(
    (historicalMesocycle.performedVolumeSummary ?? []).flatMap((row) =>
      row.status === "over" ? [row.muscle] : [],
    ),
  );
  const fatigueDrivers = overConcentratedMuscles.filter((muscle) =>
    FATIGUE_OVERLAP_MUSCLES.has(muscle),
  );
  const deloadExecuted = resolveDeloadExecuted(input.review);
  const hasProgressionEvidence =
    (historicalMesocycle.performanceSignals?.some(
      (signal) => signal.signal === "progressed",
    ) ??
      false) ||
    (performedEvidence?.exerciseResponseSignals.some(
      (signal) => signal.signal === "progressed",
    ) ??
      false) ||
    (input.exerciseResponseSignals?.some(
      (signal) => signal.signal === "progressed",
    ) ??
      false);
  const strategyImplications = buildStrategyImplications({
    hasProgressionEvidence,
    underHitMuscles,
    fatigueDrivers,
    skippedSetTrend,
    hardWeekEffortReached,
    deloadExecuted,
  });
  const actionableImplicationCount = strategyImplications.filter(
    (implication) => implication !== "unknown",
  ).length;

  return {
    mesocycleId: historicalMesocycle.mesocycleId,
    sourcePlanner: historicalMesocycle.sourcePlanner,
    adherence: {
      completedSessions:
        historicalMesocycle.adherenceSummary?.completedSessions,
      partialSessions: historicalMesocycle.adherenceSummary?.partialSessions,
      skippedSessions: historicalMesocycle.adherenceSummary?.skippedSessions,
      skippedSetCount: performedEvidence?.skippedSetCount,
      skippedSetTrend,
    },
    effortProgression: {
      ...(averageRpeByWeek.length > 0 ? { averageRpeByWeek } : {}),
      ...(hardWeekEffortReached != null ? { hardWeekEffortReached } : {}),
      ...(deloadExecuted != null ? { deloadExecuted } : {}),
    },
    muscleDistribution: {
      ...(underHitMuscles.length > 0
        ? {
            recurringUnderHitMuscles: underHitMuscles,
            belowMevFlags: underHitMuscles.map(
              (muscle) => `${muscle}:below_target_or_mev_evidence`,
            ),
          }
        : {}),
      ...(overConcentratedMuscles.length > 0
        ? {
            recurringOverConcentratedMuscles: overConcentratedMuscles,
            overMavFlags: overConcentratedMuscles.map(
              (muscle) => `${muscle}:over_target_or_mav_evidence`,
            ),
          }
        : {}),
    },
    fatigueDistribution: {
      systemicFatigueFlag:
        skippedSetTrend === "rising" && hardWeekEffortReached === true,
      ...(fatigueDrivers.length > 0
        ? { likelyFatigueDrivers: fatigueDrivers }
        : {}),
      evidence: uniqueStringsInOrder([
        skippedSetTrend === "rising" ? "late_block_skipped_sets_rising" : null,
        hardWeekEffortReached ? "hard_week_effort_reached" : null,
        ...fatigueDrivers.map((muscle) => `overlap_fatigue_driver:${muscle}`),
        ...(performedEvidence?.evidenceLimitations ?? []),
      ]),
    },
    strategyImplications,
    confidence: confidenceForBlockResponse({
      reviewAvailable: Boolean(input.review),
      hasPerformedLogEvidence: Boolean(
        performedEvidence &&
          (performedEvidence.skippedSetCount > 0 ||
            performedEvidence.averageRpeByWeek.length > 0 ||
            performedEvidence.exerciseResponseSignals.length > 0),
      ),
      implicationCount: actionableImplicationCount,
    }),
  };
}

function buildHistoricalMesocycle(
  input: V2MesocycleStrategyHistoricalReviewEvidence,
): V2MesocycleStrategyInput["historicalMesocycles"][number] {
  const review = input.review;
  const completedAt = review?.closedAt ?? input.completedAt;
  return {
    mesocycleId: review?.mesocycleId ?? input.mesocycleId ?? "unknown",
    sourcePlanner: input.sourcePlanner ?? "unknown",
    ...(review?.archive.currentState || input.status
      ? { status: review?.archive.currentState ?? input.status ?? undefined }
      : {}),
    ...(input.startedAt ? { startedAt: input.startedAt } : {}),
    ...(completedAt ? { completedAt } : {}),
    ...(review
      ? {
          adherenceSummary: {
            plannedSessions: review.derived.adherence.plannedSessions,
            completedSessions: review.derived.adherence.coreCompletedSessions,
            partialSessions: review.derived.adherence.partialSessions,
            skippedSessions: review.derived.adherence.skippedSessions,
          },
          performedVolumeSummary: review.derived.muscleVolumeSummary.map((row) => ({
            muscle: row.muscle,
            plannedSets: row.targetSets,
            performedSets: row.actualEffectiveSets,
            targetRange: `target:${row.targetSets}`,
            status: mapVolumeStatus(row),
          })),
          performanceSignals: review.derived.topProgressedExercises.map((row) => ({
            exerciseId: row.exerciseId,
            exerciseName: row.exerciseName,
            signal: "progressed" as const,
            confidence: row.exposureCount >= 2 ? "medium" : "low",
          })),
        }
      : {}),
  };
}

function buildReadinessAndRecoverySignals(input: {
  readiness?: ReadinessSignal | null;
  historicalMesocycles: V2MesocycleStrategyInput["historicalMesocycles"];
}): V2MesocycleStrategyInput["readinessAndRecoverySignals"] {
  const readiness = input.readiness;
  const available = readiness
    ? [
        "subjective_readiness",
        "subjective_motivation",
        "subjective_soreness",
        "performance_rpe_deviation",
        "performance_stalls",
        "performance_compliance",
        ...(readiness.whoop ? ["wearable_recovery"] : []),
      ]
    : [];
  const fatigueFlags = readiness
    ? uniqueStrings([
        readiness.subjective.readiness <= 2 ? "low_subjective_readiness" : null,
        readiness.performance.rpeDeviation > 1 ? "elevated_rpe_deviation" : null,
        readiness.performance.stallCount > 0
          ? `performance_stalls:${readiness.performance.stallCount}`
          : null,
        readiness.performance.volumeComplianceRate < 0.8
          ? "low_recent_volume_compliance"
          : null,
      ])
    : [];
  const soreness = readiness?.subjective.soreness ?? {};
  const painFlags = uniqueStrings(
    Object.entries(soreness).flatMap(([bodyPart, severity]) =>
      severity >= 2 ? [`soreness:${bodyPart}:${severity}`] : [],
    ),
  );
  const adherenceFlags = uniqueStrings(
    input.historicalMesocycles.flatMap((mesocycle) => {
      const adherence = mesocycle.adherenceSummary;
      const planned = adherence?.plannedSessions ?? 0;
      const completed = adherence?.completedSessions ?? 0;
      if (planned <= 0) {
        return [];
      }
      return completed / planned < 0.8
        ? [`historical_adherence_below_80_percent:${mesocycle.mesocycleId}`]
        : [];
    }),
  );

  return {
    available,
    missing: uniqueStrings([
      readiness ? null : "latest_readiness_signal",
      readiness?.whoop ? null : "wearable_recovery_signal",
      "exercise_level_pain_or_tolerance_history",
    ]),
    ...(fatigueFlags.length > 0 ? { fatigueFlags } : {}),
    ...(painFlags.length > 0 ? { painFlags } : {}),
    ...(adherenceFlags.length > 0 ? { adherenceFlags } : {}),
  };
}

function buildEvidenceLimitations(input: {
  profile?: V2MesocycleStrategyProfileEvidence | null;
  currentTrainingContext: V2MesocycleStrategyInput["currentTrainingContext"];
  historicalMesocycles: V2MesocycleStrategyInput["historicalMesocycles"];
  readiness?: ReadinessSignal | null;
  explicitLimitations?: string[];
}): string[] {
  return uniqueStrings([
    ...(input.explicitLimitations ?? []),
    "strategy_input_adapter_is_read_only",
    "strategy_input_does_not_feed_mesocycle_demand",
    "adapter_does_not_use_owner_identity",
    "pain_or_tolerance_requires_explicit_evidence",
    "swapped_out_only_available_when_explicitly_detectable",
    input.profile ? null : "user_profile_evidence_missing",
    input.profile?.trainingGoal ? null : "training_goal_missing",
    input.profile?.trainingAge ? null : "training_age_missing",
    input.profile?.equipmentProfile?.length
      ? null
      : "equipment_profile_missing",
    input.currentTrainingContext.split ? null : "current_split_missing",
    input.currentTrainingContext.slotSequence?.length
      ? null
      : "slot_sequence_missing",
    input.historicalMesocycles.length > 0
      ? "historical_mesocycles_are_validation_data_not_policy_targets"
      : "historical_mesocycle_review_missing",
    input.readiness ? null : "readiness_signal_missing_or_stale",
  ]);
}

export function buildV2MesocycleStrategyInputFromReadModels(
  input: V2MesocycleStrategyInputAdapterInput,
): V2MesocycleStrategyInput {
  const historicalReviewInputs = input.historicalMesocycleReviews ?? [];
  const historicalMesocycles = historicalReviewInputs.map(
    buildHistoricalMesocycle,
  );
  const blockResponseSignals = historicalReviewInputs.map((reviewInput, index) =>
    buildBlockResponseSignal(reviewInput, historicalMesocycles[index] ?? {
      mesocycleId: reviewInput.mesocycleId ?? "unknown",
      sourcePlanner: reviewInput.sourcePlanner ?? "unknown",
    }),
  );
  const exerciseResponseSignals = historicalReviewInputs.flatMap(
    (reviewInput) => [
      ...(reviewInput.performedEvidence?.exerciseResponseSignals ?? []),
      ...(reviewInput.exerciseResponseSignals ?? []),
    ],
  );
  const currentTrainingContext = buildCurrentTrainingContext({
    explicit: input.currentTrainingContext,
    handoffSummary: input.handoffSummary,
  });

  return {
    version: 1,
    userProfile: buildUserProfile(input.userProfile),
    currentTrainingContext,
    historicalMesocycles,
    blockResponseSignals,
    exerciseResponseSignals,
    readinessAndRecoverySignals: buildReadinessAndRecoverySignals({
      readiness: input.readiness,
      historicalMesocycles,
    }),
    evidenceLimitations: buildEvidenceLimitations({
      profile: input.userProfile,
      currentTrainingContext,
      historicalMesocycles,
      readiness: input.readiness,
      explicitLimitations: [
        ...(input.evidenceLimitations ?? []),
        ...historicalReviewInputs.flatMap(
          (row) => row.performedEvidence?.evidenceLimitations ?? [],
        ),
      ],
    }),
  };
}
