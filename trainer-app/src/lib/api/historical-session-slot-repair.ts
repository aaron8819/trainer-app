import { readSessionDecisionReceipt, readSessionSlotSnapshot } from "@/lib/evidence/session-decision-receipt";
import type { SessionSlotSnapshot } from "@/lib/evidence/types";
import { deriveSessionSemantics } from "@/lib/session-semantics/derive-session-semantics";
import { resolveMesocycleSlotContract } from "./mesocycle-slot-contract";
import { parseSlotPlanSeedJson } from "./slot-plan-seed-parser";

export const HISTORICAL_SESSION_SLOT_PERSISTENCE_FIX_CUTOFF_ISO =
  "2026-03-25T01:54:40.000Z";

type HistoricalRepairWorkoutExercise = {
  exerciseId: string;
  orderIndex: number;
};

type HistoricalRepairConflictWorkout = {
  id: string;
  advancesSplit: boolean | null;
  selectionMode: string | null;
  sessionIntent: string | null;
  selectionMetadata?: unknown;
  mesocycleWeekSnapshot?: number | null;
};

type HistoricalRepairSeededSlot = {
  slotId: string;
  intent: string;
  sequenceIndex: number;
  sequenceLength: number;
  source: "mesocycle_slot_sequence";
  exerciseIds: string[];
};

export type HistoricalSessionSlotRepairInput = {
  id: string;
  advancesSplit: boolean | null;
  selectionMode: string | null;
  sessionIntent: string | null;
  selectionMetadata?: unknown;
  mesocycleWeekSnapshot?: number | null;
  exercises: HistoricalRepairWorkoutExercise[];
  mesocycle?: {
    slotSequenceJson?: unknown;
    slotPlanSeedJson?: unknown;
  } | null;
  conflictingWorkouts?: HistoricalRepairConflictWorkout[];
};

type HistoricalSessionSlotRepairBaseResult = {
  workoutId: string;
  candidateWeek: number | null;
  matchedSlotIds: string[];
  workoutExerciseIds: string[];
};

export type HistoricalSessionSlotRepairResult =
  | (HistoricalSessionSlotRepairBaseResult & {
      kind: "repairable";
      sessionSlot: SessionSlotSnapshot;
    })
  | (HistoricalSessionSlotRepairBaseResult & {
      kind:
        | "skipped_missing_receipt"
        | "skipped_already_stamped"
        | "skipped_not_advancing"
        | "skipped_unseeded"
        | "skipped_no_match"
        | "skipped_ambiguous";
      reason: string;
    })
  | (HistoricalSessionSlotRepairBaseResult & {
      kind: "skipped_conflict";
      reason: string;
      conflictingWorkoutIds: string[];
    });

function normalizeIntent(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function normalizeOrderedWorkoutExerciseIds(
  exercises: HistoricalRepairWorkoutExercise[]
): string[] {
  return [...exercises]
    .sort((left, right) => left.orderIndex - right.orderIndex)
    .map((exercise) => exercise.exerciseId.trim())
    .filter((exerciseId) => exerciseId.length > 0);
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => value === right[index]);
}

function parseSeededSlots(input: {
  slotSequenceJson?: unknown;
  slotPlanSeedJson?: unknown;
}): HistoricalRepairSeededSlot[] | null {
  const slotContract = resolveMesocycleSlotContract({
    slotSequenceJson: input.slotSequenceJson,
    weeklySchedule: [],
  });
  if (!slotContract.hasPersistedSequence || slotContract.source !== "mesocycle_slot_sequence") {
    return null;
  }

  const seed = parseSlotPlanSeedJson(input.slotPlanSeedJson);
  if (!seed) {
    return null;
  }

  const seedExercisesBySlotId = new Map<string, string[]>();
  for (const slot of seed.slots) {
    const exerciseIds = slot.exercises.map((exercise) => exercise.exerciseId);
    if (exerciseIds.length === 0) {
      return null;
    }

    seedExercisesBySlotId.set(slot.slotId, exerciseIds);
  }

  const normalizedSlots = slotContract.slots.flatMap((slot) => {
    const exerciseIds = seedExercisesBySlotId.get(slot.slotId);
    if (!exerciseIds || exerciseIds.length === 0) {
      return [];
    }

    return [
      {
        slotId: slot.slotId,
        intent: slot.intent,
        sequenceIndex: slot.sequenceIndex,
        sequenceLength: slotContract.slots.length,
        source: "mesocycle_slot_sequence" as const,
        exerciseIds,
      },
    ];
  });

  return normalizedSlots.length === slotContract.slots.length ? normalizedSlots : null;
}

function resolveRepairCandidateWeek(input: {
  mesocycleWeekSnapshot?: number | null;
  selectionMetadata?: unknown;
}): number | null {
  if (typeof input.mesocycleWeekSnapshot === "number" && Number.isFinite(input.mesocycleWeekSnapshot)) {
    return input.mesocycleWeekSnapshot;
  }

  const receiptWeek = readSessionDecisionReceipt(input.selectionMetadata)?.cycleContext.weekInMeso;
  return typeof receiptWeek === "number" && Number.isFinite(receiptWeek) ? receiptWeek : null;
}

function buildBaseResult(
  input: HistoricalSessionSlotRepairInput,
  matchedSlotIds: string[] = []
): HistoricalSessionSlotRepairBaseResult {
  return {
    workoutId: input.id,
    candidateWeek: resolveRepairCandidateWeek(input),
    matchedSlotIds,
    workoutExerciseIds: normalizeOrderedWorkoutExerciseIds(input.exercises),
  };
}

function findConflictingSlotClaims(input: {
  slotId: string;
  candidateWeek: number | null;
  conflictingWorkouts: HistoricalRepairConflictWorkout[];
}): string[] {
  return input.conflictingWorkouts.flatMap((workout) => {
    const semantics = deriveSessionSemantics({
      advancesSplit: workout.advancesSplit,
      selectionMetadata: workout.selectionMetadata,
      selectionMode: workout.selectionMode,
      sessionIntent: workout.sessionIntent,
    });
    if (!semantics.consumesWeeklyScheduleIntent) {
      return [];
    }

    const workoutWeek = resolveRepairCandidateWeek({
      mesocycleWeekSnapshot: workout.mesocycleWeekSnapshot,
      selectionMetadata: workout.selectionMetadata,
    });
    if (input.candidateWeek != null && workoutWeek != null && workoutWeek !== input.candidateWeek) {
      return [];
    }

    const slotSnapshot = readSessionSlotSnapshot(workout.selectionMetadata);
    if (slotSnapshot?.slotId !== input.slotId) {
      return [];
    }

    return [workout.id];
  });
}

export function inferHistoricalSessionSlotRepair(
  input: HistoricalSessionSlotRepairInput
): HistoricalSessionSlotRepairResult {
  const base = buildBaseResult(input);
  const receipt = readSessionDecisionReceipt(input.selectionMetadata);
  if (!receipt) {
    return {
      ...base,
      kind: "skipped_missing_receipt",
      reason: "Canonical sessionDecisionReceipt is missing or invalid.",
    };
  }

  if (receipt.sessionSlot) {
    return {
      ...base,
      kind: "skipped_already_stamped",
      reason: `Receipt already carries slot ${receipt.sessionSlot.slotId}.`,
    };
  }

  const semantics = deriveSessionSemantics({
    advancesSplit: input.advancesSplit,
    selectionMetadata: input.selectionMetadata,
    selectionMode: input.selectionMode,
    sessionIntent: input.sessionIntent,
  });
  if (!semantics.consumesWeeklyScheduleIntent) {
    return {
      ...base,
      kind: "skipped_not_advancing",
      reason: "Workout does not consume the advancing slot sequence.",
    };
  }

  const mesocycle = input.mesocycle;
  const seededSlots = parseSeededSlots({
    slotSequenceJson: mesocycle?.slotSequenceJson,
    slotPlanSeedJson: mesocycle?.slotPlanSeedJson,
  });
  if (!seededSlots) {
    return {
      ...base,
      kind: "skipped_unseeded",
      reason: "Persisted ordered-flex slot sequence or slot-plan seed is missing or invalid.",
    };
  }

  const sessionIntent = normalizeIntent(input.sessionIntent);
  if (!sessionIntent) {
    return {
      ...base,
      kind: "skipped_no_match",
      reason: "Workout session intent is missing.",
    };
  }

  const workoutExerciseIds = normalizeOrderedWorkoutExerciseIds(input.exercises);
  const matchingSlots = seededSlots.filter(
    (slot) => slot.intent === sessionIntent && arraysEqual(slot.exerciseIds, workoutExerciseIds)
  );
  const matchedSlotIds = matchingSlots.map((slot) => slot.slotId);
  if (matchingSlots.length === 0) {
    return {
      ...buildBaseResult(input, matchedSlotIds),
      kind: "skipped_no_match",
      reason: "Workout exercise composition does not exactly match any same-intent seeded slot.",
    };
  }

  if (matchingSlots.length > 1) {
    return {
      ...buildBaseResult(input, matchedSlotIds),
      kind: "skipped_ambiguous",
      reason: "Workout exercise composition matches multiple same-intent seeded slots.",
    };
  }

  const matchedSlot = matchingSlots[0];
  const conflictingWorkoutIds = findConflictingSlotClaims({
    slotId: matchedSlot.slotId,
    candidateWeek: base.candidateWeek,
    conflictingWorkouts: input.conflictingWorkouts ?? [],
  });
  if (conflictingWorkoutIds.length > 0) {
    return {
      ...buildBaseResult(input, matchedSlotIds),
      kind: "skipped_conflict",
      reason: `Slot ${matchedSlot.slotId} is already claimed by another performed workout in the same repair window.`,
      conflictingWorkoutIds,
    };
  }

  return {
    ...buildBaseResult(input, matchedSlotIds),
    kind: "repairable",
    sessionSlot: {
      slotId: matchedSlot.slotId,
      intent: matchedSlot.intent,
      sequenceIndex: matchedSlot.sequenceIndex,
      sequenceLength: matchedSlot.sequenceLength,
      source: matchedSlot.source,
    },
  };
}
