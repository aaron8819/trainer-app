import type { WorkoutSessionIntent } from "@prisma/client";
import type { MovementPatternV2 } from "@/lib/engine/types";

type SlotSemanticsLaneKey = "press" | "pull" | "primary";

export type MesocycleSlotArchetype =
  | "upper_standard"
  | "upper_horizontal_balanced"
  | "upper_vertical_balanced"
  | "lower_standard"
  | "lower_squat_dominant"
  | "lower_hinge_dominant"
  | "push_standard"
  | "push_horizontal_primary"
  | "push_vertical_primary"
  | "pull_standard"
  | "pull_horizontal_primary"
  | "pull_vertical_primary"
  | "legs_standard"
  | "full_body_standard"
  | "body_part_standard";

export type MesocycleSlotPrimaryLaneControl = {
  mode: "lane_control";
  lanes: Array<{
    key: SlotSemanticsLaneKey;
    preferredMovementPatterns: MovementPatternV2[];
    compatibleMovementPatterns: MovementPatternV2[];
    fallbackOnlyMovementPatterns: MovementPatternV2[];
    preferredPrimaryMuscles?: string[];
  }>;
};

export type MesocycleSlotPrimaryLaneBias = {
  mode: "bias_only";
  preferredMovementPatterns: MovementPatternV2[];
  preferredPrimaryMuscles?: string[];
};

export type MesocycleSlotPrimaryLaneContract =
  | MesocycleSlotPrimaryLaneControl
  | MesocycleSlotPrimaryLaneBias
  | null;

export type MesocycleSlotSupportCoverageContract = {
  preferredAccessoryPrimaryMuscles: string[];
  protectedWeekOneCoverageMuscles?: string[];
  requiredMovementPatterns?: MovementPatternV2[];
  avoidDuplicatePatterns?: MovementPatternV2[];
  supportPenaltyPatterns?: MovementPatternV2[];
  maxPreferredSupportPerPattern?: number;
} | null;

export type MesocycleSlotContinuityScope = "slot" | "intent";

export type MesocycleSlotAuthoredSemantics = {
  slotArchetype: MesocycleSlotArchetype;
  primaryLaneContract: MesocycleSlotPrimaryLaneContract;
  supportCoverageContract: MesocycleSlotSupportCoverageContract;
  continuityScope: MesocycleSlotContinuityScope;
};

export type MesocycleSlotSequence = {
  version: 1;
  source: "handoff_draft";
  sequenceMode: "ordered_flexible";
  slots: Array<{
    slotId: string;
    intent: WorkoutSessionIntent;
    authoredSemantics?: MesocycleSlotAuthoredSemantics;
  }>;
};

export type NormalizedMesocycleSlot = {
  slotId: string;
  intent: string;
  sequenceIndex: number;
  authoredSemantics?: MesocycleSlotAuthoredSemantics;
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

function normalizeSlotEntries(
  slots: ReadonlyArray<{ slotId: string; intent: string }>
): Array<{ slotId: string; intent: string; sequenceIndex: number }> {
  return slots
    .map((slot, sequenceIndex) => {
      const slotId = slot.slotId?.trim();
      const intent = normalizeIntent(slot.intent);
      if (!slotId || intent.length === 0) {
        return null;
      }
      return {
        slotId,
        intent,
        sequenceIndex,
      };
    })
    .filter((slot): slot is { slotId: string; intent: string; sequenceIndex: number } => Boolean(slot));
}

function toSlotSuffix(index: number): string {
  return String.fromCharCode("a".charCodeAt(0) + index);
}

function supportsRepeatedSlotAuthoring(intent: string): boolean {
  return intent === "upper" || intent === "lower" || intent === "push" || intent === "pull";
}

function resolveRepeatedSlotMetadata(input: {
  slots: Array<{ slotId: string; intent: string; sequenceIndex: number }>;
  slotId: string;
  intent: string;
}): { occurrenceIndex: number; totalSlots: number } | null {
  if (!supportsRepeatedSlotAuthoring(input.intent)) {
    return null;
  }

  const sameIntentSlots = input.slots.filter((slot) => slot.intent === input.intent);
  if (sameIntentSlots.length <= 1) {
    return null;
  }

  const occurrenceIndex = sameIntentSlots.findIndex((slot) => slot.slotId === input.slotId);
  if (occurrenceIndex < 0) {
    return null;
  }

  return {
    occurrenceIndex,
    totalSlots: sameIntentSlots.length,
  };
}

function buildUpperRepeatedSemantics(prefersVertical: boolean): MesocycleSlotAuthoredSemantics {
  return {
    slotArchetype: prefersVertical
      ? "upper_vertical_balanced"
      : "upper_horizontal_balanced",
    primaryLaneContract: {
      mode: "lane_control",
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
    },
    supportCoverageContract: prefersVertical
      ? {
          preferredAccessoryPrimaryMuscles: ["Chest", "Triceps", "Side Delts"],
          protectedWeekOneCoverageMuscles: ["Chest", "Triceps"],
          requiredMovementPatterns: ["horizontal_pull"],
          avoidDuplicatePatterns: ["vertical_pull"],
          supportPenaltyPatterns: ["vertical_push", "vertical_pull"],
          maxPreferredSupportPerPattern: 1,
        }
      : {
          preferredAccessoryPrimaryMuscles: ["Chest", "Triceps"],
          protectedWeekOneCoverageMuscles: ["Chest", "Triceps"],
          requiredMovementPatterns: ["vertical_pull", "horizontal_pull"],
          avoidDuplicatePatterns: ["horizontal_pull"],
          supportPenaltyPatterns: ["horizontal_pull", "vertical_pull"],
          maxPreferredSupportPerPattern: 1,
        },
    continuityScope: "slot",
  };
}

function buildLowerRepeatedSemantics(prefersVertical: boolean): MesocycleSlotAuthoredSemantics {
  return {
    slotArchetype: prefersVertical ? "lower_hinge_dominant" : "lower_squat_dominant",
    primaryLaneContract: {
      mode: "lane_control",
      lanes: [
        {
          key: "primary",
          preferredMovementPatterns: [prefersVertical ? "hinge" : "squat"],
          compatibleMovementPatterns: [],
          fallbackOnlyMovementPatterns: [prefersVertical ? "squat" : "hinge"],
          preferredPrimaryMuscles: prefersVertical
            ? ["Hamstrings", "Glutes"]
            : ["Quads"],
        },
      ],
    },
    supportCoverageContract: prefersVertical
      ? {
          preferredAccessoryPrimaryMuscles: ["Hamstrings", "Calves", "Glutes"],
          protectedWeekOneCoverageMuscles: ["Hamstrings", "Calves"],
          avoidDuplicatePatterns: ["hinge"],
          supportPenaltyPatterns: ["squat"],
          maxPreferredSupportPerPattern: 1,
        }
      : {
          preferredAccessoryPrimaryMuscles: ["Quads", "Calves"],
          protectedWeekOneCoverageMuscles: ["Calves"],
          requiredMovementPatterns: ["hinge"],
          avoidDuplicatePatterns: ["squat"],
          supportPenaltyPatterns: ["hinge"],
          maxPreferredSupportPerPattern: 1,
        },
    continuityScope: "slot",
  };
}

function buildPushRepeatedSemantics(prefersVertical: boolean): MesocycleSlotAuthoredSemantics {
  return {
    slotArchetype: prefersVertical ? "push_vertical_primary" : "push_horizontal_primary",
    primaryLaneContract: {
      mode: "bias_only",
      preferredMovementPatterns: [prefersVertical ? "vertical_push" : "horizontal_push"],
    },
    supportCoverageContract: null,
    continuityScope: "slot",
  };
}

function buildPullRepeatedSemantics(prefersVertical: boolean): MesocycleSlotAuthoredSemantics {
  return {
    slotArchetype: prefersVertical ? "pull_vertical_primary" : "pull_horizontal_primary",
    primaryLaneContract: {
      mode: "bias_only",
      preferredMovementPatterns: [prefersVertical ? "vertical_pull" : "horizontal_pull"],
    },
    supportCoverageContract: null,
    continuityScope: "slot",
  };
}

function buildStandardSlotSemantics(intent: string): MesocycleSlotAuthoredSemantics {
  switch (intent) {
    case "upper":
      return {
        slotArchetype: "upper_standard",
        primaryLaneContract: null,
        supportCoverageContract: null,
        continuityScope: "slot",
      };
    case "lower":
      return {
        slotArchetype: "lower_standard",
        primaryLaneContract: null,
        supportCoverageContract: null,
        continuityScope: "slot",
      };
    case "push":
      return {
        slotArchetype: "push_standard",
        primaryLaneContract: null,
        supportCoverageContract: null,
        continuityScope: "slot",
      };
    case "pull":
      return {
        slotArchetype: "pull_standard",
        primaryLaneContract: null,
        supportCoverageContract: null,
        continuityScope: "slot",
      };
    case "legs":
      return {
        slotArchetype: "legs_standard",
        primaryLaneContract: null,
        supportCoverageContract: null,
        continuityScope: "slot",
      };
    case "body_part":
      return {
        slotArchetype: "body_part_standard",
        primaryLaneContract: null,
        supportCoverageContract: null,
        continuityScope: "slot",
      };
    case "full_body":
    default:
      return {
        slotArchetype: "full_body_standard",
        primaryLaneContract: null,
        supportCoverageContract: null,
        continuityScope: "slot",
      };
  }
}

function buildAuthoredSlotSemanticsFromSequence(input: {
  slots: Array<{ slotId: string; intent: string; sequenceIndex: number }>;
  slotId: string;
  intent: string;
}): MesocycleSlotAuthoredSemantics {
  const repeatedSlot = resolveRepeatedSlotMetadata(input);
  const prefersVertical = repeatedSlot ? repeatedSlot.occurrenceIndex % 2 === 1 : false;

  switch (input.intent) {
    case "upper":
      return repeatedSlot
        ? buildUpperRepeatedSemantics(prefersVertical)
        : buildStandardSlotSemantics(input.intent);
    case "lower":
      return repeatedSlot
        ? buildLowerRepeatedSemantics(prefersVertical)
        : buildStandardSlotSemantics(input.intent);
    case "push":
      return repeatedSlot
        ? buildPushRepeatedSemantics(prefersVertical)
        : buildStandardSlotSemantics(input.intent);
    case "pull":
      return repeatedSlot
        ? buildPullRepeatedSemantics(prefersVertical)
        : buildStandardSlotSemantics(input.intent);
    default:
      return buildStandardSlotSemantics(input.intent);
  }
}

export function resolveLegacySlotSemanticsFallback(input: {
  slots: ReadonlyArray<{ slotId: string; intent: string; sequenceIndex?: number }>;
  slotId: string;
  intent: string;
}): MesocycleSlotAuthoredSemantics | undefined {
  const normalizedSlots = input.slots
    .map((slot, index) => ({
      slotId: slot.slotId,
      intent: slot.intent,
      sequenceIndex: slot.sequenceIndex ?? index,
    }))
    .filter(
      (slot): slot is { slotId: string; intent: string; sequenceIndex: number } =>
        typeof slot.slotId === "string" &&
        slot.slotId.trim().length > 0 &&
        typeof slot.intent === "string" &&
        normalizeIntent(slot.intent).length > 0
    )
    .map((slot) => ({
      slotId: slot.slotId.trim(),
      intent: normalizeIntent(slot.intent),
      sequenceIndex: slot.sequenceIndex,
    }));
  const normalizedSlotId = input.slotId.trim();
  const normalizedIntent = normalizeIntent(input.intent);
  if (!normalizedSlotId || !normalizedIntent) {
    return undefined;
  }

  const slotEntry = normalizedSlots.find(
    (slot) => slot.slotId === normalizedSlotId && slot.intent === normalizedIntent
  );
  if (!slotEntry) {
    return undefined;
  }

  return buildAuthoredSlotSemanticsFromSequence({
    slots: normalizedSlots,
    slotId: normalizedSlotId,
    intent: normalizedIntent,
  });
}

function isLaneKey(value: unknown): value is SlotSemanticsLaneKey {
  return value === "press" || value === "pull" || value === "primary";
}

function isMovementPatternArray(value: unknown): value is MovementPatternV2[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function parsePrimaryLaneContract(value: unknown): MesocycleSlotPrimaryLaneContract {
  if (value == null) {
    return null;
  }
  const record = isRecord(value) ? value : null;
  if (!record || typeof record.mode !== "string") {
    return null;
  }

  if (record.mode === "bias_only") {
    if (!isMovementPatternArray(record.preferredMovementPatterns)) {
      return null;
    }
    return {
      mode: "bias_only",
      preferredMovementPatterns: record.preferredMovementPatterns,
      preferredPrimaryMuscles: isStringArray(record.preferredPrimaryMuscles)
        ? record.preferredPrimaryMuscles
        : undefined,
    };
  }

  if (record.mode === "lane_control" && Array.isArray(record.lanes)) {
    const lanes = record.lanes.flatMap((laneValue) => {
      const lane = isRecord(laneValue) ? laneValue : null;
      if (
        !lane ||
        !isLaneKey(lane.key) ||
        !isMovementPatternArray(lane.preferredMovementPatterns) ||
        !isMovementPatternArray(lane.compatibleMovementPatterns) ||
        !isMovementPatternArray(lane.fallbackOnlyMovementPatterns)
      ) {
        return [];
      }
      return [
        {
          key: lane.key,
          preferredMovementPatterns: lane.preferredMovementPatterns,
          compatibleMovementPatterns: lane.compatibleMovementPatterns,
          fallbackOnlyMovementPatterns: lane.fallbackOnlyMovementPatterns,
          preferredPrimaryMuscles: isStringArray(lane.preferredPrimaryMuscles)
            ? lane.preferredPrimaryMuscles
            : undefined,
        },
      ];
    });
    if (lanes.length !== record.lanes.length) {
      return null;
    }
    return {
      mode: "lane_control",
      lanes,
    };
  }

  return null;
}

function parseSupportCoverageContract(value: unknown): MesocycleSlotSupportCoverageContract {
  if (value == null) {
    return null;
  }
  const record = isRecord(value) ? value : null;
  if (!record || !isStringArray(record.preferredAccessoryPrimaryMuscles)) {
    return null;
  }

  return {
    preferredAccessoryPrimaryMuscles: record.preferredAccessoryPrimaryMuscles,
    requiredMovementPatterns: isMovementPatternArray(record.requiredMovementPatterns)
      ? record.requiredMovementPatterns
      : undefined,
    avoidDuplicatePatterns: isMovementPatternArray(record.avoidDuplicatePatterns)
      ? record.avoidDuplicatePatterns
      : undefined,
    supportPenaltyPatterns: isMovementPatternArray(record.supportPenaltyPatterns)
      ? record.supportPenaltyPatterns
      : undefined,
    maxPreferredSupportPerPattern:
      typeof record.maxPreferredSupportPerPattern === "number"
        ? record.maxPreferredSupportPerPattern
        : undefined,
  };
}

function parseContinuityScope(value: unknown): MesocycleSlotContinuityScope | undefined {
  return value === "slot" || value === "intent" ? value : undefined;
}

function parseAuthoredSlotSemantics(value: unknown): MesocycleSlotAuthoredSemantics | undefined {
  const record = isRecord(value) ? value : null;
  const continuityScope = parseContinuityScope(record?.continuityScope);
  if (!record || typeof record.slotArchetype !== "string" || !continuityScope) {
    return undefined;
  }

  return {
    slotArchetype: record.slotArchetype as MesocycleSlotArchetype,
    primaryLaneContract: parsePrimaryLaneContract(record.primaryLaneContract),
    supportCoverageContract: parseSupportCoverageContract(record.supportCoverageContract),
    continuityScope,
  };
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
  slots: ReadonlyArray<{
    slotId: string;
    intent: WorkoutSessionIntent;
    authoredSemantics?: MesocycleSlotAuthoredSemantics;
  }>
): MesocycleSlotSequence {
  const normalizedSlots = normalizeSlotEntries(slots);

  return {
    version: 1,
    source: "handoff_draft",
    sequenceMode: "ordered_flexible",
    slots: normalizedSlots.map((slot) => ({
      slotId: slot.slotId,
      intent: slot.intent.toUpperCase() as WorkoutSessionIntent,
      authoredSemantics:
        slots.find((entry) => entry.slotId === slot.slotId)?.authoredSemantics ??
        buildAuthoredSlotSemanticsFromSequence({
          slots: normalizedSlots,
          slotId: slot.slotId,
          intent: slot.intent,
        }),
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
              authoredSemantics: parseAuthoredSlotSemantics(slot.authoredSemantics),
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
