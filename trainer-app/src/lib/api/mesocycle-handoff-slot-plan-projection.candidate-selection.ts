import type {
  AdaptationType,
  BlockType,
  IntensityBias,
  VolumeTarget,
  WorkoutSessionIntent,
} from "@prisma/client";
import type { WorkoutHistoryEntry, WorkoutPlan } from "@/lib/engine/types";
import type { MacroCycle, Mesocycle as EngineMesocycle } from "@/lib/engine/periodization/types";
import {
  getProjectionPreferredSupportMuscles,
  getProtectedWeekOneCoverageObligations,
  resolveSessionSlotPolicy,
  type ProtectedWeekOneCoverageMuscle,
} from "@/lib/planning/session-slot-profile";
import {
  mapAdaptationType,
  mapBlockType,
  mapIntensityBias,
  mapVolumeTarget,
} from "./periodization-mappers";
import { resolveGenerationPhaseBlockContext } from "./generation-phase-block-context";
import {
  buildMappedGenerationContextFromSnapshot,
  type PreloadedGenerationSnapshot,
} from "./template-session/context-loader";
import type { MappedGenerationContext } from "./template-session/types";
import type { NextMesocycleDesign } from "./mesocycle-handoff-contract";
import {
  projectSuccessorMesocycle,
  type SuccessorMesocycleProjectionSource,
} from "./mesocycle-handoff-projection";
import type { MesocycleSlotSequence } from "./mesocycle-slot-contract";
import {
  mapProjectedWorkoutToSlotPlan,
  type ProjectedSuccessorSlotPlan,
} from "./mesocycle-handoff-slot-plan-projection.seed-serialization";
import {
  computeWorkoutContributionByMuscle,
  countWorkoutExercises,
  countWorkoutWorkingSets,
  evaluateLowerPatternPrimacy,
  evaluateProtectedWeekOneCoverage,
  evaluateUpperProtectedSupportQuality,
  evaluateUpperSupportTypeQuality,
  preservesSlotIdentity,
  ProjectedSlotWorkout,
  scorePreferredSupportContribution,
  scoreProtectedCoverageContribution,
  sumProtectedDeficitToPracticalFloor,
  PRIMARY_WEEK_ONE_SUPPORT_FLOOR_MUSCLES,
  toSessionIntent,
} from "./mesocycle-handoff-slot-plan-projection.coverage-evaluation";

export type SyntheticProjectionContext = {
  mapped: MappedGenerationContext;
  mesocycleId: string;
  lifecycleWeek: number;
};

function toMacroPrimaryGoal(
  primaryGoal: string | null | undefined
): MacroCycle["primaryGoal"] {
  switch (primaryGoal) {
    case "STRENGTH":
    case "STRENGTH_HYPERTROPHY":
      return "strength";
    case "FAT_LOSS":
      return "fat_loss";
    case "GENERAL_HEALTH":
    case "ATHLETICISM":
      return "general_fitness";
    case "HYPERTROPHY":
    default:
      return "hypertrophy";
  }
}

function mapTrainingBlocks(
  mesocycleId: string,
  blocks: Array<{
    blockNumber: number;
    blockType: BlockType;
    startWeek: number;
    durationWeeks: number;
    volumeTarget: VolumeTarget;
    intensityBias: IntensityBias;
    adaptationType: AdaptationType;
  }>
) {
  return blocks.map((block) => ({
    id: `${mesocycleId}:block:${block.blockNumber}`,
    mesocycleId,
    blockNumber: block.blockNumber,
    blockType: mapBlockType(block.blockType),
    startWeek: block.startWeek,
    durationWeeks: block.durationWeeks,
    volumeTarget: mapVolumeTarget(block.volumeTarget),
    intensityBias: mapIntensityBias(block.intensityBias),
    adaptationType: mapAdaptationType(block.adaptationType),
  }));
}

function buildSyntheticSuccessorMacroCycle(input: {
  snapshot: PreloadedGenerationSnapshot;
  projection: ReturnType<typeof projectSuccessorMesocycle>;
  mesocycleId: string;
  now: Date;
}): MacroCycle {
  const mesocycle: EngineMesocycle = {
    id: input.mesocycleId,
    macroCycleId: input.projection.mesocycle.macroCycleId,
    mesoNumber: input.projection.mesocycle.mesoNumber,
    startWeek: input.projection.mesocycle.startWeek,
    durationWeeks: input.projection.mesocycle.durationWeeks,
    focus: input.projection.mesocycle.focus,
    volumeTarget: mapVolumeTarget(input.projection.mesocycle.volumeTarget),
    intensityBias: mapIntensityBias(input.projection.mesocycle.intensityBias),
    blocks: mapTrainingBlocks(input.mesocycleId, input.projection.trainingBlocks),
  };
  const startDate = new Date(input.now);
  const endDate = new Date(input.now);
  endDate.setDate(endDate.getDate() + mesocycle.durationWeeks * 7);

  return {
    id: input.projection.mesocycle.macroCycleId,
    userId: input.snapshot.context.profile?.userId ?? "projection-user",
    startDate,
    endDate,
    durationWeeks: input.projection.mesocycle.startWeek + input.projection.mesocycle.durationWeeks,
    trainingAge:
      input.snapshot.context.profile?.trainingAge?.toLowerCase() as MacroCycle["trainingAge"],
    primaryGoal: toMacroPrimaryGoal(
      input.snapshot.context.goals?.primaryGoal ?? "HYPERTROPHY"
    ),
    mesocycles: [mesocycle],
  };
}

export function buildSyntheticProjectionContext(input: {
  userId: string;
  source: SuccessorMesocycleProjectionSource;
  design: NextMesocycleDesign;
  snapshot: PreloadedGenerationSnapshot;
  now: Date;
}): SyntheticProjectionContext {
  const projection = projectSuccessorMesocycle({
    source: input.source,
    design: input.design,
  });
  const mesocycleId = `${projection.mesocycle.macroCycleId}:handoff-projection:${projection.mesocycle.mesoNumber}`;
  const macroCycle = buildSyntheticSuccessorMacroCycle({
    snapshot: input.snapshot,
    projection,
    mesocycleId,
    now: input.now,
  });
  const syntheticActiveMesocycle = {
    id: mesocycleId,
    macroCycleId: projection.mesocycle.macroCycleId,
    mesoNumber: projection.mesocycle.mesoNumber,
    startWeek: projection.mesocycle.startWeek,
    durationWeeks: projection.mesocycle.durationWeeks,
    focus: projection.mesocycle.focus,
    volumeTarget: projection.mesocycle.volumeTarget,
    intensityBias: projection.mesocycle.intensityBias,
    isActive: true,
    state: "ACTIVE_ACCUMULATION" as const,
    accumulationSessionsCompleted: 0,
    deloadSessionsCompleted: 0,
    sessionsPerWeek: projection.mesocycle.sessionsPerWeek,
    daysPerWeek: projection.mesocycle.daysPerWeek,
    splitType: projection.mesocycle.splitType,
    slotSequenceJson: projection.mesocycle.slotSequence,
    blocks: projection.trainingBlocks.map((block) => ({
      id: `${mesocycleId}:block:${block.blockNumber}`,
      mesocycleId,
      blockNumber: block.blockNumber,
      blockType: block.blockType,
      startWeek: block.startWeek,
      durationWeeks: block.durationWeeks,
      volumeTarget: block.volumeTarget,
      intensityBias: block.intensityBias,
      adaptationType: block.adaptationType,
      createdAt: input.now,
      updatedAt: input.now,
    })),
    createdAt: input.now,
    updatedAt: input.now,
    closedAt: null,
    handoffSummaryJson: null,
    nextSeedDraftJson: null,
    slotPlanSeedJson: null,
  } as unknown as NonNullable<PreloadedGenerationSnapshot["activeMesocycle"]>;
  const phaseBlockContext = resolveGenerationPhaseBlockContext({
    macroCycle,
    activeMesocycle: syntheticActiveMesocycle,
    weekInMeso: 1,
  });

  return {
    mapped: buildMappedGenerationContextFromSnapshot(
      input.userId,
      {
        ...input.snapshot,
        context: {
          ...input.snapshot.context,
          constraints: input.snapshot.context.constraints
            ? {
                ...input.snapshot.context.constraints,
                daysPerWeek: projection.mesocycle.daysPerWeek,
                splitType: projection.mesocycle.splitType,
                weeklySchedule: projection.mesocycle.weeklySchedule,
              }
            : input.snapshot.context.constraints,
        },
        activeMesocycle: syntheticActiveMesocycle,
        rotationContext: new Map(input.snapshot.rotationContext),
        // Seed projection keeps compound continuity anchored, but leaves accessory
        // allocation flexible so Week 1 coverage can be constructed before persistence.
        mesocycleRoleRows: projection.carriedForwardRoles
          .filter((selection) => selection.role === "CORE_COMPOUND")
          .map((selection) => ({
            exerciseId: selection.exerciseId,
            role: selection.role,
            sessionIntent: selection.sessionIntent,
          })),
        phaseBlockContext,
      },
      { anchorWeek: 1 }
    ),
    mesocycleId,
    lifecycleWeek: 1,
  };
}

export function applyProjectedSlotToMappedContext(input: {
  context: SyntheticProjectionContext;
  workout: WorkoutPlan;
  slotPlan: ProjectedSuccessorSlotPlan;
  sessionNumber: number;
  projectedAt: Date;
}) {
  const projectedHistoryEntry: WorkoutHistoryEntry = {
    date: input.projectedAt.toISOString(),
    completed: true,
    status: "COMPLETED",
    advancesSplit: true,
    progressionEligible: true,
    performanceEligible: true,
    selectionMode: "INTENT",
    sessionIntent: toSessionIntent(input.slotPlan.intent),
    mesocycleSnapshot: {
      mesocycleId: input.context.mesocycleId,
      week: input.context.lifecycleWeek,
      session: input.sessionNumber,
      phase: input.context.mapped.cycleContext.phase,
      slotId: input.slotPlan.slotId,
    },
    exercises: [
      ...input.workout.mainLifts,
      ...input.workout.accessories,
    ].map((exercise) => ({
      exerciseId: exercise.exercise.id,
      primaryMuscles: exercise.exercise.primaryMuscles ?? [],
      sets: exercise.sets.map((set) => ({
        exerciseId: exercise.exercise.id,
        setIndex: set.setIndex,
        reps: set.targetReps,
        rpe: set.targetRpe,
        targetLoad: set.targetLoad,
      })),
    })),
  };

  input.context.mapped.history = [...input.context.mapped.history, projectedHistoryEntry];
  for (const exercise of [...input.workout.mainLifts, ...input.workout.accessories]) {
    const previous = input.context.mapped.rotationContext.get(exercise.exercise.name);
    input.context.mapped.rotationContext.set(exercise.exercise.name, {
      lastUsed: input.projectedAt,
      weeksAgo: 0,
      usageCount: (previous?.usageCount ?? 0) + 1,
      trend: previous?.trend ?? "improving",
    });
  }
}

type ProjectedSlotCompositionEvaluation = {
  relevantDeficitCount: number;
  relevantDeficitToPracticalFloor: number;
  primarySupportFloorShortfall: number;
  totalDeficitCount: number;
  totalDeficitToPracticalFloor: number;
  meaningfulSupportQuality: ReturnType<typeof evaluateUpperProtectedSupportQuality>;
  upperSupportTypeQuality: ReturnType<typeof evaluateUpperSupportTypeQuality>;
  lowerPatternPrimacy: ReturnType<typeof evaluateLowerPatternPrimacy>;
  coverage: ReturnType<typeof scoreProtectedCoverageContribution>;
  preferredSupportCoverage: ReturnType<typeof scorePreferredSupportContribution>;
  exerciseCount: number;
  workingSetCount: number;
};

function compareLower(candidateValue: number, bestValue: number): number {
  if (candidateValue < bestValue) {
    return 1;
  }
  if (candidateValue > bestValue) {
    return -1;
  }
  return 0;
}

function compareHigher(candidateValue: number, bestValue: number): number {
  if (candidateValue > bestValue) {
    return 1;
  }
  if (candidateValue < bestValue) {
    return -1;
  }
  return 0;
}

function compareProjectedSlotCompositionEvaluation(
  candidate: ProjectedSlotCompositionEvaluation,
  best: ProjectedSlotCompositionEvaluation
): number {
  const comparisons = [
    compareHigher(
      candidate.meaningfulSupportQuality.meaningfulCoveredMuscleCount,
      best.meaningfulSupportQuality.meaningfulCoveredMuscleCount
    ),
    compareLower(
      candidate.meaningfulSupportQuality.shortfallToFloor,
      best.meaningfulSupportQuality.shortfallToFloor
    ),
    compareLower(
      candidate.primarySupportFloorShortfall,
      best.primarySupportFloorShortfall
    ),
    compareLower(candidate.relevantDeficitCount, best.relevantDeficitCount),
    compareLower(
      candidate.relevantDeficitToPracticalFloor,
      best.relevantDeficitToPracticalFloor
    ),
    compareLower(
      candidate.upperSupportTypeQuality.pushShortfallToFloor,
      best.upperSupportTypeQuality.pushShortfallToFloor
    ),
    compareHigher(
      candidate.upperSupportTypeQuality.directionalCoveredMuscleCount,
      best.upperSupportTypeQuality.directionalCoveredMuscleCount
    ),
    compareLower(
      candidate.upperSupportTypeQuality.redundantPullSupportCount,
      best.upperSupportTypeQuality.redundantPullSupportCount
    ),
    compareHigher(
      candidate.upperSupportTypeQuality.directionalEffectiveSets,
      best.upperSupportTypeQuality.directionalEffectiveSets
    ),
    compareHigher(
      candidate.lowerPatternPrimacy.primaryPatternScore,
      best.lowerPatternPrimacy.primaryPatternScore
    ),
    compareLower(
      candidate.lowerPatternPrimacy.squatDominancePenalty,
      best.lowerPatternPrimacy.squatDominancePenalty
    ),
    compareHigher(
      candidate.lowerPatternPrimacy.hingeCompoundSetCount,
      best.lowerPatternPrimacy.hingeCompoundSetCount
    ),
    compareLower(
      candidate.lowerPatternPrimacy.squatCompoundSetCount,
      best.lowerPatternPrimacy.squatCompoundSetCount
    ),
    compareHigher(
      candidate.meaningfulSupportQuality.totalEffectiveSets,
      best.meaningfulSupportQuality.totalEffectiveSets
    ),
    compareHigher(candidate.coverage.coveredMuscleCount, best.coverage.coveredMuscleCount),
    compareHigher(candidate.coverage.totalCoverage, best.coverage.totalCoverage),
    compareHigher(
      candidate.preferredSupportCoverage.coveredMuscleCount,
      best.preferredSupportCoverage.coveredMuscleCount
    ),
    compareHigher(
      candidate.preferredSupportCoverage.totalCoverage,
      best.preferredSupportCoverage.totalCoverage
    ),
    compareLower(candidate.totalDeficitCount, best.totalDeficitCount),
    compareLower(candidate.totalDeficitToPracticalFloor, best.totalDeficitToPracticalFloor),
    compareLower(candidate.exerciseCount, best.exerciseCount),
    compareLower(candidate.workingSetCount, best.workingSetCount),
  ];

  return comparisons.find((comparison) => comparison !== 0) ?? 0;
}

export function selectBestProjectedSlotComposition(input: {
  candidateWorkouts: Array<{
    workout: WorkoutPlan;
    protectedMuscles: readonly ProtectedWeekOneCoverageMuscle[];
  }>;
  prioritizedProtectedMuscles: readonly ProtectedWeekOneCoverageMuscle[];
  slotPolicy: ReturnType<typeof resolveSessionSlotPolicy>["currentSession"];
  projectedSlots: ReadonlyArray<ProjectedSlotWorkout>;
  activeMesocycle: NonNullable<MappedGenerationContext["activeMesocycle"]>;
  slotSequence: ReadonlyArray<{
    slotId: string;
    intent: WorkoutSessionIntent;
    authoredSemantics?: MesocycleSlotSequence["slots"][number]["authoredSemantics"];
  }>;
  slotId: string;
  intent: WorkoutSessionIntent;
}): WorkoutPlan {
  const prioritizedMuscleSet = new Set(input.prioritizedProtectedMuscles);
  const preferredSupportMuscles = getProjectionPreferredSupportMuscles(input.slotPolicy);
  let bestCandidate = input.candidateWorkouts[0];
  let bestEvaluation: ProjectedSlotCompositionEvaluation | null = null;

  for (const candidate of input.candidateWorkouts) {
    if (
      candidate !== input.candidateWorkouts[0] &&
      !preservesSlotIdentity({ slotPolicy: input.slotPolicy, workout: candidate.workout })
    ) {
      continue;
    }

    const projectedContributionByMuscle = computeWorkoutContributionByMuscle(candidate.workout);
    const hypotheticalEvaluation = evaluateProtectedWeekOneCoverage({
      projectedSlots: [
        ...input.projectedSlots,
        {
          slotPlan: mapProjectedWorkoutToSlotPlan({
            slotId: input.slotId,
            intent: input.intent,
            workout: candidate.workout,
          }),
          workout: candidate.workout,
          projectedContributionByMuscle,
          repairMuscles: [...candidate.protectedMuscles],
        },
      ],
      activeMesocycle: input.activeMesocycle,
      slotSequence: input.slotSequence,
    });
    const relevantDeficits = hypotheticalEvaluation.deficitsBelowPracticalFloor.filter((row) =>
      prioritizedMuscleSet.has(row.muscle)
    );
    const primarySupportFloorShortfall = sumProtectedDeficitToPracticalFloor(
      relevantDeficits.filter((row) => PRIMARY_WEEK_ONE_SUPPORT_FLOOR_MUSCLES.has(row.muscle))
    );
    const coverage = scoreProtectedCoverageContribution({
      contributionByMuscle: projectedContributionByMuscle,
      protectedMuscles: input.prioritizedProtectedMuscles,
    });
    const preferredSupportCoverage = scorePreferredSupportContribution({
      contributionByMuscle: projectedContributionByMuscle,
      preferredMuscles: preferredSupportMuscles,
    });
    const meaningfulSupportQuality = evaluateUpperProtectedSupportQuality({
      slotPolicy: input.slotPolicy,
      contributionByMuscle: projectedContributionByMuscle,
      protectedMuscles: getProtectedWeekOneCoverageObligations(input.slotPolicy),
    });
    const upperSupportTypeQuality = evaluateUpperSupportTypeQuality({
      slotPolicy: input.slotPolicy,
      workout: candidate.workout,
      contributionByMuscle: projectedContributionByMuscle,
    });
    const lowerPatternPrimacy = evaluateLowerPatternPrimacy({
      slotPolicy: input.slotPolicy,
      workout: candidate.workout,
    });
    const evaluationSummary = {
      relevantDeficitCount: relevantDeficits.length,
      relevantDeficitToPracticalFloor: sumProtectedDeficitToPracticalFloor(relevantDeficits),
      primarySupportFloorShortfall,
      totalDeficitCount: hypotheticalEvaluation.deficitsBelowPracticalFloor.length,
      totalDeficitToPracticalFloor: sumProtectedDeficitToPracticalFloor(
        hypotheticalEvaluation.deficitsBelowPracticalFloor
      ),
      meaningfulSupportQuality,
      upperSupportTypeQuality,
      lowerPatternPrimacy,
      coverage,
      preferredSupportCoverage,
      exerciseCount: countWorkoutExercises(candidate.workout),
      workingSetCount: countWorkoutWorkingSets(candidate.workout),
    };

    if (!bestEvaluation || compareProjectedSlotCompositionEvaluation(evaluationSummary, bestEvaluation) > 0) {
      bestCandidate = candidate;
      bestEvaluation = evaluationSummary;
    }
  }

  return bestCandidate.workout;
}
