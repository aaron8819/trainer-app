import type {
  AdaptationType,
  BlockType,
  IntensityBias,
  MesocycleExerciseRoleType,
  SplitType,
  VolumeTarget,
  WorkoutSessionIntent,
} from "@prisma/client";
import type {
  NextCycleSeedDraft,
  NextMesocycleDesign,
} from "./mesocycle-handoff-contract";
import {
  buildMesocycleSlotSequence,
  type MesocycleSlotSequence,
} from "./mesocycle-slot-contract";

export type SuccessorMesocycleProjectionSource = {
  macroCycleId: string;
  mesoNumber: number;
  startWeek: number;
  durationWeeks: number;
  focus: string;
  volumeTarget: VolumeTarget;
  intensityBias: IntensityBias;
  blocks: Array<{
    blockNumber: number;
    blockType: BlockType;
    startWeek: number;
    durationWeeks: number;
    volumeTarget: VolumeTarget;
    intensityBias: IntensityBias;
    adaptationType: AdaptationType;
  }>;
};

export type SuccessorMesocyclePreviewSlotExercise = {
  exerciseId: string;
  exerciseName: string;
  role: MesocycleExerciseRoleType;
};

export type SuccessorMesocyclePreviewSlot = {
  slotId: string;
  intent: WorkoutSessionIntent;
  carriedForwardExerciseCount: number;
  sharedWithSlotId: string | null;
  exercises: SuccessorMesocyclePreviewSlotExercise[];
};

export type SuccessorMesocyclePreview = {
  title: string;
  focus: string;
  mesoNumber: number;
  splitType: SplitType;
  sessionsPerWeek: number;
  daysPerWeek: number;
  slotSequence: SuccessorMesocyclePreviewSlot[];
  keepCount: number;
  rotateCount: number;
  dropCount: number;
};

export type SuccessorMesocycleProjection = {
  mesocycle: {
    macroCycleId: string;
    mesoNumber: number;
    startWeek: number;
    durationWeeks: number;
    focus: string;
    volumeTarget: VolumeTarget;
    intensityBias: IntensityBias;
    splitType: SplitType;
    sessionsPerWeek: number;
    daysPerWeek: number;
    weeklySchedule: WorkoutSessionIntent[];
    slotSequence: MesocycleSlotSequence;
  };
  carriedForwardRoles: Array<{
    exerciseId: string;
    sessionIntent: WorkoutSessionIntent;
    role: MesocycleExerciseRoleType;
    addedInWeek: 1;
  }>;
  trainingBlocks: Array<{
    blockNumber: number;
    blockType: BlockType;
    startWeek: number;
    durationWeeks: number;
    volumeTarget: VolumeTarget;
    intensityBias: IntensityBias;
    adaptationType: AdaptationType;
  }>;
  preview: SuccessorMesocyclePreview;
};

function buildPreviewTitle(currentMesoNumber: number, focus: string): string {
  return `Meso ${currentMesoNumber + 1} - ${focus}`;
}

function sortExercisesForPreview(
  selections: ReadonlyArray<{
    exerciseId: string;
    exerciseName: string;
    role: MesocycleExerciseRoleType;
  }>
): SuccessorMesocyclePreviewSlotExercise[] {
  const rolePriority: Record<MesocycleExerciseRoleType, number> = {
    CORE_COMPOUND: 0,
    ACCESSORY: 1,
  };

  return selections
    .slice()
    .sort((left, right) => {
      if (left.role !== right.role) {
        return rolePriority[left.role] - rolePriority[right.role];
      }
      return left.exerciseName.localeCompare(right.exerciseName);
    })
    .map((selection) => ({
      exerciseId: selection.exerciseId,
      exerciseName: selection.exerciseName,
      role: selection.role,
    }));
}

export function buildSuccessorMesocyclePreview(input: {
  currentMesoNumber: number;
  focus: string;
  design: NextMesocycleDesign;
  draft?: NextCycleSeedDraft;
}): SuccessorMesocyclePreview {
  const keptSelections = input.design.carryForward.decisions.filter(
    (decision) => decision.action === "keep"
  );
  const keptSelectionDisplay = new Map(
    (input.draft?.carryForwardSelections ?? [])
      .filter((selection) => selection.action === "keep")
      .map((selection) => [
        `${selection.exerciseId}:${selection.role}:${selection.sessionIntent}`,
        {
          exerciseId: selection.exerciseId,
          exerciseName: selection.exerciseName,
          role: selection.role,
        },
      ])
  );
  const firstPooledSlotIdByIntent = new Map<WorkoutSessionIntent, string>();

  return {
    title: buildPreviewTitle(input.currentMesoNumber, input.focus),
    focus: input.focus,
    mesoNumber: input.currentMesoNumber + 1,
    splitType: input.design.structure.splitType,
    sessionsPerWeek: input.design.structure.sessionsPerWeek,
    daysPerWeek: input.design.structure.daysPerWeek,
    slotSequence: input.design.structure.slots.map((slot) => {
      const targetedSelections = keptSelections.filter(
        (selection) => selection.targetSlotId === slot.slotId
      );
      const pooledSelections = keptSelections.filter(
        (selection) => !selection.targetSlotId && selection.targetIntent === slot.intent
      );
      const pooledSharedWithSlotId =
        pooledSelections.length > 0 ? (firstPooledSlotIdByIntent.get(slot.intent) ?? null) : null;
      if (pooledSelections.length > 0 && !pooledSharedWithSlotId) {
        firstPooledSlotIdByIntent.set(slot.intent, slot.slotId);
      }
      const decisionsForSlot =
        targetedSelections.length > 0
          ? targetedSelections
          : pooledSharedWithSlotId
            ? []
            : pooledSelections;
      const exercises = sortExercisesForPreview(
        decisionsForSlot
          .flatMap((selection) => {
            const display = keptSelectionDisplay.get(
              `${selection.exerciseId}:${selection.role}:${selection.targetIntent}`
            );

            return display ? [display] : [];
          })
      );
      const sharedWithSlotId = targetedSelections.length > 0 ? null : pooledSharedWithSlotId;

      return {
        slotId: slot.slotId,
        intent: slot.intent,
        carriedForwardExerciseCount: targetedSelections.length + pooledSelections.length,
        sharedWithSlotId,
        exercises: sharedWithSlotId ? [] : exercises,
      };
    }),
    keepCount: keptSelections.length,
    rotateCount: input.design.carryForward.decisions.filter((decision) => decision.action === "rotate").length,
    dropCount: input.design.carryForward.decisions.filter((decision) => decision.action === "drop").length,
  };
}

export function projectSuccessorMesocycle(input: {
  source: SuccessorMesocycleProjectionSource;
  design: NextMesocycleDesign;
  draft?: NextCycleSeedDraft;
}): SuccessorMesocycleProjection {
  const carriedForwardRoles = input.design.carryForward.decisions
    .filter((decision) => decision.action === "keep" && decision.targetIntent)
    .map((decision) => ({
      exerciseId: decision.exerciseId,
      sessionIntent: decision.targetIntent!,
      role: decision.role,
      addedInWeek: 1 as const,
    }));
  let nextBlockStartWeek = input.source.startWeek + input.source.durationWeeks;

  return {
    mesocycle: {
      macroCycleId: input.source.macroCycleId,
      mesoNumber: input.source.mesoNumber + 1,
      startWeek: input.source.startWeek + input.source.durationWeeks,
      durationWeeks: input.design.profile.durationWeeks,
      focus: input.design.profile.focus,
      volumeTarget: input.design.profile.volumeTarget,
      intensityBias: input.design.profile.intensityBias,
      splitType: input.design.structure.splitType,
      sessionsPerWeek: input.design.structure.sessionsPerWeek,
      daysPerWeek: input.design.structure.daysPerWeek,
      weeklySchedule: input.design.structure.slots.map((slot) => slot.intent),
      slotSequence: buildMesocycleSlotSequence(input.design.structure.slots),
    },
    carriedForwardRoles,
    trainingBlocks: input.design.profile.blocks.map((block) => {
      const projectedBlock = {
        blockNumber: block.blockNumber,
        blockType: block.blockType,
        startWeek: nextBlockStartWeek,
        durationWeeks: block.durationWeeks,
        volumeTarget: block.volumeTarget,
        intensityBias: block.intensityBias,
        adaptationType: block.adaptationType,
      };
      nextBlockStartWeek += block.durationWeeks;
      return projectedBlock;
    }),
    preview: buildSuccessorMesocyclePreview({
      currentMesoNumber: input.source.mesoNumber,
      focus: input.design.profile.focus,
      design: input.design,
      draft: input.draft,
    }),
  };
}
