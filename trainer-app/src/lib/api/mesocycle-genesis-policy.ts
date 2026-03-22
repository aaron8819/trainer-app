import type { SplitType } from "@prisma/client";
import {
  buildOrderedFlexibleSlots,
  type GenesisPolicyBranchResult,
  type GenesisPolicyContext,
  remapCompatibleCarryForwardIntent,
  type NextCycleSeedDraft,
  type NextMesocycleCarryForwardDecision,
  type NextMesocycleDesign,
  type NextMesocycleStartingPoint,
} from "./mesocycle-handoff-contract";
import {
  buildMesocycleSlotSequence,
  type MesocycleSlotAuthoredSemantics,
} from "./mesocycle-slot-contract";

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function resolveRecommendedSessionsPerWeek(
  context: GenesisPolicyContext
): GenesisPolicyBranchResult<number> {
  const hardCap = Math.max(
    1,
    Math.min(
      7,
      context.constraints.maxSessionsPerWeek ?? context.constraints.availableDaysPerWeek
    )
  );

  if (typeof context.preferences.preferredSessionsPerWeek === "number") {
    const clamped = clamp(context.preferences.preferredSessionsPerWeek, 1, hardCap);
    return {
      decision: clamped,
      reasonCodes: [
        clamped === context.preferences.preferredSessionsPerWeek
          ? "preferred_frequency_honored"
          : "preferred_frequency_capped_by_constraints",
      ],
      signalQuality: "high",
    };
  }

  return {
    decision: Math.min(4, hardCap),
    reasonCodes: ["default_frequency_cap_applied"],
    signalQuality: "medium",
  };
}

function resolveRecommendedSplitType(input: {
  sessionsPerWeek: number;
  preferences: GenesisPolicyContext["preferences"];
}): GenesisPolicyBranchResult<SplitType> {
  if (input.preferences.preferredSplitType) {
    return {
      decision: input.preferences.preferredSplitType,
      reasonCodes: [
        input.preferences.preferredSplitTypeSource === "weekly_schedule_topology"
          ? "weekly_schedule_split_preference_honored"
          : "preferred_split_honored",
      ],
      signalQuality: "high",
    };
  }

  if (input.sessionsPerWeek >= 4) {
    return {
      decision: "UPPER_LOWER",
      reasonCodes: ["default_upper_lower_for_four_plus_sessions"],
      signalQuality: "medium",
    };
  }

  if (input.sessionsPerWeek === 3) {
    return {
      decision: "PPL",
      reasonCodes: ["default_ppl_for_three_sessions"],
      signalQuality: "medium",
    };
  }

  return {
    decision: "FULL_BODY",
    reasonCodes: ["default_full_body_for_low_frequency"],
    signalQuality: "medium",
  };
}

function resolveSourceProfile(
  context: GenesisPolicyContext
): GenesisPolicyBranchResult<NextMesocycleDesign["profile"]> {
  return {
    decision: {
      focus: context.sourceProfile.focus,
      durationWeeks: context.sourceProfile.durationWeeks,
      volumeTarget: context.sourceProfile.volumeTarget,
      intensityBias: context.sourceProfile.intensityBias,
      blocks: context.sourceProfile.blocks,
    },
    reasonCodes: ["carry_forward_mesocycle_profile_default"],
    signalQuality: "medium",
  };
}

function resolveStartingPoint(): GenesisPolicyBranchResult<NextMesocycleStartingPoint> {
  return {
    decision: {
      volumeEntry: "conservative",
      baselineSource: "accumulation_preferred",
      allowNonDeloadFallback: true,
    },
    reasonCodes: ["conservative_entry_after_deload_boundary"],
    signalQuality: "medium",
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
  candidate: GenesisPolicyContext["carryForwardCandidateEvidence"][number];
}): GenesisPolicyBranchResult<NextMesocycleCarryForwardDecision> {
  const action =
    input.candidate.anchorLevel === "required" || input.candidate.role === "CORE_COMPOUND"
      ? "keep"
      : "rotate";
  const hasReceiptBackedSlotEvidence = Boolean(input.candidate.evidence.latestSourceSlotId);
  const targetIntent =
    action === "keep"
      ? remapCompatibleCarryForwardIntent({
          splitType: input.splitType,
          sessionIntent: input.candidate.priorIntent,
        })
      : undefined;

  if (action === "keep") {
    const reasonCodes =
      input.candidate.anchorLevel === "required"
        ? [
            hasReceiptBackedSlotEvidence
              ? "required_anchor_continuity_supported_by_receipt_slot"
              : "required_anchor_continuity_fallback",
          ]
        : [
            hasReceiptBackedSlotEvidence
              ? "core_compound_continuity_supported_by_receipt_slot"
              : "core_compound_continuity_fallback",
          ];

    return {
      decision: {
        exerciseId: input.candidate.exerciseId,
        role: input.candidate.role,
        priorIntent: input.candidate.priorIntent,
        priorSlotId: input.candidate.priorSlotId ?? input.candidate.evidence.latestSourceSlotId,
        action,
        targetIntent,
        signalQuality: hasReceiptBackedSlotEvidence ? "high" : "medium",
        reasonCodes,
      },
      reasonCodes,
      signalQuality: hasReceiptBackedSlotEvidence ? "high" : "medium",
    };
  }

  const reasonCodes =
    input.candidate.evidence.exposureCount > 0
      ? ["accessory_rotation_fallback_pending_action_refinement"]
      : ["accessory_rotation_default"];

  return {
    decision: {
      exerciseId: input.candidate.exerciseId,
      role: input.candidate.role,
      priorIntent: input.candidate.priorIntent,
      priorSlotId: input.candidate.priorSlotId ?? input.candidate.evidence.latestSourceSlotId,
      action,
      targetIntent,
      signalQuality: "medium",
      reasonCodes,
    },
    reasonCodes,
    signalQuality: "medium",
  };
}

export function designNextMesocycle(context: GenesisPolicyContext): NextMesocycleDesign {
  const designedAt = new Date().toISOString();
  const profile = resolveSourceProfile(context);
  const frequency = resolveRecommendedSessionsPerWeek(context);
  const split = resolveRecommendedSplitType({
    sessionsPerWeek: frequency.decision,
    preferences: context.preferences,
  });
  const startingPoint = resolveStartingPoint();
  const structure = toDesignSlotStructure({
    splitType: split.decision,
    sessionsPerWeek: frequency.decision,
    daysPerWeek: frequency.decision,
  });
  const carryForwardDecisions = context.carryForwardCandidateEvidence.map((candidate) =>
    buildCarryForwardDecision({
      splitType: structure.splitType,
      candidate,
    }).decision
  );

  return {
    version: 1,
    designedAt,
    sourceMesocycleId: context.sourceProfile.sourceMesocycleId,
    profile: profile.decision,
    structure,
    carryForward: {
      decisions: carryForwardDecisions,
    },
    startingPoint: startingPoint.decision,
    explainability: {
      profileReasonCodes: profile.reasonCodes,
      profileSignalQuality: profile.signalQuality,
      structureReasonCodes: [...frequency.reasonCodes, ...split.reasonCodes],
      structureSignalQuality:
        frequency.signalQuality === "high" || split.signalQuality === "high" ? "high" : "medium",
      startingPointReasonCodes: startingPoint.reasonCodes,
      startingPointSignalQuality: startingPoint.signalQuality,
    },
  };
}

export function buildRecommendedDraftFromDesign(input: {
  design: NextMesocycleDesign;
  carryForwardCandidateEvidence: GenesisPolicyContext["carryForwardCandidateEvidence"];
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
    carryForwardSelections: input.carryForwardCandidateEvidence.map((candidate) => {
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
          signalQuality: baseDecision?.signalQuality ?? "medium",
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
        signalQuality: "medium",
        reasonCodes: [],
      })),
    },
    startingPoint: input.draft.startingPoint,
    explainability: {
      profileReasonCodes: [],
      profileSignalQuality: "medium",
      structureReasonCodes: ["legacy_pending_handoff_fallback"],
      structureSignalQuality: "medium",
      startingPointReasonCodes: [],
      startingPointSignalQuality: "medium",
    },
  };
}
