import type { SessionIntent } from "@/lib/engine/session-types";
import type { MovementPatternV2 } from "@/lib/engine/types";
import { parseSessionIntent } from "./session-opportunities";
import {
  resolveLegacySlotSemanticsFallback,
  type MesocycleSlotArchetype,
  type MesocycleSlotAuthoredSemantics,
  type MesocycleSlotPrimaryLaneContract,
  type MesocycleSlotSupportCoverageContract,
  type MesocycleSlotContinuityScope,
} from "@/lib/api/mesocycle-slot-contract";

type SlotSequenceEntry = {
  slotId: string;
  intent: string;
  sequenceIndex?: number;
  authoredSemantics?: MesocycleSlotAuthoredSemantics;
};

type RepeatedSlotMetadata = {
  occurrenceIndex: number;
  totalSlots: number;
};

export type SessionSlotCompoundBias = {
  preferredMovementPatterns: MovementPatternV2[];
  preferredPrimaryMuscles?: string[];
};

export type SessionSlotShapeId =
  | "upper_horizontal_balanced"
  | "upper_vertical_balanced"
  | "lower_squat_dominant"
  | "lower_hinge_dominant";

export type SessionSlotShape = {
  id: SessionSlotShapeId;
  preferredAccessoryPrimaryMuscles: string[];
  requiredMovementPatterns?: MovementPatternV2[];
  avoidDuplicatePatterns?: MovementPatternV2[];
  supportPenaltyPatterns?: MovementPatternV2[];
  maxPreferredSupportPerPattern?: number;
};

export type SessionSlotCompoundLaneKey = "press" | "pull" | "primary";

export type SessionSlotCompoundLaneTier = "preferred" | "compatible" | "fallback_only";

export type SessionSlotCompoundLanePolicy = {
  key: SessionSlotCompoundLaneKey;
  preferredMovementPatterns: MovementPatternV2[];
  compatibleMovementPatterns: MovementPatternV2[];
  fallbackOnlyMovementPatterns: MovementPatternV2[];
  preferredPrimaryMuscles?: string[];
};

export type SessionSlotCompoundControl = {
  lanes: SessionSlotCompoundLanePolicy[];
};

export type SessionSlotResolvedCompoundLane = SessionSlotCompoundLanePolicy & {
  activeTier: SessionSlotCompoundLaneTier | null;
  viableCandidateCountByTier: Record<SessionSlotCompoundLaneTier, number>;
};

export type SessionSlotResolvedCompoundControl = {
  lanes: SessionSlotResolvedCompoundLane[];
};

export type SessionSlotPolicySlot = {
  sessionIntent: SessionIntent;
  slotId: string;
  sequenceIndex: number;
  slotArchetype?: MesocycleSlotArchetype;
  continuityScope: MesocycleSlotContinuityScope;
  repeatedSlot?: RepeatedSlotMetadata;
  compoundBias?: SessionSlotCompoundBias;
  compoundControl?: SessionSlotCompoundControl;
  sessionShape?: SessionSlotShape;
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
): Array<{
  slotId: string;
  intent: SessionIntent;
  sequenceIndex: number;
  authoredSemantics?: MesocycleSlotAuthoredSemantics;
}> {
  return slots.flatMap((slot, index) => {
      const intent = parseSessionIntent(slot.intent);
      const slotId = slot.slotId?.trim();
      if (!intent || !slotId) {
        return [];
      }
      return [{
        slotId,
        intent,
        sequenceIndex: slot.sequenceIndex ?? index,
        authoredSemantics: slot.authoredSemantics,
      }];
    });
}

function supportsRepeatedSlotProfiles(intent: SessionIntent): boolean {
  return intent === "upper" || intent === "lower" || intent === "push" || intent === "pull";
}

function resolveRepeatedSlotMetadata(params: {
  slotSequence: Array<{
    slotId: string;
    intent: SessionIntent;
    sequenceIndex: number;
    authoredSemantics?: MesocycleSlotAuthoredSemantics;
  }>;
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

function resolveCompoundBiasFromPrimaryLaneContract(
  contract: MesocycleSlotPrimaryLaneContract
): SessionSlotCompoundBias | undefined {
  if (!contract) {
    return undefined;
  }

  if (contract.mode === "bias_only") {
    return {
      preferredMovementPatterns: [...contract.preferredMovementPatterns],
      ...(contract.preferredPrimaryMuscles
        ? { preferredPrimaryMuscles: contract.preferredPrimaryMuscles }
        : {}),
    };
  }

  const preferredMovementPatterns = contract.lanes.flatMap((lane) => lane.preferredMovementPatterns);
  const preferredPrimaryMuscles = contract.lanes.flatMap((lane) => lane.preferredPrimaryMuscles ?? []);

  return {
    preferredMovementPatterns,
    ...(preferredPrimaryMuscles.length > 0
      ? { preferredPrimaryMuscles: preferredPrimaryMuscles }
      : {}),
  };
}

function resolveCompoundControlFromPrimaryLaneContract(
  contract: MesocycleSlotPrimaryLaneContract
): SessionSlotCompoundControl | undefined {
  if (!contract || contract.mode !== "lane_control") {
    return undefined;
  }

  return {
    lanes: contract.lanes.map((lane) => ({
      key: lane.key,
      preferredMovementPatterns: [...lane.preferredMovementPatterns],
      compatibleMovementPatterns: [...lane.compatibleMovementPatterns],
      fallbackOnlyMovementPatterns: [...lane.fallbackOnlyMovementPatterns],
      ...(lane.preferredPrimaryMuscles
        ? { preferredPrimaryMuscles: lane.preferredPrimaryMuscles }
        : {}),
    })),
  };
}

function resolveSessionShapeId(
  slotArchetype: MesocycleSlotArchetype
): SessionSlotShapeId | undefined {
  switch (slotArchetype) {
    case "upper_horizontal_balanced":
    case "upper_vertical_balanced":
    case "lower_squat_dominant":
    case "lower_hinge_dominant":
      return slotArchetype;
    default:
      return undefined;
  }
}

function resolveSessionShapeFromSupportCoverage(
  slotArchetype: MesocycleSlotArchetype | undefined,
  supportCoverageContract: MesocycleSlotSupportCoverageContract
): SessionSlotShape | undefined {
  if (!slotArchetype || !supportCoverageContract) {
    return undefined;
  }

  const id = resolveSessionShapeId(slotArchetype);
  if (!id) {
    return undefined;
  }

  return {
    id,
    preferredAccessoryPrimaryMuscles: [...supportCoverageContract.preferredAccessoryPrimaryMuscles],
    ...(supportCoverageContract.requiredMovementPatterns
      ? { requiredMovementPatterns: supportCoverageContract.requiredMovementPatterns }
      : {}),
    ...(supportCoverageContract.avoidDuplicatePatterns
      ? { avoidDuplicatePatterns: supportCoverageContract.avoidDuplicatePatterns }
      : {}),
    ...(supportCoverageContract.supportPenaltyPatterns
      ? { supportPenaltyPatterns: supportCoverageContract.supportPenaltyPatterns }
      : {}),
    ...(supportCoverageContract.maxPreferredSupportPerPattern != null
      ? { maxPreferredSupportPerPattern: supportCoverageContract.maxPreferredSupportPerPattern }
      : {}),
  };
}

function buildPolicySlot(params: {
  slotSequence: Array<{
    slotId: string;
    intent: SessionIntent;
    sequenceIndex: number;
    authoredSemantics?: MesocycleSlotAuthoredSemantics;
  }>;
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
  const authoredSemantics =
    slotEntry.authoredSemantics ??
    resolveLegacySlotSemanticsFallback({
      slots: params.slotSequence,
      slotId: params.slotId,
      intent: params.sessionIntent,
    });
  const compoundBias = resolveCompoundBiasFromPrimaryLaneContract(
    authoredSemantics?.primaryLaneContract ?? null
  );
  const compoundControl = resolveCompoundControlFromPrimaryLaneContract(
    authoredSemantics?.primaryLaneContract ?? null
  );
  const sessionShape = resolveSessionShapeFromSupportCoverage(
    authoredSemantics?.slotArchetype,
    authoredSemantics?.supportCoverageContract ?? null
  );

  return {
    sessionIntent: params.sessionIntent,
    slotId: params.slotId,
    sequenceIndex: slotEntry.sequenceIndex,
    continuityScope: authoredSemantics?.continuityScope ?? "slot",
    ...(authoredSemantics?.slotArchetype
      ? { slotArchetype: authoredSemantics.slotArchetype }
      : {}),
    ...(repeatedSlot ? { repeatedSlot } : {}),
    ...(compoundBias ? { compoundBias } : {}),
    ...(compoundControl ? { compoundControl } : {}),
    ...(sessionShape ? { sessionShape } : {}),
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

type CompoundLaneExercise = Pick<
  {
    movementPatterns?: MovementPatternV2[];
    primaryMuscles?: string[];
    isCompound?: boolean;
  },
  "movementPatterns" | "primaryMuscles" | "isCompound"
>;

function matchesAnyMovementPattern(
  exercise: Pick<CompoundLaneExercise, "movementPatterns">,
  patterns: readonly MovementPatternV2[]
): boolean {
  if (patterns.length === 0) {
    return false;
  }

  return patterns.some((pattern) => (exercise.movementPatterns ?? []).includes(pattern));
}

export function classifyExerciseForCompoundLane(
  exercise: CompoundLaneExercise,
  lane: SessionSlotCompoundLanePolicy
): SessionSlotCompoundLaneTier | null {
  if (!(exercise.isCompound ?? false)) {
    return null;
  }

  if (matchesAnyMovementPattern(exercise, lane.preferredMovementPatterns)) {
    return "preferred";
  }
  if (matchesAnyMovementPattern(exercise, lane.compatibleMovementPatterns)) {
    return "compatible";
  }
  if (matchesAnyMovementPattern(exercise, lane.fallbackOnlyMovementPatterns)) {
    return "fallback_only";
  }

  return null;
}

export function resolveSessionSlotCompoundLaneState<T>(input: {
  slot: SessionSlotPolicySlot | null | undefined;
  candidates: readonly T[];
  getExercise: (
    candidate: T
  ) => Pick<CompoundLaneExercise, "movementPatterns" | "primaryMuscles" | "isCompound">;
  isCandidateViable: (candidate: T) => boolean;
}): SessionSlotResolvedCompoundControl | null {
  const compoundControl = input.slot?.compoundControl;
  if (!compoundControl || compoundControl.lanes.length === 0) {
    return null;
  }

  return {
    lanes: compoundControl.lanes.map((lane) => {
      const viableCandidateCountByTier: Record<SessionSlotCompoundLaneTier, number> = {
        preferred: 0,
        compatible: 0,
        fallback_only: 0,
      };

      for (const candidate of input.candidates) {
        if (!input.isCandidateViable(candidate)) {
          continue;
        }
        const tier = classifyExerciseForCompoundLane(input.getExercise(candidate), lane);
        if (!tier) {
          continue;
        }
        viableCandidateCountByTier[tier] += 1;
      }

      const activeTier: SessionSlotCompoundLaneTier | null =
        viableCandidateCountByTier.preferred > 0
          ? "preferred"
          : viableCandidateCountByTier.compatible > 0
            ? "compatible"
            : viableCandidateCountByTier.fallback_only > 0
              ? "fallback_only"
              : null;

      return {
        ...lane,
        activeTier,
        viableCandidateCountByTier,
      };
    }),
  };
}

export function getExerciseCompoundLaneClassifications(
  compoundControl: SessionSlotResolvedCompoundControl | null | undefined,
  exercise: Pick<CompoundLaneExercise, "movementPatterns" | "primaryMuscles" | "isCompound">
): Array<{ key: SessionSlotCompoundLaneKey; tier: SessionSlotCompoundLaneTier }> {
  if (!compoundControl) {
    return [];
  }

  return compoundControl.lanes
    .map((lane) => {
      const tier = classifyExerciseForCompoundLane(exercise, lane);
      if (!tier) {
        return null;
      }
      return { key: lane.key, tier };
    })
    .filter((entry): entry is { key: SessionSlotCompoundLaneKey; tier: SessionSlotCompoundLaneTier } =>
      Boolean(entry)
    );
}

export function isExerciseAllowedForCompoundLaneSatisfaction(
  compoundControl: SessionSlotResolvedCompoundControl | null | undefined,
  laneKey: SessionSlotCompoundLaneKey,
  exercise: Pick<CompoundLaneExercise, "movementPatterns" | "primaryMuscles" | "isCompound">
): boolean {
  if (!compoundControl) {
    return false;
  }

  const lane = compoundControl.lanes.find((entry) => entry.key === laneKey);
  if (!lane || !lane.activeTier) {
    return false;
  }

  return classifyExerciseForCompoundLane(exercise, lane) === lane.activeTier;
}

export function isExerciseAllowedForAnyCompoundLaneSatisfaction(
  compoundControl: SessionSlotResolvedCompoundControl | null | undefined,
  exercise: Pick<CompoundLaneExercise, "movementPatterns" | "primaryMuscles" | "isCompound">
): boolean {
  if (!compoundControl) {
    return false;
  }

  return compoundControl.lanes.some((lane) =>
    isExerciseAllowedForCompoundLaneSatisfaction(compoundControl, lane.key, exercise)
  );
}
