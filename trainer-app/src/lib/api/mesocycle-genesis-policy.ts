import type {
  AdaptationType,
  BlockType,
  IntensityBias,
  MesocycleExerciseRoleType,
  SplitType,
  VolumeTarget,
  WorkoutSessionIntent,
} from "@prisma/client";
import {
  buildOrderedFlexibleSlots,
  remapCompatibleCarryForwardIntent,
  type NextCycleConstraintsInput,
  type NextCyclePreferencesInput,
  type NextCycleSeedDraft,
  type NextMesocycleCarryForwardDecision,
  type NextMesocycleDesign,
  type NextMesocycleStartingPoint,
} from "./mesocycle-handoff-contract";
import {
  buildMesocycleSlotSequence,
  type MesocycleSlotAuthoredSemantics,
} from "./mesocycle-slot-contract";

export type NextMesocycleDesignInput = {
  sourceMesocycleId: string;
  source: {
    focus: string;
    durationWeeks: number;
    volumeTarget: VolumeTarget;
    intensityBias: IntensityBias;
    blocks: Array<{
      blockNumber: number;
      blockType: BlockType;
      durationWeeks: number;
      volumeTarget: VolumeTarget;
      intensityBias: IntensityBias;
      adaptationType: AdaptationType;
    }>;
  };
  constraints: NextCycleConstraintsInput;
  preferences: NextCyclePreferencesInput;
  carryForwardCandidates: Array<{
    exerciseId: string;
    exerciseName: string;
    role: MesocycleExerciseRoleType;
    priorIntent: WorkoutSessionIntent;
    priorSlotId?: string;
    anchorLevel: "required" | "preferred" | "none";
  }>;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function resolveRecommendedSessionsPerWeek(input: {
  constraints: NextCycleConstraintsInput;
  preferences: NextCyclePreferencesInput;
}): number {
  const hardCap = Math.max(
    1,
    Math.min(
      7,
      input.constraints.maxSessionsPerWeek ?? input.constraints.availableDaysPerWeek
    )
  );

  if (typeof input.preferences.preferredSessionsPerWeek === "number") {
    return clamp(input.preferences.preferredSessionsPerWeek, 1, hardCap);
  }

  return Math.min(4, hardCap);
}

function resolveRecommendedSplitType(input: {
  sessionsPerWeek: number;
  preferences: NextCyclePreferencesInput;
}): SplitType {
  if (input.preferences.preferredSplitType) {
    return input.preferences.preferredSplitType;
  }

  if (input.sessionsPerWeek >= 4) {
    return "UPPER_LOWER";
  }

  if (input.sessionsPerWeek === 3) {
    return "PPL";
  }

  return "FULL_BODY";
}

function getDefaultStartingPoint(): NextMesocycleStartingPoint {
  return {
    volumeEntry: "conservative",
    baselineSource: "accumulation_preferred",
    allowNonDeloadFallback: true,
  };
}

function toDesignSlotStructure(input: {
  splitType: SplitType;
  sessionsPerWeek: number;
  daysPerWeek: number;
}): NextMesocycleDesign["structure"] {
  const slots = buildOrderedFlexibleSlots({
    splitType: input.splitType,
    sessionsPerWeek: input.sessionsPerWeek,
  });
  const slotSequence = buildMesocycleSlotSequence(slots);

  return {
    splitType: input.splitType,
    sessionsPerWeek: input.sessionsPerWeek,
    daysPerWeek: input.daysPerWeek,
    sequenceMode: "ordered_flexible",
    slots: slotSequence.slots.map((slot) => ({
      slotId: slot.slotId,
      intent: slot.intent,
      authoredSemantics: slot.authoredSemantics as MesocycleSlotAuthoredSemantics,
    })),
  };
}

function buildCarryForwardDecision(input: {
  splitType: SplitType;
  candidate: NextMesocycleDesignInput["carryForwardCandidates"][number];
}): NextMesocycleCarryForwardDecision {
  const action =
    input.candidate.anchorLevel === "required" || input.candidate.role === "CORE_COMPOUND"
      ? "keep"
      : "rotate";
  const targetIntent =
    action === "keep"
      ? remapCompatibleCarryForwardIntent({
          splitType: input.splitType,
          sessionIntent: input.candidate.priorIntent,
        })
      : undefined;

  return {
    exerciseId: input.candidate.exerciseId,
    role: input.candidate.role,
    priorIntent: input.candidate.priorIntent,
    priorSlotId: input.candidate.priorSlotId,
    action,
    targetIntent,
    reasonCodes:
      action === "keep"
        ? ["core_compound_continuity"]
        : ["accessory_rotation_default"],
  };
}

export function designNextMesocycle(input: NextMesocycleDesignInput): NextMesocycleDesign {
  const designedAt = new Date().toISOString();
  const sessionsPerWeek = resolveRecommendedSessionsPerWeek({
    constraints: input.constraints,
    preferences: input.preferences,
  });
  const splitType = resolveRecommendedSplitType({
    sessionsPerWeek,
    preferences: input.preferences,
  });
  const structure = toDesignSlotStructure({
    splitType,
    sessionsPerWeek,
    daysPerWeek: sessionsPerWeek,
  });

  return {
    version: 1,
    designedAt,
    sourceMesocycleId: input.sourceMesocycleId,
    profile: {
      focus: input.source.focus,
      durationWeeks: input.source.durationWeeks,
      volumeTarget: input.source.volumeTarget,
      intensityBias: input.source.intensityBias,
      blocks: input.source.blocks,
    },
    structure,
    carryForward: {
      decisions: input.carryForwardCandidates.map((candidate) =>
        buildCarryForwardDecision({
          splitType: structure.splitType,
          candidate,
        })
      ),
    },
    startingPoint: getDefaultStartingPoint(),
    explainability: {
      profileReasonCodes: ["carry_forward_mesocycle_profile_default"],
      structureReasonCodes: ["upper_lower_default_frequency_cap"],
      startingPointReasonCodes: ["conservative_entry_after_deload_boundary"],
    },
  };
}

export function buildRecommendedDraftFromDesign(input: {
  design: NextMesocycleDesign;
  carryForwardCandidates: NextMesocycleDesignInput["carryForwardCandidates"];
}): NextCycleSeedDraft {
  const decisionByExercise = new Map(
    input.design.carryForward.decisions.map((decision) => [
      `${decision.exerciseId}:${decision.priorIntent}:${decision.role}`,
      decision,
    ])
  );

  return {
    version: 1,
    sourceMesocycleId: input.design.sourceMesocycleId,
    createdAt: input.design.designedAt,
    structure: {
      splitType: input.design.structure.splitType,
      sessionsPerWeek: input.design.structure.sessionsPerWeek,
      daysPerWeek: input.design.structure.daysPerWeek,
      sequenceMode: input.design.structure.sequenceMode,
      slots: input.design.structure.slots.map((slot) => ({
        slotId: slot.slotId,
        intent: slot.intent,
      })),
    },
    startingPoint: input.design.startingPoint,
    carryForwardSelections: input.carryForwardCandidates.map((candidate) => {
      const decision = decisionByExercise.get(
        `${candidate.exerciseId}:${candidate.priorIntent}:${candidate.role}`
      );
      return {
        exerciseId: candidate.exerciseId,
        exerciseName: candidate.exerciseName,
        sessionIntent:
          decision?.action === "keep" ? decision.targetIntent ?? candidate.priorIntent : candidate.priorIntent,
        role: candidate.role,
        action: decision?.action ?? "rotate",
      };
    }),
  };
}

export function applyDraftOverridesToDesign(input: {
  design: NextMesocycleDesign;
  draft: NextCycleSeedDraft;
}): NextMesocycleDesign {
  const slotSequence = buildMesocycleSlotSequence(input.draft.structure.slots);
  const decisionByExercise = new Map(
    input.design.carryForward.decisions.map((decision) => [
      `${decision.exerciseId}:${decision.role}`,
      decision,
    ])
  );

  const structureChanged =
    input.design.structure.splitType !== input.draft.structure.splitType ||
    input.design.structure.sessionsPerWeek !== input.draft.structure.sessionsPerWeek ||
    input.design.structure.slots.length !== input.draft.structure.slots.length ||
    input.design.structure.slots.some((slot, index) => {
      const draftSlot = input.draft.structure.slots[index];
      return !draftSlot || draftSlot.slotId !== slot.slotId || draftSlot.intent !== slot.intent;
    });

  return {
    ...input.design,
    structure: {
      splitType: input.draft.structure.splitType,
      sessionsPerWeek: input.draft.structure.sessionsPerWeek,
      daysPerWeek: input.draft.structure.daysPerWeek,
      sequenceMode: input.draft.structure.sequenceMode,
      slots: slotSequence.slots.map((slot) => ({
        slotId: slot.slotId,
        intent: slot.intent,
        authoredSemantics: slot.authoredSemantics as MesocycleSlotAuthoredSemantics,
      })),
    },
    carryForward: {
      decisions: input.draft.carryForwardSelections.map((selection) => {
        const baseDecision = decisionByExercise.get(`${selection.exerciseId}:${selection.role}`);
        return {
          exerciseId: selection.exerciseId,
          role: selection.role,
          priorIntent:
            baseDecision?.priorIntent ??
            (selection.action === "keep" ? selection.sessionIntent : selection.sessionIntent),
          priorSlotId: baseDecision?.priorSlotId,
          action: selection.action,
          targetIntent: selection.action === "keep" ? selection.sessionIntent : undefined,
          targetSlotId: undefined,
          reasonCodes: baseDecision?.reasonCodes ?? [],
        };
      }),
    },
    explainability: {
      ...input.design.explainability,
      structureReasonCodes: structureChanged
        ? [...input.design.explainability.structureReasonCodes, "user_edited_structure"]
        : input.design.explainability.structureReasonCodes,
    },
  };
}

export function buildFallbackDesignFromDraft(input: {
  sourceMesocycleId: string;
  designedAt: string;
  profile: NextMesocycleDesign["profile"];
  draft: NextCycleSeedDraft;
}): NextMesocycleDesign {
  const slotSequence = buildMesocycleSlotSequence(input.draft.structure.slots);

  return {
    version: 1,
    designedAt: input.designedAt,
    sourceMesocycleId: input.sourceMesocycleId,
    profile: input.profile,
    structure: {
      splitType: input.draft.structure.splitType,
      sessionsPerWeek: input.draft.structure.sessionsPerWeek,
      daysPerWeek: input.draft.structure.daysPerWeek,
      sequenceMode: input.draft.structure.sequenceMode,
      slots: slotSequence.slots.map((slot) => ({
        slotId: slot.slotId,
        intent: slot.intent,
        authoredSemantics: slot.authoredSemantics as MesocycleSlotAuthoredSemantics,
      })),
    },
    carryForward: {
      decisions: input.draft.carryForwardSelections.map((selection) => ({
        exerciseId: selection.exerciseId,
        role: selection.role,
        priorIntent: selection.sessionIntent,
        action: selection.action,
        targetIntent: selection.action === "keep" ? selection.sessionIntent : undefined,
        reasonCodes: [],
      })),
    },
    startingPoint: input.draft.startingPoint,
    explainability: {
      profileReasonCodes: [],
      structureReasonCodes: ["legacy_pending_handoff_fallback"],
      startingPointReasonCodes: [],
    },
  };
}
