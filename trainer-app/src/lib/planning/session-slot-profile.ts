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
  protectedWeekOneCoverageMuscles?: ProtectedWeekOneCoverageMuscle[];
  requiredMovementPatterns?: MovementPatternV2[];
  avoidDuplicatePatterns?: MovementPatternV2[];
  supportPenaltyPatterns?: MovementPatternV2[];
  maxPreferredSupportPerPattern?: number;
};

export type ProtectedWeekOneCoverageMuscle =
  | "Chest"
  | "Triceps"
  | "Side Delts"
  | "Rear Delts"
  | "Hamstrings"
  | "Calves";

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
    ...(supportCoverageContract.protectedWeekOneCoverageMuscles
      ? {
          protectedWeekOneCoverageMuscles:
            supportCoverageContract.protectedWeekOneCoverageMuscles as ProtectedWeekOneCoverageMuscle[],
        }
      : {}),
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

function normalizeMuscleLabel(muscle: string): string {
  return muscle.trim().toLowerCase();
}

export function getProtectedWeekOneCoverageObligations(
  slot: Pick<SessionSlotPolicySlot, "sessionShape" | "slotArchetype"> | null | undefined
): ProtectedWeekOneCoverageMuscle[] {
  const directObligations = slot?.sessionShape?.protectedWeekOneCoverageMuscles;
  if (directObligations && directObligations.length > 0) {
    return Array.from(new Set(directObligations));
  }

  switch (slot?.slotArchetype) {
    case "upper_horizontal_balanced":
      return ["Chest", "Triceps", "Rear Delts"];
    case "upper_vertical_balanced":
      return ["Chest", "Triceps", "Side Delts"];
    case "lower_hinge_dominant":
      return ["Hamstrings", "Calves"];
    case "lower_squat_dominant":
      return ["Calves"];
    default:
      return [];
  }
}

function getProtectedWeekOneCoverageCompatibility(
  slot: Pick<SessionSlotPolicySlot, "sessionShape" | "slotArchetype"> | null | undefined
): ProtectedWeekOneCoverageMuscle[] {
  switch (slot?.slotArchetype) {
    case "upper_horizontal_balanced":
      return ["Chest", "Triceps", "Rear Delts"];
    case "upper_vertical_balanced":
      return ["Chest", "Triceps", "Side Delts"];
    case "lower_squat_dominant":
      return ["Hamstrings", "Calves"];
    case "lower_hinge_dominant":
      return ["Hamstrings", "Calves"];
    default:
      return getProtectedWeekOneCoverageObligations(slot);
  }
}

export function getProjectionRepairCompatibleMuscles(
  slot: Pick<SessionSlotPolicySlot, "sessionShape" | "slotArchetype"> | null | undefined,
  protectedMuscles: readonly string[]
): ProtectedWeekOneCoverageMuscle[] {
  const allowedByArchetype = getProtectedWeekOneCoverageCompatibility(slot);

  if (allowedByArchetype.length === 0 || protectedMuscles.length === 0) {
    return [];
  }

  const protectedSet = new Set(protectedMuscles.map(normalizeMuscleLabel));
  return allowedByArchetype.filter((muscle, index) => {
    if (allowedByArchetype.indexOf(muscle) !== index) {
      return false;
    }
    return protectedSet.has(normalizeMuscleLabel(muscle));
  });
}

export function getProjectionPreferredSupportMuscles(
  slot:
    | Pick<SessionSlotPolicySlot, "sessionShape">
    | null
    | undefined
): string[] {
  return Array.from(new Set(slot?.sessionShape?.preferredAccessoryPrimaryMuscles ?? []));
}

export function getProjectionSoftPreferredSupportMuscles(input: {
  slot:
    | Pick<SessionSlotPolicySlot, "sessionShape" | "compoundBias">
    | null
    | undefined;
  protectedMuscles: readonly string[];
}): string[] {
  const protectedMuscleSet = new Set(
    input.protectedMuscles.map(normalizeMuscleLabel)
  );
  const primaryLaneMuscleSet = new Set(
    (input.slot?.compoundBias?.preferredPrimaryMuscles ?? []).map(normalizeMuscleLabel)
  );

  return getProjectionPreferredSupportMuscles(input.slot).filter((muscle) => {
    const normalizedMuscle = normalizeMuscleLabel(muscle);
    return (
      !protectedMuscleSet.has(normalizedMuscle) &&
      !primaryLaneMuscleSet.has(normalizedMuscle)
    );
  });
}

function appendProjectionRepairMusclesToSessionShape(input: {
  sessionShape: SessionSlotShape | undefined;
  slot: Pick<SessionSlotPolicySlot, "sessionShape" | "slotArchetype"> | null | undefined;
  projectionRepairMuscles?: readonly string[];
}): SessionSlotShape | undefined {
  if (!input.sessionShape || !input.projectionRepairMuscles || input.projectionRepairMuscles.length === 0) {
    return input.sessionShape;
  }

  const compatibleRepairMuscles = getProjectionRepairCompatibleMuscles(
    input.slot,
    input.projectionRepairMuscles
  );
  if (compatibleRepairMuscles.length === 0) {
    return input.sessionShape;
  }

  const preferredAccessoryPrimaryMuscles = Array.from(
    new Set([
      ...compatibleRepairMuscles,
      ...input.sessionShape.preferredAccessoryPrimaryMuscles,
    ])
  );

  return {
    ...input.sessionShape,
    preferredAccessoryPrimaryMuscles,
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
  projectionRepairMuscles?: readonly string[];
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
  const sessionShape = appendProjectionRepairMusclesToSessionShape({
    sessionShape: resolveSessionShapeFromSupportCoverage(
      authoredSemantics?.slotArchetype,
      authoredSemantics?.supportCoverageContract ?? null
    ),
    slot: {
      slotArchetype: authoredSemantics?.slotArchetype,
    },
    projectionRepairMuscles: params.projectionRepairMuscles,
  });

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
  projectionRepairMuscles?: readonly string[];
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
          projectionRepairMuscles: input.projectionRepairMuscles,
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
const FUTURE_SLOT_PROTECTED_COVERAGE_MULTIPLIER = 1.3;
const FUTURE_SLOT_PROTECTED_FALLBACK_MULTIPLIER = 0.65;

export function getFutureSlotOpportunityBias(
  muscle: string,
  slot: SessionSlotPolicySlot
): number {
  const normalizedMuscle = normalizeMuscleLabel(muscle);
  const protectedCoverageMuscles = getProtectedWeekOneCoverageObligations(slot).map(
    normalizeMuscleLabel
  );
  const protectedCompatibleMuscles = getProtectedWeekOneCoverageCompatibility(slot).map(
    normalizeMuscleLabel
  );
  if (
    ["chest", "triceps", "hamstrings", "calves"].includes(normalizedMuscle)
  ) {
    if (protectedCompatibleMuscles.length === 0) {
      return 0;
    }
    if (!protectedCompatibleMuscles.includes(normalizedMuscle)) {
      return 0;
    }
    if (!protectedCoverageMuscles.includes(normalizedMuscle)) {
      return FUTURE_SLOT_PROTECTED_FALLBACK_MULTIPLIER;
    }
  }

  const preferredPrimaryMuscles = slot.compoundBias?.preferredPrimaryMuscles ?? [];
  if (preferredPrimaryMuscles.length === 0) {
    return protectedCoverageMuscles.includes(normalizedMuscle)
      ? FUTURE_SLOT_PROTECTED_COVERAGE_MULTIPLIER
      : 1;
  }

  const preferredBias = preferredPrimaryMuscles.some(
    (preferredMuscle) => preferredMuscle.trim().toLowerCase() === normalizedMuscle
  )
    ? FUTURE_SLOT_PREFERRED_PRIMARY_MULTIPLIER
    : 1;

  return protectedCoverageMuscles.includes(normalizedMuscle)
    ? Math.max(preferredBias, FUTURE_SLOT_PROTECTED_COVERAGE_MULTIPLIER)
    : preferredBias;
}

type CompoundLaneExercise = Pick<
  {
    movementPatterns?: MovementPatternV2[];
    primaryMuscles?: string[];
    isCompound?: boolean;
  },
  "movementPatterns" | "primaryMuscles" | "isCompound"
>;

type RequiredSessionShapeCoverageExercise = Pick<
  {
    movementPatterns?: MovementPatternV2[];
    isCompound?: boolean;
  },
  "movementPatterns" | "isCompound"
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

function matchesPreferredPrimaryMuscle(
  exercise: Pick<CompoundLaneExercise, "primaryMuscles">,
  preferredPrimaryMuscles: readonly string[] | undefined
): boolean {
  if (!preferredPrimaryMuscles || preferredPrimaryMuscles.length === 0) {
    return true;
  }

  const exercisePrimaryMuscles = new Set(
    (exercise.primaryMuscles ?? []).map(normalizeMuscleLabel)
  );
  if (exercisePrimaryMuscles.size === 0) {
    return false;
  }

  return preferredPrimaryMuscles.some((muscle) =>
    exercisePrimaryMuscles.has(normalizeMuscleLabel(muscle))
  );
}

export function isExerciseEligibleForRequiredSessionShapeCoverage(
  exercise: RequiredSessionShapeCoverageExercise
): boolean {
  return exercise.isCompound ?? false;
}

export function doesExerciseSatisfyRequiredSessionShapePattern(
  exercise: RequiredSessionShapeCoverageExercise,
  pattern: MovementPatternV2
): boolean {
  return (
    isExerciseEligibleForRequiredSessionShapeCoverage(exercise) &&
    (exercise.movementPatterns ?? []).includes(pattern)
  );
}

export function classifyExerciseForCompoundLane(
  exercise: CompoundLaneExercise,
  lane: SessionSlotCompoundLanePolicy
): SessionSlotCompoundLaneTier | null {
  if (!(exercise.isCompound ?? false)) {
    return null;
  }

  if (matchesAnyMovementPattern(exercise, lane.preferredMovementPatterns)) {
    return matchesPreferredPrimaryMuscle(exercise, lane.preferredPrimaryMuscles)
      ? "preferred"
      : "compatible";
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
