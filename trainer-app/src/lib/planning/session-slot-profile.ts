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

function resolveCompoundControl(
  sessionIntent: SessionIntent,
  occurrenceIndex: number
): SessionSlotCompoundControl | undefined {
  const prefersVertical = occurrenceIndex % 2 === 1;

  switch (sessionIntent) {
    case "upper":
      return {
        lanes: [
          {
            key: "press",
            preferredMovementPatterns: [prefersVertical ? "vertical_push" : "horizontal_push"],
            compatibleMovementPatterns: [],
            fallbackOnlyMovementPatterns: [prefersVertical ? "horizontal_push" : "vertical_push"],
          },
          {
            key: "pull",
            preferredMovementPatterns: [prefersVertical ? "vertical_pull" : "horizontal_pull"],
            compatibleMovementPatterns: [],
            fallbackOnlyMovementPatterns: [prefersVertical ? "horizontal_pull" : "vertical_pull"],
          },
        ],
      };
    case "lower":
      return prefersVertical
        ? {
            lanes: [
              {
                key: "primary",
                preferredMovementPatterns: ["hinge"],
                compatibleMovementPatterns: [],
                fallbackOnlyMovementPatterns: ["squat"],
                preferredPrimaryMuscles: ["Hamstrings", "Glutes"],
              },
            ],
          }
        : {
            lanes: [
              {
                key: "primary",
                preferredMovementPatterns: ["squat"],
                compatibleMovementPatterns: [],
                fallbackOnlyMovementPatterns: ["hinge"],
                preferredPrimaryMuscles: ["Quads"],
              },
            ],
          };
    default:
      return undefined;
  }
}

function resolveSessionShape(
  sessionIntent: SessionIntent,
  occurrenceIndex: number
): SessionSlotShape | undefined {
  const prefersVertical = occurrenceIndex % 2 === 1;

  switch (sessionIntent) {
    case "upper":
      return prefersVertical
        ? {
            id: "upper_vertical_balanced",
            preferredAccessoryPrimaryMuscles: ["Lats", "Front Delts", "Side Delts"],
            requiredMovementPatterns: ["horizontal_pull"],
            avoidDuplicatePatterns: ["vertical_pull"],
          }
        : {
            id: "upper_horizontal_balanced",
            preferredAccessoryPrimaryMuscles: ["Chest", "Upper Back", "Rear Delts"],
            requiredMovementPatterns: ["vertical_pull"],
            avoidDuplicatePatterns: ["horizontal_pull"],
          };
    case "lower":
      return prefersVertical
        ? {
            id: "lower_hinge_dominant",
            preferredAccessoryPrimaryMuscles: ["Hamstrings", "Glutes"],
            requiredMovementPatterns: ["squat"],
            avoidDuplicatePatterns: ["hinge"],
          }
        : {
            id: "lower_squat_dominant",
            preferredAccessoryPrimaryMuscles: ["Quads"],
            requiredMovementPatterns: ["hinge"],
            avoidDuplicatePatterns: ["squat"],
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
    compoundControl:
      repeatedSlot != null
        ? resolveCompoundControl(params.sessionIntent, repeatedSlot.occurrenceIndex)
        : undefined,
    sessionShape:
      repeatedSlot != null
        ? resolveSessionShape(params.sessionIntent, repeatedSlot.occurrenceIndex)
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
