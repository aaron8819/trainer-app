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
import type { NextCycleSeedDraft } from "./mesocycle-handoff-contract";
import {
  projectSuccessorMesocycle,
  type SuccessorMesocycleProjectionSource,
} from "./mesocycle-handoff-projection";
import type { MesocycleSlotSequence } from "./mesocycle-slot-contract";

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
  draft: NextCycleSeedDraft;
  snapshot: PreloadedGenerationSnapshot;
  now: Date;
}): SyntheticProjectionContext {
  const projection = projectSuccessorMesocycle({
    source: input.source,
    draft: input.draft,
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
        mesocycleRoleRows: projection.carriedForwardRoles.map((selection) => ({
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

export function projectSuccessorSlotPlansFromSnapshot(input: {
  userId: string;
  source: SuccessorMesocycleProjectionSource;
  draft: NextCycleSeedDraft;
  snapshot: PreloadedGenerationSnapshot;
  now?: Date;
}): SuccessorSlotPlanProjection | { error: string } {
  const projectionContext = buildSyntheticProjectionContext({
    ...input,
    now: input.now ?? new Date(),
  });
  const slotPlans: ProjectedSuccessorSlotPlan[] = [];
  const slotSequence = input.draft.structure.slots;
  const projectionNow = input.now ?? new Date();

  for (const [index, slot] of slotSequence.entries()) {
    if (slot.intent === "BODY_PART") {
      return {
        error: `MESOCYCLE_HANDOFF_SLOT_PLAN_UNSUPPORTED: BODY_PART slot ${slot.slotId} requires target muscles for deterministic projection.`,
      };
    }

    const composed = composeIntentSessionFromMappedContext(projectionContext.mapped, {
      intent: toSessionIntent(slot.intent),
      slotId: slot.slotId,
    });
    if ("error" in composed) {
      return {
        error: `MESOCYCLE_HANDOFF_SLOT_PLAN_PROJECTION_FAILED:${slot.slotId}:${composed.error}`,
      };
    }

    const slotPlan = mapProjectedWorkoutToSlotPlan({
      slotId: slot.slotId,
      intent: slot.intent,
      workout: composed.generation.workout,
    });
    slotPlans.push(slotPlan);
    applyProjectedSlotToMappedContext({
      context: projectionContext,
      workout: composed.generation.workout,
      slotPlan,
      sessionNumber: index + 1,
      projectedAt: new Date(projectionNow.getTime() + index * 60_000),
    });
  }

  return { slotPlans };
}
