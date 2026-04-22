import type {
  AdaptationType,
  BlockType,
  IntensityBias,
  MesocycleExerciseRoleType,
  VolumeTarget,
  WorkoutSessionIntent,
} from "@prisma/client";
import type { WorkoutExercise, WorkoutHistoryEntry, WorkoutPlan } from "@/lib/engine/types";
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
import {
  ACCESSORY_LANE_MUSCLES,
  selectAccessoryLaneInsertion,
} from "@/lib/planning/accessory-lane";

export type ProjectedSuccessorSlotPlanExercise = {
  exerciseId: string;
  role: MesocycleExerciseRoleType;
};

export type ProjectedSuccessorSlotPlan = {
  slotId: string;
  intent: WorkoutSessionIntent;
  exercises: ProjectedSuccessorSlotPlanExercise[];
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
    exercises: ProjectedSuccessorSlotPlanExercise[];
  }>;
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

const PROTECTED_WEEK_ONE_COVERAGE_MUSCLES: ProtectedWeekOneCoverageMuscle[] = [
  "Chest",
  "Triceps",
  "Side Delts",
  "Rear Delts",
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
}): MesocycleSlotPlanSeed {
  if (!slotIdsAlignWithSlotSequence(input)) {
    throw new Error("MESOCYCLE_SLOT_PLAN_SEED_ALIGNMENT_INVALID");
  }

  return {
    version: 1,
    source: "handoff_slot_plan_projection",
    slots: input.slotPlans.map((slotPlan) => ({
      slotId: slotPlan.slotId,
      exercises: slotPlan.exercises.map((exercise) => ({
        exerciseId: exercise.exerciseId,
        role: exercise.role,
      })),
    })),
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
    const practicalFloor = usesUpperSupportFloor
      ? MEANINGFUL_UPPER_PROTECTED_SUPPORT_FLOOR
      : Math.max(mev, weeklyTarget);
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
    role,
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

function accessoryTargetsProtectedMuscle(
  exercise: WorkoutExercise,
  protectedMuscles: ReadonlySet<string>
): boolean {
  return (exercise.exercise.primaryMuscles ?? []).some((muscle) =>
    protectedMuscles.has(normalizeMuscleName(muscle))
  );
}

function appendOrReplaceSupportAccessory(input: {
  workout: WorkoutPlan;
  slotPolicy: ReturnType<typeof resolveSessionSlotPolicy>["currentSession"];
  exerciseLibrary: MappedGenerationContext["exerciseLibrary"];
  selectedExerciseIds: Set<string>;
  muscle: ProtectedWeekOneCoverageMuscle;
  protectedMuscles: readonly ProtectedWeekOneCoverageMuscle[];
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
    return preservesSlotIdentity({ slotPolicy: input.slotPolicy, workout: candidateWorkout })
      ? candidateWorkout
      : input.workout;
  }

  const protectedMuscleSet = new Set(input.protectedMuscles.map(normalizeMuscleName));
  for (const accessory of input.workout.accessories) {
    if (accessoryTargetsProtectedMuscle(accessory, protectedMuscleSet)) {
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
  for (const muscle of initialQuality.missingMuscles) {
    workout = appendOrReplaceSupportAccessory({
      workout,
      slotPolicy: input.slotPolicy,
      exerciseLibrary: input.exerciseLibrary,
      selectedExerciseIds,
      muscle,
      protectedMuscles,
    });
    for (const exercise of [...workout.mainLifts, ...workout.accessories]) {
      selectedExerciseIds.add(exercise.exercise.id);
    }
  }

  return workout;
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
  totalDeficitCount: number;
  totalDeficitToPracticalFloor: number;
  meaningfulSupportQuality: ReturnType<typeof evaluateUpperProtectedSupportQuality>;
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
    compareLower(candidate.relevantDeficitCount, best.relevantDeficitCount),
    compareLower(
      candidate.relevantDeficitToPracticalFloor,
      best.relevantDeficitToPracticalFloor
    ),
    compareHigher(
      candidate.meaningfulSupportQuality.meaningfulCoveredMuscleCount,
      best.meaningfulSupportQuality.meaningfulCoveredMuscleCount
    ),
    compareLower(
      candidate.meaningfulSupportQuality.shortfallToFloor,
      best.meaningfulSupportQuality.shortfallToFloor
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
    const evaluationSummary = {
      relevantDeficitCount: relevantDeficits.length,
      relevantDeficitToPracticalFloor: sumProtectedDeficitToPracticalFloor(relevantDeficits),
      totalDeficitCount: hypotheticalEvaluation.deficitsBelowPracticalFloor.length,
      totalDeficitToPracticalFloor: sumProtectedDeficitToPracticalFloor(
        hypotheticalEvaluation.deficitsBelowPracticalFloor
      ),
      meaningfulSupportQuality,
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
  const projectedSlots: ProjectedSlotWorkout[] = [];
  const slotRepairMuscles: Record<string, ProtectedWeekOneCoverageMuscle[]> = {};
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
    const projectionRepairMuscles = getProjectionRepairCompatibleMuscles(
      slotPolicy,
      currentEvaluation.unresolvedProtectedMuscles
    ).filter(
      (muscle) =>
        slotProtectedCoverageMuscles.includes(muscle) ||
        !futurePrimaryProtectedMuscles.has(muscle)
    );
    const preferredSupportTargetMuscles = getProjectionPreferredSupportMuscles(slotPolicy);
    const softPreferredSupportTargetMuscles = getProjectionSoftPreferredSupportMuscles({
      slot: slotPolicy,
      protectedMuscles: slotProtectedCoverageMuscles,
    });
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
      protectedMuscles: slotProtectedCoverageMuscles,
    });
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

  return {
    projectedSlots,
    slotRepairMuscles,
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
  if (finalEvaluation.deficitsBelowPracticalFloor.length > 0) {
    return {
      error:
        "MESOCYCLE_HANDOFF_SLOT_PLAN_PROTECTED_COVERAGE_UNSATISFIED:" +
        finalEvaluation.unresolvedProtectedMuscles.join(","),
      slotPlans: pass.projectedSlots.map((projectedSlot) => projectedSlot.slotPlan),
      diagnostics: {
        protectedCoverage: {
          beforeRepair: finalEvaluation,
          afterRepair: finalEvaluation,
          attemptedRepair: false,
          repairedSlotIds: [],
          slotRepairMuscles: pass.slotRepairMuscles,
          unresolvedProtectedMuscles: finalEvaluation.unresolvedProtectedMuscles,
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
        unresolvedProtectedMuscles: finalEvaluation.unresolvedProtectedMuscles,
      },
    },
  };
}
