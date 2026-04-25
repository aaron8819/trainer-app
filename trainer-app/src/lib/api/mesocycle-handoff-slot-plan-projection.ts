import type {
  AdaptationType,
  BlockType,
  IntensityBias,
  MesocycleExerciseRoleType,
  VolumeTarget,
  WorkoutSessionIntent,
} from "@prisma/client";
import type { WorkoutExercise, WorkoutHistoryEntry, WorkoutPlan, WorkoutSet } from "@/lib/engine/types";
import type { MacroCycle, Mesocycle as EngineMesocycle } from "@/lib/engine/periodization/types";
import { VOLUME_LANDMARKS } from "@/lib/engine/volume-landmarks";
import { getEffectiveStimulusByMuscle } from "@/lib/engine/stimulus";
import {
  doesExerciseSatisfyRequiredSessionShapePattern,
  getProjectionPreferredSupportMuscles,
  getProtectedWeekOneCoverageObligations,
  getProjectionRepairCompatibleMuscles,
  getProjectionSoftPreferredSupportMuscles,
  resolveSessionSlotPolicy,
  type ProtectedWeekOneCoverageMuscle,
} from "@/lib/planning/session-slot-profile";
import {
  mapAdaptationType,
  mapBlockType,
  mapIntensityBias,
  mapVolumeTarget,
} from "./periodization-mappers";
import {
  resolveGenerationPhaseBlockContext,
} from "./generation-phase-block-context";
import {
  buildMappedGenerationContextFromSnapshot,
  type PreloadedGenerationSnapshot,
} from "./template-session/context-loader";
import type { MappedGenerationContext } from "./template-session/types";
import type { SessionIntent } from "@/lib/engine/session-types";
import { composeIntentSessionFromMappedContext } from "./template-session";
import type { NextMesocycleDesign } from "./mesocycle-handoff-contract";
import {
  projectSuccessorMesocycle,
  type SuccessorMesocycleProjectionSource,
} from "./mesocycle-handoff-projection";
import type { MesocycleSlotSequence } from "./mesocycle-slot-contract";
import { getWeeklyVolumeTarget } from "./mesocycle-lifecycle";
import { SESSION_CAPS } from "./template-session/selection-adapter";
import { getWeekOneSupportFloor } from "./template-session/role-budgeting";
import {
  ACCESSORY_LANE_MUSCLES,
  selectAccessoryLaneInsertion,
} from "@/lib/planning/accessory-lane";

export type ProjectedSuccessorSlotPlanExercise = {
  exerciseId: string;
  name: string;
  role: MesocycleExerciseRoleType;
  setCount: number;
};

export type ProjectedSuccessorSlotPlan = {
  slotId: string;
  intent: WorkoutSessionIntent;
  exercises: ProjectedSuccessorSlotPlanExercise[];
};

export type MesocycleSlotPlanSeedExercise = {
  exerciseId: string;
  role: MesocycleExerciseRoleType;
  setCount: number;
};

export type SuccessorSlotPlanProjection = {
  slotPlans: ProjectedSuccessorSlotPlan[];
  diagnostics?: {
    protectedCoverage: {
      beforeRepair: ProtectedWeekOneCoverageEvaluation;
      afterRepair: ProtectedWeekOneCoverageEvaluation;
      attemptedRepair: boolean;
      repairedSlotIds: string[];
      slotRepairMuscles: Record<string, ProtectedWeekOneCoverageMuscle[]>;
      supportFloorRepairReasons: Partial<Record<ProtectedWeekOneCoverageMuscle, SupportFloorRepairReason[]>>;
      unresolvedProtectedMuscles: ProtectedWeekOneCoverageMuscle[];
    };
  };
};

type FailedSuccessorSlotPlanProjection = {
  error: string;
  slotPlans?: ProjectedSuccessorSlotPlan[];
  diagnostics?: SuccessorSlotPlanProjection["diagnostics"];
};

export type MesocycleSlotPlanSeed = {
  version: 1;
  source: "handoff_slot_plan_projection";
  slots: Array<{
    slotId: string;
    exercises: MesocycleSlotPlanSeedExercise[];
  }>;
  diagnostics?: {
    projectionStatus: "partial_acceptable";
    protectedCoverage?: {
      unresolvedProtectedMuscles: ProtectedWeekOneCoverageMuscle[];
      supportFloorRepairReasons: Partial<Record<ProtectedWeekOneCoverageMuscle, SupportFloorRepairReason[]>>;
    };
  };
};

type SyntheticProjectionContext = {
  mapped: MappedGenerationContext;
  mesocycleId: string;
  lifecycleWeek: number;
};

type ProjectedSlotWorkout = {
  slotPlan: ProjectedSuccessorSlotPlan;
  workout: WorkoutPlan;
  projectedContributionByMuscle: Map<string, number>;
  repairMuscles: ProtectedWeekOneCoverageMuscle[];
};

type ProtectedWeekOneCoverageRow = {
  muscle: ProtectedWeekOneCoverageMuscle;
  mev: number;
  weeklyTarget: number;
  practicalFloor: number;
  projectedEffectiveSets: number;
  deficitToMev: number;
  deficitToTarget: number;
  deficitToPracticalFloor: number;
  belowMev: boolean;
  belowPracticalFloor: boolean;
  compatibleSlotIds: string[];
};

type ProtectedWeekOneCoverageEvaluation = {
  muscles: ProtectedWeekOneCoverageRow[];
  deficitsBelowMev: ProtectedWeekOneCoverageRow[];
  deficitsBelowPracticalFloor: ProtectedWeekOneCoverageRow[];
  unresolvedProtectedMuscles: ProtectedWeekOneCoverageMuscle[];
};

type SupportFloorRepairReason =
  | "existing_accessory_set_bump"
  | "support_accessory_replacement"
  | "capacity_blocked"
  | "no_compatible_exercise"
  | "slot_identity_blocked"
  | "exercise_cap_blocked"
  | "effective_weight_shortfall";

const PROTECTED_WEEK_ONE_COVERAGE_MUSCLES: ProtectedWeekOneCoverageMuscle[] = [
  "Chest",
  "Triceps",
  "Side Delts",
  "Rear Delts",
  "Biceps",
  "Hamstrings",
  "Calves",
];
const MEANINGFUL_UPPER_PROTECTED_SUPPORT_FLOOR = 2;
const UPPER_PROTECTED_SUPPORT_MUSCLES = new Set<ProtectedWeekOneCoverageMuscle>([
  "Chest",
  "Triceps",
  "Side Delts",
  "Rear Delts",
]);
const PRIMARY_WEEK_ONE_SUPPORT_FLOOR_MUSCLES = new Set<ProtectedWeekOneCoverageMuscle>([
  "Calves",
  "Side Delts",
]);
const WEEK_ONE_SUPPORT_FLOOR_REPAIR_PRIORITY: ProtectedWeekOneCoverageMuscle[] = [
  "Calves",
  "Side Delts",
  "Hamstrings",
  "Biceps",
  "Triceps",
  "Rear Delts",
];
const MAX_PROJECTED_SUPPORT_FLOOR_SET_BUMP = 2;
const SUPPORT_FLOOR_EPSILON = 1e-9;

function slotIdsAlignWithSlotSequence(input: {
  slotSequence: MesocycleSlotSequence;
  slotPlans: ReadonlyArray<ProjectedSuccessorSlotPlan>;
}): boolean {
  const sequenceSlotIds = input.slotSequence.slots.map((slot) => slot.slotId);
  const projectedSlotIds = input.slotPlans.map((slot) => slot.slotId);

  return (
    sequenceSlotIds.length === projectedSlotIds.length &&
    sequenceSlotIds.every((slotId, index) => projectedSlotIds[index] === slotId)
  );
}

export function buildMesocycleSlotPlanSeed(input: {
  slotSequence: MesocycleSlotSequence;
  slotPlans: ReadonlyArray<ProjectedSuccessorSlotPlan>;
  diagnostics?: MesocycleSlotPlanSeed["diagnostics"];
}): MesocycleSlotPlanSeed {
  if (!slotIdsAlignWithSlotSequence(input)) {
    throw new Error("MESOCYCLE_SLOT_PLAN_SEED_ALIGNMENT_INVALID");
  }

  return {
    version: 1,
    source: "handoff_slot_plan_projection",
    slots: input.slotPlans.map((slotPlan) => ({
      slotId: slotPlan.slotId,
      exercises: slotPlan.exercises.map((exercise) => {
        const name = exercise.name.trim();
        if (!name) {
          throw new Error("MESOCYCLE_SLOT_PLAN_SEED_EXERCISE_NAME_INVALID");
        }
        if (!Number.isInteger(exercise.setCount) || exercise.setCount <= 0) {
          throw new Error("MESOCYCLE_SLOT_PLAN_SEED_SET_COUNT_INVALID");
        }
        return {
          exerciseId: exercise.exerciseId,
          name,
          role: exercise.role,
          setCount: exercise.setCount,
        };
      }),
    })),
    ...(input.diagnostics ? { diagnostics: input.diagnostics } : {}),
  };
}

function toSessionIntent(intent: WorkoutSessionIntent) {
  return intent.toLowerCase() as SessionIntent;
}

function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

function computeWorkoutContributionByMuscle(workout: WorkoutPlan): Map<string, number> {
  const contributionByMuscle = new Map<string, number>();

  for (const exercise of [...workout.mainLifts, ...workout.accessories]) {
    const setCount = exercise.sets.length;
    if (setCount <= 0) {
      continue;
    }

    for (const [muscle, effectiveSets] of getEffectiveStimulusByMuscle(
      exercise.exercise,
      setCount
    )) {
      contributionByMuscle.set(
        muscle,
        (contributionByMuscle.get(muscle) ?? 0) + effectiveSets
      );
    }
  }

  return contributionByMuscle;
}

function computeProjectedWeeklyContributionByMuscle(input: {
  projectedSlots: ReadonlyArray<ProjectedSlotWorkout>;
  currentSlotContribution: ReadonlyMap<string, number>;
}): Map<string, number> {
  const contributionByMuscle = new Map<string, number>();

  for (const projectedSlot of input.projectedSlots) {
    for (const [muscle, effectiveSets] of projectedSlot.projectedContributionByMuscle) {
      contributionByMuscle.set(muscle, (contributionByMuscle.get(muscle) ?? 0) + effectiveSets);
    }
  }
  for (const [muscle, effectiveSets] of input.currentSlotContribution) {
    contributionByMuscle.set(muscle, (contributionByMuscle.get(muscle) ?? 0) + effectiveSets);
  }

  return contributionByMuscle;
}

function computeProjectedWeeklyContributionWithWorkout(input: {
  projectedSlots: ReadonlyArray<ProjectedSlotWorkout>;
  workout: WorkoutPlan;
}): Map<string, number> {
  return computeProjectedWeeklyContributionByMuscle({
    projectedSlots: input.projectedSlots,
    currentSlotContribution: computeWorkoutContributionByMuscle(input.workout),
  });
}

function addSupportFloorRepairReason(
  reasons: Partial<Record<ProtectedWeekOneCoverageMuscle, SupportFloorRepairReason[]>>,
  muscle: ProtectedWeekOneCoverageMuscle,
  reason: SupportFloorRepairReason
) {
  const existing = reasons[muscle] ?? [];
  if (!existing.includes(reason)) {
    reasons[muscle] = [...existing, reason];
  }
}

function mergeSupportFloorRepairReasons(
  target: Partial<Record<ProtectedWeekOneCoverageMuscle, SupportFloorRepairReason[]>>,
  source: Partial<Record<ProtectedWeekOneCoverageMuscle, SupportFloorRepairReason[]>>
) {
  for (const [muscle, reasons] of Object.entries(source) as Array<
    [ProtectedWeekOneCoverageMuscle, SupportFloorRepairReason[] | undefined]
  >) {
    for (const reason of reasons ?? []) {
      addSupportFloorRepairReason(target, muscle, reason);
    }
  }
}

function sortSupportFloorDeficits(
  rows: ReadonlyArray<ProtectedWeekOneCoverageRow>
): ProtectedWeekOneCoverageRow[] {
  return [...rows]
    .filter((row) => isRepairableProtectedCoverageDeficit(row))
    .sort((left, right) => {
      const leftPriority = WEEK_ONE_SUPPORT_FLOOR_REPAIR_PRIORITY.indexOf(left.muscle);
      const rightPriority = WEEK_ONE_SUPPORT_FLOOR_REPAIR_PRIORITY.indexOf(right.muscle);
      const normalizedLeftPriority =
        leftPriority >= 0 ? leftPriority : WEEK_ONE_SUPPORT_FLOOR_REPAIR_PRIORITY.length;
      const normalizedRightPriority =
        rightPriority >= 0 ? rightPriority : WEEK_ONE_SUPPORT_FLOOR_REPAIR_PRIORITY.length;
      if (normalizedLeftPriority !== normalizedRightPriority) {
        return normalizedLeftPriority - normalizedRightPriority;
      }
      return right.deficitToPracticalFloor - left.deficitToPracticalFloor;
    });
}

function isRepairableProtectedCoverageDeficit(row: ProtectedWeekOneCoverageRow): boolean {
  return getWeekOneSupportFloor(row.muscle) != null || row.muscle === "Hamstrings";
}

function buildAccessoryLaneWeeklyTargets(
  activeMesocycle: NonNullable<MappedGenerationContext["activeMesocycle"]>
): Map<string, number> {
  return new Map(
    ACCESSORY_LANE_MUSCLES.map((muscle) => [
      muscle,
      getWeeklyVolumeTarget(activeMesocycle, muscle, 1),
    ])
  );
}

function buildSlotSequenceEntries(
  slotSequence: ReadonlyArray<{
    slotId: string;
    intent: WorkoutSessionIntent;
    authoredSemantics?: MesocycleSlotSequence["slots"][number]["authoredSemantics"];
  }>
) {
  return slotSequence.map((slot, sequenceIndex) => ({
    slotId: slot.slotId,
    intent: slot.intent,
    sequenceIndex,
    authoredSemantics: slot.authoredSemantics,
  }));
}

function evaluateProtectedWeekOneCoverage(input: {
  projectedSlots: ReadonlyArray<ProjectedSlotWorkout>;
  activeMesocycle: NonNullable<MappedGenerationContext["activeMesocycle"]>;
  slotSequence: ReadonlyArray<{
    slotId: string;
    intent: WorkoutSessionIntent;
    authoredSemantics?: MesocycleSlotSequence["slots"][number]["authoredSemantics"];
  }>;
}): ProtectedWeekOneCoverageEvaluation {
  const projectedTotals = new Map<string, number>();
  const slotSequenceEntries = buildSlotSequenceEntries(input.slotSequence);

  for (const projectedSlot of input.projectedSlots) {
    for (const [muscle, effectiveSets] of projectedSlot.projectedContributionByMuscle) {
      projectedTotals.set(muscle, (projectedTotals.get(muscle) ?? 0) + effectiveSets);
    }
  }

  const muscles = PROTECTED_WEEK_ONE_COVERAGE_MUSCLES.map((muscle) => {
    const compatibleSlots = input.slotSequence
      .map((slot) => {
        const slotPolicy = resolveSessionSlotPolicy({
          sessionIntent: toSessionIntent(slot.intent),
          slotId: slot.slotId,
          slotSequence: {
            slots: slotSequenceEntries,
          },
        }).currentSession;
        const compatibleMuscles = getProjectionRepairCompatibleMuscles(slotPolicy, [muscle]);
        return compatibleMuscles.includes(muscle)
          ? { slotId: slot.slotId, sessionIntent: slotPolicy?.sessionIntent }
          : null;
      })
      .filter(
        (slot): slot is { slotId: string; sessionIntent: SessionIntent | undefined } =>
          Boolean(slot)
      );
    const mev = VOLUME_LANDMARKS[muscle].mev;
    const weeklyTarget = getWeeklyVolumeTarget(input.activeMesocycle, muscle, 1);
    const usesUpperSupportFloor =
      UPPER_PROTECTED_SUPPORT_MUSCLES.has(muscle) &&
      compatibleSlots.some((slot) => slot.sessionIntent === "upper");
    const supportFloor = getWeekOneSupportFloor(muscle);
    const practicalFloor =
      supportFloor ??
      (usesUpperSupportFloor
        ? MEANINGFUL_UPPER_PROTECTED_SUPPORT_FLOOR
        : Math.max(mev, weeklyTarget));
    const projectedEffectiveSets = projectedTotals.get(muscle) ?? 0;
    const deficitToMev = Math.max(0, mev - projectedEffectiveSets);
    const deficitToTarget = Math.max(0, weeklyTarget - projectedEffectiveSets);
    const deficitToPracticalFloor = Math.max(0, practicalFloor - projectedEffectiveSets);

    return {
      muscle,
      mev,
      weeklyTarget,
      practicalFloor: roundToTenth(practicalFloor),
      projectedEffectiveSets: roundToTenth(projectedEffectiveSets),
      deficitToMev: roundToTenth(deficitToMev),
      deficitToTarget: roundToTenth(deficitToTarget),
      deficitToPracticalFloor: roundToTenth(deficitToPracticalFloor),
      belowMev: deficitToMev > 0,
      belowPracticalFloor: deficitToPracticalFloor > 0,
      compatibleSlotIds: compatibleSlots.map((slot) => slot.slotId),
    } satisfies ProtectedWeekOneCoverageRow;
  });

  const deficitsBelowMev = muscles.filter((muscle) => muscle.belowMev);
  const deficitsBelowPracticalFloor = muscles.filter((muscle) => muscle.belowPracticalFloor);
  return {
    muscles,
    deficitsBelowMev,
    deficitsBelowPracticalFloor,
    unresolvedProtectedMuscles: deficitsBelowPracticalFloor.map((muscle) => muscle.muscle),
  };
}

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

function buildSyntheticProjectionContext(input: {
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

function mapWorkoutExercisesToProjectedSlotPlan(
  workoutExercises: WorkoutExercise[],
  role: MesocycleExerciseRoleType
): ProjectedSuccessorSlotPlanExercise[] {
  return workoutExercises.map((exercise) => ({
    exerciseId: exercise.exercise.id,
    name: exercise.exercise.name,
    role,
    setCount: exercise.sets.length,
  }));
}

function mapProjectedWorkoutToSlotPlan(input: {
  slotId: string;
  intent: WorkoutSessionIntent;
  workout: WorkoutPlan;
}): ProjectedSuccessorSlotPlan {
  return {
    slotId: input.slotId,
    intent: input.intent,
    exercises: [
      ...mapWorkoutExercisesToProjectedSlotPlan(input.workout.mainLifts, "CORE_COMPOUND"),
      ...mapWorkoutExercisesToProjectedSlotPlan(input.workout.accessories, "ACCESSORY"),
    ],
  };
}

function applyProjectedSlotToMappedContext(input: {
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

function scoreProtectedCoverageContribution(input: {
  contributionByMuscle: Map<string, number>;
  protectedMuscles: readonly ProtectedWeekOneCoverageMuscle[];
}) {
  const coveredMuscleCount = input.protectedMuscles.filter(
    (muscle) => (input.contributionByMuscle.get(muscle) ?? 0) > 0
  ).length;
  const totalCoverage = input.protectedMuscles.reduce(
    (sum, muscle) => sum + (input.contributionByMuscle.get(muscle) ?? 0),
    0
  );

  return {
    coveredMuscleCount,
    totalCoverage,
  };
}

export function evaluateUpperProtectedSupportQuality(input: {
  slotPolicy: ReturnType<typeof resolveSessionSlotPolicy>["currentSession"];
  contributionByMuscle: ReadonlyMap<string, number>;
  protectedMuscles?: readonly ProtectedWeekOneCoverageMuscle[];
}) {
  const protectedMuscles =
    input.protectedMuscles && input.protectedMuscles.length > 0
      ? Array.from(new Set(input.protectedMuscles))
      : getProtectedWeekOneCoverageObligations(input.slotPolicy);

  if (input.slotPolicy?.sessionIntent !== "upper" || protectedMuscles.length === 0) {
    return {
      isRelevant: false,
      satisfied: true,
      meaningfulCoveredMuscleCount: 0,
      totalEffectiveSets: 0,
      shortfallToFloor: 0,
      missingMuscles: [] as ProtectedWeekOneCoverageMuscle[],
    };
  }

  let totalEffectiveSets = 0;
  let shortfallToFloor = 0;
  const missingMuscles: ProtectedWeekOneCoverageMuscle[] = [];

  for (const muscle of protectedMuscles) {
    const effectiveSets = input.contributionByMuscle.get(muscle) ?? 0;
    totalEffectiveSets += effectiveSets;
    if (effectiveSets < MEANINGFUL_UPPER_PROTECTED_SUPPORT_FLOOR) {
      shortfallToFloor += MEANINGFUL_UPPER_PROTECTED_SUPPORT_FLOOR - effectiveSets;
      missingMuscles.push(muscle);
    }
  }

  return {
    isRelevant: true,
    satisfied: missingMuscles.length === 0,
    meaningfulCoveredMuscleCount: protectedMuscles.length - missingMuscles.length,
    totalEffectiveSets,
    shortfallToFloor: roundToTenth(shortfallToFloor),
    missingMuscles,
  };
}

function normalizeMuscleName(muscle: string): string {
  return muscle.trim().toLowerCase();
}

function scorePreferredSupportContribution(input: {
  contributionByMuscle: Map<string, number>;
  preferredMuscles: readonly string[];
}) {
  const normalizedPreferredMuscles = Array.from(
    new Set(input.preferredMuscles.map(normalizeMuscleName))
  );
  const coveredMuscleCount = normalizedPreferredMuscles.filter((muscle) =>
    Array.from(input.contributionByMuscle.entries()).some(
      ([contributionMuscle, effectiveSets]) =>
        normalizeMuscleName(contributionMuscle) === muscle && effectiveSets > 0
    )
  ).length;
  const totalCoverage = Array.from(input.contributionByMuscle.entries()).reduce(
    (sum, [muscle, effectiveSets]) =>
      normalizedPreferredMuscles.includes(normalizeMuscleName(muscle))
        ? sum + effectiveSets
        : sum,
    0
  );

  return {
    coveredMuscleCount,
    totalCoverage,
  };
}

function countWorkoutExercises(workout: WorkoutPlan): number {
  return workout.mainLifts.length + workout.accessories.length;
}

function countWorkoutWorkingSets(workout: WorkoutPlan): number {
  return [...workout.mainLifts, ...workout.accessories].reduce(
    (sum, exercise) => sum + exercise.sets.length,
    0
  );
}

function getWorkoutExercises(workout: WorkoutPlan): WorkoutExercise[] {
  return [...workout.mainLifts, ...workout.accessories];
}

function exerciseMatchesMovementPattern(
  exercise: Pick<WorkoutExercise["exercise"], "movementPatterns">,
  pattern: string
): boolean {
  return (exercise.movementPatterns ?? []).includes(
    pattern as NonNullable<WorkoutExercise["exercise"]["movementPatterns"]>[number]
  );
}

function exerciseHasPrimaryMuscle(
  exercise: Pick<WorkoutExercise["exercise"], "primaryMuscles">,
  muscle: string
): boolean {
  return (exercise.primaryMuscles ?? []).some(
    (primaryMuscle) => normalizeMuscleName(primaryMuscle) === normalizeMuscleName(muscle)
  );
}

function exerciseHasAnyPrimaryMuscle(
  exercise: Pick<WorkoutExercise["exercise"], "primaryMuscles">,
  muscles: readonly string[]
): boolean {
  return muscles.some((muscle) => exerciseHasPrimaryMuscle(exercise, muscle));
}

function getRequiredMovementPatternCount(input: {
  slotPolicy: ReturnType<typeof resolveSessionSlotPolicy>["currentSession"];
  pattern: string;
}): number {
  return (input.slotPolicy?.sessionShape?.requiredMovementPatterns ?? []).filter(
    (requiredPattern) => requiredPattern === input.pattern
  ).length;
}

export function evaluateUpperSupportTypeQuality(input: {
  slotPolicy: ReturnType<typeof resolveSessionSlotPolicy>["currentSession"];
  workout: WorkoutPlan;
  contributionByMuscle: ReadonlyMap<string, number>;
}) {
  const slotPolicy = input.slotPolicy;
  if (slotPolicy?.sessionShape?.id !== "upper_horizontal_balanced") {
    return {
      isRelevant: false,
      pushShortfallToFloor: 0,
      directionalCoveredMuscleCount: 0,
      directionalEffectiveSets: 0,
      redundantPullSupportCount: 0,
    };
  }

  const pushSupportMuscles: ProtectedWeekOneCoverageMuscle[] = ["Chest", "Triceps"];
  const directionalSupportMuscles: ProtectedWeekOneCoverageMuscle[] = [
    "Chest",
    "Triceps",
    "Rear Delts",
  ];
  const pushShortfallToFloor = pushSupportMuscles.reduce((shortfall, muscle) => {
    const effectiveSets = input.contributionByMuscle.get(muscle) ?? 0;
    return shortfall + Math.max(0, MEANINGFUL_UPPER_PROTECTED_SUPPORT_FLOOR - effectiveSets);
  }, 0);
  const directionalCoveredMuscleCount = directionalSupportMuscles.filter(
    (muscle) =>
      (input.contributionByMuscle.get(muscle) ?? 0) >=
      MEANINGFUL_UPPER_PROTECTED_SUPPORT_FLOOR
  ).length;
  const directionalEffectiveSets = directionalSupportMuscles.reduce(
    (sum, muscle) => sum + (input.contributionByMuscle.get(muscle) ?? 0),
    0
  );
  const pullPatterns = ["horizontal_pull", "vertical_pull"];
  const redundantPullSupportCount = pullPatterns.reduce((total, pattern) => {
    const allowedPatternCount = getRequiredMovementPatternCount({ slotPolicy, pattern });
    const nonDirectionalPullCount = getWorkoutExercises(input.workout).filter((exercise) => {
      if (!exerciseMatchesMovementPattern(exercise.exercise, pattern)) {
        return false;
      }
      return !exerciseHasAnyPrimaryMuscle(exercise.exercise, directionalSupportMuscles);
    }).length;
    return total + Math.max(0, nonDirectionalPullCount - allowedPatternCount);
  }, 0);

  return {
    isRelevant: true,
    pushShortfallToFloor: roundToTenth(pushShortfallToFloor),
    directionalCoveredMuscleCount,
    directionalEffectiveSets: roundToTenth(directionalEffectiveSets),
    redundantPullSupportCount,
  };
}

export function evaluateLowerPatternPrimacy(input: {
  slotPolicy: ReturnType<typeof resolveSessionSlotPolicy>["currentSession"];
  workout: WorkoutPlan;
}) {
  const slotPolicy = input.slotPolicy;
  if (slotPolicy?.sessionShape?.id !== "lower_hinge_dominant") {
    return {
      isRelevant: false,
      primaryPatternScore: 0,
      hingeCompoundSetCount: 0,
      squatCompoundSetCount: 0,
      squatDominancePenalty: 0,
    };
  }

  const compoundExercises = getWorkoutExercises(input.workout).filter(
    (exercise) => exercise.exercise.isCompound ?? false
  );
  const firstCoreCompound =
    input.workout.mainLifts.find((exercise) => exercise.exercise.isCompound ?? false) ??
    compoundExercises[0];
  const hingeCompoundSetCount = compoundExercises
    .filter((exercise) => exerciseMatchesMovementPattern(exercise.exercise, "hinge"))
    .reduce((sum, exercise) => sum + exercise.sets.length, 0);
  const squatCompoundSetCount = compoundExercises
    .filter((exercise) => exerciseMatchesMovementPattern(exercise.exercise, "squat"))
    .reduce((sum, exercise) => sum + exercise.sets.length, 0);
  const primaryPatternScore = firstCoreCompound
    ? exerciseMatchesMovementPattern(firstCoreCompound.exercise, "hinge")
      ? 2
      : hingeCompoundSetCount > 0
        ? 1
        : 0
    : 0;

  return {
    isRelevant: true,
    primaryPatternScore,
    hingeCompoundSetCount,
    squatCompoundSetCount,
    squatDominancePenalty: Math.max(0, squatCompoundSetCount - hingeCompoundSetCount),
  };
}

function selectSupportIsolation(input: {
  exerciseLibrary: MappedGenerationContext["exerciseLibrary"];
  selectedExerciseIds: Set<string>;
  muscle: string;
}): WorkoutExercise["exercise"] | undefined {
  return input.exerciseLibrary
    .filter((exercise) => !input.selectedExerciseIds.has(exercise.id))
    .filter((exercise) => !(exercise.isCompound ?? false))
    .filter((exercise) => !(exercise.isMainLiftEligible ?? false))
    .filter((exercise) => (exercise.primaryMuscles ?? []).includes(input.muscle))
    .sort((left, right) => {
      const fatigueDelta = (left.fatigueCost ?? 3) - (right.fatigueCost ?? 3);
      if (fatigueDelta !== 0) {
        return fatigueDelta;
      }
      return left.name.localeCompare(right.name);
    })[0];
}

function buildSupportAccessoryExercise(input: {
  exercise: WorkoutExercise["exercise"];
  template: WorkoutExercise | undefined;
  orderIndex: number;
}): WorkoutExercise {
  const templateSets = input.template?.sets ?? [];
  const sets = (templateSets.length > 0 ? templateSets : Array.from({ length: 4 }, (_, index) => ({
    setIndex: index + 1,
    targetReps: 12,
    role: "accessory" as const,
  }))).map((set, index) => ({
    ...set,
    setIndex: index + 1,
    role: "accessory" as const,
  }));

  return {
    id: `${input.exercise.id}:projection-support`,
    exercise: input.exercise,
    orderIndex: input.orderIndex,
    isMainLift: false,
    role: "accessory",
    sets,
  };
}

function removeAccessory(workout: WorkoutPlan, exerciseId: string): WorkoutPlan {
  return {
    ...workout,
    accessories: workout.accessories
      .filter((exercise) => exercise.exercise.id !== exerciseId)
      .map((exercise, index) => ({ ...exercise, orderIndex: workout.mainLifts.length + index })),
  };
}

function appendAccessory(workout: WorkoutPlan, exercise: WorkoutExercise): WorkoutPlan {
  return {
    ...workout,
    accessories: [...workout.accessories, exercise].map((entry, index) => ({
      ...entry,
      orderIndex: workout.mainLifts.length + index,
    })),
  };
}

function buildProjectionSetFromTemplate(
  template: WorkoutSet | undefined,
  setIndex: number,
  role: WorkoutExercise["role"]
): WorkoutSet {
  return {
    ...(template ?? {
      targetReps: 12,
    }),
    setIndex,
    role: role ?? "accessory",
  };
}

function withAdditionalAccessorySets(
  exercise: WorkoutExercise,
  additionalSets: number
): WorkoutExercise {
  if (additionalSets <= 0) {
    return exercise;
  }

  const sets = [...exercise.sets];
  for (let index = 0; index < additionalSets; index += 1) {
    sets.push(
      buildProjectionSetFromTemplate(
        sets.at(-1),
        sets.length + 1,
        exercise.role ?? "accessory"
      )
    );
  }

  return {
    ...exercise,
    sets,
  };
}

function replaceWorkoutExercise(
  workout: WorkoutPlan,
  replacement: WorkoutExercise
): WorkoutPlan {
  return {
    ...workout,
    mainLifts: workout.mainLifts.map((exercise) =>
      exercise.exercise.id === replacement.exercise.id ? replacement : exercise
    ),
    accessories: workout.accessories.map((exercise) =>
      exercise.exercise.id === replacement.exercise.id ? replacement : exercise
    ),
  };
}

function getEffectiveContributionPerSet(
  exercise: WorkoutExercise,
  muscle: ProtectedWeekOneCoverageMuscle
): number {
  return getEffectiveStimulusByMuscle(exercise.exercise, 1).get(muscle) ?? 0;
}

function getMaxMavSafeSetBump(input: {
  exercise: WorkoutExercise;
  projectedTotals: ReadonlyMap<string, number>;
  requestedSetBump: number;
}): number {
  let maxSetBump = input.requestedSetBump;
  for (const [muscle, effectiveSetsPerSet] of getEffectiveStimulusByMuscle(
    input.exercise.exercise,
    1
  )) {
    if (effectiveSetsPerSet <= 0) {
      continue;
    }
    const mav = VOLUME_LANDMARKS[muscle]?.mav;
    if (mav == null) {
      continue;
    }
    const remainingToMav = mav - (input.projectedTotals.get(muscle) ?? 0);
    maxSetBump = Math.min(
      maxSetBump,
      Math.floor((remainingToMav + SUPPORT_FLOOR_EPSILON) / effectiveSetsPerSet)
    );
  }
  return Math.max(0, maxSetBump);
}

function findExistingSupportExercise(input: {
  workout: WorkoutPlan;
  muscle: ProtectedWeekOneCoverageMuscle;
  includeMainLifts?: boolean;
}): WorkoutExercise | undefined {
  const exercises =
    input.includeMainLifts === true
      ? [...input.workout.accessories, ...input.workout.mainLifts]
      : [...input.workout.accessories];
  return exercises
    .filter((exercise) => getEffectiveContributionPerSet(exercise, input.muscle) > 0)
    .sort((left, right) => {
      const leftAccessory = left.role === "accessory" || !left.isMainLift ? 1 : 0;
      const rightAccessory = right.role === "accessory" || !right.isMainLift ? 1 : 0;
      if (leftAccessory !== rightAccessory) {
        return rightAccessory - leftAccessory;
      }
      const leftPrimary = exerciseHasPrimaryMuscle(left.exercise, input.muscle) ? 1 : 0;
      const rightPrimary = exerciseHasPrimaryMuscle(right.exercise, input.muscle) ? 1 : 0;
      if (leftPrimary !== rightPrimary) {
        return rightPrimary - leftPrimary;
      }
      const contributionDelta =
        getEffectiveContributionPerSet(right, input.muscle) -
        getEffectiveContributionPerSet(left, input.muscle);
      if (Math.abs(contributionDelta) > SUPPORT_FLOOR_EPSILON) {
        return contributionDelta;
      }
      return left.exercise.name.localeCompare(right.exercise.name);
    })[0];
}

function accessoryTargetsProtectedMuscle(
  exercise: WorkoutExercise,
  protectedMuscles: ReadonlySet<string>
): boolean {
  return (exercise.exercise.primaryMuscles ?? []).some((muscle) =>
    protectedMuscles.has(normalizeMuscleName(muscle))
  );
}

function getProtectedPrimaryMuscles(
  exercise: WorkoutExercise,
  protectedMuscles: ReadonlySet<string>
): string[] {
  return (exercise.exercise.primaryMuscles ?? [])
    .map(normalizeMuscleName)
    .filter((muscle) => protectedMuscles.has(muscle));
}

function getSupportFloorRepairPriority(muscle: string): number {
  const normalized = normalizeMuscleName(muscle);
  const index = WEEK_ONE_SUPPORT_FLOOR_REPAIR_PRIORITY.findIndex(
    (entry) => normalizeMuscleName(entry) === normalized
  );
  return index >= 0 ? index : WEEK_ONE_SUPPORT_FLOOR_REPAIR_PRIORITY.length;
}

function canReplaceForHigherPrioritySupport(input: {
  requestedMuscle: ProtectedWeekOneCoverageMuscle;
  accessory: WorkoutExercise;
  protectedMuscleSet: ReadonlySet<string>;
}): boolean {
  const requestedPriority = getSupportFloorRepairPriority(input.requestedMuscle);
  const protectedPrimaries = getProtectedPrimaryMuscles(
    input.accessory,
    input.protectedMuscleSet
  );
  return (
    protectedPrimaries.length > 0 &&
    protectedPrimaries.every(
      (protectedMuscle) => getSupportFloorRepairPriority(protectedMuscle) > requestedPriority
    )
  );
}

function appendOrReplaceSupportAccessory(input: {
  workout: WorkoutPlan;
  slotPolicy: ReturnType<typeof resolveSessionSlotPolicy>["currentSession"];
  exerciseLibrary: MappedGenerationContext["exerciseLibrary"];
  selectedExerciseIds: Set<string>;
  muscle: ProtectedWeekOneCoverageMuscle;
  protectedMuscles: readonly ProtectedWeekOneCoverageMuscle[];
  allowLowerPriorityProtectedReplacement?: boolean;
}): WorkoutPlan {
  const supportExercise = selectSupportIsolation({
    exerciseLibrary: input.exerciseLibrary,
    selectedExerciseIds: input.selectedExerciseIds,
    muscle: input.muscle,
  });
  if (!supportExercise) {
    return input.workout;
  }

  const buildAccessory = (workout: WorkoutPlan, template?: WorkoutExercise) =>
    buildSupportAccessoryExercise({
      exercise: supportExercise,
      template: template ?? workout.accessories.at(-1),
      orderIndex: workout.mainLifts.length + workout.accessories.length,
    });

  if (countWorkoutExercises(input.workout) < SESSION_CAPS.maxExercises) {
    const candidateWorkout = appendAccessory(input.workout, buildAccessory(input.workout));
    return preservesSlotIdentity({ slotPolicy: input.slotPolicy, workout: candidateWorkout }) ||
      !preservesSlotIdentity({ slotPolicy: input.slotPolicy, workout: input.workout })
      ? candidateWorkout
      : input.workout;
  }

  const protectedMuscleSet = new Set(input.protectedMuscles.map(normalizeMuscleName));
  for (const accessory of input.workout.accessories) {
    if (
      accessoryTargetsProtectedMuscle(accessory, protectedMuscleSet) &&
      !(
        input.allowLowerPriorityProtectedReplacement === true &&
        canReplaceForHigherPrioritySupport({
          requestedMuscle: input.muscle,
          accessory,
          protectedMuscleSet,
        })
      )
    ) {
      continue;
    }
    const workoutWithoutAccessory = removeAccessory(input.workout, accessory.exercise.id);
    const candidateWorkout = appendAccessory(
      workoutWithoutAccessory,
      buildAccessory(workoutWithoutAccessory, accessory)
    );
    if (preservesSlotIdentity({ slotPolicy: input.slotPolicy, workout: candidateWorkout })) {
      return candidateWorkout;
    }
  }
  const requestedMuscle = normalizeMuscleName(input.muscle);
  for (const accessory of input.workout.accessories) {
    const accessoryProtectedPrimaries = getProtectedPrimaryMuscles(accessory, protectedMuscleSet);
    if (
      accessoryProtectedPrimaries.length === 0 ||
      accessoryProtectedPrimaries.includes(requestedMuscle)
    ) {
      continue;
    }
    const hasDuplicateProtectedPrimary = accessoryProtectedPrimaries.some((protectedMuscle) =>
      getWorkoutExercises(input.workout).some(
        (other) =>
          other.exercise.id !== accessory.exercise.id &&
          getProtectedPrimaryMuscles(other, protectedMuscleSet).includes(protectedMuscle)
      )
    );
    if (!hasDuplicateProtectedPrimary) {
      continue;
    }

    const workoutWithoutAccessory = removeAccessory(input.workout, accessory.exercise.id);
    const candidateWorkout = appendAccessory(
      workoutWithoutAccessory,
      buildAccessory(workoutWithoutAccessory, accessory)
    );
    if (preservesSlotIdentity({ slotPolicy: input.slotPolicy, workout: candidateWorkout })) {
      return candidateWorkout;
    }
  }

  return input.workout;
}

function rebalanceUpperSupportProjection(input: {
  workout: WorkoutPlan;
  slotPolicy: ReturnType<typeof resolveSessionSlotPolicy>["currentSession"];
  exerciseLibrary: MappedGenerationContext["exerciseLibrary"];
  protectedMuscles: readonly ProtectedWeekOneCoverageMuscle[];
}): WorkoutPlan {
  if (input.slotPolicy?.sessionIntent !== "upper") {
    return input.workout;
  }

  const protectedMuscles =
    input.protectedMuscles.length > 0
      ? input.protectedMuscles
      : getProtectedWeekOneCoverageObligations(input.slotPolicy);
  const initialQuality = evaluateUpperProtectedSupportQuality({
    slotPolicy: input.slotPolicy,
    contributionByMuscle: computeWorkoutContributionByMuscle(input.workout),
    protectedMuscles,
  });
  if (!initialQuality.isRelevant || initialQuality.satisfied) {
    return input.workout;
  }

  const selectedExerciseIds = new Set(
    [...input.workout.mainLifts, ...input.workout.accessories].map(
      (exercise) => exercise.exercise.id
    )
  );

  let workout = input.workout;
  const missingPrimarySupportMuscles = protectedMuscles.filter(
    (muscle) =>
      PRIMARY_WEEK_ONE_SUPPORT_FLOOR_MUSCLES.has(muscle) &&
      !getWorkoutExercises(workout).some((exercise) =>
        exerciseHasPrimaryMuscle(exercise.exercise, muscle)
      )
  );
  const repairMuscles = Array.from(
    new Set([...initialQuality.missingMuscles, ...missingPrimarySupportMuscles])
  );
  for (const muscle of repairMuscles) {
    workout = appendOrReplaceSupportAccessory({
      workout,
      slotPolicy: input.slotPolicy,
      exerciseLibrary: input.exerciseLibrary,
      selectedExerciseIds,
      muscle,
      protectedMuscles,
      allowLowerPriorityProtectedReplacement: PRIMARY_WEEK_ONE_SUPPORT_FLOOR_MUSCLES.has(muscle),
    });
    for (const exercise of [...workout.mainLifts, ...workout.accessories]) {
      selectedExerciseIds.add(exercise.exercise.id);
    }
  }

  return workout;
}

function applyExistingAccessorySupportFloorBumps(input: {
  workout: WorkoutPlan;
  slotPolicy: ReturnType<typeof resolveSessionSlotPolicy>["currentSession"];
  exerciseLibrary: MappedGenerationContext["exerciseLibrary"];
  projectedSlots: ReadonlyArray<ProjectedSlotWorkout>;
  activeMesocycle: NonNullable<MappedGenerationContext["activeMesocycle"]>;
  slotSequence: ReadonlyArray<{
    slotId: string;
    intent: WorkoutSessionIntent;
    authoredSemantics?: MesocycleSlotSequence["slots"][number]["authoredSemantics"];
  }>;
}): {
  workout: WorkoutPlan;
  reasons: Partial<Record<ProtectedWeekOneCoverageMuscle, SupportFloorRepairReason[]>>;
} {
  const reasons: Partial<Record<ProtectedWeekOneCoverageMuscle, SupportFloorRepairReason[]>> = {};
  let workout = input.workout;

  for (let pass = 0; pass < 2; pass += 1) {
    const evaluation = evaluateProtectedWeekOneCoverage({
      projectedSlots: [
        ...input.projectedSlots,
        {
          slotPlan: mapProjectedWorkoutToSlotPlan({
            slotId: input.slotPolicy?.slotId ?? "projection-current-slot",
            intent: (input.slotPolicy?.sessionIntent?.toUpperCase() ??
              "UPPER") as WorkoutSessionIntent,
            workout,
          }),
          workout,
          projectedContributionByMuscle: computeWorkoutContributionByMuscle(workout),
          repairMuscles: [],
        },
      ],
      activeMesocycle: input.activeMesocycle,
      slotSequence: input.slotSequence,
    });
    const repairRows = sortSupportFloorDeficits(
      evaluation.deficitsBelowPracticalFloor.filter((row) =>
        getProjectionRepairCompatibleMuscles(input.slotPolicy, [row.muscle]).includes(row.muscle)
      )
    );

    if (repairRows.length === 0) {
      break;
    }

    let appliedAnyBump = false;
    for (const row of repairRows) {
      const existingAccessory = findExistingSupportExercise({
        workout,
        muscle: row.muscle,
        includeMainLifts: row.muscle === "Hamstrings",
      });
      if (!existingAccessory) {
        const selectedExerciseIds = new Set(
          getWorkoutExercises(workout).map((exercise) => exercise.exercise.id)
        );
        const repairedWorkout = appendOrReplaceSupportAccessory({
          workout,
          slotPolicy: input.slotPolicy,
          exerciseLibrary: input.exerciseLibrary,
          selectedExerciseIds,
          muscle: row.muscle,
          protectedMuscles: getProtectedWeekOneCoverageObligations(input.slotPolicy),
          allowLowerPriorityProtectedReplacement: PRIMARY_WEEK_ONE_SUPPORT_FLOOR_MUSCLES.has(
            row.muscle
          ),
        });
        if (repairedWorkout !== workout) {
          workout = repairedWorkout;
          addSupportFloorRepairReason(reasons, row.muscle, "support_accessory_replacement");
          appliedAnyBump = true;
          continue;
        }
        const supportExercise = selectSupportIsolation({
          exerciseLibrary: input.exerciseLibrary,
          selectedExerciseIds,
          muscle: row.muscle,
        });
        addSupportFloorRepairReason(
          reasons,
          row.muscle,
          supportExercise
            ? countWorkoutExercises(workout) >= SESSION_CAPS.maxExercises
              ? "exercise_cap_blocked"
              : "slot_identity_blocked"
            : "no_compatible_exercise"
        );
        continue;
      }

      const effectivePerSet = getEffectiveContributionPerSet(existingAccessory, row.muscle);
      if (effectivePerSet <= 0) {
        addSupportFloorRepairReason(reasons, row.muscle, "effective_weight_shortfall");
        continue;
      }

      const projectedTotals = computeProjectedWeeklyContributionWithWorkout({
        projectedSlots: input.projectedSlots,
        workout,
      });
      const requestedSetBump = Math.min(
        MAX_PROJECTED_SUPPORT_FLOOR_SET_BUMP,
        Math.ceil(row.deficitToPracticalFloor / effectivePerSet - SUPPORT_FLOOR_EPSILON)
      );
      const safeSetBump = getMaxMavSafeSetBump({
        exercise: existingAccessory,
        projectedTotals,
        requestedSetBump,
      });

      if (safeSetBump <= 0) {
        addSupportFloorRepairReason(reasons, row.muscle, "capacity_blocked");
        continue;
      }

      workout = replaceWorkoutExercise(
        workout,
        withAdditionalAccessorySets(existingAccessory, safeSetBump)
      );
      addSupportFloorRepairReason(reasons, row.muscle, "existing_accessory_set_bump");
      if (safeSetBump < requestedSetBump) {
        addSupportFloorRepairReason(reasons, row.muscle, "effective_weight_shortfall");
      }
      appliedAnyBump = true;
    }

    if (!appliedAnyBump) {
      break;
    }
  }

  return { workout, reasons };
}

function updateProjectedSlotWorkout(
  projectedSlot: ProjectedSlotWorkout,
  workout: WorkoutPlan
): ProjectedSlotWorkout {
  return {
    ...projectedSlot,
    workout,
    slotPlan: mapProjectedWorkoutToSlotPlan({
      slotId: projectedSlot.slotPlan.slotId,
      intent: projectedSlot.slotPlan.intent,
      workout,
    }),
    projectedContributionByMuscle: computeWorkoutContributionByMuscle(workout),
  };
}

function getFinalRepairSlotPreference(input: {
  muscle: ProtectedWeekOneCoverageMuscle;
  slot: ProjectedSlotWorkout;
}): number {
  if (input.muscle === "Side Delts" && input.slot.slotPlan.slotId === "upper_b") {
    return 0;
  }
  if (input.muscle === "Calves" && input.slot.slotPlan.intent === "LOWER") {
    return 0;
  }
  return 1;
}

function applyFinalSupportFloorClosure(input: {
  projectedSlots: ReadonlyArray<ProjectedSlotWorkout>;
  activeMesocycle: NonNullable<MappedGenerationContext["activeMesocycle"]>;
  slotSequence: ReadonlyArray<{
    slotId: string;
    intent: WorkoutSessionIntent;
    authoredSemantics?: MesocycleSlotSequence["slots"][number]["authoredSemantics"];
  }>;
  slotSequenceEntries: ReturnType<typeof buildSlotSequenceEntries>;
}): {
  projectedSlots: ProjectedSlotWorkout[];
  reasons: Partial<Record<ProtectedWeekOneCoverageMuscle, SupportFloorRepairReason[]>>;
} {
  const reasons: Partial<Record<ProtectedWeekOneCoverageMuscle, SupportFloorRepairReason[]>> = {};
  let projectedSlots = [...input.projectedSlots];

  for (let pass = 0; pass < 2; pass += 1) {
    const evaluation = evaluateProtectedWeekOneCoverage({
      projectedSlots,
      activeMesocycle: input.activeMesocycle,
      slotSequence: input.slotSequence,
    });
    const repairRows = sortSupportFloorDeficits(evaluation.deficitsBelowPracticalFloor);
    if (repairRows.length === 0) {
      break;
    }

    let appliedAnyBump = false;
    for (const row of repairRows) {
      const candidates = projectedSlots
        .map((projectedSlot, index) => {
          const slotPolicy = resolveSessionSlotPolicy({
            sessionIntent: toSessionIntent(projectedSlot.slotPlan.intent),
            slotId: projectedSlot.slotPlan.slotId,
            slotSequence: {
              slots: input.slotSequenceEntries,
            },
          }).currentSession;
          const compatible = getProjectionRepairCompatibleMuscles(slotPolicy, [
            row.muscle,
          ]).includes(row.muscle);
          const accessory = compatible
            ? findExistingSupportExercise({
                workout: projectedSlot.workout,
                muscle: row.muscle,
                includeMainLifts: row.muscle === "Hamstrings",
              })
            : undefined;
          return { projectedSlot, index, slotPolicy, accessory, compatible };
        })
        .filter(
          (candidate): candidate is {
            projectedSlot: ProjectedSlotWorkout;
            index: number;
            slotPolicy: ReturnType<typeof resolveSessionSlotPolicy>["currentSession"];
            accessory: WorkoutExercise;
            compatible: true;
          } => Boolean(candidate.compatible && candidate.accessory)
        )
        .sort((left, right) => {
          const preferenceDelta =
            getFinalRepairSlotPreference({ muscle: row.muscle, slot: left.projectedSlot }) -
            getFinalRepairSlotPreference({ muscle: row.muscle, slot: right.projectedSlot });
          if (preferenceDelta !== 0) {
            return preferenceDelta;
          }
          return left.index - right.index;
        });

      const candidate = candidates[0];
      if (!candidate) {
        addSupportFloorRepairReason(reasons, row.muscle, "no_compatible_exercise");
        continue;
      }

      const effectivePerSet = getEffectiveContributionPerSet(candidate.accessory, row.muscle);
      if (effectivePerSet <= 0) {
        addSupportFloorRepairReason(reasons, row.muscle, "effective_weight_shortfall");
        continue;
      }

      const requestedSetBump = Math.min(
        MAX_PROJECTED_SUPPORT_FLOOR_SET_BUMP,
        Math.ceil(row.deficitToPracticalFloor / effectivePerSet - SUPPORT_FLOOR_EPSILON)
      );
      const projectedTotals = computeProjectedWeeklyContributionByMuscle({
        projectedSlots,
        currentSlotContribution: new Map(),
      });
      const safeSetBump = getMaxMavSafeSetBump({
        exercise: candidate.accessory,
        projectedTotals,
        requestedSetBump,
      });
      if (safeSetBump <= 0) {
        addSupportFloorRepairReason(reasons, row.muscle, "capacity_blocked");
        continue;
      }

      const bumpedWorkout = replaceWorkoutExercise(
        candidate.projectedSlot.workout,
        withAdditionalAccessorySets(candidate.accessory, safeSetBump)
      );
      if (
        preservesSlotIdentity({
          slotPolicy: candidate.slotPolicy,
          workout: candidate.projectedSlot.workout,
        }) &&
        !preservesSlotIdentity({ slotPolicy: candidate.slotPolicy, workout: bumpedWorkout })
      ) {
        addSupportFloorRepairReason(reasons, row.muscle, "slot_identity_blocked");
        continue;
      }

      projectedSlots = projectedSlots.map((projectedSlot, index) =>
        index === candidate.index ? updateProjectedSlotWorkout(projectedSlot, bumpedWorkout) : projectedSlot
      );
      addSupportFloorRepairReason(reasons, row.muscle, "existing_accessory_set_bump");
      if (safeSetBump < requestedSetBump) {
        addSupportFloorRepairReason(reasons, row.muscle, "effective_weight_shortfall");
      }
      appliedAnyBump = true;
    }

    if (!appliedAnyBump) {
      break;
    }
  }

  return { projectedSlots, reasons };
}

function countNonDirectionalPullPattern(input: {
  workout: WorkoutPlan;
  pattern: string;
  directionalSupportMuscles: readonly string[];
}): number {
  return getWorkoutExercises(input.workout).filter((exercise) => {
    if (!exerciseMatchesMovementPattern(exercise.exercise, input.pattern)) {
      return false;
    }
    return !exerciseHasAnyPrimaryMuscle(exercise.exercise, input.directionalSupportMuscles);
  }).length;
}

function trimRedundantUpperPullSupportProjection(input: {
  workout: WorkoutPlan;
  slotPolicy: ReturnType<typeof resolveSessionSlotPolicy>["currentSession"];
  protectedMuscles: readonly ProtectedWeekOneCoverageMuscle[];
}): WorkoutPlan {
  if (input.slotPolicy?.sessionShape?.id !== "upper_horizontal_balanced") {
    return input.workout;
  }

  const directionalSupportMuscles: ProtectedWeekOneCoverageMuscle[] = [
    "Chest",
    "Triceps",
    "Rear Delts",
  ];
  const protectedMuscles =
    input.protectedMuscles.length > 0
      ? input.protectedMuscles
      : getProtectedWeekOneCoverageObligations(input.slotPolicy);
  let workout = input.workout;

  for (const pattern of ["horizontal_pull", "vertical_pull"]) {
    const requiredPatternCount = getRequiredMovementPatternCount({
      slotPolicy: input.slotPolicy,
      pattern,
    });
    while (
      countWorkoutExercises(workout) > SESSION_CAPS.minExercises &&
      countNonDirectionalPullPattern({
        workout,
        pattern,
        directionalSupportMuscles,
      }) > requiredPatternCount
    ) {
      const redundantAccessory = workout.accessories.find(
        (exercise) =>
          exerciseMatchesMovementPattern(exercise.exercise, pattern) &&
          !exerciseHasAnyPrimaryMuscle(exercise.exercise, directionalSupportMuscles)
      );
      if (!redundantAccessory) {
        break;
      }

      const candidateWorkout = removeAccessory(workout, redundantAccessory.exercise.id);
      const supportQuality = evaluateUpperProtectedSupportQuality({
        slotPolicy: input.slotPolicy,
        contributionByMuscle: computeWorkoutContributionByMuscle(candidateWorkout),
        protectedMuscles,
      });
      if (
        !supportQuality.satisfied ||
        !preservesSlotIdentity({ slotPolicy: input.slotPolicy, workout: candidateWorkout })
      ) {
        break;
      }

      workout = candidateWorkout;
    }
  }

  return workout;
}

function reindexWorkoutSections(workout: WorkoutPlan): WorkoutPlan {
  return {
    ...workout,
    mainLifts: workout.mainLifts.map((exercise, index) => ({
      ...exercise,
      orderIndex: index,
    })),
    accessories: workout.accessories.map((exercise, index) => ({
      ...exercise,
      orderIndex: workout.mainLifts.length + index,
    })),
  };
}

function preserveLowerPatternPrimacy(input: {
  workout: WorkoutPlan;
  slotPolicy: ReturnType<typeof resolveSessionSlotPolicy>["currentSession"];
}): WorkoutPlan {
  if (input.slotPolicy?.sessionShape?.id !== "lower_hinge_dominant") {
    return input.workout;
  }

  const firstMainLift = input.workout.mainLifts[0];
  if (firstMainLift && exerciseMatchesMovementPattern(firstMainLift.exercise, "hinge")) {
    return input.workout;
  }

  const hingeMainLiftIndex = input.workout.mainLifts.findIndex(
    (exercise) =>
      (exercise.exercise.isCompound ?? false) &&
      exerciseMatchesMovementPattern(exercise.exercise, "hinge")
  );
  if (hingeMainLiftIndex > 0) {
    const hingeMainLift = input.workout.mainLifts[hingeMainLiftIndex];
    if (!hingeMainLift) {
      return input.workout;
    }
    return reindexWorkoutSections({
      ...input.workout,
      mainLifts: [
        hingeMainLift,
        ...input.workout.mainLifts.filter((_, index) => index !== hingeMainLiftIndex),
      ],
    });
  }

  const hingeAccessoryIndex = input.workout.accessories.findIndex(
    (exercise) =>
      (exercise.exercise.isCompound ?? false) &&
      exerciseMatchesMovementPattern(exercise.exercise, "hinge")
  );
  if (hingeAccessoryIndex < 0 || !firstMainLift) {
    return input.workout;
  }

  const hingeAccessory = input.workout.accessories[hingeAccessoryIndex];
  if (!hingeAccessory) {
    return input.workout;
  }

  return reindexWorkoutSections({
    ...input.workout,
    mainLifts: [
      {
        ...hingeAccessory,
        isMainLift: true,
        role: "main",
      },
      ...input.workout.mainLifts.slice(1),
    ],
    accessories: [
      {
        ...firstMainLift,
        isMainLift: false,
        role: "accessory",
      },
      ...input.workout.accessories.filter((_, index) => index !== hingeAccessoryIndex),
    ],
  });
}

export function preservesSlotIdentity(input: {
  slotPolicy: ReturnType<typeof resolveSessionSlotPolicy>["currentSession"];
  workout: WorkoutPlan;
}) {
  const slotPolicy = input.slotPolicy;
  if (!slotPolicy) {
    return true;
  }

  const allExercises = [...input.workout.mainLifts, ...input.workout.accessories].map(
    (exercise) => exercise.exercise
  );
  const requiredMovementPatterns = slotPolicy.sessionShape?.requiredMovementPatterns ?? [];
  if (
    requiredMovementPatterns.some(
      (pattern) =>
        !allExercises.some((exercise) =>
          doesExerciseSatisfyRequiredSessionShapePattern(exercise, pattern)
        )
    )
  ) {
    return false;
  }

  const preferredCompoundPatterns = slotPolicy.compoundBias?.preferredMovementPatterns ?? [];
  if (preferredCompoundPatterns.length === 0) {
    return true;
  }

  return allExercises.some(
    (exercise) =>
      (exercise.isCompound ?? false) &&
      (exercise.movementPatterns ?? []).some((pattern) =>
        preferredCompoundPatterns.includes(pattern)
      )
  );
}

function sumProtectedDeficitToPracticalFloor(
  rows: ReadonlyArray<ProtectedWeekOneCoverageRow>
) {
  return roundToTenth(rows.reduce((sum, row) => sum + row.deficitToPracticalFloor, 0));
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

function selectBestProjectedSlotComposition(input: {
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

function projectSlotPlansPass(input: {
  userId: string;
  source: SuccessorMesocycleProjectionSource;
  design: NextMesocycleDesign;
  snapshot: PreloadedGenerationSnapshot;
  projectionNow: Date;
}):
  | {
      projectedSlots: ProjectedSlotWorkout[];
      slotRepairMuscles: Record<string, ProtectedWeekOneCoverageMuscle[]>;
      supportFloorRepairReasons: Partial<Record<ProtectedWeekOneCoverageMuscle, SupportFloorRepairReason[]>>;
      activeMesocycle: NonNullable<MappedGenerationContext["activeMesocycle"]>;
    }
  | { error: string } {
  const projectionContext = buildSyntheticProjectionContext({
    userId: input.userId,
    source: input.source,
    design: input.design,
    snapshot: input.snapshot,
    now: input.projectionNow,
  });
  const activeMesocycle = projectionContext.mapped.activeMesocycle;
  if (!activeMesocycle) {
    return { error: "MESOCYCLE_HANDOFF_SLOT_PLAN_PROJECTION_FAILED:missing_active_mesocycle" };
  }

  const slotSequence = input.design.structure.slots;
  let projectedSlots: ProjectedSlotWorkout[] = [];
  const slotRepairMuscles: Record<string, ProtectedWeekOneCoverageMuscle[]> = {};
  const supportFloorRepairReasons: Partial<
    Record<ProtectedWeekOneCoverageMuscle, SupportFloorRepairReason[]>
  > = {};
  const slotSequenceEntries = buildSlotSequenceEntries(slotSequence);
  const accessoryLaneWeeklyTargets = buildAccessoryLaneWeeklyTargets(activeMesocycle);
  let accessoryLaneInsertionCount = 0;

  for (const [index, slot] of slotSequence.entries()) {
    if (slot.intent === "BODY_PART") {
      return {
        error: `MESOCYCLE_HANDOFF_SLOT_PLAN_UNSUPPORTED: BODY_PART slot ${slot.slotId} requires target muscles for deterministic projection.`,
      };
    }

    const currentEvaluation = evaluateProtectedWeekOneCoverage({
      projectedSlots,
      activeMesocycle,
      slotSequence,
    });
    const slotPolicy = resolveSessionSlotPolicy({
      sessionIntent: toSessionIntent(slot.intent),
      slotId: slot.slotId,
      slotSequence: {
        slots: slotSequenceEntries,
      },
    }).currentSession;
    const slotProtectedCoverageMuscles = getProtectedWeekOneCoverageObligations(slotPolicy);
    const futurePrimaryProtectedMuscles = new Set(
      slotSequence.slice(index + 1).flatMap((futureSlot) =>
        getProtectedWeekOneCoverageObligations(
          resolveSessionSlotPolicy({
            sessionIntent: toSessionIntent(futureSlot.intent),
            slotId: futureSlot.slotId,
            slotSequence: {
              slots: slotSequenceEntries,
            },
          }).currentSession
        )
      )
    );
    const compatibleRepairMuscles = getProjectionRepairCompatibleMuscles(
      slotPolicy,
      currentEvaluation.unresolvedProtectedMuscles
    ).filter(
      (muscle) =>
        slotProtectedCoverageMuscles.includes(muscle) ||
        !futurePrimaryProtectedMuscles.has(muscle)
    );
    const projectionRepairMuscles = compatibleRepairMuscles;
    const preferredSupportTargetMuscles = getProjectionPreferredSupportMuscles(slotPolicy);
    const softPreferredSupportTargetMuscles = getProjectionSoftPreferredSupportMuscles({
      slot: slotPolicy,
      protectedMuscles: slotProtectedCoverageMuscles,
    });
    const primaryPreferredTargetMuscles =
      slotPolicy?.sessionShape?.id === "lower_hinge_dominant"
        ? slotPolicy.compoundBias?.preferredPrimaryMuscles ?? []
        : [];
    const useStructuralUpperTargeting = slotPolicy?.sessionIntent === "upper";
    const composed = composeIntentSessionFromMappedContext(projectionContext.mapped, {
      intent: toSessionIntent(slot.intent),
      slotId: slot.slotId,
      roleListIncomplete: true,
      ...(projectionRepairMuscles.length > 0 ? { projectionRepairMuscles } : {}),
    });
    if ("error" in composed) {
      return {
        error: `MESOCYCLE_HANDOFF_SLOT_PLAN_PROJECTION_FAILED:${slot.slotId}:${composed.error}`,
      };
    }
    const candidateWorkouts: Array<{
      workout: WorkoutPlan;
      protectedMuscles: readonly ProtectedWeekOneCoverageMuscle[];
    }> = [
      {
        workout: composed.generation.workout,
        protectedMuscles: projectionRepairMuscles,
      },
    ];
    if (preferredSupportTargetMuscles.length > 0) {
      const preferredSupportComposed = composeIntentSessionFromMappedContext(
        projectionContext.mapped,
        {
          intent: toSessionIntent(slot.intent),
          slotId: slot.slotId,
          roleListIncomplete: true,
          targetMuscles: preferredSupportTargetMuscles,
        }
      );
      if (!("error" in preferredSupportComposed)) {
        candidateWorkouts.push({
          workout: preferredSupportComposed.generation.workout,
          protectedMuscles: projectionRepairMuscles,
        });
      }
    }
    if (softPreferredSupportTargetMuscles.length > 0) {
      const softPreferredSupportComposed = composeIntentSessionFromMappedContext(
        projectionContext.mapped,
        {
          intent: toSessionIntent(slot.intent),
          slotId: slot.slotId,
          roleListIncomplete: true,
          targetMuscles: softPreferredSupportTargetMuscles,
        }
      );
      if (!("error" in softPreferredSupportComposed)) {
        candidateWorkouts.push({
          workout: softPreferredSupportComposed.generation.workout,
          protectedMuscles: projectionRepairMuscles,
        });
      }
    }
    if (primaryPreferredTargetMuscles.length > 0) {
      const primaryPreferredComposed = composeIntentSessionFromMappedContext(
        projectionContext.mapped,
        {
          intent: toSessionIntent(slot.intent),
          slotId: slot.slotId,
          roleListIncomplete: true,
          targetMuscles: primaryPreferredTargetMuscles,
        }
      );
      if (!("error" in primaryPreferredComposed)) {
        candidateWorkouts.push({
          workout: primaryPreferredComposed.generation.workout,
          protectedMuscles: projectionRepairMuscles,
        });
      }
    }
    if (projectionRepairMuscles.length > 1 && !useStructuralUpperTargeting) {
      const focusedComposed = composeIntentSessionFromMappedContext(projectionContext.mapped, {
        intent: toSessionIntent(slot.intent),
        slotId: slot.slotId,
        roleListIncomplete: true,
        projectionRepairMuscles,
        targetMuscles: projectionRepairMuscles,
      });
      if (!("error" in focusedComposed)) {
        candidateWorkouts.push({
          workout: focusedComposed.generation.workout,
          protectedMuscles: projectionRepairMuscles,
        });
      }
    }
    for (const muscle of projectionRepairMuscles) {
      const focusedSingleMuscle = composeIntentSessionFromMappedContext(projectionContext.mapped, {
        intent: toSessionIntent(slot.intent),
        slotId: slot.slotId,
        roleListIncomplete: true,
        projectionRepairMuscles: [muscle],
        targetMuscles: [muscle],
      });
      if (!("error" in focusedSingleMuscle)) {
        candidateWorkouts.push({
          workout: focusedSingleMuscle.generation.workout,
          protectedMuscles: [muscle],
        });
      }
    }
    let selectedWorkout = rebalanceUpperSupportProjection({
      workout: selectBestProjectedSlotComposition({
        candidateWorkouts,
        prioritizedProtectedMuscles: projectionRepairMuscles,
        slotPolicy,
        projectedSlots,
        activeMesocycle,
        slotSequence,
        slotId: slot.slotId,
        intent: slot.intent,
      }),
      slotPolicy,
      exerciseLibrary: projectionContext.mapped.exerciseLibrary,
      protectedMuscles: Array.from(
        new Set([...slotProtectedCoverageMuscles, ...projectionRepairMuscles])
      ),
    });
    selectedWorkout = trimRedundantUpperPullSupportProjection({
      workout: selectedWorkout,
      slotPolicy,
      protectedMuscles: slotProtectedCoverageMuscles,
    });
    selectedWorkout = preserveLowerPatternPrimacy({
      workout: selectedWorkout,
      slotPolicy,
    });
    const supportFloorBumpResult = applyExistingAccessorySupportFloorBumps({
      workout: selectedWorkout,
      slotPolicy,
      exerciseLibrary: projectionContext.mapped.exerciseLibrary,
      projectedSlots,
      activeMesocycle,
      slotSequence,
    });
    selectedWorkout = supportFloorBumpResult.workout;
    mergeSupportFloorRepairReasons(
      supportFloorRepairReasons,
      supportFloorBumpResult.reasons
    );
    const selectedContribution = computeWorkoutContributionByMuscle(selectedWorkout);
    const slotProtectedCoverageSatisfied = projectionRepairMuscles.every(
      (muscle) => (selectedContribution.get(muscle) ?? 0) > 0
    );
    const meaningfulUpperProtectedSupport = evaluateUpperProtectedSupportQuality({
      slotPolicy,
      contributionByMuscle: selectedContribution,
      protectedMuscles: slotProtectedCoverageMuscles,
    });
    const accessoryLaneDecision = selectAccessoryLaneInsertion({
      slotIntent: toSessionIntent(slot.intent),
      workout: selectedWorkout,
      exerciseLibrary: projectionContext.mapped.exerciseLibrary,
      weeklyTargetByMuscle: accessoryLaneWeeklyTargets,
      projectedEffectiveSetsByMuscle: computeProjectedWeeklyContributionByMuscle({
        projectedSlots,
        currentSlotContribution: selectedContribution,
      }),
      maxExercises: SESSION_CAPS.maxExercises,
      weeklyInsertionCount: accessoryLaneInsertionCount,
      slotInsertionCount: 0,
      slotQualityPreserved:
        (meaningfulUpperProtectedSupport.isRelevant
          ? meaningfulUpperProtectedSupport.satisfied
          : slotProtectedCoverageSatisfied) &&
        preservesSlotIdentity({ slotPolicy, workout: selectedWorkout }),
    });
    if (accessoryLaneDecision.insert) {
      const candidateWorkout = appendAccessory(
        selectedWorkout,
        buildSupportAccessoryExercise({
          exercise: accessoryLaneDecision.insertion.exercise,
          template: selectedWorkout.accessories.at(-1),
          orderIndex: selectedWorkout.mainLifts.length + selectedWorkout.accessories.length,
        })
      );
      if (preservesSlotIdentity({ slotPolicy, workout: candidateWorkout })) {
        selectedWorkout = candidateWorkout;
        accessoryLaneInsertionCount += 1;
      }
    }

    const candidateProjectedSlot: ProjectedSlotWorkout = {
      slotPlan: mapProjectedWorkoutToSlotPlan({
        slotId: slot.slotId,
        intent: slot.intent,
        workout: selectedWorkout,
      }),
      workout: selectedWorkout,
      projectedContributionByMuscle: computeWorkoutContributionByMuscle(selectedWorkout),
      repairMuscles: projectionRepairMuscles,
    };
    projectedSlots.push(candidateProjectedSlot);
    if (slotProtectedCoverageMuscles.length > 0) {
      slotRepairMuscles[slot.slotId] = slotProtectedCoverageMuscles;
    }
    applyProjectedSlotToMappedContext({
      context: projectionContext,
      workout: candidateProjectedSlot.workout,
      slotPlan: candidateProjectedSlot.slotPlan,
      sessionNumber: index + 1,
      projectedAt: new Date(input.projectionNow.getTime() + index * 60_000),
    });
  }

  const finalSupportFloorClosure = applyFinalSupportFloorClosure({
    projectedSlots,
    activeMesocycle,
    slotSequence,
    slotSequenceEntries,
  });
  projectedSlots = finalSupportFloorClosure.projectedSlots;
  mergeSupportFloorRepairReasons(
    supportFloorRepairReasons,
    finalSupportFloorClosure.reasons
  );

  return {
    projectedSlots,
    slotRepairMuscles,
    supportFloorRepairReasons,
    activeMesocycle,
  };
}

export function projectSuccessorSlotPlansFromSnapshot(input: {
  userId: string;
  source: SuccessorMesocycleProjectionSource;
  design: NextMesocycleDesign;
  snapshot: PreloadedGenerationSnapshot;
  now?: Date;
}): SuccessorSlotPlanProjection | FailedSuccessorSlotPlanProjection {
  const projectionNow = input.now ?? new Date();
  const pass = projectSlotPlansPass({
    userId: input.userId,
    source: input.source,
    design: input.design,
    snapshot: input.snapshot,
    projectionNow,
  });
  if ("error" in pass) {
    return pass;
  }

  const finalEvaluation = evaluateProtectedWeekOneCoverage({
    projectedSlots: pass.projectedSlots,
    activeMesocycle: pass.activeMesocycle,
    slotSequence: input.design.structure.slots,
  });
  const supportFloorRepairReasons = { ...pass.supportFloorRepairReasons };
  for (const row of finalEvaluation.deficitsBelowPracticalFloor) {
    const existingReasons = supportFloorRepairReasons[row.muscle] ?? [];
    if (
      existingReasons.length > 0 &&
      existingReasons.every((reason) => reason === "existing_accessory_set_bump")
    ) {
      addSupportFloorRepairReason(
        supportFloorRepairReasons,
        row.muscle,
        "effective_weight_shortfall"
      );
      continue;
    }
    if (getWeekOneSupportFloor(row.muscle) == null || existingReasons.length > 0) {
      continue;
    }
    addSupportFloorRepairReason(
      supportFloorRepairReasons,
      row.muscle,
      row.compatibleSlotIds.length > 0 ? "capacity_blocked" : "slot_identity_blocked"
    );
  }
  const blockingDeficits = finalEvaluation.deficitsBelowPracticalFloor.filter(
    (row) => (supportFloorRepairReasons[row.muscle] ?? []).length === 0
  );
  if (blockingDeficits.length > 0) {
    return {
      error:
        "MESOCYCLE_HANDOFF_SLOT_PLAN_PROTECTED_COVERAGE_UNSATISFIED:" +
        blockingDeficits.map((row) => row.muscle).join(","),
      slotPlans: pass.projectedSlots.map((projectedSlot) => projectedSlot.slotPlan),
      diagnostics: {
        protectedCoverage: {
          beforeRepair: finalEvaluation,
          afterRepair: finalEvaluation,
          attemptedRepair: false,
          repairedSlotIds: [],
          slotRepairMuscles: pass.slotRepairMuscles,
          supportFloorRepairReasons,
          unresolvedProtectedMuscles: blockingDeficits.map((row) => row.muscle),
        },
      },
    };
  }

  return {
    slotPlans: pass.projectedSlots.map((projectedSlot) => projectedSlot.slotPlan),
    diagnostics: {
      protectedCoverage: {
        beforeRepair: finalEvaluation,
        afterRepair: finalEvaluation,
        attemptedRepair: false,
        repairedSlotIds: [],
        slotRepairMuscles: pass.slotRepairMuscles,
        supportFloorRepairReasons,
        unresolvedProtectedMuscles: finalEvaluation.unresolvedProtectedMuscles,
      },
    },
  };
}
