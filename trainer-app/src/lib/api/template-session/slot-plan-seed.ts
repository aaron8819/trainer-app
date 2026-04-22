import type { TemplateExerciseInput } from "@/lib/engine/template-session";
import type { SessionIntent } from "@/lib/engine/session-types";
import {
  deriveNextRuntimeSlotSession,
  readRuntimeSlotSequence,
} from "@/lib/api/mesocycle-slot-runtime";
import {
  parseSlotPlanSeedJson,
  type SlotPlanSeedRole,
} from "@/lib/api/slot-plan-seed-parser";
import type { MappedGenerationContext } from "./types";

export type NormalizedSeededSlotExercise = {
  exerciseId: string;
  role: SlotPlanSeedRole;
};

export type NormalizedSeededSlot = {
  slotId: string;
  intent: SessionIntent;
  sequenceIndex: number;
  exercises: NormalizedSeededSlotExercise[];
};

export type ResolvedSeededSlotPlan = {
  slotId: string;
  intent: SessionIntent;
  sequenceIndex: number;
  exercises: NormalizedSeededSlotExercise[];
  templateExercises: TemplateExerciseInput[];
};

function buildUnresolvableSeededSlotPlanError(input: {
  sessionIntent: SessionIntent;
  slotId?: string;
}): { error: string } {
  const explicitSlotId = input.slotId?.trim();
  if (explicitSlotId) {
    return {
      error: `Persisted slot plan seed could not be resolved for slot ${explicitSlotId}.`,
    };
  }

  return {
    error: `Persisted slot plan seed could not be resolved for intent ${input.sessionIntent}.`,
  };
}

export function readPersistedSeedSlots(input: {
  slotPlanSeedJson?: unknown;
  mapped: MappedGenerationContext;
}): NormalizedSeededSlot[] | null {
  const activeMesocycle = input.mapped.activeMesocycle;
  if (!activeMesocycle?.slotPlanSeedJson) {
    return null;
  }

  const slotSequence = readRuntimeSlotSequence({
    slotSequenceJson: activeMesocycle.slotSequenceJson,
    weeklySchedule: input.mapped.mappedConstraints.weeklySchedule,
  });
  if (!slotSequence.hasPersistedSequence) {
    return null;
  }

  const seed = parseSlotPlanSeedJson(input.slotPlanSeedJson);
  if (!seed) {
    return null;
  }

  const seedBySlotId = new Map<string, NormalizedSeededSlotExercise[]>();
  for (const slot of seed.slots) {
    seedBySlotId.set(slot.slotId, slot.exercises);
  }

  const normalizedSlots = slotSequence.slots.flatMap((slot) => {
    const exercises = seedBySlotId.get(slot.slotId);
    if (!exercises || exercises.length === 0) {
      return [];
    }
    return [{
      slotId: slot.slotId,
      intent: slot.intent as SessionIntent,
      sequenceIndex: slot.sequenceIndex,
      exercises,
    } satisfies NormalizedSeededSlot];
  });

  return normalizedSlots.length === slotSequence.slots.length ? normalizedSlots : null;
}

function deriveCurrentSeededRuntimeSlot(
  mapped: MappedGenerationContext
): { slotId: string; intent: SessionIntent } | null {
  const activeMesocycle = mapped.activeMesocycle;
  if (!activeMesocycle) {
    return null;
  }

  const performedAdvancingSessionsThisWeek = mapped.history.filter(
    (entry) =>
      entry.advancesSplit === true &&
      entry.mesocycleSnapshot?.mesocycleId === activeMesocycle.id &&
      entry.mesocycleSnapshot.week != null &&
      entry.sessionIntent != null
  );

  const currentWeek = deriveNextRuntimeSlotSession({
    mesocycle: activeMesocycle,
    slotSequenceJson: activeMesocycle.slotSequenceJson,
    weeklySchedule: mapped.mappedConstraints.weeklySchedule,
  }).week;

  const performedThisWeek = performedAdvancingSessionsThisWeek.filter(
    (entry) => entry.mesocycleSnapshot?.week === currentWeek
  );

  const nextRuntimeSlot = deriveNextRuntimeSlotSession({
    mesocycle: activeMesocycle,
    slotSequenceJson: activeMesocycle.slotSequenceJson,
    weeklySchedule: mapped.mappedConstraints.weeklySchedule,
    performedAdvancingSlotIdsThisWeek: performedThisWeek
      .map((entry) => entry.mesocycleSnapshot?.slotId ?? null)
      .filter((slotId): slotId is string => typeof slotId === "string" && slotId.length > 0),
    performedAdvancingIntentsThisWeek: performedThisWeek
      .map((entry) => entry.sessionIntent)
      .filter((intent): intent is NonNullable<typeof intent> => typeof intent === "string" && intent.length > 0),
  });

  if (!nextRuntimeSlot.slotId || !nextRuntimeSlot.intent) {
    return null;
  }

  return {
    slotId: nextRuntimeSlot.slotId,
    intent: nextRuntimeSlot.intent as SessionIntent,
  };
}

function resolveSeededSlotPlan(input: {
  mapped: MappedGenerationContext;
  sessionIntent: SessionIntent;
  slotId?: string;
}): ResolvedSeededSlotPlan | null | { error: string } {
  if (input.sessionIntent === "body_part") {
    return null;
  }

  const seededSlots = readPersistedSeedSlots({
    slotPlanSeedJson: input.mapped.activeMesocycle?.slotPlanSeedJson,
    mapped: input.mapped,
  });
  if (!seededSlots) {
    return null;
  }

  const explicitSlotId = input.slotId?.trim();
  let selectedSlot =
    explicitSlotId != null && explicitSlotId.length > 0
      ? seededSlots.find((slot) => slot.slotId === explicitSlotId) ?? null
      : null;

  if (explicitSlotId && !selectedSlot) {
    return { error: `Persisted slot plan seed not found for slot ${explicitSlotId}.` };
  }

  if (!selectedSlot) {
    const runtimeSlot = deriveCurrentSeededRuntimeSlot(input.mapped);
    if (runtimeSlot && runtimeSlot.intent === input.sessionIntent) {
      selectedSlot =
        seededSlots.find((slot) => slot.slotId === runtimeSlot.slotId) ?? null;
    }
  }

  if (!selectedSlot) {
    const matchingByIntent = seededSlots.filter((slot) => slot.intent === input.sessionIntent);
    if (matchingByIntent.length === 0) {
      return {
        error: `Persisted slot plan seed has no slot for intent ${input.sessionIntent}.`,
      };
    }
    selectedSlot = matchingByIntent[0] ?? null;
  }

  if (!selectedSlot) {
    return null;
  }

  const exerciseById = new Map(
    input.mapped.exerciseLibrary.map((exercise) => [exercise.id, exercise])
  );
  const missingExerciseIds = selectedSlot.exercises
    .map((exercise) => exercise.exerciseId)
    .filter((exerciseId) => !exerciseById.has(exerciseId));
  if (missingExerciseIds.length > 0) {
    return {
      error:
        "Persisted slot plan seed references exercises missing from the exercise library. " +
        `Missing exercise ids: ${missingExerciseIds.join(", ")}`,
    };
  }

  return {
    slotId: selectedSlot.slotId,
    intent: selectedSlot.intent,
    sequenceIndex: selectedSlot.sequenceIndex,
    exercises: selectedSlot.exercises,
    templateExercises: selectedSlot.exercises.map((exercise, orderIndex) => ({
      exercise: exerciseById.get(exercise.exerciseId)!,
      orderIndex,
      mesocycleRole: exercise.role,
    })),
  };
}

function shouldUseSeededSlotPlanRuntime(input: {
  mapped: MappedGenerationContext;
  sessionIntent: SessionIntent;
}): boolean {
  return input.sessionIntent !== "body_part" && Boolean(input.mapped.activeMesocycle?.slotPlanSeedJson);
}

export function resolveRequiredSeededSlotPlan(input: {
  mapped: MappedGenerationContext;
  sessionIntent: SessionIntent;
  slotId?: string;
}): ResolvedSeededSlotPlan | null | { error: string } {
  if (!shouldUseSeededSlotPlanRuntime(input)) {
    return null;
  }

  const resolved = resolveSeededSlotPlan(input);
  return resolved ?? buildUnresolvableSeededSlotPlanError(input);
}
