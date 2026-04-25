export type SlotPlanSeedRole = "CORE_COMPOUND" | "ACCESSORY";

export type ParsedSlotPlanSeedExercise = {
  exerciseId: string;
  name?: string;
  role: SlotPlanSeedRole;
  setCount?: number;
  hasExplicitName: boolean;
  hasExplicitSetCount: boolean;
};

export type ParsedSlotPlanSeedSlot = {
  slotId: string;
  exercises: ParsedSlotPlanSeedExercise[];
};

export type ParsedSlotPlanSeed = {
  version: 1;
  source?: string;
  slots: ParsedSlotPlanSeedSlot[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isSlotPlanSeedRole(value: unknown): value is SlotPlanSeedRole {
  return value === "CORE_COMPOUND" || value === "ACCESSORY";
}

export function parseSlotPlanSeedJson(slotPlanSeedJson: unknown): ParsedSlotPlanSeed | null {
  const record = isRecord(slotPlanSeedJson) ? slotPlanSeedJson : null;
  const slotsValue = Array.isArray(record?.slots) ? record.slots : null;
  if (record?.version !== 1 || !slotsValue) {
    return null;
  }

  const slots: ParsedSlotPlanSeedSlot[] = [];
  for (const entry of slotsValue) {
    const slot = isRecord(entry) ? entry : null;
    const slotId = typeof slot?.slotId === "string" ? slot.slotId.trim() : "";
    const exercisesValue = Array.isArray(slot?.exercises) ? slot.exercises : null;
    if (!slotId || !exercisesValue) {
      return null;
    }

    const exercises: ParsedSlotPlanSeedExercise[] = [];
    for (const exercise of exercisesValue) {
      const seededExercise = isRecord(exercise) ? exercise : null;
      const exerciseId =
        typeof seededExercise?.exerciseId === "string"
          ? seededExercise.exerciseId.trim()
          : "";
      const role = seededExercise?.role;
      const rawName = seededExercise?.name;
      const name = typeof rawName === "string" ? rawName.trim() : undefined;
      const hasExplicitName = rawName !== undefined;
      const rawSetCount = seededExercise?.setCount;
      const hasExplicitSetCount = rawSetCount !== undefined;
      const setCount =
        typeof rawSetCount === "number" && Number.isInteger(rawSetCount) && rawSetCount > 0
          ? rawSetCount
          : undefined;
      if (!exerciseId || !isSlotPlanSeedRole(role)) {
        return null;
      }
      if (hasExplicitSetCount && setCount == null) {
        return null;
      }
      if (hasExplicitName && !name) {
        return null;
      }

      exercises.push({
        exerciseId,
        ...(name ? { name } : {}),
        role,
        ...(setCount != null ? { setCount } : {}),
        hasExplicitName,
        hasExplicitSetCount,
      });
    }

    slots.push({
      slotId,
      exercises,
    });
  }

  return {
    version: 1,
    source:
      typeof record.source === "string" && record.source.trim().length > 0
        ? record.source
        : undefined,
    slots,
  };
}
