import type { SessionIntent } from "@/lib/engine/session-types";
import type { MovementPatternV2 } from "@/lib/engine/types";

type SlotSequenceEntry = {
  slotId: string;
  intent: string;
};

export type SessionSlotProfile = {
  sessionIntent: SessionIntent;
  slotId: string;
  repeatedSlot: {
    occurrenceIndex: number;
    totalSlots: number;
  };
  compoundBias?: {
    preferredMovementPatterns: MovementPatternV2[];
    preferredPrimaryMuscles?: string[];
  };
};

function normalizeIntent(intent: string): string {
  return intent.trim().toLowerCase();
}

function resolveCompoundBias(
  sessionIntent: SessionIntent,
  occurrenceIndex: number
): SessionSlotProfile["compoundBias"] | undefined {
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

export function resolveSessionSlotProfile(input: {
  sessionIntent: SessionIntent;
  slotId?: string;
  slotSequence: {
    slots: readonly SlotSequenceEntry[];
  };
}): SessionSlotProfile | null {
  const normalizedSlotId = input.slotId?.trim();
  if (!normalizedSlotId || !supportsRepeatedSlotProfiles(input.sessionIntent)) {
    return null;
  }

  const sameIntentSlots = input.slotSequence.slots.filter(
    (slot) => normalizeIntent(slot.intent) === input.sessionIntent
  );
  if (sameIntentSlots.length <= 1) {
    return null;
  }

  const occurrenceIndex = sameIntentSlots.findIndex((slot) => slot.slotId === normalizedSlotId);
  if (occurrenceIndex < 0) {
    return null;
  }

  return {
    sessionIntent: input.sessionIntent,
    slotId: normalizedSlotId,
    repeatedSlot: {
      occurrenceIndex,
      totalSlots: sameIntentSlots.length,
    },
    compoundBias: resolveCompoundBias(input.sessionIntent, occurrenceIndex),
  };
}
