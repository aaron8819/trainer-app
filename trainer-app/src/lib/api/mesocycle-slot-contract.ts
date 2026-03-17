import type { WorkoutSessionIntent } from "@prisma/client";

export type MesocycleSlotSequence = {
  version: 1;
  source: "handoff_draft";
  sequenceMode: "ordered_flexible";
  slots: Array<{
    slotId: string;
    intent: WorkoutSessionIntent;
  }>;
};

export type NormalizedMesocycleSlot = {
  slotId: string;
  intent: string;
  sequenceIndex: number;
};

export type ResolvedMesocycleSlotContract = {
  slots: NormalizedMesocycleSlot[];
  source: "mesocycle_slot_sequence" | "legacy_weekly_schedule";
  hasPersistedSequence: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeIntent(value: string): string {
  return value.trim().toLowerCase();
}

function toSlotSuffix(index: number): string {
  return String.fromCharCode("a".charCodeAt(0) + index);
}

function buildLegacySlots(weeklySchedule: readonly string[]): NormalizedMesocycleSlot[] {
  const intentCounts = new Map<string, number>();

  return weeklySchedule
    .map((intent) => normalizeIntent(intent))
    .filter((intent) => intent.length > 0)
    .map((intent, sequenceIndex) => {
      const count = intentCounts.get(intent) ?? 0;
      intentCounts.set(intent, count + 1);
      return {
        slotId: `${intent}_${toSlotSuffix(count)}`,
        intent,
        sequenceIndex,
      };
    });
}

export function buildMesocycleSlotSequence(
  slots: ReadonlyArray<{ slotId: string; intent: WorkoutSessionIntent }>
): MesocycleSlotSequence {
  return {
    version: 1,
    source: "handoff_draft",
    sequenceMode: "ordered_flexible",
    slots: slots.map((slot) => ({
      slotId: slot.slotId,
      intent: slot.intent,
    })),
  };
}

export function resolveMesocycleSlotContract(input: {
  slotSequenceJson?: unknown;
  weeklySchedule?: readonly string[];
}): ResolvedMesocycleSlotContract {
  const record = isRecord(input.slotSequenceJson) ? input.slotSequenceJson : null;
  const slotsValue = Array.isArray(record?.slots) ? record.slots : null;
  const persistedSlots =
    record?.version === 1 &&
    record?.sequenceMode === "ordered_flexible" &&
    slotsValue
      ? slotsValue.flatMap((entry, sequenceIndex) => {
          const slot = isRecord(entry) ? entry : null;
          if (!slot || typeof slot.slotId !== "string" || typeof slot.intent !== "string") {
            return [];
          }

          const intent = normalizeIntent(slot.intent);
          if (slot.slotId.trim().length === 0 || intent.length === 0) {
            return [];
          }

          return [
            {
              slotId: slot.slotId,
              intent,
              sequenceIndex,
            } satisfies NormalizedMesocycleSlot,
          ];
        })
      : [];

  if (persistedSlots.length > 0) {
    return {
      slots: persistedSlots,
      source: "mesocycle_slot_sequence",
      hasPersistedSequence: true,
    };
  }

  return {
    slots: buildLegacySlots(input.weeklySchedule ?? []),
    source: "legacy_weekly_schedule",
    hasPersistedSequence: false,
  };
}
