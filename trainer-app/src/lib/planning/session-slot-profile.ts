import type { SessionIntent } from "@/lib/engine/session-types";
import type { MovementPatternV2 } from "@/lib/engine/types";
import { parseSessionIntent } from "./session-opportunities";

type SlotSequenceEntry = {
  slotId: string;
  intent: string;
  sequenceIndex?: number;
};

type RepeatedSlotMetadata = {
  occurrenceIndex: number;
  totalSlots: number;
};

export type SessionSlotCompoundBias = {
  preferredMovementPatterns: MovementPatternV2[];
  preferredPrimaryMuscles?: string[];
};

export type SessionSlotPolicySlot = {
  sessionIntent: SessionIntent;
  slotId: string;
  sequenceIndex: number;
  repeatedSlot?: RepeatedSlotMetadata;
  compoundBias?: SessionSlotCompoundBias;
};

export type SessionSlotPolicy = {
  currentSession: SessionSlotPolicySlot | null;
  futurePlanning: {
    futureSlots: SessionSlotPolicySlot[];
  };
};

function normalizeIntent(intent: string): string {
  return intent.trim().toLowerCase();
}

function normalizeSlotEntries(
  slots: readonly SlotSequenceEntry[]
): Array<{ slotId: string; intent: SessionIntent; sequenceIndex: number }> {
  return slots
    .map((slot, index) => {
      const intent = parseSessionIntent(slot.intent);
      const slotId = slot.slotId?.trim();
      if (!intent || !slotId) {
        return null;
      }
      return {
        slotId,
        intent,
        sequenceIndex: slot.sequenceIndex ?? index,
      };
    })
    .filter((slot): slot is { slotId: string; intent: SessionIntent; sequenceIndex: number } =>
      Boolean(slot)
    );
}

function resolveCompoundBias(
  sessionIntent: SessionIntent,
  occurrenceIndex: number
): SessionSlotCompoundBias | undefined {
  const prefersVertical = occurrenceIndex % 2 === 1;

  switch (sessionIntent) {
    case "upper":
      return {
        preferredMovementPatterns: prefersVertical
          ? ["vertical_push", "vertical_pull"]
          : ["horizontal_push", "horizontal_pull"],
      };
    case "push":
      return {
        preferredMovementPatterns: [prefersVertical ? "vertical_push" : "horizontal_push"],
      };
    case "pull":
      return {
        preferredMovementPatterns: [prefersVertical ? "vertical_pull" : "horizontal_pull"],
      };
    case "lower":
      return prefersVertical
        ? {
            preferredMovementPatterns: ["hinge"],
            preferredPrimaryMuscles: ["Hamstrings", "Glutes"],
          }
        : {
            preferredMovementPatterns: ["squat"],
            preferredPrimaryMuscles: ["Quads"],
          };
    default:
      return undefined;
  }
}

function supportsRepeatedSlotProfiles(intent: SessionIntent): boolean {
  return intent === "upper" || intent === "lower" || intent === "push" || intent === "pull";
}

function resolveRepeatedSlotMetadata(params: {
  slotSequence: Array<{ slotId: string; intent: SessionIntent; sequenceIndex: number }>;
  sessionIntent: SessionIntent;
  slotId: string;
}): RepeatedSlotMetadata | undefined {
  if (!supportsRepeatedSlotProfiles(params.sessionIntent)) {
    return undefined;
  }

  const sameIntentSlots = params.slotSequence.filter(
    (slot) => normalizeIntent(slot.intent) === params.sessionIntent
  );
  if (sameIntentSlots.length <= 1) {
    return undefined;
  }

  const occurrenceIndex = sameIntentSlots.findIndex((slot) => slot.slotId === params.slotId);
  if (occurrenceIndex < 0) {
    return undefined;
  }

  return {
    occurrenceIndex,
    totalSlots: sameIntentSlots.length,
  };
}

function buildPolicySlot(params: {
  slotSequence: Array<{ slotId: string; intent: SessionIntent; sequenceIndex: number }>;
  sessionIntent: SessionIntent;
  slotId: string;
}): SessionSlotPolicySlot | null {
  const slotEntry = params.slotSequence.find(
    (slot) => slot.slotId === params.slotId && slot.intent === params.sessionIntent
  );
  if (!slotEntry) {
    return null;
  }

  const repeatedSlot = resolveRepeatedSlotMetadata(params);

  return {
    sessionIntent: params.sessionIntent,
    slotId: params.slotId,
    sequenceIndex: slotEntry.sequenceIndex,
    repeatedSlot,
    compoundBias:
      repeatedSlot != null
        ? resolveCompoundBias(params.sessionIntent, repeatedSlot.occurrenceIndex)
        : undefined,
  };
}

export function resolveSessionSlotPolicy(input: {
  sessionIntent: SessionIntent;
  slotId?: string;
  slotSequence: {
    slots: readonly SlotSequenceEntry[];
  };
  futureSlots?: readonly SlotSequenceEntry[];
}): SessionSlotPolicy {
  const normalizedSlotSequence = normalizeSlotEntries(input.slotSequence.slots);
  const normalizedSlotId = input.slotId?.trim();
  const currentSession =
    normalizedSlotId && normalizedSlotId.length > 0
      ? buildPolicySlot({
          slotSequence: normalizedSlotSequence,
          sessionIntent: input.sessionIntent,
          slotId: normalizedSlotId,
        })
      : null;

  const futurePlanningSlots = (input.futureSlots ?? [])
    .map((slot) => {
      const sessionIntent = parseSessionIntent(slot.intent);
      const slotId = slot.slotId?.trim();
      if (!sessionIntent || !slotId) {
        return null;
      }
      return buildPolicySlot({
        slotSequence: normalizedSlotSequence,
        sessionIntent,
        slotId,
      });
    })
    .filter((slot): slot is SessionSlotPolicySlot => Boolean(slot));

  return {
    currentSession,
    futurePlanning: {
      futureSlots: futurePlanningSlots,
    },
  };
}

const FUTURE_SLOT_PREFERRED_PRIMARY_MULTIPLIER = 1.15;

export function getFutureSlotOpportunityBias(
  muscle: string,
  slot: SessionSlotPolicySlot
): number {
  const preferredPrimaryMuscles = slot.compoundBias?.preferredPrimaryMuscles ?? [];
  if (preferredPrimaryMuscles.length === 0) {
    return 1;
  }

  const normalizedMuscle = muscle.trim().toLowerCase();
  return preferredPrimaryMuscles.some(
    (preferredMuscle) => preferredMuscle.trim().toLowerCase() === normalizedMuscle
  )
    ? FUTURE_SLOT_PREFERRED_PRIMARY_MULTIPLIER
    : 1;
}
