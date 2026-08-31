import { normalizeAcceptedHypertrophySeedV4 } from "./mesocycle-seed-revision";
import { extractSessionDecisionReceipt } from "@/lib/evidence/session-decision-receipt";
import type {
  ScheduledSlotReceiptV1,
  SessionSlotSnapshot,
} from "@/lib/evidence/types";
import { getWorkoutStatusPolicy } from "@/lib/workout-status";
import { parseAcceptedHypertrophySeedV4 } from "@/lib/engine/hypertrophy-plan-authoring";
import { isStrictOptionalGapFillSession } from "@/lib/gap-fill/classifier";
import { isCloseoutSession } from "@/lib/session-semantics/closeout-classifier";
import { isStrictSupplementalDeficitSession } from "@/lib/session-semantics/supplemental-classifier";

type JsonRecord = Record<string, unknown>;

export type V4ScheduleAuthorityInput = {
  id: string;
  durationWeeks: number;
  sessionsPerWeek: number;
  slotSequenceJson?: unknown;
  currentSeedRevisionId?: string | null;
  currentSeedRevision?: {
    id: string;
    mesocycleId: string;
    revision: number;
    seedPayload: unknown;
    payloadHash: string | null;
    hashAlgorithm: string | null;
    provenanceStatus: string;
  } | null;
};

export type V4RequiredSlot = {
  weekInMeso: number;
  phase: "ACCUMULATION" | "DELOAD";
  slotId: string;
  intent: string;
  sequenceIndex: number;
  sequenceLength: number;
};

export type V4ScheduleAuthority = {
  mesocycleId: string;
  revisionId: string;
  revisionNumber: number;
  revisionHash: string;
  slotsPerWeek: number;
  requiredSlots: V4RequiredSlot[];
};

export type V4ScheduledGenerationObligation = {
  authority: V4ScheduleAuthority;
  requiredSlot: V4RequiredSlot;
};

export type V4ScheduleAuthorityResolution =
  | { status: "not_v4" }
  | { status: "available"; authority: V4ScheduleAuthority }
  | { status: "blocked"; reason: string };

export type V4ScheduleWorkoutEvidence = {
  id: string;
  status: unknown;
  mesocycleId: string | null;
  mesocycleWeekSnapshot: number | null;
  mesocyclePhaseSnapshot: unknown;
  mesoSessionSnapshot: number | null;
  advancesSplit: boolean | null;
  selectionMode: string | null;
  sessionIntent: string | null;
  selectionMetadata: unknown;
  seedRevisionId: string | null;
  seedRevisionNumber: number | null;
  seedPayloadHash: string | null;
};

export type V4ResolvedSlotClaim = {
  requiredSlot: V4RequiredSlot;
  workoutId: string;
  status: string;
  scheduleResolved: boolean;
  completed: boolean;
};

export type V4ScheduleResolution =
  | { status: "blocked"; reason: string }
  | {
      status: "available";
      claims: V4ResolvedSlotClaim[];
      resolvedSlotCount: number;
      completedSlotCount: number;
      allAccumulationResolved: boolean;
      allResolved: boolean;
      nextUnresolvedSlot: V4RequiredSlot | null;
      unresolvedSlotsInNextWeek: V4RequiredSlot[];
    };

function record(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  const object = record(value);
  if (object) {
    return `{${Object.entries(object)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

function normalizeIntent(value: string): string {
  return value.trim().toLowerCase();
}

function block(reason: string): V4ScheduleAuthorityResolution {
  return { status: "blocked", reason };
}

export function resolveV4ScheduleAuthority(
  mesocycle: V4ScheduleAuthorityInput,
): V4ScheduleAuthorityResolution {
  const rawSeed = record(mesocycle.currentSeedRevision?.seedPayload);
  if (rawSeed?.version !== 4) return { status: "not_v4" };

  const revision = mesocycle.currentSeedRevision;
  if (
    !revision ||
    mesocycle.currentSeedRevisionId !== revision.id
  ) {
    return block("accepted_revision_identity_invalid");
  }
  if (revision.mesocycleId !== mesocycle.id) {
    return block("accepted_revision_ownership_invalid");
  }
  if (!Number.isInteger(revision.revision) || revision.revision < 1) {
    return block("accepted_revision_number_invalid");
  }
  if (
    revision.hashAlgorithm !== "sha256" ||
    revision.provenanceStatus !== "exact" ||
    !revision.payloadHash
  ) {
    return block("accepted_revision_identity_invalid");
  }

  let normalized: ReturnType<typeof normalizeAcceptedHypertrophySeedV4>;
  try {
    normalized = normalizeAcceptedHypertrophySeedV4(revision.seedPayload);
  } catch {
    return block("accepted_revision_payload_invalid");
  }
  if (normalized.hash !== revision.payloadHash) {
    return block("accepted_revision_hash_mismatch");
  }

  const accepted = parseAcceptedHypertrophySeedV4(
    normalized.canonicalPayload,
  );
  if (
    mesocycle.durationWeeks !== 5 ||
    mesocycle.sessionsPerWeek !== 4 ||
    accepted.weeks.length !== 5 ||
    accepted.slots.length !== 4
  ) {
    return block("unsupported_v4_topology");
  }
  const expectedWeeks = [
    [1, "ACCUMULATION"],
    [2, "ACCUMULATION"],
    [3, "ACCUMULATION"],
    [4, "ACCUMULATION"],
    [5, "DELOAD"],
  ] as const;
  if (
    expectedWeeks.some(
      ([week, phase], index) =>
        accepted.weeks[index]?.week !== week ||
        accepted.weeks[index]?.phase !== phase,
    )
  ) {
    return block("v4_week_topology_invalid");
  }

  const slotSequence = record(mesocycle.slotSequenceJson);
  const rawSlots = Array.isArray(slotSequence?.slots)
    ? slotSequence.slots
    : null;
  if (
    slotSequence?.version !== 1 ||
    slotSequence.sequenceMode !== "ordered_flexible" ||
    slotSequence.source !== accepted.source ||
    slotSequence.sessionsPerWeek !== 4 ||
    rawSlots?.length !== 4
  ) {
    return block("frozen_slot_sequence_invalid");
  }

  const seenSlotIds = new Set<string>();
  const weeklySlots: Omit<V4RequiredSlot, "weekInMeso" | "phase">[] = [];
  for (let sequenceIndex = 0; sequenceIndex < rawSlots.length; sequenceIndex += 1) {
    const rawSlot = record(rawSlots[sequenceIndex]);
    const acceptedSlot = accepted.slots[sequenceIndex];
    if (
      !rawSlot ||
      !acceptedSlot ||
      typeof rawSlot.slotId !== "string" ||
      typeof rawSlot.intent !== "string"
    ) {
      return block("frozen_slot_identity_missing");
    }
    const slotId = rawSlot.slotId.trim();
    const intent = normalizeIntent(rawSlot.intent);
    if (
      !slotId ||
      !intent ||
      seenSlotIds.has(slotId) ||
      acceptedSlot.slotId !== slotId ||
      normalizeIntent(acceptedSlot.focus) !== intent
    ) {
      return block("frozen_slot_identity_conflict");
    }
    seenSlotIds.add(slotId);
    weeklySlots.push({
      slotId,
      intent,
      sequenceIndex,
      sequenceLength: rawSlots.length,
    });
  }

  return {
    status: "available",
    authority: {
      mesocycleId: mesocycle.id,
      revisionId: revision.id,
      revisionNumber: revision.revision,
      revisionHash: revision.payloadHash,
      slotsPerWeek: weeklySlots.length,
      requiredSlots: expectedWeeks.flatMap(([weekInMeso, phase]) =>
        weeklySlots.map((slot) => ({ ...slot, weekInMeso, phase })),
      ),
    },
  };
}

export function validateV4ScheduledGenerationObligation(input: {
  mesocycle: V4ScheduleAuthorityInput | null;
  obligation: V4ScheduledGenerationObligation;
}):
  | { status: "available"; obligation: V4ScheduledGenerationObligation }
  | { status: "blocked"; reason: string } {
  if (!input.mesocycle) {
    return { status: "blocked", reason: "active_mesocycle_missing" };
  }
  const resolution = resolveV4ScheduleAuthority(input.mesocycle);
  if (resolution.status !== "available") {
    return {
      status: "blocked",
      reason:
        resolution.status === "blocked"
          ? resolution.reason
          : "active_mesocycle_is_not_v4",
    };
  }

  const canonicalAuthority = resolution.authority;
  const suppliedAuthority = input.obligation.authority;
  if (
    suppliedAuthority.mesocycleId !== canonicalAuthority.mesocycleId ||
    suppliedAuthority.revisionId !== canonicalAuthority.revisionId ||
    suppliedAuthority.revisionNumber !== canonicalAuthority.revisionNumber ||
    suppliedAuthority.revisionHash !== canonicalAuthority.revisionHash ||
    suppliedAuthority.slotsPerWeek !== canonicalAuthority.slotsPerWeek
  ) {
    return { status: "blocked", reason: "schedule_authority_changed" };
  }

  const suppliedSlot = input.obligation.requiredSlot;
  const canonicalSlot = canonicalAuthority.requiredSlots.find(
    (slot) =>
      slot.weekInMeso === suppliedSlot.weekInMeso &&
      slot.slotId === suppliedSlot.slotId,
  );
  if (!canonicalSlot || stableJson(canonicalSlot) !== stableJson(suppliedSlot)) {
    return { status: "blocked", reason: "required_slot_changed" };
  }

  return {
    status: "available",
    obligation: {
      authority: canonicalAuthority,
      requiredSlot: canonicalSlot,
    },
  };
}

function slotKey(slot: Pick<V4RequiredSlot, "weekInMeso" | "slotId">): string {
  return `${slot.weekInMeso}:${slot.slotId}`;
}

export function buildScheduledSlotReceipt(
  authority: V4ScheduleAuthority,
  requiredSlot: V4RequiredSlot,
): ScheduledSlotReceiptV1 {
  return {
    version: 1,
    mesocycleId: authority.mesocycleId,
    acceptedRevisionId: authority.revisionId,
    acceptedRevisionNumber: authority.revisionNumber,
    acceptedRevisionHash: authority.revisionHash,
    weekInMeso: requiredSlot.weekInMeso,
    slotId: requiredSlot.slotId,
    sequenceIndex: requiredSlot.sequenceIndex,
    sequenceLength: requiredSlot.sequenceLength,
  };
}

function receiptMatchesExpected(
  actual: ScheduledSlotReceiptV1 | undefined,
  expected: ScheduledSlotReceiptV1,
): boolean {
  return Boolean(actual) && stableJson(actual) === stableJson(expected);
}

function sessionSlotMatches(
  actual: SessionSlotSnapshot | undefined,
  expected: V4RequiredSlot,
): boolean {
  return Boolean(
    actual &&
      actual.slotId === expected.slotId &&
      normalizeIntent(actual.intent) === expected.intent &&
      actual.sequenceIndex === expected.sequenceIndex &&
      actual.sequenceLength === expected.sequenceLength &&
      actual.source === "mesocycle_slot_sequence",
  );
}

function validateDecisionReceiptScheduling(input: {
  authority: V4ScheduleAuthority;
  requiredSlot: V4RequiredSlot;
  selectionMetadata: unknown;
}): string | null {
  const receipt = extractSessionDecisionReceipt(input.selectionMetadata);
  const expected = input.requiredSlot;
  const provenance = receipt?.sessionProvenance;
  const seed = provenance?.seedProvenance;
  if (!receipt) return "session_decision_receipt_missing";
  if (
    receipt.cycleContext.weekInMeso !== expected.weekInMeso ||
    receipt.cycleContext.mesocycleLength !== 5 ||
    receipt.cycleContext.isDeload !== (expected.phase === "DELOAD") ||
    receipt.cycleContext.phase !==
      (expected.phase === "DELOAD" ? "deload" : "accumulation")
  ) {
    return "receipt_week_identity_conflict";
  }
  if (!sessionSlotMatches(receipt.sessionSlot, expected)) {
    return "receipt_slot_identity_conflict";
  }
  if (
    provenance?.mesocycleId !== input.authority.mesocycleId ||
    provenance.compositionSource !==
      (expected.phase === "DELOAD"
        ? "deload_seed_replay"
        : "persisted_slot_plan_seed") ||
    seed?.revisionId !== input.authority.revisionId ||
    seed.revision !== input.authority.revisionNumber ||
    seed.hash !== input.authority.revisionHash
  ) {
    return "receipt_revision_identity_conflict";
  }
  return null;
}

export function resolveV4RequiredSlotFromDecisionReceipt(input: {
  authority: V4ScheduleAuthority;
  selectionMetadata: unknown;
  sessionIntent: string | null;
}): { requiredSlot: V4RequiredSlot } | { reason: string } {
  const receipt = extractSessionDecisionReceipt(input.selectionMetadata);
  const weekInMeso = receipt?.cycleContext.weekInMeso;
  const slotId = receipt?.sessionSlot?.slotId;
  const requiredSlot = input.authority.requiredSlots.find(
    (slot) => slot.weekInMeso === weekInMeso && slot.slotId === slotId,
  );
  if (!requiredSlot) return { reason: "required_slot_not_found" };
  const schedulingError = validateDecisionReceiptScheduling({
    authority: input.authority,
    requiredSlot,
    selectionMetadata: input.selectionMetadata,
  });
  if (schedulingError) return { reason: schedulingError };
  if (
    input.sessionIntent != null &&
    normalizeIntent(input.sessionIntent) !== requiredSlot.intent
  ) {
    return { reason: "workout_intent_conflict" };
  }
  return { requiredSlot };
}

export function resolveV4RequiredSlotFromPersistedWorkoutEvidence(input: {
  authority: V4ScheduleAuthority;
  workout: V4ScheduleWorkoutEvidence;
}): { requiredSlot: V4RequiredSlot } | { reason: string } {
  const resolved = resolveV4RequiredSlotFromDecisionReceipt({
    authority: input.authority,
    selectionMetadata: input.workout.selectionMetadata,
    sessionIntent: input.workout.sessionIntent,
  });
  if ("reason" in resolved) return resolved;

  const { requiredSlot } = resolved;
  if (
    input.workout.mesocycleId !== input.authority.mesocycleId ||
    input.workout.mesocycleWeekSnapshot !== requiredSlot.weekInMeso ||
    input.workout.mesocyclePhaseSnapshot !== requiredSlot.phase ||
    input.workout.mesoSessionSnapshot !== requiredSlot.sequenceIndex + 1 ||
    input.workout.seedRevisionId !== input.authority.revisionId ||
    input.workout.seedRevisionNumber !== input.authority.revisionNumber ||
    input.workout.seedPayloadHash !== input.authority.revisionHash
  ) {
    return { reason: "persisted_slot_identity_conflict" };
  }

  return { requiredSlot };
}

export function attachServerAuthoredV4ScheduledSlotReceipt(input: {
  authority: V4ScheduleAuthority;
  requiredSlot: V4RequiredSlot;
  selectionMetadata: unknown;
  incomingSelectionMetadata: unknown;
  persistedSelectionMetadata?: unknown;
  persistedWorkoutEvidence?: V4ScheduleWorkoutEvidence;
}): JsonRecord {
  const metadata = record(input.selectionMetadata) ?? {};
  const receipt = record(metadata.sessionDecisionReceipt);
  if (!receipt) throw new Error("V4_SCHEDULE_RECEIPT_REQUIRED");
  const expected = buildScheduledSlotReceipt(input.authority, input.requiredSlot);
  const schedulingError = validateDecisionReceiptScheduling({
    authority: input.authority,
    requiredSlot: input.requiredSlot,
    selectionMetadata: input.selectionMetadata,
  });
  if (schedulingError) {
    throw new Error(`V4_SCHEDULE_RECEIPT_CONFLICT:${schedulingError}`);
  }
  const incomingRawReceipt = record(
    record(input.incomingSelectionMetadata)?.sessionDecisionReceipt,
  );
  const incomingHasScheduledReceipt = Boolean(
    incomingRawReceipt && "scheduledSlotReceipt" in incomingRawReceipt,
  );
  const incomingReceipt = extractSessionDecisionReceipt(
    input.incomingSelectionMetadata,
  )?.scheduledSlotReceipt;
  if (input.persistedSelectionMetadata == null && incomingHasScheduledReceipt) {
    throw new Error("V4_SCHEDULE_RECEIPT_CLIENT_AUTHORED");
  }
  if (incomingReceipt && !receiptMatchesExpected(incomingReceipt, expected)) {
    throw new Error("V4_SCHEDULE_RECEIPT_CONFLICT");
  }

  const persistedRawReceipt = record(
    record(input.persistedSelectionMetadata)?.sessionDecisionReceipt,
  );
  const persistedScheduledReceipt = extractSessionDecisionReceipt(
    input.persistedSelectionMetadata,
  )?.scheduledSlotReceipt;
  if (input.persistedSelectionMetadata != null) {
    if (!persistedScheduledReceipt) {
      if (incomingRawReceipt) {
        throw new Error("V4_SCHEDULE_RECEIPT_CLIENT_AUTHORED");
      }
      if (!input.persistedWorkoutEvidence) {
        throw new Error("V4_SCHEDULE_RECEIPT_INVALID");
      }
      const persistedSlot = resolveV4RequiredSlotFromPersistedWorkoutEvidence({
        authority: input.authority,
        workout: input.persistedWorkoutEvidence,
      });
      if (
        "reason" in persistedSlot ||
        slotKey(persistedSlot.requiredSlot) !== slotKey(input.requiredSlot)
      ) {
        throw new Error("V4_SCHEDULE_RECEIPT_INVALID");
      }
      const persistedMetadata = record(input.persistedSelectionMetadata) ?? {};
      const persistedReceipt = record(persistedMetadata.sessionDecisionReceipt);
      if (!persistedReceipt) {
        throw new Error("V4_SCHEDULE_RECEIPT_INVALID");
      }
      return {
        ...metadata,
        sessionDecisionReceipt: {
          ...persistedReceipt,
          scheduledSlotReceipt: expected,
        },
      };
    }
    if (!receiptMatchesExpected(persistedScheduledReceipt, expected)) {
      throw new Error("V4_SCHEDULE_RECEIPT_INVALID");
    }
    const persistedRawScheduledReceipt = persistedRawReceipt?.scheduledSlotReceipt;
    const incomingRawScheduledReceipt = incomingRawReceipt?.scheduledSlotReceipt;
    if (
      incomingRawScheduledReceipt != null &&
      stableJson(incomingRawScheduledReceipt) !==
        stableJson(persistedRawScheduledReceipt)
    ) {
      throw new Error("V4_SCHEDULE_RECEIPT_CONFLICT");
    }
    return {
      ...metadata,
      sessionDecisionReceipt: {
        ...receipt,
        scheduledSlotReceipt: persistedRawScheduledReceipt,
      },
    };
  }

  return {
    ...metadata,
    sessionDecisionReceipt: {
      ...receipt,
      scheduledSlotReceipt: expected,
    },
  };
}

function validateWorkoutEvidence(input: {
  authority: V4ScheduleAuthority;
  workout: V4ScheduleWorkoutEvidence;
}): { claim: V4ResolvedSlotClaim } | { excluded: true } | { reason: string } {
  const { workout, authority } = input;
  const persistedSlot = resolveV4RequiredSlotFromPersistedWorkoutEvidence({
    authority,
    workout,
  });
  if ("reason" in persistedSlot) {
    const isRecognizedNonRequired =
      isStrictOptionalGapFillSession({
        selectionMetadata: workout.selectionMetadata,
        selectionMode: workout.selectionMode,
        sessionIntent: workout.sessionIntent,
      }) ||
      isStrictSupplementalDeficitSession({
        selectionMetadata: workout.selectionMetadata,
        selectionMode: workout.selectionMode,
        sessionIntent: workout.sessionIntent,
      }) ||
      isCloseoutSession(workout.selectionMetadata);
    if (persistedSlot.reason === "required_slot_not_found" && isRecognizedNonRequired) {
      return { excluded: true };
    }
    return { reason: `${persistedSlot.reason}:${workout.id}` };
  }

  const requiredSlot = persistedSlot.requiredSlot;
  const receipt = extractSessionDecisionReceipt(workout.selectionMetadata);
  const scheduled = receipt?.scheduledSlotReceipt;
  if (!scheduled) {
    return { reason: `scheduled_slot_receipt_missing_compat:${workout.id}` };
  }
  const expectedReceipt = buildScheduledSlotReceipt(authority, requiredSlot);
  if (!receiptMatchesExpected(scheduled, expectedReceipt)) {
    return { reason: `scheduled_slot_receipt_conflict:${workout.id}` };
  }
  const policy = getWorkoutStatusPolicy(workout.status);
  if (!policy) return { reason: `unknown_workout_status:${workout.id}` };
  return {
    claim: {
      requiredSlot,
      workoutId: workout.id,
      status: String(workout.status),
      scheduleResolved: policy.scheduleResolved,
      completed: policy.completed,
    },
  };
}

export function resolveV4ScheduledSlots(input: {
  authority: V4ScheduleAuthority;
  workouts: readonly V4ScheduleWorkoutEvidence[];
}): V4ScheduleResolution {
  const claimsBySlot = new Map<string, V4ResolvedSlotClaim>();
  for (const workout of input.workouts) {
    const validated = validateWorkoutEvidence({
      authority: input.authority,
      workout,
    });
    if ("reason" in validated) {
      return { status: "blocked", reason: validated.reason };
    }
    if ("excluded" in validated) continue;
    const key = slotKey(validated.claim.requiredSlot);
    if (claimsBySlot.has(key)) {
      return {
        status: "blocked",
        reason: `duplicate_required_slot_claim:${key}`,
      };
    }
    claimsBySlot.set(key, validated.claim);
  }

  const claims = [...claimsBySlot.values()];
  const resolvedSlotCount = claims.filter((claim) => claim.scheduleResolved).length;
  const completedSlotCount = claims.filter((claim) => claim.completed).length;
  const nextUnresolvedSlot =
    input.authority.requiredSlots.find(
      (slot) => !claimsBySlot.get(slotKey(slot))?.scheduleResolved,
    ) ?? null;
  const unresolvedSlotsInNextWeek = nextUnresolvedSlot
    ? input.authority.requiredSlots.filter(
        (slot) =>
          slot.weekInMeso === nextUnresolvedSlot.weekInMeso &&
          !claimsBySlot.get(slotKey(slot))?.scheduleResolved,
      )
    : [];
  const accumulationSlots = input.authority.requiredSlots.filter(
    (slot) => slot.phase === "ACCUMULATION",
  );

  return {
    status: "available",
    claims,
    resolvedSlotCount,
    completedSlotCount,
    allAccumulationResolved: accumulationSlots.every(
      (slot) => claimsBySlot.get(slotKey(slot))?.scheduleResolved === true,
    ),
    allResolved: input.authority.requiredSlots.every(
      (slot) => claimsBySlot.get(slotKey(slot))?.scheduleResolved === true,
    ),
    nextUnresolvedSlot,
    unresolvedSlotsInNextWeek,
  };
}
