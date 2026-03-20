import {
  deriveCurrentMesocycleSession,
  deriveNextAdvancingIntentByWeeklySubtraction,
  type CanonicalMesocycleSession,
} from "@/lib/api/mesocycle-lifecycle-math";
import {
  resolveMesocycleSlotContract,
  type NormalizedMesocycleSlot,
} from "./mesocycle-slot-contract";

type MesocycleState = "ACTIVE_ACCUMULATION" | "ACTIVE_DELOAD" | "AWAITING_HANDOFF" | "COMPLETED";

type SessionDerivationInput = {
  state: MesocycleState;
  accumulationSessionsCompleted: number;
  deloadSessionsCompleted: number;
  sessionsPerWeek: number;
  durationWeeks: number;
};

export type RuntimeSessionSlot = NormalizedMesocycleSlot;

export type RuntimeSlotSequence = {
  slots: RuntimeSessionSlot[];
  source: "mesocycle_slot_sequence" | "legacy_weekly_schedule";
  hasPersistedSequence: boolean;
};

export type NextRuntimeSlotSession = CanonicalMesocycleSession & {
  intent: string | null;
  slotId: string | null;
  slotSequenceIndex: number | null;
  slotSource: RuntimeSlotSequence["source"] | null;
};

export function readRuntimeSlotSequence(input: {
  slotSequenceJson?: unknown;
  weeklySchedule?: readonly string[];
}): RuntimeSlotSequence {
  return resolveMesocycleSlotContract(input);
}

function findFirstUnperformedSlot(
  slots: readonly RuntimeSessionSlot[],
  performedSlotIds: readonly string[]
): RuntimeSessionSlot | null {
  const performed = new Set(performedSlotIds);
  return slots.find((slot) => !performed.has(slot.slotId)) ?? null;
}

export function deriveNextRuntimeSlotSession(input: {
  mesocycle: SessionDerivationInput;
  slotSequenceJson?: unknown;
  weeklySchedule?: readonly string[];
  performedAdvancingSlotIdsThisWeek?: readonly string[];
  performedAdvancingIntentsThisWeek?: readonly string[];
}): NextRuntimeSlotSession {
  const current = deriveCurrentMesocycleSession(input.mesocycle);
  const slotSequence = readRuntimeSlotSequence({
    slotSequenceJson: input.slotSequenceJson,
    weeklySchedule: input.weeklySchedule,
  });
  const fallbackSlot =
    slotSequence.slots.length > 0
      ? slotSequence.slots[(current.session - 1) % slotSequence.slots.length] ?? null
      : null;
  const expectedPerformedCount = Math.max(0, current.session - 1);
  const normalizedPerformedSlotIds = (input.performedAdvancingSlotIdsThisWeek ?? [])
    .filter((slotId) => typeof slotId === "string" && slotId.length > 0)
    .filter((slotId) => slotSequence.slots.some((slot) => slot.slotId === slotId));

  if (
    slotSequence.hasPersistedSequence &&
    normalizedPerformedSlotIds.length === expectedPerformedCount
  ) {
    const nextSlot = findFirstUnperformedSlot(slotSequence.slots, normalizedPerformedSlotIds);
    if (nextSlot) {
      return {
        ...current,
        intent: nextSlot.intent,
        slotId: nextSlot.slotId,
        slotSequenceIndex: nextSlot.sequenceIndex,
        slotSource: slotSequence.source,
      };
    }
  }

  if (!slotSequence.hasPersistedSequence) {
    const subtractionDerived = deriveNextAdvancingIntentByWeeklySubtraction(
      input.weeklySchedule ?? [],
      input.performedAdvancingIntentsThisWeek
    );
    const normalizedPerformedIntentCount = (input.performedAdvancingIntentsThisWeek ?? [])
      .map((intent) => intent.trim().toLowerCase())
      .filter((intent) => intent.length > 0).length;
    if (
      subtractionDerived.usesSubtraction &&
      normalizedPerformedIntentCount === expectedPerformedCount
    ) {
      const subtractionSlot =
        subtractionDerived.scheduleIndex != null
          ? slotSequence.slots[subtractionDerived.scheduleIndex] ?? null
          : null;
      return {
        ...current,
        intent: subtractionDerived.intent,
        slotId: subtractionSlot?.slotId ?? null,
        slotSequenceIndex: subtractionSlot?.sequenceIndex ?? subtractionDerived.scheduleIndex,
        slotSource: slotSequence.slots.length > 0 ? slotSequence.source : null,
      };
    }
  }

  return {
    ...current,
    intent: fallbackSlot?.intent ?? null,
    slotId: fallbackSlot?.slotId ?? null,
    slotSequenceIndex: fallbackSlot?.sequenceIndex ?? null,
    slotSource: fallbackSlot ? slotSequence.source : null,
  };
}

function consumeFirstMatchingSlot(
  remaining: RuntimeSessionSlot[],
  slotId: string | null | undefined,
  intent: string | null | undefined
): void {
  if (slotId) {
    const slotIndex = remaining.findIndex((slot) => slot.slotId === slotId);
    if (slotIndex >= 0) {
      remaining.splice(slotIndex, 1);
      return;
    }
  }

  if (intent) {
    const normalizedIntent = intent.trim().toLowerCase();
    const intentIndex = remaining.findIndex((slot) => slot.intent === normalizedIntent);
    if (intentIndex >= 0) {
      remaining.splice(intentIndex, 1);
      return;
    }
  }

  if (remaining.length > 0) {
    remaining.shift();
  }
}

export function buildRemainingFutureSlotsFromRuntime(input: {
  slotSequenceJson?: unknown;
  weeklySchedule?: readonly string[];
  performedAdvancingSlotsThisWeek?: ReadonlyArray<{ slotId?: string | null; intent?: string | null }>;
  currentSlotId?: string | null;
  currentIntent: string;
}): RuntimeSessionSlot[] {
  const slotSequence = readRuntimeSlotSequence({
    slotSequenceJson: input.slotSequenceJson,
    weeklySchedule: input.weeklySchedule,
  });
  const remaining = [...slotSequence.slots];

  for (const performed of input.performedAdvancingSlotsThisWeek ?? []) {
    consumeFirstMatchingSlot(remaining, performed.slotId, performed.intent);
  }

  consumeFirstMatchingSlot(remaining, input.currentSlotId, input.currentIntent);
  return remaining;
}
