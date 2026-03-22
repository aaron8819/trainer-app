import type { SplitType, WorkoutSessionIntent } from "@prisma/client";
import {
  buildOrderedFlexibleSlots,
  getAllowedIntentsForSplit,
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

const MAX_ACCESSORY_KEEPS_PER_SLOT = 2;

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

function resolveCompatibleWeeklyScheduleOrder(input: {
  context: GenesisPolicyContext;
  splitType: SplitType;
  sessionsPerWeek: number;
}): GenesisPolicyBranchResult<WorkoutSessionIntent[] | undefined> {
  if (input.context.preferences.preferredSessionsPerWeekSource !== "weekly_schedule_length") {
    return {
      decision: undefined,
      reasonCodes: [],
      signalQuality: "medium",
    };
  }

  const weeklySchedule = input.context.sourceTopology.weeklySequence.slice(0, input.sessionsPerWeek);
  if (weeklySchedule.length !== input.sessionsPerWeek) {
    return {
      decision: undefined,
      reasonCodes: [],
      signalQuality: "medium",
    };
  }

  const allowedIntents = new Set(getAllowedIntentsForSplit(input.splitType));
  if (!weeklySchedule.every((intent) => allowedIntents.has(intent))) {
    return {
      decision: undefined,
      reasonCodes: [],
      signalQuality: "medium",
    };
  }

  return {
    decision: weeklySchedule,
    reasonCodes: ["explicit_weekly_schedule_order_honored"],
    signalQuality: "high",
  };
}

function toDesignSlotStructure(input: {
  splitType: SplitType;
  sessionsPerWeek: number;
  daysPerWeek: number;
  intents?: WorkoutSessionIntent[];
}): NextMesocycleDesign["structure"] {
  const slots = buildOrderedFlexibleSlots({
    splitType: input.splitType,
    sessionsPerWeek: input.sessionsPerWeek,
    intents: input.intents,
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

function hasAdvancingContinuityEvidence(
  candidate: GenesisPolicyContext["carryForwardCandidateEvidence"][number]
): boolean {
  return (
    candidate.evidence.advancingExposureCount > 0 &&
    candidate.evidence.latestSemanticsKind === "advancing"
  );
}

function hasHighConfidenceAccessoryContinuity(
  candidate: GenesisPolicyContext["carryForwardCandidateEvidence"][number]
): boolean {
  return hasAdvancingContinuityEvidence(candidate) && candidate.evidence.advancingExposureCount >= 2;
}

function resolveUnambiguousRepeatedSlotTarget(input: {
  context: GenesisPolicyContext;
  structure: NextMesocycleDesign["structure"];
  candidate: GenesisPolicyContext["carryForwardCandidateEvidence"][number];
  targetIntent: WorkoutSessionIntent;
}): string | undefined {
  const priorSlotId = input.candidate.priorSlotId ?? input.candidate.evidence.latestSourceSlotId;
  if (!priorSlotId || input.candidate.priorIntent !== input.targetIntent) {
    return undefined;
  }

  const sourceSlots = input.context.sourceTopology.slots.filter(
    (slot) => slot.intent === input.targetIntent
  );
  const targetSlots = input.structure.slots.filter((slot) => slot.intent === input.targetIntent);
  if (sourceSlots.length <= 1 || targetSlots.length <= 1 || sourceSlots.length !== targetSlots.length) {
    return undefined;
  }

  const sourceIndex = sourceSlots.findIndex((slot) => slot.slotId === priorSlotId);
  if (sourceIndex < 0) {
    return undefined;
  }

  return targetSlots[sourceIndex]?.slotId;
}

function buildCarryForwardDecision(input: {
  context: GenesisPolicyContext;
  structure: NextMesocycleDesign["structure"];
  candidate: GenesisPolicyContext["carryForwardCandidateEvidence"][number];
}): GenesisPolicyBranchResult<NextMesocycleCarryForwardDecision> {
  const hasReceiptBackedSlotEvidence = Boolean(input.candidate.evidence.latestSourceSlotId);
  const hasAdvancingEvidence = hasAdvancingContinuityEvidence(input.candidate);
  const targetIntent =
    remapCompatibleCarryForwardIntent({
      splitType: input.structure.splitType,
      sessionIntent: input.candidate.priorIntent,
    });
  const priorSlotId = input.candidate.priorSlotId ?? input.candidate.evidence.latestSourceSlotId;

  let action: NextMesocycleCarryForwardDecision["action"];
  let signalQuality: GenesisPolicyBranchResult<NextMesocycleCarryForwardDecision>["signalQuality"];
  let reasonCodes: string[];

  if (input.candidate.anchorLevel === "required") {
    action = "keep";
    if (hasReceiptBackedSlotEvidence) {
      signalQuality = "high";
      reasonCodes = ["required_anchor_continuity_supported_by_receipt_slot"];
    } else if (hasAdvancingEvidence) {
      signalQuality = "high";
      reasonCodes = ["required_anchor_continuity_supported_by_advancing_exposure"];
    } else {
      signalQuality = "medium";
      reasonCodes = ["required_anchor_continuity_fallback"];
    }
  } else if (
    input.candidate.role === "CORE_COMPOUND" &&
    hasAdvancingEvidence
  ) {
    action = "keep";
    signalQuality = "high";
    reasonCodes = [
      hasReceiptBackedSlotEvidence
        ? "core_compound_continuity_supported_by_receipt_slot"
        : "core_compound_continuity_supported_by_advancing_exposure",
    ];
  } else if (
    input.candidate.role === "ACCESSORY" &&
    hasHighConfidenceAccessoryContinuity(input.candidate)
  ) {
    action = "keep";
    signalQuality = "high";
    reasonCodes = [
      hasReceiptBackedSlotEvidence
        ? "accessory_continuity_supported_by_receipt_slot"
        : "accessory_continuity_supported_by_advancing_exposure",
    ];
  } else if (
    input.candidate.role === "ACCESSORY" &&
    input.candidate.evidence.exposureCount === 0 &&
    input.candidate.evidence.latestPerformedAt === null
  ) {
    action = "drop";
    signalQuality = "high";
    reasonCodes = ["accessory_drop_no_mesocycle_exposure"];
  } else {
    action = "rotate";
    signalQuality = "medium";
    if (
      input.candidate.role === "ACCESSORY" &&
      input.candidate.evidence.exposureCount > 0 &&
      input.candidate.evidence.advancingExposureCount === 0
    ) {
      reasonCodes = ["accessory_rotation_non_advancing_only"];
    } else if (hasAdvancingEvidence) {
      reasonCodes = ["carry_forward_rotation_ambiguous_slot_target"];
    } else {
      reasonCodes = ["carry_forward_rotation_fallback"];
    }
  }

  if (action === "keep") {
    const targetSlotId = resolveUnambiguousRepeatedSlotTarget({
      context: input.context,
      structure: input.structure,
      candidate: input.candidate,
      targetIntent,
    });
    const resolvedReasonCodes = targetSlotId
      ? [...reasonCodes, "repeated_slot_target_mapped_from_prior_slot"]
      : reasonCodes;

    return {
      decision: {
        exerciseId: input.candidate.exerciseId,
        role: input.candidate.role,
        priorIntent: input.candidate.priorIntent,
        priorSlotId,
        action,
        targetIntent,
        targetSlotId,
        signalQuality,
        reasonCodes: resolvedReasonCodes,
      },
      reasonCodes: resolvedReasonCodes,
      signalQuality,
    };
  }

  return {
    decision: {
      exerciseId: input.candidate.exerciseId,
      role: input.candidate.role,
      priorIntent: input.candidate.priorIntent,
      priorSlotId,
      action,
      targetIntent: undefined,
      signalQuality,
      reasonCodes,
    },
    reasonCodes,
    signalQuality,
  };
}

type PendingCarryForwardDecision = {
  candidate: GenesisPolicyContext["carryForwardCandidateEvidence"][number];
  decision: NextMesocycleCarryForwardDecision;
};

function compareAccessoryKeepStrength(
  left: PendingCarryForwardDecision,
  right: PendingCarryForwardDecision
): number {
  const leftHasReceiptSlot = Boolean(left.candidate.evidence.latestSourceSlotId);
  const rightHasReceiptSlot = Boolean(right.candidate.evidence.latestSourceSlotId);
  if (leftHasReceiptSlot !== rightHasReceiptSlot) {
    return leftHasReceiptSlot ? -1 : 1;
  }

  if (
    left.candidate.evidence.advancingExposureCount !== right.candidate.evidence.advancingExposureCount
  ) {
    return right.candidate.evidence.advancingExposureCount - left.candidate.evidence.advancingExposureCount;
  }

  if (left.candidate.evidence.exposureCount !== right.candidate.evidence.exposureCount) {
    return right.candidate.evidence.exposureCount - left.candidate.evidence.exposureCount;
  }

  const leftPerformedAt = left.candidate.evidence.latestPerformedAt
    ? Date.parse(left.candidate.evidence.latestPerformedAt)
    : Number.NEGATIVE_INFINITY;
  const rightPerformedAt = right.candidate.evidence.latestPerformedAt
    ? Date.parse(right.candidate.evidence.latestPerformedAt)
    : Number.NEGATIVE_INFINITY;
  if (leftPerformedAt !== rightPerformedAt) {
    return rightPerformedAt - leftPerformedAt;
  }

  return left.candidate.exerciseName.localeCompare(right.candidate.exerciseName);
}

function capAccessoryCarryForwardKeeps(input: {
  structure: NextMesocycleDesign["structure"];
  pendingDecisions: PendingCarryForwardDecision[];
}): NextMesocycleCarryForwardDecision[] {
  const accessoryKeepCapacityByIntent = new Map<WorkoutSessionIntent, number>();
  for (const slot of input.structure.slots) {
    accessoryKeepCapacityByIntent.set(
      slot.intent,
      (accessoryKeepCapacityByIntent.get(slot.intent) ?? 0) + MAX_ACCESSORY_KEEPS_PER_SLOT
    );
  }

  const rotatedKeys = new Set<string>();
  for (const [intent, capacity] of accessoryKeepCapacityByIntent.entries()) {
    const protectedKeeps = input.pendingDecisions.filter(
      ({ candidate, decision }) =>
        decision.action === "keep" &&
        decision.role === "ACCESSORY" &&
        decision.targetIntent === intent &&
        candidate.anchorLevel !== "none"
    );
    const cappedCandidates = input.pendingDecisions
      .filter(
        ({ candidate, decision }) =>
          decision.action === "keep" &&
          decision.role === "ACCESSORY" &&
          decision.targetIntent === intent &&
          candidate.anchorLevel === "none"
      )
      .sort(compareAccessoryKeepStrength);
    const remainingCapacity = Math.max(0, capacity - protectedKeeps.length);

    for (const cappedCandidate of cappedCandidates.slice(remainingCapacity)) {
      rotatedKeys.add(`${cappedCandidate.candidate.exerciseId}:${cappedCandidate.candidate.role}`);
    }
  }

  return input.pendingDecisions.map(({ candidate, decision }) => {
    if (!rotatedKeys.has(`${candidate.exerciseId}:${candidate.role}`)) {
      return decision;
    }

    return {
      ...decision,
      action: "rotate",
      targetIntent: undefined,
      targetSlotId: undefined,
      signalQuality: "medium",
      reasonCodes: ["accessory_rotation_slot_capacity_cap", ...decision.reasonCodes],
    };
  });
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
  const scheduleOrder = resolveCompatibleWeeklyScheduleOrder({
    context,
    splitType: split.decision,
    sessionsPerWeek: frequency.decision,
  });
  const structure = toDesignSlotStructure({
    splitType: split.decision,
    sessionsPerWeek: frequency.decision,
    daysPerWeek: frequency.decision,
    intents: scheduleOrder.decision,
  });
  const pendingDecisions = context.carryForwardCandidateEvidence.map((candidate) => ({
    candidate,
    decision: buildCarryForwardDecision({
      context,
      structure,
      candidate,
    }).decision,
  }));
  const carryForwardDecisions = capAccessoryCarryForwardKeeps({
    structure,
    pendingDecisions,
  });

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
      structureReasonCodes: [...frequency.reasonCodes, ...split.reasonCodes, ...scheduleOrder.reasonCodes],
      structureSignalQuality:
        frequency.signalQuality === "high" ||
        split.signalQuality === "high" ||
        scheduleOrder.signalQuality === "high"
          ? "high"
          : "medium",
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
          targetSlotId:
            selection.action === "keep" &&
            baseDecision?.targetSlotId &&
            input.draft.structure.slots.some(
              (slot) =>
                slot.slotId === baseDecision.targetSlotId && slot.intent === selection.sessionIntent
            )
              ? baseDecision.targetSlotId
              : undefined,
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
