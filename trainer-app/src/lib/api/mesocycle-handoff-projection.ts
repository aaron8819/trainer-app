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
  NextCycleCarryForwardSelection,
  NextCycleSeedDraft,
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
  selections: ReadonlyArray<NextCycleCarryForwardSelection>
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
  draft: NextCycleSeedDraft;
}): SuccessorMesocyclePreview {
  const keptSelections = input.draft.carryForwardSelections.filter(
    (selection) => selection.action === "keep"
  );
  const firstSlotIdByIntent = new Map<WorkoutSessionIntent, string>();

  return {
    title: buildPreviewTitle(input.currentMesoNumber, input.focus),
    focus: input.focus,
    mesoNumber: input.currentMesoNumber + 1,
    splitType: input.draft.structure.splitType,
    sessionsPerWeek: input.draft.structure.sessionsPerWeek,
    daysPerWeek: input.draft.structure.daysPerWeek,
    slotSequence: input.draft.structure.slots.map((slot) => {
      const exercises = sortExercisesForPreview(
        keptSelections.filter((selection) => selection.sessionIntent === slot.intent)
      );
      const sharedWithSlotId = firstSlotIdByIntent.get(slot.intent) ?? null;

      if (!sharedWithSlotId) {
        firstSlotIdByIntent.set(slot.intent, slot.slotId);
      }

      return {
        slotId: slot.slotId,
        intent: slot.intent,
        carriedForwardExerciseCount: exercises.length,
        sharedWithSlotId,
        exercises: sharedWithSlotId ? [] : exercises,
      };
    }),
    keepCount: keptSelections.length,
    rotateCount: input.draft.carryForwardSelections.filter(
      (selection) => selection.action === "rotate"
    ).length,
    dropCount: input.draft.carryForwardSelections.filter(
      (selection) => selection.action === "drop"
    ).length,
  };
}

export function projectSuccessorMesocycle(input: {
  source: SuccessorMesocycleProjectionSource;
  draft: NextCycleSeedDraft;
}): SuccessorMesocycleProjection {
  const carriedForwardRoles = input.draft.carryForwardSelections
    .filter((selection) => selection.action === "keep")
    .map((selection) => ({
      exerciseId: selection.exerciseId,
      sessionIntent: selection.sessionIntent,
      role: selection.role,
      addedInWeek: 1 as const,
    }));

  return {
    mesocycle: {
      macroCycleId: input.source.macroCycleId,
      mesoNumber: input.source.mesoNumber + 1,
      startWeek: input.source.startWeek + input.source.durationWeeks,
      durationWeeks: input.source.durationWeeks,
      focus: input.source.focus,
      volumeTarget: input.source.volumeTarget,
      intensityBias: input.source.intensityBias,
      splitType: input.draft.structure.splitType,
      sessionsPerWeek: input.draft.structure.sessionsPerWeek,
      daysPerWeek: input.draft.structure.daysPerWeek,
      weeklySchedule: input.draft.structure.slots.map((slot) => slot.intent),
      slotSequence: buildMesocycleSlotSequence(input.draft.structure.slots),
    },
    carriedForwardRoles,
    trainingBlocks: input.source.blocks.map((block) => ({
      blockNumber: block.blockNumber,
      blockType: block.blockType,
      startWeek: block.startWeek + input.source.durationWeeks,
      durationWeeks: block.durationWeeks,
      volumeTarget: block.volumeTarget,
      intensityBias: block.intensityBias,
      adaptationType: block.adaptationType,
    })),
    preview: buildSuccessorMesocyclePreview({
      currentMesoNumber: input.source.mesoNumber,
      focus: input.source.focus,
      draft: input.draft,
    }),
  };
}
